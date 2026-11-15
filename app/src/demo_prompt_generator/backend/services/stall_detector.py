"""Event-loop stall detector, slow-request accounting and auto thread-dump capture.

The app is ONE event loop (one uvicorn worker). When something blocks it, every
request stalls, and the culprit is only visible if someone takes a dump while it is
still blocked. This module does that automatically and stays nearly free when healthy:

- `StallDetector.heartbeat()` — a tiny asyncio task stamps `_beat` every TICK_S.
- A watchdog daemon thread compares the stamp against the threshold every TICK_S.
  Only when the loop is actually stalled does it do work: read the loop thread's
  stack (+ up to SAMPLE_CAP more ticks, for a "hot" stack), and snapshot every
  thread's CPU clock. On recovery it records one entry in a bounded ring and logs
  one WARNING (rate-limited). Per-thread CPU over the stall separates "the loop was
  busy running its own code" from "the loop was starved by another thread".
- Auto-capture: one compact thread dump to the logs when a stall passes
  AUTO_CAPTURE_STALL_S, or the anyio threadpool has work queued for
  AUTO_CAPTURE_WAIT_S. Rate-limited to one per AUTO_CAPTURE_MIN_INTERVAL_S.
- `RequestStats` — in-flight HTTP count and slow-request counters, fed by the
  pure-ASGI middleware in core/_factory.py.

Admin reads: GET /api/health/stalls and GET /api/health/threads (routes/internal.py).
Started/stopped from the Lakebase lifespan next to the reapers.
"""

from __future__ import annotations

import asyncio
import os
import sys
import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any

from ..core._config import logger
from .metrics import get_metrics

TICK_S = 0.1
DEFAULT_STALL_MS = 500
STALL_RING_SIZE = 50
SAMPLE_CAP = 50                  # main-thread samples kept per stall (~5 s at TICK_S)
MAX_STACK_FRAMES = 40            # innermost frames kept per stack
LOG_MIN_INTERVAL_S = 10.0        # at most one stall WARNING per window
AUTO_CAPTURE_STALL_S = 2.0       # a stall this long triggers one compact thread dump
AUTO_CAPTURE_WAIT_S = 30.0       # threadpool work queued this long triggers one too
AUTO_CAPTURE_MIN_INTERVAL_S = 300.0
DEFAULT_SLOW_REQUEST_MS = 2000
SLOW_ROUTE_CAP = 200             # bound on distinct route labels in the slow counter
SLOW_LOG_MIN_INTERVAL_S = 1.0


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return float(default)


# --- shared helpers (also used by routes/internal.py and services/profiler.py) ---


def frame_labels(frames: list[Any]) -> list[str]:
    """`file:line function` per frame, given OUTERMOST FIRST. Paths are shortened to
    the part after the package/site-packages root so the lines stay readable."""
    out = []
    for f in frames:
        path = f.f_code.co_filename
        for cut in ("site-packages/", "demo_prompt_generator/", "/lib/python3"):
            if cut in path:
                path = path.split(cut)[-1].split("/", 1)[-1] if cut == "/lib/python3" else path.split(cut)[-1]
        out.append(f"{path}:{f.f_lineno} {f.f_code.co_name}")
    return out


def stack_labels(frame: Any, limit: int = MAX_STACK_FRAMES) -> list[str]:
    """Outermost-first labels of the INNERMOST `limit` frames ending at `frame`.
    The leaf side is what explains a stall, so a deep stack keeps its leaf."""
    leaf_first: list[Any] = []
    while frame is not None and len(leaf_first) < limit:
        leaf_first.append(frame)
        frame = frame.f_back
    return frame_labels(leaf_first[::-1])


def thread_cpu_seconds() -> dict[int, float]:
    """ident -> CPU seconds for every live thread. Empty where the platform has no
    per-thread CPU clock (macOS dev); callers must treat the data as optional."""
    out: dict[int, float] = {}
    for t in threading.enumerate():
        if t.ident is None:
            continue
        try:
            out[t.ident] = time.clock_gettime(time.pthread_getcpuclockid(t.ident))  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — thread just ended, or no per-thread clock
            continue
    return out


def compact_thread_dump(top: int = 3) -> str:
    """One thread per block: name, CPU, and the INNERMOST `top` frames. Busiest first."""
    frames = sys._current_frames()
    cpu = thread_cpu_seconds()
    lines: list[str] = []
    for t in sorted(threading.enumerate(), key=lambda t: -(cpu.get(t.ident or -1) or 0.0)):
        c = cpu.get(t.ident or -1)
        lines.append(f"{t.name} (cpu {c:.1f}s)" if c is not None else f"{t.name} (cpu n/a)")
        f = frames.get(t.ident) if t.ident else None
        if f is not None:
            lines.extend(f"    {label}" for label in stack_labels(f, limit=top)[::-1])
    return "\n".join(lines)


