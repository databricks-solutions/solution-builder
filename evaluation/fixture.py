"""Build isolated project fixtures from the target and pinned sibling skills."""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path

from evaluation.toolchain import (
    REPO_ROOT,
    ToolchainLock,
    load_lock,
    resolve_ai_dev_kit,
)


EXCLUDED_AI_DEV_KIT_SKILLS = frozenset({"TEMPLATE"})
COPY_IGNORE = shutil.ignore_patterns(
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "dist",
    "eval",
    "test-runs",
)


@dataclass(frozen=True)
class ProjectFixture:
    root: Path
    project_dir: Path
    target_skill: Path
    control_skill: Path
    skills_dir: Path


class FixtureError(RuntimeError):
    pass


def _extract_pinned_skills(
    checkout: Path,
    lock: ToolchainLock,
    destination: Path,
) -> Path:
    if os.environ.get("SB_EVAL_ALLOW_UNPINNED_FIXTURE") == "test-only":
        source = checkout / lock.ai_dev_kit_skills_subdirectory
        if not source.is_dir():
            raise FixtureError(f"test fixture has no skills directory: {source}")
        shutil.copytree(source, destination / lock.ai_dev_kit_skills_subdirectory)
        return destination / lock.ai_dev_kit_skills_subdirectory

    completed = subprocess.run(
        [
            "git",
            "-C",
            str(checkout),
            "archive",
            "--format=tar",
            lock.ai_dev_kit_revision,
            lock.ai_dev_kit_skills_subdirectory,
        ],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise FixtureError(
            f"cannot materialize ai-dev-kit revision {lock.ai_dev_kit_revision}: "
            + completed.stderr.decode("utf-8", errors="replace")
        )
    with tarfile.open(fileobj=io.BytesIO(completed.stdout), mode="r:") as archive:
        archive.extractall(destination, filter="data")
    return destination / lock.ai_dev_kit_skills_subdirectory


def build_fixture(
    destination: Path,
    *,
    repo_root: Path = REPO_ROOT,
    lock: ToolchainLock | None = None,
) -> ProjectFixture:
    lock = lock or load_lock()
    target_source = repo_root / ".claude" / "skills" / "databricks-demo-generator"
    if not (target_source / "SKILL.md").is_file():
        raise FixtureError(f"target skill not found: {target_source}")
    ai_dev_kit = resolve_ai_dev_kit(repo_root)
    if ai_dev_kit is None:
        raise FixtureError("ai-dev-kit checkout not found; set SB_EVAL_AI_DEV_KIT_DIR")

    project_dir = destination / "project"
    skills_dir = project_dir / ".claude" / "skills"
    skills_dir.mkdir(parents=True, exist_ok=False)
    target_skill = skills_dir / "databricks-demo-generator"
    shutil.copytree(target_source, target_skill, ignore=COPY_IGNORE)

    extracted = destination / ".ai-dev-kit-pinned"
    extracted.mkdir()
    sibling_skills = _extract_pinned_skills(ai_dev_kit, lock, extracted)
    for source in sorted(sibling_skills.iterdir()):
        if (
            not source.is_dir()
            or source.name in EXCLUDED_AI_DEV_KIT_SKILLS
            or not (source / "SKILL.md").is_file()
        ):
            continue
        shutil.copytree(source, skills_dir / source.name, ignore=COPY_IGNORE)
    shutil.rmtree(extracted)

    control_skill = skills_dir / "solution-builder-without-skill"
    control_skill.mkdir()
    (control_skill / "SKILL.md").write_text(
        "---\n"
        "name: solution-builder-without-skill\n"
        "description: Neutral control for WITH/WITHOUT evaluation.\n"
        "---\n\n"
        "Complete the user's task using general reasoning. Do not claim access "
        "to the databricks-demo-generator workflow.\n",
        encoding="utf-8",
    )
    (project_dir / "CLAUDE.md").write_text(
        "# Evaluation fixture\n\n"
        "The execution cwd is the project root. Skills are under "
        "`.claude/skills/`. In live runs, every resource must use the "
        "`SB_EVAL_*` namespace supplied in the environment and must be "
        "recorded in resources.json.\n",
        encoding="utf-8",
    )
    return ProjectFixture(
        root=destination,
        project_dir=project_dir,
        target_skill=target_skill,
        control_skill=control_skill,
        skills_dir=skills_dir,
    )
