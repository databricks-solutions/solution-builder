"""Background reapers — the single home for the app's periodic cleanup sweeps.

Two loops live here (both `asyncio.Task`s tied to the app lifespan via
`start_reapers` / `stop_reapers`, started from the Lakebase lifespan where the DB
engine + file_sync are already up):

1. **Agent-session reaper** (every `CLIENT_IDLE_TIMEOUT` = 5 min) — disconnects
   idle `ClaudeSDKClient` subprocesses via `ClientPool.reap_idle()`. Frees the
   memory/subprocess of abandoned agent sessions. A session with an in-flight
   ActiveStream is never reaped (reap_idle checks the stream), so a background
   run keeps its session alive even with every browser tab closed.

2. **Project-file cleanup** (every `FILE_CLEANUP_INTERVAL` = 30 min) — deletes a
   project's ON-DISK folder to reclaim local disk when it's an orphan (no DB row)
   or hasn't been touched in `FILE_STALE_AFTER` = 12 h. **It NEVER deletes DB
   rows** (Project / Message / ProjectFile, incl. the Claude session transcript):
   the DB is the durable store, the folder is a disposable cache that
   `restore_project_from_db` rebuilds — and re-anchors the transcript so
   `resume=session_id` still works — on the next open. Before removing a folder
   for a still-existing project it runs `full_sync_project` so any un-flushed
   on-disk change is pushed to the DB first.

A THIRD sweep exists but is NOT started here: the **preview-apps idle sweep**
(`preview/registry.py` `_idle_loop`, 5 min) stops idle `start.sh` preview
web-server subprocesses. It's wired independently in `app.py` because it needs no
DB. It's mentioned here so this module is the one index of every reaper.

Invariant across all reapers: **nothing is reaped while a turn is in flight** —
the authoritative "a turn is running" signal is the ActiveStream
(`get_stream_manager().get_project_stream`), not the pool's `is_busy` flag.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI
from sqlmodel import Session, func, select

from ._config import logger
from ..models import Message, Project, utc_now

# ── Tunables ────────────────────────────────────────────────────────────────
# Project-file cleanup cadence + staleness threshold. The session reaper's
# cadence/threshold is CLIENT_IDLE_TIMEOUT (imported lazily from services.agent).
FILE_CLEANUP_INTERVAL = 30 * 60      # sweep every 30 min
FILE_STALE_AFTER = timedelta(hours=12)  # remove a project's folder after 12h idle

# Rogue-subprocess reaper: the agent's Bash tool may run `./start.sh` (a smoke
# test) and forget to kill it, leaving a Node preview server running OUTSIDE the
# PreviewRegistry. start.sh records the Node process-group in `.preview.pgid` for
# EVERY run; the registry additionally writes `.preview.server.pid`. So a
# `.preview.pgid` with NO sibling `.preview.server.pid` = agent-spawned/untracked.
ROGUE_SWEEP_INTERVAL = 5 * 60        # scan every 5 min
ROGUE_MAX_AGE_SECONDS = 15 * 60      # kill an untracked runner older than 15 min


# ── Agent-session reaper ──────────────────────────────────────────────────────
async def _agent_session_reaper_loop() -> None:
    """Every CLIENT_IDLE_TIMEOUT seconds, disconnect idle agent sessions.

    Moved verbatim from lakebase.py's lifespan; behavior unchanged (the leak fix
    + stuck-busy backstop live in ClientPool.reap_idle itself).
    """
    from ..services.agent import get_client_pool, CLIENT_IDLE_TIMEOUT
    from ..services.active_stream import get_stream_manager

    pool = get_client_pool()
    while True:
        try:
            await pool.reap_idle()
        except Exception as e:  # noqa: BLE001 — never let the loop die
            logger.warning(f"[reapers] session reaper error: {e!r}")
        try:
            # Bound _streams here (not just on create_stream) so terminal streams
            # are reclaimed even on an idle instance.
            get_stream_manager().sweep_expired()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[reapers] stream sweep error: {e!r}")
        await asyncio.sleep(CLIENT_IDLE_TIMEOUT)


# ── Project-file cleanup ──────────────────────────────────────────────────────
def _project_last_activity(
    session: Session, project: Project, project_dir: Path
) -> datetime:
    """Best available 'last touched' timestamp for a project. There is no
    view-tracking, so combine every durable signal we DO have:
      - project.updated_at (bumped on edits/agent turns),
      - the newest Message.created_at (chat activity),
      - the on-disk folder mtime (files written during builds/edits).
    Returns a tz-aware datetime.
    """
    latest_msg: datetime | None = session.exec(
        select(func.max(Message.created_at)).where(Message.project_id == project.id)
    ).one()

    candidates: list[datetime] = [project.updated_at]
    if latest_msg is not None:
        candidates.append(latest_msg)
    try:
        mtime = datetime.fromtimestamp(os.path.getmtime(project_dir), tz=timezone.utc)
        candidates.append(mtime)
    except OSError:
        pass

    # Normalize any naive datetimes to UTC so max() doesn't raise / mis-compare.
    norm = [c if c.tzinfo else c.replace(tzinfo=timezone.utc) for c in candidates]
    return max(norm)


def _sweep_project_files(app: FastAPI) -> tuple[int, int]:
    """One project-file cleanup pass. Returns (orphans_removed, stale_removed).

    NEVER deletes DB rows. Only removes on-disk folders that are orphaned (no
    Project row) or idle > FILE_STALE_AFTER (and not currently streaming).
    """
    from ..services.skills_manager import PROJECTS_BASE_DIR
    from ..services.active_stream import get_stream_manager
    from ..routes.project_files import remove_project_files_on_disk

    engine = getattr(app.state, "engine", None)
    file_sync = getattr(app.state, "file_sync", None)
    if engine is None:
        return (0, 0)

    base = Path(PROJECTS_BASE_DIR).resolve()
    if not base.exists():
        return (0, 0)

    mgr = get_stream_manager()
    now = utc_now()
    orphans = 0
    stale = 0

    for child in base.iterdir():
        if not child.is_dir():
            continue
        project_id = child.name
        try:
            # NEVER touch a project with a turn in flight — a background run may
            # be actively writing files here.
            if mgr.get_project_stream(project_id) is not None:
                continue

            orphan = False
            with Session(engine) as session:
                project = session.get(Project, project_id)
                if project is None:
                    orphan = True
                else:
                    last_activity = _project_last_activity(session, project, child)
                    if now - last_activity <= FILE_STALE_AFTER:
                        continue

            # Session is closed before the (blocking) rmtree. remove_project_files_on_disk
            # is atomic: it marks the project "cleaning" (so the watcher flush skips
            # row-deletion for the whole rmtree window) and holds the restore lock
            # across the flush + rmtree (so restore can't interleave).
            #   - Orphan (no DB row): pass NO file_sync — there are no rows to flush
            #     to, and full_sync would re-create rows for a project that no longer
            #     exists. Just remove the dead cache folder.
            #   - Stale-but-live: pass file_sync so full_sync_project (delete-free)
            #     flushes disk→DB BEFORE the rmtree, keeping every row. Reopen restores.
            if orphan:
                if remove_project_files_on_disk(project_id):
                    orphans += 1
                    logger.info(f"[reapers] removed orphan project folder {project_id}")
            else:
                if remove_project_files_on_disk(project_id, file_sync=file_sync):
                    stale += 1
                    logger.info(
                        f"[reapers] removed stale project folder {project_id} "
                        f"(idle > {FILE_STALE_AFTER}); DB rows kept, restores on open"
                    )
        except Exception as e:  # noqa: BLE001 — one bad folder must not kill the sweep
            logger.warning(f"[reapers] file-cleanup error for {project_id}: {e!r}")

    return (orphans, stale)


async def _project_file_cleanup_loop(app: FastAPI) -> None:
    """Every FILE_CLEANUP_INTERVAL seconds, reclaim disk from stale/orphan folders."""
    while True:
        try:
            # rmtree + DB work is blocking — run off the event loop.
            orphans, stale = await asyncio.to_thread(_sweep_project_files, app)
            if orphans or stale:
                logger.info(
                    f"[reapers] file-cleanup: {orphans} orphan(s), {stale} stale "
                    f"folder(s) removed"
                )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[reapers] file-cleanup loop error: {e!r}")
        await asyncio.sleep(FILE_CLEANUP_INTERVAL)


# ── Rogue-subprocess reaper ───────────────────────────────────────────────────
def _sweep_rogue_previews() -> int:
    """Kill agent-spawned preview servers left running outside the registry.

    For each `<PROJECTS_BASE_DIR>/<id>/app/.preview.pgid`:
      - dead group  → unlink the stale file, skip.
      - sibling `.preview.server.pid` present → REGISTRY-owned → skip (its idle
        sweep handles it).
      - project has an in-flight agent turn → skip (the agent may be smoke-testing).
      - younger than ROGUE_MAX_AGE_SECONDS → skip (grace for a legit smoke test).
      - else → validated kill of the Node process group + unlink the file.
    Returns the number reaped. Never touches the DB.
    """
    import os
    from ..services.skills_manager import PROJECTS_BASE_DIR
    from ..services.active_stream import get_stream_manager
    from ..preview.process import (
        PGID_FILENAME, kill_process_tree, process_age_seconds,
    )
    from ..preview.registry import SERVER_PID_FILENAME

    base = Path(PROJECTS_BASE_DIR).resolve()
    if not base.exists():
        return 0
    mgr = get_stream_manager()
    reaped = 0

    for pgid_file in base.glob(f"*/app/{PGID_FILENAME}"):
        try:
            app_dir = pgid_file.parent
            project_id = app_dir.parent.name

            # Registry-owned? (both markers present) → leave it to the registry.
            if (app_dir / SERVER_PID_FILENAME).exists():
                continue

            try:
                raw = pgid_file.read_text().strip()
                pgid = int(raw) if raw.lstrip("-").isdigit() else None
            except OSError:
                pgid = None
            if pgid is None:
                pgid_file.unlink(missing_ok=True)
                continue

            # Dead group → just clear the stale file.
            try:
                os.killpg(pgid, 0)
            except ProcessLookupError:
                pgid_file.unlink(missing_ok=True)
                continue
            except PermissionError:
                # Group exists but isn't ours (PID reuse by another user) — the
                # validated kill below will refuse it; don't unlink yet.
                pass

            # Don't touch a project with a live agent turn (may be smoke-testing).
            if mgr.get_project_stream(project_id) is not None:
                continue

            # Grace period: only reap runners OLDER than the threshold. Prefer the
            # process's own elapsed time; if that's unreadable, fall back to the
            # `.preview.pgid` file mtime (≈ when start.sh wrote it ≈ process start).
            # If BOTH are unknown, treat it as too-young this pass (skip, retry
            # next sweep) — never reap on unknown age, so a just-started UI preview
            # in the tiny window before its `.server.pid` lands can't be caught.
            age = process_age_seconds(pgid)
            if age is None:
                try:
                    import time as _t
                    age = _t.time() - pgid_file.stat().st_mtime
                except OSError:
                    age = None
            if age is None or age < ROGUE_MAX_AGE_SECONDS:
                continue

            # Validated kill (refuses non-node/start.sh trees → no friendly-fire).
            if kill_process_tree(pgid, is_pgid=True, validate=True):
                reaped += 1
                logger.warning(
                    f"[reapers] killed ROGUE preview for {project_id} "
                    f"(agent-spawned, untracked, age={age}s) — pgid {pgid}"
                )
            pgid_file.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001 — one bad file must not kill the sweep
            logger.warning(f"[reapers] rogue-preview sweep error for {pgid_file}: {e!r}")
    return reaped


async def _rogue_preview_reaper_loop() -> None:
    """Every ROGUE_SWEEP_INTERVAL seconds, kill untracked agent-spawned previews."""
    while True:
        try:
            reaped = await asyncio.to_thread(_sweep_rogue_previews)
            if reaped:
                logger.info(f"[reapers] rogue-preview: killed {reaped} untracked runner(s)")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[reapers] rogue-preview loop error: {e!r}")
        await asyncio.sleep(ROGUE_SWEEP_INTERVAL)


# ── Lifecycle ─────────────────────────────────────────────────────────────────
def start_reapers(app: FastAPI) -> None:
    """Start all reaper loops as background tasks (called from the Lakebase
    lifespan, after engine + file_sync are ready). Idempotent-ish: stashes the
    tasks on app.state so stop_reapers can cancel them."""
    from ..services.agent import CLIENT_IDLE_TIMEOUT

    tasks: list[asyncio.Task] = [
        asyncio.create_task(_agent_session_reaper_loop()),
        asyncio.create_task(_project_file_cleanup_loop(app)),
        asyncio.create_task(_rogue_preview_reaper_loop()),
    ]
    app.state.reaper_tasks = tasks
    logger.info(
        f"[reapers] started: agent-session (every {CLIENT_IDLE_TIMEOUT}s), "
        f"project-file cleanup (every {FILE_CLEANUP_INTERVAL}s, stale > {FILE_STALE_AFTER}), "
        f"rogue-preview (every {ROGUE_SWEEP_INTERVAL}s, kill > {ROGUE_MAX_AGE_SECONDS}s)"
    )


async def stop_reapers(app: FastAPI) -> None:
    """Cancel every reaper task at shutdown (best-effort)."""
    tasks = getattr(app.state, "reaper_tasks", None) or []
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    app.state.reaper_tasks = []
    if tasks:
        logger.info(f"[reapers] cancelled {len(tasks)} reaper task(s)")
