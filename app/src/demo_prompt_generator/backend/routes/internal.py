"""Runtime metrics endpoint for the live /internal page.

Surfaces the in-process MetricsRegistry (services/metrics.py): current gauges
(memory, live agent sessions, streams, previews, collab rooms), monotonic
counters since process start, and a bounded time-series history the page plots.

Single-replica app, so these are exact in-process numbers. ADMIN-ONLY (same gate
as the other /internal endpoints): the process-tree sample is not free, and the
counts are internal operational detail.
"""

from __future__ import annotations

import time
from typing import Any, Literal

from fastapi import HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..models import Project
from ..services.metrics import SAMPLE_INTERVAL_S, get_metrics
from ..services.stall_detector import frame_labels, get_stall_detector, request_stats

router = create_router()


class MetricsResponse(BaseModel):
    # Live gauges (current snapshot).
    gauges: dict[str, Any]
    # Monotonic counters since process start.
    counters: dict[str, int]
    # Bounded time series (one point per sample interval) for the live charts.
    history: list[dict[str, Any]]
    sample_interval_s: int


@router.get("/internal/metrics", response_model=MetricsResponse, operation_id="getInternalMetrics")
def get_internal_metrics(
    request: Request,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
) -> MetricsResponse:
    """Current runtime metrics + history. ADMIN-ONLY (403 otherwise).

    NOTE: this handler is deliberately SYNC (`def`, not `async def`). Starlette
    runs sync endpoints in a threadpool, so any blocking work runs OFF the event
    loop. Do not convert this to `async def` without wrapping `sample()`.
    """
    from ..core.auth import is_admin

    if not is_admin(headers.user_email if headers else None, config.template_admin_emails):
        raise HTTPException(status_code=403, detail="Admin access required")
    m = get_metrics()
    # Serve the most recent history point: the background sampler takes one every
    # SAMPLE_INTERVAL_S, so re-sampling the process tree on every poll only repeats
    # that work. Fall back to a fresh sample before the first tick has landed.
    history = m.history()
    latest = history[-1] if history else m.sample(request.app)
    return MetricsResponse(
        gauges=latest,
        counters=m.counters(),
        history=m.history(),
        sample_interval_s=SAMPLE_INTERVAL_S,
    )


# --- Active Claude sessions (ADMIN-ONLY) -------------------------------------


class ActiveSession(BaseModel):
    project_id: str
    project_name: str | None      # None if the project row was reaped from the DB
    owner_email: str | None
    is_busy: bool                 # a pooled client mid-turn (is_busy)
    has_live_stream: bool         # a turn actually in flight right now
    idle_seconds: int             # since last use (0 while busy/live)
    age_seconds: int              # since the session's Node subprocess was created
    project_url: str              # relative deep-link to the project workspace


class ActiveSessionsResponse(BaseModel):
    is_admin: bool
    sessions: list[ActiveSession]


