"""Resume conversations interrupted by an app crash / hard restart.

On a hard crash (SIGKILL / OOM — NOT a graceful SIGTERM redeploy, which lets the
turn's `finally` run and clear the flag), a project can be left mid-turn: its
`Project.active_execution_id` is still set and the last chat `Message` is the
user's, with no assistant reply. This module scans for exactly that on boot and
re-kicks the agent so the conversation continues on its own.

**Gated to SP mode only.** The resumed turn runs with no HTTP request → no user
identity → no OBO PAT. That's fine ONLY when the project authenticates as the
deployer SERVICE PRINCIPAL (oauth-m2m creds, always present in the container env;
see core.auth.project_runs_as_sp + AUTH.md). An OBO project's user token is long
gone on boot, so we never touch those — they resume the normal way when the user
reopens the tab. If the deployer SP isn't configured at all
(`config.cross_workspace_deploy_enabled` False) this whole module no-ops.

Selection is deliberately conservative (belt + suspenders against a false
positive from the rare case where `_persist_completion` itself failed and left
the flag set): a project is resumed iff ALL hold —
  • `active_execution_id IS NOT NULL`  (turn was in flight)
  • `project_runs_as_sp(config, project)` is True  (SP identity available)
  • the latest Message for the project is role="user"  (no assistant reply yet)
  • no live in-memory ActiveStream for it  (nothing is actually running now)

For each match we: restore files + the Claude transcript from the DB, write the
SP `.databrickscfg` + FMAPI auth files (so the agent authenticates), persist a
VISIBLE system message ("interrupted by a restart, continuing"), and schedule the
shared `run_agent_turn` on the app event loop — which self-heals the flag in its
completion step. Every step logs.

Fire-and-forget from the lifespan (single replica, so no double-fire). Never
raises into boot — a failure here must not stop the app coming up.
"""

from __future__ import annotations

import asyncio

from sqlmodel import Session, select

from ..core._config import logger
from ..core.auth import project_runs_as_sp, write_project_databrickscfg
from ..models import Message, Project, generate_uuid, utc_now

# Crash-loop guard: stop auto-resuming a conversation once it's been resumed this
# many times without a clean completion. A turn that reliably crashes the app is
# then left interrupted for a human instead of resume-crash-looping every deploy.
# `Project.resume_attempts` is incremented per auto-resume and reset to 0 on a
# clean turn completion (see routes/agent.run_agent_turn).
RESUME_MAX_ATTEMPTS = 3

# The visible marker we drop into the chat so the interruption is transparent to
# whoever next opens the project (the user asked for this to be visible).
_RESUME_NOTICE = (
    "⟳ This conversation was interrupted by an app restart. Re-reading the "
    "conversation history and continuing the task."
)

# The synthetic prompt handed to the agent to continue. NOT persisted as a user
# bubble (save_user_message is effectively false — we pass it straight to the SDK
# via run_agent_turn's `message`). Framed so the agent re-grounds in history.
_RESUME_PROMPT = (
    "[System] The previous turn was interrupted by an app restart before it "
    "finished. Re-read the conversation history above and resume exactly where "
    "you left off — continue the task the user last asked for. Do not restart "
    "from scratch or re-ask questions already answered."
)


def _last_message_is_user(session: Session, project_id: str) -> bool:
    """True iff the most recent Message for the project is role='user' — i.e. the
    user spoke and no assistant reply followed (the interrupted shape). A cheap
    single-row query ordered by the (project_id, created_at) index."""
    row = session.exec(
        select(Message.role)
        .where(Message.project_id == project_id)
        .order_by(Message.created_at.desc(), Message.id.desc())  # type: ignore[union-attr]
        .limit(1)
    ).first()
    return row == "user"


