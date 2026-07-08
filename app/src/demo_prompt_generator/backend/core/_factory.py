from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..._metadata import api_prefix, app_name, dist_dir
from ._base import LifespanDependency
from ._config import logger

# --- Lifespan ---


@asynccontextmanager
async def _chain_dep_lifespans(
    deps: list[LifespanDependency],
    app: FastAPI,
) -> AsyncIterator[None]:
    """Chain multiple dependency lifespans into a single nested context manager."""
    if not deps:
        yield
        return

    head, *tail = deps

    async with head.lifespan(app):
        async with _chain_dep_lifespans(tail, app):
            yield


# --- Factory ---


def create_app(
    *,
    routers: list[APIRouter] | None = None,
) -> FastAPI:
    """Create and configure a FastAPI application.

    Dependencies are discovered automatically from the Dependency registry.
    All concrete Dependency subclasses that have been imported are instantiated
    and their lifespans are chained in import order.

    Args:
        routers: List of APIRouter instances to include in the app.

    Returns:
        Configured FastAPI application instance.
    """
    all_deps: list[LifespanDependency] = []
    for dep in LifespanDependency._registry:
        try:
            all_deps.append(dep())
        except Exception as e:
            logger.error(f"Failed to instantiate dependency {dep.__name__}: {e}")
            raise e

    @asynccontextmanager
    async def _composed_lifespan(app: FastAPI):
        async with _chain_dep_lifespans(all_deps, app):
            yield

    app = FastAPI(title=app_name, lifespan=_composed_lifespan)

    # Add CORS middleware for Electron mode (or local development)
    # In Electron, the frontend runs on a different origin than the backend
    if os.environ.get("ELECTRON_RUN") == "1" or os.environ.get("CORS_ENABLED") == "1":
        logger.info("CORS middleware enabled for Electron/development mode")
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # In trusted Electron environment
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Usage analytics for Databricks employees (filters to @databricks.com only).
    # Disable by setting DEMO_PROMPT_GENERATOR_TRACKER_ENABLED=0 in .env
    if os.environ.get("DEMO_PROMPT_GENERATOR_TRACKER_ENABLED", "1") != "0":
        try:
            from dbdemos_tracker import Tracker

            Tracker.add_tracker_fastapi(
                app,
                demo_name="industry-demo-prompts",
                patterns=[
                    r"^/$",                              # landing page
                    r"^/project/[^/]+$",                 # project workspace
                    r"^/projects$",                      # project list
                    r"^/templates$",                     # template management
                    r"^/gallery$",                       # template gallery
                    r"^/api/projects$",                  # create / list projects
                    r"^/api/projects/[^/]+$",            # get / update project
                    r"^/api/invoke_agent$",              # agent invocations
                    r"^/api/templates(/.*)?$",           # template publish/fork/search
                    r"^/api/block_factory(/.*)?$",       # block decomposition
                ],
            )
            logger.info("dbdemos-tracker middleware registered (industry-demo-prompts)")
        except Exception as e:
            # Telemetry must never break the app boot.
            logger.warning(f"Failed to register dbdemos-tracker: {e}")

    api_router: APIRouter = create_router()
    for dep in all_deps:
        for r in dep.get_routers():
            api_router.include_router(r)
    app.include_router(api_router)

    for router in routers or []:
        if router is not api_router:
            app.include_router(router)

    if dist_dir.exists():
        from fastapi.responses import HTMLResponse

        from ._static import CachedStaticFiles, add_not_found_handler

        # Internal static microsites vendored from ../dbrain (the_vision, pitch,
        # shift-left) live as subdirs of __dist__. Serving them needs two fixes:
        #
        #  1. The bare URL (/pitch) must serve the page WITHOUT a 307 redirect to
        #     /pitch/. StaticFiles auto-redirects when `html=True` hits a dir;
        #     inside Databricks Apps that redirect target uses the internal
        #     scheme/host (localhost:8000) and breaks the browser.
        #  2. Their HTML uses bare relative asset refs (style.css, app.js). At a
        #     bare URL those resolve against "/". We inject a <base href="/<name>/">
        #     so they resolve under the microsite dir at both /<name> and /<name>/.
        #     (the_vision already ships a <base> tag; injecting an identical one
        #     is idempotent for it and fixes the dbrain pages that lack one.)
        def _register_microsite(name: str) -> None:
            site_dir = dist_dir / name
            if not site_dir.exists():
                return
            base_tag = f'<base href="/{name}/">'

            def _serve() -> HTMLResponse:
                html = (site_dir / "index.html").read_text(encoding="utf-8")
                if "<base " not in html:
                    html = html.replace("<head>", f"<head>\n  {base_tag}", 1)
                return HTMLResponse(html)

            # Distinct endpoint name per site so FastAPI doesn't collide handlers.
            app.add_api_route(f"/{name}", _serve, include_in_schema=False, name=f"microsite_{name}")
            app.add_api_route(f"/{name}/", _serve, include_in_schema=False, name=f"microsite_{name}_slash")

        for _site in ("the_vision", "pitch", "shift-left"):
            _register_microsite(_site)

        app.mount("/", CachedStaticFiles(directory=dist_dir, html=True))
        add_not_found_handler(app)

    return app


# singleton APIRouter with the application's API prefix
@lru_cache(maxsize=1)
def create_router() -> APIRouter:
    """Return the singleton APIRouter with the application's API prefix."""
    return APIRouter(prefix=api_prefix)
