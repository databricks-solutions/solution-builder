/**
 * Chat panel component for the project page.
 * Displays conversation history and input for interacting with Claude.
 */

import { memo, useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Prose } from "../markdown-prose";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Loader2,
  Check,
  X,
  Brain,
  ChevronDown,
  ChevronRight,
  Trash2,
  Info,
  ArrowUp,
  MessageSquare,
  Sparkles,
  Square,
  Zap,
  Minimize2,
  Maximize2,
  Copy,
} from "lucide-react";
import { getMessageReasoning, type Message, type ReasoningEntry } from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolInfo {
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  startedAt?: string;
  completedAt?: string;
}

/** A single ThinkingBlock from the model — one contiguous run of
 *  thinking_delta events bookended by either start-of-turn or a
 *  non-thinking event (tool_use, text). Multiple blocks per turn are
 *  expected; each is rendered as its own collapsible "Thought for Xs" pill
 *  so the timeline reads chronologically instead of as one giant blob. */
export interface ThinkingBlock {
  id: string;
  content: string;
  startedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Extract a short description from tool input for display.
 * Removes long project path prefixes for readability.
 */
function getToolDescription(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";

  const inp = input as Record<string, unknown>;
  let description = "";

  switch (name) {
    case "Bash":
      description = typeof inp.command === "string" ? inp.command : "";
      break;
    case "Write":
    case "Read":
    case "Edit":
    case "Glob":
      description = typeof inp.file_path === "string"
        ? inp.file_path
        : typeof inp.path === "string"
          ? inp.path
          : "";
      break;
    case "Grep":
      description = typeof inp.pattern === "string" ? inp.pattern : "";
      break;
    case "Skill":
      description = typeof inp.skill === "string" ? inp.skill : "";
      break;
    default:
      // For other tools, try common field names
      if (typeof inp.command === "string") description = inp.command;
      else if (typeof inp.file_path === "string") description = inp.file_path;
      else if (typeof inp.path === "string") description = inp.path;
      break;
  }

  // Strip the long project-dir prefix from any path-like substring so the
  // tool line stays readable. Matches:
  //   /any/abs/.../projects/<uuid>/...   → strips through `<uuid>/`
  //   ./projects/<uuid>/...
  //   bare projects/<uuid>/...           (e.g. when the agent uses cwd-relative paths)
  // No `^` anchor + `g` flag so we catch every occurrence on a multi-path
  // command like `ls /a/projects/<id>/x /a/projects/<id>/y`.
  description = description.replace(/(?:\.\/|\/(?:[^\s/]+\/)*)?projects\/[a-f0-9-]+\//g, "");

  return description;
}

/**
 * Format tool data for tooltip display (JSON with truncation).
 */
function formatToolJson(tool: { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }): string {
  const data = {
    name: tool.name,
    ...(tool.startedAt && { started_at: tool.startedAt }),
    ...(tool.completedAt && { completed_at: tool.completedAt }),
    input: tool.input,
    ...(tool.result !== undefined && {
      result: tool.result.length > 500 ? tool.result.slice(0, 500) + "..." : tool.result,
      isError: tool.isError
    }),
  };
  return JSON.stringify(data, null, 2);
}

/** Inline horizontal bar showing tool duration relative to the slowest tool
 *  in the same turn. Always renders at least an 8% sliver so even tiny tools
 *  get a visible mark; in-flight tools get a striped/animated treatment. */
const DurationBar = memo(function DurationBar({
  ms,
  maxMs,
  inFlight = false,
}: { ms: number | null; maxMs: number; inFlight?: boolean }) {
  if (ms === null) return null;
  const ratio = maxMs > 0 ? ms / maxMs : 0;
  const pct = Math.max(8, Math.min(100, Math.round(ratio * 100)));
  return (
    <div
      className="h-1.5 w-12 bg-muted-foreground/15 rounded-full overflow-hidden shrink-0 ring-1 ring-inset ring-border/40"
      title={`${ms}ms`}
      aria-label={`Duration ${ms} milliseconds`}
    >
      <div
        className={`h-full rounded-full ${inFlight ? "bg-amber-500/60 animate-pulse" : "bg-amber-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});

/** Format a thinking-block duration the same way as tool durations elsewhere. */
function formatThoughtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function thinkingBlockDurationMs(b: ThinkingBlock): number | null {
  if (!b.completedAt) return null;
  const ms = new Date(b.completedAt).getTime() - new Date(b.startedAt).getTime();
  return ms >= 0 && !isNaN(ms) ? ms : null;
}

/** Collapsible "Thought for Xs" pill — closed by default. Header shows the
 *  duration; expanding reveals the raw thinking text. Live blocks (no
 *  completedAt yet) tick up against wall-clock and label as "Thinking…". */
const ThinkingPill = memo(function ThinkingPill({
  block,
  isLive = false,
  defaultOpen = false,
}: { block: ThinkingBlock; isLive?: boolean; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const durationMs = thinkingBlockDurationMs(block);
  // Only treat a block as "in-flight" if we're actively streaming AND it
  // has no completedAt yet. Persisted entries lacking a completedAt (legacy
  // reasoning_data without timestamps) should fall through as "Thought",
  // not stick at "Thinking…".
  const inFlight = isLive && !block.completedAt;
  // Live tick for in-flight blocks so the duration updates as the model
  // keeps thinking. The parent popup already tick-renders every 500ms while
  // streaming; we just read Date.now() during render.
  const startedMs = block.startedAt ? new Date(block.startedAt).getTime() : NaN;
  const liveMs = inFlight && !isNaN(startedMs)
    ? Math.max(0, Date.now() - startedMs)
    : null;
  const ms = durationMs ?? liveMs;
  const label = inFlight
    ? (ms !== null ? `Thinking · ${formatThoughtDuration(ms)}` : "Thinking…")
    : (durationMs !== null ? `Thought for ${formatThoughtDuration(durationMs)}` : "Thought");

  return (
    <div className="rounded-md bg-amber-500/5 border border-amber-500/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left hover:bg-amber-500/10 transition-colors cursor-pointer"
        aria-expanded={isOpen}
      >
        <Brain className={`h-3 w-3 shrink-0 ${inFlight ? "text-amber-500 animate-pulse" : "text-amber-500/80"}`} />
        <span className="text-[11px] italic text-muted-foreground/90 flex-1 tabular-nums">
          {label}
        </span>
        {block.content && (
          isOpen
            ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
            : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
        )}
      </button>
      {isOpen && block.content && (
        <div className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap border-t border-amber-500/15">
          {block.content}
        </div>
      )}
    </div>
  );
});

/** Compute total thinking duration from reasoning entries (earliest start → latest end). */
function computeThinkingDurationFromEntries(entries: ReasoningEntry[]): string | null {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const entry of entries) {
    if (entry.type === "tool" && entry.started_at) {
      const t = new Date(entry.started_at).getTime();
      if (t < earliest) earliest = t;
    }
    if (entry.type === "tool_result" && entry.completed_at) {
      const t = new Date(entry.completed_at).getTime();
      if (t > latest) latest = t;
    }
  }
  if (earliest === Infinity || latest === -Infinity) return null;
  const ms = latest - earliest;
  if (ms < 0 || isNaN(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Compute total thinking duration from a tools Map. */
function computeThinkingDurationFromMap(tools: Map<string, ToolInfo>): string | null {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const tool of tools.values()) {
    if (tool.startedAt) {
      const t = new Date(tool.startedAt).getTime();
      if (t < earliest) earliest = t;
    }
    if (tool.completedAt) {
      const t = new Date(tool.completedAt).getTime();
      if (t > latest) latest = t;
    }
  }
  if (earliest === Infinity || latest === -Infinity) return null;
  const ms = latest - earliest;
  if (ms < 0 || isNaN(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

interface ReasoningInfo {
  /** Legacy aggregated thinking string. Kept for back-compat during the
   *  transition; new code should prefer `thinkingBlocks` which preserves
   *  per-block timing. */
  thinking: string;
  thinkingBlocks?: ThinkingBlock[];
  tools: Map<string, ToolInfo>;
}

/** Unified timeline row: each thinking block or tool, sorted by startedAt
 *  so the popup reads top-to-bottom in the order the model actually did
 *  the work. Replaces the old "all thinking on top, then all tools below"
 *  layout. */
type UnifiedTimelineRow =
  | { kind: "thinking"; block: ThinkingBlock }
  | { kind: "tool"; id: string; tool: ToolInfo };

function buildUnifiedTimeline(
  thinkingBlocks: ThinkingBlock[],
  toolEntries: Array<[string, ToolInfo]>,
): UnifiedTimelineRow[] {
  const rows: UnifiedTimelineRow[] = [];
  for (const block of thinkingBlocks) {
    rows.push({ kind: "thinking", block });
  }
  for (const [id, tool] of toolEntries) {
    rows.push({ kind: "tool", id, tool });
  }
  rows.sort((a, b) => {
    const ta = a.kind === "thinking"
      ? new Date(a.block.startedAt).getTime()
      : (a.tool.startedAt ? new Date(a.tool.startedAt).getTime() : 0);
    const tb = b.kind === "thinking"
      ? new Date(b.block.startedAt).getTime()
      : (b.tool.startedAt ? new Date(b.tool.startedAt).getTime() : 0);
    return ta - tb;
  });
  return rows;
}

/** Compute "elapsed time" per tool from a unified timeline.
 *
 *  Why not just `tool.completedAt - tool.startedAt`? That's the tool's
 *  pure execution time, which is misleading: a `Write` call writing 12KB
 *  of content takes ~400ms to *execute*, but the model spent ~30s
 *  *generating* that content (and the tool call) before execution
 *  started. Users see "Write: 400ms" and think the file write was fast —
 *  but they actually waited 30s.
 *
 *  This helper anchors each tool's duration against the **end of the
 *  previous timeline event** (prior tool's `completedAt`, or the
 *  thinking block immediately before it). The result is "time elapsed
 *  since the agent last produced something visible" — which folds in
 *  generation/thinking time and gives a duration the user actually felt.
 *
 *  Thinking blocks keep their native start→end duration (already
 *  accurate). The very first row has no anchor, so we fall back to
 *  the tool's own execution time. */
function computeAdjustedToolDurations(
  timeline: UnifiedTimelineRow[],
): Map<string, number> {
  const result = new Map<string, number>();
  let prevEndMs: number | null = null;
  for (const row of timeline) {
    if (row.kind === "thinking") {
      const end = row.block.completedAt ?? row.block.startedAt;
      const t = end ? new Date(end).getTime() : NaN;
      if (!isNaN(t)) prevEndMs = t;
      continue;
    }
    const { id, tool } = row;
    if (!tool.completedAt) continue;
    const endMs = new Date(tool.completedAt).getTime();
    if (isNaN(endMs)) continue;
    // Anchor: previous timeline event's end, or fall back to the tool's
    // own start (first row in the turn, nothing to compare against).
    let anchorMs = prevEndMs;
    if (anchorMs === null && tool.startedAt) {
      const s = new Date(tool.startedAt).getTime();
      if (!isNaN(s)) anchorMs = s;
    }
    if (anchorMs !== null) {
      const ms = endMs - anchorMs;
      if (ms >= 0) result.set(id, ms);
    }
    prevEndMs = endMs;
  }
  return result;
}

/** Format an arbitrary millisecond duration the way the tool rows do.
 *  Mirrors the inline `${(ms/1000).toFixed(1)}s` shape. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (message: string) => Promise<void>;
  isStreaming: boolean;
  isLoadingMessages?: boolean;
  isClearingSession?: boolean;
  streamingContent: string;
  streamingThinkingBlocks?: ThinkingBlock[];
  streamingTools?: Map<string, ToolInfo>;
  pendingUserMessage?: string | null;
  lastReasoning?: ReasoningInfo | null;
  onStop?: () => void;
  onClearSession?: () => void;
  onClose?: () => void;
  onAutoBuild?: () => void | Promise<void>;
  canAutoBuild?: boolean;
  placeholder?: string;
  title?: string;
  /** What the user currently has open (active view / file / preview page).
   *  When set, a "C" badge in the composer shows the exact hint that will be
   *  prepended to the next message. Undefined on overview/story tabs. */
  contextHint?: string;
  /** Fired when the user engages the message input — on focus AND on each
   *  keystroke. The project page uses this to refresh the architecture PNG
   *  snapshot (only if the diagram changed since the last capture) as the user
   *  turns to / types in the chat — so even if the diagram changed in the
   *  background while focus was held, the next keystroke re-captures it. Cheap:
   *  the handler early-returns when nothing changed. */
  onComposerActivity?: () => void;
  /** Read-only mode for shared VIEWERS: the composer is replaced by a
   *  "make a copy to edit" call-to-action, since the backend blocks their
   *  writes anyway. */
  readOnly?: boolean;
  /** Clone this project into one the viewer owns (wired to the read-only CTA). */
  onMakeCopy?: () => void;
  isCloning?: boolean;
}

interface MessageBubbleProps {
  message: Message | { role: string; content: string; is_error?: boolean; is_cancelled?: boolean };
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Collapsible long-message helper
// ---------------------------------------------------------------------------

// Messages longer than this collapse into a card preview (first heading/line +
// line count) instead of dumping the full wall of text into the bubble. The
// auto-generated stage kickoff prompts are typically 2-10k characters — far
// too noisy to display inline.
const COLLAPSE_CHAR_THRESHOLD = 1200;

/** Pull a one-line preview: first markdown heading, else first non-empty line. */
function previewLine(content: string): string {
  const lines = content.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Strip leading markdown heading markers (#, ##, ###...)
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) return heading[1].trim();
    // Skip code fences as preview
    if (line.startsWith("```")) continue;
    // Strip basic markdown emphasis for the preview only
    return line.replace(/[*_`]+/g, "").slice(0, 120);
  }
  return content.slice(0, 120);
}

interface CollapsibleBodyProps {
  content: string;
  /** "raw" = plain text (user bubble, legacy). "markdown" = render via Prose. */
  mode: "raw" | "markdown";
  /** Disable collapsing (e.g. while the message is actively streaming). */
  disabled?: boolean;
  /** Visual tone for the collapsed card — affects border/bg color. */
  tone?: "user" | "assistant";
}

const CollapsibleBody = memo(function CollapsibleBody({
  content,
  mode,
  disabled = false,
  tone = "assistant",
}: CollapsibleBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = !disabled && content.length > COLLAPSE_CHAR_THRESHOLD;

  const renderFull = () =>
    mode === "markdown" ? (
      <Prose
        compact
        tone={tone === "user" ? "onPrimary" : "default"}
        className="text-inherit text-sm"
      >
        {content}
      </Prose>
    ) : (
      <p className="text-sm whitespace-pre-wrap leading-snug">{content}</p>
    );

  if (!shouldCollapse) return renderFull();

  if (expanded) {
    return (
      <>
        {renderFull()}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1.5 text-xs opacity-70 hover:opacity-100 underline-offset-2 hover:underline cursor-pointer"
        >
          Show less
        </button>
      </>
    );
  }

  // Collapsed card preview.
  const preview = previewLine(content);
  const lineCount = content.split("\n").length;
  const isUser = tone === "user";

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer group ${
        isUser
          ? "border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/15"
          : "border-border/50 bg-background/40 hover:bg-background/60"
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <ChevronRight
          className={`h-3.5 w-3.5 mt-0.5 shrink-0 transition-transform group-hover:translate-x-0.5 ${
            isUser ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug truncate">
            {preview || "Prompt"}
          </div>
          <div
            className={`text-[11px] mt-0.5 ${
              isUser ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}
          >
            {lineCount.toLocaleString()} lines · {content.length.toLocaleString()} chars · click to expand
          </div>
        </div>
      </div>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = "is_error" in message && message.is_error;
  const isCancelled = "is_cancelled" in message && message.is_cancelled;

  const contextHint =
    "context_hint" in message ? (message.context_hint ?? null) : null;

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-1.5 bg-primary text-primary-foreground shadow-sm">
          <CollapsibleBody content={message.content} mode="markdown" tone="user" />
        </div>
        {contextHint && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/60 cursor-default select-none pr-1"
                  aria-label="Context sent with this message"
                >
                  <span className="flex items-center justify-center h-3.5 w-3.5 rounded bg-primary/10 text-primary text-[9px] font-semibold">
                    C
                  </span>
                  {contextHint}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" align="end" className="max-w-xs">
                <p className="text-xs">Context sent with this message:</p>
                <p className="mt-1 text-xs font-mono text-muted-foreground">
                  Context hint: the user has {contextHint} open and asks:
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-1.5 ${
          isError
            ? "bg-destructive/5 border border-destructive/20 text-destructive"
            : isCancelled
            ? "bg-muted/60 border border-amber-500/30"
            : "bg-muted/60"
        }`}
      >
        <div className="text-sm">
          {message.content && (
            <CollapsibleBody content={message.content} mode="markdown" disabled={isStreaming} />
          )}
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 ml-0.5 bg-foreground/70 animate-pulse rounded-full align-text-bottom" />
          )}
          {isCancelled && (
            <div className={`text-xs text-amber-600 dark:text-amber-400 font-medium ${message.content ? "mt-2" : ""}`}>
              Canceled by user
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Live Reasoning Popup (floating overlay during streaming)
// ---------------------------------------------------------------------------

interface LiveReasoningPopupProps {
  isStreaming: boolean;
  thinkingBlocks: ThinkingBlock[];
  tools: Map<string, ToolInfo>;
}

const LiveReasoningPopup = memo(function LiveReasoningPopup({
  isStreaming,
  thinkingBlocks,
  tools,
}: LiveReasoningPopupProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Store content locally so it persists after streaming ends
  const [storedThinkingBlocks, setStoredThinkingBlocks] = useState<ThinkingBlock[]>([]);
  const [storedTools, setStoredTools] = useState<Map<string, ToolInfo>>(new Map());
  const [userHasScrolled, setUserHasScrolled] = useState(false);

  // When on, expand each tool row inline with the full JSON payload —
  // useful for copying tool input/result without hovering tooltips.
  const [showDetails, setShowDetails] = useState(false);

  // Minimized = collapsed pill that docks bottom-left. Position is preserved
  // so re-expanding pops back to wherever the user had dragged the panel.
  const [isMinimized, setIsMinimized] = useState(false);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    // Always drive from the element's real rect — avoids closure-stale
    // `position` reads (old code listed `position` as a useCallback dep, which
    // recreated the handler on every mousemove's setState).
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };

    // ── Pointer capture on the drag handle ─────────────────────────────
    // Without this, dragging fast enough to leave the browser window
    // (e.g. onto the OS chrome, DevTools, or another monitor) means the
    // `pointerup` fires outside the document — the listener never sees
    // it, dragRef stays set, and when the cursor comes back the panel
    // keeps following without a click. setPointerCapture routes every
    // subsequent pointermove/up/cancel to this element no matter where
    // the cursor is. Pair it with `lostpointercapture` as the canonical
    // end-of-drag signal so any window-leave path still terminates.
    const handleEl = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      handleEl.setPointerCapture(pointerId);
    } catch {
      // Safari sometimes throws on already-captured pointers; the
      // window listeners below still cover the common case.
    }

    // During the drag, write position imperatively to `style` via rAF so we
    // don't re-render the (expensive, streaming) reasoning content on every
    // pointermove. We only call setPosition once, at pointerup, so React
    // commits the final spot — the portal still remembers where it was moved.
    let pendingX = rect.left;
    let pendingY = rect.top;
    let rafId: number | null = null;
    const applyPending = () => {
      rafId = null;
      panel.style.left = `${pendingX}px`;
      panel.style.top = `${pendingY}px`;
      panel.style.bottom = "auto";
    };

    const handleDragMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      pendingX = dragRef.current.origX + dx;
      pendingY = dragRef.current.origY + dy;
      if (rafId === null) rafId = requestAnimationFrame(applyPending);
    };
    const handleDragEnd = () => {
      if (!dragRef.current) return; // already ended via another path
      dragRef.current = null;
      if (rafId !== null) cancelAnimationFrame(rafId);
      handleEl.removeEventListener("pointermove", handleDragMove);
      handleEl.removeEventListener("pointerup", handleDragEnd);
      handleEl.removeEventListener("pointercancel", handleDragEnd);
      handleEl.removeEventListener("lostpointercapture", handleDragEnd);
      window.removeEventListener("blur", handleDragEnd);
      try {
        if (handleEl.hasPointerCapture(pointerId)) {
          handleEl.releasePointerCapture(pointerId);
        }
      } catch {
        /* element may already be detached */
      }
      document.body.style.userSelect = "";
      // Commit the final position to React so subsequent renders keep it.
      setPosition({ x: pendingX, y: pendingY });
    };
    // Prevent text selection flicker mid-drag.
    document.body.style.userSelect = "none";
    // Listen on the captured element — captured pointer events route here
    // even when the cursor leaves the window. `lostpointercapture` is the
    // canonical end-of-drag signal (fires on alt-tab, window switch, etc.).
    // Window `blur` covers the edge case where the browser loses focus
    // without the OS dispatching a pointer event.
    handleEl.addEventListener("pointermove", handleDragMove);
    handleEl.addEventListener("pointerup", handleDragEnd);
    handleEl.addEventListener("pointercancel", handleDragEnd);
    handleEl.addEventListener("lostpointercapture", handleDragEnd);
    window.addEventListener("blur", handleDragEnd);
  }, []);

  const hasContent = thinkingBlocks.length > 0 || tools.size > 0;

  // Always update stored content when we have live content
  useEffect(() => {
    if (thinkingBlocks.length > 0) setStoredThinkingBlocks(thinkingBlocks);
    if (tools.size > 0) setStoredTools(new Map(tools));
  }, [thinkingBlocks, tools]);

  // Show when streaming with content
  useEffect(() => {
    if (isStreaming && hasContent) {
      setIsVisible(true);
      setIsFadingOut(false);
    }
  }, [isStreaming, hasContent]);

  // Hide 3s after streaming ends
  useEffect(() => {
    if (!isStreaming && isVisible && !isFadingOut) {
      const fadeTimer = setTimeout(() => {
        setIsFadingOut(true);
        setTimeout(() => {
          setIsVisible(false);
          setIsFadingOut(false);
          setStoredThinkingBlocks([]);
          setStoredTools(new Map());
        }, 500);
      }, 3000);
      return () => clearTimeout(fadeTimer);
    }
  }, [isStreaming, isVisible, isFadingOut]);

  // Reset scroll tracking and position when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setUserHasScrolled(false);
      setPosition(null);
      setIsMinimized(false);
    }
  }, [isStreaming]);

  // Live tick — re-render every 500ms while streaming so in-flight tool
  // rows can show their running elapsed time (started_at → now).
  const [, setTickNow] = useState(0);
  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setTickNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  // Handle scroll - detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserHasScrolled(!isAtBottom);
  }, []);