def _find_interrupted_projects(session: Session, config) -> list[Project]:
    """The conservative selection query (see module docstring). Returns Project
    rows that look interrupted AND are SP-mode AND have no live stream."""
    # NOTE: no ActiveStream check here — this runs at boot on a worker thread
    # BEFORE any turn could exist (the manager is a fresh per-process singleton),
    # and touching it off the event loop would race the loop. The DB flag +
    # "last message is user" check are the boot-time signal.
    candidates = session.exec(
        select(Project).where(Project.active_execution_id.isnot(None))  # type: ignore[union-attr]
    ).all()

    out: list[Project] = []
    for project in candidates:
        if not project_runs_as_sp(config, project):
            logger.info(
                "[resume] skip %s: not SP-mode (OBO token is gone on boot) — "
                "will resume when the owner reopens the project",
                project.id,
            )
            continue
        if not _last_message_is_user(session, project.id):
            # Flag was set but last message isn't a user turn → the completion
            # likely ran (or there's no user turn to answer). Clear the stale
            # flag so it doesn't linger, and move on. Not an interruption.
            logger.info(
                "[resume] skip %s: active_execution_id set but last message is "
                "not a user turn — clearing stale flag (not an interruption)",
                project.id,
            )
            project.active_execution_id = None
            project.updated_at = utc_now()
            session.add(project)
            session.commit()
            continue
        attempts = getattr(project, "resume_attempts", 0) or 0
        if attempts >= RESUME_MAX_ATTEMPTS:
            # Crash-loop guard tripped: this conversation has been auto-resumed
            # RESUME_MAX_ATTEMPTS times without ever completing cleanly. Stop
            # auto-resuming it — leave it interrupted for a human. Clear the
            # in-flight flag so the UI doesn't show it as perpetually "running".
            logger.warning(
                "[resume] skip %s: resume_attempts=%d >= cap %d — a turn keeps "
                "crashing; leaving it interrupted for a human",
                project.id, attempts, RESUME_MAX_ATTEMPTS,
            )
            project.active_execution_id = None
            project.updated_at = utc_now()
            session.add(project)
            session.commit()
            continue
        out.append(project)
    return out


def _prepare_and_notice(engine, file_sync, config, project_id: str) -> bool:
    """Restore the project to disk, write SP auth, and persist the visible resume
    notice — all the SYNC prep that must happen before the (async) agent turn.
    Returns True if prep succeeded and we should proceed to run the turn."""
    from ..routes.project_files import ensure_project_files_restored
    from ..services.skills_manager import PROJECTS_BASE_DIR, get_project_directory
    from ..services.file_sync import ensure_fmapi_auth_files
    from pathlib import Path

    project_dir = Path(PROJECTS_BASE_DIR) / project_id
    with Session(engine) as session:
        project = session.get(Project, project_id)
        if project is None:
            return False
        # 1. Files + Claude transcript back on disk (identity-agnostic).
        try:
            ensure_project_files_restored(project_id, project_dir, file_sync, session)
        except Exception:
            logger.exception("[resume] %s: file restore failed", project_id)
            return False
        # 2. SP auth: write <project>/.databrickscfg (deployer SP oauth-m2m) +
        #    FMAPI token files, EXACTLY as invoke_agent's SP branch does — so the
        #    agent's `databricks` CLI + Claude both authenticate before we run.
        try:
            wrote = write_project_databrickscfg(
                get_project_directory(project_id),
                config=config,
                target_workspace_host=getattr(project, "target_workspace_host", None),
                user_pat=None,
                user_host=None,
            )
            if wrote is None:
                logger.warning(
                    "[resume] %s: no SP .databrickscfg written (deployer SP creds "
                    "missing?) — skipping resume",
                    project_id,
                )
                return False
            ensure_fmapi_auth_files(project_dir, project_id)
        except Exception:
            logger.exception("[resume] %s: SP auth setup failed", project_id)
            return False
        # 3. Visible system notice so the interruption is transparent in the chat.
        session.add(
            Message(project_id=project_id, role="system", content=_RESUME_NOTICE)
        )
        session.commit()
    return True


