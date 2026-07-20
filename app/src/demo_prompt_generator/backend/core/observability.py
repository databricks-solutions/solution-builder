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
