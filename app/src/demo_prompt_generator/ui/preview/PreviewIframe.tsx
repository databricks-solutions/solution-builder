import { AlertCircle, Loader2, Maximize2, PlayCircle } from "lucide-react";
import { previewFrameUrl } from "./api";
import type { PreviewState } from "./types";

interface Props {
  projectId: string;
  state: PreviewState | null;
  isStarting?: boolean;
  onStart: () => void;
  refreshNonce?: number;
}

export function PreviewIframe({ projectId, state, isStarting = false, onStart, refreshNonce = 0 }: Props) {
  const status = state?.status ?? "stopped";
  const hasStartScript = state?.has_start_script ?? false;

  // First state hasn't arrived from the backend yet — show a neutral
  // spinner instead of guessing "no app generated yet", which flashes the
  // wrong overlay on slow networks and gets replaced a second later.
  if (state === null) {
    return (
      <Overlay
        icon={<Loader2 className="size-8 text-muted-foreground animate-spin" />}
        title="Checking the app…"
        body="Loading preview state."
      />
    );
  }

  // Not generated yet — overlay explaining.
  if (!hasStartScript) {
    return (
      <Overlay
        icon={<AlertCircle className="size-8 text-muted-foreground" />}
        title="No app generated yet"
        body={
          <>
            Ask the assistant to generate the Databricks App for this project
            first. The template lives under <code>./app/</code> and is started
            from here (not by the assistant).
          </>
        }
      />
    );
  }

  // While the start request is in flight OR the backend has flipped to
  // "starting", show the spinner — prevents a flash of "Preview not running"
  // between the POST and its response.
  if (isStarting || status === "starting") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full">
          {/* Pulsing orb echoing the Overview "AI is working" banner so
              the visual language is consistent across loading states. */}
          <div className="relative mx-auto flex items-center justify-center h-16 w-16 mb-4">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-blue-400/25 animate-ping"
            />
            <span
              aria-hidden
              className="absolute inset-1.5 rounded-full bg-blue-400/35 animate-pulse"
            />
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/30">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
          </div>

          <h3 className="text-center text-[15px] font-semibold text-foreground">
            Booting the app
          </h3>
          <p className="mt-1.5 text-center text-[13px] text-muted-foreground leading-relaxed">
            This usually takes a few seconds. Logs below show progress.
          </p>

          {/* Hint card — pre-tells the user where to find the
              full-screen button once the app is ready. */}
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3.5 py-3">
            <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-300">
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <p className="text-[12.5px] text-foreground/80 leading-relaxed">
              Once it's running, click{" "}
              <span className="font-semibold text-foreground">
                Open full-screen
              </span>{" "}
              at the top to demo the app standalone.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "stopped") {
    return (
      <Overlay
        icon={<PlayCircle className="size-8 text-muted-foreground" />}
        title="App not running"
        body="Click Start to launch the app."
        action={{ label: "Start", onClick: onStart }}
      />
    );
  }

  if (status === "failed") {
    return (
      <Overlay
        icon={<AlertCircle className="size-8 text-red-500" />}
        title="App failed to start"
        body="Check the logs below to see what went wrong, then click Start to try again."
        action={{ label: "Restart", onClick: onStart }}
      />
    );
  }

  // status === "ready"
  return (
    <iframe
      key={`${projectId}-${state?.pid ?? 0}-${refreshNonce}`}
      src={previewFrameUrl(projectId)}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      className="w-full h-full border-0 bg-background"
      title="App preview"
    />
  );
}

function Overlay({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">
        <div className="flex justify-center">{icon}</div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 cursor-pointer transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
