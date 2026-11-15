"""Grounding — /api/grounding/scan.

"Use existing data": the user picks real Unity Catalog tables to build the demo
ON. This endpoint scans those tables (schema + light stats + a few sample rows)
BEFORE the project exists and warms the process-level cache the capability-suggest
endpoint reads from, so the proposed stories are grounded in the actual tables.

Runs as the app service principal (Apps OBO tokens can't run warehouse queries)
on a warehouse resolved by `pick_query_warehouse`.
"""

from __future__ import annotations

import json

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ..core import Dependencies, create_router
from ..core._config import logger
from ..models import (
    GroundingScannedTable,
    GroundingScanRequest,
)
from ..services import table_stats
from ..services.shutdown import shutdown_requested
from .resources import pick_query_warehouse

router = create_router()


def _warehouse_is_cold(ws, warehouse_id: str) -> bool:
    """True if the resolved warehouse isn't RUNNING (so the first query will pay
    a serverless cold-start) — used to tell the UI we're 'starting the warehouse'
    rather than already reading. One cheap control-plane call; defaults to False
    (don't claim a cold start we're unsure about)."""
    try:
        wh = ws.warehouses.get(id=warehouse_id)
        state = getattr(getattr(wh, "state", None), "value", None) or str(getattr(wh, "state", ""))
        return state.upper() != "RUNNING"
    except Exception as e:  # noqa: BLE001 — best-effort hint only
        logger.debug("warehouse state check failed for %s: %s", warehouse_id, e)
        return False


@router.post(
    "/grounding/scan",
    operation_id="scanGroundingTables",
)
def scan(
    body: GroundingScanRequest,
    ws: Dependencies.Client,
):
    """Scan selected real UC tables (schema + light stats + a few sample rows)
    and warm the process-level cache the suggest endpoint reads from — STREAMING
    progress so the UI can say what it's doing (starting the warehouse vs reading
    tables) instead of a blank spinner.

    Tables are scanned IN PARALLEL (see `table_stats.scan_tables_progress`), so a
    multi-table selection no longer costs the sum of the per-table times. Runs as
    the app service principal on a resolved warehouse (OBO tokens can't run
    warehouse queries on Databricks Apps — see `Dependencies` docs). This is the
    one grounding path that reads table DATA; only a light summary is streamed.

    SSE events: `warehouse` ({name, starting}) → `scanning` ({done, total, table})
    ×N → `done` ({scanned:[…], warehouse_name}); `error` ({detail}) on failure.
    """
    tables = [t.strip() for t in body.tables if t.strip()]
    if not tables:
        raise HTTPException(status_code=422, detail="Select at least one table to scan.")

    def events():
        warehouse_id, warehouse_name = pick_query_warehouse(ws)
        if not warehouse_id:
            yield (
                "event: error\ndata: "
                + json.dumps({"detail": "No SQL warehouse available to scan the tables. Start a warehouse and retry."})
                + "\n\n"
            )
            return

        yield (
            "event: warehouse\ndata: "
            + json.dumps({"name": warehouse_name, "starting": _warehouse_is_cold(ws, warehouse_id)})
            + "\n\n"
        )

        try:
            for ev in table_stats.scan_tables_progress(ws, tables, warehouse_id):
                # Redeploy in flight → stop scanning so we don't hold uvicorn's
                # graceful-shutdown drain open (sync generator in a threadpool;
                # task.cancel() can't reach it — poll the flag set on SIGTERM).
                # See services/shutdown.py.
                if shutdown_requested():
                    return
                if ev["type"] == "done":
                    scanned = [
                        GroundingScannedTable(
                            full_name=s.full_name,
                            row_count=s.row_count,
                            column_count=len(s.columns),
                            sampled=len(s.sample_rows),
                            error=s.error,
                        ).model_dump()
                        for s in ev["scans"]
                    ]
                    yield (
                        "event: done\ndata: "
                        + json.dumps({"scanned": scanned, "warehouse_name": warehouse_name})
                        + "\n\n"
                    )
                else:
                    yield (
                        "event: scanning\ndata: "
                        + json.dumps({"done": ev["done"], "total": ev["total"], "table": ev.get("table")})
                        + "\n\n"
                    )
        except Exception as e:  # noqa: BLE001 — surface a usable message to the UI
            logger.error("grounding scan failed: %s", e)
            yield "event: error\ndata: " + json.dumps({"detail": f"Scan failed: {e}"}) + "\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
