"""Project files endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from fastapi import HTTPException, Request, Response

if TYPE_CHECKING:
    from databricks.sdk import WorkspaceClient
from fastapi.responses import FileResponse
from sqlmodel import select

from ..core import Dependencies, create_router
from ..core.auth import (
    detect_mode,
    request_user_pat,
    resolve_host,
    write_project_auth_file,
    write_project_databrickscfg,
)
# Cross-workspace ("scale") deploy — probe, per-project target, ownership
# reconcile — lives in the OPTIONAL remote_deploy/ module. Tolerant imports so a
# generic build (module excluded) still boots; the deploy + resource-link paths
# then stay same-workspace and skip the ownership reconcile.
try:
    from ..remote_deploy import (
        user_target as _user_target,
        probe as _target_probe,
        ownership_reconcile as _ownership_reconcile,
    )
except ImportError:
    _user_target = None
    _target_probe = None
    _ownership_reconcile = None
from ..models import (
    ArchitectureSnapshotResult,
    ArchitectureSnapshotWrite,
    DeployedResourceLink,
    DeployedResourcesOut,
    Project,
    ProjectFile,
    ProjectFileContent,
    ProjectFileOut,
    ProjectFileWrite,
    capability_build_status,
    compute_project_stage,
    merge_project_stage,
)
from ..services.cpu_pool import run_cpu
from ..services.file_sync import FileSyncService, decompress_content
from ..services.zip_builders import (  # noqa: F401 — re-exported for callers/tests
    WORKSHOP_HTML_PATH,
    _is_excluded_from_sync,
    _is_excluded_path,
    _is_hidden_from_listing,
    _kit_slug,
    _project_slug,
    build_project_zip,
    ZIP_TIMEOUT_S,
    build_workshop_kit_zip,
)
from .projects import (
    ACCESS_VIEWER,
    _get_authorized_project,
    _get_project_access,
    _project_is_streaming,
    _require_write_access,
    claim_driver,
    is_driver,
)

logger = logging.getLogger(__name__)
router = create_router()

PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")
# Resolved once at import — used on hot paths (cache, watcher events).
_PROJECTS_BASE_RESOLVED = Path(PROJECTS_BASE_DIR).resolve()



# ---------------------------------------------------------------------------
# In-memory file listing cache
#
# Keyed by project_id. Each entry is a dict[relative_path → file dict].
# Reads convert the dict to a sorted list.
#
# Invalidation:
# - First read for a project: full walk populates the cache.
# - Any watcher event: `cache_resync_dir` re-lists the parent directory from
#   disk and replaces that dir's slice of the cache. This handles
#   create/modify/delete/move uniformly: whatever disk shows wins.
# - `?force=true` query param: evicts the entry, next read rebuilds.
#
# Why a directory resync (not single-path stat): atomic writes briefly leave
# the destination path nonexistent (rename window). A single re-stat in that
# window returns ENOENT and would wrongly drop the entry. Re-listing the
# directory is robust — by the time we read it, the rename has settled and
# disk reflects truth.
# ---------------------------------------------------------------------------

_file_cache: dict[str, dict[str, dict]] = {}
_cache_lock = threading.RLock()

# Per-project restore locks. After a redeploy, project_dir is empty and any
# request that touches it (GET /projects/<id>, GET /projects/<id>/files,
# GET /projects/<id>/download) needs to restore from DB. The frontend fires
# several of these in parallel (Promise.all in the route loader), so without
# a lock two requests both decide to restore, and whichever one populates
# the file cache while the other is still mid-write captures a partial
# snapshot. The lock makes the first request do the restore + cache evict
# atomically; the second request waits, then sees the populated dir and
# falls through. Locks are pruned when projects are deleted.
_restore_locks: dict[str, threading.Lock] = {}
_restore_locks_lock = threading.Lock()

# Projects whose on-disk folder is being torn down RIGHT NOW by the reaper /
# delete path. The file watcher's debounced flush deletes the ProjectFile DB row
# for any path missing on disk (file_sync `_sync_files_to_db_blocking`), and
# `shutil.rmtree` unlinks children before the directory — so during a rmtree the
# folder still `exists()` while individual files are already gone. Without this
# flag a flush firing mid-rmtree would delete the DURABLE DB rows we're trying to
# preserve. `_sync_files_to_db_blocking` consults `is_cleaning` and skips ALL
# delete-processing for a project in this set (covers the whole rmtree window,
# not just the fully-gone end state the folder-existence check catches).
_cleaning_projects: set[str] = set()
_cleaning_lock = threading.Lock()


def mark_cleaning(project_id: str) -> None:
    with _cleaning_lock:
        _cleaning_projects.add(project_id)


def clear_cleaning(project_id: str) -> None:
    with _cleaning_lock:
        _cleaning_projects.discard(project_id)


def is_cleaning(project_id: str) -> bool:
    with _cleaning_lock:
        return project_id in _cleaning_projects


def _get_restore_lock(project_id: str) -> threading.Lock:
    """Return (creating if missing) the restore lock for one project."""
    with _restore_locks_lock:
        lock = _restore_locks.get(project_id)
        if lock is None:
            lock = threading.Lock()
            _restore_locks[project_id] = lock
        return lock


def ensure_project_files_restored(
    project_id: str,
    project_dir: Path,
    file_sync,
    session,
) -> None:
    """Restore project files from DB if the project_dir is missing or empty,
    and ALWAYS re-ensure the .claude/skills/ tree is present.

    Two separate responsibilities, both run on every call:

    1. **Skills** are managed out-of-band (copied from the bundled
       databricks-solution-builder + DAS skills, see skills_manager).
       They live under `.claude/skills/`, which is intentionally NOT
       persisted to Lakebase — so a fresh container has none of them. We
       re-copy on every load: cheap, idempotent (the inner function noops
       when files already exist), and survives any sequence of crashes /
       partial restores.

    2. **Project files** are restored from the DB only when the project
       directory is missing or contains no user-facing files. The early-
       return check below ignores `.claude/` and other excluded-from-sync
       paths so it isn't fooled by leftover skill / auth files from a
       partial previous run — without this filter, a project that crashed
       mid-restore would never finish restoring.

    Serialized per project so concurrent route handlers don't both run
    `restore_project_from_db` and step on each other's cache. Always evicts
    the file cache after a real restore so the next listing call walks fresh
    disk state instead of returning a partial mid-restore snapshot.
    """
    with _get_restore_lock(project_id):
        # (1) Skills + auth helpers always (idempotent when already present).
        # Skills are NEVER persisted to the DB (intentional: they live in
        # the monorepo / Databricks Agent Skills (DAS) and need to track upstream changes).
        # ensure_project_skills re-copies only when `.claude/skills/` is
        # empty/missing — cheap on the hot path (just an `iterdir()` check)
        # and self-heals after a container restart where the skill tree is
        # gone but other restored files made the project_dir look populated.
        from ..services.skills_manager import ensure_project_skills
        from ..services.file_sync import ensure_fmapi_auth_files
        try:
            ensure_project_skills(project_id)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[restore] skill copy failed for {project_id}: {e}")
        try:
            ensure_fmapi_auth_files(project_dir, project_id)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[restore] fmapi auth provision failed for {project_id}: {e}")

        # (2) DB → disk restore only when no user-facing files exist locally.
        if not (project_dir.exists() and _has_user_files(project_dir)):
            logger.info(f"Project folder missing or empty, restoring from DB: {project_id}")
            file_sync.restore_project_from_db(project_id, session=session)
            cache_evict_project(project_id)

        # (3) A fork's seed live demo, refreshed after the restore so the file never
        # masks an empty folder. Covers projects forked before the fork wrote it. Once per
        # project per process: a project's seed never changes, and only the startup seeder
        # recomputes Template.live_demo, so a later call can't find anything new.
        if project_id not in _seed_live_demo_synced:
            try:
                if _sync_seed_live_demo(project_id, project_dir, session):
                    cache_evict_project(project_id)
                _seed_live_demo_synced.add(project_id)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[restore] seed live demo refresh failed for {project_id}: {e}")


# Projects whose seed live demo this process has already synced (see step 3 above).
_seed_live_demo_synced: set[str] = set()


def _sync_seed_live_demo(project_id: str, project_dir: Path, session) -> bool:
    """Bring `context/seed-live-demo.json` in line with the project's seed template
    (see services/live_demo.py). True when the file changed. Reads only the template's
    `live_demo` column, never the whole row (it carries the screenshot)."""
    from ..models import Template
    from ..services.live_demo import sync_seed_live_demo

    project = session.get(Project, project_id)
    template_id = project.source_template_id if project else None
    if not template_id or not project_dir.exists():
        return False
    live_demo = session.exec(select(Template.live_demo).where(Template.id == template_id)).first()
    return sync_seed_live_demo(project_dir, template_id, live_demo)


def _has_user_files(project_dir: Path) -> bool:
    """True iff `project_dir` contains at least one file that isn't excluded
    from sync (i.e. is a real user-visible / DB-backed file).

    Filters out the `.claude/skills/` tree, `.databrickscfg`, FMAPI auth
    helpers, etc. — any of which can survive a crash mid-restore and would
    otherwise mask a project as "already populated" when its real content
    is still in Lakebase.

    Walks lazily and short-circuits on the first non-excluded match.
    """
    if not project_dir.exists():
        return False
    for root, dirs, files in os.walk(project_dir):
        root_path = Path(root)
        # Prune bulky / excluded dirs so we don't descend into node_modules etc.
        kept = []
        for d in dirs:
            child_rel = (root_path / d).relative_to(project_dir)
            if _is_excluded_from_sync(child_rel):
                continue
            kept.append(d)
        dirs[:] = kept
        for fname in files:
            rel = (root_path / fname).relative_to(project_dir)
            if _is_excluded_from_sync(rel):
                continue
            return True
    return False


def _make_file_entry(project_dir: Path, file_path: Path) -> dict | None:
    """Build a file entry dict from an absolute path, or None if ignored/missing."""
    try:
        rel_path = file_path.relative_to(project_dir)
    except ValueError:
        return None
    # Path-aware exclusion so .claude/projects/** is kept (transcripts) while
    # the rest of .claude/ is filtered.
    if _is_excluded_path(rel_path):
        return None
    try:
        stat = file_path.stat()
    except OSError:
        return None
    return {
        "path": str(rel_path),
        "name": file_path.name,
        "size": stat.st_size,
        "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "is_hidden": False,
    }


# Heavyweight directories we NEVER want to walk into even when "show
# hidden" is on (would walk thousands of files). Different from
# `_is_excluded_segment` which mixes truly-hidden-but-cheap entries
# (.databrickscfg) with truly-bulky entries (node_modules) — for the
# debug listing we want to see the cheap ones.
_HIDDEN_WALK_PRUNE_DIRS = {
    "node_modules",
    "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache",
    "dist", "build", ".next", ".turbo", ".parcel-cache", "__dist__",
    ".git",
}


def _is_bulky_dir(segment: str) -> bool:
    if segment in _HIDDEN_WALK_PRUNE_DIRS:
        return True
    # .venv*, venv*  — language virtualenvs that explode the listing.
    if segment.startswith(".venv") or (
        segment.startswith("venv") and (segment == "venv" or segment.startswith("venv-") or segment.startswith("venv."))
    ):
        return True
    return False


def _build_listing_with_hidden(project_dir: Path) -> list[dict]:
    """Walk the project directory once for the debug "show all files" view.

    Includes files normally filtered by `_is_excluded_segment` (e.g.
    `.databrickscfg`, `.claude/skills/...`, hidden tempfiles) so users
    can troubleshoot deployed-mode auth (the on-disk `.databrickscfg` IS
    the user's PAT proxy in deployed mode — see backend/AUTH.md).

    Skips bulky language artifact dirs (node_modules, .venv*, dist/) —
    walking those would return tens of thousands of paths and freeze the
    UI. Hidden walk does NOT touch the in-memory cache; the cache stays
    domain-filtered for the hot path.

    Each entry carries `is_hidden=True` if the standard listing would
    have filtered it out, so the UI can badge / sort accordingly.
    """
    entries: list[dict] = []
    if not project_dir.exists():
        return entries
    for root, dirs, filenames in os.walk(project_dir):
        dirs[:] = [d for d in dirs if not _is_bulky_dir(d)]
        root_path = Path(root)
        for name in filenames:
            file_path = root_path / name
            try:
                rel_path = file_path.relative_to(project_dir)
            except ValueError:
                continue
            try:
                stat = file_path.stat()
            except OSError:
                continue
            # Mark as hidden if the standard filter would have dropped it.
            # Path-aware so .claude/projects/** (transcripts, kept) isn't
            # mis-flagged as hidden even though .claude/ is normally hidden.
            is_hidden = _is_excluded_path(rel_path)
            entries.append({
                "path": str(rel_path),
                "name": name,
                "size": stat.st_size,
                "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "is_hidden": is_hidden,
            })
    return sorted(entries, key=lambda f: f["path"])


def _build_cache_from_walk(project_id: str, project_dir: Path) -> dict[str, dict]:
    """Walk the filesystem once and build the cache dict."""
    entries: dict[str, dict] = {}
    if not project_dir.exists():
        return entries
    for root, dirs, filenames in os.walk(project_dir):
        root_path = Path(root)
        # Prune sub-dirs using full relative paths so we can keep
        # .claude/projects/** while still skipping .claude/skills/ etc.
        kept_dirs = []
        for d in dirs:
            child_rel = (root_path / d).relative_to(project_dir)
            if _is_excluded_path(child_rel):
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs
        for name in filenames:
            entry = _make_file_entry(project_dir, root_path / name)
            if entry is not None:
                entries[entry["path"]] = entry
    return entries


def _get_cached_files(project_id: str, project_dir: Path, force: bool = False) -> list[dict]:
    """Return the sorted file list for a project, rebuilding the cache if needed.

    We release the lock while doing the initial `os.walk` so concurrent readers
    don't serialize on a slow cold-start. If two callers race on the first read,
    both will walk (idempotent) and whichever writes last wins — but both see a
    correct snapshot and neither blocks the other.
    """
    # Fast path: entry already cached.
    with _cache_lock:
        if not force:
            entries = _file_cache.get(project_id)
            if entries is not None:
                files = list(entries.values())
                logger.info(
                    f"[cache] hit {project_id} ({len(files)} files)"
                )
                return sorted(files, key=lambda f: f["path"])
        logger.info(
            f"[cache] {'force rebuild' if force else 'miss'} for {project_id}"
        )
        # else: miss or force — fall through to rebuild outside the lock.
        _file_cache.pop(project_id, None)

    # Slow path: walk outside the lock so we don't block other readers/watcher events.
    fresh = _build_cache_from_walk(project_id, project_dir)

    # Publish. If a watcher event arrived between the pop and now, its resync
    # ran against an empty cache (no-op path in cache_resync_dir when the
    # project isn't cached). The walk we just did reflects current disk state,
    # so we're consistent.
    with _cache_lock:
        _file_cache[project_id] = fresh
        files = list(fresh.values())

    return sorted(files, key=lambda f: f["path"])


def _list_dir_entries(project_dir: Path, dir_abs: Path) -> dict[str, dict]:
    """Re-list the immediate non-recursive contents of one directory from disk.

    Returns dict[relative_path → entry] for the live (non-excluded) files in
    that directory. Files inside subdirectories of `dir_abs` are NOT included
    — those have their own watcher events when they change.
    """
    entries: dict[str, dict] = {}
    if not dir_abs.is_dir():
        return entries
    try:
        children = list(dir_abs.iterdir())
    except OSError:
        return entries
    for child in children:
        if not child.is_file():
            continue
        # _make_file_entry already runs the full path-aware filter (so
        # .claude/projects/**/x.jsonl is kept while .claude/settings.json
        # is dropped). No need to re-check segment here.
        entry = _make_file_entry(project_dir, child)
        if entry is not None:
            entries[entry["path"]] = entry
    return entries


def cache_resync_dir(project_id: str, relative_path: str) -> None:
    """Watcher hook: a path under the project changed.

    Rebuilds the cache slice for the directory containing `relative_path` by
    listing it from disk (non-recursive). Any cached entry that previously
    lived in that directory but no longer exists on disk is dropped — this
    covers deletions, moves out, and atomic-replace cleanup naturally, with
    no special-casing per event type.

    No-op when the project hasn't been cached yet — the next GET /files does
    a full walk and includes everything.
    """
    project_dir = _PROJECTS_BASE_RESOLVED / project_id

    # Resolve the directory to resync. For a top-level file (no slash in
    # rel_path) the parent is the project root itself.
    rel_parent = str(Path(relative_path).parent)
    if rel_parent == ".":
        dir_abs = project_dir
        dir_prefix = ""
    else:
        dir_abs = project_dir / rel_parent
        dir_prefix = rel_parent + "/"

    # Snapshot what's on disk now (outside the lock — disk I/O shouldn't
    # block other readers / watcher events).
    live = _list_dir_entries(project_dir, dir_abs)

    with _cache_lock:
        entries = _file_cache.get(project_id)
        if entries is None:
            return

        # Drop cached entries that are immediate children of this directory,
        # then merge in what disk shows. A path is an immediate child iff it
        # starts with dir_prefix AND has no further slash beyond it.
        dropped = 0
        for cached_path in list(entries.keys()):
            if not cached_path.startswith(dir_prefix):
                continue
            if "/" in cached_path[len(dir_prefix):]:
                continue
            del entries[cached_path]
            dropped += 1
        entries.update(live)

        # Fires on every watcher event — keep at DEBUG to avoid drowning
        # prod logs. INFO when LOG_LEVEL=DEBUG.
        logger.debug(
            f"[cache] resync {project_id}/{rel_parent or '.'}: "
            f"{dropped} dropped, {len(live)} from disk (project total {len(entries)})"
        )


def cache_evict_project(project_id: str) -> None:
    """Drop the whole cache for a project (e.g. after a bulk restore from DB)."""
    with _cache_lock:
        _file_cache.pop(project_id, None)


def forget_project(project_id: str) -> None:
    """Drop ALL per-project file-route in-memory state — the file-listing cache
    AND the per-project restore lock — so neither grows one entry per project
    ever opened. Called on delete AND on the reaper's folder-cleanup (a reaped
    project's cache/lock were previously orphaned forever, an O(projects) leak).
    Lazily recreated on next access."""
    cache_evict_project(project_id)
    with _restore_locks_lock:
        _restore_locks.pop(project_id, None)


def remove_project_files_on_disk(project_id: str, *, file_sync=None) -> bool:
    """Delete a project's on-disk folder + drop its in-memory file caches,
    WITHOUT touching the database and WITHOUT the agent pool.

    The DB (Project row, Message rows, ProjectFile rows incl. the Claude session
    transcript) is the durable store; the `<PROJECTS_BASE_DIR>/<id>/` folder is a
    disposable local cache that `restore_project_from_db` rebuilds on next open.
    Shared by BOTH the explicit owner-delete (`delete_project`, which already
    removed the DB rows itself, first — passes NO file_sync so we do NOT resync)
    and the idle project-file reaper (`core/reapers.py`, which KEEPS the DB rows
    and passes `file_sync=` so we flush disk→DB first). Each caller is responsible
    for dropping the pooled SDK client (`get_client_pool().remove_client`) in its
    own sync/async context — kept out of here so this stays a plain, loop-agnostic
    sync function.

    Coordination (prevents the mid-rmtree row-deletion + restore races):
      1. `mark_cleaning` so the watcher's flush skips delete-processing for the
         whole rmtree window (see `_cleaning_projects`).
      2. Hold the per-project RESTORE lock across the flush + rmtree so a
         concurrent `restore_project_from_db` can't interleave and capture a
         half-deleted tree. (Cleanup runs on a worker thread via `to_thread`, and
         restore is threadpool too, so this threading.Lock serializes them.)
      3. If `file_sync` is given, `full_sync_project` (delete-free) flushes any
         un-synced on-disk change to the DB BEFORE rmtree — atomic with it under
         the lock+flag.

    Returns True if a folder was removed.
    """
    import shutil
    from ..services.skills_manager import get_project_directory

    removed = False
    restore_lock = _get_restore_lock(project_id)
    mark_cleaning(project_id)
    try:
        # Hold the restore lock so restore_project_from_db can't run concurrently.
        with restore_lock:
            try:
                project_dir = get_project_directory(project_id)
                if not project_dir.exists():
                    return False
                # Flush disk→DB first (reaper path only). full_sync_project never
                # deletes rows, so a delete_project caller (rows already gone) must
                # NOT pass file_sync or it would resurrect them.
                if file_sync is not None:
                    try:
                        file_sync.full_sync_project(project_id)
                    except Exception as e:  # noqa: BLE001
                        # Can't guarantee the DB is current → do NOT delete the
                        # folder this pass; retry next sweep.
                        logger.warning(
                            f"[cleanup] pre-delete sync failed for {project_id}; "
                            f"leaving folder in place: {e!r}"
                        )
                        return False
                shutil.rmtree(project_dir)
                removed = True
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"[cleanup] failed to remove project dir for {project_id}: {e}"
                )
            finally:
                cache_evict_project(project_id)
    finally:
        clear_cleaning(project_id)
        # Drop the restore lock entry only AFTER releasing it (never mid-hold —
        # popping a held lock lets a concurrent caller mint a second lock object
        # and defeats the serialization). Safe now: we're outside the `with`.
        with _restore_locks_lock:
            _restore_locks.pop(project_id, None)
    return removed


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


def _ensure_project_databrickscfg(
    project_dir: Path,
    headers,
    can_write: bool,
    *,
    config=None,
    target_workspace_host: str | None = None,
) -> bool:
    """Refresh `<project_dir>/.databrickscfg` from the current request's
    PAT. Deployed mode only — no-op locally. Returns True iff it actually wrote
    the file (so the caller can stamp the driver token-freshness clock).

    Called from any project-scoped route the user might hit when
    re-opening a project (list files, get file, deployed-resources, …).
    Without this the file lands only when /invoke_agent fires, which
    means a freshly-restored project (post-container-restart) has no
    auth file until the user sends their first chat message — and any
    `databricks` CLI call before that point fails.

    IDENTITY GUARD: `can_write` MUST be true (owner/admin/editor). A VIEWER
    (read-only share recipient) must NEVER write here — doing so would stamp
    their PAT into the OWNER's project dir, swapping the identity the agent's
    `databricks` CLI runs as. Callers pass their resolved write-access.

    Best-effort: errors are logged and swallowed so they never break
    the request.
    """
    if not can_write:
        return False  # read-only viewer — never overwrite the owner's token
    if detect_mode(headers) != "deployed":
        return False
    pat = request_user_pat(headers)
    if pat is None:
        return False
    host = resolve_host(headers)
    try:
        wrote = write_project_databrickscfg(
            project_dir,
            config=config,
            target_workspace_host=target_workspace_host,
            user_pat=pat,
            user_host=host,
        )
        if wrote is None:
            logger.warning(
                "deployed mode + PAT present but nothing written (no resolvable "
                "host / missing target creds) for project_dir %s", project_dir,
            )
            return False
        return True
    except Exception:
        logger.exception(
            "failed to write .databrickscfg for project_dir %s", project_dir,
        )
        return False


@router.get(
    "/projects/{project_id}/files",
    response_model=list[ProjectFileOut],
    operation_id="listProjectFiles",
)
def list_project_files(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
    force: bool = False,
    include_hidden: bool = False,
):
    """List all files in a project from the local filesystem.

    Default mode is served from an in-memory cache that the file watcher
    keeps in sync with the filesystem. Pass `?force=true` to evict and
    rebuild from a fresh `os.walk` (useful when the UI's Refresh button
    is clicked, or if the cache is suspect).

    Pass `?include_hidden=true` for the debug "show all files" view —
    it walks disk fresh and includes files normally filtered out
    (`.databrickscfg`, `.claude/skills/...`, hidden tempfiles) with
    `is_hidden=true`. This bypasses the cache entirely (the cache stays
    domain-filtered for the hot path) and skips bulky language artifact
    dirs (node_modules, .venv*, dist/) so it doesn't return tens of
    thousands of paths.
    """
    try:
        user_email = _get_user_email(headers)
        _project, access = _get_project_access(
            session, project_id, user_email, config.template_admin_emails
        )

        project_dir = _PROJECTS_BASE_RESOLVED / project_id

        ensure_project_files_restored(
            project_id,
            project_dir,
            request.app.state.file_sync,
            session,
        )
        # Keep <project_dir>/.databrickscfg fresh on every project open in
        # deployed mode. The agent route refreshes it again right before
        # spawning, but doing it here too means the file exists from the
        # moment the user opens a project. Only write when the caller may drive:
        # NEVER a viewer (would stamp their PAT into the owner's dir), and NEVER
        # a non-driver editor (would thrash the token the current driver's run
        # depends on and swap the CLI identity). Driver / owner-first only.
        #
        # ⚠️ HOT-PATH GUARD (2026-08 wedge fix): this block does NETWORKED
        # control-plane work — target resolution + a token/`.databrickscfg`
        # write. This SYNC endpoint runs in Starlette's shared (default-40)
        # threadpool, and the UI hammers `?force=true` after EVERY agent file
        # write (tool-completion / file_changed) during a build. Doing the
        # networked work on every one of those refreshes piled slow/hung calls
        # onto the threadpool → saturation → the app went RUNNING-but-not-serving
        # (a monitor then restarted it). A `force=true` refresh is ALWAYS a
        # post-write file-list poll (or the manual Refresh button) — it never
        # needs the token re-minted or the target re-resolved. So we SKIP the
        # control-plane work on force; the NON-force load (project open, tab
        # switch, the periodic refetch) still does the full refresh, which is the
        # only path that actually needs it. `loadProject` opens with a non-force
        # list, so a freshly-opened project always gets its `.databrickscfg`.
        if not force:
            can_refresh = access != ACCESS_VIEWER and is_driver(session, project_id, user_email)
            # Deploy target: resolve with the shared helper so this .databrickscfg
            # writer, the resource-tile resolver, and the deploy path always agree —
            # and so a later account-setting change can never repoint a project that's
            # already built. PIN on open ONLY for a driver of an already-BUILT project
            # (freezes a legacy pre-Model-3 project to its app-own host, where its
            # resources live). A brand-new empty draft is NOT pinned here — it stays
            # changeable via the home-page selector until its FIRST build (the deploy
            # path pins it then). Viewers/non-drivers never pin.
            _has_built = (
                _user_target.project_has_built_resources(
                    request.app.state.file_sync, project_id, session=session
                )
                if _user_target is not None
                else False
            )
            effective_target = (
                _user_target.resolve_and_pin_project_target(
                    project=_project,
                    user_email=user_email,
                    session=session,
                    config=config,
                    has_built_resources=_has_built,
                    can_pin=(can_refresh and _has_built),
                )
                if _user_target is not None
                else None
            )
            wrote = _ensure_project_databrickscfg(
                project_dir,
                headers,
                can_write=can_refresh,
                config=config,
                target_workspace_host=effective_target,
            )
            if wrote:
                # The driver just refreshed their token on this project open → stamp
                # the freshness clock so non-drivers know the token is current.
                claim_driver(session, project_id, user_email)

        if include_hidden:
            # Debug view — walk fresh, include hidden, do NOT cache.
            files = _build_listing_with_hidden(project_dir)
        else:
            files = _get_cached_files(project_id, project_dir, force=force)

        return [
            ProjectFileOut(
                path=f["path"],
                name=f["name"],
                size=f["size"],
                last_modified=f["last_modified"],
                synced_at=f["last_modified"],  # Use last_modified as synced_at for filesystem files
                is_hidden=f.get("is_hidden", False),
            )
            for f in files
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_project_files error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# A single-file read loads the whole file into memory (then base64s binaries).
# Viewer + brand assets are small; anything bigger is rejected instead of buffered.
MAX_FILE_READ_BYTES = 10 * 1024 * 1024


def _check_read_size(size: int | None, file_path: str) -> None:
    if size is not None and size > MAX_FILE_READ_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"'{file_path}' is {size:,} bytes; single-file reads are capped at "
                f"{MAX_FILE_READ_BYTES:,} bytes"
            ),
        )


@router.get(
    "/projects/{project_id}/files/{file_path:path}",
    response_model=ProjectFileContent,
    operation_id="getProjectFile",
)
def get_project_file(
    project_id: str,
    file_path: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
    response: Response,
):
    """Get the content of a specific file.

    Disk is the source of truth. The DB is just a backup so projects can
    be restored to disk after a container restart (see
    `ensure_project_files_restored`). Read order:
    1. Stat disk — if present, read it and stat() for size/mtime. Done.
    2. Otherwise fall through to the DB (rare: file is gitignored by the
       watcher, e.g. `.claude/skills/`, or the project hasn't been
       restored yet on this container).

    `.databrickscfg`, `.anthropic_token`, and `.claude/settings.json`
    carry secrets and are redacted before being returned.

    Perf debugging: response carries `Server-Timing` and `X-Debug-Timings`
    headers naming each phase so we can see where the wall-clock goes.
    """
    t0 = time.perf_counter()
    timings: list[tuple[str, float]] = []

    def mark(name: str) -> None:
        nonlocal t0
        t1 = time.perf_counter()
        timings.append((name, (t1 - t0) * 1000.0))
        t0 = t1

    user_email = _get_user_email(headers)
    mark("user_email")

    # Auth check — owner OR admin. Covers pool checkout + pool_pre_ping
    # SELECT 1 + the query itself on first session.exec().
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)
    mark("auth_query")

    project_dir = _PROJECTS_BASE_RESOLVED / project_id
    disk_path = (project_dir / file_path).resolve()
    # Defense in depth: refuse path-escape attempts (`..` segments).
    try:
        disk_path.relative_to(project_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")

    content: str | None = None
    file_size: int | None = None
    file_mtime: datetime | None = None

    if disk_path.is_file():
        # Hot path: serve straight from disk. No DB hit.
        try:
            _check_read_size(disk_path.stat().st_size, file_path)
            content = disk_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            import base64
            content = base64.b64encode(disk_path.read_bytes()).decode("ascii")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Read failed: {e}")
        try:
            stat = disk_path.stat()
            file_size = stat.st_size
            file_mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        except OSError:
            file_size = len(content)
        mark("disk_read")
    else:
        # Disk miss — fall back to DB. Either the project hasn't been
        # restored on this container yet, or the file is one the watcher
        # ignores by design (won't ever appear on disk). Last DB hit also
        # gets us the metadata in the same query.
        file_record = session.exec(
            select(ProjectFile)
            .where(ProjectFile.project_id == project_id)
            .where(ProjectFile.relative_path == file_path)
        ).first()
        mark("db_fallback_query")
        if file_record is None:
            raise HTTPException(status_code=404, detail="File not found")
        _check_read_size(file_record.file_size, file_path)
        try:
            raw = decompress_content(file_record.content_compressed)
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            import base64
            content = base64.b64encode(raw).decode("ascii")
        except Exception as e:
            logger.error(f"Failed to decompress {file_path}: {e}")
            raise HTTPException(status_code=500, detail="Failed to decompress file")
        file_size = file_record.file_size
        file_mtime = file_record.last_modified
        mark("db_fallback_decode")

    # Redact secrets. `.databrickscfg` keeps its non-secret keys (host, client_id)
    # so the file is still recognizable, but blanks any SECRET-bearing line: `token`
    # (OBO/PAT mode) AND `client_secret` (the deployer-SP OAuth secret in the
    # cross-workspace remote-deploy path — see remote_deploy/auth.py). Both are
    # written per-project; without this the SP client_secret was visible in the
    # in-app file viewer. Case-insensitive key match; the other two files below are
    # wholesale-redacted (entire body sensitive). See backend/AUTH.md,
    # backend/core/fmapi_auth.py.
    _SECRET_CFG_KEYS = ("token", "client_secret", "password")
    basename = Path(file_path).name
    if basename == ".databrickscfg" or basename.startswith(".databrickscfg."):
        redacted_lines: list[str] = []
        for line in content.splitlines():
            key = line.split("=", 1)[0].strip().lower() if "=" in line else ""
            if key in _SECRET_CFG_KEYS:
                redacted_lines.append(
                    line.split("=", 1)[0] + "= [REDACTED — see backend/AUTH.md]"
                )
            else:
                redacted_lines.append(line)
        content = "\n".join(redacted_lines)
    elif basename == ".anthropic_token" or basename.startswith(".anthropic_token."):
        content = "[REDACTED — see backend/core/fmapi_auth.py]"
    elif basename == "settings.json" and ".claude/" in file_path:
        content = "[REDACTED apiKeyHelper path — see backend/core/fmapi_auth.py]"
    mark("redact")

    total_ms = sum(d for _, d in timings)
    response.headers["Server-Timing"] = ", ".join(
        f"{name};dur={dur:.1f}" for name, dur in timings
    ) + f", total;dur={total_ms:.1f}"
    response.headers["X-Debug-Timings"] = json.dumps(
        {"steps": [{"name": n, "ms": round(d, 1)} for n, d in timings],
         "total_ms": round(total_ms, 1)}
    )

    return ProjectFileContent(
        path=file_path,
        content=content,
        size=file_size if file_size is not None else len(content),
        last_modified=file_mtime,
    )



@router.put(
    "/projects/{project_id}/files/{file_path:path}",
    response_model=ProjectFileContent,
    operation_id="saveProjectFile",
)
def save_project_file(
    project_id: str,
    file_path: str,
    body: ProjectFileWrite,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Write text content to a project file (disk is source of truth; the
    file-watcher syncs it to the DB).

    Used by the interactive architecture canvas to persist node positions +
    edges back into `architecture.md` on drag/drop. Locked down: owner/admin
    auth, path-escape guard, and an allowlist of writable files so this can't
    be used to clobber auth files or arbitrary code.
    """
    user_email = _get_user_email(headers)
    _require_write_access(
        session, project_id, user_email, config.template_admin_emails
    )

    project_dir = _PROJECTS_BASE_RESOLVED / project_id
    disk_path = (project_dir / file_path).resolve()
    try:
        disk_path.relative_to(project_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")

    # Allowlist: only files the UI is meant to edit. Keeps this endpoint from
    # becoming a general-purpose write primitive (no .databrickscfg, no code).
    WRITABLE = {"architecture.md"}
    basename = Path(file_path).name
    if basename not in WRITABLE:
        raise HTTPException(
            status_code=403,
            detail=f"File '{basename}' is not writable via this endpoint",
        )

    try:
        disk_path.parent.mkdir(parents=True, exist_ok=True)
        disk_path.write_text(body.content, encoding="utf-8")
        stat = disk_path.stat()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Write failed: {e}")

    # Record a versioned architecture-history snapshot (5-min debounced). Best-
    # effort — a history failure must never block the save.
    if basename == "architecture.md":
        try:
            from ..services.architecture_history import record_architecture_history
            record_architecture_history(session, project_id, body.content)
        except Exception:
            logger.warning("architecture-history snapshot failed (save route)", exc_info=True)

    # Live collab: record this content as the room's known hash so the resulting
    # file-watcher event is recognized as the writer's OWN save (echo) and not
    # mis-broadcast as an agent takeover. Harmless when no room exists.
    if basename == "architecture.md":
        try:
            from ..services.collab import get_collab_hub
            get_collab_hub().note_saved(project_id, body.content)
        except Exception:
            pass

    return ProjectFileContent(
        path=file_path,
        content=body.content,
        size=stat.st_size,
        last_modified=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


@router.put(
    "/projects/{project_id}/architecture-snapshot",
    response_model=ArchitectureSnapshotResult,
    operation_id="saveArchitectureSnapshot",
)
def save_architecture_snapshot(
    project_id: str,
    body: ArchitectureSnapshotWrite,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Persist a PNG snapshot of the live architecture canvas as
    `architecture.png` in the project dir.

    The open browser tab captures the rendered ReactFlow canvas (via
    html-to-image) after each save and POSTs the data-URL here — so the agent
    can READ a rendered image of the diagram it just authored, without any
    headless browser in the container. Best-effort: if no tab is open, this
    simply never fires and `architecture.png` stays at its last capture.
    """
    import base64

    user_email = _get_user_email(headers)
    _require_write_access(
        session, project_id, user_email, config.template_admin_emails
    )

    # Accept a `data:image/png;base64,...` URL (or bare base64) and decode it.
    data_url = body.data_url
    if "," in data_url and data_url.strip().startswith("data:"):
        header, _, b64 = data_url.partition(",")
        if "image/png" not in header:
            raise HTTPException(status_code=400, detail="Snapshot must be image/png")
    else:
        b64 = data_url
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")
    # Guard against absurd payloads (a big 2x diagram is well under this).
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Snapshot too large")

    project_dir = _PROJECTS_BASE_RESOLVED / project_id
    disk_path = project_dir / "architecture.png"
    try:
        disk_path.parent.mkdir(parents=True, exist_ok=True)
        disk_path.write_bytes(raw)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Write failed: {e}")

    return ArchitectureSnapshotResult(path="architecture.png", size=len(raw))


DECK_DIR = "deck"


def resolve_deck_file(project_dir: Path, file_path: str) -> Path | None:
    """Return the file under `<project>/deck/` that `file_path` names, or None.

    The POV deck (stages/pov-deck.md) is a set of linked HTML files: the deck opens
    its presenter view by relative URL, so the files must be served as real pages,
    not as the JSON the file viewer reads. Only files inside `deck/` are served, so
    this route can never expose the project's secrets or code.
    """
    deck_dir = (project_dir / DECK_DIR).resolve()
    candidate = (deck_dir / file_path).resolve()
    try:
        candidate.relative_to(deck_dir)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


# Every deck response is sandboxed by header, not only by the Deck tab's iframe
# attribute: the deck is agent-written HTML, and it also opens in a new tab and as a
# presenter popup, where no iframe attribute applies. Without allow-same-origin the
# deck runs as an opaque origin, so its script cannot call /api/* as the viewer
# (code review 2026-10-20, finding 1). html-it decks already work from an opaque
# origin (file://): storage calls are guarded and postMessage checks for "null".
DECK_CSP = (
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox "
    "allow-modals allow-downloads allow-forms"
)


def deck_file_response(project_dir: Path, file_path: str) -> FileResponse | None:
    """The sandboxed response for one deck file, or None when no such file is under `deck/`."""
    import mimetypes

    disk_path = resolve_deck_file(project_dir, file_path)
    if disk_path is None:
        return None
    media_type = mimetypes.guess_type(disk_path.name)[0] or "application/octet-stream"
    if media_type.startswith("text/"):
        media_type += "; charset=utf-8"
    return FileResponse(
        disk_path,
        media_type=media_type,
        headers={
            # no-store: the agent rewrites the deck in place, and a cached copy would hide the change
            "Cache-Control": "no-store",
            "Content-Security-Policy": DECK_CSP,
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/projects/{project_id}/deck/{file_path:path}",
    operation_id="getProjectDeckFile",
    response_class=FileResponse,
    responses={200: {"content": {"text/html": {}}}},
)
def get_project_deck_file(
    project_id: str,
    file_path: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Serve a POV deck file (`deck/*`) as a real page, so the deck's presenter
    window and relative links work in the Deck tab and in a full-screen tab.

    Kept cheap, since the deck, its presenter, and the runbook each load it: the access
    check always runs, but the restore (lock, skill and auth checks) runs only when the
    project folder is missing."""
    user_email = _get_user_email(headers)
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    project_dir = _PROJECTS_BASE_RESOLVED / project_id
    if not project_dir.is_dir():
        ensure_project_files_restored(project_id, project_dir, request.app.state.file_sync, session)

    if file_path.endswith(".html"):
        # A deck built before the newest kit patches gets them in place, keeping its edits
        # (services/deck_upgrade.py). After the first load this is one small file read.
        from ..services.deck_upgrade import upgrade_built_deck
        upgrade_built_deck(project_dir)
    response = deck_file_response(project_dir, file_path)
    if response is None:
        raise HTTPException(status_code=404, detail="Deck file not found")
    # Release the DB connection before the file streams: nothing below needs it, and
    # a held connection would sit checked out for the whole send.
    if session is not None:  # tests call the handler directly without a session
        session.close()
    return response


@router.get(
    "/projects/{project_id}/download",
    operation_id="downloadProjectAsZip",
)
async def download_project_as_zip(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Download all project files as a zip archive."""
    user_email = _get_user_email(headers)
    # DB + restore work stays on a thread; the zip is built in the CPU pool.
    project = await asyncio.to_thread(
        _get_authorized_project, session, project_id, user_email, config.template_admin_emails
    )

    project_dir = _PROJECTS_BASE_RESOLVED / project_id

    await asyncio.to_thread(
        ensure_project_files_restored,
        project_id,
        project_dir,
        request.app.state.file_sync,
        session,
    )

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")

    zip_bytes = await run_cpu(build_project_zip, project_dir, timeout=ZIP_TIMEOUT_S)

    filename = f"{_project_slug(project.name)}.zip"

    # One body, not StreamingResponse(BytesIO): that iterates the zip LINE by
    # line (~250-byte chunks, a threadpool hop each) — measured 13s of CPU for
    # 30 MB on the single event-loop core; a big project ran past the proxy's
    # timeout and stalled every other request meanwhile.
    return Response(
        zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ---------------------------------------------------------------------------
# Genie Code workshop attendee kit
#
# The hand-off a customer/attendee actually needs: the workshop page, the
# demo context Genie Code reads (CONTEXT.md), the specs, the data generator,
# and a short README. Deliberately an ALLOWLIST — never .claude/ (transcripts,
# CLI config), context/ (brief + uploads), brand internals, or the rest of the
# project tree. Used by the workshop tab's "Download kit" action.
# ---------------------------------------------------------------------------



@router.get(
    "/projects/{project_id}/workshop-kit",
    operation_id="downloadWorkshopKit",
)
async def download_workshop_kit(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Download the Genie Code workshop attendee kit as a zip."""
    user_email = _get_user_email(headers)
    project = await asyncio.to_thread(
        _get_authorized_project, session, project_id, user_email, config.template_admin_emails
    )

    project_dir = _PROJECTS_BASE_RESOLVED / project_id
    await asyncio.to_thread(
        ensure_project_files_restored,
        project_id,
        project_dir,
        request.app.state.file_sync,
        session,
    )
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")

    data = await run_cpu(build_workshop_kit_zip, project_dir, project.name, timeout=ZIP_TIMEOUT_S)
    if data is None:
        raise HTTPException(status_code=404, detail="Workshop page not generated yet")

    filename = f"{_kit_slug(project.name)}-workshop-kit.zip"
    return Response(  # not StreamingResponse(BytesIO): see download_project_as_zip
        data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# URL patterns indexed by the canonical key produced by resources_extractor.
# The extractor flattens the agent's free-form resources.json into this
# shape, so the URL builder doesn't need to know about format drift.
_RESOURCE_URL_PATTERNS: dict[str, tuple[str, str]] = {
    "pipeline_id": ("{host}/pipelines/{id}", "Pipeline"),
    "dashboard_id": ("{host}/sql/dashboardsv3/{id}", "Dashboard"),
    "genie_space_id": ("{host}/genie/rooms/{id}", "Genie Space"),
    "warehouse_id": ("{host}/sql/warehouses/{id}", "SQL Warehouse"),
    # Legacy KA/MAS links — kept so existing demos still link their resources.
    "knowledge_assistant_id": ("{host}/ml/bricks/ka/configure/{id}", "Knowledge Assistant"),
    "multi_agent_supervisor_id": ("{host}/ml/bricks/sa/configure/{id}", "Supervisor Agent"),
    # documents_volume (a `/Volumes/...` path) is handled as a special case in
    # _build_deployed_links — it isn't an id, so it can't go through this template.
    # mlflow_experiment_path handled separately below — needs an SDK
    # call to resolve the workspace path → experiment_id, then builds
    # `/ml/experiments/<id>/runs?o=<workspace_id>`.
    # NOTE: lakebase is NOT here — it needs a name→uid SDK resolve (the UI routes
    # by the project UUID, but resources.json stores the NAME). Handled as a
    # special case in _build_deployed_links via _resolve_lakebase_project_uid.
}


# experiment_path → experiment_id cache. The path-to-id mapping never
# changes (deleting + recreating an experiment at the same path gives a
# new id, but we'd re-resolve on next miss anyway). In-process dict,
# bounded to a few hundred entries in practice.
_MLFLOW_EXPERIMENT_ID_CACHE: dict[str, str] = {}
_MLFLOW_CACHE_MAX = 512  # drop-oldest above this; bounds the module-global


def _resolve_mlflow_experiment_id(
    ws: "WorkspaceClient | None",
    experiment_path: str,
) -> str | None:
    """Resolve a workspace experiment path (e.g.
    `/Users/me@example.com/foo-bar`) to its numeric experiment_id.

    Returns None if the SDK call fails or the experiment doesn't exist.
    Cached in-process by path — subsequent calls are free.
    """
    if not experiment_path or ws is None:
        return None
    cached = _MLFLOW_EXPERIMENT_ID_CACHE.get(experiment_path)
    if cached:
        return cached
    try:
        exp = ws.experiments.get_by_name(experiment_name=experiment_path)
    except Exception as e:  # noqa: BLE001
        logger.info(
            f"MLflow experiment lookup failed for {experiment_path!r}: {e}"
        )
        return None
    exp_id = getattr(getattr(exp, "experiment", None), "experiment_id", None)
    if exp_id:
        # Simple size cap (drop-oldest) so this module-global never grows without
        # bound across many projects/experiments over the app's lifetime.
        if len(_MLFLOW_EXPERIMENT_ID_CACHE) >= _MLFLOW_CACHE_MAX:
            _MLFLOW_EXPERIMENT_ID_CACHE.pop(next(iter(_MLFLOW_EXPERIMENT_ID_CACHE)), None)
        _MLFLOW_EXPERIMENT_ID_CACHE[experiment_path] = str(exp_id)
        return str(exp_id)
    return None


# Lakebase project NAME → UUID cache. The Lakebase UI routes `/lakebase/projects/
# <uid>` by the project's UUID. resources.json's `lakebase_project_id` is SUPPOSED
# to hold that UUID (the skill + lakebase_setup_db.sh now record `get-project`'s
# `uid` — see app.md), in which case _resolve returns it unchanged (fast path).
# But EXISTING projects (created before that fix) stored the human NAME there
# (e.g. `solution-builder`), which would 404 — so when the value isn't a
# UUID we resolve name→uid via the SDK, cached. This heals old projects with no
# data migration and is a harmless no-op for new ones. Drop-oldest bound like the
# MLflow cache. Keyed by the stored ref (name), so only non-UUID values populate it.
_LAKEBASE_PROJECT_UID_CACHE: dict[str, str] = {}
_LAKEBASE_CACHE_MAX = 512

# A canonical UUID (8-4-4-4-12 hex). When lakebase_project_id already holds one
# (the current/expected shape), skip the SDK lookup and use it as-is.
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def _resolve_lakebase_project_uid(
    ws: "WorkspaceClient | None",
    project_ref: str,
) -> str | None:
    """Return the Lakebase project UUID the /lakebase/projects/<uid> page routes by.

    `project_ref` is resources.json's `lakebase_project_id`:
    - If it's already a UUID (the current/expected shape), return it unchanged.
    - If it's a NAME (`solution-builder` — the shape older projects stored),
      list projects and match on the name (last segment of the SDK's
      `projects/<name>`), returning its `uid`. Cached in-process by name.
    Returns None if the SDK is unavailable or no project matches — caller then
    skips the link rather than emitting a dead one.
    """
    ref = (project_ref or "").strip()
    if not ref:
        return None
    if _UUID_RE.match(ref):
        return ref  # already a uid — nothing to resolve
    if ws is None:
        return None
    cached = _LAKEBASE_PROJECT_UID_CACHE.get(ref)
    if cached:
        return cached
    try:
        for p in ws.postgres.list_projects():
            # SDK `name` is `projects/<slug>`; match the slug against the ref.
            name = getattr(p, "name", "") or ""
            slug = name.split("/")[-1]
            uid = getattr(p, "uid", None)
            if slug == ref and uid:
                if len(_LAKEBASE_PROJECT_UID_CACHE) >= _LAKEBASE_CACHE_MAX:
                    _LAKEBASE_PROJECT_UID_CACHE.pop(
                        next(iter(_LAKEBASE_PROJECT_UID_CACHE)), None
                    )
                _LAKEBASE_PROJECT_UID_CACHE[ref] = str(uid)
                return str(uid)
    except Exception as e:  # noqa: BLE001
        logger.info(f"Lakebase project uid lookup failed for {ref!r}: {e}")
        return None
    return None


def _is_placeholder_id(value: str) -> bool:
    """True when a resources.json value is a not-yet-created placeholder
    rather than a real, resolvable ID/path.

    The build agent mirrors the reference example resources.json, which
    carries angle-bracket stand-ins like `<your-dashboard-uuid>` and
    `/Workspace/Users/<your-user>/...`; the app-template late-fill flow
    leaves `__LATE_FILL_GENIE__`-style markers until the parent backfills
    them. None of these point at a live resource — but they're truthy
    strings, so without this guard the link builder would emit a dead link
    (e.g. `/sql/dashboardsv3/<your-dashboard-uuid>`). Treat them as absent.
    """
    v = value.strip()
    if not v:
        return True
    # Angle-bracket placeholder, whole-value (`<your-dashboard-uuid>`) or
    # embedded mid-path (`/Workspace/Users/<your-user>/demo`). Real IDs and
    # workspace paths never contain angle brackets.
    if "<" in v and ">" in v:
        return True
    if v.startswith("__LATE_FILL"):
        return True
    # Truncated-example convention (`abc123def456...`, `01efab12cd34...`).
    # A real ID or path never ends in an ellipsis.
    if v.endswith("..."):
        return True
    if v.lower() in {"tbd", "todo", "pending", "placeholder", "none", "null", "n/a"}:
        return True
    return False


def _build_deployed_links(
    resources: dict[str, str],
    host: str | None,
    workspace_id: int | str | None = None,
    ws: "WorkspaceClient | None" = None,
) -> list[DeployedResourceLink]:
    """Build deployed resource links from the LLM-normalized flat dict
    (output of services.resources_extractor.extract_resources).

    `workspace_id` is required for the Apps v2 URL (the `?o=` query param
    is what scopes the page to the user's workspace). Other resource URLs
    don't need it.

    `ws` (WorkspaceClient) is used to resolve the MLflow experiment path
    into its numeric experiment_id for the `/ml/experiments/<id>/runs` URL.
    Optional — if unavailable, the MLflow link is just skipped.
    """
    # Drop not-yet-created placeholder values up front so every `if x:`
    # guard below naturally skips them — a resource only earns a link once
    # its real ID lands in resources.json. See _is_placeholder_id.
    resources = {
        k: v
        for k, v in resources.items()
        if isinstance(v, str) and not _is_placeholder_id(v)
    }

    links: list[DeployedResourceLink] = []
    host = (host or "").rstrip("/")

    # Workspace scope query param — every Catalog Explorer / Apps link
    # needs `?o=<workspace_id>` to land on the right workspace when the
    # user has access to multiple. Plumbed in by the caller.
    o_param = f"?o={workspace_id}" if workspace_id else ""

    # Catalog Explorer link (combined catalog + schema)
    catalog = resources.get("catalog")
    schema = resources.get("schema")
    if catalog and schema and host:
        links.append(DeployedResourceLink(
            resource_type="catalog_explorer",
            label="Catalog Explorer",
            url=f"{host}/explore/data/{catalog}/{schema}{o_param}",
        ))

    # Workspace folder link
    workspace_folder = resources.get("workspace_folder")
    if workspace_folder and host:
        links.append(DeployedResourceLink(
            resource_type="workspace_folder",
            label="Workspace",
            url=f"{host}#workspace{workspace_folder}",
        ))

    # Metric View entity page (Catalog Explorer). Canonical shape is a
    # fully-qualified `catalog.schema.name`, but agents sometimes write
    # just the bare name — fall back to the project's catalog/schema in
    # that case so the link still works.
    metric_view_name = resources.get("metric_view_name")
    if metric_view_name and host:
        parts = metric_view_name.split(".")
        if len(parts) == 3:
            mv_cat, mv_schema, mv_name = parts
        elif len(parts) == 1 and catalog and schema:
            mv_cat, mv_schema, mv_name = catalog, schema, parts[0]
        else:
            mv_cat = mv_schema = mv_name = None
        if mv_cat:
            links.append(DeployedResourceLink(
                resource_type="metric_view",
                label="Metric View",
                url=f"{host}/explore/data/{mv_cat}/{mv_schema}/{mv_name}{o_param}",
                resource_id=f"{mv_cat}.{mv_schema}.{mv_name}",
            ))

    # Documents volume (UC managed volume the Genie agent indexes). Canonical value
    # is the path `/Volumes/<cat>/<sch>/<vol>`; the Catalog Explorer page is
    # `/explore/data/volumes/<cat>/<sch>/<vol>`.
    docs_volume = resources.get("documents_volume")
    if docs_volume and host:
        vol_path = docs_volume.removeprefix("/Volumes/").strip("/")
        if vol_path.count("/") == 2:
            links.append(DeployedResourceLink(
                resource_type="documents_volume",
                label="Documents volume",
                url=f"{host}/explore/data/volumes/{vol_path}{o_param}",
                resource_id=docs_volume,
            ))

    # MLflow Registered Model (Unity Catalog). Canonical is fully-qualified
    # `catalog.schema.name`; fall back to project catalog/schema for bare names.
    ml_model_name = resources.get("ml_model_name")
    if ml_model_name and host:
        parts = ml_model_name.split(".")
        if len(parts) == 3:
            m_cat, m_schema, m_name = parts
        elif len(parts) == 1 and catalog and schema:
            m_cat, m_schema, m_name = catalog, schema, parts[0]
        else:
            m_cat = m_schema = m_name = None
        if m_cat:
            links.append(DeployedResourceLink(
                resource_type="ml_model",
                label="MLflow Model",
                url=f"{host}/explore/data/models/{m_cat}/{m_schema}/{m_name}{o_param}",
                resource_id=f"{m_cat}.{m_schema}.{m_name}",
            ))

    # MLflow Experiment — resources.json stores the workspace path
    # (`/Users/foo@bar.com/exp-name`), but the URL needs the numeric
    # experiment_id. Resolve via the SDK (cached). URL shape:
    #   {host}/ml/experiments/{experiment_id}/runs?o={workspace_id}
    mlflow_experiment_path = resources.get("mlflow_experiment_path")
    if mlflow_experiment_path and host:
        exp_id = _resolve_mlflow_experiment_id(ws, mlflow_experiment_path)
        if exp_id:
            links.append(DeployedResourceLink(
                resource_type="mlflow_experiment",
                label="MLflow Experiment",
                url=f"{host}/ml/experiments/{exp_id}/runs{o_param}",
                resource_id=exp_id,
            ))

    # Lakebase project — resources.json stores the project NAME
    # (`solution-builder`), but the /lakebase/projects/<uid> page routes
    # by the project UUID. Resolve name→uid via the SDK (cached; no-op if the
    # value is already a uid). Skip the link if it can't be resolved rather than
    # emit a 404. Works for EXISTING projects with no data migration — resolution
    # happens at render time off whatever's on disk. URL shape:
    #   {host}/lakebase/projects/{uid}
    lakebase_project_ref = resources.get("lakebase_project_id")
    if lakebase_project_ref and host:
        lb_uid = _resolve_lakebase_project_uid(ws, lakebase_project_ref)
        if lb_uid:
            links.append(DeployedResourceLink(
                resource_type="lakebase_project",
                label="Lakebase",
                url=f"{host}/lakebase/projects/{lb_uid}",
                resource_id=lb_uid,
            ))

    # Standard ID-based resources
    for key, (url_template, label) in _RESOURCE_URL_PATTERNS.items():
        resource_id = resources.get(key)
        if not resource_id:
            continue
        url = url_template.format(host=host, id=resource_id) if host else None
        links.append(DeployedResourceLink(
            resource_type=key.removesuffix("_id").removesuffix("_name").removesuffix("_path"),
            label=label,
            url=url,
            resource_id=str(resource_id),
        ))

    # Databricks App — only emit the link when the app has actually been
    # deployed. The agent writes `app.name` as soon as it picks one, but
    # the URL only resolves once `databricks apps deploy` succeeds and the
    # Apps service stamps an `app.id`. Gate on `app_id` so a half-built
    # project doesn't show a broken "Open" link.
    app_name = resources.get("app_name")
    app_id = resources.get("app_id")
    if app_name and app_id:
        if host and workspace_id:
            url = f"{host}/apps-v2/app/{app_name}/overview?o={workspace_id}"
        elif host:
            url = f"{host}/apps-v2/app/{app_name}/overview"
        else:
            url = None
        links.append(DeployedResourceLink(
            resource_type="app",
            label="App",
            url=url,
            resource_id=str(app_name),
        ))

    return links


# ── The deck's links: every built resource, not one per kind ─────────────────
# The extractor keeps one slot per kind (one genie_space_id, no job, no skill), which
# suits the overview tiles (keyed by type) but leaves a deck with five Genie Agents one
# link. These helpers read resources.json directly for the rest, and are written only to
# context/deployed-links.json, never to the UI's response.

# (key suffix, plural key, resource_type, label, url template). The url template takes
# the host and the id (or a /Workspace path for the skill).
_EXTRA_KINDS: tuple[tuple[str, str, str, str, str], ...] = (
    ("genie_space_id", "genie_spaces", "genie_space", "Genie Space", "{host}/genie/rooms/{id}"),
    ("dashboard_id", "dashboards", "dashboard", "Dashboard", "{host}/sql/dashboardsv3/{id}"),
    ("job_id", "jobs", "job", "Job", "{host}/jobs/{id}"),
    ("skill_path", "skills", "skill", "Genie Code skill", "{host}#workspace{id}"),
)
_ITEM_ID_KEYS = ("id", "space_id", "dashboard_id", "job_id", "path")
_ITEM_NAME_KEYS = ("name", "title", "display_name", "label")

# Apps service lookups: (host, app name) → running address. A miss is remembered for a
# minute only, so a freshly deployed app is found soon, and a build's many fetches don't
# each call the Apps service.
_APP_URL_CACHE: dict[tuple[str, str], str] = {}
_APP_URL_MISS: dict[tuple[str, str], float] = {}
_APP_URL_MISS_TTL = 60.0
# Target host → its workspace ID (never changes). A miss is retried after a minute, like the
# app URL, so a failing target doesn't add a round trip to every resources fetch.
_WS_ID_CACHE: dict[str, int] = {}
_WS_ID_MISS: dict[str, float] = {}
# IDs and skill paths come from agent-written resources.json and go into URLs in the deck's HTML,
# so only characters a real Databricks ID or workspace path uses are accepted.
_SAFE_RESOURCE_ID = re.compile(r"^[A-Za-z0-9_.\-/ ]+$")


def _label_hint(key: str, suffix: str) -> str:
    """`cash_working_capital_genie_space_id` → "cash working capital"; "" for the bare key."""
    stem = key[: -len(suffix)] if key.endswith(suffix) else ""
    for noise in ("_genie_code", "_genie"):
        stem = stem.removesuffix(noise)
    stem = stem.removeprefix("genie_code_")
    return stem.replace("_", " ").replace("-", " ").strip()


def _extra_ids(created: Any) -> list[tuple[int, str, str]]:
    """(index into _EXTRA_KINDS, id, label hint) for every resource of those kinds."""
    found: list[tuple[int, str, str]] = []

    def item(i: int, value: Any, hint: str) -> None:
        if isinstance(value, str):
            found.append((i, value, hint))
        elif isinstance(value, dict):
            rid = next((value[k] for k in _ITEM_ID_KEYS if isinstance(value.get(k), (str, int))), None)
            name = next((value[k] for k in _ITEM_NAME_KEYS if isinstance(value.get(k), str)), "")
            if rid is not None:
                found.append((i, str(rid), name or hint))

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for v in node:
                walk(v)
            return
        if not isinstance(node, dict):
            return
        for key, value in node.items():
            k = str(key).lower()
            matched = False
            for i, (suffix, plural, _t, _l, _u) in enumerate(_EXTRA_KINDS):
                if k.endswith(suffix) and isinstance(value, (str, int)):
                    item(i, str(value), _label_hint(k, suffix))
                    matched = True
                elif k == plural or k.endswith("_" + plural):
                    values = value if isinstance(value, list) else [value]
                    if isinstance(value, dict) and not any(x in value for x in _ITEM_ID_KEYS):
                        # {"cash": "g1", "plan": "g2"}: the key is the label
                        for name, rid in value.items():
                            item(i, rid, str(name).replace("_", " "))
                    else:
                        for v in values:
                            item(i, v, "")
                    matched = True
            if not matched:
                walk(value)

    walk(created)
    return found


def _app_runtime_url(ws: "WorkspaceClient | None", host: str, app_name: str) -> str | None:
    """The deployed app's own address (https://<name>-<ws id>.<cloud>.databricksapps.com),
    from the Apps service. None when the app is missing or has never been deployed."""
    if ws is None or not app_name:
        return None
    key = (host, app_name)
    cached = _APP_URL_CACHE.get(key)
    if cached:
        return cached
    if time.monotonic() - _APP_URL_MISS.get(key, -_APP_URL_MISS_TTL) < _APP_URL_MISS_TTL:
        return None
    try:
        app = ws.apps.get(name=app_name)
        url = getattr(app, "url", None)
        deployed = getattr(app, "active_deployment", None) is not None
    except Exception:  # noqa: BLE001 — not found, no access, or no network: no link
        url, deployed = None, False
    if not (isinstance(url, str) and url.startswith("https://")) or not deployed:
        _APP_URL_MISS[key] = time.monotonic()
        return None
    _APP_URL_MISS.pop(key, None)
    _APP_URL_CACHE[key] = url
    return url


def _extra_deck_links(
    raw_text: str,
    host: str | None,
    known: dict[str, str],
    ws: "WorkspaceClient | None" = None,
) -> list[DeployedResourceLink]:
    """Links the extractor's one-per-kind slots leave out: every Genie Agent, dashboard,
    job, and Genie Code skill in resources.json, plus the deployed app's own address.
    `known` is the extractor's output; its IDs already have links and are skipped."""
    host = (host or "").rstrip("/")
    if not host:
        return []
    try:
        data = json.loads(raw_text)
    except (TypeError, ValueError):
        return []
    created = data.get("created_resources", data) if isinstance(data, dict) else data
    seen = {v for v in known.values() if isinstance(v, str) and v}
    links: list[DeployedResourceLink] = []
    for i, rid, hint in _extra_ids(created):
        rid = rid.strip()
        suffix, _p, rtype, label, url = _EXTRA_KINDS[i]
        if not rid or rid in seen or _is_placeholder_id(rid) or not _SAFE_RESOURCE_ID.match(rid):
            continue
        if rtype == "skill":
            if not rid.startswith("/Workspace/"):
                continue
            hint = hint or rid.rstrip("/").rsplit("/", 1)[-1].replace("-", " ").replace("_", " ")
        seen.add(rid)
        links.append(DeployedResourceLink(
            resource_type=rtype,
            label=f"{label}: {hint}" if hint else label,
            url=url.format(host=host, id=quote(rid, safe="/")),
            resource_id=rid,
        ))
    runtime = _app_runtime_url(ws, host, known.get("app_name", ""))
    if runtime:
        links.append(DeployedResourceLink(
            resource_type="app_runtime", label="App", url=runtime, resource_id=known.get("app_name"),
        ))
    return links


def _deck_links(
    links: list[DeployedResourceLink], extras: list[DeployedResourceLink]
) -> list[DeployedResourceLink]:
    """What context/deployed-links.json gets: the UI's links plus the extras. The running
    app's address replaces the app's settings page, because the deck adds each app page's
    path to the app's address."""
    if any(e.resource_type == "app_runtime" for e in extras):
        links = [link for link in links if link.resource_type != "app"]
    return [*links, *extras]


def _target_workspace_id(client: "WorkspaceClient") -> int | None:
    """The workspace ID of the workspace `client` points at, asked of that workspace.

    `WorkspaceClient.get_workspace_id()` returns `Config.workspace_id` without a call
    when it is set, and on Apps the config reads DATABRICKS_WORKSPACE_ID: the app's OWN
    workspace. So a deployer client for a remote target reported the app's ID, and every
    target link's `?o=` pointed at the wrong workspace."""
    try:
        key = str(client.config.host or "").rstrip("/")
    except Exception:  # noqa: BLE001
        key = ""
    if key in _WS_ID_CACHE:
        return _WS_ID_CACHE[key]
    if key and time.monotonic() - _WS_ID_MISS.get(key, -_APP_URL_MISS_TTL) < _APP_URL_MISS_TTL:
        return None
    try:
        response = client.api_client.do(
            "GET", "/api/2.0/preview/scim/v2/Me", response_headers=["X-Databricks-Org-Id"]
        )
        workspace_id = int(response["X-Databricks-Org-Id"])
    except Exception:  # noqa: BLE001
        logger.warning("Could not read the target's workspace ID; links omit ?o=")
        if key:
            _WS_ID_MISS[key] = time.monotonic()
        return None
    if key:
        _WS_ID_MISS.pop(key, None)
        _WS_ID_CACHE[key] = workspace_id
    return workspace_id


def _maybe_reconcile_ownership(
    *,
    session,
    project,
    project_id: str,
    user_email: str,
    sp_ws,
    raw_text: str,
    extracted: dict,
    config,
) -> None:
    """Run the cross-workspace ownership reconcile if — and only if — it's
    needed. Two guards make this safe to call on EVERY deployed-resources fetch
    (which fires on open, on each resources.json write during a build, on
    build-complete, and on manual refresh):

      1. Never mid-build. While a build is running the SP is still creating
         tables inside the schema; transferring the schema to the user now
         would strip the SP's USE_SCHEMA and break the build. `active_execution_id`
         is set for the duration of an agent turn and cleared on completion, so
         we skip while it's set and run on the post-completion fetch.
      2. Hash gate. Skip when the resource set (keyed to the target user) is
         unchanged since the last successful reconcile — zero API calls.

    Best-effort: any failure is logged and swallowed; the hash is only stored on
    a fully-clean pass, so a partial failure self-heals on the next open.
    """
    if _ownership_reconcile is None or _user_target is None:
        return  # generic build — no cross-workspace deploy, nothing to reconcile
    recon = _ownership_reconcile

    if project is None:
        return

    # Guard 0: only the DEPLOY DRIVER reconciles. Resources landed in the
    # driver's per-user target workspace (that's the `effective_target`
    # resolved for the acting user here), so ownership must go to the driver —
    # never to a viewer/editor who merely opened a shared project (which would
    # both grant the wrong person AND point at the wrong workspace). The driver
    # is sticky and set whenever a cross-workspace deploy ran; fall back to the
    # owner when no one has driven yet.
    driver = project.active_driver_email or project.user_email
    if user_email != driver:
        logger.debug("[reconcile] skip %s: %s is not the driver (%s)", project_id, user_email, driver)
        return

    # MID-BUILD vs BUILD-COMPLETE. During a build (active_execution_id set) we
    # run a GRANT-ONLY pass so a user who clicks a resource tile mid-build can
    # actually see it — WITHOUT transferring the schema (which would strip the
    # SP's USE_SCHEMA and break the in-flight build). The full ownership
    # transfer + SP write-back runs at build-complete when the flag clears.
    grant_only = bool(getattr(project, "active_execution_id", None))

    manifest = recon.parse_manifest(raw_text)
    if manifest is None:
        # Unparseable/empty manifest → nothing to do, and DON'T mark the hash
        # (so a later, valid manifest still triggers a reconcile).
        return

    # Guard 2: hash gate. Two independent latches so the mid-build grant pass
    # and the build-complete transfer don't shadow each other.
    want = recon.reconcile_hash(manifest, user_email)
    hash_field = "ownership_granted_hash" if grant_only else "ownership_reconciled_hash"
    if want == getattr(project, hash_field, None):
        return

    # Resolve the catalog the deploy used (frozen on the project at creation),
    # then the schema (manifest is authoritative for where things landed).
    catalog = (
        getattr(project, "default_catalog", None)
        or _user_target.get_user_catalog(session, user_email)
        or config.default_catalog
    )

    # Discover a warehouse in the TARGET for the UC ALTERs. Prefer the one the
    # agent recorded (lives in the target); avoid the app-scoped shared cache.
    warehouse_id = extracted.get("warehouse_id") or None
    if not warehouse_id:
        try:
            for w in sp_ws.warehouses.list():
                if getattr(w, "id", None) and getattr(w, "name", None) and "shared" in w.name.lower():
                    warehouse_id = w.id
                    break
        except Exception:  # noqa: BLE001
            logger.warning("[reconcile] could not list target warehouses", exc_info=True)

    result = recon.reconcile_ownership(
        sp_ws=sp_ws,
        warehouse_id=warehouse_id,
        user_email=user_email,
        manifest=manifest,
        catalog=catalog,
        schema=None,  # taken from the manifest inside reconcile_ownership
        sp_client_id=config.deployer_sp_client_id or None,
        grant_only=grant_only,
    )

    logger.info(
        "[reconcile] project=%s user=%s mode=%s planned=%d ok=%d failed=%d",
        project_id, user_email, "grant-only" if grant_only else "transfer",
        result.actions_planned, result.succeeded, result.failed,
    )

    # Only remember success if EVERY action landed — a partial pass must
    # re-run next open (self-heal) rather than latch a stale "done". The
    # mid-build grant pass latches a SEPARATE field, so the build-complete
    # transfer still runs afterward (its own hash is unset).
    if result.ran and result.failed == 0:
        setattr(project, hash_field, want)
        session.add(project)
        session.commit()


@router.get(
    "/projects/{project_id}/deployed-resources",
    response_model=DeployedResourcesOut,
    operation_id="getDeployedResources",
)
def get_deployed_resources(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    ws: Dependencies.Client,
    request: Request,
):
    """Get deployed Databricks resource links parsed from resources.json.

    Also computes the authoritative per-capability build status + overall
    `all_built` (from resources.json) and persists the recomputed project stage
    — this endpoint is the single place that turns resources.json into both the
    UI's live progress meter and the coarse `project.stage` latch.
    """
    user_email = _get_user_email(headers)
    project = _get_authorized_project(
        session, project_id, user_email, config.template_admin_emails
    )

    file_sync: FileSyncService = request.app.state.file_sync
    # Try root-level resources.json first (new convention), then legacy path
    content = file_sync.get_file_content(
        project_id, "resources.json", session=session
    )
    if content is None:
        content = file_sync.get_file_content(
            project_id, "specifications/resources.json", session=session
        )
    if content is None:
        content = file_sync.get_file_content(
            project_id, "instructions/resources.json", session=session
        )

    if content is None:
        return DeployedResourcesOut()

    # Extract a canonical flat dict via the mini LLM (cached by content
    # hash). The agent writes resources.json in unpredictable shapes;
    # the LLM normalizes them into the keys our URL builder expects.
    from ..services.resources_extractor import extract_resources
    try:
        raw_text = content.decode("utf-8") if isinstance(content, (bytes, bytearray)) else content
    except UnicodeDecodeError:
        logger.warning(f"resources.json for project {project_id} is not UTF-8")
        return DeployedResourcesOut(extraction_error="resources.json is not valid UTF-8")
    resources, extraction_error = extract_resources(project_id, raw_text, ws, config)

    # Get workspace host + numeric ID for the resource links. workspace_id
    # powers the Apps v2 `?o=<id>` query param (the page redirects to a login
    # screen without it). Best-effort: if the SDK call fails, app links work
    # but omit the param.
    #
    # CROSS-WORKSPACE: resources deploy into the project's PINNED TARGET
    # workspace, not the app's own workspace. So the links (and the reconcile's
    # sp_ws below) must point at the TARGET host/id, not `ws` (the app client).
    # Use the PROJECT's pinned target — NOT the acting user's live setting — so a
    # viewer (who has no target set) or a user who later changed their setting
    # still gets correct target-host links instead of the app-workspace fallback.
    link_ws = ws
    target_unresolved = False
    try:
        # LEGACY GUARD: this endpoint already loaded resources.json into `raw_text`;
        # if it carries real created resources and the project has no pinned
        # target, it's a pre-Model-3 project whose resources live on the app's own
        # workspace — resolve there, not the user's live remote pick, so the
        # resource links point at the right host.
        _has_built = _user_target.project_has_built_resources(
            file_sync, project_id, session=session
        )
        effective_target = (
            _user_target.resolve_and_pin_project_target(
                project=project,
                user_email=user_email,
                session=session,
                config=config,
                has_built_resources=_has_built,
                # Freeze on first driver view of a BUILT project so tiles +
                # .databrickscfg + deploy stay in lockstep for its lifecycle.
                # Never pin an empty draft here (stays changeable until build);
                # never a viewer (must not pin someone else's project).
                can_pin=(_has_built and is_driver(session, project_id, user_email)),
            )
            if _user_target is not None
            else None
        )
        if effective_target and config.cross_workspace_deploy_enabled and _target_probe is not None:
            link_ws = _target_probe.make_sp_target_client(
                effective_target,
                config.deployer_sp_client_id,
                config.deployer_sp_client_secret,
            )
    except Exception:
        logger.warning("Could not build target client for resource links; using app workspace")
        link_ws = ws
        target_unresolved = True

    # Cross-workspace ownership reconcile (Gate 1 = build-complete, Gate 2 =
    # self-heal on open — both ride this endpoint). Give the acting user
    # ownership/CAN_MANAGE of the resources the deployer SP created in the
    # target. Only when we actually built a target SP client (link_ws is not
    # ws) — never re-home the app's own workspace. Best-effort + hash-gated so
    # steady-state opens cost one comparison and this never breaks the 200.
    if link_ws is not ws:
        try:
            _maybe_reconcile_ownership(
                session=session, project=project, project_id=project_id,
                user_email=user_email, sp_ws=link_ws, raw_text=raw_text,
                extracted=resources, config=config,
            )
        except Exception:
            logger.warning("[reconcile] ownership reconcile hook failed", exc_info=True)

    host = None
    workspace_id: int | str | None = None
    try:
        host = str(link_ws.config.host).rstrip("/") if link_ws.config.host else None
    except Exception:
        logger.warning("Could not resolve workspace host for resource URLs")
    if link_ws is not ws:
        # A remote target: ask it, because get_workspace_id() would return the app's own
        # workspace from DATABRICKS_WORKSPACE_ID (see _target_workspace_id).
        workspace_id = _target_workspace_id(link_ws)
    else:
        try:
            workspace_id = link_ws.get_workspace_id()
        except Exception:
            logger.warning("Could not resolve workspace_id; app links will omit ?o=")

    links = _build_deployed_links(resources, host, workspace_id, ws=link_ws)

    # Hand the links to the POV deck stage (context/deployed-links.json), which can't turn
    # resources.json's IDs into addresses itself. Skipped when the target client failed,
    # since the links would then point at the app's own workspace, and for a workshop, which
    # has no deck. Best-effort.
    if not target_unresolved and project.mode != "workshop":
        try:
            from ..services.live_demo import sync_deployed_links
            extras = _extra_deck_links(raw_text, host, resources, ws=link_ws)
            if sync_deployed_links(_PROJECTS_BASE_RESOLVED / project_id, _deck_links(links, extras)):
                cache_evict_project(project_id)
        except Exception:
            logger.warning(f"Could not write deployed links for {project_id}", exc_info=True)

    # Get deployment timestamp from the file record (check both paths)
    deployed_at = None
    file_record = session.exec(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id)
        .where(ProjectFile.relative_path == "resources.json")
    ).first()
    if not file_record:
        file_record = session.exec(
            select(ProjectFile)
            .where(ProjectFile.project_id == project_id)
            .where(ProjectFile.relative_path == "specifications/resources.json")
        ).first()
    if not file_record:
        file_record = session.exec(
            select(ProjectFile)
            .where(ProjectFile.project_id == project_id)
            .where(ProjectFile.relative_path == "instructions/resources.json")
        ).first()
    if file_record:
        deployed_at = file_record.last_modified

    # Authoritative per-capability build status, straight from resources.json
    # (NOT re-inferred from URLs). Drives the UI's live "N of N ready" meter.
    capabilities = capability_build_status(raw_text)
    all_built = bool(capabilities) and all(c.built for c in capabilities)

    # Recompute + persist the coarse project stage from the same resources.json,
    # exactly as getProject does (monotonic; not demoted by a streaming turn).
    # This endpoint is polled after every build event, so it keeps stage fresh
    # without a second parse or a dedicated stage endpoint.
    try:
        project_dir = _PROJECTS_BASE_RESOLVED / project_id
        file_paths = [f["path"] for f in _get_cached_files(project_id, project_dir)]
        stage = merge_project_stage(
            compute_project_stage(
                file_paths, raw_text, is_streaming=_project_is_streaming(project_id)
            ),
            project.stage,
        )
        if stage != project.stage:
            project.stage = stage
            session.add(project)
            session.commit()
    except Exception:
        # Stage persistence is best-effort — never fail the resources read.
        logger.warning(f"Could not persist project stage for {project_id}", exc_info=True)

    return DeployedResourcesOut(
        resources=links,
        deployed_at=deployed_at,
        extraction_error=extraction_error,
        capabilities=capabilities,
        all_built=all_built,
    )
