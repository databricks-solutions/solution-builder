/**
 * Chat panel component for the project page.
 * Displays conversation history and input for interacting with Claude.
 */

import { memo, useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Textarea } from "../ui/textarea";
import { Prose } from "../markdown-prose";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  Loader2,
  Check,
  X,
  Brain,
  Wrench,
  ChevronDown,
  ChevronRight,
  Trash2,
  Info,
  ArrowUp,
  MessageSquare,
  Sparkles,
  Square,
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

  // Remove common project path prefixes for readability
  description = description.replace(/^(\/[^/]+)+\/projects\/[a-f0-9-]+\//, "");
  description = description.replace(/^\.\/projects\/[a-f0-9-]+\//, "");

  return description;
}

/**
 * Format tool data for tooltip display (JSON with truncation).
 */
function formatToolJson(tool: { name: string; input: unknown; result?: string; isError?: boolean }): string {
  const data = {
    name: tool.name,
    input: tool.input,
    ...(tool.result !== undefined && {
      result: tool.result.length > 500 ? tool.result.slice(0, 500) + "..." : tool.result,
      isError: tool.isError
    }),
  };
  return JSON.stringify(data, null, 2);
}

/** Format duration between two ISO timestamps as a human-readable string. */
function formatDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0 || isNaN(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

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
  thinking: string;
  tools: Map<string, ToolInfo>;
}

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (message: string) => Promise<void>;
  isStreaming: boolean;
  isLoadingMessages?: boolean;
  isClearingSession?: boolean;
  streamingContent: string;
  streamingThinking?: string;
  streamingTools?: Map<string, ToolInfo>;
  pendingUserMessage?: string | null;
  lastReasoning?: ReasoningInfo | null;
  onStop?: () => void;
  onClearSession?: () => void;
  placeholder?: string;
  title?: string;
}

