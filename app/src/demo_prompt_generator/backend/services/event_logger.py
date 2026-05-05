"""Structured event logging routed to Databricks Apps OTLP collector.

The app is started via `opentelemetry-instrument` (see scripts/build.sh).
The OTel Python distro attaches a LoggingHandler to the root logger that
exports every record via OTLP — Databricks then lands them in the workspace's
`otel_logs` UC table. Custom fields passed via `extra={}` flow through as
attributes on the LogRecord, queryable as `attributes['<key>']` in SQL.

Why this module still exists (instead of just `logger.info(...)` everywhere):
- One choke point for the contract — every event_logs query downstream
  expects the same set of attribute keys (`event_type`, `severity`,
  `user_email`, `project_id`, `request_id`, `duration_ms`, ...).
- Automatic exception → traceback formatting + truncation.
- Failure isolation: a malformed `extra` dict shouldn't crash a request.

Querying example (workspace otel table; `service_name = '<app-name>'`):

    SELECT time, body, attributes['event_type'], attributes['user_email']
    FROM <catalog>.<schema>.otel_logs
    WHERE service_name = 'asset-generator-enrich'
      AND attributes['event_type'] = 'agent_run'
      AND attributes['phase'] = 'errored'
      AND time > current_timestamp() - INTERVAL 7 DAYS;
"""

from __future__ import annotations

import logging
import traceback
from typing import Any, Optional

from ..models import EventSeverity, EventType

# Dedicated logger so handler config / level changes don't accidentally
# affect the rest of the app's logging. The OTLP exporter wraps the ROOT
# logger (via the OTel distro) so any child logger's records flow through.
logger = logging.getLogger("demo-prompt-generator.events")

# Cap large fields so a runaway exception can't blow out a row. The
# Databricks Apps log line size limit is 1 MB — we cap well below that to
# leave headroom for trace context + attributes injected by the SDK.
_MAX_MESSAGE_CHARS = 4_000
_MAX_STACK_CHARS = 8_000

# Severity → stdlib level. The OTel logging instrumentation maps stdlib
# levels to OTLP severity_text values (INFO/WARN/ERROR), which become the
# `severity_text` column in `otel_logs`. We ALSO put `severity` into
# attributes so consumers can filter without trusting the level mapping.
_SEVERITY_TO_LEVEL = {
    EventSeverity.INFO.value: logging.INFO,
    EventSeverity.WARNING.value: logging.WARNING,
    EventSeverity.ERROR.value: logging.ERROR,
}


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


def _normalize(value: Any) -> Any:
    """Coerce a value into something OTLP can serialize as an attribute.

    OTLP attribute values are scalars (str / int / float / bool) or arrays
    of scalars. Dicts and other complex types are stringified so they
    round-trip cleanly into the `otel_logs.attributes` map.
    """
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_normalize(v) for v in value]
    return str(value)


def _build_extra(
    *,
    event_type: str,
    severity: str,
    user_email: Optional[str],
    project_id: Optional[str],
    request_id: Optional[str],
    method: Optional[str],
    path: Optional[str],
    status_code: Optional[int],
    duration_ms: Optional[int],
    error_type: Optional[str],
    error_message: Optional[str],
    stack_trace: Optional[str],
    metadata: Optional[dict[str, Any]],
) -> dict[str, Any]:
    extra: dict[str, Any] = {
        "event_type": event_type,
        "severity": severity,
    }
    # Populate only present fields — keeps the attributes map tight and
    # makes existence-checks meaningful in queries (`WHERE attributes
    # ? 'project_id'`).
    optional = {
        "user_email": user_email,
        "project_id": project_id,
        "request_id": request_id,
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "error_type": error_type,
        "error_message": error_message,
        "stack_trace": stack_trace,
    }
    for k, v in optional.items():
        if v is not None:
            extra[k] = v
    if metadata:
        # Metadata dict is flattened into attributes with a `meta_` prefix
        # so it doesn't collide with the canonical fields above. Nested
        # dicts/lists get stringified by _normalize.
        for k, v in metadata.items():
            extra[f"meta_{k}"] = _normalize(v)
    return extra


def log_event(
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
    """Emit a structured event log record.

    The OTel handler buffers and exports asynchronously, so this is
    effectively zero-cost on the request path — there's no DB write, no
    network call inline. Wrapped in try/except as a belt-and-braces guard
    against a malformed `metadata` dict.
    """
    try:
        et = event_type.value if isinstance(event_type, EventType) else event_type
        sev = severity.value if isinstance(severity, EventSeverity) else severity

        if error is not None:
            error_type, error_message, stack_trace = _format_exc(error)
        else:
            stack_trace = None
            error_message = _trunc(error_message, _MAX_MESSAGE_CHARS)

        extra = _build_extra(
            event_type=et,
            severity=sev,
            user_email=user_email,
            project_id=project_id,
            request_id=request_id,
            method=method,
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
            error_type=_trunc(error_type, 200),
            error_message=error_message,
            stack_trace=stack_trace,
            metadata=metadata,
        )

        level = _SEVERITY_TO_LEVEL.get(sev, logging.INFO)
        # The body lands in `otel_logs.body` as a short summary; structured
        # data is in `attributes`. Keep the body human-readable so the
        # Databricks UI's log viewer is useful at a glance.
        body = f"{et}"
        if path:
            body = f"{et} {method or ''} {path}".strip()
        elif metadata and metadata.get("phase"):
            body = f"{et} {metadata['phase']}"
        logger.log(level, body, extra=extra)
    except Exception as e:  # pragma: no cover — logging must never raise
        # Last-ditch guard. Don't recurse via logger.warning(...) with
        # extras — just write a plain message to stderr.
        logging.getLogger(__name__).warning(
            "event_logger.log_event failed: %r", e
        )


# Back-compat alias for callers that already passed engine/used the sync API.
# OTLP export is async behind the SDK's BatchLogRecordProcessor, so a
# separate "sync" path no longer exists — both names just call log_event.
log_event_sync = log_event


def register_engine(_engine: Any) -> None:
    """Deprecated no-op — kept so callers in core/lakebase.py don't break.

    The Lakebase engine is no longer used for event logging; OTLP export is
    handled entirely by the OTel SDK auto-instrumentation. Safe to remove
    this and the call site once nothing else references it.
    """
    return None
