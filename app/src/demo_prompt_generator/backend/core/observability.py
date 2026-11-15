"""Databricks Apps observability — explicit system (CPU/memory) metrics.

FastAPI request spans + logs are auto-wired by `opentelemetry-instrument` (see
start.sh, which launches uvicorn under it when the Apps telemetry option is on).
But **system/process metrics are NOT auto-started for FastAPI** — the
`opentelemetry-instrumentation-system-metrics` collector has to be instrumented
explicitly. This module does exactly that, guarded so it's a hard no-op when
telemetry is off (local dev / telemetry-disabled deploy) or the package is absent.

Called once from the app factory. By the time our app module imports, the
`opentelemetry-instrument` bootstrap has already configured the global meter
provider, so `SystemMetricsInstrumentor().instrument()` binds to it and starts
emitting: `system.cpu.utilization`, `system.memory.usage`/`.utilization`,
`process.cpu.utilization`, `process.memory.usage`/`.virtual`, etc. (reads via
psutil, pulled in transitively).
"""

from __future__ import annotations

import os

from ._config import logger


def init_system_metrics() -> None:
    """Start OpenTelemetry system/process (CPU + memory) metrics — no-op unless
    the Apps telemetry option is on (Databricks injects OTEL_EXPORTER_OTLP_ENDPOINT)
    AND the instrumentation package is installed."""
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return  # telemetry off → nothing exports anyway; skip.
    try:
        from opentelemetry.instrumentation.system_metrics import (
            SystemMetricsInstrumentor,
        )
    except Exception:  # noqa: BLE001 — package not installed → silently skip
        logger.debug("[otel] system-metrics package not installed; skipping")
        return
    try:
        instrumentor = SystemMetricsInstrumentor()
        # instrument() is idempotent-guarded by the instrumentor (it tracks its
        # own _is_instrumented_by_opentelemetry), so a double call is harmless.
        instrumentor.instrument()
        logger.info("[otel] system (CPU/memory/process) metrics instrumentation started")
    except Exception as e:  # noqa: BLE001 — never let telemetry setup break boot
        logger.warning(f"[otel] failed to start system-metrics instrumentation: {e!r}")


def init_app_metrics() -> None:
    """Export the app's OWN runtime metrics (the same numbers the /internal page
    plots) to OpenTelemetry — the per-group memory breakdown + live-resource
    gauges + monotonic counters. No-op unless the Apps telemetry option is on
    (Databricks injects OTEL_EXPORTER_OTLP_ENDPOINT), so local dev + telemetry-off
    deploys are byte-identical to before. Registers OBSERVABLE gauges/counters:
    OTEL polls our callback each collection cycle, which reads a fresh
    MetricsRegistry snapshot — no push loop of our own. Metric names are prefixed
    `solution_builder.*` so they're easy to find in the OTEL/system table."""
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return
    try:
        from opentelemetry import metrics as otel_metrics
        from opentelemetry.metrics import Observation
        from ..services.metrics import get_metrics
    except Exception:  # noqa: BLE001
        logger.debug("[otel] app-metrics deps unavailable; skipping")
        return

    try:
        meter = otel_metrics.get_meter("solution_builder")

        # The memory-breakdown + resource GAUGES (MB / counts). One callback reads
        # a snapshot and emits an Observation per metric key. The `group`/`kind`
        # attribute lets the OTEL table pivot memory by process group.
        _MEM_KEYS = ["main_rss_mb", "claude_rss_mb", "preview_rss_mb",
                     "browser_rss_mb",
                     "other_rss_mb", "children_rss_mb", "total_rss_mb",
                     "cgroup_used_mb", "cgroup_limit_mb"]
        _GAUGE_KEYS = ["agent_sessions", "agent_sessions_busy", "active_streams",
                       "live_streams", "collab_rooms", "collab_members",
                       "preview_states", "preview_running", "children",
                       # Wedge-diagnosis gauges (see metrics.py): threadpool
                       # saturation, DB-pool exhaustion, event-loop lag.
                       "threadpool_total", "threadpool_borrowed", "threadpool_waiting",
                       "db_pool_checked_out", "db_pool_size", "db_pool_overflow",
                       "loop_lag_ms"]

        def _mem_cb(_options):
            snap = get_metrics().gauges_cached().get("memory", {}) or {}
            out = []
            for k in _MEM_KEYS:
                v = snap.get(k)
                if v is not None:
                    out.append(Observation(float(v), {"group": k}))
            return out

        def _gauge_cb(_options):
            m = get_metrics()
            g = dict(m.gauges_cached())  # copy — we merge preview gauges in below
            app = getattr(m, "_app", None)
            if app is not None:
                try:
                    g.update(m.preview_gauges(app))
                except Exception:  # noqa: BLE001
                    pass
            out = []
            for k in _GAUGE_KEYS:
                v = g.get(k)
                if v is not None:
                    out.append(Observation(float(v), {"metric": k}))
            return out

        def _counter_cb(_options):
            return [Observation(float(v), {"counter": k})
                    for k, v in get_metrics().counters().items()]

        meter.create_observable_gauge(
            "solution_builder.memory_mb", callbacks=[_mem_cb],
            unit="MB", description="Runtime memory by process group (see the group attribute)",
        )
        meter.create_observable_gauge(
            "solution_builder.resources", callbacks=[_gauge_cb],
            description="Live in-process resource counts (see the metric attribute)",
        )
        meter.create_observable_counter(
            "solution_builder.events_total", callbacks=[_counter_cb],
            description="Monotonic event counters since process start (see the counter attribute)",
        )
        logger.info("[otel] app runtime metrics (solution_builder.*) registered")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[otel] failed to register app metrics: {e!r}")
