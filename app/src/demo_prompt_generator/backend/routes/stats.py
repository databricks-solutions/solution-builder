"""Usage statistics endpoint.

Aggregates project + message activity for the admin /stats page. All queries
go through the existing PG engine (no extra connection). Numbers are computed
on demand — cheap enough at our current scale (projects in the thousands;
messages in the tens of thousands).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Query
from pydantic import BaseModel
from sqlmodel import func, select

from ..core import Dependencies, create_router
from ..models import Message, Project, ProjectStage

router = create_router()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class DayCount(BaseModel):
    """Projects (or messages) created on a single day. `date` is ISO YYYY-MM-DD."""
    date: str
    count: int


class OwnerCount(BaseModel):
    """Aggregate counts per owner email."""
    user_email: str
    project_count: int
    last_active: Optional[str] = None  # ISO timestamp; latest project updated_at


class StageCount(BaseModel):
    stage: str
    count: int


class ProjectRow(BaseModel):
    """One row of the paginated table."""
    id: str
    name: str
    user_email: str
    stage: str
    project_type: str
    message_count: int
    has_active_execution: bool
    source_template_id: Optional[str]
    created_at: str
    updated_at: str


class StatsResponse(BaseModel):
    # KPI tiles
    total_projects: int
    total_users: int
    total_messages: int
    projects_last_7d: int
    projects_last_30d: int
    active_executions: int  # currently running agent sessions

    # Charts
    projects_per_day: list[DayCount]
    messages_per_day: list[DayCount]
    by_stage: list[StageCount]

    # Top contributors
    top_owners: list[OwnerCount]

    # Paginated project list
    projects: list[ProjectRow]
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/stats",
    response_model=StatsResponse,
    operation_id="getStats",
)
def get_stats(
    session: Dependencies.Session,
    days: int = Query(30, ge=1, le=180, description="Bucket window for per-day charts."),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    owner_filter: Optional[str] = Query(
        None,
        description="Optional case-insensitive substring filter on user_email.",
    ),
):
    """Aggregate platform usage. Visible to any authenticated user — surface
    public metrics only (no PII beyond the user_email already shown on
    projects in the gallery)."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=days)
    last_7d_start = now - timedelta(days=7)
    last_30d_start = now - timedelta(days=30)

    # ── KPI tiles ──────────────────────────────────────────────────────────
    total_projects = session.exec(
        select(func.count()).select_from(Project)
    ).one()
    total_users = session.exec(
        select(func.count(func.distinct(Project.user_email)))
    ).one()
    total_messages = session.exec(
        select(func.count()).select_from(Message)
    ).one()
    projects_last_7d = session.exec(
        select(func.count()).select_from(Project).where(Project.created_at >= last_7d_start)
    ).one()
    projects_last_30d = session.exec(
        select(func.count()).select_from(Project).where(Project.created_at >= last_30d_start)
    ).one()
    active_executions = session.exec(
        select(func.count()).select_from(Project).where(Project.active_execution_id.is_not(None))
    ).one()

    # ── Per-day buckets ────────────────────────────────────────────────────
    # PostgreSQL date_trunc is fine via SQLAlchemy func.date_trunc. For PGLite
    # (local dev) func.date_trunc also resolves — both backends understand
    # the SQL standard form.
    proj_day_rows = session.exec(
        select(
            func.date_trunc("day", Project.created_at).label("day"),
            func.count(Project.id).label("c"),
        )
        .where(Project.created_at >= window_start)
        .group_by("day")
        .order_by("day")
    ).all()
    projects_per_day = [
        DayCount(date=_iso_day(row[0]), count=int(row[1])) for row in proj_day_rows
    ]

    msg_day_rows = session.exec(
        select(
            func.date_trunc("day", Message.created_at).label("day"),
            func.count(Message.id).label("c"),
        )
        .where(Message.created_at >= window_start)
        .group_by("day")
        .order_by("day")
    ).all()
    messages_per_day = [
        DayCount(date=_iso_day(row[0]), count=int(row[1])) for row in msg_day_rows
    ]

    # ── Stage breakdown ────────────────────────────────────────────────────
    stage_rows = session.exec(
        select(Project.stage, func.count(Project.id))
        .group_by(Project.stage)
    ).all()
    # Preserve the canonical stage order so the chart axis is stable.
    stage_lookup = {row[0]: int(row[1]) for row in stage_rows}
    by_stage = [
        StageCount(stage=s.value, count=stage_lookup.get(s.value, 0))
        for s in ProjectStage
    ]
    # Surface any stage values in the DB that aren't in the enum (legacy).
    for stage_val, cnt in stage_lookup.items():
        if not any(s.value == stage_val for s in ProjectStage):
            by_stage.append(StageCount(stage=stage_val, count=cnt))

    # ── Top owners ─────────────────────────────────────────────────────────
    owner_rows = session.exec(
        select(
            Project.user_email,
            func.count(Project.id).label("c"),
            func.max(Project.updated_at).label("last"),
        )
        .group_by(Project.user_email)
        .order_by(func.count(Project.id).desc())
        .limit(20)
    ).all()
    top_owners = [
        OwnerCount(
            user_email=row[0],
            project_count=int(row[1]),
            last_active=row[2].isoformat() if row[2] else None,
        )
        for row in owner_rows
    ]

    # ── Paginated project list ─────────────────────────────────────────────
    base = select(Project).order_by(Project.updated_at.desc())
    if owner_filter:
        base = base.where(func.lower(Project.user_email).contains(owner_filter.lower()))
    filtered_count = session.exec(
        select(func.count()).select_from(base.subquery())
    ).one()

    page_rows = session.exec(
        base.offset((page - 1) * page_size).limit(page_size)
    ).all()

    project_ids = [p.id for p in page_rows]
    msg_count_by_proj: dict[str, int] = {}
    if project_ids:
        msg_count_rows = session.exec(
            select(Message.project_id, func.count(Message.id))
            .where(Message.project_id.in_(project_ids))
            .group_by(Message.project_id)
        ).all()
        msg_count_by_proj = {row[0]: int(row[1]) for row in msg_count_rows}

    projects = [
        ProjectRow(
            id=p.id,
            name=p.name,
            user_email=p.user_email,
            stage=p.stage,
            project_type=p.project_type,
            message_count=msg_count_by_proj.get(p.id, 0),
            has_active_execution=p.active_execution_id is not None,
            source_template_id=p.source_template_id,
            created_at=p.created_at.isoformat(),
            updated_at=p.updated_at.isoformat(),
        )
        for p in page_rows
    ]

    total_pages = max(1, (int(filtered_count) + page_size - 1) // page_size)

    return StatsResponse(
        total_projects=int(total_projects),
        total_users=int(total_users),
        total_messages=int(total_messages),
        projects_last_7d=int(projects_last_7d),
        projects_last_30d=int(projects_last_30d),
        active_executions=int(active_executions),
        projects_per_day=projects_per_day,
        messages_per_day=messages_per_day,
        by_stage=by_stage,
        top_owners=top_owners,
        projects=projects,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


def _iso_day(dt) -> str:
    """date_trunc('day', ...) returns a datetime. Normalize to YYYY-MM-DD."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.date().isoformat()
    return str(dt)[:10]