interface MessageBubbleProps {
  message: Message | { role: string; content: string; is_error?: boolean; is_cancelled?: boolean };
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Collapsible long-message helper
// ---------------------------------------------------------------------------

// Messages longer than this get a middle-collapsed "[…] show more" toggle.
// HEAD + TAIL = visible content when collapsed; the threshold sits well above
// HEAD+TAIL so collapsing only kicks in when there's enough hidden content to
// be worth a click. Hiding 50 chars is pointless; hiding 250+ is useful.
const COLLAPSE_HEAD = 1500;
const COLLAPSE_TAIL = 500;
const COLLAPSE_CHAR_THRESHOLD = COLLAPSE_HEAD + COLLAPSE_TAIL + 500; // 2500

/** Slice to the last whitespace ≤ `limit` from the start so we don't cut mid-word. */
function sliceHead(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const slice = content.slice(0, limit);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  return slice.slice(0, lastBreak > limit - 80 ? lastBreak : limit);
}

/** Slice to the first whitespace ≥ `content.length - limit` so the tail starts at a word boundary. */
function sliceTail(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const start = content.length - limit;
  const slice = content.slice(start);
  const firstBreak = Math.min(
    slice.indexOf("\n") === -1 ? Infinity : slice.indexOf("\n"),
    slice.indexOf(" ") === -1 ? Infinity : slice.indexOf(" ")
  );
  return firstBreak < 80 ? slice.slice(firstBreak + 1) : slice;
}

interface CollapsibleBodyProps {
  content: string;
  /** "raw" = plain text (user bubble). "markdown" = render via Prose (assistant bubble). */
  mode: "raw" | "markdown";
  /** Disable collapsing (e.g. while the message is actively streaming). */
  disabled?: boolean;
}

const CollapsibleBody = memo(function CollapsibleBody({ content, mode, disabled = false }: CollapsibleBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = !disabled && content.length > COLLAPSE_CHAR_THRESHOLD;

  if (!shouldCollapse || expanded) {
    // Full content — tack "Show less" on the end when expanded so the user
    // can collapse back. Kept inline to avoid wasted vertical space.
    return (
      <>
        {mode === "markdown" ? (
          <Prose compact className="text-inherit text-sm">{content}</Prose>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-snug">{content}</p>
        )}
        {shouldCollapse && expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="ml-1 text-xs opacity-70 hover:opacity-100 underline-offset-2 hover:underline cursor-pointer"
          >
            Show less
          </button>
        )}
      </>
    );
  }

  // Collapsed: head + inline "[ … show more ] " + tail, all on one flow.
  const head = sliceHead(content, COLLAPSE_HEAD);
  const tail = sliceTail(content, COLLAPSE_TAIL);
  const onExpand = () => setExpanded(true);

  // Shared marker: [ … **show more** … ] with the bold clickable label inside
  // the brackets, so it reads as one visual unit no matter the rendering mode.
  const marker = (
    <span className="whitespace-nowrap opacity-80">
      [ …{" "}
      <button
        type="button"
        onClick={onExpand}
        className="font-bold underline-offset-2 hover:underline cursor-pointer"
      >
        show more
      </button>
      {" "}… ]
    </span>
  );

  if (mode === "markdown") {
    // Markdown can't embed a React node mid-string, so we split head/tail into
    // two Prose blocks with the marker in between. space-y-0 keeps them tight.
    return (
      <div className="space-y-0">
        <Prose compact className="text-inherit text-sm">{head}</Prose>
        <div className="text-sm my-0.5">{marker}</div>
        <Prose compact className="text-inherit text-sm">{tail}</Prose>
      </div>
    );
  }

  // Raw mode (user bubble): marker inline in the paragraph flow.
  return (
    <p className="text-sm whitespace-pre-wrap leading-snug">
      {head}
      {" "}{marker}{" "}
      {tail}
    </p>
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

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-1.5 bg-primary text-primary-foreground shadow-sm">
          <CollapsibleBody content={message.content} mode="raw" />
        </div>
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
  thinking: string;
  tools: Map<string, ToolInfo>;
}

const LiveReasoningPopup = memo(function LiveReasoningPopup({
  isStreaming,
  thinking,
  tools,
}: LiveReasoningPopupProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Store content locally so it persists after streaming ends
  const [storedThinking, setStoredThinking] = useState("");
  const [storedTools, setStoredTools] = useState<Map<string, ToolInfo>>(new Map());
  const [userHasScrolled, setUserHasScrolled] = useState(false);

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
      dragRef.current = null;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragEnd);
      document.body.style.userSelect = "";
      // Commit the final position to React so subsequent renders keep it.
      setPosition({ x: pendingX, y: pendingY });
    };
    // Prevent text selection flicker mid-drag.
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
    window.addEventListener("pointercancel", handleDragEnd);
  }, []);

  const hasContent = thinking || tools.size > 0;

  // Always update stored content when we have live content
  useEffect(() => {
    if (thinking) setStoredThinking(thinking);
    if (tools.size > 0) setStoredTools(new Map(tools));
  }, [thinking, tools]);

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
          setStoredThinking("");
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
    }
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
  }, [thinking, tools, storedThinking, storedTools, userHasScrolled]);

  // Use live content while streaming, stored content after
  const displayThinking = isStreaming ? thinking : storedThinking;
  const displayTools = isStreaming ? tools : storedTools;

  if (!isVisible) return null;

  const handleClose = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsFadingOut(false);
      setStoredThinking("");
      setStoredTools(new Map());
    }, 500);
  };

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
      }`}
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
        <button
          onClick={handleClose}
          className="text-muted-foreground/50 hover:text-foreground transition-colors rounded-md p-0.5 hover:bg-muted"
          aria-label="Close reasoning panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* Thinking */}
        {displayThinking && (
          <div className="text-xs">
            <div className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400 mb-1.5">
              <Brain className="h-3 w-3" />
              <span>Thinking</span>
            </div>
            <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {displayThinking}
            </p>
          </div>
        )}

        {/* Tools */}
        {displayTools.size > 0 && (
          <TooltipProvider delayDuration={200}>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Wrench className="h-3 w-3" />
                <span>Tools ({displayTools.size})</span>
              </div>
              {Array.from(displayTools.entries()).map(([toolId, tool]) => {
                const description = getToolDescription(tool.name, tool.input);
                const duration = formatDuration(tool.startedAt, tool.completedAt);
                return (
                  <Tooltip key={toolId}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs cursor-help hover:bg-muted/60 transition-colors">
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
                        {duration && (
                          <span className="text-muted-foreground/60 text-[10px] tabular-nums shrink-0">
                            {duration}
                          </span>
                        )}
                        <Info className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" align="start" className="max-w-md max-h-60 overflow-auto">
                      <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
                        {formatToolJson(tool)}
                      </pre>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        )}
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
  const hasContent = reasoning.thinking || reasoning.tools.size > 0;

  if (!hasContent) return null;

  const totalDuration = computeThinkingDurationFromMap(reasoning.tools);
  const label = totalDuration ? `Thought for ${totalDuration}` : "Thinking";

  return (
    <div className="rounded-lg bg-muted/30 border border-border/40 mb-2 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer text-left"
      >
        <Brain className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-medium text-muted-foreground flex-1">{label}</span>
        {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
      </button>
      {isOpen && (
        <TooltipProvider delayDuration={200}>
          <div className="px-3 pb-3 space-y-3">
            {reasoning.thinking && (
              <div className="text-xs text-muted-foreground">
                <p className="whitespace-pre-wrap line-clamp-10 leading-relaxed">{reasoning.thinking}</p>
              </div>
            )}
            {reasoning.tools.size > 0 && (
              <div className="space-y-1">
                {Array.from(reasoning.tools.entries()).map(([toolId, tool]) => {
                  const description = getToolDescription(tool.name, tool.input);
                  const duration = formatDuration(tool.startedAt, tool.completedAt);
                  return (
                    <Tooltip key={toolId}>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs cursor-help hover:bg-muted/60 transition-colors">
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
                          {duration && (
                            <span className="text-muted-foreground/60 text-[10px] tabular-nums shrink-0">
                              {duration}
                            </span>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left" align="start" className="max-w-md max-h-80 overflow-auto">
                        <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
                          {formatToolJson(tool)}
                        </pre>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        </TooltipProvider>
      )}
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

  return (
    <div className="rounded-lg bg-muted/30 border border-border/40 mb-2 overflow-hidden">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer text-left"
      >
        <Brain className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-medium text-muted-foreground flex-1">{label}</span>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60 shrink-0" />}
        {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
      </button>
      {isOpen && isLoading && (
        <div className="px-3 pb-3 text-xs text-muted-foreground/70">Loading reasoning…</div>
      )}
      {isOpen && !isLoading && entries && (
        <TooltipProvider delayDuration={200}>
          <div className="px-3 pb-3 space-y-3">
            {entries.map((entry, idx) => {
              if (entry.type === "thinking") {
                return (
                  <div key={`thinking-${idx}`} className="text-xs text-muted-foreground">
                    <p className="whitespace-pre-wrap line-clamp-10 leading-relaxed">{entry.content}</p>
                  </div>
                );
              }
              if (entry.type === "tool") {
                const result = toolResults.get(entry.id);
                const description = getToolDescription(entry.name, entry.input);
                const toolData = result || { name: entry.name, input: entry.input };
                const duration = formatDuration(result?.startedAt, result?.completedAt);

                return (
                  <Tooltip key={`tool-${entry.id}`}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs cursor-help hover:bg-muted/60 transition-colors">
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
                        {duration && (
                          <span className="text-muted-foreground/60 text-[10px] tabular-nums shrink-0">
                            {duration}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" align="start" className="max-w-md max-h-80 overflow-auto">
                      <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
                        {formatToolJson(toolData)}
                      </pre>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return null;
            })}
          </div>
        </TooltipProvider>
      )}
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
  streamingThinking,
  streamingTools,
  pendingUserMessage,
  lastReasoning,
  onStop,
  onClearSession,
  placeholder = "Ask the AI to help build your demo...",
  title = "Your AI Assistant",
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [userHasScrolledChat, setUserHasScrolledChat] = useState(false);
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
  }, [messages, streamingContent, streamingThinking, streamingTools, userHasScrolledChat]);

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
              onClick={onClearSession}
              disabled={isStreaming || isClearingSession}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-destructive px-2 py-1.5 rounded-md hover:bg-destructive/5 transition-all disabled:opacity-40 disabled:pointer-events-none"
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
                <div className="flex flex-col items-center gap-4 max-w-[260px] text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-muted/60">
                    <MessageSquare className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground/70 mb-1">Start a conversation</p>
                    <p className="text-xs text-muted-foreground/50 leading-relaxed">
                      Ask the AI to help you design and build your demo
                    </p>
                  </div>
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

      {/* Input area */}
      <div className="shrink-0 p-3 pt-2">
        <div className="rounded-xl border border-border/60 bg-muted/20 shadow-sm focus-within:border-border focus-within:shadow-md transition-all">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            className="min-h-[44px] max-h-[160px] resize-none text-sm border-0 shadow-none bg-transparent focus-visible:ring-0 rounded-xl rounded-b-none px-3.5 py-3"
            rows={1}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[10px] text-muted-foreground/40 select-none pl-1.5">
              {isStreaming ? "Generating..." : "Enter to send"}
            </span>
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

      {/* Live reasoning popup */}
      <LiveReasoningPopup
        isStreaming={isStreaming}
        thinking={streamingThinking || ""}
        tools={streamingTools || new Map()}
      />
    </div>
  );
});

export default ChatPanel;
