"""Company brand resolution — /api/brands/*.

v1: keyless, best-effort. Given a company name, find its official site and
extract a logo + color palette (see services/brand_service.py +
docs/brand-service-spec.md). Standalone for now (not attached to projects yet).
Verbose logging lives in the service so you can trace the agent's reasoning.
"""

from __future__ import annotations

from fastapi import Query

from ..core import Dependencies, create_router
from ..models import BrandOut
from ..services.brand_service import BrandService

router = create_router()


@router.get("/brands/resolve", response_model=BrandOut, operation_id="resolveBrand")
async def resolve_brand(
    ws: Dependencies.Client,
    config: Dependencies.Config,
    name: str = Query(..., min_length=1, description="Company name, e.g. 'Rolls-Royce'"),
):
    """Resolve a company's brand (official domain + logo + color palette).

    Best-effort: always returns a `BrandOut` (with `warnings`) rather than
    erroring — a missing logo/palette just comes back empty. Watch the
    `brand_service` logger to see the agent's tool calls + reasoning.
    """
    return await BrandService(ws, config).resolve(name)
