"""Orchestrate pinned external SkillForge runs without importing SkillForge."""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from evaluation.adapter import SkillForgeAdapter
from evaluation.fixture import build_fixture
from evaluation.hashing import hash_skill
from evaluation.live import (
    DatabricksCliCleaner,
    LivePolicy,
    ResourceCleaner,
    ResourceRecord,
    expected_resource_kinds,
    reconcile_resources,
    resources_from_manifest,
    resources_from_tracked,
    write_leak_report,
)
from evaluation.models import (
    CleanupStatus,
    EvalGap,
    EvalModels,
    EvalResource,
    EvalRun,
    Scenario,
)
from evaluation.normalize import (
    contains_invalid_eval,
    extract_gaps,
    extract_mlflow,
    extract_scores,
    skill_was_invoked,
)
from evaluation.toolchain import (
    REPO_ROOT,
    find_executable,
    load_lock,
    skillforge_build_info,
)


def normalize_levels(value: str) -> list[str]:
    aliases = {
        "L1": "unit",
        "L2": "integration",
        "L3": "static",
        "L4": "thinking",
        "L5": "output",
        "UNIT": "unit",
        "INTEGRATION": "integration",
        "STATIC": "static",
        "THINKING": "thinking",
        "OUTPUT": "output",
    }
    if value.strip().lower() == "all":
        return ["unit", "integration", "static", "thinking", "output"]
    levels: list[str] = []
    for item in value.split(","):
        key = item.strip().upper()
        if key not in aliases:
            raise ValueError(f"unknown evaluation level: {item!r}")
        mapped = aliases[key]
        if mapped not in levels:
            levels.append(mapped)
    if not levels:
        raise ValueError("at least one evaluation level is required")
    return levels


