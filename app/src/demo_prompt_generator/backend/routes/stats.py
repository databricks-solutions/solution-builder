"""Usage statistics endpoint.

Aggregates project + message activity for the admin /stats page. All queries
go through the existing PG engine (no extra connection). Numbers are computed
on demand — cheap enough at our current scale (projects in the thousands;
messages in the tens of thousands).

Supports an arbitrary date range (``start``/``end``) bucketed at day / week /
month granularity, a breakdown by home-entry mode, table filters (owner /
stage / mode), and a CSV/JSON export path (see ``/stats/projects/export``).
"""

from __future__ import annotations

import csv
import io
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Query, Response
from pydantic import BaseModel
from sqlmodel import func, select

from ..core import Dependencies, create_router
from ..models import Message, Project, ProjectStage

router = create_router()

# Bucket granularities we accept for the per-interval charts. Each maps to the
# unit Postgres ``date_trunc`` understands.
_GRANULARITIES = {"day", "week", "month"}
# Hard cap on the number of rows the export endpoint will materialize, so a
# pathological "export everything" can't OOM the process.
_EXPORT_MAX_ROWS = 20_000


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


class ModeCount(BaseModel):
    """Projects grouped by home-entry mode (story / architecture / workshop)."""
    mode: str
    count: int


class ProjectRow(BaseModel):
    """One row of the paginated table."""
    id: str
    name: str
    user_email: str
    stage: str
    project_type: str
    mode: str
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

    # Resolved query window (echoed back so the client can render axis labels
    # and export filenames without re-deriving them).
    range_start: str  # ISO YYYY-MM-DD
    range_end: str    # ISO YYYY-MM-DD (inclusive)
    granularity: str  # "day" | "week" | "month"

    # Charts — keys are the bucket start dates (ISO); with week/month
    # granularity each bucket spans multiple days.
    projects_per_day: list[DayCount]
    messages_per_day: list[DayCount]
    by_stage: list[StageCount]
    by_mode: list[ModeCount]

    # Top contributors
    top_owners: list[OwnerCount]

    # Paginated project list
    projects: list[ProjectRow]
    total_filtered: int  # rows matching the table filters (across all pages)
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


def _resolve_window(
    days: Optional[int],
    start: Optional[str],
    end: Optional[str],
) -> tuple[datetime, datetime]:
    """Resolve the chart/query window to a UTC ``(start, end_exclusive)`` pair.

    Precedence: an explicit ``start``/``end`` date range wins; otherwise fall
    back to a rolling ``days`` window ending now. ``end`` is inclusive of the
    whole day, so the returned upper bound is that day's midnight + 1 day
    (exclusive), which keeps ``created_at >= start AND < end`` clean.
    """
    now = datetime.now(timezone.utc)
    if start or end:
        try:
            start_d = (
                date.fromisoformat(start) if start
                else (date.fromisoformat(end) - timedelta(days=29))
            )
            end_d = date.fromisoformat(end) if end else now.date()
        except ValueError:
            raise HTTPException(400, "start/end must be ISO YYYY-MM-DD dates")
        if end_d < start_d:
            raise HTTPException(400, "end must be on or after start")
        window_start = datetime(start_d.year, start_d.month, start_d.day, tzinfo=timezone.utc)
        # Inclusive end → advance one day for the exclusive upper bound.
        window_end = datetime(end_d.year, end_d.month, end_d.day, tzinfo=timezone.utc) + timedelta(days=1)
        return window_start, window_end
    # Rolling window — midnight-aligned so it yields exactly `span` whole-day
    # buckets ending today. This matches the frontend's bucket fill (which keys
    # off today's UTC midnight) so the chart axis and the echoed range agree.
    span = days if days is not None else 30
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    window_end = today + timedelta(days=1)  # exclusive → includes all of today
    window_start = today - timedelta(days=span - 1)
    return window_start, window_end


# /stats runs ~12 full-table aggregates per call and the dashboard polls it, so the
# response is memoized per parameter set for a short TTL. Bounded: the map is cleared
# when it fills, so arbitrary filter strings can't grow it without limit.
_STATS_CACHE_TTL_S = 60.0
_STATS_CACHE_MAX = 64
_stats_cache: dict[tuple, tuple[float, StatsResponse]] = {}