async def _schedule_resume(engine, project_id: str, snapshot: dict) -> None:
    """Runs ON THE APP EVENT LOOP (via run_coroutine_threadsafe). Creates the
    ActiveStream, stamps a fresh execution id + bumps the crash-loop counter in
    the DB, then hands the shared `run_agent_turn` to `start_stream`. All
    stream-manager access lives here so it never happens off-loop."""
    from ..routes.agent import run_agent_turn
    from .active_stream import get_stream_manager

    mgr = get_stream_manager()

    # RACE GUARD: take the SAME per-project lock invoke_agent uses, and re-check
    # for a live stream INSIDE it. Between the boot scan and here a user could
    # open the project and send (invoke_agent), which would create its own stream
    # under the lock. Without this, resume would create a SECOND concurrent stream
    # for the same project → two agent turns racing the same DB rows + session.
    # Both this and invoke_agent's create_stream now happen under the lock, so
    # exactly one wins; if a turn is already live we defer to it and bail.
    async with mgr.get_project_lock(project_id):
        if mgr.get_project_stream(project_id) is not None:
            logger.info(
                "[resume] %s: a turn is already live (user beat us to it) — "
                "skipping resume",
                project_id,
            )
            return

        execution_id = generate_uuid()
        stream = mgr.create_stream(execution_id, project_id)

        # Mark the project as running again under this new execution id so the UI
        # sees it in flight, and INCREMENT the crash-loop counter (reset to 0 on a
        # clean completion in run_agent_turn). DB is sync psycopg → to_thread.
        def _mark_running() -> None:
            with Session(engine) as s:
                proj = s.get(Project, project_id)
                if proj is not None:
                    proj.active_execution_id = execution_id
                    proj.resume_attempts = (getattr(proj, "resume_attempts", 0) or 0) + 1
                    proj.updated_at = utc_now()
                    s.add(proj)
                    s.commit()

        await asyncio.to_thread(_mark_running)

        async def _turn() -> None:
            await run_agent_turn(
                project_id=project_id,
                message=_RESUME_PROMPT,
                stream=stream,
                engine=engine,
                mode="deployed",        # SP path is a deployed-mode concept
                cluster_id=snapshot["cluster_id"],
                warehouse_id=snapshot["warehouse_id"],
                default_catalog=snapshot["default_catalog"],
                default_schema=snapshot["default_schema"],
                databricks_profile=None,
                session_id=snapshot["session_id"],  # resume the same Claude session
                template_lineage=None,
                operator_notice=None,
                target_deploy=True,     # SP: read the SP .databrickscfg
                project_mode=snapshot.get("mode"),
            )

        # start_stream just creates the background task (fast, non-blocking), so
        # doing it under the lock is fine — it doesn't await the whole turn.
        await mgr.start_stream(stream, _turn)
        logger.info(
            "[resume] resuming %s (execution %s, session %s)",
            project_id, execution_id, snapshot["session_id"] or "<fresh>",
        )


def resume_interrupted_conversations(app) -> None:
    """Boot entrypoint. Runs on a background thread (fire-and-forget from the
    lifespan). Finds interrupted SP conversations and re-kicks each. Never raises."""
    try:
        from ..core._config import AppConfig

        config = AppConfig()
        if config.disable_conversation_resume:
            logger.warning(
                "[resume] DISABLE_CONVERSATION_RESUME set — skipping boot-time "
                "resume of interrupted conversations (clean-restart escape hatch)"
            )
            return
        if not config.cross_workspace_deploy_enabled:
            logger.info(
                "[resume] deployer SP not configured (OBO-only deployment) — "
                "boot-time conversation resume disabled"
            )
            return

        engine = getattr(app.state, "engine", None)
        loop = getattr(app.state, "event_loop", None)
        file_sync = getattr(app.state, "file_sync", None)
        if engine is None or loop is None or file_sync is None:
            logger.warning(
                "[resume] engine/loop/file_sync not ready on app.state — skipping"
            )
            return

        with Session(engine) as session:
            interrupted = _find_interrupted_projects(session, config)
            # Snapshot the fields we need before the session closes.
            targets = [
                {
                    "id": p.id,
                    "session_id": p.session_id,
                    "cluster_id": p.cluster_id,
                    "warehouse_id": p.warehouse_id,
                    "default_catalog": p.default_catalog,
                    "default_schema": p.default_schema,
                    "mode": p.mode,
                }
                for p in interrupted
            ]

        if not targets:
            logger.info("[resume] no interrupted SP conversations to resume")
            return

        logger.info(
            "[resume] found %d interrupted SP conversation(s) to resume: %s",
            len(targets),
            ", ".join(t["id"] for t in targets),
        )

        for t in targets:
            project_id = t["id"]
            try:
                # SYNC prep on THIS thread: restore files + SP auth + notice.
                if not _prepare_and_notice(engine, file_sync, config, project_id):
                    continue

                # Everything that touches the ActiveStreamManager (create_stream,
                # start_stream) MUST run on the app EVENT LOOP — it's a per-process
                # singleton the loop owns; mutating `_streams` from this worker
                # thread would race the loop. So we schedule ONE coroutine that
                # does the stream creation + DB flag/counter write (via to_thread)
                # + start_stream, all on the loop. run_coroutine_threadsafe hops us
                # there from this daemon thread.
                asyncio.run_coroutine_threadsafe(
                    _schedule_resume(engine, project_id, t),
                    loop,
                )
                logger.info("[resume] dispatched resume for %s", project_id)
            except Exception:
                logger.exception("[resume] failed to resume %s", project_id)
    except Exception:
        # Boot must never fail because of resume. Log and move on.
        logger.exception("[resume] resume-interrupted-conversations task crashed")
