"""Pinned external-tool discovery and feature preflight."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
LOCK_PATH = Path(__file__).parent / "skillforge.lock.yaml"


@dataclass(frozen=True)
class ToolchainLock:
    skillforge_repository: str
    skillforge_revision: str
    skillforge_version: str
    skillforge_executable: str
    required_features: tuple[str, ...]
    ai_dev_kit_repository: str
    ai_dev_kit_revision: str
    ai_dev_kit_skills_subdirectory: str


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str
    required: bool = True


def load_lock(path: Path = LOCK_PATH) -> ToolchainLock:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    skillforge = raw["skillforge"]
    ai_dev_kit = raw["ai_dev_kit"]
    return ToolchainLock(
        skillforge_repository=skillforge["repository"],
        skillforge_revision=skillforge["revision"],
        skillforge_version=skillforge["version"],
        skillforge_executable=skillforge["executable"],
        required_features=tuple(skillforge["required_features"]),
        ai_dev_kit_repository=ai_dev_kit["repository"],
        ai_dev_kit_revision=ai_dev_kit["revision"],
        ai_dev_kit_skills_subdirectory=ai_dev_kit["skills_subdirectory"],
    )


def find_executable(lock: ToolchainLock) -> str | None:
    override = os.environ.get("SB_EVAL_STF")
    if override:
        path = Path(override).expanduser()
        return (
            str(path.resolve()) if path.is_file() and os.access(path, os.X_OK) else None
        )
    return shutil.which(lock.skillforge_executable)


def skillforge_build_info(executable: str) -> dict[str, Any]:
    completed = subprocess.run(
        [executable, "build-info", "--json"],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(
            "pinned SkillForge must support `stf build-info --json`: " + detail
        )
    try:
        info = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("SkillForge build-info did not return JSON") from exc
    if not isinstance(info, dict):
        raise RuntimeError("SkillForge build-info JSON must be an object")
    return info


def resolve_ai_dev_kit(repo_root: Path = REPO_ROOT) -> Path | None:
    candidates = [
        os.environ.get("SB_EVAL_AI_DEV_KIT_DIR"),
        os.environ.get("AI_DEV_KIT_PATH"),
        str(repo_root / "app" / "ai_dev_kit"),
        str(repo_root.parent / "ai-dev-kit"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser().resolve()
        if path.is_dir():
            return path
    return None


def git_has_revision(repo: Path, revision: str) -> bool:
    completed = subprocess.run(
        ["git", "-C", str(repo), "cat-file", "-e", f"{revision}^{{commit}}"],
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0


def run_doctor(repo_root: Path = REPO_ROOT) -> list[Check]:
    from evaluation.cases import load_cases

    lock = load_lock()
    checks: list[Check] = []
    try:
        cases = load_cases()
        checks.append(Check("canonical-cases", True, f"{len(cases)} valid scenarios"))
    except Exception as exc:  # noqa: BLE001 - doctor aggregates failures
        checks.append(Check("canonical-cases", False, str(exc)))

    executable = find_executable(lock)
    if executable is None:
        checks.append(
            Check(
                "skillforge-executable",
                False,
                f"{lock.skillforge_executable!r} not found; install revision {lock.skillforge_revision}",
            )
        )
    else:
        checks.append(Check("skillforge-executable", True, executable))
        try:
            info = skillforge_build_info(executable)
            version_ok = info.get("version") == lock.skillforge_version
            revision_ok = info.get("revision") == lock.skillforge_revision
            features = set(info.get("features") or [])
            missing = sorted(set(lock.required_features) - features)
            checks.extend(
                [
                    Check(
                        "skillforge-version",
                        version_ok,
                        f"expected {lock.skillforge_version}, got {info.get('version')}",
                    ),
                    Check(
                        "skillforge-revision",
                        revision_ok,
                        f"expected {lock.skillforge_revision}, got {info.get('revision')}",
                    ),
                    Check(
                        "skillforge-features",
                        not missing,
                        "all required features present"
                        if not missing
                        else f"missing: {', '.join(missing)}",
                    ),
                ]
            )
        except Exception as exc:  # noqa: BLE001
            checks.append(Check("skillforge-build-info", False, str(exc)))

    ai_dev_kit = resolve_ai_dev_kit(repo_root)
    if ai_dev_kit is None:
        checks.append(
            Check(
                "ai-dev-kit",
                False,
                "checkout not found; set SB_EVAL_AI_DEV_KIT_DIR",
            )
        )
    elif os.environ.get("SB_EVAL_ALLOW_UNPINNED_FIXTURE") == "test-only":
        checks.append(Check("ai-dev-kit", True, f"test-only fixture: {ai_dev_kit}"))
    else:
        has_revision = git_has_revision(ai_dev_kit, lock.ai_dev_kit_revision)
        checks.append(
            Check(
                "ai-dev-kit",
                has_revision,
                f"{ai_dev_kit} contains pinned revision {lock.ai_dev_kit_revision}"
                if has_revision
                else f"{ai_dev_kit} does not contain {lock.ai_dev_kit_revision}",
            )
        )
    return checks
