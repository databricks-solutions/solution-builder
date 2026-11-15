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
from ..services.shutdown import get_live_connections
from ..services.skills_manager import get_project_directory
from .projects import (
    ACCESS_VIEWER,
    _get_project_access,
)

router = create_router()

# --- Yjs binary framing (client-authoritative CRDT relay) -------------------
# The Yjs client wraps every frame as: writeVarUint(messageType) + payload.
#   MESSAGE_SYNC(0)      → y-protocols/sync (sub-type: 0=Step1, 1=Step2, 2=Update)
#   MESSAGE_AWARENESS(1) → y-protocols/awareness update
#   MESSAGE_PRESENCE(3)  → our control channel (hello/writer/synced/compact) JSON
#   MESSAGE_COMPACT(4)   → a writer's full-state snapshot: varuint(4) + a raw sync
#                          Update payload that REPLACES the room's log (log bound)
# The server is a dumb relay: it never decodes the CRDT payload, only the leading
# varint(s) to tell a sync UPDATE (log + relay) from the Step1/2 handshake.
MSG_SYNC = 0
MSG_AWARENESS = 1
MSG_PRESENCE = 3
MSG_COMPACT = 4
SYNC_UPDATE = 2  # sync sub-type that mutates the doc (Step1/Step2 are handshake)


def _read_varuint(buf: bytes, pos: int) -> tuple[int, int]:
    """Decode a lib0 varuint at `pos`. Returns (value, next_pos)."""
    num = 0
    shift = 0
    while pos < len(buf):
        b = buf[pos]
        pos += 1
        num |= (b & 0x7F) << shift
        if b < 0x80:
            break
        shift += 7
    return num, pos


def _write_varuint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _presence_frame(payload: dict) -> bytes:
    """Wrap a JSON control message as a MESSAGE_PRESENCE binary frame:
    varuint(3) + varuint(len) + utf8(json) — matching the client's decoder."""
    body = json.dumps(payload).encode("utf-8")
    return _write_varuint(MSG_PRESENCE) + _write_varuint(len(body)) + body


def _is_sync_update(buf: bytes) -> bool:
    """True iff a MESSAGE_SYNC frame carries a doc UPDATE (sub-type 2), i.e. an
    actual edit to log + relay, vs a Step1/Step2 handshake (peer↔server only)."""
    try:
        mtype, pos = _read_varuint(buf, 0)
        if mtype != MSG_SYNC:
            return False
        sub, _ = _read_varuint(buf, pos)
        return sub == SYNC_UPDATE
    except Exception:
        return False


