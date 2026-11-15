"""Eager SIGTERM cancellation for long-lived NON-agent request tasks.

Companion to ``services.active_stream.ActiveStreamManager``. That manager tracks
the AGENT SSE streams, and its ``cancel_all()`` is already invoked from the
SIGTERM handler in ``core/lakebase.py`` so agent streams exit within ~100 ms of a
redeploy signal instead of holding uvicorn's graceful-shutdown *drain* open.

The bug this fixes: the agent streams were the ONLY long-lived tasks being
cancelled. The other long-lived request tasks were not —

  * the preview reverse-proxy streams   (``preview/proxy.py`` ``body_iter``
                                          parked on ``httpx … aiter_raw()``),
  * the preview-events SSE              (``preview/routes.py`` ``events``),
  * the collab WebSocket                (``routes/collab.py`` ``collab_ws``), and
  * the Vite-HMR WebSocket proxy        (``preview/routes.py`` ``proxy_ws``)

— so on every redeploy they kept uvicorn's drain busy for the full
``--timeout-graceful-shutdown`` window, and the (bounded) lifespan teardown then
overran the Apps platform's ~15 s SIGKILL → the process was force-killed → the
in-flight tasks 503. Prod log signature (2026-08-26): ``[shutdown-signal]
cancelled 2 active stream(s)`` (the agent ones) → ``Cancel 9 running task(s),
timeout graceful shutdown exceeded`` (these un-cancelled ones) → ``App did not
respect SIGTERM timeout of 15 seconds``, with the 503s concentrated on
``/preview/{id}/{path}``.

These tasks block on I/O with no data arriving (an idle proxied SSE, a quiet
``ws.receive()``), so the between-iterations flag-poll that the agent SSE
generator uses can't wake them — only cancelling the task interrupts the parked
``await``. So each such handler registers its ``asyncio.Task`` here (via
``track_live_connection()`` or ``register``/``unregister``), and the SIGTERM
handler calls ``cancel_all_on_shutdown()`` which cancels the agent streams AND
these connections. Cancellation raises ``CancelledError`` at the parked await, so
each handler's existing ``finally`` (close the httpx upstream/client, unsubscribe
the log/state queues, ``hub.leave`` + ``ws.close``) still runs cleanly.

Single-replica only, exactly like ``ActiveStreamManager`` / ``CollabHub`` — the
registry is a process singleton.

Signal-handler safety: ``cancel_all_on_shutdown()`` is called from the SIGTERM
handler, which CPython runs on the main thread between bytecodes (the same thread
the event loop runs on). It only snapshots a set and calls ``task.cancel()`` — no
awaits, no blocking calls — matching the constraints already documented for
``ActiveStreamManager.cancel_all`` in ``core/lakebase.py``.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator, ClassVar

from ..core._config import logger
from .headless_browser import kill_live_groups


# Process-wide "we are shutting down" latch. A plain module bool (NOT a
# threading.Event) so it's GIL-atomic to read/write and safe to set from the
# SIGTERM signal handler — no lock a signal could deadlock on. Set once at
# shutdown, never cleared in-process. Polled by the SYNC-generator SSE endpoints
# (capabilities-suggest in routes/constants.py, grounding-scan in routes/grounding.py)
# that Starlette runs via `iterate_in_threadpool`: `task.cancel()` can't interrupt
# a blocking threadpool iteration, so those generators check this between yielded
# chunks and return. (Async streams don't need it — they're cancelled directly via
# the registry / ActiveStreamManager.)
_SHUTTING_DOWN = False


def request_shutdown() -> None:
    """Latch the shutdown flag. Called by `cancel_all_on_shutdown()` (i.e. from the
    SIGTERM handler) so sync-generator SSEs polling `shutdown_requested()` exit."""
    global _SHUTTING_DOWN
    _SHUTTING_DOWN = True


def shutdown_requested() -> bool:
    """True once SIGTERM shutdown has begun. Sync SSE generators poll this between
    yielded chunks and return, so they don't hold uvicorn's drain open."""
    return _SHUTTING_DOWN


class LiveConnectionRegistry:
    """Process-wide set of in-flight long-lived NON-agent request tasks that must
    be cancelled promptly on SIGTERM. Singleton, mirroring ActiveStreamManager."""

    _instance: ClassVar["LiveConnectionRegistry | None"] = None

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task] = set()

    @classmethod
    def get_instance(cls) -> "LiveConnectionRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(self, task: asyncio.Task | None) -> None:
        """Track a long-lived task. No-op if ``task`` is None (no running task)."""
        if task is not None:
            self._tasks.add(task)

    def unregister(self, task: asyncio.Task | None) -> None:
        """Stop tracking a task. Safe to call even if never registered (``discard``)."""
        if task is not None:
            self._tasks.discard(task)

    def active_count(self) -> int:
        return len(self._tasks)

    def cancel_all(self) -> int:
        """Cancel every still-running registered task; return the count cancelled.

        Non-blocking: ``task.cancel()`` only schedules a ``CancelledError`` at the
        task's next await — the task's own ``finally`` does the actual resource
        cleanup as it unwinds. Iterates a ``list(...)`` snapshot so a task that
        self-unregisters (via ``track_live_connection``'s finally) mid-iteration
        can't mutate the set under us. Done tasks are skipped (they're already
        gone; they linger in the set only until their handler's finally discards
        them, or harmlessly until process exit)."""
        cancelled = 0
        for task in list(self._tasks):
            if not task.done():
                task.cancel()
                cancelled += 1
        return cancelled


def get_live_connections() -> LiveConnectionRegistry:
    """Singleton accessor (mirrors ``get_stream_manager`` / ``get_collab_hub``)."""
    return LiveConnectionRegistry.get_instance()


@asynccontextmanager
async def track_live_connection() -> AsyncIterator[None]:
    """Register the CURRENT asyncio task as a long-lived connection for the
    duration of the block, so the SIGTERM handler can cancel it and unblock
    uvicorn's drain. Self-unregisters on ANY exit (normal, error, cancellation),
    so a finished stream never lingers in the registry.

    Wrap the streaming body / relay loop — NOT the whole endpoint — so the tracked
    task is the one actually parked on the long-lived await. The recommended way
    to add a new long-lived handler; handlers that already own a ``try/finally``
    may instead ``register``/``unregister`` at its boundaries."""
    reg = get_live_connections()
    task = asyncio.current_task()
    reg.register(task)
    try:
        yield
    finally:
        reg.unregister(task)


def cancel_all_on_shutdown() -> tuple[int, int]:
    """Eagerly cancel EVERY long-lived task holding the event loop open, so
    uvicorn's graceful-shutdown drain returns immediately instead of waiting the
    full ``--timeout-graceful-shutdown`` window on a parked SSE/WebSocket.

    Cancels both:
      * agent SSE streams  (``ActiveStreamManager`` — pre-existing behavior), and
      * the preview proxy / preview-events SSE / collab + HMR WebSockets
        (``LiveConnectionRegistry`` — the connections that were being missed).

    Returns ``(n_agent_streams, n_connections)``. Safe from a signal handler
    (only a flag write + set snapshots + ``task.cancel()``); idempotent, so the
    lifespan teardown can also call it as a fallback for paths where the signal
    handler wasn't installed/invoked."""
    from .active_stream import get_stream_manager

    # Latch the flag FIRST so the sync-generator SSEs (which can't be
    # task-cancelled — see request_shutdown) exit on their next chunk.
    request_shutdown()
    n_streams = get_stream_manager().cancel_all()
    n_conns = get_live_connections().cancel_all()
    # Headless-browser children (architecture renders, brand screenshots) are separate
    # processes with no task to cancel. SIGKILL their groups so none outlives the app.
    kill_live_groups()
    return n_streams, n_conns