def _cause(duration_s: float, loop_cpu: float | None, cpu_top: list[dict[str, Any]]) -> str:
    if loop_cpu is None or duration_s <= 0:
        return "unknown (no per-thread CPU data: watchdog missed it, or no CPU clock here)"
    if loop_cpu >= 0.5 * duration_s:
        return "loop busy: CPU-bound code running on the event loop"
    if cpu_top and cpu_top[0]["cpu_s"] >= 0.5 * duration_s:
        return f"loop starved by thread {cpu_top[0]['thread']} (GIL/CPU contention)"
    return "loop waiting: blocking I/O, lock or sleep on the loop"


# --- stall detector -----------------------------------------------------------


@dataclass
class _OpenStall:
    last_beat: float                 # monotonic stamp of the last heartbeat before the block
    started_wall: float              # wall-clock estimate of last_beat (for the record)
    stack: list[str]                 # loop-thread stack at detection, outermost first
    cpu0: dict[int, float]           # per-thread CPU at detection
    samples: Counter = field(default_factory=Counter)  # tuple(stack) -> ticks seen
    n_samples: int = 0
    captured: bool = False


class StallDetector:
    def __init__(self, stall_ms: float | None = None, tick_s: float = TICK_S) -> None:
        if stall_ms is None:
            stall_ms = _env_float("LOOP_STALL_MS", DEFAULT_STALL_MS)
        self.threshold_s = stall_ms / 1000.0
        self.tick_s = tick_s
        self._beat = time.monotonic()
        self._loop_ident: int | None = None
        self._open: _OpenStall | None = None
        self._stalls: deque[dict[str, Any]] = deque(maxlen=STALL_RING_SIZE)
        self._lock = threading.Lock()
        self._total = 0
        self._suppressed = 0
        self._last_log = float("-inf")
        self._last_capture = float("-inf")
        self._wait_since: float | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._task: asyncio.Task[None] | None = None

    # -- lifecycle (runs on the event loop) --------------------------------
    async def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._loop_ident = threading.get_ident()  # start() runs on the loop thread
        self._beat = time.monotonic()
        self._task = asyncio.create_task(self.heartbeat())
        self._thread = threading.Thread(target=self._run, name="stall-watchdog", daemon=True)
        self._thread.start()
        logger.info(f"[stall] watchdog started (threshold {self.threshold_s * 1000:.0f} ms)")

    async def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            # Off-loop join: the watchdog wakes within one tick once _stop is set.
            await asyncio.to_thread(self._thread.join, 1.0)
        self._thread = None
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def heartbeat(self) -> None:
        while True:
            self._stamp(time.monotonic())
            await asyncio.sleep(self.tick_s)

    def _stamp(self, now: float) -> None:
        # A block the watchdog never saw (one C call held the GIL, so the watchdog thread
        # could not run) is still visible here: the loop resumes with a stale stamp. Record
        # its duration; there is no stack to show for it.
        if now - self._beat > self.threshold_s and self._open is None:
            self._open = _OpenStall(
                last_beat=self._beat, started_wall=time.time() - (now - self._beat),
                stack=[], cpu0={},
            )
            self._beat = now
            self._close()
        self._beat = now

    # -- watchdog thread ---------------------------------------------------
    def _run(self) -> None:
        while not self._stop.wait(self.tick_s):
            try:
                self._check(time.monotonic())
            except Exception as e:  # noqa: BLE001 — the watchdog must never die
                logger.debug(f"[stall] watchdog tick failed: {e!r}")

    def _check(self, now: float) -> None:
        beat = self._beat
        if now - beat <= self.threshold_s:
            if self._open is not None:
                self._close()
            self._check_threadpool(now)
            return
        if self._open is None:
            self._open = _OpenStall(
                last_beat=beat,
                started_wall=time.time() - (now - beat),
                stack=self._loop_stack(),
                cpu0=thread_cpu_seconds(),
            )
            self._open.samples[tuple(self._open.stack)] += 1
            self._open.n_samples = 1
        o = self._open
        if o.n_samples < SAMPLE_CAP:
            o.samples[tuple(self._loop_stack())] += 1
            o.n_samples += 1
        if not o.captured and now - beat >= AUTO_CAPTURE_STALL_S:
            o.captured = True
            if self._capture_allowed(now):
                self._capture(f"event loop stalled for {now - beat:.1f}s")

    def _loop_stack(self) -> list[str]:
        if self._loop_ident is None:
            return []
        frame = sys._current_frames().get(self._loop_ident)
        return stack_labels(frame) if frame is not None else []

    def _close(self) -> None:
        o = self._open
        self._open = None
        if o is None:
            return
        duration = max(0.0, self._beat - o.last_beat)  # _beat is the resume stamp
        cpu1 = thread_cpu_seconds()
        names = {t.ident: t.name for t in threading.enumerate()}
        deltas = {i: cpu1[i] - o.cpu0[i] for i in cpu1 if i in o.cpu0}
        loop_cpu = deltas.get(self._loop_ident) if self._loop_ident is not None else None
        others = sorted(
            ((d, i) for i, d in deltas.items() if i != self._loop_ident and d > 0), reverse=True
        )[:3]
        cpu_top = [
            {"thread": names.get(i) or str(i), "cpu_s": round(d, 3)} for d, i in others
        ]
        hot, hot_n = o.samples.most_common(1)[0] if o.samples else ((), 0)
        rec: dict[str, Any] = {
            "started_at": round(o.started_wall, 3),
            "duration_ms": round(duration * 1000, 1),
            "cause": _cause(duration, loop_cpu, cpu_top),
            "loop_cpu_s": round(loop_cpu, 3) if loop_cpu is not None else None,
            "cpu_top": cpu_top,
            "stack": o.stack,
            "hot_stack": list(hot),
            "hot_samples": hot_n,
            "samples": o.n_samples,
        }
        with self._lock:
            self._stalls.append(rec)
            self._total += 1
        self._log_stall(rec)

    def _log_stall(self, rec: dict[str, Any]) -> None:
        now = time.monotonic()
        if now - self._last_log < LOG_MIN_INTERVAL_S:
            self._suppressed += 1
            return
        extra = f" (+{self._suppressed} suppressed)" if self._suppressed else ""
        self._suppressed = 0
        self._last_log = now
        top = rec["stack"][-1] if rec["stack"] else "?"
        hot = rec["hot_stack"][-1] if rec["hot_stack"] else "?"
        logger.warning(
            f"[stall] event loop blocked {rec['duration_ms']:.0f} ms: {rec['cause']}; "
            f"at {top}; hot {hot} ({rec['hot_samples']}/{rec['samples']} samples); "
            f"cpu {rec['cpu_top']}{extra}"
        )

    def _check_threadpool(self, now: float) -> None:
        stats = get_metrics()._threadpool_stats  # refreshed on-loop by loop_lag_monitor
        waiting = stats[2] if stats else 0
        if waiting <= 0:
            self._wait_since = None
            return
        if self._wait_since is None:
            self._wait_since = now
            return
        if now - self._wait_since >= AUTO_CAPTURE_WAIT_S:
            self._wait_since = None
            if self._capture_allowed(now):
                self._capture(f"{waiting} threadpool task(s) queued for {AUTO_CAPTURE_WAIT_S:.0f}s+")

    def _capture_allowed(self, now: float) -> bool:
        if now - self._last_capture < AUTO_CAPTURE_MIN_INTERVAL_S:
            return False
        self._last_capture = now
        return True

    def _capture(self, reason: str) -> None:
        try:
            logger.warning(f"[stall-capture] {reason}\n{compact_thread_dump()}")
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[stall-capture] failed: {e!r}")

    # -- readers (any thread) ----------------------------------------------
    def current_stall_ms(self) -> float:
        o = self._open
        return round((time.monotonic() - o.last_beat) * 1000, 1) if o is not None else 0.0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            stalls = list(self._stalls)
            total = self._total
        return {
            "threshold_ms": round(self.threshold_s * 1000, 1),
            "stalled_now": self._open is not None,
            "stall_open_ms": self.current_stall_ms(),
            "total": total,
            "suppressed_logs": self._suppressed,
            "stalls": list(reversed(stalls)),  # newest first
        }


