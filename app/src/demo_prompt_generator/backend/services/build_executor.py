"""Build executor: spawns a Claude Code agent session via claude-agent-sdk.

Uses the Databricks FMAPI serving endpoint (no Anthropic API key needed).
The generated SKILL.md + package files become the system prompt, and the agent
gets full access to Claude Code tools (Read, Write, Edit, Bash, Glob, Grep)
plus Databricks MCP tools and AI Dev Kit skills.

Inspired by the databricks-builder-app pattern:
  https://github.com/databricks-solutions/ai-dev-kit/tree/main/databricks-builder-app
"""

from __future__ import annotations

import asyncio
import logging
import os
import queue
import threading
from collections.abc import AsyncIterator
from contextvars import copy_context
from pathlib import Path

logger = logging.getLogger(__name__)

# Keepalive interval (seconds) — matches the builder app pattern
_KEEPALIVE_INTERVAL = 5


# ---------------------------------------------------------------------------
# System prompt composition
# ---------------------------------------------------------------------------


def compose_build_system_prompt(files: dict[str, str]) -> str:
    """Combine all package files into a structured system prompt for the build agent."""
    skill_md = files.get("SKILL.md", "")
    storyline = files.get("storyline.md", "")
    architecture = files.get("architecture.md", "")
    data_schema = files.get("data-schema.md", "")
    project_structure = files.get("project-structure.md", "")
    walkthrough = files.get("walkthrough.md", "")

    return f"""\
You are a Databricks demo builder. Your job is to execute the build plan below \
by creating all necessary project files in the working directory.

You have full access to Claude Code tools (Read, Write, Edit, Bash, Glob, Grep) \
and Databricks MCP tools (execute_sql, create_or_update_dashboard, etc.). \
Use the appropriate AI Dev Kit skills when building specific components.

IMPORTANT: Always use your tools to create files and run commands. \
Load the relevant skill BEFORE building each component.

# Primary Instructions (SKILL.md)

{skill_md}

---

# Reference: Storyline

{storyline}

---

# Reference: Architecture

{architecture}

---

# Reference: Data Schema

{data_schema}

---

# Reference: Project Structure

{project_structure}

---

# Reference: Walkthrough

{walkthrough}

---

# Build Rules

1. Create ALL files described in the project structure document.
2. Use the data schemas EXACTLY as specified — column names, types, and relationships.
3. Follow the build steps in SKILL.md in order.
4. For each build step, load the relevant AI Dev Kit skill first (e.g. \
databricks-spark-declarative-pipelines for pipelines, databricks-aibi-dashboards \
for dashboards, databricks-genie for Genie spaces).
5. Use Databricks MCP tools to create resources directly when possible \
(execute_sql for tables, create_or_update_dashboard for dashboards, etc.).
6. For Python files, include proper imports and follow PEP 8.
7. For SQL files, use Databricks SQL dialect.
8. Create a databricks.yml asset bundle config if the project structure specifies one.
9. Report progress after completing each major build step.
10. When finished, provide a summary of all files and resources created."""


# ---------------------------------------------------------------------------
# Project directory management
# ---------------------------------------------------------------------------


def resolve_build_dir(
    user_email: str, demo_name: str, generation_id: int,
    base_dir: str = "",
) -> Path:
    """Determine and create the user-scoped project directory for the build."""
    base = Path(base_dir) if base_dir else Path("/tmp/demo-builds")
    safe_email = user_email.replace("/", "_").replace("\\", "_")
    safe_name = demo_name.replace(" ", "-").replace("/", "_").replace("\\", "_")
    project_dir = base / safe_email / f"{safe_name}-{generation_id}"
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


# ---------------------------------------------------------------------------
# Claude Agent SDK environment setup (FMAPI pattern)
# ---------------------------------------------------------------------------


def _build_claude_env(databricks_host: str, databricks_token: str) -> dict[str, str]:
    """Build environment variables for the Claude Code subprocess.

    Configures the Agent SDK to use Databricks FMAPI instead of Anthropic API.
    This is the same pattern used by the databricks-builder-app.
    """
    host = databricks_host.replace("https://", "").replace("http://", "").rstrip("/")

    return {
        # Route to Databricks FMAPI serving endpoint
        "ANTHROPIC_BASE_URL": f"https://{host}/serving-endpoints/anthropic",
        "ANTHROPIC_API_KEY": databricks_token,
        "ANTHROPIC_AUTH_TOKEN": databricks_token,
        # Model to use via FMAPI
        "ANTHROPIC_MODEL": os.environ.get("ANTHROPIC_MODEL", "databricks-claude-sonnet-4-6"),
        # Required header for coding agent mode
        "ANTHROPIC_CUSTOM_HEADERS": "x-databricks-use-coding-agent-mode: true",
        # Disable experimental betas unsupported by FMAPI
        "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
        # Generous timeout for long builds
        "CLAUDE_CODE_STREAM_CLOSE_TIMEOUT": "3600000",
        # Pass through Databricks auth for MCP tools
        "DATABRICKS_HOST": databricks_host,
        "DATABRICKS_TOKEN": databricks_token,
    }


# ---------------------------------------------------------------------------
# Agent thread runner (fresh event loop pattern from builder app)
# ---------------------------------------------------------------------------


