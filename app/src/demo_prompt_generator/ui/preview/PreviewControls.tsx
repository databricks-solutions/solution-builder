import { AlertTriangle, Maximize2, Play, RefreshCw, RotateCw, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { previewFrameUrl } from "./api";
import type { PreviewState } from "./types";

interface Props {
  state: PreviewState | null;
  projectId: string;
  isStarting?: boolean;
  isStopping?: boolean;
  /** True while an auto-fix-triggered agent stream is running. Surfaces a
   *  pulsing "AI is fixing an error" chip in the toolbar so the user knows
   *  the assistant is busy on the app's behalf, not on their behalf. */
  autoFixActive?: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRefreshFrame: () => void;
}

type VisualStatus = NonNullable<PreviewState>["status"] | "stopping";

const STATUS_DOT: Record<VisualStatus, string> = {
  stopped: "bg-muted-foreground",
  starting: "bg-amber-500 animate-pulse",
  stopping: "bg-amber-500 animate-pulse",
  ready: "bg-emerald-500",
  failed: "bg-red-500",
};

const STATUS_LABEL: Record<VisualStatus, string> = {
  stopped: "Stopped",
  starting: "Starting…",
  stopping: "Stopping…",
  ready: "Running",
  failed: "Failed",
};

export function PreviewControls({ state, projectId, isStarting = false, isStopping = false, autoFixActive = false, onStart, onStop, onRestart, onRefreshFrame }: Props) {
  const rawStatus = state?.status ?? "stopped";
  // isStarting (in-flight POST) wins over raw backend status so the UI flips
  // to "Starting…" the instant the user clicks, not after the POST returns.
  const status: VisualStatus = isStopping
    ? "stopping"
    : isStarting
    ? "starting"
    : rawStatus;
  const isRunning = rawStatus === "ready" || rawStatus === "starting";
  const canStart = (rawStatus === "stopped" || rawStatus === "failed") && !isStopping && !isStarting;
  const hasStartScript = state?.has_start_script ?? false;

  const startDisabled = !canStart || !hasStartScript;
  const stopDisabled = (!isRunning && !isStarting) || isStopping;
  const restartDisabled = (!isRunning && !isStarting) || isStopping;
  // Frame-level actions only make sense once the iframe is actually showing content.
  const frameActionsDisabled = rawStatus !== "ready";

  const startTip = !hasStartScript
    ? "No app/start.sh in this project yet"
    : isStopping
    ? "Currently stopping — wait before starting"
    : isStarting || rawStatus === "starting"
    ? "App is already starting"
    : rawStatus === "ready"
    ? "App is already running"
    : "Start the app (fresh logs)";
  const stopTip = isStopping
    ? "Stopping…"
    : !isRunning
    ? "App is not running"
    : "Stop the app";
  const restartTip = isStopping
    ? "Stopping…"
    : !isRunning
    ? "App is not running — nothing to restart"
    : "Restart the app (clears logs)";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button
                type="button"
                disabled={startDisabled}
                onClick={onStart}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="size-3.5" /> Start
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{startTip}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button
                type="button"
                disabled={restartDisabled}
                onClick={onRestart}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted text-foreground px-3 py-1.5 text-sm font-medium hover:bg-muted/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCw className="size-3.5" /> Restart
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{restartTip}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button
                type="button"
                disabled={stopDisabled}
                onClick={onStop}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted text-foreground px-3 py-1.5 text-sm font-medium hover:bg-muted/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Square className="size-3.5" /> {isStopping ? "Stopping…" : "Stop"}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{stopTip}</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <button
                type="button"
                disabled={frameActionsDisabled}
                onClick={onRefreshFrame}
                aria-label="Refresh preview"
                className="inline-flex items-center justify-center rounded-md bg-muted text-foreground p-1.5 hover:bg-muted/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className="size-3.5" />
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{frameActionsDisabled ? "Start the app first" : "Refresh the preview (reload iframe)"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <a
                href={frameActionsDisabled ? undefined : previewFrameUrl(projectId)}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={frameActionsDisabled}
                tabIndex={frameActionsDisabled ? -1 : 0}
                onClick={(e) => { if (frameActionsDisabled) e.preventDefault(); }}
                aria-label="Open preview full-screen"
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  frameActionsDisabled
                    ? "bg-muted text-muted-foreground opacity-40 cursor-not-allowed"
                    : "bg-blue-500 text-white hover:bg-blue-400 cursor-pointer"
                }`}
              >
                <Maximize2 className="size-3.5" strokeWidth={2.5} />
                Open full-screen
              </a>
            </span>
          </TooltipTrigger>
          <TooltipContent>{frameActionsDisabled ? "Start the app first" : "Open preview full-screen in a new tab"}</TooltipContent>
        </Tooltip>

        {/* Auto-fix indicator — pulses amber while the assistant is fixing
            an error it spotted in the logs. Disappears once the stream
            finishes (parent clears autoFixActive on isStreaming → false). */}
        {autoFixActive && (
          <div
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[12px] font-medium text-amber-700 dark:text-amber-300 animate-pulse"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle className="size-3.5" strokeWidth={2.5} />
            <span>The AI spotted an error — fixing it…</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`inline-block size-2 rounded-full ${STATUS_DOT[status]}`} />
          <span>{STATUS_LABEL[status]}</span>
          {state?.port && status === "ready" && (
            <span className="text-xs font-mono">:{state.port}</span>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
