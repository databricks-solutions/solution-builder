"""Claude Code agent execution service.

Simplified async implementation with client pooling for session reuse.
No thread wrapper - runs directly in FastAPI async context.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Generator

from ..core._config import logger
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

    async def _disconnect_client(self, pooled: PooledClient):
        """Safely disconnect a client."""
        try:
            if pooled.client:
                await pooled.client.disconnect()
        except Exception as e:
            logger.warning(f"Error disconnecting client: {e}")


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
    cluster_id: str | None = None,
    warehouse_id: str | None = None,
    default_catalog: str | None = None,
    default_schema: str | None = None,
    databricks_profile: str | None = None,
    session_id: str | None = None,
) -> AsyncIterator[dict]:
    """
    Stream Claude Code agent responses with client pooling.

    Tries to reuse an existing client for the project if available.
    Falls back to creating a new client (with optional session resumption).

    Args:
        project_id: Project ID for working directory
        message: User message to process
        stream: ActiveStream for event buffering
        cluster_id: Optional Databricks cluster ID
        warehouse_id: Optional SQL warehouse ID
        default_catalog: Optional default catalog
        default_schema: Optional default schema
        databricks_profile: Optional Databricks CLI profile name
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
            )

            # Build allowed tools list
            # ai-dev-kit uses CLI tools via skills, not MCP
            allowed_tools = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill"]

            # Configure agent options
            # setting_sources=[] prevents inheriting MCP servers from user/project
            # settings files. Skills are still discovered from .claude/skills/ in the
            # project CWD. Building uses Databricks CLI via skills, not MCP.
            options = ClaudeAgentOptions(
                cwd=str(project_dir),
                allowed_tools=allowed_tools,
                permission_mode="bypassPermissions",
                system_prompt=system_prompt,
                include_partial_messages=True,
                setting_sources=[],
                mcp_servers={},
            )

            # Resume previous session if provided
            if session_id:
                options.resume = session_id
                options.continue_conversation = True
                logger.info(f"Resuming Claude Code session: {session_id}")

            # Create and connect new client
            client = ClaudeSDKClient(options=options)
            await client.connect()
            logger.info(f"Created new client for project {project_id}")

            # Register in pool
            pooled = await pool.register_client(project_id, client, session_id)

        # Send the message
        await client.query(message)
        logger.info(f"Sent query to agent for project {project_id}")

        # Stream responses with keepalive
        last_event_time = time.time()
        msg_count = 0

        async for msg in client.receive_response():
            msg_count += 1
            msg_type = type(msg).__name__
            logger.debug(f"SDK message #{msg_count}: {msg_type}")

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
                last_event_time = time.time()

            # Extract session_id from ResultMessage
            if msg_type == "ResultMessage" and hasattr(msg, "session_id") and msg.session_id:
                final_session_id = msg.session_id
                logger.info(f"Captured session_id: {final_session_id}")

            # Send keepalive if needed
            elapsed = time.time() - last_event_time
            if elapsed >= KEEPALIVE_INTERVAL:
                keepalive_event = {"type": "keepalive", "elapsed_since_last_event": elapsed}
                stream.add_event(keepalive_event)
                yield keepalive_event
                last_event_time = time.time()

        # Success - mark complete and release client for reuse
        stream.mark_complete(session_id=final_session_id)
        await pool.release_client(project_id, final_session_id)
        logger.info(f"Agent completed for project {project_id}")

    except Exception as e:
        logger.exception(f"Agent error: {e}")
        stream.mark_error(str(e))
        yield {"type": "error", "error": str(e)}
        # On error, remove the client from pool
        await pool.remove_client(project_id)


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
                }
            elif isinstance(block, ToolResultBlock):
                yield _process_tool_result(block)

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
                    yield _process_tool_result(block)

    elif isinstance(msg, StreamEvent):
        event_data = msg.event
        event_type = event_data.get("type", "")

        if event_type == "content_block_delta":
            delta = event_data.get("delta", {})
            delta_type = delta.get("type", "")
            if delta_type == "text_delta":
                text = delta.get("text", "")
                if text:
                    yield {"type": "text_delta", "text": text}
            elif delta_type == "thinking_delta":
                thinking = delta.get("thinking", "")
                if thinking:
                    yield {"type": "thinking_delta", "thinking": thinking}

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

    Prefers the final 'text' event (complete message) over deltas.
    Falls back to accumulating 'text_delta' events if no final text.
    """
    # First, look for a final 'text' event (complete message)
    for event in reversed(events):
        if event.get("type") == "text":
            return event.get("text", "")

    # Fallback: accumulate text_delta events
    text_parts = []
    for event in events:
        if event.get("type") == "text_delta":
            text_parts.append(event.get("text", ""))
    return "".join(text_parts)


def collect_reasoning(events: list[dict]) -> list[dict]:
    """
    Collect reasoning entries (thinking/tools) from events in order.

    Returns list of entries preserving the exact order they occurred:
    - {"type": "thinking", "content": "..."}
    - {"type": "tool", "id": "...", "name": "...", "input": {...}}
    - {"type": "tool_result", "tool_id": "...", "content": "...", "is_error": bool}
    """
    reasoning = []
    current_thinking = []

    for event in events:
        event_type = event.get("type")

        if event_type == "thinking_delta":
            current_thinking.append(event.get("thinking", ""))

        elif event_type == "thinking":
            thinking_text = "".join(current_thinking) if current_thinking else event.get("thinking", "")
            if thinking_text:
                reasoning.append({"type": "thinking", "content": thinking_text})
            current_thinking = []

        elif event_type == "tool_use":
            if current_thinking:
                thinking_text = "".join(current_thinking)
                if thinking_text:
                    reasoning.append({"type": "thinking", "content": thinking_text})
                current_thinking = []

            reasoning.append({
                "type": "tool",
                "id": event.get("tool_id"),
                "name": event.get("tool_name"),
                "input": event.get("tool_input"),
            })

        elif event_type == "tool_result":
            reasoning.append({
                "type": "tool_result",
                "tool_id": event.get("tool_use_id"),
                "content": event.get("content", ""),
                "is_error": event.get("is_error", False),
            })

    if current_thinking:
        thinking_text = "".join(current_thinking)
        if thinking_text:
            reasoning.append({"type": "thinking", "content": thinking_text})

    return reasoning
