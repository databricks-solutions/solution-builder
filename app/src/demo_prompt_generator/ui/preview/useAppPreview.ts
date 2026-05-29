/**
 * React hook: manage a project's preview lifecycle.
 *
 * - Connects to /api/preview/{id}/events (SSE) and streams logs + state
 * - Proactively reconnects at 90s (before Databricks' 2min kill)
 * - Reconnects from the last seq so no logs are lost across flaps
 * - Pings /api/preview/{id}/ping every 60s while this component is mounted,
 *   so the backend's 5-minute idle timer doesn't auto-stop an open app.
 *   Any proxied request (chat, page load) ALSO bumps the idle timer on the
 *   backend, so this ping is only the "someone has the tab open" signal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPreviewState,
  pingPreview,
  previewEventsUrl,
  restartPreview,
  startPreview,
  stopPreview,
} from "./api";
import type { PreviewLogLine, PreviewState } from "./types";

const MAX_LOGS = 2000;
const RECONNECT_AT_MS = 90_000;
const RETRY_BACKOFF_MS = 500;
const PING_INTERVAL_MS = 60_000;

export interface UseAppPreviewReturn {
  state: PreviewState | null;
  logs: PreviewLogLine[];
  error: string | null;
  // Mirrors for in-flight lifecycle requests — the Start POST takes a moment
  // to return (subprocess spawn), and the backend has no "stopping" status.
  // Tracking these locally keeps the UI responsive instead of flickering.
  isStarting: boolean;
  isStopping: boolean;
  // Lifecycle (async — caller can await)
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  /** Inject a synthetic "system" log line (amber) from the client — used by
   *  the auto-fix feature to post notices alongside real backend logs. */
  appendSystemLog: (text: string) => void;
  /** Drop every log line currently in the buffer. The SSE cursor is NOT
   *  rewound, so new lines after the clear continue to stream in normally —
   *  this just declutters the panel without affecting backend state. */
  clearLogs: () => void;
}

