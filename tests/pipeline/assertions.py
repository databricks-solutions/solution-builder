"""Pure assertion helpers for the pipeline harness.

No I/O. Each function takes already-fetched data and returns an Issue list.
The runner aggregates issues into the per-scenario result.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .scenarios import stage_index


@dataclass
class Issue:
    code: str
    detail: str


def stage_at_least(actual: str, target: str) -> list[Issue]:
    if stage_index(actual) < stage_index(target):
        return [Issue("stage_below_target", f"stage={actual}, target={target}")]
    return []


def no_error_messages(messages: list[dict[str, Any]]) -> list[Issue]:
    issues: list[Issue] = []
    for m in messages:
        if m.get("is_error"):
            preview = (m.get("content") or "")[:200]
            issues.append(Issue("error_message", f"id={m.get('id')}: {preview}"))
    return issues


def required_artifacts_present(
    file_paths: list[str], target_stage: str
) -> list[Issue]:
    """Light file-presence checks per stage. Mirrors compute_project_stage()
    but reports each missing artifact rather than just returning a stage label.
    """
    paths_lower = {p.lower() for p in file_paths}
    names_lower = {p.rsplit("/", 1)[-1] for p in paths_lower}
    issues: list[Issue] = []

    target_idx = stage_index(target_stage)

    if target_idx >= stage_index("SUMMARIZED") and "readme.md" not in names_lower:
        issues.append(Issue("missing_readme", "no README.md found"))

    if target_idx >= stage_index("SPECIFICATION"):
        has_spec = any(p.startswith("specifications/") and p.endswith(".md") for p in paths_lower)
        if not has_spec:
            issues.append(Issue("missing_specs", "no specifications/*.md files"))

    if target_idx >= stage_index("BUILT"):
        has_code = any(p.endswith(".py") or p.endswith(".sql") for p in paths_lower)
        if not has_code:
            issues.append(Issue("missing_code", "no .py or .sql files"))
        if "resources.json" not in names_lower:
            issues.append(Issue("missing_resources_json", "no resources.json found"))

    if target_idx >= stage_index("BUNDLED") and "databricks.yml" not in names_lower:
        issues.append(Issue("missing_databricks_yml", "no databricks.yml found"))

    return issues
