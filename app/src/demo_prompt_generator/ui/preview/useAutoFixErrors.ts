/**
 * Auto-fix-from-logs, LLM-judge edition.
 *
 * When enabled, watches the preview log stream. After 5s of quiet, sends any
 * unanalyzed lines (plus a small head-room of preceding context) to the
 * backend `/api/preview/{id}/analyze-logs` endpoint. A mini LLM decides which
 * lines (if any) are real errors that warrant a code fix. Each detected error
 * is injected into the project's chat as a user-style message so the agent
 * can try to fix it.
 *
 * Why this replaced the old regex-based isErrorLine:
 *   - stderr is used by many tools as a status channel (npm verbose, tsc
 *     watch, pip), not just for errors. The "stream === 'stderr' → error"
 *     rule caused false-positive auto-fixes on every `npm verbose` line.
 *   - Regex can't distinguish "Lakebase connection refused" (real bug) from
 *     "Found 0 errors. Watching for file changes" (success message that
 *     happens to contain the word "error"). The LLM understands semantics.
 *
 * Guards (unchanged from the regex era):
 *   - Budget: 3 auto-fixes per session. Resets when the user sends a manual
 *     message.
 *   - Min interval between sends: 10s (30s after a high-severity send).
 *   - Dedup: same error snippet hash within 60s is suppressed (no budget cost).
 *   - Never sends while the assistant is mid-stream — the state machine is
 *     paused so we don't even buffer during a turn.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { analyzePreviewLogs } from "./api";
import type { PreviewLogLine } from "./types";

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

/** How long to wait after the last log line before sending the window to the
 *  LLM. Lets a multi-line error fully land before analysis. */
const SETTLE_MS = 5_000;

/** Min gap between consecutive auto-fix sends (regardless of LLM verdict). */
const MIN_INTERVAL_MS = 10_000;
const POST_HIGH_SEVERITY_INTERVAL_MS = 30_000;

/** Dedup window: same error snippet within this window is skipped. */
const DEDUP_WINDOW_MS = 60_000;

/** Pause-notification rate-limit when budget is exhausted. */
const PAUSE_NOTICE_INTERVAL_MS = 60_000;

/** How many lines BEFORE the unanalyzed window to include as head-room context.
 *  Helps the LLM see what was happening just before the new lines. */
const HEAD_ROOM_LINES = 5;

/** Cap on the total window size sent to the LLM (prevents runaway cost on huge
 *  log floods). If exceeded, we send only the tail of the window. */
const MAX_WINDOW_LINES = 100;

/** Default budget per session. */
const DEFAULT_BUDGET = 3;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function cheapHash(s: string): string {
  // djb2 — enough to dedup error blocks. Not crypto.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export interface UseAutoFixErrorsOptions {
  projectId: string;
  enabled: boolean;
  /** True iff the preview's child process is currently up and serving
   *  (state.status === "ready"). Auto-fix refuses to dispatch when the
   *  app is down — a crash log analyzed after the process exited produces
   *  hallucinated root causes (the LLM sees a half-broken WebSocket
   *  reconnect attempt and invents a `port mismatch in routes.py`
   *  diagnosis when the real story is "the process died, restart it"). */
  appRunning: boolean;
  /** Current preview logs (full array — we track `seq` to know what's new). */
  logs: PreviewLogLine[];
  /** True while an agent stream is in-flight. We never send during streaming. */
  isStreaming: boolean;
  /** Dispatch a message to the agent. */
  onSend: (message: string) => void;
  /** Emit a system-level log line (amber) back into the preview logs. */
  onSystemLog: (text: string) => void;
}

export interface UseAutoFixErrorsReturn {
  /** How many auto-fixes remain before we pause for a human. */
  budgetRemaining: number;
  /** Call this from the chat send path when a manual message goes out. */
  resetBudget: () => void;
}

