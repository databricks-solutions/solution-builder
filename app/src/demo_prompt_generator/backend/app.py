from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from .core import create_app
from .preview import register_routes as _register_preview_routes
from .router import router
from .services.skills_manager import get_project_directory


def _build_app() -> FastAPI:
    # --- Preview feature (isolated; see backend/preview/README.md) ----------
    # Build an unprefixed router; the preview module owns both `/api/preview/*`
    # and `/preview/*` paths and we need them at the app root (not under /api).
    preview_router = APIRouter()
    preview_registry = _register_preview_routes(
        preview_router, get_project_dir=get_project_directory
    )

    built = create_app(routers=[router, preview_router])

    # Tie the registry's background idle-sweep task to the app lifespan.
    # (create_app wires a composed lifespan for its internal deps; we wrap on top.)
    _orig_lifespan = built.router.lifespan_context

    @asynccontextmanager
    async def _with_preview(app: FastAPI):
        await preview_registry.startup()
        try:
            async with _orig_lifespan(app):
                yield
        finally:
            await preview_registry.shutdown()

    built.router.lifespan_context = _with_preview
    return built


app = _build_app()
