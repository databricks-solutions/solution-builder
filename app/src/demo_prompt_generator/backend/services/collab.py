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

import asyncio
import hashlib
import itertools
import json
import time
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

from ..core._config import logger


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# Upper bound on one frame send to one member. A socket that can't take a frame in
# this long (full TCP buffer: sleeping laptop, half-open peer; 10 s leaves room for a
# big replay frame on a slow link) is dropped rather
# than stalling every other member and the sender's own receive loop.
SEND_TIMEOUT_S = 10.0


# MESSAGE_PRESENCE(3): our JSON control channel inside the Yjs binary framing —
# varuint(3) + varuint(len) + utf8(json). Kept in sync with routes/collab.py's
# decoder + the client's use-collab-yjs.ts reader.
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
    body = json.dumps(payload).encode("utf-8")
    return _write_varuint(3) + _write_varuint(len(body)) + body

# The Yjs replay-log byte budget. When a room's accumulated update log exceeds
# this, the server asks the elected writer for one full-state snapshot that
# replaces the whole log (bounding memory on a long-lived busy room). ~512 KB is
# generous for a diagram doc while capping worst-case growth.
YJS_LOG_MAX_BYTES = 512 * 1024

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
    # Serializes every send to THIS socket: concurrent ws sends can interleave or
    # reorder frames. Held for one bounded send only (see CollabHub.send_frame).
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    # Set when a send failed or stalled; the next fan-out removes the member.
    dropped: bool = False
    # Monotonic time of the last INBOUND frame from this member (any message,
    # incl. the client's ~8s ping). A dead/half-open client sends nothing, so a
    # stale last_seen is the reliable liveness signal used to reap ghosts — even
    # the elected WRITER, which otherwise could hold the role forever if its own
    # request coroutine exited without a clean leave(). See reap_stale().
    last_seen: float = field(default_factory=time.monotonic)


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
        # conn_id of the member elected to PERSIST architecture.md. Exactly one
        # editor holds it; everyone else applies edits but never writes. Re-elected
        # on leave. None when the room has no editor (all viewers / empty).
        self.writer_conn: Optional[int] = None
        # The server holds NO CRDT — it fans out opaque Yjs `sync`/`awareness` byte
        # frames to peers and keeps every `sync Update` it relayed in this log so a
        # LATE JOINER can be replayed them and converge (Yjs merges idempotently).
        # BOUNDED: when it exceeds YJS_LOG_MAX_BYTES we ask the writer for a single
        # full-state snapshot that REPLACES the log (see compact_yjs_log). Cleared
        # on an agent takeover (doc rebuilt from disk → prior updates are stale).
        self.yjs_updates: list[bytes] = []
        self.yjs_log_bytes: int = 0
        # Byte size at which we last SENT a compaction request (-1 = never). We
        # re-request once the log grows another YJS_LOG_MAX_BYTES beyond this, so a
        # writer that CRASHED/ignored a request (a permanent boolean gate would let
        # the log grow unbounded forever) is retried — and a re-elected writer gets
        # asked again. Reset to -1 on log clear / writer change.
        self.compact_requested_bytes: int = -1

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
        # Roster/cursors are carried by Yjs Awareness (peer-to-peer via the relay),
        # so the server only announces the elected persistence WRITER.
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
            self._reelect_writer(room)
            await self._announce_writer(room)
        if not room.members:
            # Empty room — drop it so the hub doesn't leak rooms forever.
            self._rooms.pop(project_id, None)

    def _reelect_writer(self, room: CollabRoom) -> None:
        """Pick the first live editor as writer (None if the room has no editor).
        Caller announces. Kept tiny + pure so leave() and reap_stale() share it."""
        room.writer_conn = next(
            (m.conn_id for m in room.members.values() if m.role == "editor"),
            None,
        )
        # A new writer should be re-asked to compact if the log is still over budget
        # (the old writer may have crashed mid-request). Clearing the marker makes
        # the next relayed update re-trigger the request against the new writer.
        room.compact_requested_bytes = -1

    def touch(self, project_id: str, conn_id: int) -> None:
        """Stamp a member's liveness on any inbound frame (called by the WS loop)."""
        room = self._rooms.get(project_id)
        if room:
            m = room.members.get(conn_id)
            if m:
                m.last_seen = time.monotonic()

    async def reap_stale(self, project_id: str, max_idle_s: float) -> None:
        """Drop members that haven't sent anything for `max_idle_s` (dead/half-open
        sockets whose own request coroutine didn't clean up), and re-elect the
        writer if a stale one was removed. Any live client's WS loop calls this
        (throttled) on both its inbound and idle ticks, so a ghost — even the
        elected WRITER — can never hold the room hostage: it's swept within one
        sweep window regardless of whether its own coroutine ever runs `leave`.
        Fixes the 'stale writer, nobody persists' hang.

        SECONDARY to the client save-watchdog: that watchdog already persists a
        survivor's edits in ~4s regardless of who the server thinks the writer is,
        so this ~60s re-election is room hygiene (restore the single-writer happy
        path), NOT the durability guarantee — durability never waits on it."""
        room = self._rooms.get(project_id)
        if not room:
            return
        cutoff = time.monotonic() - max_idle_s
        stale = [cid for cid, m in room.members.items() if m.last_seen < cutoff]
        if not stale:
            return
        writer_was_stale = room.writer_conn in stale
        for cid in stale:
            room.members.pop(cid, None)
        if writer_was_stale:
            self._reelect_writer(room)
            await self._announce_writer(room)
        if not room.members:
            self._rooms.pop(project_id, None)

    # -- fan-out ------------------------------------------------------------

    async def send_frame(self, member: Member, data: bytes | str) -> bool:
        """Send ONE frame (binary Yjs/presence, or a text ping/pong) to one member.
        Serialized with every other send to that socket and bounded by
        SEND_TIMEOUT_S. A failed or stalled send marks the member dropped (the next
        fan-out removes it, re-electing the writer if needed) and returns False.
        Routes use this for their own replies too, so a socket never has two
        concurrent sends."""
        if member.dropped:
            return False
        async with member.send_lock:
            try:
                send = (
                    member.ws.send_bytes(data)
                    if isinstance(data, bytes)
                    else member.ws.send_text(data)
                )
                await asyncio.wait_for(send, timeout=SEND_TIMEOUT_S)
                return True
            except Exception:  # includes TimeoutError
                member.dropped = True
                return False

    async def _close_dropped(self, member: Member) -> None:
        """Close a socket we dropped so its client sees the close and reconnects.
        Bounded: closing a stalled socket can block on the same full buffer."""
        try:
            await asyncio.wait_for(member.ws.close(), timeout=SEND_TIMEOUT_S)
        except Exception:
            pass

    async def broadcast_bytes(
        self, project_id: str, data: bytes, exclude: Optional[int] = None
    ) -> None:
        """Fan out a raw binary frame to every member except the origin. Sends run
        concurrently across members (one slow socket can't serialize the rest), each
        bounded and ordered per member by send_frame. A member whose send fails or
        stalls is removed via leave() (roster + writer stay correct) and closed."""
        room = self._rooms.get(project_id)
        if not room:
            return
        targets = [m for cid, m in list(room.members.items()) if cid != exclude]
        results = await asyncio.gather(*(self.send_frame(m, data) for m in targets))
        dead = [m for m, ok in zip(targets, results) if not ok]
        for member in dead:
            await self.leave(project_id, member.conn_id)
        if dead:
            await asyncio.gather(*(self._close_dropped(m) for m in dead))

    async def relay_yjs(
        self, project_id: str, member: Member, data: bytes, is_sync_update: bool
    ) -> None:
        """Relay one Yjs binary frame (sync or awareness) to peers. Viewers can't
        edit — their SYNC frames are dropped (they may still receive). A sync
        UPDATE is appended to the room log so a late joiner can be replayed it.
        (SyncStep1/2 handshake frames are peer↔server and NOT logged/relayed.)"""
        room = self._rooms.get(project_id)
        if not room:
            return
        if is_sync_update:
            if member.role != "editor":
                return  # a viewer can't mutate the doc
            room.yjs_updates.append(data)
            room.yjs_log_bytes += len(data)
            # Bound the replay log: it accumulates every edit for the room's life
            # (a late joiner replays it to converge). Without a bound a long-lived
            # busy room grows unboundedly. When it crosses the byte budget, ask the
            # WRITER for a single full-state snapshot that supersedes the whole log
            # (Yjs `encodeStateAsUpdate` — see the client's `compact` handler); the
            # incoming MSG_COMPACT frame REPLACES the log. Re-request only once per
            # additional YJS_LOG_MAX_BYTES of growth beyond the last request, so we
            # don't spam the writer per-update but DO retry if a prior request went
            # unanswered (writer crashed/ignored) — the log can't grow unbounded.
            over = room.yjs_log_bytes > YJS_LOG_MAX_BYTES
            grewSinceRequest = room.yjs_log_bytes - room.compact_requested_bytes > YJS_LOG_MAX_BYTES
            if over and grewSinceRequest and room.writer_conn is not None:
                room.compact_requested_bytes = room.yjs_log_bytes
                writer = room.members.get(room.writer_conn)
                if writer is not None:
                    await self.send_frame(writer, _presence_frame({"type": "compact"}))
        await self.broadcast_bytes(project_id, data, exclude=member.conn_id)

    async def compact_yjs_log(self, project_id: str, member: Member, snapshot: bytes) -> None:
        """The writer sent a full-state snapshot (MSG_COMPACT) in response to a
        `compact` request. Replace the whole update log with just this frame — it
        encodes the entire doc, so a late joiner replaying only it still converges.
        Relay it to peers too (idempotent — merges to a no-op on an up-to-date
        doc). Only the elected writer may compact."""
        room = self._rooms.get(project_id)
        if not room or member.conn_id != room.writer_conn:
            return
        room.yjs_updates = [snapshot]
        room.yjs_log_bytes = len(snapshot)
        room.compact_requested_bytes = -1
        await self.broadcast_bytes(project_id, snapshot, exclude=member.conn_id)

    def reconcile_with_disk(self, project_id: str, content: str) -> None:
        """Before a fresh joiner is replayed the room's Yjs log, make DISK
        authoritative if it drifted out-of-band.

        The room's `known_hash` tracks the content the room last agreed on (the
        writer's own save, or an agent-takeover snapshot we broadcast). If the
        current on-disk `architecture.md` no longer matches it, the file changed
        WHILE the room's log stopped tracking it — an agent write, or (the dev
        footgun) an external edit made while the only members were half-open
        ghosts that never persisted it. In that case the accumulated Yjs log
        describes a STALE doc: replaying it to the newcomer would resurrect the
        old content over the newer file (the 'flash then revert', and then the
        newcomer-as-writer persists the stale doc back over disk). So drop the
        log and re-baseline to disk — the joiner then seeds its doc from
        `architecture.md` (an empty replay log → the client's cold-seed path).

        A no-op when the room is empty/absent (a truly cold room seeds from disk
        anyway) or when disk already matches `known_hash` (a live writer keeps
        the two in lockstep, so normal collaborative editing is untouched)."""
        room = self._rooms.get(project_id)
        if not room:
            return
        h = _hash(content)
        if room.known_hash is not None and h != room.known_hash:
            room.yjs_updates.clear()
            room.yjs_log_bytes = 0
            room.compact_requested_bytes = -1
            room.known_hash = h
            logger.debug(
                f"[collab] join reconcile: disk drifted from room for project "
                f"{project_id} — cleared stale log ({len(content)} chars); "
                f"joiner seeds from disk"
            )

    def yjs_replay_log(self, project_id: str) -> list[bytes]:
        """The accumulated sync-update frames to replay to a fresh joiner so their
        Yjs doc converges to the room's current state."""
        room = self._rooms.get(project_id)
        return list(room.yjs_updates) if room else []

    def writer_of(self, project_id: str) -> Optional[int]:
        """conn_id of the room's elected persistence writer (None if none)."""
        room = self._rooms.get(project_id)
        return room.writer_conn if room else None


    async def _announce_writer(self, room: CollabRoom) -> None:
        # Which member persists architecture.md. Binary presence framing — the Yjs
        # client reads control messages only on binary frames. (The roster itself
        # is carried by Yjs Awareness, not a server presence frame.)
        await self.broadcast_bytes(
            room.project_id, _presence_frame({"type": "writer", "connId": room.writer_conn})
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
        # Yjs relay: every client rebuilds its doc from disk (the file_changed SSE
        # → re-fetch → rehydrate path on the client), so the accumulated update log
        # now describes a STALE doc. Clear it — a late joiner during/after the
        # takeover gets the fresh baseline from architecture.md + the post-rehydrate
        # updates, never the pre-takeover ones (which could resurrect deleted
        # content). The clear is the last statement before returning (no await
        # after it), so a peer update relayed on the same event loop can't slip
        # into the just-cleared log before this returns.
        room.yjs_updates.clear()
        room.yjs_log_bytes = 0
        room.compact_requested_bytes = -1
        logger.debug(
            f"[collab] external (agent) write to project {project_id} — cleared "
            f"update log for {len(room.members)} member(s) ({len(content)} chars); "
            f"clients rehydrate from disk"
        )
        return True


def get_collab_hub() -> CollabHub:
    """Singleton accessor (mirrors get_stream_manager)."""
    return CollabHub.get_instance()
