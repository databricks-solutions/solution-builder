"""CLI for validating canonical Solution Builder scenarios."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from evaluation.cases import CaseValidationError, load_cases
from evaluation.schema_generator import rendered_schema


REPO_ROOT = Path(__file__).resolve().parents[1]


def cases_validate(*, as_json: bool) -> int:
    try:
        cases = load_cases()
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sb-eval")
    subcommands = parser.add_subparsers(dest="command", required=True)
    cases = subcommands.add_parser("cases")
    case_commands = cases.add_subparsers(dest="case_command", required=True)
    validate = case_commands.add_parser("validate")
    validate.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "cases" and args.case_command == "validate":
        return cases_validate(as_json=args.json)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