@router.get(
    "/stats",
    response_model=StatsResponse,
    operation_id="getStats",
)
def get_stats(
    session: Dependencies.Session,
    days: int = Query(30, ge=1, le=730, description="Rolling bucket window (used when start/end are omitted)."),
    start: Optional[str] = Query(None, description="Inclusive range start (ISO YYYY-MM-DD). Overrides `days`."),
    end: Optional[str] = Query(None, description="Inclusive range end (ISO YYYY-MM-DD). Overrides `days`."),
    granularity: str = Query("day", description="Chart bucket size: day | week | month."),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    owner_filter: Optional[str] = Query(
        None,
        description="Optional case-insensitive substring filter on user_email.",
    ),
    stage_filter: Optional[str] = Query(None, description="Exact stage match for the project table."),
    mode_filter: Optional[str] = Query(None, description="Exact mode match for the project table."),
    top_owners_limit: int = Query(10, ge=1, le=100, description="How many top contributors to return."),
):
    """Aggregate platform usage. Visible to any authenticated user — surface
    public metrics only (no PII beyond the user_email already shown on
    projects in the gallery)."""
    if granularity not in _GRANULARITIES:
        raise HTTPException(400, f"granularity must be one of {sorted(_GRANULARITIES)}")

    cache_key = (days, start, end, granularity, page, page_size, owner_filter, stage_filter,
                 mode_filter, top_owners_limit)
    cached = _stats_cache.get(cache_key)
    if cached is not None and time.monotonic() - cached[0] < _STATS_CACHE_TTL_S:
        return cached[1]

    now = datetime.now(timezone.utc)
    window_start, window_end = _resolve_window(days, start, end)
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

    # ── Per-interval buckets ───────────────────────────────────────────────
    # PostgreSQL date_trunc is fine via SQLAlchemy func.date_trunc. For PGLite
    # (local dev) func.date_trunc also resolves — both backends understand
    # the SQL standard form. `granularity` is validated against an allow-list
    # above, so it's safe to interpolate as the trunc unit.
    proj_day_rows = session.exec(
        select(
            func.date_trunc(granularity, Project.created_at).label("bucket"),
            func.count(Project.id).label("c"),
        )
        .where(Project.created_at >= window_start, Project.created_at < window_end)
        .group_by("bucket")
        .order_by("bucket")
    ).all()
    projects_per_day = [
        DayCount(date=_iso_day(row[0]), count=int(row[1])) for row in proj_day_rows
    ]

    msg_day_rows = session.exec(
        select(
            func.date_trunc(granularity, Message.created_at).label("bucket"),
            func.count(Message.id).label("c"),
        )
        .where(Message.created_at >= window_start, Message.created_at < window_end)
        .group_by("bucket")
        .order_by("bucket")
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

    # ── Mode breakdown (home-entry funnel) ─────────────────────────────────
    mode_rows = session.exec(
        select(Project.mode, func.count(Project.id)).group_by(Project.mode)
    ).all()
    mode_lookup = {(row[0] or "story"): int(row[1]) for row in mode_rows}
    # Canonical order first, then any unexpected values.
    by_mode = [
        ModeCount(mode=m, count=mode_lookup.get(m, 0))
        for m in ("story", "architecture", "workshop")
    ]
    for mode_val, cnt in mode_lookup.items():
        if mode_val not in ("story", "architecture", "workshop"):
            by_mode.append(ModeCount(mode=mode_val, count=cnt))

    # ── Top owners ─────────────────────────────────────────────────────────
    owner_rows = session.exec(
        select(
            Project.user_email,
            func.count(Project.id).label("c"),
            func.max(Project.updated_at).label("last"),
        )
        .group_by(Project.user_email)
        .order_by(func.count(Project.id).desc())
        .limit(top_owners_limit)
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
    base = _filtered_project_query(owner_filter, stage_filter, mode_filter)
    filtered_count = session.exec(
        select(func.count()).select_from(base.subquery())
    ).one()

    page_rows = session.exec(
        base.offset((page - 1) * page_size).limit(page_size)
    ).all()

    projects = _to_project_rows(session, page_rows)

    total_pages = max(1, (int(filtered_count) + page_size - 1) // page_size)

    result = StatsResponse(
        total_projects=int(total_projects),
        total_users=int(total_users),
        total_messages=int(total_messages),
        projects_last_7d=int(projects_last_7d),
        projects_last_30d=int(projects_last_30d),
        active_executions=int(active_executions),
        range_start=window_start.date().isoformat(),
        # Echo the INCLUSIVE end (window_end is exclusive → step back a day).
        range_end=(window_end - timedelta(days=1)).date().isoformat(),
        granularity=granularity,
        projects_per_day=projects_per_day,
        messages_per_day=messages_per_day,
        by_stage=by_stage,
        by_mode=by_mode,
        top_owners=top_owners,
        projects=projects,
        total_filtered=int(filtered_count),
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
    if len(_stats_cache) >= _STATS_CACHE_MAX:
        _stats_cache.clear()
    _stats_cache[cache_key] = (time.monotonic(), result)
    return result


# ---------------------------------------------------------------------------
# Project-table export (CSV / JSON)
# ---------------------------------------------------------------------------


@router.get(
    "/stats/projects/export",
    operation_id="exportStatsProjects",
)
def export_stats_projects(
    session: Dependencies.Session,
    owner_filter: Optional[str] = Query(None),
    stage_filter: Optional[str] = Query(None),
    mode_filter: Optional[str] = Query(None),
):
    """Stream the FULL (filter-respecting, un-paginated) project list as CSV.

    The interactive table paginates; this returns every matching row so the
    exported CSV is complete. Capped at ``_EXPORT_MAX_ROWS`` as an OOM guard —
    the ``truncated`` header tells the client if the cap was hit.
    """
    base = _filtered_project_query(owner_filter, stage_filter, mode_filter)
    rows = session.exec(base.limit(_EXPORT_MAX_ROWS + 1)).all()
    truncated = len(rows) > _EXPORT_MAX_ROWS
    rows = rows[:_EXPORT_MAX_ROWS]
    project_rows = _to_project_rows(session, rows)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "id", "name", "user_email", "stage", "project_type", "mode",
        "message_count", "has_active_execution", "source_template_id",
        "created_at", "updated_at",
    ])
    for p in project_rows:
        writer.writerow([
            p.id, p.name, p.user_email, p.stage, p.project_type, p.mode,
            p.message_count, p.has_active_execution, p.source_template_id or "",
            p.created_at, p.updated_at,
        ])

    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="projects.csv"',
            "X-Export-Truncated": "true" if truncated else "false",
        },
    )


