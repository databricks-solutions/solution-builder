from __future__ import annotations

from pathlib import Path

from evaluation.cases import load_cases
from evaluation.runner import run_scenario
from evaluation.toolchain import load_lock


REPO_ROOT = Path(__file__).resolve().parents[2]


def _fake_stf(path: Path) -> None:
    lock = load_lock()
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import json, pathlib, sys\n"
        f"REVISION = {lock.skillforge_revision!r}\n"
        f"VERSION = {lock.skillforge_version!r}\n"
        "args = sys.argv[1:]\n"
        "if args[:2] == ['build-info', '--json']:\n"
        "    print(json.dumps({'version': VERSION, 'revision': REVISION, 'features': "
        + repr(list(lock.required_features))
        + "})); raise SystemExit(0)\n"
        "if args and args[0] == 'doctor':\n"
        "    print(json.dumps({'ok': True})); raise SystemExit(0)\n"
        "if args and args[0] == 'compare':\n"
        "    output = pathlib.Path(args[args.index('--output') + 1])\n"
        "    levels = args[args.index('--levels') + 1].split(',')\n"
        "    level_data = {level: {'score': 1.0, 'task_results': []} for level in levels}\n"
        "    payload = {'mode': 'comparison', 'comparison_id': 'fake', "
        "'result_a': {'skill_name': 'databricks-demo-generator', 'composite_score': 1.0, 'levels': level_data, 'suggestions': [], 'gaps': {}, 'mlflow_run_id': 'mlflow-with', 'skills_invoked': ['databricks-demo-generator']}, "
        "'result_b': {'skill_name': 'solution-builder-without-skill', 'composite_score': 0.4, 'levels': level_data, 'suggestions': ['less coherent'], 'gaps': {}, 'mlflow_run_id': 'mlflow-without'}, "
        "'verdict': {'winner': 'A', 'dimensions': []}}\n"
        "    output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(payload)); raise SystemExit(0)\n"
        "raise SystemExit(2)\n",
        encoding="utf-8",
    )
    path.chmod(0o755)


def test_non_live_l1_to_l5_adapter_run(tmp_path: Path, monkeypatch) -> None:
    fake_stf = tmp_path / "stf"
    _fake_stf(fake_stf)
    ai_dev_kit = tmp_path / "ai-dev-kit"
    for skill_name in ("databricks-jobs", "databricks-lakebase-provisioned"):
        sibling = ai_dev_kit / "databricks-skills" / skill_name
        sibling.mkdir(parents=True)
        (sibling / "SKILL.md").write_text(
            f"---\nname: {skill_name}\ndescription: fixture\n---\n"
        )
    monkeypatch.setenv("SB_EVAL_STF", str(fake_stf))
    monkeypatch.setenv("SB_EVAL_AI_DEV_KIT_DIR", str(ai_dev_kit))
    monkeypatch.setenv("SB_EVAL_ALLOW_UNPINNED_FIXTURE", "test-only")
    case = load_cases()[0]
    result = run_scenario(
        case,
        levels=["unit", "integration", "static", "thinking", "output"],
        output_dir=tmp_path / "run",
        live=False,
        agent_model="fixture-agent",
        judge_model="fixture-judge",
        run_id="fixture-run",
        repo_root=REPO_ROOT,
    )
    assert result.status == "passed"
    assert {score.side for score in result.scores} >= {"with", "without"}
    assert result.cleanup.complete
    assert result.mlflow.run_ids == ["mlflow-with", "mlflow-without"]
    assert Path(result.reports["html"]).is_file()
    fixture_skills = (
        tmp_path / "run" / case.id / "fixture" / "project" / ".claude" / "skills"
    )
    assert (fixture_skills / "databricks-lakebase-provisioned" / "SKILL.md").is_file()
