"""
FastAPI routes for the preview module. Register with:

    from .preview import register_routes
    register_routes(main_router_or_app, get_project_dir=...)

Exposes:
    POST   /api/preview/{project_id}/start
    POST   /api/preview/{project_id}/stop
    POST   /api/preview/{project_id}/restart
    GET    /api/preview/{project_id}/state
    GET    /api/preview/{project_id}/events?since=N   (SSE)
    POST   /api/preview/{project_id}/ping
    *      /preview/{project_id}/{path:path}          (HTTP proxy + WS bridge)
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path
from typing import Any, Callable

import websockets
from fastapi import APIRouter, FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .logbuffer import LogLine
from .proxy import forget_project_rewrites, proxy_request
from .registry import (
    ConcurrencyError,
    NotReadyError,
    PreviewRegistry,
    PreviewState,
    Status,
)
from ..core import Dependencies
from ..core._config import logger
from ..core.auth import (
    detect_mode,
    make_project_auth_refresher,
    subprocess_auth_env,
    target_deploy_active,
)
from ..models import Project, User
from ..services.llm_service import LLMService, ModelSize
from ..services.shutdown import get_live_connections
from sqlmodel import select
from fastapi import Depends


# --- API shapes ---------------------------------------------------------------


class PreviewStateOut(BaseModel):
    project_id: str
    status: Status
    port: int | None
    pid: int | None
    last_seq: int
    has_start_script: bool


class AnalyzeLogsLine(BaseModel):
    seq: int
    stream: str
    text: str


class AnalyzeLogsIn(BaseModel):
    """Request body for log-analysis endpoint.

    Frontend sends a recent window of log lines (typically the new lines
    since the last analysis, plus a small head-room of preceding context).
    """
    lines: list[AnalyzeLogsLine]


class DetectedError(BaseModel):
    summary: str
    snippet: str
    severity: str  # "low" | "medium" | "high"


class AnalyzeLogsOut(BaseModel):
    """Zero or more errors detected in the window. Empty list = nothing to fix."""
    errors: list[DetectedError]


def _require_project_read(
    project_id: str,
    headers: Dependencies.Headers,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> None:
    """Read access to the project (owner, admin, accepted share or link), else 404
    (the same answer the project routes give, so IDs don't leak). A plain `def`, so
    FastAPI runs its DB read in the threadpool, off the event loop."""
    from ..routes.project_files import _get_user_email
    from ..routes.projects import _get_authorized_project

    _get_authorized_project(
        session, project_id, _get_user_email(headers), config.template_admin_emails
    )


def _to_out(state: PreviewState, has_start_script: bool) -> PreviewStateOut:
    return PreviewStateOut(
        project_id=state.project_id,
        status=state.status,
        port=state.port,
        pid=state.pid,
        last_seq=state.log_buffer.last_seq,
        has_start_script=has_start_script,
    )


# --- Registration -------------------------------------------------------------


# Per-project "is remote target" answer, shared by every proxied request. The pin
# (Project.target_workspace_host) is write-once (remote_deploy.user_target
# .pin_project_target), so the only change a cached value can miss is the first
# cross-workspace deploy: False → True. See AUTH.md for why that bounded staleness is safe.
_REMOTE_TARGET_TTL_SECONDS = 30.0
_remote_target_cache: dict[str, tuple[float, bool]] = {}
_remote_target_lock = threading.Lock()


def forget_remote_target(project_id: str) -> None:
    """Drop a project's cached remote-target answer, e.g. right after its pin is written."""
    with _remote_target_lock:
        _remote_target_cache.pop(project_id, None)


def _is_remote_target(
    project_id: str,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> bool | None:
    """True if THIS project deploys cross-workspace via the deployer SP.

    Drives the proxy's user-token strip: for a remote target the child must
    authenticate as the SP (its env holds oauth-m2m creds), so we must NOT
    forward the viewing user's host-workspace OBO token to it (invalid for
    the target → 401). Same predicate the auth-env read side uses, so both
    sides of the preview agree on identity. Returns None on a lookup failure
    (the caller forwards the token, the same-workspace default, and does not cache it).
    """
    try:
        project = session.get(Project, project_id)
        target_host = project.target_workspace_host if project else None
        return target_deploy_active(config, target_host)
    except Exception:
        return None


async def _strip_user_token(
    project_id: str,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> bool:
    # Checked before the to_thread hop: a hit costs no thread and no DB.
    now = time.monotonic()
    with _remote_target_lock:
        cached = _remote_target_cache.get(project_id)
    if cached is not None and now - cached[0] < _REMOTE_TARGET_TTL_SECONDS:
        return cached[1]
    # A blocking DB read: off the event loop, so a busy pool (pool_timeout)
    # never freezes every other stream while this request waits.
    value = await asyncio.to_thread(_is_remote_target, project_id, session, config)
    if value is None:
        return False
    with _remote_target_lock:
        _remote_target_cache[project_id] = (time.monotonic(), value)
    return value


def register_routes(
    app_or_router: FastAPI | APIRouter,
    *,
    get_project_dir: Callable[[str], Path],
) -> PreviewRegistry:
    """
    Attach the preview module's routes to a FastAPI app (or a router).

    Returns the registry so the caller can plug its lifecycle into the app's
    lifespan (startup/shutdown).
    """
    registry = PreviewRegistry(get_project_dir=get_project_dir)
    router = APIRouter()

    # Refresh <project>/.databrickscfg from the request PAT. No-op in local mode.
    # Two variants:
    #   - lifecycle: MUST be fresh before spawn, no debounce
    #   - keepalive: ping + proxy fire on every static asset, debounced
    # See backend/AUTH.md.
    refresh_lifecycle = make_project_auth_refresher(get_project_dir, debounce=False)
    refresh_keepalive = make_project_auth_refresher(get_project_dir, debounce=True)

    def _subprocess_auth_env(
        project_id: str,
        headers: Dependencies.Headers,
        session: Dependencies.Session,
        config: Dependencies.Config,
    ) -> dict[str, str]:
        """Build the Databricks auth env for the preview subprocess.

        Thin wrapper around core.auth.subprocess_auth_env — resolves the
        local-mode profile from the single User row (same pattern as the
        agent route). See backend/AUTH.md.

        Cross-workspace SP-target: mirror the agent route — when this project
        deploys to a remote target workspace via the deployer SP, pass
        target_deploy=True so subprocess_auth_env pins oauth-m2m + the SP
        creds/host from the project's .databrickscfg. Without it the preview
        falls into the OBO/PAT branch, which scrubs the SP creds and expects a
        PAT that isn't there → the preview app fails to authenticate and never
        binds its port. The refresher (make_project_auth_refresher) already
        writes the SP file for these projects; this makes the READ side agree.
        """
        mode = detect_mode(headers)
        local_profile: str | None = None
        if mode == "local":
            user = session.exec(select(User).limit(1)).first()
            local_profile = user.databricks_profile if user else None
        project = session.get(Project, project_id)
        target_host = project.target_workspace_host if project else None
        return subprocess_auth_env(
            get_project_dir(project_id),
            mode=mode,
            local_profile=local_profile,
            target_deploy=target_deploy_active(config, target_host),
        )

    # ---- Lifecycle endpoints -----------------------------------------------

    @router.post(
        "/api/preview/{project_id}/start",
        operation_id="previewStart",
        dependencies=[Depends(refresh_lifecycle)],
    )
    async def start(
        project_id: str,
        headers: Dependencies.Headers,
        session: Dependencies.Session,
        config: Dependencies.Config,
    ) -> PreviewStateOut:
        try:
            # DB reads + auth-file reads: off the event loop.
            extra_env = await asyncio.to_thread(
                _subprocess_auth_env, project_id, headers, session, config
            )
            forget_remote_target(project_id)
            state = await registry.start(project_id, extra_env=extra_env)
        except NotReadyError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except ConcurrencyError as e:
            raise HTTPException(status_code=429, detail=str(e))
        return _to_out(state, registry.has_start_script(project_id))

    @router.post("/api/preview/{project_id}/stop", operation_id="previewStop")
    async def stop(project_id: str) -> PreviewStateOut:
        state = await registry.stop(project_id)
        forget_project_rewrites(project_id)
        return _to_out(state, registry.has_start_script(project_id))

    @router.post(
        "/api/preview/{project_id}/restart",
        operation_id="previewRestart",
        dependencies=[Depends(refresh_lifecycle)],
    )
    async def restart(
        project_id: str,
        headers: Dependencies.Headers,
        session: Dependencies.Session,
        config: Dependencies.Config,
    ) -> PreviewStateOut:
        try:
            # DB reads + auth-file reads: off the event loop.
            extra_env = await asyncio.to_thread(
                _subprocess_auth_env, project_id, headers, session, config
            )
            forget_project_rewrites(project_id)
            forget_remote_target(project_id)
            state = await registry.restart(project_id, extra_env=extra_env)
        except NotReadyError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except ConcurrencyError as e:
            raise HTTPException(status_code=429, detail=str(e))
        return _to_out(state, registry.has_start_script(project_id))

    @router.get(
        "/api/preview/{project_id}/state",
        operation_id="previewState",
        dependencies=[Depends(_require_project_read)],
    )
    async def get_state(project_id: str) -> PreviewStateOut:
        state = registry.get(project_id)
        return _to_out(state, registry.has_start_script(project_id))

    @router.post(
        "/api/preview/{project_id}/ping",
        operation_id="previewPing",
        # Ping runs every 60s from the tab — doubles as the token refresh
        # channel for the running preview subprocess in deployed mode. Debounced:
        # the proxy refreshes the same token on the same key while the iframe is live.
        dependencies=[Depends(refresh_keepalive)],
    )
    async def ping(project_id: str) -> dict[str, str]:
        state = registry.get(project_id)
        state.bump_activity()
        return {"ok": "true"}

    @router.post(
        "/api/preview/{project_id}/analyze-logs",
        operation_id="previewAnalyzeLogs",
        response_model=AnalyzeLogsOut,
        # Spends the app's LLM budget: read access at minimum, not just any caller.
        dependencies=[Depends(_require_project_read)],
    )
    async def analyze_logs(
        project_id: str,
        body: AnalyzeLogsIn,
        client: Dependencies.Client,
        config: Dependencies.Config,
    ) -> AnalyzeLogsOut:
        """Mini-LLM judge: scan a window of recent log lines and report any
        real errors that warrant a code fix. Replaces the old regex-based
        `isErrorLine` heuristic which fired on any stderr write (e.g. `npm
        verbose`)."""
        # Verify the project exists; throws if it doesn't.
        registry.get(project_id)

        if not body.lines:
            return AnalyzeLogsOut(errors=[])

        # Format the lines compactly for the LLM. Keep seqs so the model
        # can reference specific spans in its snippets.
        lines_block = "\n".join(
            f"[{ln.seq} {ln.stream}] {ln.text}" for ln in body.lines
        )

        system_prompt = (
            "You are watching live logs from a developer's local app. Decide "
            "whether the lines indicate a real runtime/build error that "
            "requires a code fix.\n\n"
            "ONLY report an error when one of:\n"
            "  (a) the app failed to start (crash, exit code != 0, fatal "
            "config error like missing env var that prevents boot),\n"
            "  (b) a runtime exception occurred during a real operation "
            "(stack trace, unhandled rejection, DB error, HTTP 5xx server "
            "error, type error from user code),\n"
            "  (c) a build/compile failure (TypeScript error, syntax error, "
            "module not found).\n\n"
            "NEVER report as errors:\n"
            "  - `npm verbose`, `npm info`, `npm notice`, npm warning lines\n"
            "  - tsc/tsx watch progress (`Found 0 errors`, `Starting compilation`)\n"
            "  - normal startup chatter (route registration, plugin init, "
            "OAuth token mint, listening on port, ready in Xms)\n"
            "  - logs on stderr that are just status output\n"
            "  - HTTP 4xx (those are client problems, not app bugs)\n"
            "  - dev-mode warnings (e.g. resource-registry 'missing required "
            "resources' warnings; React StrictMode double-render notices)\n"
            "  - SSL/TLS connection retries that eventually succeed\n"
            "  - preview WebSocket/EventSource disconnection noise, e.g. "
            "`[client:preview-unhandledrejection] … WebSocket closed without "
            "opened` or 'WebSocket is closed before the connection is "
            "established'. These are just the preview iframe losing its "
            "connection (navigation, reload, preview stopped) — NOT app bugs, "
            "even though they arrive as an unhandled rejection.\n\n"
            "If the window is mid-flight (an error starts but its stack "
            "trace is cut off), still report it — the agent can fix what's "
            "visible.\n\n"
            "Output JSON ONLY in this shape:\n"
            '{"errors": [{"summary": "<one-line description>", "snippet": '
            '"<the relevant raw log lines, verbatim, joined by newlines>", '
            '"severity": "low" | "medium" | "high"}]}\n\n'
            "Multiple distinct errors in the same window → multiple entries. "
            "Empty list when nothing to fix. Severity: high = app broken / "
            "won't start, medium = recoverable runtime error, low = "
            "diagnostic noise that's still worth a look."
        )

        prompt = (
            f"Analyze these log lines from project {project_id}:\n\n"
            f"```\n{lines_block}\n```"
        )

        llm = LLMService(client, config)
        try:
            # Blocking LLM round trip: off the event loop so other streams keep moving.
            result = await asyncio.to_thread(
                llm.chat_json,
                prompt,
                size=ModelSize.MINI,
                system_prompt=system_prompt,
                max_tokens=2000,
            )
        except Exception as e:
            # Don't fail the request — auto-fix is best-effort. Log + return
            # empty so the UI quietly skips this window.
            logger.warning(f"[analyze-logs] {project_id}: LLM call failed: {e!r}")
            return AnalyzeLogsOut(errors=[])

        raw_errors = result.get("errors", []) if isinstance(result, dict) else []
        parsed: list[DetectedError] = []
        for e in raw_errors:
            if not isinstance(e, dict):
                continue
            summary = str(e.get("summary", "")).strip()
            snippet = str(e.get("snippet", "")).strip()
            severity = str(e.get("severity", "medium")).strip().lower()
            if severity not in {"low", "medium", "high"}:
                severity = "medium"
            if not summary or not snippet:
                continue
            parsed.append(DetectedError(summary=summary, snippet=snippet, severity=severity))
        return AnalyzeLogsOut(errors=parsed)

    # ---- SSE stream: state + logs from a cursor ----------------------------

    @router.get(
        "/api/preview/{project_id}/events",
        dependencies=[Depends(_require_project_read)],
    )
    async def events(project_id: str, since: int = 0, request: Request = None):  # type: ignore[assignment]
        state = registry.get(project_id)

        async def generator():
            # 1) Catch-up snapshot: replay any logs with seq > since.
            for line in state.log_buffer.snapshot_since(since):
                yield _sse("log", _log_json(line))

            # 2) Current state snapshot so reconnects see it immediately.
            yield _sse(
                "state",
                json.dumps(
                    {
                        "status": state.status,
                        "port": state.port,
                        "pid": state.pid,
                        "last_seq": state.log_buffer.last_seq,
                        "has_start_script": registry.has_start_script(project_id),
                    }
                ),
            )

            log_q = state.log_buffer.subscribe()
            state_q = state.subscribe_state()
            log_task = asyncio.create_task(log_q.get())
            state_task = asyncio.create_task(state_q.get())
            try:
                # Track this SSE task so SIGTERM eager-cancel can stop it promptly
                # (it parks on asyncio.wait up to 20s); the finally unregisters +
                # unsubscribes. See services/shutdown.py.
                get_live_connections().register(asyncio.current_task())
                while True:
                    if request is not None and await request.is_disconnected():
                        return
                    # Wait for either a log line or a state change, with a
                    # heartbeat floor of 20s so the connection stays alive.
                    done, _pending = await asyncio.wait(
                        {log_task, state_task},
                        timeout=20,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if not done:
                        yield ": hb\n\n"  # SSE comment — keepalive
                        continue
                    for task in done:
                        result = task.result()
                        if task is log_task:
                            yield _sse("log", _log_json(result))
                            log_task = asyncio.create_task(log_q.get())
                        else:
                            yield _sse(
                                "state",
                                json.dumps(
                                    {
                                        "status": result.status,
                                        "port": result.port,
                                        "pid": result.pid,
                                        "last_seq": state.log_buffer.last_seq,
                                        "has_start_script": registry.has_start_script(
                                            project_id
                                        ),
                                    }
                                ),
                            )
                            state_task = asyncio.create_task(state_q.get())
            except asyncio.CancelledError:
                return
            finally:
                get_live_connections().unregister(asyncio.current_task())
                for task in (log_task, state_task):
                    if not task.done():
                        task.cancel()
                # Await cancellation so tasks finalize instead of being
                # garbage-collected while still pending.
                await asyncio.gather(log_task, state_task, return_exceptions=True)
                state.log_buffer.unsubscribe(log_q)
                state.unsubscribe_state(state_q)

        return StreamingResponse(
            generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    # ---- The proxy ---------------------------------------------------------

    @router.api_route(
        "/preview/{project_id}/{path:path}",
        methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
        # Every iframe request refreshes the token (debounced to once per
        # 30s). Ensures a busy preview stays authenticated even if the UI
        # ping loop stops firing for any reason.
        dependencies=[Depends(refresh_keepalive)],
    )
    async def proxy(
        project_id: str,
        path: str,
        request: Request,
        session: Dependencies.Session,
        config: Dependencies.Config,
    ):
        state = registry.get(project_id)
        if state.status != "ready" or state.port is None:
            return JSONResponse(
                {"error": "preview not running", "status": state.status},
                status_code=503,
            )
        strip = await _strip_user_token(project_id, session, config)
        # Release the DB connection before streaming: the request-scoped session
        # otherwise stays checked out until the proxied response ENDS, and a
        # preview's long-lived SSE/chat streams then pin the whole pool.
        session.close()
        return await proxy_request(request, state, path, strip_user_token=strip)

    # A bare /preview/{project_id} (no trailing slash) hits the app's root "/".
    @router.api_route(
        "/preview/{project_id}",
        methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
        dependencies=[Depends(refresh_keepalive)],
    )
    async def proxy_root(
        project_id: str,
        request: Request,
        session: Dependencies.Session,
        config: Dependencies.Config,
    ):
        state = registry.get(project_id)
        if state.status != "ready" or state.port is None:
            return JSONResponse(
                {"error": "preview not running", "status": state.status},
                status_code=503,
            )
        strip = await _strip_user_token(project_id, session, config)
        # Release the DB connection before streaming: the request-scoped session
        # otherwise stays checked out until the proxied response ENDS, and a
        # preview's long-lived SSE/chat streams then pin the whole pool.
        session.close()
        return await proxy_request(request, state, "", strip_user_token=strip)

    # ---- WebSocket proxy (Vite HMR) ----------------------------------------
    # The shim rewrites `new WebSocket(...)` so ws:// calls land at
    # /preview/<id>/<path> on the parent. Bridge to the child's ws server.
    # Vite uses distinct subprotocols ("vite-hmr", "vite-ping"); the upstream
    # picks which one — we mirror its choice back to the client.
    @router.websocket("/preview/{project_id}/{path:path}")
    async def proxy_ws(ws: WebSocket, project_id: str, path: str):
        state = registry.get(project_id)
        if state.status != "ready" or state.port is None:
            await ws.close(code=1011, reason="preview not running")
            return

        # Vite in middlewareMode opens its HMR WebSocket server on a separate
        # port. start.sh computes it as APP_PORT + 1000 and exports VITE_HMR_PORT
        # so vite.config.ts picks it up. Mirror that formula here so every
        # preview connects to its own HMR server (not the parent Vite's default
        # 24678, which is already claimed by the parent dev server).
        hmr_port = state.port + 1000
        upstream_url = f"ws://127.0.0.1:{hmr_port}/{path}"
        if ws.url.query:
            upstream_url = f"{upstream_url}?{ws.url.query}"

        subprotocols = list(ws.scope.get("subprotocols") or [])

        # IMPORTANT: do NOT forward an Origin header. Vite's HMR server returns
        # HTTP 400 for any WS upgrade that carries Origin (it expects only its
        # own client to connect, and the client sets Origin to "" via the
        # Node-side WebSocket constructor). Connecting without Origin is
        # accepted.
        # Connect upstream FIRST so we know which subprotocol it picked.
        try:
            upstream = await websockets.connect(
                upstream_url,
                subprotocols=subprotocols or None,
                open_timeout=10,
                ping_interval=None,  # don't inject pings; let Vite drive its own
                close_timeout=2,
                max_size=None,
            )
        except Exception:
            # Close without accepting — the client sees a clean refusal.
            try:
                await ws.close(code=1011)
            except Exception:
                pass
            return

        try:
            # Mirror the upstream's chosen subprotocol back to the client.
            chosen = getattr(upstream, "subprotocol", None)
            await ws.accept(subprotocol=chosen)
        except Exception:
            await upstream.close()
            return

        async def client_to_upstream():
            try:
                while True:
                    msg = await ws.receive()
                    if msg["type"] == "websocket.disconnect":
                        return
                    if "text" in msg and msg["text"] is not None:
                        await upstream.send(msg["text"])
                    elif "bytes" in msg and msg["bytes"] is not None:
                        await upstream.send(msg["bytes"])
            except BaseException:
                # Bridge is shutting down; swallow CancelledError + WS errors.
                return

        async def upstream_to_client():
            try:
                async for msg in upstream:
                    if isinstance(msg, bytes):
                        await ws.send_bytes(msg)
                    else:
                        await ws.send_text(msg)
            except BaseException:
                return

        try:
            # Track this WS-bridge task so SIGTERM eager-cancel can stop it (it
            # parks in asyncio.wait on the two relay tasks); the finally closes
            # upstream + client. See services/shutdown.py.
            get_live_connections().register(asyncio.current_task())
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_upstream()),
                    asyncio.create_task(upstream_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
            # Drain both done + pending; swallow CancelledError + any other
            # exception (the bridge is shutting down anyway).
            await asyncio.gather(*done, *pending, return_exceptions=True)
        except asyncio.CancelledError:
            pass
        finally:
            get_live_connections().unregister(asyncio.current_task())
            try:
                await upstream.close()
            except Exception:
                pass
            try:
                await ws.close()
            except Exception:
                pass

    app_or_router.include_router(router)
    return registry


# --- Helpers ------------------------------------------------------------------


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


def _log_json(line: LogLine) -> str:
    return json.dumps({"seq": line.seq, "stream": line.stream, "text": line.text})
