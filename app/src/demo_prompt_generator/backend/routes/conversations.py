from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import (
    ChatMessage,
    ChatMessageRecord,
    Conversation,
    ConversationOut,
    ConversationWithMessages,
    Generation,
    SaveMessagesRequest,
)

router = create_router()


@router.get(
    "/conversations",
    response_model=list[ConversationOut],
    operation_id="listConversations",
)
def list_conversations(
    session: Dependencies.Session,
    generation_id: int | None = None,
):
    """List conversations, optionally filtered by generation_id."""
    stmt = select(Conversation).order_by(Conversation.updated_at.desc())  # type: ignore[attr-defined]
    if generation_id is not None:
        stmt = stmt.where(Conversation.generation_id == generation_id)
    rows = session.exec(stmt).all()
    return [
        ConversationOut(
            id=r.id,  # type: ignore[arg-type]
            generation_id=r.generation_id,
            title=r.title,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationWithMessages,
    operation_id="getConversation",
)
def get_conversation(
    conversation_id: int,
    session: Dependencies.Session,
):
    """Get a conversation with all its messages."""
    conv = session.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(ChatMessageRecord)
        .where(ChatMessageRecord.conversation_id == conversation_id)
        .order_by(ChatMessageRecord.created_at.asc())  # type: ignore[attr-defined]
    )
    msgs = session.exec(stmt).all()

    return ConversationWithMessages(
        id=conv.id,  # type: ignore[arg-type]
        generation_id=conv.generation_id,
        title=conv.title,
        messages=[ChatMessage(role=m.role, content=m.content) for m in msgs],
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


@router.post(
    "/conversations/save",
    response_model=ConversationOut,
    operation_id="saveConversation",
)
def save_conversation(
    req: SaveMessagesRequest,
    session: Dependencies.Session,
):
    """Save or update conversation messages for a generation.

    Creates a new conversation if none exists, or replaces messages
    in the existing one. This is an idempotent "sync" operation.
    """
    gen = session.get(Generation, req.generation_id)
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    # Find existing conversation for this generation or create one
    stmt = (
        select(Conversation)
        .where(Conversation.generation_id == req.generation_id)
        .order_by(Conversation.updated_at.desc())  # type: ignore[attr-defined]
    )
    conv = session.exec(stmt).first()

    if not conv:
        conv = Conversation(
            generation_id=req.generation_id,
            title=gen.demo_name or "Untitled",
        )
        session.add(conv)
        session.commit()
        session.refresh(conv)

    # Delete existing messages and replace with new set
    old_msgs = session.exec(
        select(ChatMessageRecord).where(
            ChatMessageRecord.conversation_id == conv.id
        )
    ).all()
    for m in old_msgs:
        session.delete(m)

    for msg in req.messages:
        record = ChatMessageRecord(
            conversation_id=conv.id,  # type: ignore[arg-type]
            role=msg.role,
            content=msg.content,
        )
        session.add(record)

    conv.updated_at = datetime.now(timezone.utc)
    conv.title = gen.demo_name or "Untitled"
    session.add(conv)
    session.commit()
    session.refresh(conv)

    return ConversationOut(
        id=conv.id,  # type: ignore[arg-type]
        generation_id=conv.generation_id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


@router.delete(
    "/conversations/{conversation_id}",
    operation_id="deleteConversation",
)
def delete_conversation(
    conversation_id: int,
    session: Dependencies.Session,
):
    """Delete a conversation and all its messages."""
    conv = session.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs = session.exec(
        select(ChatMessageRecord).where(
            ChatMessageRecord.conversation_id == conversation_id
        )
    ).all()
    for m in msgs:
        session.delete(m)

    session.delete(conv)
    session.commit()

    return {"ok": True}
