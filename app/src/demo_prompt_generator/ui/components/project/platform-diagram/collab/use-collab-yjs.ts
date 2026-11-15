/**
 * use-collab-yjs — the Yjs-based client half of live multi-user editing.
 *
 * Replaces the hand-rolled whole-tab-body op transport (use-collab.ts) with a
 * real CRDT: one shared `Y.Doc` per project synced over ONE WebSocket using the
 * standard Yjs SYNC protocol, plus `Awareness` for cursors/presence. Concurrent
 * edits merge conflict-free (per node/edge), so two people dragging different
 * nodes never clobber each other.
 *
 * Wire framing (binary WS frames, y-websocket convention):
 *   frame[0] = MESSAGE_SYNC(0)      → y-protocols/sync encoded message
 *   frame[0] = MESSAGE_AWARENESS(1) → y-protocols/awareness encoded update
 *   frame[0] = MESSAGE_PRESENCE(3)  → JSON roster/writer/hello (our own control
 *                                     channel, kept as UTF-8 JSON after the tag)
 * We ALSO keep a tiny JSON ping/pong on TEXT frames for the same zombie-socket
 * liveness detection the old hook had.
 *
 * The backend is a DUMB RELAY (services/collab.py): it fans out sync/awareness
 * bytes to peers and replays the accumulated sync log to a late joiner. No CRDT
 * on the server. Persistence is client-side: the elected writer snapshots the
 * doc → architecture.md (see platform-diagram.tsx).
 *
 * Gated exactly like the old hook: only mounts when the project is shared and
 * editing (never standalone / read-only), so a solo canvas opens no socket.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { readSyncMessage, writeSyncStep1, writeUpdate } from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { API_BASE_URL } from "@/lib/config";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_PRESENCE = 3; // our control channel (hello/presence/writer/synced/compact) as JSON
const MESSAGE_COMPACT = 4;  // writer → server: full-state snapshot that replaces the replay log

const CURSOR_THROTTLE_MS = 45;

/** A peer (or me) in the room. Mirrors the old CollabMember so collab-cursors +
 *  presence-bar keep working; cursor now comes from Awareness, keyed by clientID. */
export interface CollabMember {
  connId: number;      // == the Yjs awareness clientID
  email: string;
  name: string;
  role: "editor" | "viewer";
  color: string;
  cursor?: { x: number; y: number; sel?: string | null } | null;
}

export interface UseCollabYjsOpts {
  projectId: string;
  enabled: boolean;
  /** The shared doc lives in the parent so it can observe → derive tab bodies.
   *  The hook syncs THIS doc; it never creates its own. */
  ydoc: Y.Doc;
  /** Called once, right after the first sync completes (SyncStep2 applied), so
   *  the parent can seed the doc from architecture.md IFF it's still empty (a
   *  cold room with no peers). */
  onSynced?: (ydoc: Y.Doc) => void;
}

export interface CollabApi {
  connected: boolean;
  synced: boolean;             // initial sync handshake completed
  me: CollabMember | null;
  members: CollabMember[];     // includes me
  isWriter: boolean;
  /** Awareness cursor (flow coords), throttled. */
  sendCursor: (x: number, y: number, sel?: string | null) => void;
}

