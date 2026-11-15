"""Agent invocation and streaming endpoints.

Provides:
- POST /invoke_agent - Start agent execution, returns execution_id
- POST /stream_progress/{execution_id} - SSE stream of events
- POST /stop_stream/{execution_id} - Cancel running execution
- GET /projects/{project_id}/execution - Get active execution
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque

from fastapi import HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select
from ..core import Dependencies, create_router
from ..core._config import logger
from ..core.auth import (
    SP_DRIVER_SENTINEL,
    detect_mode,
    project_runs_as_sp,
    request_user_pat,
    resolve_host,
    target_deploy_active,
    write_project_auth_file,
    write_project_databrickscfg,
)
# Cross-workspace deploy target resolution lives in the OPTIONAL remote_deploy/
# module. Tolerant import so a generic build (module excluded) still boots; the
# deploy path then resolves no target and stays same-workspace.
try:
    from ..remote_deploy import user_target as _user_target
except ImportError:
    _user_target = None
from ..services.skills_manager import get_project_directory
from ..models import (
    InvokeAgentRequest,
    InvokeAgentResponse,
    Message,
    Project,
    Template,
    User,
    compress_reasoning,
    generate_uuid,
    utc_now,
)
from ..services.active_stream import get_stream_manager
from ..services.agent import collect_text_response, collect_reasoning, is_stale_session_error, stream_agent_response
from .projects import (
    _require_write_access,
    active_driver,
    claim_driver,
    driver_token_expired,
    is_driver,
)

router = create_router()

# Constants
SSE_WINDOW_SECONDS = 50  # Reconnect before 60s HTTP timeout
POLL_INTERVAL = 0.1  # seconds between event checks


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


async def run_agent_turn(
    *,
    project_id: str,
    message: str,
    stream: "ActiveStream",
    engine,
    mode,
    context_hint: str | None = None,
    images: list[str] | None = None,
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    databricks_profile: str | None = None,
    session_id: str | None = None,
    template_lineage: dict | None = None,
    operator_notice: str | None = None,
    target_deploy: bool = False,
    project_mode: str | None = None,
) -> None:
    """Run ONE agent turn to completion + persist the result. THE single background
    turn-runner, shared by `invoke_agent` (a user send) and the boot-time resume
    service (`services/resume_agent`). It:

      1. streams `stream_agent_response` into a bounded accumulator,
      2. on a stale-session error, clears `Project.session_id` + retries once fresh,
      3. in a completion step, persists the assistant message + `session_id` and
         **clears `Project.active_execution_id`** — the self-healing step that makes
         `active_execution_id != NULL` a reliable "was interrupted" signal.

    Runs even if the browser disconnected (decoupled from the SSE consumer). The
    caller is responsible for `_persist_start` (user message + setting
    `active_execution_id`) and for `manager.start_stream(stream, ...)`. This
    function must stay auth-agnostic — the identity is already baked into the
    project's on-disk `.databrickscfg` + `mode`/`target_deploy` the caller resolved.
    Extracted verbatim from invoke_agent so there is ONE persistence path (no drift).
    """
    from ..services.active_stream import MAX_EVENTS, _cap_event_data
    collected_events: deque = deque(maxlen=MAX_EVENTS)
    was_cancelled = False
    # execution_id is only needed for a log line; read it off the stream.
    execution_id = stream.execution_id

    async def _run_once(effective_session_id: str | None) -> None:
        nonlocal was_cancelled
        try:
            async for event in stream_agent_response(
                project_id=project_id,
                message=message,
                context_hint=context_hint,
                images=images,
                stream=stream,
                mode=mode,
                cluster_id=cluster_id,
                warehouse_id=warehouse_id,
                default_catalog=default_catalog,
                default_schema=default_schema,
                databricks_profile=databricks_profile,
                session_id=effective_session_id,
                template_lineage=template_lineage,
                operator_notice=operator_notice,
                target_deploy=target_deploy,
                project_mode=project_mode,
            ):
                collected_events.append(_cap_event_data(event))
        except asyncio.CancelledError:
            was_cancelled = True
            stream.is_cancelled = True
            logger.info(f"Agent execution {execution_id} cancelled by user")
            raise
        except Exception as e:
            logger.exception(f"Agent execution failed: {e}")
            stream.mark_error(str(e))

    nonlocal_session_id = session_id  # local mutable copy for the stale-retry path
    try:
        await _run_once(nonlocal_session_id)

        # Safety net for stale resume: if the SDK bailed because
        # project.session_id pointed at a transcript that no longer
        # exists on disk (e.g. transcript not yet restored from PG,
        # forked project, or CLAUDE_CONFIG_DIR introduced after the
        # session was created), clear the stale id and retry once
        # with a fresh session. Same execution_id, same SSE stream —
        # transparent to the client.
        if nonlocal_session_id and is_stale_session_error(stream.error_message):
            stale = nonlocal_session_id
            logger.warning(
                f"Stale session_id {stale} for project {project_id} — "
                f"clearing and retrying with a fresh session."
            )
            from sqlmodel import Session as SQLSession

            def _clear_stale() -> None:
                with SQLSession(engine) as db:
                    proj = db.get(Project, project_id)
                    if proj and proj.session_id == stale:
                        proj.session_id = None
                        db.add(proj)
                        db.commit()

            await asyncio.to_thread(_clear_stale)

            # Reset the stream's error state so the retry's events
            # aren't masked by the prior failure marker.
            stream.is_error = False
            stream.error_message = None
            collected_events.clear()
            nonlocal_session_id = None
            await _run_once(None)
    except asyncio.CancelledError:
        # Already handled inside _run_once; fall through to persist.
        pass

    # Save assistant response, session_id, and clear active_execution_id.
    # This runs even if the browser disconnected — the task is decoupled
    # from the SSE consumer. Always attempt to save: even when the text
    # response is empty (tool-heavy sessions that hit max turns), we still
    # need to persist the session_id so the next invocation can resume.
    # Runs on a worker thread because sync psycopg would otherwise block
    # the event loop (freezing every other SSE/HTTP request).
    try:
        full_response = collect_text_response(collected_events)
        reasoning = collect_reasoning(collected_events)

        from sqlmodel import Session as SQLSession

        def _persist_completion() -> None:
            with SQLSession(engine) as db:
                # Save assistant message if we got any text OR were cancelled
                # (so the partial reasoning + cancel marker survive refresh).
                if full_response or was_cancelled or reasoning:
                    raw_reasoning = {"reasoning": reasoning} if reasoning else None
                    reasoning_data = compress_reasoning(raw_reasoning)
                    # If the stream errored AFTER producing some text or
                    # reasoning, append the error to the body and flag
                    # is_error so the bubble renders red. Without this the
                    # partial answer would appear as a successful (but
                    # truncated) reply.
                    body_text = full_response
                    is_error_flag = bool(stream.is_error and stream.error_message)
                    if is_error_flag:
                        err = stream.error_message or "Agent error (no details)"
                        body_text = (
                            f"{body_text}\n\n---\n\n**Agent error:** {err}"
                            if body_text
                            else f"**Agent error:** {err}"
                        )
                    assistant_msg = Message(
                        project_id=project_id,
                        role="assistant",
                        content=body_text,
                        is_error=is_error_flag,
                        is_cancelled=was_cancelled,
                        reasoning_data=reasoning_data,
                    )
                    db.add(assistant_msg)
                elif stream.is_error and stream.error_message:
                    # The agent failed before producing any text or
                    # reasoning — typical when the Claude Code
                    # subprocess exits during connect/initialize.
                    # Persist as an assistant message with
                    # is_error=True so the chat bubble renders it
                    # with the destructive style on refresh (without
                    # is_error the bubble would render as a normal
                    # answer). Content uses the same shape the
                    # frontend builds at stream-end so the in-memory
                    # and reloaded views match.
                    error_msg = Message(
                        project_id=project_id,
                        role="assistant",
                        content=f"**Agent error:** {stream.error_message}",
                        is_error=True,
                        is_cancelled=False,
                    )
                    db.add(error_msg)
                else:
                    logger.warning(f"Agent returned empty text response for project {project_id}")

                # Persist session_id and clear active_execution_id
                proj = db.get(Project, project_id)
                if proj:
                    if stream.session_id:
                        proj.session_id = stream.session_id
                    proj.active_execution_id = None
                    proj.updated_at = utc_now()
                    # A turn that COMPLETED (not cancelled, no error) resets the
                    # boot-resume crash-loop guard — the conversation is healthy
                    # again. A cancelled/errored turn leaves the counter so a
                    # crash-looping turn still trips the cap. (getattr for the
                    # pre-migration case.)
                    if (
                        not was_cancelled
                        and not stream.is_error
                        and getattr(proj, "resume_attempts", 0)
                    ):
                        proj.resume_attempts = 0
                    db.add(proj)

                db.commit()

        await asyncio.to_thread(_persist_completion)

        if full_response:
            logger.info(f"Saved assistant message for project {project_id} ({len(full_response)} chars)")
        if stream.session_id:
            logger.info(f"Persisted session_id for project {project_id}: {stream.session_id}")
    except Exception as e:
        logger.exception(f"Failed to save agent response for project {project_id}: {e}")

    # Record the conversation's token usage (main + subagents) for the "$" chip.
    # Best-effort and AFTER persistence: a transcript problem never costs the reply.
    if stream.session_id:
        try:
            from ..services.agent_usage import ingest_session_from_disk
            await asyncio.to_thread(
                ingest_session_from_disk,
                engine, project_id, get_project_directory(project_id), stream.session_id,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[usage] ingest failed for project {project_id}: {e!r}")


@router.post(
    "/invoke_agent",
    response_model=InvokeAgentResponse,
    operation_id="invokeAgent",
)
async def invoke_agent(
    body: InvokeAgentRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """
    Start Claude Code agent execution.

    Saves user message and starts agent in background.
    Returns execution_id for streaming progress.
    """
    user_email = _get_user_email(headers)
    # Resolve auth mode once, here, while we still have the request headers.
    # See backend/AUTH.md — the mode dictates how the Claude subprocess
    # will authenticate to Databricks.
    mode = detect_mode(headers)

    # WRITE-ACCESS GATE — must run BEFORE any disk mutation below. Running the
    # agent mutates the project, so viewers are rejected here. Critically, this
    # also guards `write_project_auth_file`: without this gate a viewer's PAT
    # would be written into the OWNER's `<project>/.databrickscfg` before the
    # 403, swapping the identity the agent's `databricks` CLI runs as. Check
    # first, write nothing until it passes.
    await asyncio.to_thread(
        _require_write_access,
        session,
        body.project_id,
        user_email,
        config.template_admin_emails,
    )

    # NOTE: the DRIVER GATE (is_driver → claim) and the deployed `.databrickscfg`
    # refresh happen INSIDE the per-project lock below — check→claim→token-write
    # must be atomic, or two editors racing the first send on an unclaimed project
    # could both claim + both write their PAT. See the lock block.

    # Ensure the project directory + skills are on disk before we spawn the
    # agent. The common case is `getProject` already ran this on page load,
    # but a fresh container restart with a still-open browser tab will fire
    # `invoke_agent` directly (the stored execution-id reconnect path). The
    # skills tree is NEVER backed up to Lakebase — without this call the
    # agent runs without its skill set, and `.claude/projects/**` transcripts
    # may not yet be restored, breaking session resume.
    from .project_files import ensure_project_files_restored
    from pathlib import Path as _Path
    from ..services.skills_manager import PROJECTS_BASE_DIR
    _project_dir = _Path(PROJECTS_BASE_DIR) / body.project_id
    try:
        await asyncio.to_thread(
            ensure_project_files_restored,
            body.project_id,
            _project_dir,
            request.app.state.file_sync,
            session,
        )
    except Exception:
        logger.exception(
            "failed to ensure project files restored for %s", body.project_id
        )

    # (Driver gate + deployed token refresh moved inside the lock below.)

    # Pasted images → context/uploads/ (after the write gate). The message names
    # their paths, so the chat history shows them and later turns can re-open them.
    image_paths: list[str] = []
    message = body.message
    if body.images:
        from ..services import chat_images
        try:
            image_paths = await asyncio.to_thread(chat_images.save_images, _project_dir, body.images)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        message = "\n\n".join(p for p in (body.message.strip(), chat_images.attachment_note(image_paths)) if p)

    # DB reads (run on thread so we don't block the event loop on sync psycopg).
    def _load_initial():
        # Running the agent mutates the project (files, resources) — viewers
        # are blocked; owner/admin/editor allowed.
        project = _require_write_access(
            session, body.project_id, user_email, config.template_admin_emails
        )
        user = session.exec(select(User).where(User.email == user_email)).first()
        databricks_profile = user.databricks_profile if user else "DEFAULT"
        # Look up template lineage so the system prompt can frame the agent
        # as adapting an existing demo rather than authoring from scratch.
        template_lineage = None
        if project.source_template_id:
            tpl = session.get(Template, project.source_template_id)
            if tpl:
                try:
                    caps = json.loads(tpl.capabilities) if tpl.capabilities else []
                except (json.JSONDecodeError, TypeError):
                    caps = []
                template_lineage = {
                    "name": tpl.name,
                    "industry": tpl.industry,
                    "capabilities": caps,
                }
        # Deploy target — PER-PROJECT PINNED (frozen at first deploy). Resolved
        # while the session is live so the background task can use it after the
        # request session closes. On a project's first deploy it's still unpinned
        # here (the driver-gate below pins it inside the lock); resolve_project_target
        # falls back to the live per-user setting in that case, and to the pin on
        # every subsequent turn — so an account-setting change never redirects an
        # already-started project.
        effective_target = (
            _user_target.resolve_project_target(
                project=project,
                user_email=user_email,
                session=session,
                config=config,
            )
            if _user_target is not None
            else None
        )
        return project, databricks_profile, template_lineage, effective_target

    project, databricks_profile, template_lineage, effective_target = await asyncio.to_thread(_load_initial)

    manager = get_stream_manager()

    # Per-project lock prevents two concurrent POSTs from both creating agents
    # (e.g. browser refresh races between reconnect and autoKick effects).
    async with manager.get_project_lock(body.project_id):
        # Check for existing running execution.
        existing_stream = manager.get_project_stream(body.project_id)
        if existing_stream:
            # A turn is already in flight for this project. There are two callers:
            #   • A RECONNECT (resume/autoKick paths) — the client just wants to
            #     re-attach to the running turn and does NOT carry a new user
            #     message (`save_user_message=False`). Hand back the live
            #     execution_id; that's the correct, idempotent behavior.
            #   • A genuine NEW turn (`save_user_message=True`) sent while turn 1
            #     is still running — this happens when the UI briefly re-enabled
            #     the composer during an SSE drop (the orphan-return window). If we
            #     returned the existing execution_id here we would SILENTLY DROP
            #     this message: it's never persisted and never delivered to the
            #     SDK client, so the user sees only turn 1's answer and thinks they
            #     had to "send twice". Reject it loudly instead (409) + save it as
            #     a visible marker so nothing is lost. Mirrors the stale-token 409.
            if not body.save_user_message:
                return InvokeAgentResponse(
                    execution_id=existing_stream.execution_id,
                    project_id=body.project_id,
                )

            def _save_dropped_message() -> None:
                # Persist the un-sent user message so it survives + is visible,
                # then an assistant note explaining it wasn't delivered. Without
                # this the text vanishes entirely on a dropped send.
                session.add(
                    Message(
                        project_id=body.project_id,
                        role="user",
                        content=message,
                        context_hint=body.context_hint,
                    )
                )
                session.add(
                    Message(
                        project_id=body.project_id,
                        role="assistant",
                        content=(
                            "The previous turn was still running, so this message "
                            "wasn't sent. It's saved above — resend it once the "
                            "current turn finishes."
                        ),
                        is_error=True,
                    )
                )
                session.commit()

            await asyncio.to_thread(_save_dropped_message)
            raise HTTPException(
                status_code=409,
                detail=(
                    "A turn is already running for this project. Your message was "
                    "saved but not sent — wait for the current turn to finish, then "
                    "resend."
                ),
            )

        # DRIVER GATE + token refresh — INSIDE the lock so check→claim→write is
        # atomic. Two cases:
        #   • Caller IS the driver (or unclaimed): claim (sticky) and, in deployed
        #     mode, refresh <project>/.databrickscfg to their PAT + stamp the
        #     freshness clock. Normal path.
        #   • Caller is NOT the driver: they may STILL run the agent on the
        #     driver's existing token WHILE IT'S FRESH — we do NOT write their PAT
        #     and do NOT claim (only the driver's browser can mint a token). But
        #     if the driver's token is STALE, block with a 409 (+ saved message):
        #     nobody can refresh it but the driver, so a run would 401 mid-way.
        handoff_notice: str | None = None

        def _driver_gate_and_token() -> None:
            nonlocal handoff_notice
            proj = session.get(Project, body.project_id)

            # ── SP MODE: the whole driver model is bypassed ──────────────────
            # A cross-workspace project authenticates as the deployer SP (oauth-m2m,
            # non-expiring machine creds), NOT a per-user OBO PAT. The driver dance
            # (claim / token-freshness 409 / take-over / handoff) exists only to
            # manage a per-user PAT (see AUTH.md "Conversation driver") and is
            # meaningless here — there's one identity and nothing to take over. So
            # we just (re)write the SP `.databrickscfg` and stamp the sentinel; no
            # claim, no freshness gate, no handoff. This is also what makes an
            # interrupted SP turn RESUMABLE on boot (services/resume_agent) — the
            # SP creds are always present, unlike a dead OBO token.
            if project_runs_as_sp(config, proj):
                try:
                    wrote = write_project_databrickscfg(
                        get_project_directory(body.project_id),
                        config=config,
                        target_workspace_host=getattr(proj, "target_workspace_host", None),
                        user_pat=None,   # SP path ignores these; creds come from config
                        user_host=None,
                    )
                    if wrote is None:
                        logger.warning(
                            "invoke_agent SP-mode project %s but no SP .databrickscfg "
                            "written (deployer SP creds missing?)",
                            body.project_id,
                        )
                except Exception:
                    logger.exception(
                        "failed to write SP .databrickscfg for project %s",
                        body.project_id,
                    )
                # Stamp the SP sentinel so active_driver_email stays meaningful/
                # queryable (never used to gate anything in SP mode). Clear any
                # stale handoff flag from a prior OBO life so it can't fire.
                if proj is not None and (
                    proj.active_driver_email != SP_DRIVER_SENTINEL
                    or proj.driver_handoff_pending
                ):
                    proj.active_driver_email = SP_DRIVER_SENTINEL
                    proj.driver_handoff_pending = False
                    session.add(proj)
                    session.commit()
                return

            # ── OBO MODE (classic per-user driver model) ─────────────────────
            # Consume a pending take-over handoff → tell Claude ONCE on this turn
            # (folded into the query in stream_agent_response). Clear the flag so
            # it never repeats. Whoever runs the next turn delivers the notice.
            if proj is not None and proj.driver_handoff_pending:
                handoff_notice = (
                    f"[System note] The operator of this conversation changed — the "
                    f"agent's Databricks CLI now runs on behalf of {proj.active_driver_email}. "
                    f"No action required; continue as normal."
                )
                proj.driver_handoff_pending = False
                session.add(proj)
                session.commit()

            if is_driver(session, body.project_id, user_email):
                claim_driver(session, body.project_id, user_email)
                if mode == "deployed":
                    pat = request_user_pat(headers)
                    host = resolve_host(headers)
                    # Deploy target is PINNED per-project: frozen at first deploy,
                    # immutable after. resolve_project_target returns the project's
                    # pinned host if set, else the live per-user setting (first
                    # deploy / legacy). We then FREEZE it onto the project so any
                    # later account-setting change can't redirect THIS project's
                    # future turns (the mid-build target-swap bug).
                    proj_for_target = session.get(Project, body.project_id)
                    if _user_target is not None:
                        # LEGACY GUARD: a project that already has built resources
                        # but no pinned target is a pre-Model-3 project — its
                        # resources live on the app's OWN workspace. Detect that
                        # (cheap DB+JSON check) so the target resolves to the
                        # app-own host instead of the user's live remote pick.
                        # Shared resolve-AND-pin: we're the driver here (inside the
                        # claim block) so can_pin=True — this is the authoritative
                        # freeze point that the tile + .databrickscfg readers honor.
                        has_built = _user_target.project_has_built_resources(
                            request.app.state.file_sync, body.project_id, session=session
                        )
                        target_host = _user_target.resolve_and_pin_project_target(
                            project=proj_for_target,
                            user_email=user_email,
                            session=session,
                            config=config,
                            has_built_resources=has_built,
                            can_pin=True,
                        )
                    else:
                        target_host = None  # generic build — always same-workspace
                    try:
                        wrote = write_project_databrickscfg(
                            get_project_directory(body.project_id),
                            config=config,
                            target_workspace_host=target_host,
                            user_pat=pat,
                            user_host=host,
                        )
                        if wrote is None and pat:
                            logger.warning(
                                "invoke_agent in deployed mode but no .databrickscfg "
                                "written (no resolvable host / missing target creds) "
                                "for project %s",
                                body.project_id,
                            )
                    except Exception:
                        logger.exception(
                            "failed to refresh .databrickscfg for project %s",
                            body.project_id,
                        )
                return

            # Non-driver: allowed only while the driver's token is still fresh.
            driver = active_driver(session, body.project_id)
            if driver_token_expired(session, body.project_id):
                session.add(
                    Message(
                        project_id=body.project_id,
                        role="assistant",
                        content=(
                            f"**{driver}**'s session token has expired. Ask them to "
                            f"reopen the project to refresh it, or take over to run "
                            f"the agent under your own identity."
                        ),
                        is_error=True,
                    )
                )
                session.commit()
                raise HTTPException(
                    status_code=409,
                    detail=f"{driver}'s token expired. Ask them to refresh, or take over.",
                )
            # Fresh → run on the driver's token untouched (no write, no claim).

        await asyncio.to_thread(_driver_gate_and_token)

        # Use session_id from project (simpler than Execution table)
        session_id = project.session_id
        if session_id:
            logger.info(f"Resuming session for project {body.project_id}: {session_id}")

        # Save user message + execution_id. Runs on a worker thread to keep the
        # event loop free while psycopg is waiting on PG.
        execution_id = generate_uuid()
        stream = manager.create_stream(execution_id, body.project_id)

        def _persist_start():
            if body.save_user_message:
                user_msg = Message(
                    project_id=body.project_id,
                    role="user",
                    content=message,
                    context_hint=body.context_hint,
                )
                session.add(user_msg)
                session.commit()
            project.active_execution_id = execution_id
            project.updated_at = utc_now()
            session.add(project)
            session.commit()

        await asyncio.to_thread(_persist_start)

    # Capture engine reference for use in background task (request session
    # will be closed by the time the completion code executes)
    engine = request.app.state.engine
    _target_deploy = target_deploy_active(config, effective_target)

    # Start the shared background turn-runner (the SINGLE persistence path — same
    # helper the boot-time resume service uses). Bind the request-resolved values
    # into a zero-arg coroutine for start_stream.
    async def run_agent():
        await run_agent_turn(
            project_id=body.project_id,
            message=message,
            stream=stream,
            engine=engine,
            mode=mode,
            context_hint=body.context_hint,
            images=image_paths or None,
            cluster_id=project.cluster_id,
            warehouse_id=project.warehouse_id,
            default_catalog=project.default_catalog,
            default_schema=project.default_schema,
            databricks_profile=databricks_profile,
            session_id=session_id,
            template_lineage=template_lineage,
            operator_notice=handoff_notice,
            target_deploy=_target_deploy,
            project_mode=project.mode,
        )

    await manager.start_stream(stream, run_agent)

    logger.info(f"Started agent execution {execution_id} for project {body.project_id}")
    return InvokeAgentResponse(execution_id=execution_id, project_id=body.project_id)


class StreamProgressRequest(BaseModel):
    """Request body for stream_progress (allows cursor in body)."""
    last_timestamp: float = 0.0


@router.post(
    "/stream_progress/{execution_id}",
    operation_id="streamProgress",
)
async def stream_progress(
    execution_id: str,
    body: StreamProgressRequest = StreamProgressRequest(),
):
    """
    SSE stream of agent events with cursor-based pagination.

    Streams events until completion, cancellation, or 50-second window timeout.
    Client should reconnect with last cursor on window timeout.
    """
    manager = get_stream_manager()
    stream = manager.get_stream(execution_id)

    if not stream:
        raise HTTPException(status_code=404, detail="Execution not found")

    async def generate_events():
        cursor = body.last_timestamp
        start_time = time.time()
        # Once the agent flips `is_complete` we may still be waiting on the
        # narrative regen (kicked off by the watcher when README.md lands).
        # We capture the time at which we'd otherwise emit `stream.completed`
        # and keep draining events until either narrative_pending clears or
        # this grace window expires.
        completion_started_at: float | None = None
        NARRATIVE_GRACE_SECONDS = 15.0

        while True:
            # Get new events since cursor
            new_events, new_cursor = stream.get_events_since(cursor)
            cursor = new_cursor

            # Yield each event as SSE
            for event in new_events:
                yield f"data: {json.dumps(event)}\n\n"

            terminal = stream.is_complete or stream.is_cancelled or stream.is_error

            # If we just hit terminal, start the grace clock (don't restart it).
            if terminal and completion_started_at is None:
                completion_started_at = time.time()
                if stream.narrative_pending:
                    logger.info(
                        f"[stream_progress] {execution_id}: agent terminal "
                        f"but narrative_pending — holding SSE open up to "
                        f"{NARRATIVE_GRACE_SECONDS}s for narrative_updated"
                    )

            # Wait out the narrative if it's pending and we still have grace.
            if (
                terminal
                and stream.narrative_pending
                and completion_started_at is not None
                and (time.time() - completion_started_at) < NARRATIVE_GRACE_SECONDS
            ):
                await asyncio.sleep(POLL_INTERVAL)
                continue

            # Check for completion
            if terminal:
                if stream.narrative_pending:
                    logger.warning(
                        f"[stream_progress] {execution_id}: grace expired with "
                        f"narrative_pending still set — closing stream anyway"
                    )
                completion_event = {
                    "type": "stream.completed",
                    "is_error": stream.is_error,
                    "is_cancelled": stream.is_cancelled,
                }
                yield f"data: {json.dumps(completion_event)}\n\n"
                yield "data: [DONE]\n\n"
                break

            # Check window timeout (reconnect before HTTP timeout)
            elapsed = time.time() - start_time
            if elapsed > SSE_WINDOW_SECONDS:
                reconnect_event = {
                    "type": "stream.reconnect",
                    "execution_id": execution_id,
                    "last_timestamp": cursor,
                }
                yield f"data: {json.dumps(reconnect_event)}\n\n"
                break

            # Poll interval
            await asyncio.sleep(POLL_INTERVAL)

    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.post(
    "/stop_stream/{execution_id}",
    operation_id="stopStream",
)
async def stop_stream(
    execution_id: str,
    session: Dependencies.Session,
):
    """Cancel a running agent execution."""
    manager = get_stream_manager()
    stream = manager.get_stream(execution_id)

    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    # Mark stream as cancelled
    stream.is_cancelled = True

    # Cancel the task if running
    if stream.task and not stream.task.done():
        stream.task.cancel()

    # Clear the DB flag so a new execution can start. Run on a worker thread —
    # sync psycopg would otherwise block the event loop.
    def _clear_active_execution() -> None:
        project = session.get(Project, stream.project_id)
        if project and project.active_execution_id == execution_id:
            project.active_execution_id = None
            project.updated_at = utc_now()
            session.add(project)
            session.commit()

    await asyncio.to_thread(_clear_active_execution)

    logger.info(f"Cancelled execution {execution_id}")
    return {"success": True, "execution_id": execution_id}


class ActiveExecutionOut(BaseModel):
    """Simple response for active execution check."""
    execution_id: str
    project_id: str
    is_running: bool


@router.get(
    "/projects/{project_id}/execution",
    response_model=ActiveExecutionOut | None,
    operation_id="getActiveExecution",
)
async def get_active_execution(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Get the active (running) execution for a project, if any.

    Checks in-memory streams first. If none found but the DB has an
    active_execution_id, the server restarted mid-execution — clear
    the stale flag and return None so the frontend can recover.
    """
    manager = get_stream_manager()
    stream = manager.get_project_stream(project_id)

    if stream:
        return ActiveExecutionOut(
            execution_id=stream.execution_id,
            project_id=stream.project_id,
            is_running=not stream.is_complete and not stream.is_cancelled and not stream.is_error,
        )

    # No in-memory stream — check if DB still thinks one is running
    # (server restarted mid-execution). Clear the stale flag. Run on a
    # worker thread so psycopg doesn't block the event loop.
    def _clear_stale_flag() -> None:
        project = session.get(Project, project_id)
        if project and project.active_execution_id:
            logger.warning(
                f"Clearing stale active_execution_id for project {project_id} "
                f"(execution {project.active_execution_id} lost on server restart)"
            )
            project.active_execution_id = None
            project.updated_at = utc_now()
            session.add(project)
            session.commit()

    await asyncio.to_thread(_clear_stale_flag)

    return None
