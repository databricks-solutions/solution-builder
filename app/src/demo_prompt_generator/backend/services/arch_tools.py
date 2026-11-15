"""The agent's `render_architecture` tool: an in-process MCP tool, bound to one project.

    agent.py builds the server per pooled client:  build_arch_server(project_id, project_dir)
    and allows the tool as  mcp__arch__render_architecture.

It is a thin wrapper over `arch_render.render_project()`. What it adds:

  * a per-TURN budget (TURN_RENDER_BUDGET renders). `reset_turn(project_id)` is called at
    the start of every agent turn; past the budget the tool answers with a message
    instead of rendering, so a loop cannot burn browsers on one turn;
  * the MCP result: one JSON text block (the fault summary) plus the overview PNG(s) as
    image blocks, so the model SEES the render without a Read;
  * no Node, no per-project renderer copy: the browser runs here, in the app.

The project binding is the closure over `project_dir`. Never make this a module-level
server: project A's tool call must not reach project B's files.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import threading
from pathlib import Path
from typing import Any

from .arch_render import CROP_REGIONS, RenderError, RendererBusy, RenderInputError, render_project

logger = logging.getLogger(__name__)

SERVER_NAME = "arch"
TOOL_NAME = "render_architecture"
# The name the agent's allowed_tools must list.
FULL_TOOL_NAME = f"mcp__{SERVER_NAME}__{TOOL_NAME}"
TURN_RENDER_BUDGET = 3
# Images per call: the overview of each tab rendered, and any crops, capped so a
# five-tab file does not paste five full images into one result.
MAX_IMAGES_PER_CALL = 4

DESCRIPTION = (
    "Render the project's architecture.md with the same viewer as the Architecture tab and "
    "check it for layout faults. Returns a JSON summary (faults, advisory numbers) and the "
    "overview image of each tab rendered. Call it after you write architecture.md. "
    "`tab` picks one tab by name or 1-based number (default: every tab). `crop` returns a "
    "zoomed full-resolution view of a region: a region name (top-left, top-right, "
    "bottom-left, bottom-right, top, bottom, left, right, center) or {x, y, w, h} as "
    "fractions 0-1 of the overview. At most 3 renders per turn."
)

INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tab": {
            "description": "Tab name, or 1-based tab number. Omit to render every tab.",
            "anyOf": [{"type": "string"}, {"type": "integer"}],
        },
        "crop": {
            "description": "Zoom into one region of the overview: a region name or {x, y, w, h} fractions.",
            "anyOf": [
                {"type": "string", "enum": list(CROP_REGIONS)},
                {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"}, "y": {"type": "number"},
                        "w": {"type": "number"}, "h": {"type": "number"},
                    },
                    "required": ["x", "y", "w", "h"],
                },
            ],
        },
    },
}

_budget_lock = threading.Lock()
_renders_this_turn: dict[str, int] = {}


def reset_turn(project_id: str) -> None:
    """Start of an agent turn: the render budget is per turn, not per session."""
    with _budget_lock:
        _renders_this_turn.pop(project_id, None)


def _take_render(project_id: str) -> int | None:
    """Count one render against this turn. None when the budget is spent."""
    with _budget_lock:
        used = _renders_this_turn.get(project_id, 0)
        if used >= TURN_RENDER_BUDGET:
            return None
        _renders_this_turn[project_id] = used + 1
        return used + 1


def _refund_render(project_id: str) -> None:
    """A busy renderer did not render: give the attempt back."""
    with _budget_lock:
        if _renders_this_turn.get(project_id, 0) > 0:
            _renders_this_turn[project_id] -= 1


def _asset_paths() -> tuple[Path, Path]:
    """The standalone viewer and the shared layout check, from the architecture skill
    that ships with the app (the wheel's copy, or the repo's in dev)."""
    from .skills_manager import get_architecture_skill_path

    skill = get_architecture_skill_path()
    if skill is None:
        raise RenderError("the architecture skill is not installed in this build")
    viewer = skill / "renderer" / "architecture-viewer.html"
    browser_js = skill / "renderer" / "arch-browser.js"
    missing = [p.name for p in (viewer, browser_js) if not p.is_file()]
    if missing:
        raise RenderError(f"the renderer is missing from this build: {', '.join(missing)}")
    return viewer, browser_js


def _text(obj: dict[str, Any]) -> dict[str, Any]:
    return {"type": "text", "text": json.dumps(obj, ensure_ascii=False)}


def run_render(project_dir: Path, args: dict[str, Any], *, turn_key: str) -> list[dict[str, Any]]:
    """Run one render for the tool call. Returns MCP content blocks. Never raises for a
    bad input or a failed render: the agent gets the reason as a message."""
    used = _take_render(turn_key)
    if used is None:
        return [_text({
            "ok": False,
            "message": (f"render budget for this turn is spent ({TURN_RENDER_BUDGET} renders). "
                        "Stop rendering: fix what the last renders showed, then tell the user "
                        "which faults remain."),
        })]
    budget = f"{used}/{TURN_RENDER_BUDGET} renders used this turn"
    try:
        viewer, browser_js = _asset_paths()
        result = render_project(project_dir, args.get("tab"), args.get("crop"),
                                viewer_path=viewer, browser_js_path=browser_js)
    except RendererBusy as e:
        _refund_render(turn_key)
        return [_text({"ok": False, "busy": True, "message": str(e), "budget": budget})]
    except RenderInputError as e:
        _refund_render(turn_key)
        return [_text({"ok": False, "message": str(e), "budget": budget})]
    except RenderError as e:
        return [_text({"ok": False, "message": str(e), "budget": budget})]
    except Exception as e:  # never raise into the SDK: the agent gets the reason
        logger.exception("architecture render failed")
        return [_text({"ok": False, "message": f"the render failed: {e}", "budget": budget})]

    tabs = result["tabs"]
    clean = all(not t.get("error") and not t.get("faults") for t in tabs)
    summary = {
        "ok": True,
        "budget": budget,
        "tab_count": result["tab_count"],
        "clean": clean,
        "tabs": [
            ({"tab": t["tab"], "error": t["error"]} if t.get("error") else {
                "tab": t["tab"],
                "image": t["png"],
                "crop_image": t.get("crop_png"),
                "size_px": t["size_px"],
                "faults": t["faults"],
                "reported_not_gated": t["reported_not_gated"],
                "advisory": t["advisory"],
            })
            for t in tabs
        ],
    }
    if used == TURN_RENDER_BUDGET:
        summary["note"] = "That was your last render this turn."
    content: list[dict[str, Any]] = [_text(summary)]
    images = 0
    for t in tabs:
        for key in ("png", "crop_png"):
            rel = t.get(key)
            if not rel or t.get("error") or images >= MAX_IMAGES_PER_CALL:
                continue
            try:
                data = (project_dir / rel).read_bytes()
            except OSError:
                continue
            content.append({"type": "image", "data": base64.b64encode(data).decode("ascii"),
                            "mimeType": "image/png"})
            images += 1
    return content


def build_arch_server(project_id: str, project_dir: Path) -> Any:
    """The in-process MCP server for one project. Pass it as mcp_servers={SERVER_NAME: …}."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool(TOOL_NAME, DESCRIPTION, INPUT_SCHEMA)
    async def render_architecture(args: dict[str, Any]) -> dict[str, Any]:
        # Playwright's sync API blocks; keep it off the event loop.
        content = await asyncio.to_thread(run_render, project_dir, args or {}, turn_key=project_id)
        return {"content": content}

    return create_sdk_mcp_server(name=SERVER_NAME, version="1.0.0", tools=[render_architecture])
