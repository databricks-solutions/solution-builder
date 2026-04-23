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
from pathlib import Path
from typing import Any, Callable

import websockets
from fastapi import APIRouter, FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .logbuffer import LogLine
from .proxy import proxy_request
from .registry import (
    ConcurrencyError,
    NotReadyError,
    PreviewRegistry,
    PreviewState,
    Status,
)
from ..core import Dependencies
from ..core.auth import (
    detect_mode,
    make_project_auth_refresher,
    subprocess_auth_env,
)
from ..models import User
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
    ) -> dict[str, str]:
        """Build the Databricks auth env for the preview subprocess.

        Thin wrapper around core.auth.subprocess_auth_env — resolves the
        local-mode profile from the single User row (same pattern as the
        agent route). See backend/AUTH.md.
        """
        mode = detect_mode(headers)
        local_profile: str | None = None
        if mode == "local":
            user = session.exec(select(User).limit(1)).first()
            local_profile = user.databricks_profile if user else None
        return subprocess_auth_env(
            get_project_dir(project_id),
            mode=mode,
            local_profile=local_profile,
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
    ) -> PreviewStateOut:
        try:
            extra_env = _subprocess_auth_env(project_id, headers, session)
            state = await registry.start(project_id, extra_env=extra_env)
        except NotReadyError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except ConcurrencyError as e:
            raise HTTPException(status_code=429, detail=str(e))
        return _to_out(state, registry.has_start_script(project_id))

    @router.post("/api/preview/{project_id}/stop", operation_id="previewStop")
    async def stop(project_id: str) -> PreviewStateOut:
        state = await registry.stop(project_id)
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
    ) -> PreviewStateOut:
        try:
            extra_env = _subprocess_auth_env(project_id, headers, session)
            state = await registry.restart(project_id, extra_env=extra_env)
        except NotReadyError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except ConcurrencyError as e:
            raise HTTPException(status_code=429, detail=str(e))
        return _to_out(state, registry.has_start_script(project_id))

    @router.get("/api/preview/{project_id}/state", operation_id="previewState")
    async def get_state(project_id: str) -> PreviewStateOut:
        state = registry.get(project_id)
        return _to_out(state, registry.has_start_script(project_id))

    @router.post(
        "/api/preview/{project_id}/ping",
        operation_id="previewPing",
        # Ping runs every 60s from the tab — doubles as the token refresh
        # channel for the running preview subprocess in deployed mode.
        dependencies=[Depends(refresh_lifecycle)],
    )
    async def ping(project_id: str) -> dict[str, str]:
        state = registry.get(project_id)
        state.bump_activity()
        return {"ok": "true"}

    # ---- SSE stream: state + logs from a cursor ----------------------------

    @router.get("/api/preview/{project_id}/events")
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
    async def proxy(project_id: str, path: str, request: Request):
        state = registry.get(project_id)
        if state.status != "ready" or state.port is None:
            return JSONResponse(
                {"error": "preview not running", "status": state.status},
                status_code=503,
            )
        return await proxy_request(request, state, path)

    # A bare /preview/{project_id} (no trailing slash) hits the app's root "/".
    @router.api_route(
        "/preview/{project_id}",
        methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
        dependencies=[Depends(refresh_keepalive)],
    )
    async def proxy_root(project_id: str, request: Request):
        state = registry.get(project_id)
        if state.status != "ready" or state.port is None:
            return JSONResponse(
                {"error": "preview not running", "status": state.status},
                status_code=503,
            )
        return await proxy_request(request, state, "")

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
        # port (default 24678), NOT on the main HTTP port. So forward WS
        # upgrades to that port instead of state.port. With one preview
        # running at a time this is unambiguous; if we ever support concurrent
        # previews here, the template needs to set `server.hmr.port` per app.
        VITE_HMR_PORT = 24678
        upstream_url = f"ws://127.0.0.1:{VITE_HMR_PORT}/{path}"
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
