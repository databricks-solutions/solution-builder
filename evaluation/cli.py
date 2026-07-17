"""Maintainer CLI for canonical cases and pinned external SkillForge."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

from evaluation.adapter import SkillForgeAdapter
from evaluation.cases import CaseValidationError, load_cases, select_cases
from evaluation.runner import new_run_id, normalize_levels, run_scenario
from evaluation.schema_generator import rendered_schema
from evaluation.toolchain import (
    REPO_ROOT,
    Check,
    find_executable,
    load_lock,
    run_doctor,
)


def _print_checks(checks: list[Check], *, as_json: bool) -> None:
    if as_json:
        print(json.dumps([check.__dict__ for check in checks], indent=2))
        return
    for check in checks:
        marker = "PASS" if check.ok else "FAIL"
        print(f"[{marker}] {check.name}: {check.detail}")


def cases_validate(*, as_json: bool) -> int:
    try:
        cases = load_cases()
        adapter = SkillForgeAdapter(REPO_ROOT)
        for case in cases:
            adapter.validate(case)
        schema_path = REPO_ROOT / "evaluation" / "schema" / "scenario.schema.json"
        if (
            not schema_path.is_file()
            or schema_path.read_text(encoding="utf-8") != rendered_schema()
        ):
            raise CaseValidationError(
                "committed JSON Schema is stale; run `uv run python -m evaluation.schema_generator`"
            )
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        if as_json:
            print(json.dumps({"valid": False, "error": str(exc)}))
        else:
            print(f"case validation failed: {exc}", file=sys.stderr)
        return 1
    payload = {
        "valid": True,
        "count": len(cases),
        "scenarios": [case.id for case in cases],
    }
    print(
        json.dumps(payload, indent=2)
        if as_json
        else f"validated {len(cases)} scenarios: {', '.join(payload['scenarios'])}"
    )
    return 0


def doctor(*, as_json: bool) -> int:
    checks = run_doctor(REPO_ROOT)
    lock = load_lock()
    executable = find_executable(lock)
    if executable:
        completed = subprocess.run(
            [executable, "doctor", "--json", "--skip-judge"],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        checks.append(
            Check(
                "skillforge-doctor",
                completed.returncode == 0,
                (completed.stdout or completed.stderr).strip()[-4000:],
            )
        )
    _print_checks(checks, as_json=as_json)
    return 0 if all(check.ok or not check.required for check in checks) else 1


def run_command(args: argparse.Namespace) -> int:
    try:
        levels = normalize_levels(args.levels)
        cases = select_cases(args.scenario)
    except (ValueError, CaseValidationError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    run_id = new_run_id()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    output_dir = REPO_ROOT / "test-runs" / "skillforge" / f"{stamp}-{run_id[:8]}"
    output_dir.mkdir(parents=True, exist_ok=False)
    results = []
    failed = False
    for case in cases:
        print(
            f"[sb-eval] scenario={case.id} levels={','.join(levels)} live={args.live}"
        )
        try:
            result = run_scenario(
                case,
                levels=levels,
                output_dir=output_dir,
                live=args.live,
                agent_model=args.agent_model,
                judge_model=args.judge_model,
                run_id=run_id,
            )
            results.append(result)
            print(f"[sb-eval] {case.id}: {result.status}")
            failed = failed or result.status != "passed"
        except Exception as exc:  # noqa: BLE001 - continue to retain other reports
            failed = True
            print(f"[sb-eval] {case.id}: fatal: {exc}", file=sys.stderr)
    summary = {
        "run_id": run_id,
        "output_dir": str(output_dir),
        "results": [
            {
                "scenario": result.scenario_id,
                "status": result.status,
                "report": result.reports.get("html"),
            }
            for result in results
        ],
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(f"[sb-eval] reports: {output_dir}")
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sb-eval")
    subcommands = parser.add_subparsers(dest="command", required=True)
    cases = subcommands.add_parser("cases")
    case_commands = cases.add_subparsers(dest="case_command", required=True)
    validate = case_commands.add_parser("validate")
    validate.add_argument("--json", action="store_true")
    doctor_parser = subcommands.add_parser("doctor")
    doctor_parser.add_argument("--json", action="store_true")
    run = subcommands.add_parser("run")
    run.add_argument("--levels", required=True, help="L1,L3 or all")
    run.add_argument("--live", action="store_true")
    run.add_argument("--scenario", default="all")
    run.add_argument("--agent-model")
    run.add_argument("--judge-model")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "cases" and args.case_command == "validate":
        return cases_validate(as_json=args.json)
    if args.command == "doctor":
        return doctor(as_json=args.json)
    if args.command == "run":
        return run_command(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