export function useAutoFixErrors({
  projectId,
  enabled,
  appRunning,
  logs,
  isStreaming,
  onSend,
  onSystemLog,
}: UseAutoFixErrorsOptions): UseAutoFixErrorsReturn {
  const [budgetRemaining, setBudgetRemaining] = useState(DEFAULT_BUDGET);

  // --- Refs (stay stable across renders; all state-machine bookkeeping) ---

  /** Seq of the last log line we've already sent to the LLM judge (regardless
   *  of verdict). Advances after every analyze call so we never re-analyze. */
  const lastAnalyzedSeqRef = useRef<number>(0);

  /** Timer that fires the analysis after SETTLE_MS of quiet. */
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Wall-clock of the last send (of any kind). */
  const lastSendAtRef = useRef<number>(0);

  /** True when the last send was high severity — use longer cooldown next. */
  const lastSendWasHighRef = useRef<boolean>(false);

  /** Recently-seen error-snippet hashes → wall-clock timestamp of submission. */
  const recentHashesRef = useRef<Map<string, number>>(new Map());

  /** Wall-clock of the last "auto-fix paused" log we emitted. */
  const lastPauseNoticeAtRef = useRef<number>(0);

  /** True while an analyze-logs HTTP call is in flight, to avoid overlapping. */
  const analysisInFlightRef = useRef<boolean>(false);

  /** Latest budget / isStreaming / logs as refs so the settle-timer callback
   *  sees fresh values without re-binding the timer. */
  const budgetRef = useRef<number>(DEFAULT_BUDGET);
  useEffect(() => { budgetRef.current = budgetRemaining; }, [budgetRemaining]);
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  const logsRef = useRef<PreviewLogLine[]>(logs);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  const appRunningRef = useRef(appRunning);
  useEffect(() => { appRunningRef.current = appRunning; }, [appRunning]);

  /** Rate-limit the "app is down" sidecar log so a long-stopped app doesn't
   *  spam the panel. One notice per `PAUSE_NOTICE_INTERVAL_MS` window. */
  const lastAppDownNoticeAtRef = useRef<number>(0);

  // --- The reset function exported to the chat send path ---

  const resetBudget = useCallback(() => {
    setBudgetRemaining(DEFAULT_BUDGET);
    lastSendWasHighRef.current = false;
  }, []);

  // --- Send a single detected error to the agent ---

  const sendError = useCallback(
    (summary: string, snippet: string, severity: "low" | "medium" | "high") => {
      const now = Date.now();

      // Min-interval gate (regardless of budget).
      const minGap = lastSendWasHighRef.current
        ? POST_HIGH_SEVERITY_INTERVAL_MS
        : MIN_INTERVAL_MS;
      if (now - lastSendAtRef.current < minGap) return false;

      // Dedup by snippet hash.
      const hash = cheapHash(snippet.slice(0, 400));
      const seenAt = recentHashesRef.current.get(hash);
      if (seenAt && now - seenAt < DEDUP_WINDOW_MS) return false;

      // Budget check. If exhausted, emit a rate-limited pause notice and bail.
      if (budgetRef.current <= 0) {
        if (now - lastPauseNoticeAtRef.current >= PAUSE_NOTICE_INTERVAL_MS) {
          lastPauseNoticeAtRef.current = now;
          onSystemLog(
            "[auto-fix] Paused after 3 attempts — please review and send a manual message to reset.",
          );
        }
        return false;
      }

      // Commit: record hash, decrement budget, send, emit sidecar log.
      recentHashesRef.current.set(hash, now);
      for (const [k, t] of recentHashesRef.current) {
        if (now - t > DEDUP_WINDOW_MS) recentHashesRef.current.delete(k);
      }
      lastSendAtRef.current = now;
      lastSendWasHighRef.current = severity === "high";

      const nextBudget = budgetRef.current - 1;
      setBudgetRemaining(nextBudget);

      const header = `[auto-fix · ${severity}] ${summary}`;
      const appDir = `projects/${projectId}/app/`;
      const message =
        `${header}\n\n` +
        `The deployed app at \`${appDir}\` (in this project folder) is failing. ` +
        `The error below was captured from its preview logs — fix it in the app source ` +
        `under \`${appDir}\` (e.g. \`${appDir}client/\`, \`${appDir}server/\`, \`${appDir}package.json\`), ` +
        `not in any other project area.\n\n` +
        `\`\`\`\n${snippet}\n\`\`\`\n\n` +
        `Please investigate and fix the issue inside the \`${appDir}\` folder.`;
      onSend(message);
      onSystemLog(`[auto-fix] Sent: ${summary} (${nextBudget} left).`);
      return true;
    },
    [onSend, onSystemLog],
  );

  // --- Analyze the window of unanalyzed log lines ---

  const runAnalysis = useCallback(async () => {
    settleTimerRef.current = null;
    if (!enabledRef.current) return;
    if (isStreamingRef.current) return;
    if (analysisInFlightRef.current) return;

    // App-down gate: don't analyze logs from a dead process. The most
    // common case is the process crashed during startup (npm install, vite
    // boot, etc.) — the logs are full of one-shot errors that aren't worth
    // sending to the assistant. Surfacing a clear "app is stopped" message
    // in the panel is better than blasting bogus fixes at the agent.
    if (!appRunningRef.current) {
      const now = Date.now();
      if (now - lastAppDownNoticeAtRef.current >= PAUSE_NOTICE_INTERVAL_MS) {
        lastAppDownNoticeAtRef.current = now;
        onSystemLog(
          "[auto-fix] App is not running — restart it to resume automatic error analysis.",
        );
      }
      return;
    }

    const all = logsRef.current;
    if (all.length === 0) return;
    const latestSeq = all[all.length - 1].seq;
    if (latestSeq <= lastAnalyzedSeqRef.current) return;

    // Build the window: last HEAD_ROOM_LINES BEFORE the unanalyzed range +
    // all unanalyzed lines. Trim to MAX_WINDOW_LINES from the tail.
    const newStart = all.findIndex((l) => l.seq > lastAnalyzedSeqRef.current);
    const windowStart = Math.max(0, newStart - HEAD_ROOM_LINES);
    let window = all.slice(windowStart);
    if (window.length > MAX_WINDOW_LINES) {
      window = window.slice(-MAX_WINDOW_LINES);
    }

    // Advance the cursor BEFORE the network call so we don't analyze the
    // same window twice if the user toggles things mid-flight.
    lastAnalyzedSeqRef.current = latestSeq;

    analysisInFlightRef.current = true;
    try {
      const { errors } = await analyzePreviewLogs(projectId, window);
      // Re-check streaming + enabled + app-running — they may have changed
      // during the network call. App can crash MID-analysis (the analyzer
      // takes a few seconds); without this recheck we'd send a fix for a
      // process that's already dead.
      if (!enabledRef.current || isStreamingRef.current) return;
      if (!appRunningRef.current) {
        onSystemLog(
          "[auto-fix] App stopped during analysis — restart it manually before retrying.",
        );
        return;
      }
      for (const err of errors) {
        const sent = sendError(err.summary, err.snippet, err.severity);
        // If gated (budget/dedup/min-interval), stop firing the rest — the
        // gates apply globally per cycle.
        if (!sent) break;
      }
    } catch (e) {
      // Network/server error — silent (auto-fix is best-effort).
      console.warn("[auto-fix] analyze-logs failed:", e);
    } finally {
      analysisInFlightRef.current = false;
    }
  }, [projectId, sendError]);

  // --- Watch logs: (re)arm the settle timer whenever new lines arrive ---

  useEffect(() => {
    if (!enabled) {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }

    // Pause while the assistant is mid-stream. Advance the cursor so we don't
    // replay stale pre-stream errors once it ends.
    if (isStreaming) {
      if (logs.length > 0) {
        lastAnalyzedSeqRef.current = Math.max(
          lastAnalyzedSeqRef.current,
          logs[logs.length - 1].seq,
        );
      }
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }

    // Are there unanalyzed lines? If not, nothing to do.
    if (logs.length === 0) return;
    const latestSeq = logs[logs.length - 1].seq;
    if (latestSeq <= lastAnalyzedSeqRef.current) return;

    // (Re)arm the settle timer — each new line resets the clock.
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(runAnalysis, SETTLE_MS);
  }, [enabled, isStreaming, logs, runAnalysis]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  return { budgetRemaining, resetBudget };
}
