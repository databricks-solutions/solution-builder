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

from fastapi import HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select
from ..core import Dependencies, create_router
from ..core._config import logger
from ..core.auth import (
    detect_mode,
    request_user_pat,
    resolve_host,
    write_project_auth_file,
)
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
from .projects import _require_write_access

router = create_router()

# Constants
SSE_WINDOW_SECONDS = 50  # Reconnect before 60s HTTP timeout
POLL_INTERVAL = 0.1  # seconds between event checks

# Strong refs to fire-and-forget background tasks (e.g. customer inference) so
# the event loop doesn't garbage-collect them mid-flight.
_CUSTOMER_TASKS: set[asyncio.Task] = set()


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


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
    # Deployed mode: refresh <project>/.databrickscfg from the current PAT
    # before spawn so the subprocess starts with a fresh token. No-op in
    # local mode. Non-fatal if it fails.
    if mode == "deployed":
        pat = request_user_pat(headers)
        host = resolve_host(headers)
        if pat and host:
            try:
                write_project_auth_file(
                    get_project_directory(body.project_id), host, pat
                )
            except Exception:
                logger.exception(
                    "failed to refresh .databrickscfg for project %s",
                    body.project_id,
                )
        elif pat:
            logger.warning(
                "invoke_agent in deployed mode without resolvable host — "
                ".databrickscfg not refreshed"
            )
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
        return project, databricks_profile, template_lineage

    project, databricks_profile, template_lineage = await asyncio.to_thread(_load_initial)

    manager = get_stream_manager()

    # Per-project lock prevents two concurrent POSTs from both creating agents
    # (e.g. browser refresh races between reconnect and autoKick effects).
    async with manager.get_project_lock(body.project_id):
        # Check for existing running execution
        existing_stream = manager.get_project_stream(body.project_id)
        if existing_stream:
            return InvokeAgentResponse(
                execution_id=existing_stream.execution_id,
                project_id=body.project_id,
            )

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
                    content=body.message,
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
    # will be closed by the time run_agent's completion code executes)
    engine = request.app.state.engine

    # Start agent in background
    async def run_agent():
        nonlocal session_id
        collected_events = []
        was_cancelled = False

        async def _run_once(effective_session_id: str | None) -> None:
            nonlocal was_cancelled
            try:
                async for event in stream_agent_response(
                    project_id=body.project_id,
                    message=body.message,
                    context_hint=body.context_hint,
                    stream=stream,
                    mode=mode,
                    cluster_id=project.cluster_id,
                    warehouse_id=project.warehouse_id,
                    default_catalog=project.default_catalog,
                    default_schema=project.default_schema,
                    databricks_profile=databricks_profile,
                    session_id=effective_session_id,
                    template_lineage=template_lineage,
                ):
                    collected_events.append(event)
            except asyncio.CancelledError:
                was_cancelled = True
                stream.is_cancelled = True
                logger.info(f"Agent execution {execution_id} cancelled by user")
                raise
            except Exception as e:
                logger.exception(f"Agent execution failed: {e}")
                stream.mark_error(str(e))

        try:
            await _run_once(session_id)

            # Safety net for stale resume: if the SDK bailed because
            # project.session_id pointed at a transcript that no longer
            # exists on disk (e.g. transcript not yet restored from PG,
            # forked project, or CLAUDE_CONFIG_DIR introduced after the
            # session was created), clear the stale id and retry once
            # with a fresh session. Same execution_id, same SSE stream —
            # transparent to the client.
            if session_id and is_stale_session_error(stream.error_message):
                stale = session_id
                logger.warning(
                    f"Stale session_id {stale} for project {body.project_id} — "
                    f"clearing and retrying with a fresh session."
                )
                from sqlmodel import Session as SQLSession

                def _clear_stale() -> None:
                    with SQLSession(engine) as db:
                        proj = db.get(Project, body.project_id)
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
                session_id = None
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
                            project_id=body.project_id,
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
                            project_id=body.project_id,
                            role="assistant",
                            content=f"**Agent error:** {stream.error_message}",
                            is_error=True,
                            is_cancelled=False,
                        )
                        db.add(error_msg)
                    else:
                        logger.warning(f"Agent returned empty text response for project {body.project_id}")

                    # Persist session_id and clear active_execution_id
                    proj = db.get(Project, body.project_id)
                    if proj:
                        if stream.session_id:
                            proj.session_id = stream.session_id
                        proj.active_execution_id = None
                        proj.updated_at = utc_now()
                        db.add(proj)

                    db.commit()

            await asyncio.to_thread(_persist_completion)

            # Fire-and-forget: infer the customer/account this demo is for from
            # the conversation (mini model, only while still unset). Kept in a
            # tracked task set so it isn't GC'd; never blocks the chat flow.
            try:
                from ..services.customer_extraction import maybe_update_project_customer
                _t = asyncio.create_task(
                    asyncio.to_thread(
                        maybe_update_project_customer, body.project_id, engine, config
                    )
                )
                _CUSTOMER_TASKS.add(_t)
                _t.add_done_callback(_CUSTOMER_TASKS.discard)
            except Exception:
                logger.debug("failed to schedule customer inference", exc_info=True)

            if full_response:
                logger.info(f"Saved assistant message for project {body.project_id} ({len(full_response)} chars)")
            if stream.session_id:
                logger.info(f"Persisted session_id for project {body.project_id}: {stream.session_id}")
        except Exception as e:
            logger.exception(f"Failed to save agent response for project {body.project_id}: {e}")

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
