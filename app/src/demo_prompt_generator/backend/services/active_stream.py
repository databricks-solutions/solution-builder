"""Active stream management for Claude Code agent execution.

Provides in-memory event buffering with cursor-based retrieval.
Follows ai-dev-kit patterns for reliable streaming.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, ClassVar

from ..core._config import logger


@dataclass
class StreamEvent:
    """A single event in the stream with timestamp cursor."""
    timestamp: float  # Unix timestamp, used as cursor
    data: dict[str, Any]


@dataclass
class ActiveStream:
    """
    In-memory buffer for a single agent execution's events.

    Supports cursor-based retrieval for SSE reconnection.
    Thread-safe event accumulation via append-only list.
    """
    execution_id: str
    project_id: str
    events: list[StreamEvent] = field(default_factory=list)
    is_complete: bool = False
    is_cancelled: bool = False
    is_error: bool = False
    error_message: str | None = None
    task: asyncio.Task | None = None
    session_id: str | None = None  # Stored after completion for resumption

    def add_event(self, event_data: dict[str, Any]) -> None:
        """Append an event with automatic timestamp cursor.

        Args:
            event_data: Dict with 'type' key and event-specific data.
        """
        self.events.append(StreamEvent(
            timestamp=time.time(),
            data=event_data,
        ))

    def get_events_since(self, cursor: float = 0.0) -> tuple[list[dict], float]:
        """
        Return events after the given cursor and the new cursor position.

        Args:
            cursor: Timestamp cursor from previous call (0.0 for start)

        Returns:
            Tuple of (list of event dicts with _cursor, new cursor position)
        """
        new_events = [
            {**e.data, "_cursor": e.timestamp}
            for e in self.events
            if e.timestamp > cursor
        ]
        new_cursor = self.events[-1].timestamp if self.events else cursor
        return new_events, new_cursor

    def mark_complete(self, session_id: str | None = None) -> None:
        """Mark stream as complete, optionally storing session_id."""
        self.is_complete = True
        self.session_id = session_id

    def mark_error(self, error_message: str) -> None:
        """Mark stream as errored."""
        self.is_error = True
        self.error_message = error_message
        self.add_event({"type": "error", "error": error_message})

    def mark_cancelled(self) -> None:
        """Mark stream as cancelled."""
        self.is_cancelled = True
        self.add_event({"type": "cancelled"})


class ActiveStreamManager:
    """
    Singleton manager for all active streams.

    Provides stream lifecycle management and cleanup.
    Uses per-project locks to prevent concurrent agent invocations.
    """
    _instance: ClassVar["ActiveStreamManager | None"] = None
    _streams: dict[str, ActiveStream]
    _cleanup_interval: float = 300  # 5 minutes
    _stream_ttl: float = 600  # 10 minutes after completion

    def __init__(self):
        self._streams = {}
        self._project_locks: dict[str, asyncio.Lock] = {}
        self._last_cleanup = time.time()

    def get_project_lock(self, project_id: str) -> asyncio.Lock:
        """Get or create a per-project lock for serializing agent invocations."""
        if project_id not in self._project_locks:
            self._project_locks[project_id] = asyncio.Lock()
        return self._project_locks[project_id]

    @classmethod
    def get_instance(cls) -> "ActiveStreamManager":
        """Get or create the singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def create_stream(self, execution_id: str, project_id: str) -> ActiveStream:
        """Create and register a new stream."""
        stream = ActiveStream(execution_id=execution_id, project_id=project_id)
        self._streams[execution_id] = stream
        self._maybe_cleanup()
        logger.debug(f"Created stream for execution {execution_id}")
        return stream

    def get_stream(self, execution_id: str) -> ActiveStream | None:
        """Get a stream by execution ID."""
        return self._streams.get(execution_id)

    def get_project_stream(self, project_id: str) -> ActiveStream | None:
        """Get the active (running) stream for a project, if any."""
        for stream in self._streams.values():
            if (
                stream.project_id == project_id
                and not stream.is_complete
                and not stream.is_cancelled
                and not stream.is_error
            ):
                return stream
        return None

    async def start_stream(
        self,
        stream: ActiveStream,
        agent_coroutine: Callable[[], Any]
    ) -> None:
        """Start agent execution as a background task."""
        async def run_agent():
            try:
                await agent_coroutine()
            except asyncio.CancelledError:
                stream.mark_cancelled()
                logger.info(f"Stream {stream.execution_id} cancelled")
            except Exception as e:
                stream.mark_error(str(e))
                logger.error(f"Stream {stream.execution_id} error: {e}")

        stream.task = asyncio.create_task(run_agent())
        logger.debug(f"Started stream task for {stream.execution_id}")

    def remove_stream(self, execution_id: str) -> None:
        """Remove a stream from the manager."""
        if execution_id in self._streams:
            del self._streams[execution_id]
            logger.debug(f"Removed stream {execution_id}")

    def _maybe_cleanup(self) -> None:
        """Clean up old completed streams periodically."""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return

        self._last_cleanup = now
        to_remove = []

        for execution_id, stream in self._streams.items():
            # Remove completed/errored/cancelled streams older than TTL
            if stream.is_complete or stream.is_error or stream.is_cancelled:
                if stream.events:
                    last_event_time = stream.events[-1].timestamp
                    if now - last_event_time > self._stream_ttl:
                        to_remove.append(execution_id)

        for execution_id in to_remove:
            self.remove_stream(execution_id)

        if to_remove:
            logger.info(f"Cleaned up {len(to_remove)} old streams")

    def cancel_all(self) -> int:
        """Mark every active stream as cancelled. Used at app shutdown
        so the SSE generator loops in routes/agent.py exit on their next
        poll iteration instead of blocking the lifespan teardown for the
        full SSE_WINDOW_SECONDS (~50 s). The associated agent task is
        also cancelled if still running.

        Returns the number of streams cancelled.
        """
        cancelled = 0
        for execution_id, stream in list(self._streams.items()):
            if stream.is_complete or stream.is_error or stream.is_cancelled:
                continue
            stream.mark_cancelled()
            task = getattr(stream, "task", None)
            if task is not None and not task.done():
                task.cancel()
            cancelled += 1
        return cancelled


# Convenience function to get the manager
def get_stream_manager() -> ActiveStreamManager:
    """Get the singleton stream manager instance."""
    return ActiveStreamManager.get_instance()