export function useAppPreview(projectId: string): UseAppPreviewReturn {
  const [state, setState] = useState<PreviewState | null>(null);
  const [logs, setLogs] = useState<PreviewLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Cursor: highest log seq we've observed. Used for reconnects.
  const cursorRef = useRef<number>(0);
  // Abort controller for the current SSE connection.
  const abortRef = useRef<AbortController | null>(null);
  // Active = component mounted. Flip false on unmount to break the reconnect loop.
  const activeRef = useRef<boolean>(true);
  // Token for the initial "kick" GET — invalidated by any user action (Start /
  // Stop / Restart) so a late-arriving kick response can't clobber fresh state.
  const kickTokenRef = useRef<object | null>(null);

  const appendLog = useCallback((line: PreviewLogLine) => {
    // Skip replays: the SSE stream may resend lines we already have after a
    // reconnect. Only accept strictly-increasing seq numbers.
    if (line.seq <= cursorRef.current) return;
    cursorRef.current = line.seq;
    setLogs((prev) => {
      const next = prev.length >= MAX_LOGS ? prev.slice(prev.length - MAX_LOGS + 1) : prev;
      return [...next, line];
    });
  }, []);

  const replaceState = useCallback((next: PreviewState) => {
    setState(next);
    // Do NOT advance cursorRef from state.last_seq here. The state event
    // reports the backend's latest log seq at emission time, but log events
    // for seqs ≤ last_seq may still be in-flight on the subscriber queue.
    // Advancing the cursor here causes those still-pending logs to be
    // filtered as "already seen" when they arrive. The cursor is for logs
    // only — let appendLog be the sole place it moves.
  }, []);

  // --- SSE reader loop --------------------------------------------------
  useEffect(() => {
    activeRef.current = true;
    // Reset on project change — including in-flight action mirrors so a
    // stale "Starting…" doesn't bleed into the new project.
    cursorRef.current = 0;
    setLogs([]);
    setState(null);
    setError(null);
    setIsStarting(false);
    setIsStopping(false);

    // Kick: get state once so the UI isn't empty before the SSE opens.
    // Guard against the GET resolving AFTER a user click (Start/Restart) has
    // already set a fresher state — a stale "stopped" from this kick would
    // otherwise clobber the live "starting" state.
    const kickToken = {};
    kickTokenRef.current = kickToken;
    getPreviewState(projectId).then((s) => {
      if (kickTokenRef.current === kickToken) setState(s);
    }).catch(() => {
      /* non-fatal; SSE will emit state too */
    });

    let stopProactiveTimer: (() => void) | null = null;

    const loop = async (): Promise<void> => {
      while (activeRef.current) {
        const ac = new AbortController();
        abortRef.current = ac;

        // Close our own connection after 90s so we reconnect BEFORE any proxy
        // kills the long-lived SSE (Databricks Apps: 2min).
        const proactiveTimer = window.setTimeout(() => ac.abort(), RECONNECT_AT_MS);
        stopProactiveTimer = () => window.clearTimeout(proactiveTimer);

        try {
          await readEventStream(
            previewEventsUrl(projectId, cursorRef.current),
            ac.signal,
            (ev) => {
              if (ev.event === "log") {
                try {
                  const line = JSON.parse(ev.data) as PreviewLogLine;
                  appendLog(line);
                } catch {
                  /* ignore malformed */
                }
              } else if (ev.event === "state") {
                try {
                  const parsed = JSON.parse(ev.data);
                  replaceState({ ...parsed, project_id: projectId });
                } catch {
                  /* ignore malformed */
                }
              }
            },
          );
        } catch (err: unknown) {
          if (!activeRef.current) return;
          // Abort from our proactive timer is expected — don't surface.
          if ((err as DOMException)?.name !== "AbortError") {
            setError((err as Error).message || "stream error");
          }
        } finally {
          stopProactiveTimer?.();
          stopProactiveTimer = null;
        }

        if (!activeRef.current) return;
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      }
    };

    loop();

    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
      stopProactiveTimer?.();
    };
  }, [projectId, appendLog, replaceState]);

  // --- Ping loop (UI heartbeat for the idle timer) ----------------------
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pingPreview(projectId);
      }
    }, PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [projectId]);

  // --- Actions ----------------------------------------------------------
  const start = useCallback(async () => {
    setError(null);
    setIsStarting(true);
    // Fresh logs on start — match the user's mental model (new run = clean slate).
    setLogs([]);
    cursorRef.current = 0;
    // Invalidate any in-flight kick GET so its stale "stopped" can't clobber us.
    kickTokenRef.current = null;
    try {
      const next = await startPreview(projectId);
      replaceState(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsStarting(false);
    }
  }, [projectId, replaceState]);

  const stop = useCallback(async () => {
    setError(null);
    setIsStopping(true);
    kickTokenRef.current = null;
    try {
      const next = await stopPreview(projectId);
      replaceState(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsStopping(false);
    }
  }, [projectId, replaceState]);

  const restart = useCallback(async () => {
    setError(null);
    setIsStopping(true); // stop phase
    setIsStarting(true); // then restart
    setLogs([]);
    cursorRef.current = 0;
    kickTokenRef.current = null;
    try {
      const next = await restartPreview(projectId);
      replaceState(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsStopping(false);
      setIsStarting(false);
    }
  }, [projectId, replaceState]);

  // Synthetic counter for client-side system log entries so their seqs never
  // collide with backend-assigned seqs (which are small integers).
  const syntheticSeqRef = useRef<number>(Number.MAX_SAFE_INTEGER);
  const appendSystemLog = useCallback((text: string) => {
    const seq = syntheticSeqRef.current--;
    setLogs((prev) => {
      const next = prev.length >= MAX_LOGS ? prev.slice(prev.length - MAX_LOGS + 1) : prev;
      return [...next, { seq, stream: "system", text }];
    });
  }, []);

  const clearLogs = useCallback(() => {
    // Drop the buffer but keep the SSE cursor — incoming lines after the
    // clear continue to flow in. This is purely a UI declutter.
    setLogs([]);
  }, []);

  return { state, logs, error, isStarting, isStopping, start, stop, restart, appendSystemLog, clearLogs };
}

// ---------------------------------------------------------------------------
// Minimal SSE parser over fetch. (EventSource can't send cursor headers and
// can't abort cleanly — so we roll our own.)
// ---------------------------------------------------------------------------

interface SseEvent {
  event: string;
  data: string;
}

async function readEventStream(
  url: string,
  signal: AbortSignal,
  onEvent: (ev: SseEvent) => void,
): Promise<void> {
  const resp = await fetch(url, {
    signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`events HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    // Split on blank lines — SSE record boundary
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const parsed = parseSseRecord(raw);
      if (parsed) onEvent(parsed);
    }
  }
}

function parseSseRecord(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue; // empty or comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}
