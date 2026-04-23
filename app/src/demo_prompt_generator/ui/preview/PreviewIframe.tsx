import { AlertCircle, Loader2, PlayCircle } from "lucide-react";
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
      <Overlay
        icon={<Loader2 className="size-8 text-muted-foreground animate-spin" />}
        title="Starting…"
        body="Booting the app. Logs below show progress."
      />
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
