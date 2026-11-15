"""Process pool for CPU-heavy one-off work (PDF/XLSX parsing, zip building).

Why: the app is ONE uvicorn process. Its event loop and every thread share one
GIL, so a CPU-bound task in `asyncio.to_thread` still slows every request for
as long as it runs. Work sent through `run_cpu` executes in a separate
interpreter, so the serving process keeps its GIL.

Rules for a function passed to `run_cpu`:
- top-level, importable by module path (spawn re-imports the module per worker);
- its module must stay light: no FastAPI / SQLModel / DB imports, or every
  worker boots the whole app;
- arguments and return values cross a pipe, so pickle-friendly values only
  (bytes, str, Path, plain containers).

Spawn, never fork: the parent is multi-threaded, and forking a multi-threaded
process can inherit locks held by other threads.

Env:
- CPU_POOL_WORKERS (default 2): worker processes.
- CPU_POOL_DISABLED=1: kill switch; `run_cpu` runs the function in a thread
  (`asyncio.to_thread`), the behaviour before this module existed.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import multiprocessing
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_WORKERS = 2

_lock = threading.Lock()
_pool: ProcessPoolExecutor | None = None


def _disabled() -> bool:
    return os.environ.get("CPU_POOL_DISABLED", "").strip().lower() in ("1", "true", "yes")


def _worker_count() -> int:
    raw = os.environ.get("CPU_POOL_WORKERS", "").strip()
    if not raw:
        return DEFAULT_WORKERS
    try:
        return max(1, int(raw))
    except ValueError:
        logger.warning("CPU_POOL_WORKERS=%r is not an integer; using %d", raw, DEFAULT_WORKERS)
        return DEFAULT_WORKERS


def _get_pool() -> ProcessPoolExecutor:
    """Create the pool on first use. Creating the executor spawns no processes;
    workers start on the first submit."""
    global _pool
    with _lock:
        if _pool is None:
            _pool = ProcessPoolExecutor(
                max_workers=_worker_count(),
                mp_context=multiprocessing.get_context("spawn"),
            )
        return _pool


def _retire(broken: ProcessPoolExecutor) -> None:
    """Drop a broken pool so the next `_get_pool()` builds a fresh one. Several
    calls can see the same break at once; only the first one to get here
    detaches it (identity check)."""
    global _pool
    with _lock:
        if _pool is broken:
            _pool = None
    try:
        broken.shutdown(wait=False, cancel_futures=True)
    except Exception as e:  # noqa: BLE001 — teardown must never raise
        logger.warning("[cpu_pool] shutting down broken pool failed: %r", e)


def shutdown_cpu_pool(wait: bool = False, cancel_futures: bool = True) -> None:
    """App teardown. Idempotent; a pool that was never created is a no-op."""
    global _pool
    with _lock:
        pool, _pool = _pool, None
    if pool is None:
        return
    try:
        pool.shutdown(wait=wait, cancel_futures=cancel_futures)
    except Exception as e:  # noqa: BLE001 — teardown must never raise
        logger.warning("[shutdown] cpu pool shutdown failed: %r", e)


async def run_cpu(fn: Callable[..., T], *args: Any, timeout: float | None = None, **kwargs: Any) -> T:
    """Run `fn(*args, **kwargs)` in a worker process and await the result.

    `timeout` bounds how long THIS caller waits. A task already running in a
    worker cannot be interrupted, so on timeout the worker finishes its work
    and the result is discarded.

    If a worker dies (BrokenProcessPool, e.g. OOM-killed), the pool is recreated
    and the call retried once. If the pool breaks again, this call runs in a
    thread instead, and the next call gets a fresh pool.
    """
    if _disabled():
        return await asyncio.to_thread(fn, *args, **kwargs)

    name = getattr(fn, "__qualname__", repr(fn))
    loop = asyncio.get_running_loop()
    call = functools.partial(fn, *args, **kwargs)
    for attempt in (1, 2):
        pool = _get_pool()
        try:
            return await asyncio.wait_for(loop.run_in_executor(pool, call), timeout)
        except BrokenProcessPool:
            logger.error(
                "[cpu_pool] a worker died running %s (attempt %d); recreating the pool",
                name,
                attempt,
            )
            _retire(pool)

    logger.error("[cpu_pool] pool broke twice running %s; running it in a thread", name)
    return await asyncio.to_thread(fn, *args, **kwargs)
