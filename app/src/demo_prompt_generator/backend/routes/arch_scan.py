"""GET /api/architecture/scan-prompt — the home page's "From an existing project" button.

The prompt a user gives their own agent (one that can run the Databricks CLI in the customer's
workspace) to reconstruct a project's architecture, read-only. See services/workspace_scan.py.
"""

from __future__ import annotations

from fastapi.responses import PlainTextResponse

from ..core import create_router
from ..services.workspace_scan import Detail, scan_prompt

router = create_router()


@router.get("/architecture/scan-prompt", response_class=PlainTextResponse, operation_id="architectureScanPrompt")
def architecture_scan_prompt(workspace: str | None = None, start: str | None = None, detail: Detail = "high") -> str:
    return scan_prompt(workspace, start, detail)
