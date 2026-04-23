/**
 * Auto-fix-from-logs state machine.
 *
 * When enabled, watches the preview log stream and injects error blocks into
 * the project's chat as user-style messages so the agent can try to fix them.
 *
 * Guards against infinite loops:
 *   - Budget: 3 auto-fixes. Resets when the user sends a manual message.
 *   - Min interval between sends: 10s (30s after a FLOOD send).
 *   - Dedup: same incident hash within 60s is suppressed (no budget cost).
 *   - Flood detection: if >= 30 error lines arrive in 10s without a debounce
 *     window ever closing, force-send the last 30 log lines as a snapshot.
 *   - Never sends while the assistant is mid-stream — in fact the whole state
 *     machine is paused so we don't even buffer/debounce during a turn. The
 *     app will keep logging live; queuing up stale pre-turn errors to fire the
 *     instant the stream ends would just spam the chat.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewLogLine } from "./types";

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

/** How long to wait after the last error line before finalizing an incident. */
const DEBOUNCE_MS = 500;

/** Flood trigger: this many error lines in this many ms. */
const FLOOD_LINE_COUNT = 30;
const FLOOD_WINDOW_MS = 10_000;

/** Min gap between consecutive auto-fix sends. */
const MIN_INTERVAL_MS = 10_000;
const POST_FLOOD_INTERVAL_MS = 30_000;

/** Dedup window: same incident (by content hash) within this window is skipped. */
const DEDUP_WINDOW_MS = 60_000;

/** Pause-notification rate-limit when budget is exhausted. */
const PAUSE_NOTICE_INTERVAL_MS = 60_000;

/** How many lines of recent context to snapshot during a FLOOD. */
const FLOOD_SNAPSHOT_LINES = 30;

/** Max payload sent to the agent (chars) — keeps the chat readable. */
const MAX_PAYLOAD_CHARS = 1500;

/** Default budget per session. */
const DEFAULT_BUDGET = 3;

// ANSI red color escape — used as a fallback error signal when the logger
// format isn't recognized (e.g. raw third-party writes).
const ANSI_RED = "\x1b[31m";

// Matches our patched logger's ERROR prefix:
//   2026-04-23T14:32:10.123Z ERROR server/server.ts:42  ...
const LOGGER_ERROR_LINE_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+ERROR\b/;

// A leading "at ..." or indented line generally belongs to a stack trace.
const STACK_CONTINUATION_RE = /^(\s+at\s|\s{4,})/;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function isErrorLine(line: PreviewLogLine): boolean {
  if (line.stream === "stderr") return true;
  if (LOGGER_ERROR_LINE_RE.test(line.text)) return true;
  if (line.text.includes(ANSI_RED)) return true;
  // Common explicit error names as a safety net.
  if (/\b(Error|SyntaxError|TypeError|ReferenceError|RangeError):/i.test(line.text)) return true;
  return false;
}

function isStackContinuation(text: string): boolean {
  return STACK_CONTINUATION_RE.test(text);
}

