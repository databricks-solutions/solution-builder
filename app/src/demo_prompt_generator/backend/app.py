import sys
from contextlib import asynccontextmanager

# --- Python version guard ----------------------------------------------------
# Run before any further imports so a wrong interpreter fails fast with a clear
# message instead of a cryptic stack trace from a downstream dep. The Databricks
# Apps platform currently runs 3.11; local dev is typically 3.12. We accept both.
_MIN = (3, 11)
_MAX_EXCLUSIVE = (3, 13)
_v = sys.version_info
if (_v.major, _v.minor) < _MIN or (_v.major, _v.minor) >= _MAX_EXCLUSIVE:
    raise RuntimeError(
        f"\ndemo-prompt-generator requires Python 3.11 or 3.12 "
        f"(got {_v.major}.{_v.minor}.{_v.micro} at {sys.executable}).\n"
        f"\n"
        f"Fix:\n"
        f"  uv python install 3.12\n"
        f"  rm -rf .venv && uv venv --python 3.12 && uv sync\n"
        f"  ./scripts/dev.sh\n"
    )

from fastapi import APIRouter, FastAPI  # noqa: E402

from .core import create_app  # noqa: E402
from .preview import register_routes as _register_preview_routes  # noqa: E402
from .router import router  # noqa: E402
from .services.skills_manager import get_project_directory  # noqa: E402


def _build_app() -> FastAPI:
    # --- Preview feature (isolated; see backend/preview/README.md) ----------
    # Build an unprefixed router; the preview module owns both `/api/preview/*`
    # and `/preview/*` paths and we need them at the app root (not under /api).
    preview_router = APIRouter()
    preview_registry = _register_preview_routes(
        preview_router, get_project_dir=get_project_directory
    )

    built = create_app(routers=[router, preview_router])
    # Expose the preview registry on app.state so route handlers (e.g. project
    # delete) can drop a project's preview bookkeeping via registry.forget().
    built.state.preview_registry = preview_registry

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
