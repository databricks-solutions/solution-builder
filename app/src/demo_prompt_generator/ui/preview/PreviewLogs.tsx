import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Terminal, Trash2, Wand2 } from "lucide-react";
import type { PreviewLogLine } from "./types";

interface Props {
  logs: PreviewLogLine[];
  error: string | null;
  /** Drop the visible log buffer. SSE cursor is unaffected. */
  onClear?: () => void;
  /** Auto-fix toggle props. When `autoFix` is undefined the button is hidden. */
  autoFix?: {
    enabled: boolean;
    onToggle: () => void;
    budgetRemaining: number;
    /** Disable the toggle (e.g. when the app isn't running). */
    disabled?: boolean;
  };
}

// Resizable-height bounds, in pixels. Min keeps at least ~3 lines visible;
// max stops the user from dragging it taller than most laptop viewports.
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 720;
const DEFAULT_HEIGHT = 192; // matches the previous h-48 (12rem * 16px)
const HEIGHT_STORAGE_KEY = "preview-logs-height";

function loadHeight(): number {
  if (typeof window === "undefined") return DEFAULT_HEIGHT;
  const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
  if (!raw) return DEFAULT_HEIGHT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_HEIGHT;
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, n));
}

export function PreviewLogs({ logs, error, onClear, autoFix }: Props) {
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState<number>(loadHeight);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Sticky-bottom: starts true so the first paint (and any subsequent reopen)
  // lands at the tail. Flips to false if the user scrolls up, and back to true
  // when they scroll near the bottom again.
  const stickToBottomRef = useRef(true);

  // Drag-resize bookkeeping. Uses Pointer Events with setPointerCapture so
  // the matching pointerup ALWAYS fires on the handle element, even when the
  // cursor leaves the window mid-drag or the user releases over another app.
  // The previous mousemove/mouseup-on-window approach would lose the up
  // event if the cursor exited the viewport, leaving the panel "stuck" in
  // drag mode (cursor frozen as ns-resize, next motion still resizing).
  const handleRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startH: number; pointerId: number } | null>(null);

  const endDrag = useCallback(() => {
    const el = handleRef.current;
    const ctx = dragRef.current;
    if (el && ctx) {
      try {
        el.releasePointerCapture(ctx.pointerId);
      } catch {
        // Capture may already have been released by the browser (e.g. tab
        // visibility change). Safe to ignore.
      }
    }
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only react to the primary button (left-click / single-touch).
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers reject capture on synthesized events — fall through;
        // pointermove/up still fire on the element.
      }
      dragRef.current = { startY: e.clientY, startH: height, pointerId: e.pointerId };
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ctx = dragRef.current;
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    // Drag UP → bigger panel (subtract delta because Y grows downward).
    const next = Math.max(
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, ctx.startH - (e.clientY - ctx.startY)),
    );
    setHeight(next);
  }, []);

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ctx = dragRef.current;
      if (!ctx || e.pointerId !== ctx.pointerId) return;
      endDrag();
    },
    [endDrag],
  );

  // Belt-and-suspenders: if the window loses focus or the tab becomes hidden
  // mid-drag (alt-tab, window-switcher, OS modal) the pointer events might
  // never reach us. Force-end the drag so we don't get stuck.
  useEffect(() => {
    const cancel = () => {
      if (dragRef.current) endDrag();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [endDrag]);

  // Persist the final height whenever it settles. Cheaper than writing on
  // every mousemove and survives the listener teardown above.
  useEffect(() => {
    if (dragRef.current) return; // mid-drag, don't write yet
    try {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
    } catch {
      // ignore
    }
  }, [height]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !open) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, open, height]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div className="shrink-0 border-t border-border bg-muted/20">
      {/* Drag handle — only visible/active when the panel is open. Sits ABOVE
          the header strip so dragging up grows the scroller naturally. Uses
          Pointer Events with capture so a release outside the window doesn't
          strand the drag state. */}
      {open && (
        <div
          ref={handleRef}
          role="separator"
          aria-label="Resize log panel"
          aria-orientation="horizontal"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          // Double-click resets to the default height.
          onDoubleClick={() => setHeight(DEFAULT_HEIGHT)}
          title="Drag to resize · double-click to reset"
          // touch-none stops mobile browsers from intercepting vertical
          // drags as page scrolls.
          className="group h-1.5 w-full cursor-ns-resize touch-none bg-border/40 hover:bg-primary/40 transition-colors flex items-center justify-center"
        >
          {/* Visual affordance — a faint pill that pops on hover. */}
          <span className="block h-0.5 w-10 rounded-full bg-muted-foreground/30 group-hover:bg-primary/70 transition-colors" />
        </div>
      )}

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

        {onClear && (
          <button
            type="button"
            onClick={onClear}
            disabled={logs.length === 0}
            title={
              logs.length === 0
                ? "No logs to clear"
                : `Clear ${logs.length} log line${logs.length === 1 ? "" : "s"}`
            }
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="size-3.5" />
            <span>Clear</span>
          </button>
        )}

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
          style={{ height: `${height}px` }}
          className="overflow-y-auto font-mono text-[11px] leading-snug px-4 py-2 bg-background border-t border-border"
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
