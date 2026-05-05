"""Request logging middleware + global exception handler.

Wires every /api/* request into the event_logs table:
- Synthesizes a request_id (UUID4) if the client didn't send X-Forwarded-Request-Id.
- Captures method, path, status, duration_ms, user_email, request_id.
- On unhandled exception: logs full traceback and returns a clean 500 JSON body.

Skips noisy paths (health, version, preview, SSE streams) — those would flood
the table without adding analytical value.
"""

from __future__ import annotations

import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..models import EventSeverity, EventType
from ..services.event_logger import log_event
from ._config import logger

# Path patterns we never log — health checks, SSE streams (long-running and
# already covered by the agent_run event), Vite preview proxy, static assets.
_SKIP_PATTERNS = [
    re.compile(r"^/api/health$"),
    re.compile(r"^/api/version$"),
    re.compile(r"^/api/stream_progress/"),  # SSE — duration is meaningless
    re.compile(r"^/preview/"),
    re.compile(r"^/assets/"),
    re.compile(r"^/static/"),
    re.compile(r"^/favicon"),
]


def _should_skip(path: str) -> bool:
    return any(p.match(path) for p in _SKIP_PATTERNS)


def _request_id(request: Request) -> str:
    rid = request.headers.get("X-Request-Id") or request.headers.get("X-Forwarded-Request-Id")
    if rid:
        return rid[:64]
    return str(uuid.uuid4())


def _user_email(request: Request) -> str | None:
    # Same headers core/_headers.py reads — keeps logger and route handlers
    # in agreement on identity.
    return (
        request.headers.get("X-Forwarded-Email")
        or request.headers.get("X-Forwarded-Preferred-Username")
        or request.headers.get("X-Forwarded-User")
    )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log one row per non-skipped request to event_logs."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if _should_skip(path):
            return await call_next(request)

        rid = _request_id(request)
        # Stash on request.state so handlers / exception handler can read it.
        request.state.request_id = rid

        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception:
            # Re-raise — the global exception handler logs the traceback.
            # We still record the http_request row in the finally block so
            # request-rate stats stay accurate.
            raise
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            severity = (
                EventSeverity.ERROR if status_code >= 500
                else EventSeverity.WARNING if status_code >= 400
                else EventSeverity.INFO
            )
            log_event(
                event_type=EventType.HTTP_REQUEST,
                severity=severity,
                user_email=_user_email(request),
                request_id=rid,
                method=request.method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
            )


def install_exception_handler(app: FastAPI) -> None:
    """Catch unhandled exceptions, persist a row, return clean 500 JSON.

    HTTPException is intentionally NOT caught here — FastAPI's default handler
    formats those properly, and the request middleware already records them
    as warnings via status_code >= 400.
    """

    @app.exception_handler(Exception)
    async def _handle_unhandled(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", None)
        log_event(
            event_type=EventType.EXCEPTION,
            severity=EventSeverity.ERROR,
            user_email=_user_email(request),
            request_id=rid,
            method=request.method,
            path=request.url.path,
            status_code=500,
            error=exc,
        )
        # Mirror to stdout for `databricks apps logs` tail.
        logger.exception(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "request_id": rid},
        )
