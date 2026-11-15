"""Bring a project's built POV deck up to the current kit patches, in place.

The kit patches (`.claude/skills/databricks-solution-builder/references/html-it-kit-patches/`) change html-it's
template, so only a deck built after a patch had it. A deck built before kept the old behavior until someone clicked
Regenerate, which runs the agent for about 12 minutes and drops the deck's Deck tab edits. Morgan saw exactly that on
staging (2026-11-06: "I don't see the staging changes that I've asked for").

The patches are text swaps on html-it's shell, and a built deck carries that shell unchanged, so the same swaps apply
to the built files: `pov_deck.html`, `pov_deck_presenter.html`, `sa_runbook.html`. Deck tab edits change the built HTML
in other places, so they stay. Each patch runs on a copy and is skipped when it does not match (a deck from a much older
kit); files are replaced only when they changed. A stamp of the patch sources in `deck/` makes the check one small file
read on every later load.
"""
from __future__ import annotations

import hashlib
import importlib.util
import logging
import shutil
import tempfile
import threading
from pathlib import Path
from types import ModuleType

from .skills_manager import get_demo_generator_skill_path

logger = logging.getLogger(__name__)

STAMP_FILE = ".kit-patches-stamp"
# The order matters: host_toolbar's first version upgrades to its second before the others run.
PATCHES = ("host_toolbar", "presenter_link", "export_names", "click_select", "rail_hover")

_lock = threading.Lock()
_project_locks: dict[str, threading.Lock] = {}
_loaded: tuple[str, list[ModuleType]] | None = None


def _patch_dir() -> Path | None:
    skill = get_demo_generator_skill_path()
    if skill is None:
        return None
    d = skill / "references" / "html-it-kit-patches"
    return d if d.is_dir() else None


def _patches() -> tuple[str, list[ModuleType]] | None:
    """The patch modules and a stamp of their sources, loaded once per process."""
    global _loaded
    if _loaded is not None:
        return _loaded
    d = _patch_dir()
    if d is None:
        return None
    digest = hashlib.sha256()
    modules = []
    for name in PATCHES:
        path = d / f"{name}.py"
        digest.update(name.encode() + b"\0" + path.read_bytes())
        spec = importlib.util.spec_from_file_location(f"sb_kit_patch_{name}", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    _loaded = (digest.hexdigest(), modules)
    return _loaded


def upgrade_built_deck(project_dir: Path) -> bool:
    """Apply the current kit patches to the project's built deck files once. Returns True when a file changed.
    Never raises: a deck it cannot upgrade is served as built."""
    deck_dir = project_dir / "deck"
    if not deck_dir.is_dir():
        return False
    loaded = _patches()
    if loaded is None:
        return False
    stamp, modules = loaded
    stamp_path = deck_dir / STAMP_FILE
    try:
        if stamp_path.read_text().strip() == stamp:
            return False
    except OSError:
        pass
    with _lock:
        project_lock = _project_locks.setdefault(str(project_dir), threading.Lock())
    with project_lock:
        try:
            if stamp_path.read_text().strip() == stamp:
                return False
        except OSError:
            pass
        files = sorted(deck_dir.glob("*.html"))
        if not files:
            return False
        changed = False
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for f in files:
                shutil.copy2(f, work / f.name)
            for name, module in zip(PATCHES, modules):
                try:
                    module.patch(work)
                except Exception as e:  # noqa: BLE001 - an older deck's shell may not match one patch
                    logger.info(f"[deck-upgrade] {project_dir.name}: {name} skipped: {e}")
            for f in files:
                new = (work / f.name).read_text()
                if new != f.read_text():
                    f.write_text(new)
                    changed = True
        try:
            stamp_path.write_text(stamp + "\n")
        except OSError as e:
            logger.warning(f"[deck-upgrade] {project_dir.name}: could not write the stamp: {e}")
        if changed:
            logger.info(f"[deck-upgrade] {project_dir.name}: built deck upgraded to the current kit patches")
        return changed
