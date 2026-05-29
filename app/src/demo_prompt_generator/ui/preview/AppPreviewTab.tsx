/**
 * Top-level component for the APP tab in the project page.
 *
 * To integrate: render `<AppPreviewTab projectId={id} />` inside whatever tab
 * switcher the project page uses. This component is self-contained.
 *
 * Auto-fix-from-logs: pass `onAutoFixSend` + `isStreaming` to enable the
 * "Auto-fix errors" toggle in the logs header. When enabled, error lines are
 * collected and sent to the assistant automatically. The parent can obtain
 * the auto-fix API (for budget reset on manual sends) via `autoFixApiRef`.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { PreviewControls } from "./PreviewControls";
import { PreviewIframe } from "./PreviewIframe";
import { PreviewLogs } from "./PreviewLogs";
import { useAppPreview } from "./useAppPreview";
import { useAutoFixErrors } from "./useAutoFixErrors";

export interface AutoFixApi {
  /** Call when the user manually sends a chat message — resets budget to 3. */
  resetBudget: () => void;
}

interface Props {
  projectId: string;
  /** If provided, enables the Auto-fix toggle in the logs header. */
  onAutoFixSend?: (message: string) => void;
  /** Pass the project's streaming flag so auto-fix never injects during a turn. */
  isStreaming?: boolean;
  /** Parent can hold a ref here to reach into the auto-fix API (e.g. to resetBudget). */
  autoFixApiRef?: MutableRefObject<AutoFixApi | null>;
}

export function AppPreviewTab({ projectId, onAutoFixSend, isStreaming = false, autoFixApiRef }: Props) {
  const {
    state,
    logs,
    error,
    isStarting,
    isStopping,
    start,
    stop,
    restart,
    appendSystemLog,
    clearLogs,
  } = useAppPreview(projectId);

  // Bumping this nonce remounts the iframe, forcing a full reload
  // (can't call .reload() on a cross-origin iframe, and src= tricks race with React).
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Auto-fix-from-logs: on by default. The hook internally no-ops when the
  // app isn't emitting errors, so it's safe to be "enabled" even before the
  // preview is running — keeps the toggle steerable without lifecycle gating.
  const [autoFixEnabled, setAutoFixEnabled] = useState(true);
  const appRunning = state?.status === "ready";

  // True while an auto-fix-initiated stream is in flight. Set when the hook
  // dispatches a fix message; cleared when the assistant's stream finishes
  // (we watch `isStreaming` flipping back to false).
  const [autoFixActive, setAutoFixActive] = useState(false);
  const autoFixJustSentRef = useRef(false);
  // Clear the chip when the assistant stops streaming after an auto-fix send.
  // We also debounce against the case where the stream hasn't started yet
  // (the parent's isStreaming flips true a tick after onSend).
  useEffect(() => {
    if (isStreaming) {
      // Streaming is now in flight — if auto-fix kicked it, lock in the
      // "active" state until streaming flips back to false.
      if (autoFixJustSentRef.current) {
        autoFixJustSentRef.current = false;
      }
    } else if (autoFixActive) {
      // Streaming ended; auto-fix's turn is over.
      setAutoFixActive(false);
    }
  }, [isStreaming, autoFixActive]);

  const handleAutoFixSend = useCallback(
    (message: string) => {
      if (!onAutoFixSend) return;
      autoFixJustSentRef.current = true;
      setAutoFixActive(true);
      onAutoFixSend(message);
    },
    [onAutoFixSend],
  );

  const { budgetRemaining, resetBudget } = useAutoFixErrors({
    projectId,
    // `enabled` reflects the toggle + integration only. The app-running
    // gate is passed separately so the hook can emit a clear "app is
    // stopped" notice in the log panel instead of silently dropping the
    // analysis (the prior behavior conflated both gates and gave no
    // signal when the app died — users saw auto-fix do nothing and
    // wondered if it was broken).
    enabled: autoFixEnabled && !!onAutoFixSend,
    appRunning,
    logs,
    isStreaming,
    onSend: handleAutoFixSend,
    onSystemLog: appendSystemLog,
  });

  // Hand the reset API back to the parent via ref.
  useEffect(() => {
    if (!autoFixApiRef) return;
    autoFixApiRef.current = { resetBudget };
    return () => {
      if (autoFixApiRef.current && autoFixApiRef.current.resetBudget === resetBudget) {
        autoFixApiRef.current = null;
      }
    };
  }, [autoFixApiRef, resetBudget]);

  return (
    <div className="flex flex-col h-full bg-background">
      <PreviewControls
        state={state}
        projectId={projectId}
        isStarting={isStarting}
        isStopping={isStopping}
        autoFixActive={autoFixActive}
        onStart={() => void start()}
        onStop={() => void stop()}
        onRestart={() => void restart()}
        onRefreshFrame={() => setRefreshNonce((n) => n + 1)}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        <PreviewIframe
          projectId={projectId}
          state={state}
          isStarting={isStarting}
          onStart={() => void start()}
          refreshNonce={refreshNonce}
        />
      </div>
      <PreviewLogs
        logs={logs}
        error={error}
        onClear={clearLogs}
        autoFix={
          onAutoFixSend
            ? {
                enabled: autoFixEnabled,
                onToggle: () => setAutoFixEnabled((e) => !e),
                budgetRemaining,
                // Toggle is always clickable — even if the app isn't running
                // the user can pre-flip it so fixes kick in the moment it starts.
                disabled: false,
              }
            : undefined
        }
      />
    </div>
  );
}
