"""Project messages CRUD endpoints."""

from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import select

from ..core import Dependencies, create_router
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


@router.get(
    "/projects/{project_id}/messages",
    response_model=list[MessageOut],
    operation_id="listProjectMessages",
)
def list_project_messages(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    limit: int = 50,
):
    """List recent messages for a project, oldest first (limited to last N messages)."""
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    # Get the last N messages by ordering DESC, limiting, then reversing
    stmt = (
        select(Message)
        .where(Message.project_id == project_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = list(reversed(session.exec(stmt).all()))

    return [
        MessageOut(
            id=msg.id,
            project_id=msg.project_id,
            role=msg.role,
            content=msg.content,
            is_error=msg.is_error,
            reasoning_data=decompress_reasoning(msg.reasoning_data),
            created_at=msg.created_at,
        )
        for msg in messages
    ]


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
    """Clear project session: delete all messages and reset Claude SDK client.

    This completely resets the conversation state:
    - Deletes all messages from the database
    - Removes the Claude SDK client from the pool (clears session memory)
    """
    user_email = _get_user_email(headers)
    _get_user_project(session, project_id, user_email)

    # Delete all messages
    messages = session.exec(
        select(Message).where(Message.project_id == project_id)
    ).all()

    for msg in messages:
        session.delete(msg)

    session.commit()

    # Remove client from pool (this clears the SDK session)
    pool = get_client_pool()
    await pool.remove_client(project_id)

    return {"success": True, "deleted_count": len(messages)}
