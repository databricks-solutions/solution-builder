"""Normalize external SkillForge JSON into the stable EvalRun contract."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from evaluation.models import EvalGap, EvalScore, MlflowIdentity


def walk(value: Any) -> Iterator[tuple[str | None, Any]]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield key, child
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield None, child
            yield from walk(child)


def contains_invalid_eval(raw: dict[str, Any]) -> bool:
    for key, value in walk(raw):
        if isinstance(value, str) and value.lower() == "invalid_eval":
            return True
        if key == "invalid_eval" and bool(value):
            return True
    return False


def skill_was_invoked(raw: dict[str, Any], skill_name: str) -> bool:
    found_signal = False
    for key, value in walk(raw):
        if key not in {"skills_invoked", "invoked_skills", "skill_invocations"}:
            continue
        found_signal = True
        if isinstance(value, str) and skill_name in value:
            return True
        if isinstance(value, list) and any(skill_name in str(item) for item in value):
            return True
        if isinstance(value, dict) and skill_name in str(value):
            return True
    return False if found_signal else False


def extract_scores(raw: dict[str, Any]) -> list[EvalScore]:
    scores: list[EvalScore] = []
    for result_key, side in (("result_a", "with"), ("result_b", "without")):
        result = raw.get(result_key)
        if not isinstance(result, dict):
            continue
        composite = result.get("composite_score")
        if isinstance(composite, (int, float)):
            scores.append(
                EvalScore(name="composite", value=float(composite), side=side)
            )
        levels = result.get("levels")
        if isinstance(levels, dict):
            for level, level_result in levels.items():
                if not isinstance(level_result, dict):
                    continue
                value = level_result.get("score")
                if isinstance(value, (int, float)):
                    scores.append(
                        EvalScore(name=str(level), value=float(value), side=side)
                    )
    verdict = raw.get("verdict")
    if isinstance(verdict, dict):
        for dimension in verdict.get("dimensions") or []:
            if not isinstance(dimension, dict):
                continue
            value = dimension.get("score") or dimension.get("score_a")
            if isinstance(value, (int, float)):
                scores.append(
                    EvalScore(
                        name=f"comparison/{dimension.get('name', 'dimension')}",
                        value=float(value),
                        side="comparison",
                    )
                )
    return scores


def extract_gaps(raw: dict[str, Any]) -> list[EvalGap]:
    gaps: list[EvalGap] = []
    for result_key, side in (("result_a", "with"), ("result_b", "without")):
        result = raw.get(result_key)
        if not isinstance(result, dict):
            continue
        suggestions = result.get("suggestions") or []
        for index, suggestion in enumerate(suggestions):
            gaps.append(
                EvalGap(
                    code=f"suggestion_{index + 1}",
                    message=str(suggestion),
                    side=side,
                )
            )
        structured = result.get("gaps")
        if not structured:
            continue
        for key, value in walk(structured):
            if key not in {
                "message",
                "detail",
                "rationale",
                "summary",
            } or not isinstance(value, str):
                continue
            gaps.append(
                EvalGap(
                    code="skillforge_gap",
                    message=value,
                    side=side,
                )
            )
    # Stable de-duplication prevents nested gap summaries appearing repeatedly.
    unique: dict[tuple[str, str, str], EvalGap] = {}
    for gap in gaps:
        unique[(gap.code, gap.message, gap.side)] = gap
    return list(unique.values())


def extract_mlflow(raw: dict[str, Any]) -> MlflowIdentity:
    run_ids: set[str] = set()
    trace_ids: set[str] = set()
    experiment_id: str | None = None
    for key, value in walk(raw):
        if not isinstance(value, str) or not value:
            continue
        if key in {"mlflow_run_id", "run_id"} and key == "mlflow_run_id":
            run_ids.add(value)
        elif key in {"mlflow_trace_id", "trace_id"}:
            trace_ids.add(value)
        elif key in {"mlflow_experiment_id", "experiment_id"} and experiment_id is None:
            experiment_id = value
    return MlflowIdentity(
        experiment_id=experiment_id,
        run_ids=sorted(run_ids),
        trace_ids=sorted(trace_ids),
    )
