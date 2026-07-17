"""Stable content identity for complete distributed skills."""

from __future__ import annotations

import hashlib
from pathlib import Path


EXCLUDED_PARTS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "node_modules",
        "dist",
        "build",
        "eval",
        "test-runs",
        "playwright-report",
        "test-results",
    }
)


def distributed_skill_files(skill_dir: Path) -> list[Path]:
    """Return every distributed regular file in stable relative-path order."""
    root = skill_dir.resolve()
    if not (root / "SKILL.md").is_file():
        raise ValueError(f"not a skill directory: {root}")
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if path.is_symlink():
            continue
        files.append(path)
    return sorted(files, key=lambda path: path.relative_to(root).as_posix())


def hash_skill(skill_dir: Path) -> str:
    """Hash relative paths and bytes for every distributed skill file."""
    root = skill_dir.resolve()
    digest = hashlib.sha256()
    for path in distributed_skill_files(root):
        relative = path.relative_to(root).as_posix().encode("utf-8")
        payload = path.read_bytes()
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()
