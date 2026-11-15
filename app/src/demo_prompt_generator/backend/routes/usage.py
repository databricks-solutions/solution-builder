"""GET /projects/{id}/usage — tokens + cost of a project's agent conversations."""

from __future__ import annotations

import asyncio

from fastapi import Request
from sqlmodel import Session as SQLSession, select

from ..core import Dependencies, create_router
from ..core._config import logger
from ..models import AgentUsage, ProjectUsageOut
from ..services import agent_usage
from ..services.skills_manager import get_project_directory
from .messages import _get_user_email
from .projects import _get_authorized_project

router = create_router()


@router.get(
    "/projects/{project_id}/usage",
    response_model=ProjectUsageOut,
    operation_id="getProjectUsage",
)
async def get_project_usage(
    project_id: str,
    request: Request,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Every conversation of the project (cleared chats included), main agent +
    subagents, priced at list price. Turn ends record usage; this also backfills
    conversations that predate the table and refreshes a turn still running."""
    user_email = _get_user_email(headers)
    engine = request.app.state.engine
    aliases = {config.anthropic_llm_endpoint: config.anthropic_llm_price_as}

    def _load():
        # Blocking DB reads, transcript backfill and the pricing summary: off the loop.
        project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)
        with SQLSession(engine) as db:
            try:
                agent_usage.backfill_from_db(db, project_id)
            except Exception as e:  # noqa: BLE001 — a bad transcript must not hide the rest
                db.rollback()
                logger.warning(f"[usage] backfill failed for {project_id}: {e!r}")
            from ..services.active_stream import get_stream_manager
            if project.session_id and get_stream_manager().get_project_stream(project_id) is not None:
                try:
                    agent_usage.ingest_session_from_disk(
                        engine, project_id, get_project_directory(project_id), project.session_id
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"[usage] live refresh failed for {project_id}: {e!r}")
            rows = list(db.exec(select(AgentUsage).where(AgentUsage.project_id == project_id)).all())
        return agent_usage.summarize(rows, aliases)

    return await asyncio.to_thread(_load)
