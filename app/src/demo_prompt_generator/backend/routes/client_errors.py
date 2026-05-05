"""POST /api/client_errors — receive frontend error reports.

The UI's error reporter (ui/lib/error-reporter.ts) hooks window.onerror,
unhandledrejection, and the fetch wrapper, then ships JS errors here so they
land in the same event_logs table as backend errors. That way weekly review
covers the full stack with one query.
"""

from __future__ import annotations

from fastapi import Request

from ..core import Dependencies, create_router
from ..models import ClientErrorReport, EventSeverity, EventType
from ..services import event_logger

router = create_router()


@router.post("/client_errors", operation_id="reportClientError")
async def report_client_error(
    body: ClientErrorReport,
    headers: Dependencies.Headers,
    request: Request,
):
    """Persist a frontend-reported error. Always returns {"ok": true}.

    No auth check beyond the platform's user-header — same as every other
    /api/* route. We don't want a logging path to ever fail in a way that
    the UI feels obligated to retry.
    """
    user_email = headers.user_email if headers else None
    rid = body.request_id or getattr(request.state, "request_id", None)

    event_logger.log_event(
        event_type=EventType.CLIENT_ERROR,
        severity=EventSeverity.ERROR,
        user_email=user_email,
        project_id=body.project_id,
        request_id=rid,
        error_type=body.error_type,
        error_message=body.message,
        metadata={
            "stack": body.stack,
            "url": body.url,
            "user_agent": body.user_agent,
            **(body.extra or {}),
        },
    )
    return {"ok": True}
