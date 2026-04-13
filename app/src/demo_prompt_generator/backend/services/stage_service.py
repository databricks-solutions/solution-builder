"""Stage validation service for the project build pipeline.

Checks file-based gates to determine whether a project can advance
to the next lifecycle stage.

Stages: DRAFTING → SUMMARIZED → ARCHITECTED → BUILDING → PACKAGED → BUNDLED
"""

from __future__ import annotations

import json
import re
import zlib

from sqlmodel import Session, select

from ..models import (
    ProjectFile,
    ProjectStage,
    ProjectStageStatus,
    StageCheck,
)

# Ordered list of stages for progression logic
_STAGE_ORDER: list[str] = [s.value for s in ProjectStage]

# Minimum README length to count as a real summary (not a placeholder)
_MIN_README_CHARS = 200


def next_stage(current: str) -> str | None:
    """Return the stage after *current*, or None if at the end."""
    try:
        idx = _STAGE_ORDER.index(current)
    except ValueError:
        return None
    if idx + 1 < len(_STAGE_ORDER):
        return _STAGE_ORDER[idx + 1]
    return None


def get_stage_status(
    project_id: str,
    current_stage: str,
    session: Session,
) -> ProjectStageStatus:
    """Evaluate the gate checks for the current stage and return status."""

    checks: list[StageCheck] = []

    if current_stage == ProjectStage.DRAFTING.value:
        checks = _check_drafting_gate(project_id, session)
    elif current_stage == ProjectStage.SUMMARIZED.value:
        checks = _check_summarized_gate(project_id, session)
    elif current_stage == ProjectStage.ARCHITECTED.value:
        checks = _check_architected_gate(project_id, session)
    elif current_stage == ProjectStage.BUILDING.value:
        checks = _check_building_gate(project_id, session)
    elif current_stage == ProjectStage.PACKAGED.value:
        checks = _check_packaged_gate(project_id, session)
    # BUNDLED is terminal — no further checks

    can_advance = all(c.passed for c in checks) and len(checks) > 0
    nxt = next_stage(current_stage)

    return ProjectStageStatus(
        current_stage=current_stage,
        checks=checks,
        can_advance=can_advance,
        next_stage=nxt if can_advance else None,
    )


def auto_detect_stage(project_id: str, session: Session) -> str:
    """Detect the furthest-reached stage based on file state.

    Used when loading existing projects that were created before the
    stage field was added (they all default to DRAFTING).
    """
    files = _file_map(project_id, session)

    # Check from the most advanced stage backwards
    if _has_valid_dab(files):
        return ProjectStage.BUNDLED.value
    if _has_instruction_files(files):
        return ProjectStage.PACKAGED.value
    if _has_valid_architecture(files):
        return ProjectStage.ARCHITECTED.value
    if _has_meaningful_readme(files):
        return ProjectStage.SUMMARIZED.value

    return ProjectStage.DRAFTING.value


# ---------------------------------------------------------------------------
# Gate checks per stage
# ---------------------------------------------------------------------------


def _check_drafting_gate(project_id: str, session: Session) -> list[StageCheck]:
    """Gate: DRAFTING → SUMMARIZED.  README.md must exist with real content."""
    files = _file_map(project_id, session)
    readme_content = _read_file(files, "README.md")

    has_readme = readme_content is not None
    is_substantial = has_readme and len(readme_content) >= _MIN_README_CHARS

    checks = [
        StageCheck(
            label="README.md exists",
            passed=has_readme,
            detail=None if has_readme else "Chat with the agent to create your demo story",
        ),
        StageCheck(
            label=f"README has substantive content (>{_MIN_README_CHARS} chars)",
            passed=is_substantial,
            detail=(
                f"Currently {len(readme_content)} characters"
                if has_readme and not is_substantial
                else None
            ),
        ),
    ]
    return checks