  // Auto-scroll to bottom (only if user hasn't scrolled up)
  useEffect(() => {
    if (scrollRef.current && !userHasScrolled) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingBlocks, tools, storedThinkingBlocks, storedTools, userHasScrolled]);

  // Use live content while streaming, stored content after
  const displayThinkingBlocks = isStreaming ? thinkingBlocks : storedThinkingBlocks;
  const displayTools = isStreaming ? tools : storedTools;

  if (!isVisible) return null;

  const handleClose = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsFadingOut(false);
      setIsMinimized(false);
      setStoredThinkingBlocks([]);
      setStoredTools(new Map());
    }, 500);
  };

  // Counts for the minimized pill summary.
  const toolCount = displayTools.size;
  let inFlightCount = 0;
  for (const t of displayTools.values()) {
    if (t.result === undefined) inFlightCount += 1;
  }

  // Minimized pill — same drag handle, same position memory, but compact.
  // Click anywhere on the pill (except the restore/close buttons) to restore.
  if (isMinimized) {
    return createPortal(
      <div
        ref={panelRef}
        style={{
          ...(position ? { left: position.x, top: position.y, bottom: "auto" } : {}),
        }}
        onPointerDown={handleDragStart}
        onClick={() => setIsMinimized(false)}
        className={`fixed ${position ? "" : "bottom-4 left-4"} flex items-center gap-2 h-8 pl-2.5 pr-1.5 bg-background/95 backdrop-blur-xl border border-border/60 rounded-full shadow-xl z-50 cursor-grab active:cursor-grabbing select-none touch-none transition-opacity duration-500 ${
          isFadingOut ? "opacity-0" : "opacity-100"
        } ${isStreaming ? "animate-reasoning-pulse" : ""}`}
        aria-label="Restore reasoning panel"
      >
        <div className="flex items-center justify-center w-5 h-5 rounded-md bg-amber-500/10 shrink-0">
          <Brain className="h-3 w-3 text-amber-500" />
        </div>
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Live Reasoning</span>
        {isStreaming && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {toolCount > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/80 px-1.5 py-0.5 rounded-full bg-muted/60">
            {inFlightCount > 0 ? `${inFlightCount}/${toolCount} running` : `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setIsMinimized(false); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-muted-foreground/50 hover:text-foreground transition-colors rounded-md p-0.5 hover:bg-muted"
          aria-label="Restore reasoning panel"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-muted-foreground/50 hover:text-foreground transition-colors rounded-md p-0.5 hover:bg-muted"
          aria-label="Close reasoning panel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      style={{
        ...(position ? { left: position.x, top: position.y, bottom: "auto" } : {}),
        minWidth: 400,
        minHeight: 200,
      }}
      className={`fixed ${position ? "" : "bottom-4 left-4"} w-[560px] h-80 resize overflow-hidden bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl z-50 flex flex-col transition-opacity duration-500 ${
        isFadingOut ? "opacity-0" : "opacity-100"
      } ${isStreaming ? "animate-reasoning-pulse" : ""}`}
    >
      {/* Header — drag handle */}
      <div
        onPointerDown={handleDragStart}
        className="shrink-0 flex items-center justify-between px-3.5 py-2.5 border-b border-border/50 cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-amber-500/10">
            <Brain className="h-3 w-3 text-amber-500" />
          </div>
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Live Reasoning</span>
          {isStreaming && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setShowDetails((v) => !v); }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded-md transition-colors ${
              showDetails
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
            }`}
            aria-label="Toggle tool detail view"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-muted-foreground/50 hover:text-foreground transition-colors rounded-md p-0.5 hover:bg-muted"
            aria-label="Minimize reasoning panel"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="text-muted-foreground/50 hover:text-foreground transition-colors rounded-md p-0.5 hover:bg-muted"
            aria-label="Close reasoning panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content — unified chronological timeline of thinking blocks + tool
          calls. Each thinking block is a collapsible "Thought for Xs" pill,
          inline at the spot it actually happened, instead of a single wall
          of text glued on top of all the tool rows. */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3.5 space-y-1.5">
        {(() => {
          const timeline = buildUnifiedTimeline(
            displayThinkingBlocks,
            Array.from(displayTools.entries()),
          );
          if (timeline.length === 0) return null;
          // Each tool's displayed duration is "time since the previous
          // timeline event finished" — includes generation/thinking time
          // that produced the tool call, not just its execution.
          const adjustedDurations = computeAdjustedToolDurations(timeline);
          // Normalize tool bar widths against the longest *adjusted*
          // duration, plus the running elapsed of any in-flight tool so
          // the bar scales as time passes.
          const nowMs = Date.now();
          let maxMs = 0;
          for (const ms of adjustedDurations.values()) {
            if (ms > maxMs) maxMs = ms;
          }
          for (const t of displayTools.values()) {
            if (t.result === undefined && t.startedAt) {
              const live = nowMs - new Date(t.startedAt).getTime();
              if (live > maxMs) maxMs = live;
            }
          }
          return (
          <TooltipProvider delayDuration={200}>
            {timeline.map((entry) => {
              if (entry.kind === "thinking") {
                return (
                  <ThinkingPill
                    key={`think-${entry.block.id}`}
                    block={entry.block}
                    isLive={isStreaming}
                  />
                );
              }
              const { id: toolId, tool } = entry;
              const description = getToolDescription(tool.name, tool.input);
              const inFlight = tool.result === undefined;
              // Completed tools: prefer the adjusted duration (includes
              // generation time). In-flight tools: tick against wall clock
              // anchored at the tool's own startedAt — we have no end yet.
              let durationMs: number | null = adjustedDurations.get(toolId) ?? null;
              let duration: string | null = durationMs !== null ? formatMs(durationMs) : null;
              if (durationMs === null && tool.startedAt && inFlight) {
                const elapsed = Date.now() - new Date(tool.startedAt).getTime();
                if (elapsed >= 0) {
                  durationMs = elapsed;
                  duration = formatMs(elapsed);
                }
              }
              const row = (
                <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs hover:bg-muted/60 transition-colors">
                  <div className="shrink-0">
                    {tool.result !== undefined ? (
                      tool.isError ? (
                        <X className="h-3 w-3 text-destructive" />
                      ) : (
                        <Check className="h-3 w-3 text-green-500" />
                      )
                    ) : (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <span className="font-medium shrink-0">{tool.name}</span>
                  {description && (
                    <span className="text-muted-foreground font-mono truncate text-[10px] flex-1 min-w-0">
                      {description}
                    </span>
                  )}
                  <DurationBar ms={durationMs} maxMs={maxMs} inFlight={inFlight} />
                  {duration && (
                    <span className="text-muted-foreground/60 text-[10px] tabular-nums shrink-0 w-14 text-right">
                      {duration}
                    </span>
                  )}
                  {!showDetails && <Info className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />}
                </div>
              );
              return (
                <div key={`tool-${toolId}`} className="space-y-1">
                  {showDetails ? (
                    row
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">{row}</div>
                      </TooltipTrigger>
                      <TooltipContent side="left" align="start" className="max-w-md max-h-60 overflow-auto">
                        <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
                          {formatToolJson(tool)}
                        </pre>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {showDetails && (
                    <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/20 border border-border/40 rounded-md p-2 max-h-60 overflow-auto select-text">
                      {formatToolJson(tool)}
                    </pre>
                  )}
                </div>
              );
            })}
          </TooltipProvider>
          );
        })()}
      </div>
    </div>,
    document.body
  );
});

// ---------------------------------------------------------------------------
// Collapsible Reasoning (for completed messages) - Old format with Map
// ---------------------------------------------------------------------------

interface CollapsibleReasoningProps {
  reasoning: ReasoningInfo;
}

const CollapsibleReasoning = memo(function CollapsibleReasoning({ reasoning }: CollapsibleReasoningProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Synthesize a thinking-blocks array: prefer the structured form, fall
  // back to wrapping the legacy thinking string as a single un-timestamped
  // pseudo-block so it still renders as a pill in the unified timeline.
  const thinkingBlocks: ThinkingBlock[] = reasoning.thinkingBlocks && reasoning.thinkingBlocks.length > 0
    ? reasoning.thinkingBlocks
    : (reasoning.thinking
        ? [{ id: "legacy", content: reasoning.thinking, startedAt: new Date(0).toISOString() }]
        : []);
  const hasContent = thinkingBlocks.length > 0 || reasoning.tools.size > 0;

  if (!hasContent) return null;

  const totalDuration = computeThinkingDurationFromMap(reasoning.tools);
  const label = totalDuration ? `Thought for ${totalDuration}` : "Thinking";

  return (
    <div className="rounded-lg bg-muted/30 border border-border/40 mb-2 overflow-hidden">
      <div className="flex items-center w-full hover:bg-muted/50 transition-colors">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 flex-1 px-3 py-2 cursor-pointer text-left"
        >
          <Brain className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground flex-1">{label}</span>
          {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
        </button>
        {isOpen && reasoning.tools.size > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowDetails((v) => !v); }}
            className={`text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 mr-2 rounded-md transition-colors ${
              showDetails
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
            }`}
            aria-label="Toggle tool detail view"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
        )}
      </div>
      {isOpen && (() => {
        const timeline = buildUnifiedTimeline(thinkingBlocks, Array.from(reasoning.tools.entries()));
        const adjustedDurations = computeAdjustedToolDurations(timeline);
        let maxMs = 0;
        for (const ms of adjustedDurations.values()) {
          if (ms > maxMs) maxMs = ms;
        }
        return (
          <TooltipProvider delayDuration={200}>
            <div className="px-3 pb-3 space-y-1.5">
              {timeline.map((entry) => {
                if (entry.kind === "thinking") {
                  return (
                    <ThinkingPill key={`think-${entry.block.id}`} block={entry.block} />
                  );
                }
                const { id: toolId, tool } = entry;
                const description = getToolDescription(tool.name, tool.input);
                const durationMs = adjustedDurations.get(toolId) ?? null;
                const duration = durationMs !== null ? formatMs(durationMs) : null;
                const row = (
                  <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs hover:bg-muted/60 transition-colors">
                    <div className="shrink-0">
                      {tool.isError ? (
                        <X className="h-3 w-3 text-destructive" />
                      ) : (
                        <Check className="h-3 w-3 text-green-500" />
                      )}
                    </div>
                    <span className="font-medium shrink-0">{tool.name}</span>
                    {description && (
                      <span className="text-muted-foreground font-mono truncate text-[10px] flex-1 min-w-0">
                        {description}
                      </span>
                    )}
                    <DurationBar ms={durationMs} maxMs={maxMs} />
                    {duration && (
                      <span className="text-muted-foreground/60 text-[10px] tabular-nums shrink-0 w-12 text-right">
                        {duration}
                      </span>
                    )}
                  </div>
                );
                return (
                  <div key={`tool-${toolId}`} className="space-y-1">
                    {showDetails ? (
                      row
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help">{row}</div>
                        </TooltipTrigger>
                        <TooltipContent side="left" align="start" className="max-w-md max-h-80 overflow-auto">
                          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
                            {formatToolJson(tool)}
                          </pre>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {showDetails && (
                      <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/20 border border-border/40 rounded-md p-2 max-h-60 overflow-auto select-text">
                        {formatToolJson(tool)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        );
      })()}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Collapsible Reasoning from Metadata (ordered entries from DB)
// ---------------------------------------------------------------------------

interface CollapsibleReasoningFromMetadataProps {
  /** Prefer `messageId` (lazy fetch on expand). `entries` is kept as an escape
   *  hatch for callers that already have the data in hand (e.g. a just-streamed
   *  message where reasoning was built up client-side). */
  messageId?: number;
  entries?: ReasoningEntry[];
}

const CollapsibleReasoningFromMetadata = memo(function CollapsibleReasoningFromMetadata({ messageId, entries: initialEntries }: CollapsibleReasoningFromMetadataProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [entries, setEntries] = useState<ReasoningEntry[] | null>(initialEntries ?? null);
  const [isLoading, setIsLoading] = useState(false);

  // Lazy fetch on first expand when we have a messageId but no entries yet.
  const handleToggle = useCallback(async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && entries === null && messageId !== undefined) {
      setIsLoading(true);
      try {
        const data = await getMessageReasoning(messageId);
        setEntries(data?.reasoning ?? []);
      } catch {
        setEntries([]);
      } finally {
        setIsLoading(false);
      }
    }
  }, [isOpen, entries, messageId]);

  // If we have inline entries and nothing to show, hide the toggle.
  if (initialEntries !== undefined && initialEntries.length === 0) return null;

  // Merge tool and tool_result entries for display
  const toolResults = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>();
  for (const entry of entries ?? []) {
    if (entry.type === "tool") {
      toolResults.set(entry.id, { name: entry.name, input: entry.input, startedAt: entry.started_at });
    } else if (entry.type === "tool_result") {
      const existing = toolResults.get(entry.tool_id);
      if (existing) {
        existing.result = entry.content;
        existing.isError = entry.is_error;
        existing.completedAt = entry.completed_at;
      }
    }
  }

  const totalDuration = entries ? computeThinkingDurationFromEntries(entries) : null;
  const label = entries === null
    ? "Thinking"
    : totalDuration
      ? `Thought for ${totalDuration}`
      : "Thinking";

  const hasTools = toolResults.size > 0;

  return (
    <div className="rounded-lg bg-muted/30 border border-border/40 mb-2 overflow-hidden">
      <div className="flex items-center w-full hover:bg-muted/50 transition-colors">
        <button
          onClick={handleToggle}
          className="flex items-center gap-2 flex-1 px-3 py-2 cursor-pointer text-left"
        >
          <Brain className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground flex-1">{label}</span>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60 shrink-0" />}
          {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
        </button>
        {isOpen && hasTools && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowDetails((v) => !v); }}
            className={`text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 mr-2 rounded-md transition-colors ${
              showDetails
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
            }`}
            aria-label="Toggle tool detail view"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
        )}
      </div>
      {isOpen && isLoading && (
        <div className="px-3 pb-3 text-xs text-muted-foreground/70">Loading reasoning…</div>
      )}
      {isOpen && !isLoading && entries && (() => {
        // Walk entries chronologically and infer thinking-block timestamps
        // for legacy entries that don't carry their own. start = previous
        // tool's completed_at; end = next tool's started_at. Gives "Thought
        // for Xs" durations on persisted reasoning even before the backend
        // started stamping thinking events directly.
        let prevToolEndMs: number | null = null;
        const inferredThinking = new Map<number, { startedAt?: string; completedAt?: string }>();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.type === "thinking") {
            let startedAt = e.started_at;
            let completedAt = e.completed_at;
            if (!startedAt && prevToolEndMs !== null) {
              startedAt = new Date(prevToolEndMs).toISOString();
            }
            if (!completedAt) {
              for (let j = i + 1; j < entries.length; j++) {
                const nxt = entries[j];
                if (nxt.type === "tool" && nxt.started_at) {
                  completedAt = nxt.started_at;
                  break;
                }
                if (nxt.type === "thinking" && nxt.started_at) {
                  completedAt = nxt.started_at;
                  break;
                }
              }
            }
            inferredThinking.set(i, { startedAt, completedAt });
          } else if (e.type === "tool_result" && e.completed_at) {
            const t = new Date(e.completed_at).getTime();
            if (!isNaN(t) && (prevToolEndMs === null || t > prevToolEndMs)) {
              prevToolEndMs = t;
            }
          } else if (e.type === "tool" && e.started_at && prevToolEndMs === null) {
            // Bootstrap so the first thinking block (which usually precedes
            // any tool) at least has SOMETHING for its end if it lacks one.
            const t = new Date(e.started_at).getTime();
            if (!isNaN(t)) prevToolEndMs = t;
          }
        }
        // Build a unified timeline so adjusted tool durations include
        // the generation/thinking time that preceded each tool call —
        // same logic as the live view.
        const histTimeline: UnifiedTimelineRow[] = [];
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.type === "thinking") {
            const inferred = inferredThinking.get(i);
            histTimeline.push({
              kind: "thinking",
              block: {
                id: `thinking-${i}`,
                content: e.content,
                startedAt: e.started_at ?? inferred?.startedAt ?? "",
                completedAt: e.completed_at ?? inferred?.completedAt,
              },
            });
          } else if (e.type === "tool") {
            const result = toolResults.get(e.id);
            if (result) histTimeline.push({ kind: "tool", id: e.id, tool: result });
          }
        }
        const adjustedDurations = computeAdjustedToolDurations(histTimeline);
        let maxMs = 0;
        for (const ms of adjustedDurations.values()) {
          if (ms > maxMs) maxMs = ms;
        }
        return (
        <TooltipProvider delayDuration={200}>
          <div className="px-3 pb-3 space-y-1.5">
            {entries.map((entry, idx) => {
              if (entry.type === "thinking") {
                const inferred = inferredThinking.get(idx);
                const block: ThinkingBlock = {
                  id: `thinking-${idx}`,
                  content: entry.content,
                  startedAt: entry.started_at ?? inferred?.startedAt ?? "",
                  completedAt: entry.completed_at ?? inferred?.completedAt,
                };
                return (
                  <ThinkingPill key={`think-${idx}`} block={block} />
                );
              }
              if (entry.type === "tool") {
                const result = toolResults.get(entry.id);
                const description = getToolDescription(entry.name, entry.input);
                const toolData = result || { name: entry.name, input: entry.input };
                const durationMs = adjustedDurations.get(entry.id) ?? null;
                const duration = durationMs !== null ? formatMs(durationMs) : null;

                const row = (
                  <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs hover:bg-muted/60 transition-colors">
                    <div className="shrink-0">
                      {result?.isError ? (
                        <X className="h-3 w-3 text-destructive" />
                      ) : (
                        <Check className="h-3 w-3 text-green-500" />
                      )}
                    </div>
                    <span className="font-medium shrink-0">{entry.name}</span>
                    {description && (
                      <span className="text-muted-foreground font-mono truncate text-[10px] flex-1 min-w-0">
                        {description}
                      </span>
                    )}
                    <DurationBar ms={durationMs} maxMs={maxMs} />
                    {duration && (
                      <span className="text-muted-foreground/60 text-[10px] tabular-nums shrink-0 w-12 text-right">
                        {duration}
                      </span>
                    )}
                  </div>
                );

                return (
                  <div key={`tool-${entry.id}`} className="space-y-1">
                    {showDetails ? row : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help">{row}</div>
                        </TooltipTrigger>
                        <TooltipContent side="left" align="start" className="max-w-md max-h-80 overflow-auto">
                          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
                            {formatToolJson(toolData)}
                          </pre>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {showDetails && (
                      <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/20 border border-border/40 rounded-md p-2 max-h-60 overflow-auto select-text">
                        {formatToolJson(toolData)}
                      </pre>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </TooltipProvider>
        );
      })()}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Chat Panel
// ---------------------------------------------------------------------------

export const ChatPanel = memo(function ChatPanel({
  messages,
  onSendMessage,
  isStreaming,
  isLoadingMessages = false,
  isClearingSession = false,
  streamingContent,
  streamingThinkingBlocks,
  streamingTools,
  pendingUserMessage,
  lastReasoning,
  onStop,
  onClearSession,
  onClose,
  onAutoBuild,
  canAutoBuild = true,
  placeholder = "Ask the AI to help build your solution...",
  title = "Your AI Assistant",
  contextHint,
  onComposerActivity,
  readOnly = false,
  onMakeCopy,
  isCloning = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [userHasScrolledChat, setUserHasScrolledChat] = useState(false);
  const [autoBuildConfirmOpen, setAutoBuildConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const handleClearConfirm = useCallback(() => {
    setClearConfirmOpen(false);
    onClearSession?.();
  }, [onClearSession]);

  const handleAutoBuildConfirm = useCallback(async () => {
    setAutoBuildConfirmOpen(false);
    if (onAutoBuild) {
      await onAutoBuild();
    }
  }, [onAutoBuild]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset scroll tracking when user sends a message
  useEffect(() => {
    if (isStreaming) {
      setUserHasScrolledChat(false);
    }
  }, [isStreaming]);

  // Handle scroll - detect if user scrolled away from bottom
  const handleChatScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setUserHasScrolledChat(!isAtBottom);
  }, []);

  // Auto-scroll to bottom on new messages (only if user hasn't scrolled up)
  useEffect(() => {
    if (!userHasScrolledChat) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, streamingThinkingBlocks, streamingTools, userHasScrolledChat]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
  }, [input]);

  // Handle send
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setInput("");
    await onSendMessage(trimmed);
  }, [input, isStreaming, onSendMessage]);

  // Handle keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const hasMessages = messages.length > 0 || isStreaming || pendingUserMessage;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border/50 flex items-center justify-between bg-background">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <h2 className="font-semibold text-sm">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {onClearSession && messages.length > 0 && (
            <button
              onClick={() => setClearConfirmOpen(true)}
              disabled={isStreaming || isClearingSession}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-destructive px-2 py-1.5 rounded-md hover:bg-destructive/5 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              title="Clear session history"
              aria-label="Clear session history"
            >
              {isClearingSession ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              <span>Clear</span>
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center justify-center h-8 w-8 rounded-md border border-border/60 bg-muted/40 text-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 transition-all cursor-pointer"
              title="Hide assistant"
              aria-label="Hide assistant"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleChatScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        <div className="p-4 space-y-2">
          {!hasMessages && !isClearingSession && (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              {isLoadingMessages ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground/60">Loading messages...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 max-w-[280px] text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-muted/60">
                    <MessageSquare className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground/70 mb-1">Start a conversation</p>
                    <p className="text-xs text-muted-foreground/50 leading-relaxed">
                      Ask the AI to help you design and build your solution
                    </p>
                  </div>
                  {onAutoBuild && (
                    <button
                      onClick={() => setAutoBuildConfirmOpen(true)}
                      disabled={!canAutoBuild}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      title="Run the full solution build end-to-end"
                    >
                      <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
                      <span>Or run auto build</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {isClearingSession && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground/60">Clearing session...</p>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isAssistant = msg.role === "assistant";
            const isLastAssistant = isAssistant && idx === messages.length - 1;
            // Two sources of reasoning:
            //   1. msg.reasoning_data is already populated (e.g. a just-streamed
            //      message built up client-side) — pass it inline.
            //   2. msg.has_reasoning === true — the server has compressed bytes
            //      available; fetch lazily on toggle expand.
            const inlineEntries = msg.reasoning_data?.reasoning;
            const hasInline = isAssistant && inlineEntries && inlineEntries.length > 0;
            const hasLazy = isAssistant && !hasInline && msg.has_reasoning === true;

            return (
              <div key={msg.id}>
                {hasInline && (
                  <CollapsibleReasoningFromMetadata entries={inlineEntries} />
                )}
                {hasLazy && (
                  <CollapsibleReasoningFromMetadata messageId={msg.id} />
                )}
                {/* Fallback: show lastReasoning for the last assistant message if no reasoning_data */}
                {!hasInline && !hasLazy && !isStreaming && lastReasoning && isLastAssistant && (
                  <CollapsibleReasoning reasoning={lastReasoning} />
                )}
                <MessageBubble message={msg} />
              </div>
            );
          })}

          {/* Pending user message */}
          {pendingUserMessage && (
            <MessageBubble
              message={{ role: "user", content: pendingUserMessage }}
            />
          )}

          {/* Streaming AI response */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-1.5 bg-muted/60">
                {streamingContent ? (
                  <div className="text-sm">
                    <Prose compact className="text-inherit text-sm">{streamingContent}</Prose>
                    <span className="inline-block w-0.5 h-4 ml-0.5 bg-foreground/70 animate-pulse rounded-full align-text-bottom" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1 py-0.5">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area — read-only viewers get a "make a copy" CTA instead. */}
      {readOnly ? (
        <div className="shrink-0 p-3 pt-2">
          <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground">
              You have <span className="font-medium">read-only</span> access to
              this project.
            </p>
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={onMakeCopy}
              disabled={isCloning || !onMakeCopy}
            >
              {isCloning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Making a
                  copy…
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Make my own copy to edit
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
      <div className="shrink-0 p-3 pt-2">
        <div className="rounded-xl border border-border/60 bg-muted/20 shadow-sm focus-within:border-border focus-within:shadow-md transition-all">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); onComposerActivity?.(); }}
            onKeyDown={handleKeyDown}
            onFocus={onComposerActivity}
            placeholder={placeholder}
            disabled={isStreaming}
            className="min-h-[44px] max-h-[160px] resize-none text-sm border-0 shadow-none bg-transparent focus-visible:ring-0 rounded-xl rounded-b-none px-3.5 py-3"
            rows={1}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1.5 pl-1.5">
              {contextHint && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="flex items-center justify-center h-5 w-5 rounded-md bg-primary/10 text-primary text-[10px] font-semibold cursor-default select-none"
                        aria-label="Context attached to your next message"
                      >
                        C
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-xs">
                      <p className="text-xs">
                        This context is sent with your message:
                      </p>
                      <p className="mt-1 text-xs font-mono text-muted-foreground">
                        Context hint: the user has {contextHint} open and asks:
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <span className="text-[10px] text-muted-foreground/40 select-none">
                {isStreaming ? "Generating..." : "Enter to send"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <button
                  onClick={onStop}
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors"
                  title="Stop generation"
                  aria-label="Stop generation"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-30 disabled:pointer-events-none"
                  title="Send message"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Live reasoning popup */}
      <LiveReasoningPopup
        isStreaming={isStreaming}
        thinkingBlocks={streamingThinkingBlocks || []}
        tools={streamingTools || new Map()}
      />

      {/* Auto build confirmation */}
      <Dialog open={autoBuildConfirmOpen} onOpenChange={setAutoBuildConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" strokeWidth={2.5} />
              Run auto build?
            </DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed">
              This may take around 30 minutes. Once it starts, you'll need to wait for it to finish — re-prompting the chatbot to make changes after the run can take additional time. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setAutoBuildConfirmOpen(false)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-muted text-foreground/80 hover:bg-muted/70 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAutoBuildConfirm}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5"
            >
              <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
              Start auto build
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear session confirmation */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" strokeWidth={2.5} />
              Are you sure?
            </DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed">
              This will reset your chat history and start a brand new session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setClearConfirmOpen(false)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-muted text-foreground/80 hover:bg-muted/70 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClearConfirm}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
              Clear session
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export default ChatPanel;
