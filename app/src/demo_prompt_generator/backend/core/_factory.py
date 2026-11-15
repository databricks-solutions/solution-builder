from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

import anyio.to_thread
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..._metadata import api_prefix, app_name, dist_dir
from ._base import LifespanDependency
from ._config import logger

THREAD_TOKENS = 100


class SlowRequestMiddleware:
    """Pure-ASGI request timing: counts in-flight HTTP requests and reports the ones whose
    time-to-first-byte (until `http.response.start`) exceeds the threshold. TTFB, not
    total time, so an SSE stream is judged on its headers and never flagged for living
    long. NOT BaseHTTPMiddleware: that wraps the body and breaks streaming."""

    def __init__(self, app: ASGIApp, threshold_s: float | None = None) -> None:
        # Imported here, not at module load: services/stall_detector imports core._config,
        # which imports this package, so a top-level import would be circular.
        from ..services.stall_detector import request_stats

        self.app = app
        self.stats = request_stats
        self.threshold_s = request_stats.threshold_s if threshold_s is None else threshold_s

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        stats = self.stats
        stats.inflight += 1
        t0 = time.monotonic()
        ttfb: list[float] = []
        status: list[int] = []

        async def send_wrapper(message: Message) -> None:
            if not ttfb and message["type"] == "http.response.start":
                ttfb.append(time.monotonic() - t0)
                status.append(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            stats.inflight -= 1
            if ttfb and ttfb[0] > self.threshold_s:
                try:
                    # endpoint is set in-place by the router; unrouted 404s have none.
                    endpoint = scope.get("endpoint")
                    route = getattr(endpoint, "__qualname__", None) or "unrouted"
                    stats.record_slow(route, scope.get("method", ""), scope.get("path", ""),
                                      status[0], ttfb[0])
                except Exception:  # noqa: BLE001 — accounting must never break a response
                    pass


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
        # anyio's default limiter is 40 threads shared by every sync handler, sync
        # dependency and static chunk. Raise it so a few slow sync calls can't queue
        # everything else behind them. Matches the app-SP connection pool size.
        anyio.to_thread.current_default_thread_limiter().total_tokens = THREAD_TOKENS
        async with _chain_dep_lifespans(all_deps, app):
            yield

    app = FastAPI(title=app_name, lifespan=_composed_lifespan)
    app.add_middleware(SlowRequestMiddleware)

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