def _check_summarized_gate(project_id: str, session: Session) -> list[StageCheck]:
    """Gate: SUMMARIZED → ARCHITECTED.  architecture.md must exist with valid schema."""
    files = _file_map(project_id, session)
    arch_content = _read_file(files, "architecture.md")

    has_arch = arch_content is not None
    has_valid_json = False
    detail = None

    if has_arch:
        # Architecture file should contain a JSON code block with the column-based schema:
        # { "name": "...", "columns": [{ "nodes": [...] }], "edges": [...] }
        json_match = re.search(r"```json\s*(.*?)\s*```", arch_content, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                has_valid_json = _is_valid_architecture_json(data)
                if not has_valid_json:
                    detail = "Architecture JSON must have 'columns' with nodes"
            except (json.JSONDecodeError, AttributeError):
                detail = "Architecture contains invalid JSON"
        else:
            # Some architectures may be the raw JSON (no code fence)
            try:
                data = json.loads(arch_content.strip())
                has_valid_json = _is_valid_architecture_json(data)
                if not has_valid_json:
                    detail = "Architecture JSON must have 'columns' with nodes"
            except (json.JSONDecodeError, ValueError):
                detail = "No valid JSON found in architecture.md"

    checks = [
        StageCheck(
            label="architecture.md exists",
            passed=has_arch,
            detail=None if has_arch else "Create the architecture diagram",
        ),
        StageCheck(
            label="Architecture has valid diagram schema",
            passed=has_valid_json,
            detail=detail,
        ),
    ]
    return checks


def _check_architected_gate(project_id: str, session: Session) -> list[StageCheck]:
    """Gate: ARCHITECTED → BUILDING.  Just needs user confirmation (always passable)."""
    return [
        StageCheck(
            label="Summary and architecture verified",
            passed=True,
            detail="Ready to build the full demo package",
        ),
    ]


def _check_building_gate(project_id: str, session: Session) -> list[StageCheck]:
    """Gate: BUILDING → PACKAGED.  Instruction files must be generated."""
    files = _file_map(project_id, session)
    has_instructions = _has_instruction_files(files)
    meta_content = _read_file(files, "META-PROMPT.md")
    has_meta = meta_content is not None and len(meta_content) > 100

    checks = [
        StageCheck(
            label="Instruction files generated",
            passed=has_instructions,
            detail=None if has_instructions else "Agent is generating instruction files...",
        ),
        StageCheck(
            label="META-PROMPT.md created",
            passed=has_meta,
            detail=None if has_meta else "Waiting for META-PROMPT.md generation",
        ),
    ]
    return checks


def _check_packaged_gate(project_id: str, session: Session) -> list[StageCheck]:
    """Gate: PACKAGED → BUNDLED.  DAB files must be created and valid."""
    files = _file_map(project_id, session)
    dab_content = _read_file(files, "databricks.yml")

    has_dab = dab_content is not None
    has_bundle = has_dab and bool(re.search(r"^bundle:", dab_content, re.MULTILINE))
    has_targets = has_dab and bool(re.search(r"^targets:", dab_content, re.MULTILINE))
    has_resources = any(p.startswith("resources/") and p.endswith(".yml") for p in files)

    checks = [
        StageCheck(
            label="databricks.yml exists",
            passed=has_dab,
            detail=None if has_dab else "Package the project as a DAB",
        ),
        StageCheck(
            label="Bundle configuration valid",
            passed=has_bundle and has_targets,
            detail=(
                None
                if has_bundle and has_targets
                else "databricks.yml missing required sections"
            ),
        ),
        StageCheck(
            label="Resource YAML files created",
            passed=has_resources,
            detail=None if has_resources else "No resources/*.yml files found",
        ),
    ]
    return checks


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------


def _file_map(project_id: str, session: Session) -> dict[str, ProjectFile]:
    """Return {relative_path: ProjectFile} for a project."""
    rows = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    ).all()
    return {f.relative_path: f for f in rows}


def _read_file(files: dict[str, ProjectFile], path: str) -> str | None:
    """Decompress and read a file's content, or None if missing."""
    pf = files.get(path)
    if not pf:
        return None
    try:
        return zlib.decompress(pf.content_compressed).decode("utf-8")
    except Exception:
        return None


def _has_meaningful_readme(files: dict[str, ProjectFile]) -> bool:
    content = _read_file(files, "README.md")
    return content is not None and len(content) >= _MIN_README_CHARS


def _is_valid_architecture_json(data: dict) -> bool:
    """Check whether parsed JSON matches the architecture column-based schema.

    Accepts both formats:
    - Column-based: { "columns": [{ "nodes": [...] }], "edges": [...] }
    - Legacy flat: { "nodes": [...], "edges": [...] }
    """
    if not isinstance(data, dict):
        return False

    # Column-based schema (primary format)
    columns = data.get("columns")
    if isinstance(columns, list) and len(columns) > 0:
        # At least one column must have nodes
        return any(
            isinstance(col.get("nodes"), list) and len(col["nodes"]) > 0
            for col in columns
            if isinstance(col, dict)
        )

    # Legacy flat format
    nodes = data.get("nodes")
    return isinstance(nodes, list) and len(nodes) > 0


def _has_valid_architecture(files: dict[str, ProjectFile]) -> bool:
    content = _read_file(files, "architecture.md")
    if not content:
        return False
    # Try code-fenced JSON first
    match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
    json_str = match.group(1) if match else content.strip()
    try:
        data = json.loads(json_str)
        return _is_valid_architecture_json(data)
    except (json.JSONDecodeError, AttributeError):
        return False


def _has_instruction_files(files: dict[str, ProjectFile]) -> bool:
    return any(p.startswith("instructions/") for p in files)


def _has_valid_dab(files: dict[str, ProjectFile]) -> bool:
    content = _read_file(files, "databricks.yml")
    if not content:
        return False
    return bool(re.search(r"^bundle:", content, re.MULTILINE))
