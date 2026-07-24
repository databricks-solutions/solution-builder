"""WebSocket endpoint for live multi-user architecture editing.

``/api/projects/{id}/collab`` — one socket per open Architecture tab. Auth mirrors
the HTTP routes (owner/admin/editor = edit, accepted-viewer = presence-only,
anyone else = 404-equivalent close). Identity comes from the same
``X-Forwarded-Email`` / ``-Preferred-Username`` headers HTTP uses. All the room
logic lives in ``services.collab.CollabHub``; this file is just the socket
plumbing: accept → auth → join → send initial snapshot → relay loop → leave.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import WebSocket, WebSocketDisconnect
from sqlmodel import Session
from starlette.websockets import WebSocketState

from ..core import create_router
from ..core._config import logger
from ..services.collab import get_collab_hub
from ..services.skills_manager import get_project_directory
from .projects import (
    ACCESS_VIEWER,
    _get_project_access,
)

router = create_router()

# Idle window per receive before the server probes a silent socket with a ping.
# The client pings every ~20s, so a live tab always beats this.
IDLE_PING_S = 30.0
# Consecutive idle windows (≈ IDLE_PING_S each) of TOTAL silence before a socket
# is declared a ghost and reaped. 2 → ~60s, comfortably past the client's 20s
# heartbeat so a live-but-idle tab is never wrongly dropped.
MAX_MISSED = 2


def _ws_identity(ws: WebSocket) -> tuple[str, str]:
    """(email, display_name) for a WS connection, from the Databricks Apps
    forwarded headers — same source as the HTTP `Headers` dependency. Falls back
    to the dev SDK user, then anonymous, so local dev still identifies you."""
    h = ws.headers
    email = h.get("x-forwarded-email") or h.get("x-forwarded-user")
    name = h.get("x-forwarded-preferred-username") or email
    if not email:
        try:
            from ..core._headers import _get_dev_user_email
            email = _get_dev_user_email() or "anonymous@local"
        except Exception:
            email = "anonymous@local"
        name = name or email
    return email, (name or email)


def _read_architecture(project_id: str) -> str | None:
    """Current architecture.md content from disk, or None if absent."""
    try:
        p = get_project_directory(project_id) / "architecture.md"
        return p.read_text(encoding="utf-8") if p.exists() else None
    except Exception:
        return None


@router.websocket("/projects/{project_id}/collab")
async def collab_ws(ws: WebSocket, project_id: str) -> None:
    email, name = _ws_identity(ws)

    # Authorize BEFORE accepting: resolve the caller's access to this project.
    # Owner/admin/editor → can edit; accepted viewer → presence only; no access
    # → close (don't leak project existence). One short DB round-trip.
    engine = ws.app.state.engine
    config = ws.app.state.config
    try:
        with Session(bind=engine) as session:
            _project, level = _get_project_access(
                session, project_id, email, config.template_admin_emails
            )
    except Exception:
        await ws.accept()  # accept then close so the client sees a clean 1008
        await ws.close(code=1008, reason="no access")
        return

    role = "viewer" if level == ACCESS_VIEWER else "editor"
    await ws.accept()

    hub = get_collab_hub()
    member = await hub.join(project_id, ws, email=email, name=name, role=role)

    # Late-join consistency: hand the newcomer the current document + who they
    # are + who the writer is, so they render in sync before any op arrives.
    content = _read_architecture(project_id)
    try:
        await ws.send_text(json.dumps({
            "type": "hello",
            "you": {"connId": member.conn_id, "email": email, "name": name,
                    "role": role, "color": member.color},
        }))
        if content is not None:
            # Seed the room's baseline hash so a later agent write is detected as
            # external (only if not already set by another member / a save).
            hub.note_baseline(project_id, content)
            await ws.send_text(json.dumps({
                "type": "snapshot", "source": "init", "content": content,
            }))
    except Exception:
        await hub.leave(project_id, member.conn_id)
        return

    try:
        # Liveness / ghost reaping. A client that vanishes without a close
        # (laptop sleep, network drop, a dev HMR reload that didn't clean up)
        # would otherwise linger in the room forever, inflating the member count.
        # The client sends a `ping` every ~20s, so a LIVE tab always delivers a
        # message inside IDLE_PING_S. We bound each receive; a timeout counts as a
        # missed heartbeat. After MAX_MISSED consecutive misses (~60s of total
        # silence) we declare the socket dead and reap it — this catches a
        # half-open TCP where send_text() silently succeeds into the void and
        # would otherwise never error. A ping probe is still sent on each timeout
        # (a send failure reaps immediately).
        missed = 0
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=IDLE_PING_S)
                missed = 0  # any inbound message (incl. the client's ping) = alive
            except asyncio.TimeoutError:
                missed += 1
                if missed >= MAX_MISSED:
                    break  # silent too long → ghost → finally reaps it
                try:
                    await ws.send_text('{"type":"ping"}')
                    continue
                except Exception:
                    break  # peer gone → finally reaps it
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            mtype = msg.get("type")
            if mtype == "cursor":
                await hub.on_cursor(project_id, member, msg)
            elif mtype == "op":
                await hub.on_op(project_id, member, msg)
            # "ping"/unknown types are ignored (liveness + forward-compatible).
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"[collab] socket error project={project_id}: {e!r}")
    finally:
        await hub.leave(project_id, member.conn_id)
        if ws.application_state != WebSocketState.DISCONNECTED:
            try:
                await ws.close()
            except Exception:
                pass
