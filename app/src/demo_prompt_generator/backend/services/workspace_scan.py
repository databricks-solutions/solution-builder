"""The "architecture from an existing project" prompt.

A user (or an agent reaching Solution Builder through the MCP) takes this prompt to an agent
that can run the Databricks CLI in the customer's workspace. That agent explores the project
read-only (lineage, query history, the bundle, the resources next to it) and writes a brief
with every resource and its link; Solution Builder draws the diagram from the brief.

One text, `workspace_scan_prompt.md`, served to the home page's button and to the MCP guide.
"""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import parse_qs, urlparse
from pathlib import Path
from typing import Literal

Detail = Literal["high", "detailed"]

_TABLES = {
    "detailed": "every table and view, grouped by layer (bronze / silver / gold, or however the code "
                "groups them), with its type, and the lineage between them.",
    "high": "one line per layer or group of tables: how many tables it holds and the two or three "
            "that matter, by name. Metric views by name.",
}
_LEVEL = {
    "detailed": ("detailed: one node per table, the lineage between tables as arrows. Past about 30 nodes, "
                 "two tabs: an overview (one node per pipeline, job, layer of tables and consumer) and the "
                 "table-by-table lineage"),
    "high": ("high level, about 10 to 15 nodes: one node per pipeline or job, one per layer of tables (not "
             "per table), one per dashboard, Genie space, app and model; the catalog, warehouse and service "
             "principals in the story, not as nodes"),
}


@lru_cache(maxsize=1)
def _template() -> str:
    return (Path(__file__).with_name("workspace_scan_prompt.md")).read_text(encoding="utf-8")


def _workspace_of(url: str) -> str:
    """The workspace of a resource URL (its origin, plus `?o=<id>` when it has one)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.netloc:
        return ""
    org = parse_qs(u.query).get("o", [""])[0]
    return f"{u.scheme}://{u.netloc}/" + (f"?o={org}" if org else "")


def scan_prompt(workspace: str | None = None, start: str | None = None, detail: Detail = "high") -> str:
    """The prompt, with what the user gave filled in and the rest left for the agent to ask."""
    values = {
        "workspace": (workspace or "").strip() or _workspace_of((start or "").strip()) or "ask the user for the workspace URL",
        "start": (start or "").strip() or "ask the user for the project: a pipeline, job, dashboard, "
                                          "Genie space, app, table or schema (a URL or a name)",
        "detail": _LEVEL[detail],
        "detail_tables": _TABLES[detail],
    }
    text = _template()
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return text
