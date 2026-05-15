"""Claude Code agent execution service.

Simplified async implementation with client pooling for session reuse.
No thread wrapper - runs directly in FastAPI async context.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Generator

from ..core._config import logger
from ..core.auth import Mode, subprocess_auth_env
from .active_stream import ActiveStream
from .skills_manager import get_project_directory, get_project_skills_list
from .system_prompt import get_system_prompt, get_workspace_url

# SDK types - imported dynamically but typed here
try:
    from claude_agent_sdk.types import (
        AssistantMessage,
        ResultMessage,
        SystemMessage,
        UserMessage,
        StreamEvent,
        TextBlock,
        ThinkingBlock,
        ToolUseBlock,
        ToolResultBlock,
    )
except ImportError:
    pass

# Constants
KEEPALIVE_INTERVAL = 15  # seconds between keepalive events
CLIENT_IDLE_TIMEOUT = 300  # 5 minutes before disconnecting idle clients


async def _keepalive_loop(stream: ActiveStream, interval: float = KEEPALIVE_INTERVAL) -> None:
    """Periodically append a keepalive event to `stream` so SSE clients see
    progress even when the SDK is blocked on a long-running tool call.

    The SDK's `receive_response()` does not yield while a tool is executing,
    so any in-loop keepalive would be unreachable. Running this as a separate
    asyncio.Task ticks on a wall-clock timer regardless of the SDK's state.
    """
    try:
        while not (stream.is_complete or stream.is_cancelled or stream.is_error):
            await asyncio.sleep(interval)
            if stream.is_complete or stream.is_cancelled or stream.is_error:
                return
            stream.add_event({"type": "keepalive", "ts": time.time()})
    except asyncio.CancelledError:
        return


def _build_claude_env(
    project_dir: Path,
    *,
    mode: Mode,
    local_profile: str | None,
) -> dict[str, str]:
    """Build environment variables for the Claude Code subprocess.

    Two concerns, composed:
      1. Claude ↔ Anthropic / FMAPI routing. When deployed as a Databricks
         App (service principal present), route Claude through the
         workspace's Foundation Model API instead of Anthropic directly.
         Locally, Claude uses ANTHROPIC_API_KEY inherited from the shell.
      2. Databricks auth for subprocess `databricks ...` CLI calls the
         agent makes. Sourced from core.auth.subprocess_auth_env — see
         backend/AUTH.md. Local mode: DATABRICKS_CONFIG_PROFILE points at
         the user's selected profile. Deployed mode: DATABRICKS_CONFIG_FILE
         points at a per-project file kept fresh by middleware.
    """
    env: dict[str, str] = {}

    # FMAPI routing is wired via <project>/.claude/settings.json
    # (apiKeyHelper + ANTHROPIC_BASE_URL + ANTHROPIC_MODEL) instead of env
    # vars. The token file the helper reads is rewritten every 15 min by
    # the lifespan task in core.lakebase. See core/fmapi_auth.py.
    #
    # Why not env vars: the agent kept copying ANTHROPIC_AUTH_TOKEN onto
    # `databricks` CLI calls (it sees them in `os.environ`), confusing the
    # auth chain. Settings-file mode keeps the subprocess env clean.

    # Front the project's venv on PATH so the agent's Bash tool defaults to
    # python3.12 (the .venv interpreter uv installed) instead of the system
    # /usr/bin/python3 (3.10 on Ubuntu 22.04). start.sh already does this for
    # the uvicorn process, but the Apps runtime injects something into the
    # agent's bash subprocess env that demotes the venv path — explicitly
    # pinning it here ensures the agent sees 3.12.
    venv_bin = os.environ.get("VIRTUAL_ENV", "")
    if venv_bin:
        venv_bin = f"{venv_bin}/bin"
    parent_path = os.environ.get("PATH", "/usr/bin:/bin")
    if venv_bin and venv_bin not in parent_path.split(":"):
        env["PATH"] = f"{venv_bin}:{parent_path}"
    elif venv_bin:
        # Already in PATH but not first — reorder so it wins.
        parts = [venv_bin] + [p for p in parent_path.split(":") if p != venv_bin]
        env["PATH"] = ":".join(parts)

    # Databricks CLI/SDK auth for the agent's shell commands.
    env.update(subprocess_auth_env(project_dir, mode=mode, local_profile=local_profile))

    # Relocate Claude Code's "user-scope" config tree from ~/.claude/ to
    # <project>/.claude/ so transcripts land inside the project dir. The
    # SDK honors this env var (see claude_agent_sdk/_internal/sessions.py:
    # _get_claude_config_home_dir) and propagates it to the CLI subprocess.
    # Without this, on app restart the ~/.claude/projects/ tree is gone and
    # every resume hits "No conversation found with session ID".
    env["CLAUDE_CONFIG_DIR"] = str(project_dir / ".claude")
    return env


# ---------------------------------------------------------------------------
# Client Pool - keeps clients alive for session reuse
# ---------------------------------------------------------------------------

@dataclass
class PooledClient:
    """Wrapper around a ClaudeSDKClient with metadata."""
    client: Any  # ClaudeSDKClient
    project_id: str
    created_at: float = field(default_factory=time.time)
    last_used_at: float = field(default_factory=time.time)
    is_busy: bool = False
    session_id: str | None = None

    def mark_used(self):
        self.last_used_at = time.time()

    def is_idle_expired(self) -> bool:
        return time.time() - self.last_used_at > CLIENT_IDLE_TIMEOUT


class ClientPool:
    """Pool of ClaudeSDKClient instances keyed by project_id."""

    def __init__(self):
        self._clients: dict[str, PooledClient] = {}
        self._lock = asyncio.Lock()

    async def get_client(self, project_id: str) -> PooledClient | None:
        """Get an existing client for a project if available and not busy."""
        async with self._lock:
            pooled = self._clients.get(project_id)
            if pooled and not pooled.is_busy and not pooled.is_idle_expired():
                pooled.is_busy = True
                pooled.mark_used()
                logger.info(f"Reusing pooled client for project {project_id}")
                return pooled
            return None

    async def register_client(
        self,
        project_id: str,
        client: Any,
        session_id: str | None = None,
    ) -> PooledClient:
        """Register a new client in the pool."""
        async with self._lock:
            # Disconnect any existing client first
            existing = self._clients.get(project_id)
            if existing:
                await self._disconnect_client(existing)

            pooled = PooledClient(
                client=client,
                project_id=project_id,
                session_id=session_id,
                is_busy=True,
            )
            self._clients[project_id] = pooled
            logger.info(f"Registered new client for project {project_id}")
            return pooled

    async def release_client(self, project_id: str, session_id: str | None = None):
        """Mark a client as available for reuse."""
        async with self._lock:
            pooled = self._clients.get(project_id)
            if pooled:
                pooled.is_busy = False
                pooled.mark_used()
                if session_id:
                    pooled.session_id = session_id
                logger.debug(f"Released client for project {project_id}")

    async def remove_client(self, project_id: str):
        """Remove and disconnect a client from the pool."""
        async with self._lock:
            pooled = self._clients.pop(project_id, None)
            if pooled:
                await self._disconnect_client(pooled)
                logger.info(f"Removed client for project {project_id}")

    async def reap_idle(self) -> int:
        """Disconnect + drop any pooled client that's idle past the timeout
        and not busy. Run from a background task so subprocesses + pipes get
        freed proactively instead of lingering until the next turn forces
        eviction inside `get_client`. Returns the number reaped.
        """
        async with self._lock:
            stale = [
                pid for pid, p in self._clients.items()
                if not p.is_busy and p.is_idle_expired()
            ]
            for pid in stale:
                pooled = self._clients.pop(pid, None)
                if pooled:
                    await self._disconnect_client(pooled)
                    logger.info(f"Reaped idle client for project {pid}")
            return len(stale)

    async def _disconnect_client(self, pooled: PooledClient):
        """Safely disconnect a client."""
        try:
            if pooled.client:
                await pooled.client.disconnect()
        except Exception as e:
            logger.warning(f"Error disconnecting client: {e}")

    async def shutdown_all(self, timeout: float = 5.0) -> int:
        """Disconnect every pooled client at app shutdown, with a hard
        per-client timeout. The Claude SDK's `disconnect()` awaits its
        Node subprocess to exit; if the subprocess is wedged it can hang
        the lifespan teardown indefinitely. Bound it.

        Returns the number of clients we tried to drop. Errors and
        timeouts are logged and swallowed — shutdown never raises.
        """
        async with self._lock:
            entries = list(self._clients.items())
            self._clients.clear()
        for project_id, pooled in entries:
            try:
                await asyncio.wait_for(
                    self._disconnect_client(pooled), timeout=timeout
                )
            except asyncio.TimeoutError:
                logger.warning(
                    f"[client-pool] disconnect of {project_id} timed out "
                    f"after {timeout}s — abandoning subprocess"
                )
            except Exception as e:
                logger.warning(f"[client-pool] disconnect error for {project_id}: {e!r}")
        return len(entries)


# Global client pool
_client_pool: ClientPool | None = None


def get_client_pool() -> ClientPool:
    """Get the global client pool instance."""
    global _client_pool
    if _client_pool is None:
        _client_pool = ClientPool()
    return _client_pool


# ---------------------------------------------------------------------------
# Agent Streaming
# ---------------------------------------------------------------------------

async def stream_agent_response(
    project_id: str,
    message: str,
    stream: ActiveStream,
    mode: Mode,
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    databricks_profile: str | None = None,
    session_id: str | None = None,
    template_lineage: dict | None = None,
) -> AsyncIterator[dict]:
    """
    Stream Claude Code agent responses with client pooling.

    Tries to reuse an existing client for the project if available.
    Falls back to creating a new client (with optional session resumption).

    Args:
        project_id: Project ID for working directory
        message: User message to process
        stream: ActiveStream for event buffering
        mode: "local" or "deployed" — dictates how the agent's subprocess
            authenticates to Databricks. See backend/AUTH.md.
        cluster_id: Optional Databricks cluster ID
        warehouse_id: Optional SQL warehouse ID
        default_catalog: Optional default catalog
        default_schema: Optional default schema
        databricks_profile: Local-mode profile name (ignored when deployed).
        session_id: Optional session ID for conversation resumption

    Yields:
        Event dictionaries for SSE streaming
    """
    try:
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    except ImportError:
        logger.error("claude-agent-sdk not installed")
        stream.mark_error("Claude Agent SDK not installed")
        yield {"type": "error", "error": "Claude Agent SDK not installed"}
        return

    # Get project directory for CWD
    project_dir = get_project_directory(project_id)
    if not project_dir.exists():
        logger.error(f"Project directory not found: {project_dir}")
        stream.mark_error(f"Project directory not found: {project_id}")
        yield {"type": "error", "error": "Project directory not found"}
        return

    pool = get_client_pool()
    pooled = await pool.get_client(project_id)
    client = None
    final_session_id = None
    created_new_client = False

    # Declared at function scope so the except handler can inspect it
    # whether or not we made it into the create-new-client path.
    stderr_buffer: list[str] = []

    try:
        if pooled:
            # Reuse existing client - just send a new query
            client = pooled.client
            logger.info(f"Reusing client for project {project_id}")
        else:
            # Create new client with full options
            created_new_client = True
            skills = get_project_skills_list(project_id)
            system_prompt = get_system_prompt(
                cluster_id=cluster_id,
                warehouse_id=warehouse_id,
                default_catalog=default_catalog,
                default_schema=default_schema,
                workspace_url=get_workspace_url(),
                databricks_profile=databricks_profile,
                skills=skills,
                project_dir=str(project_dir),
                template_lineage=template_lineage,
            )

            # Build allowed tools list. `Skill` enables the agent's Skill tool
            # so it can invoke skills declared in <cwd>/.claude/skills/ (notably
            # databricks-demo-generator + the per-project ai-dev-kit skills).
            # `Task` lets the agent spawn subagents — the demo-generator skill's
            # Stage 2 fan-out (app-spec subagent + 02/03/04 batched) and
            # Stage 3 build parallelization (Genie/Dashboard + KA/MAS + App
            # subagents) rely on it. Without `Task` enabled the agent
            # serializes everything and the parallelization prose in
            # SKILL.md / stages/*.md is dead text.
            allowed_tools = ["Skill", "Task", "Read", "Write", "Edit", "Glob", "Grep", "Bash"]

            # Hard-disable tools that don't behave in the Agent-SDK execution
            # model. Each group is here for a specific failure we've seen:
            #
            #   Scheduler family — assumes an interactive Claude Code session
            #     with a long-lived "/loop" pacer that re-wakes the agent at
            #     the scheduled time. Under the SDK we run a single
            #     client.receive_response() call; ScheduleWakeup returns
            #     success, the SDK emits ResultMessage, the session ends, and
            #     half the build silently never runs.
            #
            #   AskUserQuestion — under auto-build the demo skill explicitly
            #     promises "no asks, no gates" and the harness blocks the
            #     question anyway. Worse: when the question IS blocked, the
            #     agent commits to whatever default it had in mind. In the
            #     wild this produced a hand-rolled Streamlit app instead of
            #     the documented Node/React template. Force the agent to
            #     make its own choices from the skill instead of waiting.
            disallowed_tools = [
                "ScheduleWakeup",
                "CronCreate",
                "CronList",
                "CronDelete",
                "RemoteTrigger",
                "PushNotification",
                "AskUserQuestion",
            ]

            # Configure agent options
            # setting_sources=["project"] loads filesystem settings from the
            # project's .claude/ — this is what the Agent SDK uses to discover
            # skills (loading is gated on settingSources per the SDK docs). We
            # deliberately exclude "user" so the agent doesn't pick up the host
            # user's ~/.claude/ — and `mcp_servers={}` below stops it from
            # inheriting MCP servers from any settings file regardless.
            #
            # env carries two things (see _build_claude_env + AUTH.md):
            #   1. ANTHROPIC_* for FMAPI routing (deployed-as-app only)
            #   2. DATABRICKS_CONFIG_* so subprocess `databricks ...` calls
            #      authenticate as the user (file pointer in deployed mode,
            #      profile name in local mode)
            claude_env = _build_claude_env(
                project_dir,
                mode=mode,
                local_profile=databricks_profile,
            )
            # Capture Claude Code's stderr: log each line live AND buffer
            # the tail so the except handler can attach it to the error
            # surfaced to the user. Without this, ProcessError just says
            # "Check stderr output for details" — we'd have to grep logs.
            _STDERR_BUFFER_MAX = 200

            def _claude_stderr(line: str) -> None:
                stripped = line.rstrip()
                if not stripped:
                    return
                logger.warning(f"[claude-code stderr] {stripped}")
                stderr_buffer.append(stripped)
                if len(stderr_buffer) > _STDERR_BUFFER_MAX:
                    del stderr_buffer[: len(stderr_buffer) - _STDERR_BUFFER_MAX]

            options = ClaudeAgentOptions(
                cwd=str(project_dir),
                allowed_tools=allowed_tools,
                disallowed_tools=disallowed_tools,
                permission_mode="bypassPermissions",
                system_prompt=system_prompt,
                include_partial_messages=True,
                setting_sources=["project"],
                mcp_servers={},
                env=claude_env,
                stderr=_claude_stderr,
                # Default is 1 MB which is too tight for a coding agent — a
                # `Read` on a moderate file or `Bash` stdout from a verbose
                # command routinely exceeds it and kills the stdin reader.
                max_buffer_size=25 * 1024 * 1024,
                # Opus 4.7 + Sonnet 4.6 require the new `adaptive` thinking
                # shape — they reject the SDK's default `thinking.type.enabled`
                # with HTTP 400. Adaptive works on older models too, so we
                # set it unconditionally. `effort="high"` matches the API
                # default but pinning it keeps behavior predictable across
                # model versions.
                thinking={"type": "adaptive"},
                effort="high",
            )

            # Resume previous session if provided
            if session_id:
                options.resume = session_id
                options.continue_conversation = True
                logger.info(f"Resuming Claude Code session: {session_id}")

            # Make sure <project>/.claude/settings.json + helper script +
            # token file exist BEFORE spawning Claude Code. Idempotent +
            # cheap (no-op if the helper already exists). Catches projects
            # that predate this feature OR projects whose dir was
            # populated, so restore_project_from_db short-circuited before
            # the auto-provision could fire.
            from .file_sync import ensure_fmapi_auth_files
            ensure_fmapi_auth_files(project_dir, project_id)

            # Create and connect new client
            client = ClaudeSDKClient(options=options)
            await client.connect()
            logger.info(f"Created new client for project {project_id}")

            # Register in pool
            pooled = await pool.register_client(project_id, client, session_id)

        # Send the message
        await client.query(message)
        logger.info(f"Sent query to agent for project {project_id}")

        # Heartbeat task — adds a keepalive event to the in-memory stream every
        # KEEPALIVE_INTERVAL seconds. Lives in a separate task because the SDK's
        # `receive_response()` blocks for the entire duration of a tool call.
        # Without this, long Bash tools (Genie create, pipeline run, ML training)
        # produce zero events for 20+ minutes and the SSE handler reconnects
        # forever on empty windows.
        msg_count = 0
        heartbeat = asyncio.create_task(_keepalive_loop(stream))

        try:
            async for msg in client.receive_response():
                msg_count += 1
                msg_type = type(msg).__name__
                logger.debug(f"SDK message #{msg_count}: {msg_type}")

                # Oversized-message canary. The SDK's stdin reader dies when a
                # single message exceeds max_buffer_size (we raised it to 25 MB,
                # but any ~1 MB+ message still points at something worth knowing —
                # usually a Bash tool dumping a giant stdout or a Read of a huge
                # file). Log loudly at 500 KB+, but NEVER dump the full content.
                _log_if_oversized(msg, msg_count)

                # Check for cancellation
                if stream.is_cancelled:
                    try:
                        await client.interrupt()
                    except Exception:
                        pass
                    stream.mark_cancelled()
                    logger.info(f"Agent cancelled for project {project_id}")
                    return

                # Convert and yield events
                for event in _convert_sdk_message(msg):
                    stream.add_event(event)
                    yield event

                # Extract session_id from ResultMessage
                if msg_type == "ResultMessage" and hasattr(msg, "session_id") and msg.session_id:
                    final_session_id = msg.session_id
                    logger.info(f"Captured session_id: {final_session_id}")
        finally:
            heartbeat.cancel()
            try:
                await heartbeat
            except asyncio.CancelledError:
                pass

        # Success - mark complete and release client for reuse
        stream.mark_complete(session_id=final_session_id)
        await pool.release_client(project_id, final_session_id)
        logger.info(f"Agent completed for project {project_id}")

    except Exception as e:
        # Build a richer error string: SDK message + last stderr tail (only
        # populated when we created a fresh client this turn) + traceback.
        # routes/agent.py persists this as a system Message so the failure
        # survives a refresh and is debuggable from the UI.
        import traceback as _tb
        parts: list[str] = [f"{type(e).__name__}: {e}"]
        if stderr_buffer:
            tail = "\n".join(stderr_buffer[-30:])
            parts.append(f"\n\n[claude-code stderr (last lines)]\n{tail}")
        parts.append(f"\n\n[traceback]\n{_tb.format_exc()}")
        full_error = "".join(parts)
        logger.error(f"Agent error: {full_error}")
        stream.mark_error(full_error)
        yield {"type": "error", "error": full_error}
        # On error, remove the client from pool
        await pool.remove_client(project_id)


# Substring detector for the SDK's "stale resume" failure. The CLI's exact
# message is "No conversation found with session ID: <uuid>" (see Claude
# Code's session loader). routes/agent.py uses this to decide whether to
# clear the persisted session_id and retry once with a fresh session.
STALE_SESSION_ERROR_MARKER = "No conversation found with session ID"


def is_stale_session_error(error_message: str | None) -> bool:
    if not error_message:
        return False
    return STALE_SESSION_ERROR_MARKER in error_message


# Threshold for logging an oversized SDK message. The SDK hard-fails at
# max_buffer_size; we log well before that so we can see what kind of content
# is bloating messages (tool outputs are the usual suspect).
_OVERSIZED_WARN_BYTES = 500 * 1024  # 500 KB
_PREVIEW_CHARS = 200


def _log_if_oversized(msg: Any, msg_count: int) -> None:
    """If the SDK message is unusually large, log metadata + a short preview.
    Never logs the full payload — just enough to identify which tool is the
    offender (Bash stdout, Read of a huge file, subagent return, etc.)."""
    # Estimate size via a bounded serialization. We only need the ballpark.
    try:
        size = _estimate_msg_size(msg)
    except Exception:
        return
    if size < _OVERSIZED_WARN_BYTES:
        return

    kb = size / 1024
    meta = _extract_msg_meta(msg)
    logger.warning(
        f"[sdk] oversized message #{msg_count}: type={type(msg).__name__} "
        f"size~{kb:.0f}KB {meta}"
    )


def _estimate_msg_size(msg: Any) -> int:
    """Rough byte-count of a message's user-visible content, ignoring structure
    overhead. Walks known content-block shapes."""
    total = 0
    content = getattr(msg, "content", None)
    if isinstance(content, str):
        total += len(content)
    elif isinstance(content, list):
        for block in content:
            for attr in ("text", "thinking", "content", "input"):
                v = getattr(block, attr, None)
                if isinstance(v, str):
                    total += len(v)
                elif isinstance(v, (dict, list)):
                    # Tool inputs are often dicts; serialize approximately.
                    try:
                        total += len(json.dumps(v, default=str))
                    except Exception:
                        total += len(str(v))
    # ResultMessage.result etc.
    for attr in ("result", "text"):
        v = getattr(msg, attr, None)
        if isinstance(v, str):
            total += len(v)
    return total


def _extract_msg_meta(msg: Any) -> str:
    """Return a short metadata string describing the largest content block:
    tool name + input-key summary for ToolUse; tool_use_id + result preview
    for ToolResult; text/thinking preview for Assistant content. Preview is
    truncated to ~200 chars."""
    parts: list[str] = []
    content = getattr(msg, "content", None)
    if isinstance(content, list):
        for block in content:
            block_type = type(block).__name__
            # ToolUseBlock: surface tool name + the input keys (not values)
            if block_type == "ToolUseBlock":
                name = getattr(block, "name", "?")
                inp = getattr(block, "input", {})
                keys = list(inp.keys()) if isinstance(inp, dict) else []
                # Find the biggest string value in the input — that's what's
                # bloating the message (e.g. Write/Edit with huge content).
                big_field, big_len = None, 0
                if isinstance(inp, dict):
                    for k, v in inp.items():
                        if isinstance(v, str) and len(v) > big_len:
                            big_field, big_len = k, len(v)
                meta = f"ToolUse[name={name}, keys={keys}]"
                if big_field:
                    meta += f" big_field={big_field}({big_len}B)"
                parts.append(meta)
            elif block_type == "ToolResultBlock":
                tid = getattr(block, "tool_use_id", "?")
                c = getattr(block, "content", "")
                if isinstance(c, list):
                    # Rare shape — content can be a list of dicts
                    c = json.dumps(c, default=str)
                preview = (c[:_PREVIEW_CHARS] + "…") if isinstance(c, str) and len(c) > _PREVIEW_CHARS else str(c)[:_PREVIEW_CHARS]
                parts.append(f"ToolResult[tool_use_id={tid}] preview={preview!r}")
            elif block_type in ("TextBlock", "ThinkingBlock"):
                attr = "text" if block_type == "TextBlock" else "thinking"
                v = getattr(block, attr, "") or ""
                if len(v) > _PREVIEW_CHARS:
                    parts.append(f"{block_type}({len(v)}B) preview={v[:_PREVIEW_CHARS]!r}")
    # ResultMessage.result
    result = getattr(msg, "result", None)
    if isinstance(result, str) and len(result) > _PREVIEW_CHARS:
        parts.append(f"result({len(result)}B) preview={result[:_PREVIEW_CHARS]!r}")
    return " ".join(parts) if parts else "(no block metadata)"


def _convert_sdk_message(msg: Any) -> Generator[dict, None, None]:
    """
    Convert claude-code-sdk message to event dictionaries.

    Uses isinstance checks to properly identify SDK message types.
    Yields multiple events for messages with multiple content blocks.
    """
    try:
        from claude_agent_sdk.types import (
            AssistantMessage,
            ResultMessage,
            SystemMessage,
            UserMessage,
            StreamEvent,
            TextBlock,
            ThinkingBlock,
            ToolUseBlock,
            ToolResultBlock,
        )
    except ImportError:
        logger.warning("SDK types not available for message conversion")
        yield {"type": "unknown", "data": str(msg)}
        return

    if isinstance(msg, AssistantMessage):
        for block in msg.content:
            if isinstance(block, TextBlock):
                yield {"type": "text", "text": block.text}
            elif isinstance(block, ThinkingBlock):
                yield {"type": "thinking", "thinking": block.thinking}
            elif isinstance(block, ToolUseBlock):
                yield {
                    "type": "tool_use",
                    "tool_id": block.id,
                    "tool_name": block.name,
                    "tool_input": block.input,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            elif isinstance(block, ToolResultBlock):
                result = _process_tool_result(block)
                result["timestamp"] = datetime.now(timezone.utc).isoformat()
                yield result

    elif isinstance(msg, ResultMessage):
        yield {
            "type": "result",
            "session_id": msg.session_id,
            "duration_ms": msg.duration_ms,
            "total_cost_usd": msg.total_cost_usd,
            "is_error": msg.is_error,
            "num_turns": msg.num_turns,
        }

    elif isinstance(msg, SystemMessage):
        yield {
            "type": "system",
            "subtype": msg.subtype,
            "data": msg.data if hasattr(msg, "data") else None,
        }

    elif isinstance(msg, UserMessage):
        msg_content = msg.content
        if isinstance(msg_content, list):
            for block in msg_content:
                if isinstance(block, ToolResultBlock):
                    # The SDK delivers tool results back to the model as
                    # UserMessages — this is the dominant tool_result path,
                    # not the AssistantMessage branch above. Stamping
                    # `timestamp` here is what gives every tool a
                    # completed_at downstream: collect_reasoning reads it
                    # for the persisted reasoning_data, and the SSE replay
                    # surfaces it on reconnect (without it, the frontend's
                    # `event.timestamp || new Date().toISOString()` fallback
                    # collapses every replayed tool_result onto wall-clock
                    # "now", inflating tool durations to "minutes" on any
                    # reload of an in-flight project).
                    result = _process_tool_result(block)
                    result["timestamp"] = datetime.now(timezone.utc).isoformat()
                    yield result

    elif isinstance(msg, StreamEvent):
        event_data = msg.event
        event_type = event_data.get("type", "")

        if event_type == "content_block_start":
            # Emit a boundary event so the UI can insert a paragraph break
            # between consecutive text blocks within a single turn (the
            # model typically emits one TextBlock per "thought" between
            # tool calls — without a separator they render as a wall of
            # text glued together).
            block = event_data.get("content_block", {})
            if block.get("type") == "text":
                yield {"type": "text_block_start"}
        elif event_type == "content_block_delta":
            delta = event_data.get("delta", {})
            delta_type = delta.get("type", "")
            if delta_type == "text_delta":
                text = delta.get("text", "")
                if text:
                    yield {"type": "text_delta", "text": text}
            elif delta_type == "thinking_delta":
                thinking = delta.get("thinking", "")
                if thinking:
                    yield {
                        "type": "thinking_delta",
                        "thinking": thinking,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }

    else:
        msg_type = type(msg).__name__
        logger.debug(f"Unknown message type: {msg_type}")
        yield {"type": "unknown", "message_type": msg_type, "data": str(msg)[:200]}


def _process_tool_result(block) -> dict:
    """Extract and normalize content from a ToolResultBlock."""
    content = block.content
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict) and "text" in item:
                texts.append(item["text"])
            elif isinstance(item, str):
                texts.append(item)
            else:
                texts.append(str(item))
        content = "\n".join(texts) if texts else str(block.content)
    elif not isinstance(content, str):
        content = str(content)

    return {
        "type": "tool_result",
        "tool_use_id": block.tool_use_id,
        "content": content,
        "is_error": block.is_error,
    }


def collect_text_response(events: list[dict]) -> str:
    """Collect full text response from a list of events.

    The SDK emits one 'text' event per TextBlock — and a single agent turn
    may contain multiple TextBlocks (one between each tool call). Join them
    with blank lines so the persisted message preserves the visual breaks
    the user saw streaming. Falls back to text_delta accumulation, inserting
    the same separator on each text_block_start boundary.
    """
    text_blocks = [e.get("text", "") for e in events if e.get("type") == "text"]
    text_blocks = [t for t in text_blocks if t]
    if text_blocks:
        return "\n\n".join(text_blocks)

    # Fallback: rebuild from deltas, splitting on text_block_start.
    parts: list[str] = []
    current: list[str] = []
    for event in events:
        etype = event.get("type")
        if etype == "text_block_start":
            if current:
                parts.append("".join(current))
                current = []
        elif etype == "text_delta":
            current.append(event.get("text", ""))
    if current:
        parts.append("".join(current))
    return "\n\n".join(p for p in parts if p)


def collect_reasoning(events: list[dict]) -> list[dict]:
    """
    Collect reasoning entries (thinking/tools) from events in order.

    Returns list of entries preserving the exact order they occurred:
    - {"type": "thinking", "content": "..."}
    - {"type": "tool", "id": "...", "name": "...", "input": {...}, "started_at": "..."}
    - {"type": "tool_result", "tool_id": "...", "content": "...", "is_error": bool, "completed_at": "..."}
    """
    reasoning = []
    current_thinking: list[str] = []
    current_thinking_started_at: str | None = None
    current_thinking_last_at: str | None = None

    def _flush_thinking(close_ts: str | None = None) -> None:
        """Emit the buffered thinking block as a single entry, with timestamps
        when available. `close_ts` (e.g. the started_at of the next tool_use)
        wins over the last delta's timestamp because it's a tighter upper
        bound on when the thinking ended."""
        nonlocal current_thinking, current_thinking_started_at, current_thinking_last_at
        if not current_thinking:
            current_thinking_started_at = None
            current_thinking_last_at = None
            return
        text = "".join(current_thinking)
        if text:
            entry: dict = {"type": "thinking", "content": text}
            if current_thinking_started_at:
                entry["started_at"] = current_thinking_started_at
            completed = close_ts or current_thinking_last_at
            if completed:
                entry["completed_at"] = completed
            reasoning.append(entry)
        current_thinking = []
        current_thinking_started_at = None
        current_thinking_last_at = None

    for event in events:
        event_type = event.get("type")

        if event_type == "thinking_delta":
            current_thinking.append(event.get("thinking", ""))
            ts = event.get("timestamp")
            if ts:
                if current_thinking_started_at is None:
                    current_thinking_started_at = ts
                current_thinking_last_at = ts

        elif event_type == "thinking":
            # Final aggregated thinking block — flush whatever we buffered.
            # If no deltas arrived (rare), fall back to the event's own text.
            if not current_thinking and event.get("thinking"):
                current_thinking.append(event["thinking"])
            _flush_thinking()

        elif event_type == "tool_use":
            _flush_thinking(close_ts=event.get("timestamp"))
            entry = {
                "type": "tool",
                "id": event.get("tool_id"),
                "name": event.get("tool_name"),
                "input": event.get("tool_input"),
            }
            if event.get("timestamp"):
                entry["started_at"] = event["timestamp"]
            reasoning.append(entry)

        elif event_type == "tool_result":
            entry = {
                "type": "tool_result",
                "tool_id": event.get("tool_use_id"),
                "content": event.get("content", ""),
                "is_error": event.get("is_error", False),
            }
            if event.get("timestamp"):
                entry["completed_at"] = event["timestamp"]
            reasoning.append(entry)

    _flush_thinking()
    return reasoning
