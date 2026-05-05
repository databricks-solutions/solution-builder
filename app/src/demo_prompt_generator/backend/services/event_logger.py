"""Safe-fail writer for the event_logs table.

Design rules:
1. **Logging never breaks the app.** Every public function swallows its own
   exceptions and logs them at WARNING level on the in-process logger.
2. **No request-path latency.** `log_event` schedules the DB write as a
   background task (`asyncio.create_task` + `to_thread`) so the response
   returns before the row is committed. Use `log_event_sync` only from
   contexts where you're already on a worker thread (e.g. inside a sync
   service method).
3. **Bounded payload.** Stack traces and error messages are truncated so a
   pathological exception can't bloat the row. Free-form `metadata` is
   passed through as-is — keep it small at the call site.
"""

from __future__ import annotations

import asyncio
import logging
import traceback
from typing import Any, Optional

from sqlalchemy import Engine
from sqlmodel import Session

from ..models import EventLog, EventSeverity, EventType

logger = logging.getLogger(__name__)

# Cap large fields so a runaway exception can't blow out a row.
_MAX_MESSAGE_CHARS = 4_000
_MAX_STACK_CHARS = 8_000

# Lakebase engine registered once at startup by the lifespan. Lets services
# (LLM, agent) call log_event() without threading the engine through every
# call site. None means logging is a no-op (e.g. tests, local boot before DB
# is ready).
_ENGINE: Engine | None = None

# Strong references to in-flight background log tasks. asyncio.create_task
# returns a Task that the event loop only weakly references; without holding
# our own reference the GC can collect (and cancel) the task mid-flight. We
# add on schedule and remove on completion via add_done_callback.
_IN_FLIGHT_TASKS: set[asyncio.Task[None]] = set()


def register_engine(engine: Engine) -> None:
    """Called by the Lakebase lifespan once the engine is built."""
    global _ENGINE
    _ENGINE = engine


def _resolve_engine(engine: Engine | None) -> Engine | None:
    return engine if engine is not None else _ENGINE


def _trunc(s: Optional[str], limit: int) -> Optional[str]:
    if s is None:
        return None
    if len(s) <= limit:
        return s
    return s[:limit] + f"\n... [truncated {len(s) - limit} chars]"


def _format_exc(exc: BaseException) -> tuple[str, str, str]:
    """Return (error_type, error_message, stack_trace) — all truncated."""
    error_type = type(exc).__name__
    error_message = _trunc(str(exc) or error_type, _MAX_MESSAGE_CHARS) or error_type
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return error_type, error_message, _trunc(tb, _MAX_STACK_CHARS) or ""


def _write_row(engine: Engine, row: EventLog) -> None:
    """Synchronously commit one event_logs row. Must NOT raise."""
    try:
        with Session(engine) as db:
            db.add(row)
            db.commit()
    except Exception as e:
        # Don't recurse — just write to stderr-style logger and move on.
        logger.warning(f"event_logger: failed to persist {row.event_type} row: {e!r}")


def log_event_sync(
    engine: Engine | None = None,
    *,
    event_type: str | EventType,
    severity: str | EventSeverity = EventSeverity.INFO,
    user_email: Optional[str] = None,
    project_id: Optional[str] = None,
    request_id: Optional[str] = None,
    method: Optional[str] = None,
    path: Optional[str] = None,
    status_code: Optional[int] = None,
    duration_ms: Optional[int] = None,
    error: Optional[BaseException] = None,
    error_type: Optional[str] = None,
    error_message: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Synchronous write — use from sync code paths or worker threads."""
    try:
        eng = _resolve_engine(engine)
        if eng is None:
            return  # No engine yet (e.g., logging during boot before DB ready) — drop.
        et = event_type.value if isinstance(event_type, EventType) else event_type
        sev = severity.value if isinstance(severity, EventSeverity) else severity

        if error is not None:
            error_type, error_message, stack = _format_exc(error)
        else:
            stack = None
            error_message = _trunc(error_message, _MAX_MESSAGE_CHARS)

        row = EventLog(
            event_type=et,
            severity=sev,
            user_email=user_email,
            project_id=project_id,
            request_id=request_id,
            method=method,
            path=_trunc(path, 500),
            status_code=status_code,
            duration_ms=duration_ms,
            error_type=_trunc(error_type, 200),
            error_message=error_message,
            stack_trace=stack,
            event_metadata=metadata,
        )
        _write_row(eng, row)
    except Exception as e:
        logger.warning(f"event_logger.log_event_sync failed: {e!r}")


def log_event(
    engine: Engine | None = None,
    *,
    event_type: str | EventType,
    severity: str | EventSeverity = EventSeverity.INFO,
    user_email: Optional[str] = None,
    project_id: Optional[str] = None,
    request_id: Optional[str] = None,
    method: Optional[str] = None,
    path: Optional[str] = None,
    status_code: Optional[int] = None,
    duration_ms: Optional[int] = None,
    error: Optional[BaseException] = None,
    error_type: Optional[str] = None,
    error_message: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Fire-and-forget async write — safe to call from request handlers.

    Schedules the row to be written on a worker thread so the calling
    coroutine doesn't await the DB. Loses rows if there's no running event
    loop (falls back to a sync write in that case).
    """
    eng = _resolve_engine(engine)
    if eng is None:
        return
    kwargs = dict(
        event_type=event_type,
        severity=severity,
        user_email=user_email,
        project_id=project_id,
        request_id=request_id,
        method=method,
        path=path,
        status_code=status_code,
        duration_ms=duration_ms,
        error=error,
        error_type=error_type,
        error_message=error_message,
        metadata=metadata,
    )
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        log_event_sync(eng, **kwargs)  # type: ignore[arg-type]
        return

    async def _run() -> None:
        try:
            await loop.run_in_executor(None, lambda: log_event_sync(eng, **kwargs))  # type: ignore[arg-type]
        except Exception as e:
            logger.warning(f"event_logger.log_event background task failed: {e!r}")

    try:
        task = loop.create_task(_run())
        _IN_FLIGHT_TASKS.add(task)
        task.add_done_callback(_IN_FLIGHT_TASKS.discard)
    except Exception as e:
        logger.warning(f"event_logger.log_event scheduling failed: {e!r}")