_detector: StallDetector | None = None


def get_stall_detector() -> StallDetector:
    global _detector
    if _detector is None:
        _detector = StallDetector()
    return _detector


async def start_stall_detector() -> None:
    await get_stall_detector().start()


async def stop_stall_detector() -> None:
    if _detector is not None:
        await _detector.stop()


# --- slow requests / in-flight -----------------------------------------------


class RequestStats:
    """In-flight HTTP count + slow-request counters. Written only from the loop thread
    (the ASGI middleware); read from anywhere. Plain ints are GIL-atomic for that."""

    def __init__(self) -> None:
        self.threshold_s = _env_float("SLOW_REQUEST_MS", DEFAULT_SLOW_REQUEST_MS) / 1000.0
        self.inflight = 0
        self.slow_total = 0
        self.slow_by_route: dict[str, int] = {}
        self._last_log = float("-inf")
        self._suppressed = 0

    def record_slow(self, route: str, method: str, path: str, status: int, ttfb_s: float) -> None:
        self.slow_total += 1
        if route not in self.slow_by_route and len(self.slow_by_route) >= SLOW_ROUTE_CAP:
            route = "_other"
        self.slow_by_route[route] = self.slow_by_route.get(route, 0) + 1
        now = time.monotonic()
        if now - self._last_log < SLOW_LOG_MIN_INTERVAL_S:
            self._suppressed += 1
            return
        extra = f" (+{self._suppressed} suppressed)" if self._suppressed else ""
        self._suppressed = 0
        self._last_log = now
        try:
            lag = get_metrics()._loop_lag_ms
            stall = get_stall_detector().current_stall_ms()
        except Exception:  # noqa: BLE001
            lag, stall = None, None
        logger.warning(
            f"[slow-request] {method} {route} -> {status} ttfb={ttfb_s * 1000:.0f}ms path={path} "
            f"loop_lag={lag}ms stall_open={stall}ms inflight={self.inflight}{extra}"
        )


request_stats = RequestStats()
