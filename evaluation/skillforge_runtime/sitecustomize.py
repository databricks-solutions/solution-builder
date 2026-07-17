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
    # The pinned revision's legacy workspace loader does not honor
    # SKILLFORGE_HOME and otherwise reads ~/.skillforge/config.yaml. Point it
    # at the same transient config used by skillforge.config.get_config().
    try:
        from skillforge.databricks import auth
    except ImportError:
        return
    config_root = Path(home)
    auth._SF_CONFIG_DIR = config_root
    auth._SF_CONFIG_PATH = config_root / "config.yaml"


_patch_skillforge_run_roots()