@router.get(
    "/internal/active-sessions",
    response_model=ActiveSessionsResponse,
    operation_id="getActiveSessions",
)
def get_active_sessions(
    headers: Dependencies.Headers,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> ActiveSessionsResponse:
    """Projects that currently hold a live Claude Code agent session (one pooled
    ``ClaudeSDKClient`` = one Node subprocess). ADMIN-ONLY — the list exposes
    other users' project ids/names/owners, so it's gated on
    ``config.template_admin_emails`` (same gate as the admin template actions).
    Non-admins get 403.

    Single-replica app, so the in-process ``ClientPool`` is the whole truth.
    Cross-refs the ``ActiveStreamManager`` so each row shows whether a turn is
    actually in flight (``has_live_stream``) vs just a pooled-but-idle session.
    """
    # Lazy imports — avoid a routes→services import at module load (matches the
    # pattern the metrics registry uses to read the pool).
    from ..core.auth import is_admin
    from ..services.agent import get_client_pool
    from ..services.active_stream import get_stream_manager

    caller = headers.user_email if headers else None
    if not is_admin(caller, config.template_admin_emails):
        raise HTTPException(status_code=403, detail="Admin access required")

    pool = get_client_pool()
    clients = dict(getattr(pool, "_clients", {}))  # snapshot: pool mutates live

    # Which projects have a turn IN FLIGHT right now (not just a pooled client).
    live_projects: set[str] = set()
    for st in list(getattr(get_stream_manager(), "_streams", {}).values()):
        if not (st.is_complete or st.is_cancelled or st.is_error):
            live_projects.add(st.project_id)

    now_wall = time.time()
    now_mono = time.monotonic()
    out: list[ActiveSession] = []
    for project_id, pooled in clients.items():
        project = session.get(Project, project_id)
        busy = bool(getattr(pooled, "is_busy", False))
        live = project_id in live_projects
        # last_used_at/created_at set on the pool (monotonic / wall respectively).
        idle = 0 if (busy or live) else max(0, int(now_mono - getattr(pooled, "last_used_at", now_mono)))
        age = max(0, int(now_wall - getattr(pooled, "created_at", now_wall)))
        out.append(ActiveSession(
            project_id=project_id,
            project_name=project.name if project else None,
            owner_email=project.user_email if project else None,
            is_busy=busy,
            has_live_stream=live,
            idle_seconds=idle,
            age_seconds=age,
            project_url=f"/project/{project_id}",
        ))
    # Busiest first: live turns, then busy, then most-recently-used (least idle).
    out.sort(key=lambda s: (not s.has_live_stream, not s.is_busy, s.idle_seconds))
    return ActiveSessionsResponse(is_admin=True, sessions=out)


# ---------------------------------------------------------------------------
# Thread dump: "what is the server doing right now?"
#
# For a prod slowdown (requests slow, CPU flat at one core): every thread's
# Python stack + CPU time, every asyncio task's await point, and how long the
# event loop takes to run a callback. A SYNC handler on purpose: it runs on a
# worker thread, so it catches the loop thread mid-work instead of itself.
# If the loop is frozen solid nothing HTTP answers; then `kill -USR1 <pid>`
# (faulthandler, registered in app.py) writes the thread stacks to the logs.
# ---------------------------------------------------------------------------


class ThreadDump(BaseModel):
    name: str
    native_id: int | None
    cpu_s: float | None          # CPU time this thread used since it started
    stack: list[str]             # outermost first, "file:line function"


class TaskDump(BaseModel):
    name: str
    coro: str
    stack: list[str]             # where the coroutine is awaiting


class ThreadpoolStats(BaseModel):
    total: int | None            # anyio default-limiter size (THREAD_TOKENS)
    borrowed: int | None         # tokens in use
    waiting: int | None          # sync calls queued for a thread (>0 sustained = starvation)


class DbPoolStats(BaseModel):
    size: int | None
    checked_out: int | None
    overflow: int | None
    checked_in: int | None


class SlowRequests(BaseModel):
    total: int                   # requests whose TTFB exceeded SLOW_REQUEST_MS, since start
    by_route: dict[str, int]     # per handler (qualname); capped in count


class Saturation(BaseModel):
    threadpool: ThreadpoolStats  # from the on-loop snapshot (≤1 s old)
    db_pool: DbPoolStats
    inflight_requests: int       # HTTP requests in flight now (SSE streams included)
    slow_requests: SlowRequests


class ProcessRow(BaseModel):
    pid: int
    kind: str                    # main / claude / preview / browser / other
    cmd: str                     # executable + args, credentials masked
    cpu_pct: float | None        # % of one core over the last walk (None on first sight)
    rss_mb: float


class ProcessTable(BaseModel):
    main: ProcessRow | None
    children: list[ProcessRow]   # largest RSS first


class ThreadDumpResponse(BaseModel):
    pid: int
    loop_lag_ms: float | None    # time for the loop to run a callback; None = >2s (blocked)
    threads: list[ThreadDump]
    tasks: list[TaskDump]
    saturation: Saturation
    processes: ProcessTable


def _saturation(request: Request) -> Saturation:
    """Live saturation gauges for the thread dump. Every read is defensive: a missing
    engine or an unexpected pool type reports None rather than failing the dump."""
    m = get_metrics()
    tp = m._threadpool_stats  # written on-loop; a read from this worker thread can't ask the limiter
    db = DbPoolStats(size=None, checked_out=None, overflow=None, checked_in=None)
    try:
        pool = request.app.state.engine.pool
        db = DbPoolStats(
            size=int(pool.size()), checked_out=int(pool.checkedout()),
            overflow=int(pool.overflow()), checked_in=int(pool.checkedin()),
        )
    except Exception:  # noqa: BLE001 — not wired (PGLite/tests) or a pool without these methods
        pass
    return Saturation(
        threadpool=ThreadpoolStats(
            total=tp[0] if tp else None, borrowed=tp[1] if tp else None, waiting=tp[2] if tp else None,
        ),
        db_pool=db,
        inflight_requests=request_stats.inflight,
        slow_requests=SlowRequests(total=request_stats.slow_total, by_route=dict(request_stats.slow_by_route)),
    )


@router.get("/health/threads", response_model=ThreadDumpResponse, operation_id="getThreadDump")
def get_thread_dump(request: Request, headers: Dependencies.Headers, config: Dependencies.Config) -> ThreadDumpResponse:
    """ADMIN-ONLY thread + asyncio-task dump (see the section comment)."""
    import asyncio
    import os
    import sys
    import threading

    from ..core.auth import is_admin

    if not is_admin(headers.user_email if headers else None, config.template_admin_emails):
        raise HTTPException(status_code=403, detail="Admin access required")

    loop = getattr(request.app.state, "event_loop", None)
    lag_ms: float | None = None
    if loop is not None:
        ran = threading.Event()
        t0 = time.monotonic()
        loop.call_soon_threadsafe(ran.set)
        if ran.wait(2.0):
            lag_ms = round((time.monotonic() - t0) * 1000, 1)

    frames = sys._current_frames()
    threads = []
    for t in threading.enumerate():
        frame = frames.get(t.ident) if t.ident else None
        stack = []
        while frame is not None:
            stack.append(frame)
            frame = frame.f_back
        try:
            cpu = round(time.clock_gettime(time.pthread_getcpuclockid(t.ident)), 2)  # type: ignore[attr-defined,arg-type,unused-ignore]
        except Exception:
            cpu = None  # not on Linux (macOS dev), or the thread just ended
        threads.append(ThreadDump(name=t.name, native_id=t.native_id, cpu_s=cpu, stack=frame_labels(stack[::-1])))
    threads.sort(key=lambda d: -(d.cpu_s or 0))

    tasks = []
    if loop is not None:
        try:
            for task in list(asyncio.all_tasks(loop)):
                coro = task.get_coro()
                tasks.append(TaskDump(
                    name=task.get_name(),
                    coro=getattr(coro, "__qualname__", repr(coro)),
                    stack=frame_labels(task.get_stack(limit=20)),
                ))
        except RuntimeError:
            pass  # the task set changed under us; threads are the main signal
    return ThreadDumpResponse(
        pid=os.getpid(), loop_lag_ms=lag_ms, threads=threads, tasks=tasks,
        saturation=_saturation(request), processes=_processes(),
    )


def _processes() -> ProcessTable:
    raw = get_metrics().process_table()
    main = raw.get("main")
    return ProcessTable(
        main=ProcessRow(**main) if main else None,
        children=[ProcessRow(**r) for r in raw.get("children", [])],
    )


# ---------------------------------------------------------------------------
# CPU profile + event-loop stalls (ADMIN-ONLY). Both are on-demand or bounded:
# the profiler samples only while asked; stalls are the always-on watchdog's
# ring buffer (services/stall_detector.py). Use them together with /health/threads:
#   - /health/profile: "where is CPU going over the next N seconds?"
#   - /health/stalls:  "when did the loop block, for how long, and who was it?"
# ---------------------------------------------------------------------------


class ProfileStack(BaseModel):
    stack: str                   # collapsed "outermost;...;innermost"
    count: int
    pct: float                   # share of this thread's samples


class ProfileThread(BaseModel):
    name: str
    cpu_s: float | None          # CPU this thread used during the window (None = no clock)
    samples: int
    stacks: list[ProfileStack]   # top stacks by count


class ProfileResponse(BaseModel):
    pid: int
    seconds: float               # actual window length
    hz: int
    ticks: int
    thread: str
    threads: list[ProfileThread]  # busiest (CPU, then samples) first


@router.get("/health/profile", response_model=ProfileResponse, operation_id="getCpuProfile")
def get_cpu_profile(
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    seconds: int = Query(10, ge=1, le=30),
    hz: int = Query(100, ge=1, le=200),
    thread: Literal["all", "main"] = Query("all"),
    format_: Literal["json", "collapsed"] = Query("json", alias="format"),
) -> ProfileResponse | Response:
    """ADMIN-ONLY sampling profile. Blocks this worker thread for `seconds` (the event
    loop keeps serving). `format=collapsed` returns folded stacks for flamegraph.pl /
    speedscope: one `thread;frame;frame count` line per distinct stack."""
    import os

    from ..core.auth import is_admin
    from ..services.profiler import ProfileBusy, sample_profile

    if not is_admin(headers.user_email if headers else None, config.template_admin_emails):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        result = sample_profile(seconds, hz, thread)
    except ProfileBusy:
        raise HTTPException(status_code=409, detail="A profile is already running; retry shortly")
    if format_ == "collapsed":
        return PlainTextResponse(result.collapsed())
    return ProfileResponse(pid=os.getpid(), **result.to_dict())


class StallCpu(BaseModel):
    thread: str
    cpu_s: float


class StallRecord(BaseModel):
    started_at: float            # wall clock, when the loop last ran
    duration_ms: float           # last heartbeat before the block → heartbeat after it
    cause: str                   # loop busy / starved by a thread / waiting on I/O
    loop_cpu_s: float | None
    cpu_top: list[StallCpu]      # busiest OTHER threads during the stall
    stack: list[str]             # loop-thread stack at detection, outermost first
    hot_stack: list[str]         # the stack seen on the most ticks during the stall
    hot_samples: int
    samples: int


class StallsResponse(BaseModel):
    threshold_ms: float          # LOOP_STALL_MS
    stalled_now: bool
    stall_open_ms: float         # age of the current stall (0 when healthy)
    total: int                   # stalls recorded since start (ring keeps the last 50)
    suppressed_logs: int
    stalls: list[StallRecord]    # newest first


@router.get("/health/stalls", response_model=StallsResponse, operation_id="getLoopStalls")
def get_loop_stalls(headers: Dependencies.Headers, config: Dependencies.Config) -> StallsResponse:
    """ADMIN-ONLY event-loop stall history (see services/stall_detector.py)."""
    from ..core.auth import is_admin

    if not is_admin(headers.user_email if headers else None, config.template_admin_emails):
        raise HTTPException(status_code=403, detail="Admin access required")
    return StallsResponse(**get_stall_detector().snapshot())