# ---------------------------------------------------------------------------
# Shared query helpers
# ---------------------------------------------------------------------------


def _filtered_project_query(
    owner_filter: Optional[str],
    stage_filter: Optional[str],
    mode_filter: Optional[str],
):
    """Build the project SELECT with the table filters applied (owner substring
    + exact stage/mode). Shared by the paginated table and the CSV export so
    they can't drift."""
    q = select(Project).order_by(Project.updated_at.desc())
    if owner_filter:
        q = q.where(func.lower(Project.user_email).contains(owner_filter.lower()))
    if stage_filter:
        q = q.where(Project.stage == stage_filter)
    if mode_filter:
        q = q.where(Project.mode == mode_filter)
    return q


def _to_project_rows(session, page_rows: list) -> list[ProjectRow]:
    """Attach message counts and map ORM Projects → ProjectRow response models."""
    project_ids = [p.id for p in page_rows]
    msg_count_by_proj: dict[str, int] = {}
    if project_ids:
        msg_count_rows = session.exec(
            select(Message.project_id, func.count(Message.id))
            .where(Message.project_id.in_(project_ids))
            .group_by(Message.project_id)
        ).all()
        msg_count_by_proj = {row[0]: int(row[1]) for row in msg_count_rows}

    return [
        ProjectRow(
            id=p.id,
            name=p.name,
            user_email=p.user_email,
            stage=p.stage,
            project_type=p.project_type,
            mode=p.mode or "story",
            message_count=msg_count_by_proj.get(p.id, 0),
            has_active_execution=p.active_execution_id is not None,
            source_template_id=p.source_template_id,
            created_at=p.created_at.isoformat(),
            updated_at=p.updated_at.isoformat(),
        )
        for p in page_rows
    ]


def _iso_day(dt) -> str:
    """date_trunc(unit, ...) returns a datetime. Normalize to YYYY-MM-DD."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.date().isoformat()
    return str(dt)[:10]