def _run_agent_in_thread(
    result_queue: queue.Queue,
    prompt: str,
    system_prompt: str,
    project_dir: str,
    claude_env: dict[str, str],
):
    """Run the Claude Agent SDK in a dedicated thread with its own event loop.

    This avoids conflicts with FastAPI/uvicorn's event loop, which interferes
    with the Agent SDK's subprocess transport.
    """
    from claude_agent_sdk import ClaudeAgentOptions, query

    async def _run():
        try:
            options = ClaudeAgentOptions(
                cwd=project_dir,
                system_prompt=system_prompt,
                allowed_tools=[
                    "Read", "Write", "Edit", "Bash", "Glob", "Grep", "Skill",
                ],
                permission_mode="bypassPermissions",
                env=claude_env,
                max_turns=100,
            )

            async for message in query(prompt=prompt, options=options):
                result_queue.put(("message", message))

        except Exception as exc:
            result_queue.put(("error", exc))
        finally:
            result_queue.put(("done", None))

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Message processing helpers
# ---------------------------------------------------------------------------


def _process_agent_message(msg) -> list[dict]:
    """Convert an Agent SDK message into SSE-ready event dicts."""
    events: list[dict] = []
    msg_type = type(msg).__name__

    if msg_type == "AssistantMessage":
        for block in getattr(msg, "content", []):
            block_type = type(block).__name__
            if block_type == "TextBlock" or hasattr(block, "text"):
                text = getattr(block, "text", "")
                if text:
                    events.append({"type": "build_message", "content": text})
            elif block_type == "ToolUseBlock" or hasattr(block, "name"):
                tool_name = getattr(block, "name", "unknown")
                tool_input = getattr(block, "input", {})
                # Summarize input for the UI
                summary = {}
                if isinstance(tool_input, dict):
                    for k, v in tool_input.items():
                        s = str(v)
                        summary[k] = s[:200] if len(s) > 200 else s
                events.append({
                    "type": "build_tool_call",
                    "tool": tool_name,
                    "args": summary,
                })
            elif block_type == "ToolResultBlock" or hasattr(block, "tool_use_id"):
                content = getattr(block, "content", "")
                if isinstance(content, list):
                    content = " ".join(
                        getattr(c, "text", str(c)) for c in content
                    )
                events.append({
                    "type": "build_tool_result",
                    "tool": "result",
                    "result": str(content)[:2000],
                })

    elif msg_type == "ResultMessage":
        result_text = getattr(msg, "result", "") or ""
        session_id = getattr(msg, "session_id", "")
        events.append({
            "type": "build_complete",
            "project_dir": "",  # filled in by caller
            "files_created": [],  # filled in by caller
            "result": result_text,
            "session_id": session_id,
        })

    elif msg_type == "SystemMessage":
        subtype = getattr(msg, "subtype", "")
        if subtype == "init":
            data = getattr(msg, "data", {}) or {}
            events.append({
                "type": "build_init",
                "session_id": data.get("session_id", ""),
            })

    return events


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def stream_build_execution(
    files: dict[str, str],
    user_email: str,
    demo_name: str,
    generation_id: int,
    databricks_host: str,
    databricks_token: str,
    model: str = "",
    base_dir: str = "",
) -> AsyncIterator[dict]:
    """Spawn a Claude Code agent session to execute the build plan.

    Yields SSE-ready event dicts:
      - {"type": "build_start", "project_dir": "..."}
      - {"type": "build_init", "session_id": "..."}
      - {"type": "build_message", "content": "..."}
      - {"type": "build_tool_call", "tool": "...", "args": {...}}
      - {"type": "build_tool_result", "tool": "...", "result": "..."}
      - {"type": "build_complete", "project_dir": "...", "files_created": [...]}
      - {"type": "build_error", "content": "..."}
    """
    build_dir = resolve_build_dir(user_email, demo_name, generation_id, base_dir)
    project_dir_str = str(build_dir)

    yield {"type": "build_start", "project_dir": project_dir_str}

    system_prompt = compose_build_system_prompt(files)
    claude_env = _build_claude_env(databricks_host, databricks_token)

    # Override model if specified
    if model:
        claude_env["ANTHROPIC_MODEL"] = model

    prompt = (
        "Execute the build plan described in your system prompt. "
        "Create all project files as described in the project structure and data schema. "
        "Follow the build steps in SKILL.md in order. "
        "Use MCP tools and skills where appropriate. Begin now."
    )

    # Run agent in a dedicated thread with fresh event loop
    result_queue: queue.Queue = queue.Queue()
    ctx = copy_context()

    thread = threading.Thread(
        target=lambda: ctx.run(
            _run_agent_in_thread,
            result_queue, prompt, system_prompt, project_dir_str, claude_env,
        ),
        daemon=True,
    )
    thread.start()

    # Consume events from the agent thread
    got_complete = False
    while True:
        try:
            msg_type, msg = result_queue.get(timeout=_KEEPALIVE_INTERVAL)
        except queue.Empty:
            # Send keepalive to prevent SSE timeout
            yield {"type": "keepalive"}
            continue

        if msg_type == "done":
            break

        if msg_type == "error":
            yield {"type": "build_error", "content": str(msg)}
            break

        if msg_type == "message":
            for event in _process_agent_message(msg):
                # Enrich build_complete with project dir info
                if event.get("type") == "build_complete":
                    event["project_dir"] = project_dir_str
                    # List all files created in the build dir
                    created = []
                    for p in build_dir.rglob("*"):
                        if p.is_file():
                            created.append(str(p.relative_to(build_dir)))
                    event["files_created"] = sorted(created)
                    got_complete = True
                yield event

    # If the agent didn't send a complete event, synthesize one
    if not got_complete:
        created = []
        for p in build_dir.rglob("*"):
            if p.is_file():
                created.append(str(p.relative_to(build_dir)))
        yield {
            "type": "build_complete",
            "project_dir": project_dir_str,
            "files_created": sorted(created),
        }
