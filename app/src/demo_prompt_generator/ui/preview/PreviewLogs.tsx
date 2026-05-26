import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Terminal, Wand2 } from "lucide-react";
import type { PreviewLogLine } from "./types";

interface Props {
  logs: PreviewLogLine[];
  error: string | null;
  /** Auto-fix toggle props. When `autoFix` is undefined the button is hidden. */
  autoFix?: {
    enabled: boolean;
    onToggle: () => void;
    budgetRemaining: number;
    /** Disable the toggle (e.g. when the app isn't running). */
    disabled?: boolean;
  };
}

export function PreviewLogs({ logs, error, autoFix }: Props) {
  const [open, setOpen] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Sticky-bottom: starts true so the first paint (and any subsequent reopen)
  // lands at the tail. Flips to false if the user scrolls up, and back to true
  // when they scroll near the bottom again.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !open) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, open]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div className="shrink-0 border-t border-border bg-muted/20">
      <div className="w-full flex items-center gap-2 px-4 py-1.5 text-xs font-medium">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <Terminal className="size-3.5" />
          <span>Logs</span>
          <span className="text-muted-foreground/60">({logs.length})</span>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>

        {autoFix && (
          <button
            type="button"
            onClick={autoFix.onToggle}
            disabled={autoFix.disabled}
            title={
              autoFix.disabled
                ? "Start the app first"
                : autoFix.enabled
                  ? `Auto-fix on — ${autoFix.budgetRemaining} attempt${autoFix.budgetRemaining === 1 ? "" : "s"} left before pause`
                  : "Auto-send app errors to the assistant for fixing"
            }
            className={`ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              autoFix.enabled
                ? "bg-primary/15 text-primary hover:bg-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Wand2 className="size-3.5" />
            <span>Auto-fix{autoFix.enabled ? ` · ${autoFix.budgetRemaining} left` : ""}</span>
          </button>
        )}
      </div>
      {open && (
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="h-48 overflow-y-auto font-mono text-[11px] leading-snug px-4 py-2 bg-background border-t border-border"
        >
          {error && (
            <div className="mb-1 text-red-500">[stream error] {error}</div>
          )}
          {logs.length === 0 && !error && (
            <div className="text-muted-foreground/60">No logs yet — click Start.</div>
          )}
          {logs.map((line) => (
            <div
              key={line.seq}
              className={
                line.stream === "stderr"
                  ? "text-red-500"
                  : line.stream === "system"
                    ? "text-amber-500"
                    : "text-foreground"
              }
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
