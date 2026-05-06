"""Project messages CRUD endpoints."""

from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import select

from ..core import Dependencies, create_router
from ..core.auth import is_admin
from ..models import (
    Message,
    MessageCreateRequest,
    MessageOut,
    Project,
    decompress_reasoning,
)
from ..services.agent import get_client_pool

router = create_router()


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


def _get_readable_project(
    session, project_id: str, user_email: str, admin_emails: list[str]
) -> Project:
    """Owner-or-admin read access. Use only on read endpoints."""
    row = session.get(Project, project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    if row.user_email == user_email or is_admin(user_email, admin_emails):
        return row
    raise HTTPException(status_code=404, detail="Project not found")


@router.get(
    "/projects/{project_id}/messages",
    response_model=list[MessageOut],
    operation_id="listProjectMessages",
)
def list_project_messages(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    limit: int = 50,
):
    """List recent messages for a project, oldest first (limited to last N messages).

    Excludes `reasoning_data` from the response — it can be hundreds of KB per
    assistant message and is only needed when the user expands the "Reasoning"
    toggle. Clients should fetch it lazily via `GET /messages/{id}/reasoning`.
    `has_reasoning: bool` tells the UI whether the toggle should appear.
    """
    user_email = _get_user_email(headers)
    _get_readable_project(
        session, project_id, user_email, config.template_admin_emails
    )

    # Project specific columns — skipping `reasoning_data` means PG doesn't
    # stream potentially-MBs of compressed blobs to the app. We compute
    # has_reasoning as a boolean from the column's NULL-ness.
    stmt = (
        select(
            Message.id,
            Message.project_id,
            Message.role,
            Message.content,
            Message.is_error,
            Message.is_cancelled,
            (Message.reasoning_data.isnot(None)).label("has_reasoning"),  # type: ignore[attr-defined]
            Message.created_at,
        )
        .where(Message.project_id == project_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    rows = list(reversed(session.exec(stmt).all()))

    return [
        MessageOut(
            id=row.id,
            project_id=row.project_id,
            role=row.role,
            content=row.content,
            is_error=row.is_error,
            is_cancelled=row.is_cancelled,
            has_reasoning=bool(row.has_reasoning),
            reasoning_data=None,  # Fetched lazily via /messages/{id}/reasoning.
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get(
    "/messages/{message_id}/reasoning",
    operation_id="getMessageReasoning",
)
def get_message_reasoning(
    message_id: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Fetch and decompress reasoning for a single message.

    Called on demand when the user expands the "Reasoning" toggle. Verified via
    the owning project's user_email (or admin).
    """
    user_email = _get_user_email(headers)

    # One projected query that also joins the project to check ownership.
    row = session.exec(
        select(Message.project_id, Message.reasoning_data).where(Message.id == message_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")

    project_id, reasoning_bytes = row
    _get_readable_project(
        session, project_id, user_email, config.template_admin_emails
    )

    return {"reasoning_data": decompress_reasoning(reasoning_bytes)}


@router.post(
    "/projects/{project_id}/messages",
    response_model=MessageOut,
    operation_id="addProjectMessage",
)
def add_project_message(
    project_id: str,
    body: MessageCreateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Add a new message to a project."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    msg = Message(
        project_id=project_id,
        role=body.role,
        content=body.content,
        is_error=body.is_error,
    )
    session.add(msg)
    session.commit()
    session.refresh(msg)

    return MessageOut(
        id=msg.id,
        project_id=msg.project_id,
        role=msg.role,
        content=msg.content,
        is_error=msg.is_error,
        is_cancelled=msg.is_cancelled,
        created_at=msg.created_at,
    )


@router.delete(
    "/projects/{project_id}/messages",
    operation_id="clearProjectMessages",
)
def clear_project_messages(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Delete all messages for a project."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    messages = session.exec(
        select(Message).where(Message.project_id == project_id)
    ).all()

    for msg in messages:
        session.delete(msg)

    session.commit()

    return {"success": True, "deleted_count": len(messages)}


@router.post(
    "/projects/{project_id}/session/clear",
    operation_id="clearProjectSession",
)
async def clear_project_session(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Clear project session: delete all messages, drop the SDK client,
    and clear `project.session_id` so the next turn starts a brand-new
    server-side conversation (no `options.resume`).

    Three pieces of state get reset, in this order:
      - All `messages` rows for the project (DB).
      - `project.session_id` set to NULL — without this, routes/agent.py
        keeps passing the old session_id into options.resume and the model
        keeps replying in the prior conversation despite us pulling the
        local client.
      - The pooled SDK client (its subprocess + in-process state).
    """
    import asyncio
    user_email = _get_user_email(headers)

    # DB work on a worker thread — sync psycopg would otherwise block the loop.
    def _reset_db_state() -> int:
        project = _get_user_project(session, project_id, user_email)
        messages = session.exec(
            select(Message).where(Message.project_id == project_id)
        ).all()
        for msg in messages:
            session.delete(msg)
        # Forget the prior server-side session so the next turn is fresh.
        project.session_id = None
        session.add(project)
        session.commit()
        return len(messages)

    deleted_count = await asyncio.to_thread(_reset_db_state)

    # Remove client from pool (this clears the local SDK session).
    pool = get_client_pool()
    await pool.remove_client(project_id)

    return {"success": True, "deleted_count": deleted_count}
