from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from evaluation.adapter import AdapterError, SkillForgeAdapter
from evaluation.cases import load_cases
from evaluation.models import SourceCitation


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_financial_services_v5_golden(tmp_path: Path) -> None:
    case = next(case for case in load_cases() if case.id == "financial-services")
    rendered = SkillForgeAdapter(REPO_ROOT).render(case, tmp_path / "eval")
    golden_dir = Path(__file__).parent / "golden"
    assert (
        rendered.ground_truth.read_text().rstrip()
        == (golden_dir / "financial-services.ground-truth.yaml").read_text().rstrip()
    )
    assert (
        rendered.manifest.read_text().rstrip()
        == (golden_dir / "financial-services.manifest.yaml").read_text().rstrip()
    )


def test_adapter_rejects_missing_source_file(tmp_path: Path) -> None:
    case = load_cases()[0]
    bad_source = SourceCitation(
        type="github",
        uri="repo://does/not/exist.md",
        title="Missing",
        retrieved_at="2026-07-17T00:00:00Z",
        snippet="This source is intentionally missing for the negative test.",
    )
    bad_step = case.steps[0].model_copy(update={"sources": [bad_source]})
    bad_case = case.model_copy(update={"steps": [bad_step, *case.steps[1:]]})
    with pytest.raises(AdapterError, match="source does not exist"):
        SkillForgeAdapter(REPO_ROOT).render(bad_case, tmp_path / "eval")


def test_adapter_rejects_unresolved_placeholders(tmp_path: Path) -> None:
    case = load_cases()[0]
    bad_step = case.steps[0].model_copy(update={"prompt": "Use ${UNRESOLVED_VALUE}"})
    bad_case = case.model_copy(update={"steps": [bad_step, *case.steps[1:]]})
    with pytest.raises(AdapterError, match="unresolved placeholder"):
        SkillForgeAdapter(REPO_ROOT).render(bad_case, tmp_path / "eval")


def test_v5_contains_sources_regression_and_expectations(tmp_path: Path) -> None:
    case = load_cases()[1]
    rendered = SkillForgeAdapter(REPO_ROOT).render(case, tmp_path / "eval")
    raw = yaml.safe_load(rendered.ground_truth.read_text())
    assert raw["version"] == "5"
    for item in raw["test_cases"]:
        assert item["metadata"]["sources"]
        assert item["metadata"]["regression_intent"]
        expectations = item["expectations"]
        assert expectations["expected_facts"]
        assert expectations["assertions"]
        assert expectations["expected_patterns"]
        assert expectations["trace_expectations"]