function cheapHash(s: string): string {
  // djb2 — enough to dedup error blocks. Not crypto.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function truncatePayload(text: string): string {
  if (text.length <= MAX_PAYLOAD_CHARS) return text;
  // Keep the END — stack traces are most useful at the leaf.
  return "…[truncated]…\n" + text.slice(-MAX_PAYLOAD_CHARS);
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export interface UseAutoFixErrorsOptions {
  enabled: boolean;
  /** Current preview logs (full array — we track `seq` to know what's new). */
  logs: PreviewLogLine[];
  /** True while an agent stream is in-flight. We never send during streaming. */
  isStreaming: boolean;
  /** Dispatch a message to the agent. Should mark this as auto-fix to skip budget-reset. */
  onSend: (message: string) => void;
  /** Emit a system-level log line (amber) back into the preview logs. */
  onSystemLog: (text: string) => void;
}

export interface UseAutoFixErrorsReturn {
  /** How many auto-fixes remain before we pause for a human. */
  budgetRemaining: number;
  /** Call this from the chat send path when a manual message goes out — resets budget. */
  resetBudget: () => void;
}

export function useAutoFixErrors({
  enabled,
  logs,
  isStreaming,
  onSend,
  onSystemLog,
}: UseAutoFixErrorsOptions): UseAutoFixErrorsReturn {
  const [budgetRemaining, setBudgetRemaining] = useState(DEFAULT_BUDGET);

  // --- Refs (stay stable across renders; all state-machine bookkeeping) ---

  /** Seq of the last log line we've already processed. */
  const lastSeqSeenRef = useRef<number>(-1);

  /** Error lines collected in the current debounce window. */
  const incidentBufferRef = useRef<PreviewLogLine[]>([]);

  /** Timer that finalizes the incident after DEBOUNCE_MS of quiet. */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Rolling window of error-line timestamps (Date.now()) for flood detection. */
  const floodWindowRef = useRef<number[]>([]);

  /** Wall-clock of the last send (of any kind). */
  const lastSendAtRef = useRef<number>(0);

  /** True when the last send was a FLOOD send — use longer cooldown next. */
  const lastSendWasFloodRef = useRef<boolean>(false);

  /** Recently-seen incident hashes → wall-clock timestamp of submission. */
  const recentHashesRef = useRef<Map<string, number>>(new Map());

  /** Wall-clock of the last "auto-fix paused" log we emitted. */
  const lastPauseNoticeAtRef = useRef<number>(0);

  /** Latest budget as a ref so the stream-watcher closure sees fresh values. */
  const budgetRef = useRef<number>(DEFAULT_BUDGET);
  useEffect(() => {
    budgetRef.current = budgetRemaining;
  }, [budgetRemaining]);

  /** Latest isStreaming for the same reason. */
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  /** Latest logs array (full) — we snapshot during floods. */
  const logsRef = useRef<PreviewLogLine[]>(logs);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  // --- The reset function exported to the chat send path ---

  const resetBudget = useCallback(() => {
    setBudgetRemaining(DEFAULT_BUDGET);
    lastSendWasFloodRef.current = false;
  }, []);

  // --- Core send logic (shared by debounce-fire and flood-fire) ---

  const attemptSend = useCallback(
    (payloadText: string, flagLabel: "auto-fix" | "auto-fix · FLOOD") => {
      if (!enabled) return;

      // Never interrupt an in-flight agent stream.
      if (isStreamingRef.current) return;

      // Min-interval gate (regardless of budget, prevents us from piling on).
      const now = Date.now();
      const minGap = lastSendWasFloodRef.current ? POST_FLOOD_INTERVAL_MS : MIN_INTERVAL_MS;
      if (now - lastSendAtRef.current < minGap) return;

      // Dedup: don't resubmit the same error block within DEDUP_WINDOW_MS.
      const hash = cheapHash(payloadText.slice(0, 400)); // first 400 chars is enough
      const seenAt = recentHashesRef.current.get(hash);
      if (seenAt && now - seenAt < DEDUP_WINDOW_MS) return;

      // Budget check. If exhausted, emit a rate-limited pause notice and bail.
      if (budgetRef.current <= 0) {
        if (now - lastPauseNoticeAtRef.current >= PAUSE_NOTICE_INTERVAL_MS) {
          lastPauseNoticeAtRef.current = now;
          onSystemLog(
            "[auto-fix] Paused after 3 attempts — please review and send a manual message to reset.",
          );
        }
        return;
      }

      // Commit: record the hash, decrement budget, send, emit sidecar log.
      recentHashesRef.current.set(hash, now);
      // Evict old hash entries (keep the map small).
      for (const [k, t] of recentHashesRef.current) {
        if (now - t > DEDUP_WINDOW_MS) recentHashesRef.current.delete(k);
      }
      lastSendAtRef.current = now;
      lastSendWasFloodRef.current = flagLabel.includes("FLOOD");

      const nextBudget = budgetRef.current - 1;
      setBudgetRemaining(nextBudget);

      const header =
        flagLabel === "auto-fix · FLOOD"
          ? "[auto-fix · FLOOD] The app is emitting errors faster than the debounce can settle. Sending the last log lines as a snapshot."
          : `[auto-fix] The app logged an error at ${new Date().toISOString()}. Here are the relevant log lines:`;

      const message = `${header}\n\n\`\`\`\n${truncatePayload(payloadText)}\n\`\`\`\n\nPlease investigate and fix.`;
      onSend(message);
      onSystemLog(`[auto-fix] Sent error to assistant (${nextBudget} left).`);
    },
    [enabled, onSend, onSystemLog],
  );

  // --- Finalize an incident (debounce timer fired) ---

  const finalizeIncident = useCallback(() => {
    const buf = incidentBufferRef.current;
    incidentBufferRef.current = [];
    debounceTimerRef.current = null;
    if (buf.length === 0) return;

    const text = buf.map((l) => l.text).join("\n");
    attemptSend(text, "auto-fix");
  }, [attemptSend]);

  // --- Flood trigger (too many errors too fast) ---

  const triggerFloodSend = useCallback(() => {
    // Clear the buffer — we're handling this differently.
    incidentBufferRef.current = [];
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    floodWindowRef.current = [];

    // Snapshot last N lines of the current logs (any stream).
    const snap = logsRef.current.slice(-FLOOD_SNAPSHOT_LINES);
    const text = snap.map((l) => `[${l.stream}] ${l.text}`).join("\n");
    attemptSend(text, "auto-fix · FLOOD");
  }, [attemptSend]);

  // --- Watch logs, run the state machine ---

  useEffect(() => {
    if (!enabled) {
      // Clear any in-flight bookkeeping on disable so re-enabling starts clean.
      incidentBufferRef.current = [];
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      floodWindowRef.current = [];
      // Don't reset budget on toggle — that's the user's choice via manual send.
      return;
    }

    // Pause the state machine while the assistant is mid-stream. We skip these
    // lines entirely (advance the cursor so we don't replay them once the
    // stream ends — they'd be stale by then, and the app keeps logging live).
    if (isStreaming) {
      if (logs.length > 0) {
        lastSeqSeenRef.current = logs[logs.length - 1].seq;
      }
      incidentBufferRef.current = [];
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return;
    }

    // Process only new log lines (higher seq than the last we've seen).
    const newLines = logs.filter((l) => l.seq > lastSeqSeenRef.current);
    if (newLines.length === 0) return;
    lastSeqSeenRef.current = logs[logs.length - 1].seq;

    const now = Date.now();

    for (const line of newLines) {
      const errorLike = isErrorLine(line);

      if (errorLike) {
        // Incident buffer: add this line.
        incidentBufferRef.current.push(line);

        // Flood detection — add to sliding window, trim old, check threshold.
        floodWindowRef.current.push(now);
        floodWindowRef.current = floodWindowRef.current.filter(
          (t) => now - t <= FLOOD_WINDOW_MS,
        );
        if (floodWindowRef.current.length >= FLOOD_LINE_COUNT) {
          triggerFloodSend();
          continue; // flood handler clears buffers
        }

        // (Re)start the debounce timer.
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(finalizeIncident, DEBOUNCE_MS);
      } else {
        // Non-error line. If it looks like a stack continuation of an error
        // already in the buffer, append it — otherwise it closes the incident.
        if (incidentBufferRef.current.length > 0) {
          if (isStackContinuation(line.text)) {
            incidentBufferRef.current.push(line);
            // Extend debounce — more of the trace may be coming.
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(finalizeIncident, DEBOUNCE_MS);
          }
          // Otherwise: leave the buffer; the debounce timer will still fire
          // on its own and finalize what we have.
        }
      }
    }
  }, [enabled, isStreaming, logs, finalizeIncident, triggerFloodSend]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return { budgetRemaining, resetBudget };
}