def _git_sha(repo_root: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _write_live_skillforge_config(home: Path, policy: LivePolicy) -> Path:
    """Pin SkillForge's workspace and MLflow routing for a guarded live run."""
    experiment = os.environ.get(
        "SB_EVAL_MLFLOW_EXPERIMENT", "/Shared/sb_eval_skillforge_evals"
    ).strip()
    experiment_name = experiment.rsplit("/", 1)[-1]
    if not experiment.startswith("/") or not experiment_name.startswith(
        policy.evaluation_prefix
    ):
        raise ValueError(
            "live MLflow experiment must be an absolute path whose name starts "
            f"with {policy.evaluation_prefix!r}"
        )
    home.mkdir(parents=True, exist_ok=True)
    path = home / "config.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "databricks": {"profile": policy.profile},
                "mlflow": {"enabled": True, "experiment": experiment},
                "llm": {"backend": "fmapi"},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return path


def _load_tracked_resources(home: Path) -> list[ResourceRecord]:
    resources: list[ResourceRecord] = []
    for path in home.glob("runs/**/resources.json"):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        rows = (
            raw
            if isinstance(raw, list)
            else raw.get("resources", [])
            if isinstance(raw, dict)
            else []
        )
        if isinstance(rows, list):
            resources.extend(
                resources_from_tracked(row for row in rows if isinstance(row, dict))
            )
    return resources


def _load_project_resources(search_root: Path) -> list[ResourceRecord]:
    resources: list[ResourceRecord] = []
    for path in search_root.glob("**/resources.json"):
        if ".skillforge" in path.parts or "skillforge-home" in path.parts:
            continue
        try:
            resources.extend(resources_from_manifest(path))
        except (OSError, json.JSONDecodeError):
            continue
    return resources


def _html_summary(result: EvalRun) -> str:
    score_rows = "".join(
        f"<tr><td>{score.side}</td><td>{score.name}</td><td>{score.value}</td></tr>"
        for score in result.scores
    )
    gap_rows = "".join(
        f"<li><strong>{gap.side}/{gap.code}</strong>: {gap.message}</li>"
        for gap in result.gaps
    )
    return (
        "<!doctype html><meta charset='utf-8'><title>Solution Builder evaluation</title>"
        f"<h1>{result.scenario_id}: {result.status}</h1>"
        f"<p>Run <code>{result.run_id}</code>; skill hash <code>{result.skill_hash}</code></p>"
        "<h2>Scores</h2><table><tr><th>Side</th><th>Name</th><th>Value</th></tr>"
        f"{score_rows}</table><h2>Gaps</h2><ul>{gap_rows}</ul>"
        f"<h2>Cleanup</h2><pre>{json.dumps(result.cleanup.model_dump(), indent=2)}</pre>"
    )


def _tag_mlflow_runs(
    raw: dict[str, Any],
    *,
    scenario: Scenario,
    git_sha: str,
    skill_hash: str,
    skillforge_revision: str,
    levels: list[str],
    agent_model: str | None,
    judge_model: str | None,
) -> list[str]:
    profile = os.environ.get("SB_EVAL_DATABRICKS_PROFILE", "").strip()
    if not profile:
        return []
    errors: list[str] = []
    for result_key, side in (("result_a", "with"), ("result_b", "without")):
        result = raw.get(result_key)
        run_id = result.get("mlflow_run_id") if isinstance(result, dict) else None
        if not run_id:
            continue
        tags = {
            "sb_eval.scenario_id": scenario.id,
            "sb_eval.git_sha": git_sha,
            "sb_eval.skill_hash": skill_hash,
            "sb_eval.skillforge_revision": skillforge_revision,
            "sb_eval.agent_model": agent_model or "default",
            "sb_eval.judge_model": judge_model or "default",
            "sb_eval.levels": ",".join(levels),
            "sb_eval.side": side,
            "sb_eval.capabilities": ",".join(scenario.capabilities),
        }
        for key, value in tags.items():
            completed = subprocess.run(
                [
                    "databricks",
                    "api",
                    "post",
                    "/api/2.0/mlflow/runs/set-tag",
                    "--json",
                    json.dumps({"run_id": run_id, "key": key, "value": value}),
                    "--profile",
                    profile,
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if completed.returncode:
                errors.append(
                    f"{run_id}/{key}: {(completed.stderr or completed.stdout).strip()}"
                )
    return errors


def run_scenario(
    scenario: Scenario,
    *,
    levels: list[str],
    output_dir: Path,
    live: bool,
    agent_model: str | None,
    judge_model: str | None,
    run_id: str,
    repo_root: Path = REPO_ROOT,
) -> EvalRun:
    started_at = datetime.now(timezone.utc)
    lock = load_lock()
    executable = find_executable(lock)
    if executable is None:
        raise RuntimeError(
            f"external executable {lock.skillforge_executable!r} was not found"
        )
    build_info = skillforge_build_info(executable)
    scenario_dir = output_dir / scenario.id
    scenario_dir.mkdir(parents=True, exist_ok=False)
    fixture = build_fixture(scenario_dir / "fixture", repo_root=repo_root, lock=lock)
    assets = SkillForgeAdapter(repo_root).render(
        scenario, scenario_dir / "eval-assets", live=live
    )
    raw_path = scenario_dir / "skillforge-result.json"
    skillforge_home = scenario_dir / "skillforge-home"
    command = [
        executable,
        "compare",
        str(fixture.target_skill),
        str(fixture.control_skill),
        "--levels",
        ",".join(levels),
        "--timeout",
        str(scenario.timeout_seconds),
        "--comparison-id",
        f"{run_id}-{scenario.id}",
        "--project-dir",
        str(fixture.project_dir),
        "--eval-dir",
        str(assets.eval_dir),
        "--output",
        str(raw_path),
    ]
    if agent_model:
        command.extend(["--agent-model", agent_model])
    if judge_model:
        command.extend(["--judge-model", judge_model])
    env = os.environ.copy()
    env["SB_EVAL_PREFIX"] = scenario.live_resources.evaluation_prefix
    if live:
        env["SB_EVAL_LIVE"] = "1"
        # Validate before the external runner can make a tool call.
        policy = LivePolicy.from_env(scenario.live_resources.evaluation_prefix)
        _write_live_skillforge_config(skillforge_home, policy)
        env["DATABRICKS_CONFIG_PROFILE"] = policy.profile
        env["DATABRICKS_HOST"] = policy.host
    env["SKILLFORGE_HOME"] = str(skillforge_home)
    shim_dir = Path(__file__).resolve().parent / "skillforge_runtime"
    python_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = os.pathsep.join(
        item for item in (str(shim_dir), python_path) if item
    )
    completed = subprocess.run(
        command,
        cwd=repo_root,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    (scenario_dir / "skillforge.stdout.log").write_text(
        completed.stdout, encoding="utf-8"
    )
    (scenario_dir / "skillforge.stderr.log").write_text(
        completed.stderr, encoding="utf-8"
    )
    raw: dict[str, Any] = {}
    if raw_path.is_file():
        try:
            loaded = json.loads(raw_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
        except json.JSONDecodeError:
            raw = {"parse_error": "SkillForge result was not valid JSON"}

    gaps = extract_gaps(raw)
    git_sha = _git_sha(repo_root)
    skill_hash = hash_skill(
        repo_root / ".claude" / "skills" / "databricks-demo-generator"
    )
    tag_errors = _tag_mlflow_runs(
        raw,
        scenario=scenario,
        git_sha=git_sha,
        skill_hash=skill_hash,
        skillforge_revision=str(build_info["revision"]),
        levels=levels,
        agent_model=agent_model,
        judge_model=judge_model,
    )
    if tag_errors:
        gaps.append(
            EvalGap(
                code="mlflow_tagging_failed",
                message="; ".join(tag_errors),
            )
        )
    invalid = contains_invalid_eval(raw)
    if completed.returncode != 0:
        gaps.append(
            EvalGap(
                code="skillforge_failed",
                message=(completed.stderr or completed.stdout).strip()[-4000:]
                or f"exit {completed.returncode}",
            )
        )
    if invalid:
        gaps.append(
            EvalGap(code="invalid_eval", message="SkillForge reported invalid_eval")
        )

    tracked = _load_tracked_resources(skillforge_home)
    manifests = _load_project_resources(scenario_dir)
    resources = reconcile_resources(tracked, manifests)
    cleanup = CleanupStatus(attempted=live, complete=not live)
    status = "passed"
    if completed.returncode != 0:
        status = "failed"
    if invalid:
        status = "invalid_eval"
    if live and tag_errors:
        status = "failed"

    if live:
        if not skill_was_invoked(raw, scenario.skill):
            gaps.append(
                EvalGap(
                    code="skill_not_invoked",
                    message=f"WITH traces did not prove invocation of {scenario.skill}",
                    side="with",
                )
            )
            status = "failed"
        actual_kinds = {resource.resource_type for resource in resources}
        expected_kinds = set(
            expected_resource_kinds(
                scenario.capabilities,
                overrides=(
                    *scenario.live_resources.expected_resource_kinds,
                    *scenario.live_resources.additional_resource_kinds,
                ),
            )
        )
        missing_kinds = sorted(expected_kinds - actual_kinds)
        if missing_kinds:
            gaps.append(
                EvalGap(
                    code="missing_live_resource_kinds",
                    message="missing expected resource kinds: "
                    + ", ".join(missing_kinds),
                )
            )
            status = "failed"
        policy = LivePolicy.from_env(scenario.live_resources.evaluation_prefix)
        backend = DatabricksCliCleaner(policy)
        cleanup_report = ResourceCleaner(
            backend.delete, backend.exists, retries=3, retry_delay=1
        ).cleanup(resources)
        leak_path = scenario_dir / "leak-report.json"
        write_leak_report(leak_path, cleanup_report, resources)
        cleanup = CleanupStatus(
            attempted=True,
            complete=cleanup_report.complete,
            deleted=cleanup_report.deleted,
            remaining=cleanup_report.remaining,
            errors=cleanup_report.errors,
            leak_report=str(leak_path),
        )
        if not cleanup.complete:
            status = "leaked"

    result = EvalRun(
        run_id=run_id,
        scenario_id=scenario.id,
        git_sha=git_sha,
        skill_hash=skill_hash,
        skillforge_version=str(build_info["version"]),
        skillforge_revision=str(build_info["revision"]),
        levels=levels,
        models=EvalModels(agent=agent_model, judge=judge_model),
        scores=extract_scores(raw),
        gaps=gaps,
        resources=[
            EvalResource(
                resource_type=resource.resource_type,
                resource_id=resource.resource_id,
                name=resource.name or None,
                side=resource.side if resource.side in {"with", "without"} else None,
                source=resource.source,
            )
            for resource in resources
        ],
        cleanup=cleanup,
        mlflow=extract_mlflow(raw),
        reports={
            "skillforge_json": str(raw_path),
            "stdout": str(scenario_dir / "skillforge.stdout.log"),
            "stderr": str(scenario_dir / "skillforge.stderr.log"),
        },
        status=status,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        raw_result=raw,
    )
    normalized_path = scenario_dir / "eval-run.json"
    html_path = scenario_dir / "report.html"
    result.reports["normalized_json"] = str(normalized_path)
    result.reports["html"] = str(html_path)
    normalized_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    html_path.write_text(_html_summary(result), encoding="utf-8")
    return result


def new_run_id() -> str:
    return uuid.uuid4().hex