export function useCollabYjs({ projectId, enabled, ydoc, onSynced }: UseCollabYjsOpts): CollabApi {
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [me, setMe] = useState<CollabMember | null>(null);
  const [members, setMembers] = useState<CollabMember[]>([]);
  const [writerConn, setWriterConn] = useState<number | null>(null);
  // Are WE the elected writer? Compared on the SERVER conn_id (the id space the
  // `writer` frame uses), which is distinct from the awareness clientID that
  // `me.connId` carries for roster identity.
  const [isWriterServer, setIsWriterServer] = useState(false);
  const myServerConnRef = useRef<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef(0);
  const cursorLastSent = useRef(0);
  const cursorPending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSyncedRef = useRef(onSynced); onSyncedRef.current = onSynced;
  const syncedOnceRef = useRef(false);

  // --- binary frame senders ------------------------------------------------
  const sendBinary = useCallback((data: Uint8Array) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch { /* noop */ }
    }
  }, []);

  const sendSync = useCallback((build: (enc: encoding.Encoder) => void) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    build(enc);
    sendBinary(encoding.toUint8Array(enc));
  }, [sendBinary]);

  const broadcastAwareness = useCallback((changedClients: number[]) => {
    const aw = awarenessRef.current;
    if (!aw) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(aw, changedClients));
    sendBinary(encoding.toUint8Array(enc));
  }, [sendBinary]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    closedRef.current = false;
    syncedOnceRef.current = false;

    // One Awareness per connection lifetime, bound to the shared doc.
    const awareness = new Awareness(ydoc);
    awarenessRef.current = awareness;

    // Local doc updates (from THIS client's edits) → broadcast to peers as an
    // incremental sync Update. `origin === ws` marks a remote-applied update so
    // we don't echo it straight back out.
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === wsRef.current) return; // came from the network; don't loop it
      sendSync((enc) => writeUpdate(enc, update));
    };
    ydoc.on("update", onDocUpdate);

    // Awareness changes (our cursor / roster) → broadcast the changed clients.
    const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      broadcastAwareness([...added, ...updated, ...removed]);
      // Re-derive the roster (members) from awareness states.
      refreshMembers(awareness);
    };
    awareness.on("update", onAwareness);

    const refreshMembers = (aw: Awareness) => {
      const list: CollabMember[] = [];
      aw.getStates().forEach((state, clientId) => {
        const u = state.user as Partial<CollabMember> | undefined;
        if (!u) return;
        list.push({
          connId: clientId,
          email: u.email ?? "anonymous",
          name: u.name ?? u.email ?? "anonymous",
          role: (u.role as "editor" | "viewer") ?? "editor",
          color: u.color ?? "#2563eb",
          cursor: (state.cursor as CollabMember["cursor"]) ?? null,
        });
      });
      setMembers(list);
    };

    const connect = () => {
      if (closedRef.current) return;
      const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const wsUrl = base.replace(/^http/, "ws") + `/api/projects/${projectId}/collab`;
      let ws: WebSocket;
      try { ws = new WebSocket(wsUrl); } catch { scheduleReconnect(); return; }
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
        lastPongRef.current = Date.now();
        // Kick off the sync handshake: send our state vector (SyncStep1). The
        // server replies with the diff we're missing (SyncStep2) + its own SV.
        sendSync((enc) => writeSyncStep1(enc, ydoc));
        // Ping/pong liveness (same as the old hook) on a TEXT frame.
        const PING_MS = 8000, PONG_DEADLINE_MS = 12000;
        if (pingTimer.current) clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (Date.now() - lastPongRef.current > PONG_DEADLINE_MS) { try { ws.close(); } catch { /* noop */ } return; }
          if (ws.readyState === WebSocket.OPEN) { try { ws.send('{"type":"ping"}'); } catch { /* noop */ } }
        }, PING_MS);
      };

      ws.onclose = () => {
        setConnected(false);
        setSynced(false);
        wsRef.current = null;
        if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
        if (!closedRef.current) scheduleReconnect();
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };

      ws.onmessage = (ev) => {
        lastPongRef.current = Date.now();
        // TEXT frame → JSON control (pong). Binary → sync/awareness/presence.
        if (typeof ev.data === "string") {
          try { const m = JSON.parse(ev.data); if (m.type === "pong") return; } catch { /* noop */ }
          return;
        }
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        const dec = decoding.createDecoder(bytes);
        const type = decoding.readVarUint(dec);
        if (type === MESSAGE_SYNC) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          // readSyncMessage applies incoming updates to ydoc (origin = ws) and
          // writes any reply into `enc`. In the dumb-relay model the server sends
          // logged Update frames (not a SyncStep2), so "synced" is signaled by an
          // explicit presence frame below, NOT by the sync sub-type.
          readSyncMessage(dec, enc, ydoc, wsRef.current);
          if (encoding.length(enc) > 1) sendBinary(encoding.toUint8Array(enc));
        } else if (type === MESSAGE_AWARENESS) {
          applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), wsRef.current);
          refreshMembers(awareness);
        } else if (type === MESSAGE_PRESENCE) {
          // JSON control channel: hello (who am I + writer election).
          try {
            const text = new TextDecoder().decode(decoding.readVarUint8Array(dec));
            const msg = JSON.parse(text);
            if (msg.type === "hello") {
              const you = msg.you as CollabMember;
              // IMPORTANT: the roster is keyed by the Yjs awareness clientID, so
              // `me.connId` MUST be that clientID (not the server's hello conn_id)
              // — otherwise CollabCursors/PresenceBar can't match "me" and I see
              // my OWN cursor. The server conn_id is kept separately, only for
              // writer election (the `writer` frame carries a server conn_id).
              myServerConnRef.current = you.connId;
              setMe({ ...you, connId: awareness.clientID });
              // Publish my identity into awareness so peers see me in the roster.
              awareness.setLocalStateField("user", {
                email: you.email, name: you.name, role: you.role, color: you.color,
                connId: awareness.clientID,
              });
              refreshMembers(awareness);
            } else if (msg.type === "writer") {
              const w = (msg.connId as number | null) ?? null;
              setWriterConn(w);
              setIsWriterServer(w != null && w === myServerConnRef.current);
            } else if (msg.type === "synced") {
              // Initial state has fully arrived (hello + replay log). Fire once;
              // the consumer inspects the doc itself to decide seed-vs-derive.
              if (!syncedOnceRef.current) {
                syncedOnceRef.current = true;
                setSynced(true);
                onSyncedRef.current?.(ydoc);
              }
            } else if (msg.type === "compact") {
              // The server's replay log grew large; as the writer, send a single
              // full-state snapshot that supersedes it (bounds server memory). The
              // frame is MSG_COMPACT + a normal MSG_SYNC Update payload, so a peer /
              // late joiner applies it like any other update.
              const inner = encoding.createEncoder();
              encoding.writeVarUint(inner, MESSAGE_SYNC);
              writeUpdate(inner, Y.encodeStateAsUpdate(ydoc));
              const outer = encoding.createEncoder();
              encoding.writeVarUint(outer, MESSAGE_COMPACT);
              encoding.writeUint8Array(outer, encoding.toUint8Array(inner));
              sendBinary(encoding.toUint8Array(outer));
            }
          } catch { /* noop */ }
        }
      };
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      attemptRef.current += 1;
      // Full jitter over a growing window: a server restart drops every client
      // at once, so the first retries must spread across seconds, not a 2 s ±30%
      // band. Floor 1 s; window 5 s, 10 s, ... capped at 30 s.
      const ceiling = Math.min(5000 * 2 ** (attemptRef.current - 1), 30000);
      const delay = 1000 + Math.random() * (ceiling - 1000);
      reconnectRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (cursorPending.current) clearTimeout(cursorPending.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      ydoc.off("update", onDocUpdate);
      awareness.off("update", onAwareness);
      // Announce our departure so peers drop our cursor promptly.
      try { removeAwarenessStates(awareness, [awareness.clientID], "unmount"); } catch { /* noop */ }
      awareness.destroy();
      awarenessRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN) { try { ws.close(); } catch { /* noop */ } }
        else if (ws.readyState === WebSocket.CONNECTING) { ws.onopen = () => { try { ws.close(); } catch { /* noop */ } }; }
      }
      setConnected(false); setSynced(false); setMe(null); setMembers([]); setWriterConn(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, ydoc]);

  const sendCursor = useCallback((x: number, y: number, sel?: string | null) => {
    const aw = awarenessRef.current;
    if (!aw) return;
    const now = Date.now();
    const fire = () => { cursorLastSent.current = Date.now(); aw.setLocalStateField("cursor", { x, y, sel: sel ?? null }); };
    if (now - cursorLastSent.current >= CURSOR_THROTTLE_MS) {
      if (cursorPending.current) { clearTimeout(cursorPending.current); cursorPending.current = null; }
      fire();
    } else if (!cursorPending.current) {
      cursorPending.current = setTimeout(() => { cursorPending.current = null; fire(); }, CURSOR_THROTTLE_MS - (now - cursorLastSent.current));
    }
  }, []);

  // Writer = the elected persister (or solo/offline → us, so a lone canvas still
  // persists). A fresh joiner isn't writer until the server's `writer` frame
  // confirms our SERVER conn_id (isWriterServer). writerConn is retained for
  // debugging/telemetry only.
  void writerConn;
  const isWriter = !connected ? true : isWriterServer;

  return { connected, synced, me, members, isWriter, sendCursor };
}
