"""Keep pinned SkillForge run state inside the adapter-owned transient home."""

from __future__ import annotations

import os
from pathlib import Path


def _patch_skillforge_run_roots() -> None:
    home = os.environ.get("SKILLFORGE_HOME", "").strip()
    if not home:
        return
    try:
        from skillforge.eval import run_isolation, unified_runner
    except ImportError:
        return
    runs = Path(home) / "runs"
    run_isolation._SKILLFORGE_RUNS = runs
    unified_runner._SKILLFORGE_RUNS = runs


_patch_skillforge_run_roots()
