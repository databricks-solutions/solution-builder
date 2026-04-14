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
from ..models import (
    InvokeAgentRequest,
    InvokeAgentResponse,
    Message,
    Project,
    User,
    generate_uuid,
    utc_now,
)
from ..services.active_stream import get_stream_manager
from ..services.agent import collect_text_response, collect_reasoning, stream_agent_response

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


def _get_user_project(session, project_id: str, user_email: str) -> Project:
    """Fetch a project by ID, verifying ownership."""
    row = session.get(Project, project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    if row.user_email != user_email:
        raise HTTPException(status_code=404, detail="Project not found")
    return row


@router.post(
    "/invoke_agent",
    response_model=InvokeAgentResponse,
    operation_id="invokeAgent",
)
async def invoke_agent(
    body: InvokeAgentRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
):
    """
    Start Claude Code agent execution.

    Saves user message and starts agent in background.
    Returns execution_id for streaming progress.
    """
    user_email = _get_user_email(headers)
    project = _get_user_project(session, body.project_id, user_email)

    # Get user's Databricks profile
    user = session.exec(select(User).where(User.email == user_email)).first()
    databricks_profile = user.databricks_profile if user else "DEFAULT"

    # Check for existing running execution
    manager = get_stream_manager()
    existing_stream = manager.get_project_stream(body.project_id)
    if existing_stream:
        # Return existing execution if still running
        return InvokeAgentResponse(
            execution_id=existing_stream.execution_id,
            project_id=body.project_id,
        )

    # Use session_id from project (simpler than Execution table)
    session_id = project.session_id
    if session_id:
        logger.info(f"Resuming session for project {body.project_id}: {session_id}")

    # Save user message
    execution_id = generate_uuid()
    user_msg = Message(
        project_id=body.project_id,
        role="user",
        content=body.message,
    )
    session.add(user_msg)
    session.commit()

    # Create stream
    stream = manager.create_stream(execution_id, body.project_id)

    # Capture engine reference for use in background task (request session
    # will be closed by the time run_agent's completion code executes)
    engine = request.app.state.engine


    # Start agent in background
    async def run_agent():
        collected_events = []
        try:
            async for event in stream_agent_response(
                project_id=body.project_id,
                message=body.message,
                stream=stream,
                cluster_id=project.cluster_id,
                warehouse_id=project.warehouse_id,
                default_catalog=project.default_catalog,
                default_schema=project.default_schema,
                databricks_profile=databricks_profile,
                session_id=session_id,
            ):
                collected_events.append(event)
        except Exception as e:
            logger.exception(f"Agent execution failed: {e}")
            return

        # Save assistant response and session_id after completion.
        # This runs even if the browser disconnected — the task is decoupled
        # from the SSE consumer.
        try:
            full_response = collect_text_response(collected_events)
            reasoning = collect_reasoning(collected_events)
            if full_response:
                from sqlmodel import Session as SQLSession
                with SQLSession(engine) as db:
                    reasoning_data = {"reasoning": reasoning} if reasoning else None
                    assistant_msg = Message(
                        project_id=body.project_id,
                        role="assistant",
                        content=full_response,
                        reasoning_data=reasoning_data,
                    )
                    db.add(assistant_msg)

                    if stream.session_id:
                        proj = db.get(Project, body.project_id)
                        if proj:
                            proj.session_id = stream.session_id
                            proj.updated_at = utc_now()
                            db.add(proj)

                    db.commit()
                    logger.info(f"Saved assistant message for project {body.project_id} ({len(full_response)} chars)")
            else:
                logger.warning(f"Agent returned empty response for project {body.project_id}")
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

        while True:
            # Get new events since cursor
            new_events, new_cursor = stream.get_events_since(cursor)
            cursor = new_cursor

            # Yield each event as SSE
            for event in new_events:
                yield f"data: {json.dumps(event)}\n\n"

            # Check for completion
            if stream.is_complete or stream.is_cancelled or stream.is_error:
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
async def stop_stream(execution_id: str):
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
    headers: Dependencies.Headers,
):
    """Get the active (running) execution for a project, if any."""
    # Just check in-memory stream manager - no DB needed
    manager = get_stream_manager()
    stream = manager.get_project_stream(project_id)

    if stream:
        return ActiveExecutionOut(
            execution_id=stream.execution_id,
            project_id=stream.project_id,
            is_running=not stream.is_complete and not stream.is_cancelled and not stream.is_error,
        )

    return None
