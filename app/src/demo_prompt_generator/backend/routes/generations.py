from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import Generation, GenerationListItem, GenerationOut

router = create_router()


@router.get(
    "/generations",
    response_model=list[GenerationListItem],
    operation_id="listGenerations",
)
def list_generations(session: Dependencies.Session):
    """Return all past generations, newest first."""
    stmt = (
        select(Generation)
        .order_by(Generation.created_at.desc())  # type: ignore[attr-defined]
    )
    rows = session.exec(stmt).all()
    return [
        GenerationListItem(
            id=r.id,  # type: ignore[arg-type]
            demo_name=r.demo_name,
            industry=r.industry,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get(
    "/generations/{generation_id}",
    response_model=GenerationOut,
    operation_id="getGeneration",
)
def get_generation(
    generation_id: int,
    session: Dependencies.Session,
):
    """Return a single generation by ID."""
    row = session.get(Generation, generation_id)
    if not row:
        raise HTTPException(
            status_code=404, detail="Generation not found",
        )
    return GenerationOut(
        id=row.id,  # type: ignore[arg-type]
        demo_name=row.demo_name,
        owner_name=row.owner_name,
        industry=row.industry,
        skill_md=row.skill_md,
        created_at=row.created_at,
    )
