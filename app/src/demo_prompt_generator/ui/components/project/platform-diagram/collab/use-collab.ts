/**
 * use-collab — the client half of live multi-user architecture editing.
 *
 * Opens ONE WebSocket to `/api/projects/{id}/collab`, keeps the presence roster,
 * relays this tab's cursor, and surfaces incoming frames (peer cursors, edit
 * ops, and agent/init snapshots) to the canvas via callbacks. Auto-reconnects
 * with backoff. When the project isn't shared (single user) the hook stays inert
 * — no socket is opened.
 *
 * Wire protocol (JSON frames) mirrors services/collab.py:
 *   ← hello {you}                        first frame; who we are + our color
 *   ← presence {members[]}               roster (join/leave)
 *   ← writer {connId}                    who persists architecture.md
 *   ← cursor {connId, cursor}            a peer moved
 *   ← op {op}                            a peer edit (seq/by stamped by server)
 *   ← snapshot {source, content, seq}    full doc (init | agent takeover)
 *   → cursor {x,y,sel}                   our pointer (flow coords)
 *   → op {op}                            our edit
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/config";

export interface CollabMember {
  connId: number;
  email: string;
  name: string;
  role: "editor" | "viewer";
  color: string;
  cursor?: { x: number; y: number; sel?: string | null } | null;
}

/** A diagram edit relayed between peers. `state` carries a whole tab body
 *  (the serialized single-architecture JSON) — coarse but reuses the existing
 *  serialize path and merges per-object on receive. `kind` leaves room for
 *  finer ops later without changing the transport. */
export interface CollabOp {
  kind: "state";
  tab: number;         // which diagram tab this state belongs to
  body: string;        // serialized single-architecture JSON (```json fence)
  seq?: number;        // server-stamped total order
  by?: number;         // origin connId
}

export interface CollabSnapshot {
  source: "init" | "agent";
  content: string;     // full architecture.md
  seq?: number;
}

export interface UseCollabOpts {
  projectId: string;
  /** Only connect when true (project is shared / collaboration wanted). */
  enabled: boolean;
  onSnapshot: (snap: CollabSnapshot) => void;
  onOp: (op: CollabOp) => void;
}

export interface CollabApi {
  connected: boolean;
  /** This tab's own member (null until `hello`). */
  me: CollabMember | null;
  /** Everyone in the room INCLUDING me. */
  members: CollabMember[];
  /** True iff this tab is the elected persistence writer (or we're solo/offline
   *  — so a non-collab canvas always persists as today). */
  isWriter: boolean;
  /** Throttled — send this tab's cursor (flow coords). */
  sendCursor: (x: number, y: number, sel?: string | null) => void;
  /** Broadcast a local edit. No-op when not connected. */
  sendOp: (op: CollabOp) => void;
}

const CURSOR_THROTTLE_MS = 45;

