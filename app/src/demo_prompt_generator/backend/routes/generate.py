from __future__ import annotations

import json

from fastapi import HTTPException

from ..core import Dependencies, create_router
from ..models import DemoRequestIn, Generation, GenerationOut
from ..services.skill_generator import generate_skill

router = create_router()


@router.post(
    "/generate",
    response_model=GenerationOut,
    operation_id="generateSkill",
)
async def generate(
    req: DemoRequestIn,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
):
    """Accept a demo request form and return a generated SKILL.md."""
    host = config.databricks_host
    token = config.databricks_token
    if not token and ws_client:
        headers = ws_client.config.authenticate()
        auth_header = headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
        if not host:
            host = ws_client.config.host
    model = config.llm_model

    if not host or not token:
        raise HTTPException(
            status_code=500,
            detail="Databricks host/token not configured",
        )

    try:
        skill_md = await generate_skill(
            req, host, token, model=model,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM generation failed: {e}",
        )

    row = Generation(
        demo_name=req.demo_name,
        owner_name=req.owner_name,
        industry=req.industry,
        form_json=json.dumps(req.model_dump(), default=str),
        skill_md=skill_md,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    return GenerationOut(
        id=row.id,  # type: ignore[arg-type]
        demo_name=row.demo_name,
        owner_name=row.owner_name,
        industry=row.industry,
        skill_md=row.skill_md,
        created_at=row.created_at,
    )
