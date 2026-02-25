from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ..core import Dependencies, create_router
from ..models import InspireRequest
from ..services.skill_generator import stream_inspiration

router = create_router()


@router.post("/inspire", operation_id="streamInspiration")
async def inspire(
    req: InspireRequest,
    config: Dependencies.Config,
):
    """Stream an AI-generated use-case description."""
    host = config.databricks_host
    token = config.databricks_token
    model = config.llm_model

    if not host or not token:
        raise HTTPException(
            status_code=500,
            detail="Databricks host/token not configured",
        )

    async def event_stream():
        try:
            async for chunk in stream_inspiration(
                req.topic, host, token, model=model,
            ):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {e}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
    )
