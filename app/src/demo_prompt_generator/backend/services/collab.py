"""Live multi-user collaboration for the architecture canvas.

One in-process ``CollabHub`` holds a ``CollabRoom`` per project. Every browser
that opens a shared project's Architecture tab connects a WebSocket to
``/api/projects/{id}/collab`` and joins that room. The room relays three kinds
of small JSON frames between members:

  * ``presence`` — who's here (roster), joins/leaves, per-user color + role.
  * ``cursor``   — a member's live pointer position (in FLOW coordinates, so it
                   maps correctly regardless of each viewer's zoom/pan).
  * ``op``       — a diagram edit (node/edge/tab upsert or delete). Applied by
                   peers to their live graph WITHOUT a full re-parse; per-object
                   last-writer-wins, ordered by a room-monotonic ``seq``.

Plus two coordinated whole-document events:

  * ``snapshot`` — the full ``architecture.md`` content. Sent to a late joiner
                   so they start consistent, and broadcast with
                   ``source:"agent"`` when the AI agent rewrites the file (the
                   agent "takes over": everyone hard-reseeds from it).
  * ``writer``   — which member is the elected persistence writer (the only one
                   that saves ``architecture.md``; everyone else just applies
                   ops). Re-elected when that member leaves.

WHY IN-PROCESS: the app runs as a single Databricks Apps replica with Lakebase
as the durable store and no external broker, exactly like ``ActiveStreamManager``.
The hub is deliberately behind a tiny surface so a future multi-replica story
could swap in Postgres LISTEN/NOTIFY without touching callers. Nothing here is
durable — ``architecture.md`` (DB-backed) remains the source of truth; the room
is ephemeral coordination on top of it.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import WebSocket

from ..core._config import logger


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()

# Stable, high-contrast palette assigned round-robin to members so each
# collaborator gets a consistent cursor/avatar color within a session.
_COLORS = [
    "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c",
    "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#0d9488",
]


@dataclass
class Member:
    """One connected browser in a room."""
    conn_id: int
    email: str
    name: str
    role: str  # "editor" | "viewer" (owners/admins map to editor)
    color: str
    ws: WebSocket
    # Last known cursor, kept so a late joiner gets everyone's current position
    # in the initial roster instead of waiting for the next mouse move.
    cursor: Optional[dict[str, Any]] = None

    def public(self) -> dict[str, Any]:
        """The roster-safe view (no ws handle)."""
        return {
            "connId": self.conn_id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "color": self.color,
            "cursor": self.cursor,
        }


class CollabRoom:
    """All members editing one project's architecture, + the shared op counter
    and the elected persistence writer."""

    def __init__(self, project_id: str) -> None:
        self.project_id = project_id
        self.members: dict[int, Member] = {}
        # Hash of the architecture.md content the room already knows about — set
        # when a client tells us it just persisted (its own save), or when we
        # broadcast an agent snapshot. Used to tell an AGENT write apart from the
        # room writer's own save in the file-watcher hook: a disk change whose
        # hash matches this is the writer's echo (skip); a different hash is an
        # external writer = the agent (broadcast a takeover snapshot).
        self.known_hash: Optional[str] = None
        # Room-monotonic sequence stamped on every op so peers can apply them in
        # a total order (per-object last-writer-wins by seq).
        self._seq = itertools.count(1)
        # conn_id of the member elected to PERSIST architecture.md. Exactly one
        # editor holds it; everyone else applies ops but never writes. Re-elected
        # on leave. None when the room has no editor (all viewers / empty).
        self.writer_conn: Optional[int] = None

    def next_seq(self) -> int:
        return next(self._seq)

    def color_for(self, index: int) -> str:
        return _COLORS[index % len(_COLORS)]


class CollabHub:
    """Process-wide registry of rooms. Singleton, like ActiveStreamManager."""

    _instance: Optional["CollabHub"] = None

    def __init__(self) -> None:
        self._rooms: dict[str, CollabRoom] = {}
        self._conn_ids = itertools.count(1)

    @classmethod
    def get_instance(cls) -> "CollabHub":
        if cls._instance is None:
            cls._instance = CollabHub()
        return cls._instance

    def _room(self, project_id: str) -> CollabRoom:
        room = self._rooms.get(project_id)
        if room is None:
            room = CollabRoom(project_id)
            self._rooms[project_id] = room
        return room

    def has_room(self, project_id: str) -> bool:
        room = self._rooms.get(project_id)
        return bool(room and room.members)

    # -- membership ---------------------------------------------------------

    async def join(
        self, project_id: str, ws: WebSocket, email: str, name: str, role: str
    ) -> Member:
        """Register a freshly-accepted WebSocket as a room member and return it.
        Assigns a color, elects a writer if none, and announces the new roster."""
        room = self._room(project_id)
        conn_id = next(self._conn_ids)
        member = Member(
            conn_id=conn_id,
            email=email,
            name=name,
            role=role,
            color=room.color_for(len(room.members)),
            ws=ws,
        )
        room.members[conn_id] = member
        # Elect this member as writer if the room has no (live) editor writer.
        if role == "editor" and room.writer_conn is None:
            room.writer_conn = conn_id
        await self._announce_presence(room)
        await self._announce_writer(room)
        return member

    async def leave(self, project_id: str, conn_id: int) -> None:
        room = self._rooms.get(project_id)
        if not room:
            return
        member = room.members.pop(conn_id, None)
        if member is None:
            return
        # Re-elect a writer if the departing member held it.
        if room.writer_conn == conn_id:
            room.writer_conn = next(
                (m.conn_id for m in room.members.values() if m.role == "editor"),
                None,
            )
            await self._announce_writer(room)
        if room.members:
            await self._announce_presence(room)
        else:
            # Empty room — drop it so the hub doesn't leak rooms forever.
            self._rooms.pop(project_id, None)

    # -- fan-out ------------------------------------------------------------

    async def _send(self, member: Member, frame: dict[str, Any]) -> bool:
        """Best-effort send to one member. Returns False if the socket is dead
        (the caller reaps it)."""
        try:
            await member.ws.send_text(json.dumps(frame))
            return True
        except Exception:
            return False

    async def broadcast(
        self, project_id: str, frame: dict[str, Any], exclude: Optional[int] = None
    ) -> None:
        """Send a frame to every member except ``exclude`` (the origin). Reaps
        any socket that errors."""
        room = self._rooms.get(project_id)
        if not room:
            return
        dead: list[int] = []
        for conn_id, member in list(room.members.items()):
            if conn_id == exclude:
                continue
            ok = await self._send(member, frame)
            if not ok:
                dead.append(conn_id)
        for conn_id in dead:
            await self.leave(project_id, conn_id)

    async def _announce_presence(self, room: CollabRoom) -> None:
        roster = [m.public() for m in room.members.values()]
        await self.broadcast(room.project_id, {"type": "presence", "members": roster})

    async def _announce_writer(self, room: CollabRoom) -> None:
        await self.broadcast(
            room.project_id, {"type": "writer", "connId": room.writer_conn}
        )

    # -- message handling ---------------------------------------------------

    async def on_cursor(self, project_id: str, member: Member, payload: dict) -> None:
        """Relay a member's cursor to everyone else (in FLOW coords)."""
        cur = {
            "x": payload.get("x"),
            "y": payload.get("y"),
            "sel": payload.get("sel"),  # optional selected node id
        }
        member.cursor = cur
        await self.broadcast(
            project_id,
            {"type": "cursor", "connId": member.conn_id, "cursor": cur},
            exclude=member.conn_id,
        )

    async def on_op(self, project_id: str, member: Member, payload: dict) -> None:
        """Relay a diagram edit op to everyone else, stamped with a room seq so
        peers apply per-object last-writer-wins in a total order. Viewers can't
        edit — their ops are dropped."""
        if member.role != "editor":
            return
        room = self._rooms.get(project_id)
        if not room:
            return
        op = dict(payload.get("op") or {})
        op["seq"] = room.next_seq()
        op["by"] = member.conn_id
        await self.broadcast(
            project_id,
            {"type": "op", "op": op},
            exclude=member.conn_id,
        )

    def note_baseline(self, project_id: str, content: str) -> None:
        """Seed the room's known content hash from the on-disk baseline the FIRST
        time a member joins — only if unset, so it never clobbers a live writer's
        or a fresher agent snapshot's hash."""
        room = self._rooms.get(project_id)
        if room and room.known_hash is None:
            room.known_hash = _hash(content)

    def note_saved(self, project_id: str, content: str) -> None:
        """Record the content a member just PERSISTED (the room writer's save),
        so the file-watcher hook recognizes the resulting disk change as our own
        echo and does NOT re-broadcast it as an agent takeover."""
        room = self._rooms.get(project_id)
        if room:
            room.known_hash = _hash(content)

    async def maybe_broadcast_external_write(self, project_id: str, content: str) -> bool:
        """The file-watcher saw architecture.md change on disk. If the content
        matches what the room already knows (the writer's own save, or a snapshot
        we already sent), it's an echo — skip. Otherwise an EXTERNAL writer (the
        AI agent) changed it: broadcast a takeover snapshot so every client
        hard-reseeds. Returns True iff a snapshot was broadcast."""
        room = self._rooms.get(project_id)
        if not room or not room.members:
            return False
        # Read-modify-write of known_hash is done with NO await in between, so on
        # the single asyncio event loop it's atomic vs. another file-watcher event
        # (two events can't interleave the check + update). The broadcast await
        # happens only AFTER known_hash is committed.
        h = _hash(content)
        if room.known_hash is None:
            # First time the room learns the on-disk content (baseline) — seed
            # it, don't treat it as a takeover.
            room.known_hash = h
            return False
        if h == room.known_hash:
            return False  # our own save echoing back — ignore
        room.known_hash = h
        seq = room.next_seq()
        logger.debug(
            f"[collab] external (agent) write to project {project_id} — snapshot "
            f"to {len(room.members)} member(s) (seq={seq}, {len(content)} chars)"
        )
        await self.broadcast(
            project_id,
            {"type": "snapshot", "source": "agent", "seq": seq, "content": content},
        )
        return True


def get_collab_hub() -> CollabHub:
    """Singleton accessor (mirrors get_stream_manager)."""
    return CollabHub.get_instance()