def _frame_message_type(buf: bytes) -> int:
    try:
        mtype, _ = _read_varuint(buf, 0)
        return mtype
    except Exception:
        return -1


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
    def _access() -> str:
        with Session(bind=engine) as session:
            return _get_project_access(
                session, project_id, email, config.template_admin_emails
            )[1]

    try:
        # Off the event loop: under a busy pool this waits up to pool_timeout,
        # and every other stream would freeze with it.
        level = await asyncio.to_thread(_access)
    except Exception:
        await ws.accept()  # accept then close so the client sees a clean 1008
        await ws.close(code=1008, reason="no access")
        return

    role = "viewer" if level == ACCESS_VIEWER else "editor"
    await ws.accept()

    hub = get_collab_hub()
    member = await hub.join(project_id, ws, email=email, name=name, role=role)
    try:
        from ..services.metrics import get_metrics
        get_metrics().bump("collab_ws_connects")
    except Exception:  # noqa: BLE001
        pass

    # Late-join consistency (all binary — the Yjs client reads control messages
    # only on binary MESSAGE_PRESENCE frames): tell the newcomer who they are + who
    # the writer is, replay the room's accumulated Yjs update log so their Y.Doc
    # converges, then send a `synced` frame. A DUMB RELAY has no SyncStep2 from a
    # peer, so `synced` is the explicit "initial state has arrived" signal (an
    # empty log for a cold room → the client seeds the doc from architecture.md).
    who = {"connId": member.conn_id, "email": email, "name": name,
           "role": role, "color": member.color}
    content = _read_architecture(project_id)
    # If DISK drifted from what the room last agreed on (an agent write, or an
    # external edit made while the room held only ghosts that never persisted it),
    # the accumulated Yjs log is stale — drop it so this joiner seeds from the
    # newer file instead of resurrecting the old doc over it (the 'flash then
    # revert' + clobber-back-to-disk bug). No-op for a live, in-sync room.
    if content is not None:
        hub.reconcile_with_disk(project_id, content)
    # Through the hub so this socket's sends stay serialized with the room's
    # broadcasts (a broadcast can reach this member as soon as it joined).
    async def _push(frame: bytes) -> None:
        if not await hub.send_frame(member, frame):
            raise ConnectionError("collab peer send failed during handshake")

    try:
        await _push(_presence_frame({"type": "hello", "you": who}))
        await _push(_presence_frame({"type": "writer", "connId": hub.writer_of(project_id)}))
        for upd in hub.yjs_replay_log(project_id):
            await _push(upd)
        await _push(_presence_frame({"type": "synced"}))
        if content is not None:
            # Seed the room's baseline hash so a later agent write is detected as
            # external (only if not already set by another member / a save).
            hub.note_baseline(project_id, content)
    except Exception:
        await hub.leave(project_id, member.conn_id)
        return

    try:
        # Track this WebSocket task so the SIGTERM handler can cancel it (it parks
        # on ws.receive() up to IDLE_PING_S); the finally below unregisters +
        # hub.leave()s cleanly. See services/shutdown.py.
        get_live_connections().register(asyncio.current_task())
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
        last_sweep = 0.0
        STALE_S = IDLE_PING_S * MAX_MISSED   # a member silent this long is a ghost
        SWEEP_EVERY_S = IDLE_PING_S          # throttle the room sweep

        async def maybe_sweep() -> None:
            """Reap stale members (incl. a ghost WRITER) — throttled, on ANY tick.
            Runs from BOTH the inbound and timeout paths so a room where everyone
            is actively pinging (never times out) still self-heals a ghost writer."""
            nonlocal last_sweep
            now_m = asyncio.get_event_loop().time()
            if now_m - last_sweep < SWEEP_EVERY_S:
                return
            last_sweep = now_m
            try:
                await hub.reap_stale(project_id, STALE_S)
            except Exception:
                pass

        while True:
            try:
                # receive() yields either a TEXT frame (legacy JSON ops + ping) or
                # a BINARY frame (Yjs sync/awareness). One endpoint, both transports.
                event = await asyncio.wait_for(ws.receive(), timeout=IDLE_PING_S)
                missed = 0  # any inbound message (incl. the client's ping) = alive
                hub.touch(project_id, member.conn_id)  # stamp liveness
                await maybe_sweep()
            except asyncio.TimeoutError:
                missed += 1
                if missed >= MAX_MISSED:
                    break  # silent too long → ghost → finally reaps it
                await maybe_sweep()
                if await hub.send_frame(member, '{"type":"ping"}'):
                    continue
                break  # peer gone or stalled → finally reaps it

            if event.get("type") == "websocket.disconnect":
                break

            # --- BINARY frame → Yjs relay (the diagram transport) --------------
            data = event.get("bytes")
            if data is not None:
                mt = _frame_message_type(data)
                if mt == MSG_SYNC:
                    # A doc UPDATE (sub-type 2) mutates the shared doc → log +
                    # relay to peers. Step1/Step2 handshake frames are just relayed
                    # (not logged — they're not doc content).
                    await hub.relay_yjs(project_id, member, data, _is_sync_update(data))
                elif mt == MSG_AWARENESS:
                    await hub.relay_yjs(project_id, member, data, is_sync_update=False)
                elif mt == MSG_COMPACT:
                    # Writer's full-state snapshot (response to a `compact` request):
                    # replace the whole replay log with it + relay to peers. The
                    # payload after the tag is a normal sync Update frame, so a peer
                    # / late joiner applies it exactly like any other update.
                    await hub.compact_yjs_log(project_id, member, data[1:])
                # MSG_PRESENCE / unknown from a client: ignored (server-authored).
                continue

            # --- TEXT frame → the ping/pong liveness channel -------------------
            raw = event.get("text")
            if raw is None:
                continue
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if msg.get("type") == "ping":
                # Reply so the client can VERIFY the socket is truly alive end-to-
                # end (a half-open TCP lets the client's send succeed into the void
                # but never round-trips). No pong within the client's window →
                # client declares the socket dead in seconds, not minutes.
                if not await hub.send_frame(member, '{"type":"pong"}'):
                    break  # peer gone or stalled → finally reaps it
            # unknown types are ignored (forward-compatible).
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"[collab] socket error project={project_id}: {e!r}")
    finally:
        get_live_connections().unregister(asyncio.current_task())
        await hub.leave(project_id, member.conn_id)
        if ws.application_state != WebSocketState.DISCONNECTED:
            try:
                await ws.close()
            except Exception:
                pass
