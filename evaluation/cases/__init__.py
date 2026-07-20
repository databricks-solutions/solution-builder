"""Load and validate canonical Solution Builder evaluation cases."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from evaluation.models import Scenario


CASES_DIR = Path(__file__).parent


class CaseValidationError(ValueError):
    pass


def case_paths(cases_dir: Path = CASES_DIR) -> list[Path]:
    return sorted(path for path in cases_dir.glob("*.yaml") if path.is_file())


def load_case(path: Path) -> Scenario:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        return Scenario.model_validate(raw)
    except (OSError, yaml.YAMLError, ValidationError, TypeError) as exc:
        raise CaseValidationError(f"{path}: {exc}") from exc


def load_cases(cases_dir: Path = CASES_DIR) -> list[Scenario]:
    paths = case_paths(cases_dir)
    if not paths:
        raise CaseValidationError(f"no scenario YAML files found in {cases_dir}")
    cases = [load_case(path) for path in paths]
    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        raise CaseValidationError("scenario ids must be unique across case files")
    return cases


def select_cases(selector: str | None, cases_dir: Path = CASES_DIR) -> list[Scenario]:
    cases = load_cases(cases_dir)
    if selector in (None, "all"):
        return cases
    selected = [case for case in cases if case.id == selector]
    if not selected:
        available = ", ".join(case.id for case in cases)
        raise CaseValidationError(
            f"unknown scenario {selector!r}; available: {available}"
        )
    return selected
