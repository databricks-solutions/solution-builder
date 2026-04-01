from __future__ import annotations

import json

from fastapi import HTTPException
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import Generation, GenerationListItem, GenerationOut
from .generations import _get_user_id

router = create_router()


def _parse_skill_files(raw: str | None) -> dict[str, str] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_library_tags(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _to_list_item(r: Generation) -> GenerationListItem:
    return GenerationListItem(
        id=r.id,  # type: ignore[arg-type]
        demo_name=r.demo_name,
        industry=r.industry,
        stage=r.stage,
        is_starred=r.is_starred,
        is_library=r.is_library,
        library_tags=_parse_library_tags(r.library_tags),
        created_at=r.created_at,
    )


def _to_generation_out(r: Generation) -> GenerationOut:
    return GenerationOut(
        id=r.id,  # type: ignore[arg-type]
        demo_name=r.demo_name,
        owner_name=r.owner_name,
        industry=r.industry,
        skill_md=r.skill_md,
        stage=r.stage,
        is_starred=r.is_starred,
        is_library=r.is_library,
        library_tags=_parse_library_tags(r.library_tags),
        proposal_md=r.proposal_md,
        skill_files=_parse_skill_files(r.skill_files),
        created_at=r.created_at,
    )


@router.get(
    "/library",
    response_model=list[GenerationListItem],
    operation_id="listLibrary",
)
def list_library(session: Dependencies.Session):
    """Return all library packages."""
    stmt = (
        select(Generation)
        .where(Generation.is_library == True)  # noqa: E712
        .order_by(Generation.demo_name)
    )
    rows = session.exec(stmt).all()
    return [_to_list_item(r) for r in rows]


@router.get(
    "/library/{package_id}",
    response_model=GenerationOut,
    operation_id="getLibraryPackage",
)
def get_library_package(
    package_id: int,
    session: Dependencies.Session,
):
    """Return a single library package by ID."""
    row = session.get(Generation, package_id)
    if not row or not row.is_library:
        raise HTTPException(status_code=404, detail="Library package not found")
    return _to_generation_out(row)


@router.post(
    "/library/{package_id}/fork",
    response_model=GenerationOut,
    operation_id="forkLibraryPackage",
)
def fork_library_package(
    package_id: int,
    session: Dependencies.Session,
    user_ws: Dependencies.UserClient,
    headers: Dependencies.Headers,
):
    """Clone a library package into a user-owned generation."""
    row = session.get(Generation, package_id)
    if not row or not row.is_library:
        raise HTTPException(status_code=404, detail="Library package not found")

    # Determine owner name from the authenticated user
    try:
        user = user_ws.current_user.me()
        owner_name = user.display_name or user.user_name or "Unknown"
    except Exception:
        owner_name = headers.user_name or "Unknown"

    forked = Generation(
        demo_name=row.demo_name,
        owner_name=owner_name,
        user_id=_get_user_id(headers),
        industry=row.industry,
        form_json=row.form_json,
        skill_md=row.skill_md,
        stage="package",
        proposal_md=row.proposal_md,
        skill_files=row.skill_files,
        is_library=False,
        is_starred=False,
        library_tags=None,
    )
    session.add(forked)
    session.commit()
    session.refresh(forked)
    return _to_generation_out(forked)