export function useCollab({ projectId, enabled, onSnapshot, onOp }: UseCollabOpts): CollabApi {
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<CollabMember | null>(null);
  const [members, setMembers] = useState<CollabMember[]>([]);
  const [writerConn, setWriterConn] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);
  // Keep the latest callbacks in refs so the socket effect doesn't re-open when
  // the parent re-renders with fresh closures.
  const onSnapshotRef = useRef(onSnapshot); onSnapshotRef.current = onSnapshot;
  const onOpRef = useRef(onOp); onOpRef.current = onOp;
  const cursorLastSent = useRef(0);
  const cursorPending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !projectId) return;
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      // ws(s):// with the same host the app is served from. API_BASE_URL is ""
      // in web mode (same origin) → derive scheme from location.
      const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const wsUrl = base.replace(/^http/, "ws") + `/api/projects/${projectId}/collab`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
        // Heartbeat: keep the connection warm + give the server's receive loop a
        // message so it can distinguish an idle-but-alive tab from a dead one.
        // Well inside the server's IDLE_PING_S window.
        if (pingTimer.current) clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send('{"type":"ping"}'); } catch { /* noop */ }
          }
        }, 20000);
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
        if (!closedRef.current) scheduleReconnect();
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(ev.data as string); } catch { return; }
        switch (msg.type) {
          case "hello":
            setMe((msg.you as CollabMember) ?? null);
            break;
          case "presence":
            setMembers((msg.members as CollabMember[]) ?? []);
            break;
          case "writer":
            setWriterConn((msg.connId as number | null) ?? null);
            break;
          case "cursor": {
            const connId = msg.connId as number;
            const cursor = msg.cursor as CollabMember["cursor"];
            setMembers((prev) => prev.map((m) => (m.connId === connId ? { ...m, cursor } : m)));
            break;
          }
          case "op":
            onOpRef.current(msg.op as CollabOp);
            break;
          case "snapshot":
            onSnapshotRef.current(msg as unknown as CollabSnapshot);
            break;
        }
      };
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      attemptRef.current += 1;
      // Exponential backoff + jitter. The jitter (±30%) desynchronizes a fleet
      // of clients that all dropped at once (e.g. an app restart) so they don't
      // reconnect in a synchronized thundering herd.
      const base = Math.min(1000 * 2 ** Math.min(attemptRef.current, 4), 15000);
      const delay = base * (0.7 + Math.random() * 0.6);
      reconnectRef.current = setTimeout(connect, delay);
    };

    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (cursorPending.current) clearTimeout(cursorPending.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        // Detach handlers so this (now-abandoned) socket can't fire onclose →
        // scheduleReconnect and resurrect a ghost connection.
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        // React StrictMode (dev) mounts → cleanup → mounts again. If the socket
        // is still CONNECTING, close() can be deferred until it opens and the
        // SERVER may process the join BEFORE the close — leaving a ghost member
        // (the "counts double" bug: 1 tab → 2, 2 tabs → 4). So: close now if
        // OPEN; if still CONNECTING, close the instant it opens.
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.close(); } catch { /* noop */ }
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => { try { ws.close(); } catch { /* noop */ } };
        }
      }
      setConnected(false);
      setMe(null);
      setMembers([]);
      setWriterConn(null);
    };
  }, [enabled, projectId]);

  const rawSend = useCallback((frame: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(frame)); } catch { /* noop */ }
    }
  }, []);

  const sendCursor = useCallback((x: number, y: number, sel?: string | null) => {
    // Trailing-throttle: send at most every CURSOR_THROTTLE_MS, but always land
    // the final position so a peer's cursor doesn't freeze mid-move.
    const now = Date.now();
    const fire = () => { cursorLastSent.current = Date.now(); rawSend({ type: "cursor", x, y, sel }); };
    if (now - cursorLastSent.current >= CURSOR_THROTTLE_MS) {
      if (cursorPending.current) { clearTimeout(cursorPending.current); cursorPending.current = null; }
      fire();
    } else if (!cursorPending.current) {
      cursorPending.current = setTimeout(() => { cursorPending.current = null; fire(); },
        CURSOR_THROTTLE_MS - (now - cursorLastSent.current));
    }
  }, [rawSend]);

  const sendOp = useCallback((op: CollabOp) => {
    rawSend({ type: "op", op });
  }, [rawSend]);

  // Writer = the one client that PERSISTS architecture.md. Precisely:
  //   • NOT connected (solo / socket down / pre-join) → we ARE the writer, so a
  //     normal single-user canvas persists exactly as it always did.
  //   • connected → ONLY if the SERVER has confirmed our connId as writer.
  // Crucially, a connected client with an as-yet-UNKNOWN writer (writerConn null,
  // e.g. the brief window right after join, before the `writer` frame lands) is
  // NOT a writer — otherwise a fresh joiner would double-persist alongside the
  // real writer and clobber it (the election-window race). It just holds off;
  // the writer frame arrives within one RTT and its edits still broadcast as ops.
  const isWriter = !connected ? true : (me != null && writerConn === me.connId);

  return { connected, me, members, isWriter, sendCursor, sendOp };
}
