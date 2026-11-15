"""In-process runtime metrics for the live /internal page.

Single-replica app (`--workers 1`), so a plain in-memory singleton is the right,
robust store — no external TSDB needed. Two kinds of metric:

- **Gauges** — sampled ON DEMAND by reading the existing singletons (agent client
  pool, active-stream manager, preview registry, collab hub) + process RSS via
  psutil. Nothing is accumulated to produce them, so the metrics layer itself
  can't leak.
- **Counters** — monotonic totals since process start (projects created, agent
  turns started, streams opened, agent connect failures, WS connects…). Bumped
  at the event sites via `bump(name)`.

A background sampler (started in the lifespan) appends one snapshot per interval
into a BOUNDED ring buffer (`deque(maxlen=...)`) so the page can plot a live time
series (memory, sessions, streams…) without any storage. The ring buffer is the
ONLY accumulation and it's hard-capped — a few hours at 30 s ≈ a few hundred tiny
dicts.

This same registry ALSO feeds OpenTelemetry: `core/observability.init_app_metrics()`
registers observable gauges + counters that read `gauges()`/`counters()` each OTEL
collection cycle (no-op when telemetry is off). So the numbers on /internal and the
app's `otel_metrics` UC table are the same source.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Any

from ..core._config import logger

# Ring-buffer sizing: one snapshot per SAMPLE_INTERVAL_S, keep ~3 DAYS of history
# so a slow leak's TREND is visible. A snapshot is a small flat dict (~12 scalars)
# → 3 days at 30s ≈ 8640 dicts ≈ ~4 MB, negligible and hard-bounded (deque maxlen
# can't overrun). The /internal chart downsamples client-side if needed.
SAMPLE_INTERVAL_S = 30
_HISTORY_SECONDS = 3 * 24 * 60 * 60
_HISTORY_MAXLEN = _HISTORY_SECONDS // SAMPLE_INTERVAL_S  # ~8640 samples (~3 days)

_PROCESS_START = time.time()


def _classify_child(child: Any) -> str:
    """Bucket a descendant process into claude / preview / browser / other by its
    cmdline. A Claude Code session is the `claude` CLI (a Node process running the
    agent); a preview app is a project's `npm run dev` → vite/tsx/esbuild tree
    under its `app/`; a browser is the Playwright Chromium/headless-shell the brand
    service spawns for website screenshots (~150-300 MB per launch — heavy + bursty,
    so worth its own slice). Anything else (databricks CLI, bash, uv, git the agent
    shells out to) is `other`. Best-effort string match — a misclassification only
    mislabels a slice of the chart, never breaks the sample."""
    try:
        cmd = " ".join(child.cmdline()).lower()
    except Exception:  # noqa: BLE001
        return "other"
    if not cmd:
        return "other"
    # Playwright browser (brand-service website screenshots). Check BEFORE the
    # others: the headless-shell tree can carry "node"-ish helper procs, and its
    # RSS is large + transient — we want it identifiable, not hidden in `other`.
    if ("chromium" in cmd or "headless_shell" in cmd or "chrome-headless" in cmd
            or "playwright" in cmd or "ms-playwright" in cmd):
        return "browser"
    # Preview dev servers: vite / tsx / esbuild / the app_template start.sh chain.
    if ("vite" in cmd or "tsx" in cmd or "esbuild" in cmd
            or "npm run dev" in cmd or "start.sh" in cmd):
        return "preview"
    # Claude Code agent session (the SDK spawns the `claude` CLI on node).
    if "claude" in cmd and ("node" in cmd or "/claude" in cmd or cmd.strip().startswith("claude")):
        return "claude"
    return "other"


_CHILD_TABLE_TTL_S = 5.0
_SENSITIVE_ARG = ("token", "secret", "password", "passwd", "key", "auth")


def _short_cmd(argv: list[str]) -> str:
    """Executable basename + the args, truncated, with the value of anything that looks
    like a credential masked. The /internal page is admin-only, but tokens in a
    subprocess argv should still never reach a page or a log."""
    if not argv:
        return ""
    out = [os.path.basename(argv[0])]
    mask_next = False
    for a in argv[1:]:
        if mask_next:
            out.append("***")
            mask_next = False
            continue
        low = a.lower()
        if any(s in low for s in _SENSITIVE_ARG):
            if "=" in a:
                out.append(a.split("=", 1)[0] + "=***")
            else:
                out.append(a)
                mask_next = True
            continue
        out.append(a)
    return " ".join(out)[:120]


def _cgroup_mem() -> tuple[int | None, int | None]:
    """(used_bytes, limit_bytes) from the container's cgroup — the AUTHORITATIVE
    memory the OOM-killer enforces. Tries cgroup v2 (`memory.current`/`memory.max`)
    then v1 (`memory.usage_in_bytes`/`memory.limit_in_bytes`). `memory.max` can be
    the literal "max" (no limit) → return None limit. Returns (None, None) off a
    cgroup host (local dev). Never raises."""
    def _read_int(path: str) -> int | None:
        try:
            with open(path) as f:
                v = f.read().strip()
            return None if v == "max" else int(v)
        except Exception:  # noqa: BLE001
            return None

    # cgroup v2 (Databricks Apps containers)
    used = _read_int("/sys/fs/cgroup/memory.current")
    if used is not None:
        limit = _read_int("/sys/fs/cgroup/memory.max")
        return used, limit
    # cgroup v1 fallback
    used = _read_int("/sys/fs/cgroup/memory/memory.usage_in_bytes")
    if used is not None:
        limit = _read_int("/sys/fs/cgroup/memory/memory.limit_in_bytes")
        # v1 "unlimited" is a huge sentinel (~2^63); treat >100 TB as no limit.
        if limit is not None and limit > 100 * 1024**4:
            limit = None
        return used, limit
    return None, None


class MetricsRegistry:
    """Process-wide singleton. Counters + on-demand gauges + a bounded history."""

    _instance: "MetricsRegistry | None" = None

    def __init__(self) -> None:
        self._counters: dict[str, int] = defaultdict(int)
        self._lock = Lock()
        self._history: deque[dict[str, Any]] = deque(maxlen=_HISTORY_MAXLEN)
        # Set once the sampler starts, so OTEL observable-gauge callbacks (which
        # have no request/app handle) can still read preview-registry gauges.
        self._app: Any = None
        # Short-TTL memo for gauges_cached() — shared by the two OTEL callbacks
        # in one collection cycle so they don't each walk the process tree.
        self._gauges_cache: tuple[float, dict[str, Any]] | None = None
        # Latest event-loop lag reading (ms), refreshed by loop_lag_monitor.
        # 0.0 until the monitor takes its first sample.
        self._loop_lag_ms: float = 0.0
        # Latest anyio-threadpool snapshot (total, borrowed, waiting), captured
        # ON THE EVENT LOOP by loop_lag_monitor — because the limiter accessor
        # raises off-loop and gauges() runs on a worker thread. None until first
        # snapshot. Read by gauges(); a plain tuple assignment is GIL-atomic.
        self._threadpool_stats: tuple[int, int, int] | None = None
        # psutil is already a dep (pulled by opentelemetry-system-metrics). Import
        # lazily + tolerantly so metrics degrade (memory=None) rather than break if
        # it's somehow absent.
        try:
            import psutil  # type: ignore
            self._proc = psutil.Process(os.getpid())
        except Exception:  # noqa: BLE001
            self._proc = None
        # Cached process table for /health/threads (see process_table()).
        self._proc_table: tuple[float, dict[str, Any]] | None = None
        self._proc_prev: dict[int, tuple[float, float, float]] = {}
        self._proc_lock = Lock()

    @classmethod
    def get_instance(cls) -> "MetricsRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # -- counters -----------------------------------------------------------
    def bump(self, name: str, n: int = 1) -> None:
        """Increment a monotonic counter. Cheap + thread-safe; safe to call from
        any event site (never raises)."""
        try:
            with self._lock:
                self._counters[name] += n
        except Exception:  # noqa: BLE001 — a metric must never break the caller
            pass

    def counters(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

    # -- memory (the hard part — see the module docstring for the full model) --
    def _memory(self) -> dict[str, Any]:
        """A BREAKDOWN, not one number. The main uvicorn process's RSS is only a
        slice of what the container holds: each Claude Code session is its OWN Node
        SUBPROCESS (~150-300 MB) and each live preview app is its OWN node/vite tree
        — separate PIDs whose memory a plain getpid() RSS misses entirely. So we:
          • sum the WHOLE descendant tree (psutil children(recursive=True)) — no
            PID bookkeeping needed, catches every session + preview + CLI child;
          • SPLIT it by classifying each child's cmdline → claude / preview / other,
            so the /internal chart shows WHICH subsystem is growing;
          • read the cgroup memory.current / memory.max — the AUTHORITATIVE
            container total the OOM-killer actually enforces (summed per-process RSS
            overcounts shared pages; cgroup current is the charged truth).
        Everything degrades to None on any error, never raises."""
        out: dict[str, Any] = {
            "main_rss_mb": None, "children_rss_mb": None, "total_rss_mb": None,
            "claude_rss_mb": None, "preview_rss_mb": None, "browser_rss_mb": None,
            "other_rss_mb": None,
            "children": None, "cgroup_used_mb": None, "cgroup_limit_mb": None,
            "cgroup_percent": None, "percent": None,
        }
        if self._proc is None:
            return out
        try:
            import psutil  # type: ignore
            main = self._proc.memory_info().rss
            out["main_rss_mb"] = round(main / (1024 * 1024), 1)

            claude = preview = browser = other = 0
            n = 0
            for child in self._proc.children(recursive=True):
                try:
                    rss = child.memory_info().rss
                    n += 1
                    cat = _classify_child(child)
                    if cat == "claude":
                        claude += rss
                    elif cat == "preview":
                        preview += rss
                    elif cat == "browser":
                        browser += rss
                    else:
                        other += rss
                except Exception:  # noqa: BLE001 — a child died mid-walk / is unreadable; skip
                    continue
            mb = lambda b: round(b / (1024 * 1024), 1)  # noqa: E731
            out["claude_rss_mb"] = mb(claude)
            out["preview_rss_mb"] = mb(preview)
            out["browser_rss_mb"] = mb(browser)
            out["other_rss_mb"] = mb(other)
            out["children_rss_mb"] = mb(claude + preview + browser + other)
            out["total_rss_mb"] = mb(main + claude + preview + browser + other)
            out["children"] = n
            try:
                out["percent"] = round(psutil.virtual_memory().percent, 1)
            except Exception:  # noqa: BLE001
                pass
        except Exception:  # noqa: BLE001
            pass

        # cgroup: the real container memory limit + current usage (the OOM signal).
        used, limit = _cgroup_mem()
        if used is not None:
            out["cgroup_used_mb"] = round(used / (1024 * 1024), 1)
        if limit is not None:
            out["cgroup_limit_mb"] = round(limit / (1024 * 1024), 1)
        if used is not None and limit:
            out["cgroup_percent"] = round(100.0 * used / limit, 1)
        return out

    def gauges_cached(self, ttl_s: float = 2.0) -> dict[str, Any]:
        """`gauges()` memoized for a short TTL. OTEL polls two observable
        instruments (memory + resources) per collection cycle, microseconds
        apart; without this each would trigger its own full psutil process-tree
        walk. One cached snapshot serves both. Not used by `sample()`, which
        wants a fresh reading every interval."""
        now = time.monotonic()
        cached = self._gauges_cache
        if cached is not None and (now - cached[0]) < ttl_s:
            return cached[1]
        g = self.gauges()
        self._gauges_cache = (now, g)
        return g

    def gauges(self) -> dict[str, Any]:
        """Read the live in-process singletons for their current sizes. Every read
        is defensive — a subsystem that isn't wired yet just reports 0/None instead
        of breaking the whole snapshot."""
        g: dict[str, Any] = {}

        # Agent client pool — live ClaudeSDKClient (Node subprocess) sessions.
        try:
            from .agent import get_client_pool
            pool = get_client_pool()
            clients = getattr(pool, "_clients", {})
            g["agent_sessions"] = len(clients)
            g["agent_sessions_busy"] = sum(1 for c in clients.values() if getattr(c, "is_busy", False))
        except Exception:  # noqa: BLE001
            g["agent_sessions"] = None
            g["agent_sessions_busy"] = None

        # Active SSE streams (each buffers a turn's events).
        try:
            from .active_stream import get_stream_manager
            streams = getattr(get_stream_manager(), "_streams", {})
            g["active_streams"] = len(streams)
            g["live_streams"] = sum(
                1 for s in streams.values()
                if not (s.is_complete or s.is_error or s.is_cancelled)
            )
        except Exception:  # noqa: BLE001
            g["active_streams"] = None
            g["live_streams"] = None

        # Collab rooms + members (live multi-user architecture editing).
        try:
            from .collab import get_collab_hub
            rooms = getattr(get_collab_hub(), "_rooms", {})
            g["collab_rooms"] = len(rooms)
            g["collab_members"] = sum(len(getattr(r, "members", {})) for r in rooms.values())
        except Exception:  # noqa: BLE001
            g["collab_rooms"] = None
            g["collab_members"] = None

        # ── Wedge diagnosis (2026-08): the app periodically goes RUNNING-but-not-
        # serving (a monitor then restarts it). Leading suspect is exhaustion of the
        # single event loop's shared resources under concurrent load. These three
        # gauges make that visible so a freeze window can be read off the chart /
        # OTEL table: a saturated threadpool (borrowed==total, tasks_waiting>0), a
        # drained DB pool (checked_out==size+overflow), or a blocked loop (loop_lag
        # spiking to seconds) each point at a different cause.

        # anyio default threadpool — the pool Starlette runs EVERY sync `def`
        # endpoint in (list_project_files, etc.). If it saturates, every sync
        # request queues and the app looks wedged.
        #
        # ⚠️ These are READ FROM A STASH (`_threadpool_stats`) filled by
        # `loop_lag_monitor` ON THE EVENT LOOP — NOT read live here. Reason:
        # `current_default_thread_limiter()` raises `NoEventLoopError` unless
        # called from a running loop, and `gauges()` is invoked from a WORKER
        # THREAD (the sampler runs `sample()` via `asyncio.to_thread`, and OTEL
        # push exporters may collect off-loop too). Reading the limiter here
        # would raise every cycle → the whole threadpool diagnostic would be
        # permanently None. So the on-loop monitor snapshots it and we read the
        # snapshot. (Verified: a thread call to the limiter raises NoEventLoopError.)
        tp = self._threadpool_stats
        g["threadpool_total"] = tp[0] if tp else None
        g["threadpool_borrowed"] = tp[1] if tp else None
        g["threadpool_waiting"] = tp[2] if tp else None

        # SQLAlchemy connection pool (pool_size=10 + max_overflow=20 → 30 max;
        # pool_timeout=5s). If checked_out hits the ceiling, DB calls block 5s
        # then raise — another way the app stalls under load.
        try:
            app = self._app
            engine = getattr(getattr(app, "state", None), "engine", None) if app else None
            db_pool = engine.pool if engine is not None else None
            if db_pool is not None:
                g["db_pool_checked_out"] = int(db_pool.checkedout())
                g["db_pool_size"] = int(db_pool.size())
                g["db_pool_overflow"] = int(db_pool.overflow())
            else:
                g["db_pool_checked_out"] = g["db_pool_size"] = g["db_pool_overflow"] = None
        except Exception:  # noqa: BLE001
            g["db_pool_checked_out"] = g["db_pool_size"] = g["db_pool_overflow"] = None

        # Event-loop lag (ms): measured by a 1s heartbeat task (see
        # loop_lag_monitor). ~0 when healthy; if it climbs to seconds, a
        # coroutine is BLOCKING the single loop (a sync call awaited on-loop,
        # not off-loaded). Distinguishes "loop blocked" from "threadpool/DB
        # exhausted" (loop fine, but sync work can't get a thread).
        g["loop_lag_ms"] = self._loop_lag_ms

        # HTTP requests currently in flight (SSE streams count while open). Lazy
        # import: stall_detector imports this module at load time.
        from .stall_detector import request_stats
        g["inflight_requests"] = request_stats.inflight

        g["memory"] = self._memory()
        g["uptime_s"] = round(time.time() - _PROCESS_START)
        return g

    def process_table(self) -> dict[str, Any]:
        """Main process + every descendant: pid, short cmd, kind, CPU% and RSS. Answers
        "is the container's CPU our Python or the Node agents / previews / browsers?".
        CPU% is the cpu_times() delta between two walks (None on a pid's first walk).
        Cached _CHILD_TABLE_TTL_S: one /proc read per child, polled by the admin page."""
        now = time.monotonic()
        with self._proc_lock:
            cached = self._proc_table
            if cached is not None and now - cached[0] < _CHILD_TABLE_TTL_S:
                return cached[1]
            if self._proc is None:
                return {"main": None, "children": []}
            try:
                procs = [self._proc] + self._proc.children(recursive=True)
            except Exception:  # noqa: BLE001
                procs = [self._proc]
            rows: list[dict[str, Any]] = []
            prev = self._proc_prev
            nxt: dict[int, tuple[float, float, float]] = {}
            for p in procs:
                try:
                    with p.oneshot():
                        cpu = p.cpu_times()
                        total = cpu.user + cpu.system
                        created = p.create_time()
                        rss = p.memory_info().rss
                        argv = p.cmdline()
                except Exception:  # noqa: BLE001 — died mid-walk; skip
                    continue
                pct = None
                last = prev.get(p.pid)
                if last is not None and last[0] == created and now > last[2]:
                    pct = round(100.0 * (total - last[1]) / (now - last[2]), 1)
                nxt[p.pid] = (created, total, now)
                kind = "main" if p.pid == os.getpid() else _classify_child(p)
                rows.append({
                    "pid": p.pid, "kind": kind, "cmd": _short_cmd(argv),
                    "cpu_pct": pct, "rss_mb": round(rss / (1024 * 1024), 1),
                })
            self._proc_prev = nxt  # replaced each walk, so dead pids drop out
            main = rows[0] if rows and rows[0]["kind"] == "main" else None
            children = sorted((r for r in rows if r is not main), key=lambda r: -r["rss_mb"])
            result = {"main": main, "children": children}
            self._proc_table = (now, result)
            return result

    def preview_gauges(self, app: Any) -> dict[str, Any]:
        """Preview registry lives on app.state (needs no DB), so it's read via the
        app rather than a singleton accessor."""
        try:
            reg = getattr(app.state, "preview_registry", None)
            states = getattr(reg, "_states", {}) if reg is not None else {}
            running = sum(1 for s in states.values() if getattr(s, "status", None) in ("starting", "ready"))
            return {"preview_states": len(states), "preview_running": running}
        except Exception:  # noqa: BLE001
            return {"preview_states": None, "preview_running": None}

    # -- history (time series) ----------------------------------------------
    def sample(self, app: Any) -> dict[str, Any]:
        """Take ONE snapshot (gauges + counters + preview) and append to history.
        Returns the snapshot. Called by the background sampler AND surfaced by the
        route so the latest point is always fresh."""
        snap: dict[str, Any] = {"t": round(time.time())}
        snap.update(self.gauges())
        snap.update(self.preview_gauges(app))
        # Flatten the memory BREAKDOWN into scalar series (charts want scalars).
        # `rss_mb` stays as an alias for the main process (back-compat with the
        # existing tile/chart); the split fields drive the stacked breakdown.
        mem = snap.pop("memory", {}) or {}
        for k in ("main_rss_mb", "children_rss_mb", "total_rss_mb", "claude_rss_mb",
                  "preview_rss_mb", "browser_rss_mb", "other_rss_mb", "children",
                  "cgroup_used_mb", "cgroup_limit_mb", "cgroup_percent"):
            snap[k] = mem.get(k)
        snap["rss_mb"] = mem.get("main_rss_mb")   # back-compat alias
        snap["mem_percent"] = mem.get("percent")
        with self._lock:
            self._history.append(snap)
        return snap

    def history(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._history)


def get_metrics() -> MetricsRegistry:
    return MetricsRegistry.get_instance()


async def metrics_sampler_loop(app: Any) -> None:
    """Background task: append one history snapshot every SAMPLE_INTERVAL_S. Started
    from the lifespan. Exceptions are swallowed so a bad sample never kills the loop
    (a dead sampler would just freeze the chart, not the app)."""
    logger.info(f"[metrics] sampler started (every {SAMPLE_INTERVAL_S}s, ~{_HISTORY_MAXLEN} pts history)")
    get_metrics()._app = app  # let OTEL callbacks (no app handle) read preview gauges
    while True:
        try:
            # sample() does a synchronous psutil walk of the whole process tree
            # (children + per-child memory_info/cmdline) — hundreds of ms with
            # many live sessions/previews. Off-load to a thread so it never
            # blocks the single event loop (would stall every SSE stream + HTTP
            # handler each interval), matching the sibling reapers' pattern.
            await asyncio.to_thread(get_metrics().sample, app)
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[metrics] sample failed: {e!r}")
        await asyncio.sleep(SAMPLE_INTERVAL_S)


# Loop-lag heartbeat cadence. We sleep this long then measure how much LONGER
# than this the wakeup actually took — the excess is how long the loop was busy
# (blocked) instead of servicing the timer. 1s is frequent enough to catch a
# multi-second stall within a sample window, cheap enough to be free.
LOOP_LAG_INTERVAL_S = 1.0


def _snapshot_threadpool(m: "MetricsRegistry") -> None:
    """Snapshot the anyio default-threadpool limiter into `m._threadpool_stats`.
    MUST be called ON THE EVENT LOOP — `current_default_thread_limiter()` raises
    `NoEventLoopError` off-loop. gauges() (which runs on a worker thread) reads
    the stash. Best-effort; leaves the previous snapshot on any error."""
    try:
        from anyio.to_thread import current_default_thread_limiter
        st = current_default_thread_limiter().statistics()
        m._threadpool_stats = (
            int(st.total_tokens), int(st.borrowed_tokens), int(st.tasks_waiting)
        )
    except Exception:  # noqa: BLE001
        pass


async def loop_lag_monitor() -> None:
    """ON-LOOP heartbeat that stashes two wedge-diagnosis signals the worker-thread
    `gauges()` can't read itself:

      • `loop_lag_ms` — event-loop responsiveness. Sleeps LOOP_LAG_INTERVAL_S and
        records how much the actual elapsed time OVERSHOT: ~0 on a healthy loop;
        when a coroutine blocks the single loop (a sync/CPU call awaited on-loop
        instead of off-loaded), the timer can't fire on time and the overshoot
        spikes to the block's duration. Separates a BLOCKED LOOP from a saturated
        THREADPOOL/DB-POOL (loop responsive, but sync work can't get a worker).
      • `_threadpool_stats` — the anyio limiter snapshot. Captured HERE because the
        limiter accessor raises off-loop and gauges() runs on a worker thread.

    Started from the lifespan alongside the sampler; dirt-cheap so it never itself
    perturbs what it measures."""
    m = get_metrics()
    loop = asyncio.get_running_loop()
    logger.info(f"[metrics] loop-lag monitor started (every {LOOP_LAG_INTERVAL_S}s)")
    while True:
        _snapshot_threadpool(m)  # on-loop: safe to read the limiter here
        t0 = loop.time()
        await asyncio.sleep(LOOP_LAG_INTERVAL_S)
        overshoot_s = (loop.time() - t0) - LOOP_LAG_INTERVAL_S
        # Clamp tiny negatives (scheduler jitter) to 0; store ms.
        m._loop_lag_ms = round(max(0.0, overshoot_s) * 1000.0, 1)
