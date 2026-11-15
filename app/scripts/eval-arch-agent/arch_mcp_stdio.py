"""The app's render tool, served over stdio for `claude -p` (the redraw eval).

    claude -p … --mcp-config mcp.json --strict-mcp-config   (run.sh writes mcp.json)

It exposes `render_architecture` with the SAME code the in-app agent gets
(backend/services/arch_tools.run_render): same schema, same viewer, same layout check,
same per-turn budget. The project is the directory given on the command line.

    app/.venv/bin/python -I scripts/eval-arch-agent/arch_mcp_stdio.py <project-dir>

Run with the venv python directly (never the `python3` shim inside app/, which rewrites
uv.lock). `-I` ignores PYTHONPATH, so this file puts app/src on sys.path itself.
"""
import asyncio
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "src"))

import mcp.types as types  # noqa: E402
from mcp.server.lowlevel import Server  # noqa: E402
from mcp.server.stdio import stdio_server  # noqa: E402

from demo_prompt_generator.backend.services import arch_tools  # noqa: E402

PROJECT = Path(sys.argv[1]).resolve()
server = Server("arch")


@server.list_tools()
async def _list_tools() -> list[types.Tool]:
    return [types.Tool(name=arch_tools.TOOL_NAME, description=arch_tools.DESCRIPTION,
                       inputSchema=arch_tools.INPUT_SCHEMA)]


@server.call_tool()
async def _call_tool(name: str, arguments: dict) -> list:
    if name != arch_tools.TOOL_NAME:
        raise ValueError(f"unknown tool {name!r}")
    # The budget is per process: one `claude -p` run is one eval turn.
    content = await asyncio.to_thread(arch_tools.run_render, PROJECT, arguments or {}, turn_key="eval")
    out: list = []
    for block in content:
        if block["type"] == "text":
            out.append(types.TextContent(type="text", text=block["text"]))
        else:
            out.append(types.ImageContent(type="image", data=block["data"], mimeType=block["mimeType"]))
    return out


async def _main() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(_main())
