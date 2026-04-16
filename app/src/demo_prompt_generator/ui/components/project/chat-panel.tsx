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
import type { Message, ReasoningEntry } from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolInfo {
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
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

  // Truncate long descriptions
  if (description.length > 60) {
    description = description.slice(0, 57) + "...";
  }

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
  message: Message | { role: string; content: string; is_error?: boolean };
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = "is_error" in message && message.is_error;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 bg-primary text-primary-foreground shadow-sm">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 ${
          isError
            ? "bg-destructive/5 border border-destructive/20 text-destructive"
            : "bg-muted/60"
        }`}
      >
        <div className="text-sm">
          <Prose compact className="text-inherit text-sm">{message.content}</Prose>
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 ml-0.5 bg-foreground/70 animate-pulse rounded-full align-text-bottom" />
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

  // Reset scroll tracking when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setUserHasScrolled(false);
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
      className={`fixed top-20 right-4 w-96 max-h-80 bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl z-50 flex flex-col overflow-hidden transition-all duration-500 ${
        isFadingOut ? "opacity-0 translate-x-4 scale-95" : "opacity-100 translate-x-0 scale-100"
      }`}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3.5 py-2.5 border-b border-border/50">
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
                return (
                  <Tooltip key={toolId}>
                    <TooltipTrigger asChild>
                      <div className="flex items-start gap-2 px-2.5 py-1.5 bg-muted/40 rounded-lg text-xs cursor-help hover:bg-muted/60 transition-colors">
                        <div className="shrink-0 mt-0.5">
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
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{tool.name}</span>
                            {description && (
                              <span className="text-muted-foreground font-mono truncate text-[10px]">
                                {description}
                              </span>
                            )}
                            <Info className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                          </div>
                        </div>
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

  return (
    <div className="mt-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Reasoning ({reasoning.tools.size} tool{reasoning.tools.size !== 1 ? "s" : ""})</span>
      </button>
      {isOpen && (
        <TooltipProvider delayDuration={200}>
          <div className="mt-2 space-y-2 pl-3 border-l-2 border-border/50">
            {reasoning.thinking && (
              <div className="text-xs text-muted-foreground">
                <div className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400 mb-1">
                  <Brain className="h-3 w-3" />
                  <span>Thinking</span>
                </div>
                <p className="whitespace-pre-wrap line-clamp-10">{reasoning.thinking}</p>
              </div>
            )}
            {reasoning.tools.size > 0 && (
              <div className="space-y-0.5">
                {Array.from(reasoning.tools.entries()).map(([toolId, tool]) => {
                  const description = getToolDescription(tool.name, tool.input);
                  return (
                    <Tooltip key={toolId}>
                      <TooltipTrigger asChild>
                        <div className="flex items-start gap-1.5 text-xs cursor-help hover:bg-muted/50 rounded-md px-1.5 -mx-1 py-0.5 transition-colors">
                          <div className="shrink-0 mt-0.5">
                            {tool.isError ? (
                              <X className="h-3 w-3 text-destructive" />
                            ) : (
                              <Check className="h-3 w-3 text-green-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{tool.name}</span>
                              {description && (
                                <span className="text-muted-foreground font-mono truncate">
                                  {description}
                                </span>
                              )}
                              <Info className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                            </div>
                          </div>
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
  entries: ReasoningEntry[];
}

const CollapsibleReasoningFromMetadata = memo(function CollapsibleReasoningFromMetadata({ entries }: CollapsibleReasoningFromMetadataProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!entries || entries.length === 0) return null;

  const toolCount = entries.filter(e => e.type === "tool").length;

  // Merge tool and tool_result entries for display
  const toolResults = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean }>();
  for (const entry of entries) {
    if (entry.type === "tool") {
      toolResults.set(entry.id, { name: entry.name, input: entry.input });
    } else if (entry.type === "tool_result") {
      const existing = toolResults.get(entry.tool_id);
      if (existing) {
        existing.result = entry.content;
        existing.isError = entry.is_error;
      }
    }
  }

  return (
    <div className="mt-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Reasoning ({toolCount} tool{toolCount !== 1 ? "s" : ""})</span>
      </button>
      {isOpen && (
        <TooltipProvider delayDuration={200}>
          <div className="mt-2 space-y-2 pl-3 border-l-2 border-border/50">
            {entries.map((entry, idx) => {
              if (entry.type === "thinking") {
                return (
                  <div key={`thinking-${idx}`} className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400 mb-1">
                      <Brain className="h-3 w-3" />
                      <span>Thinking</span>
                    </div>
                    <p className="whitespace-pre-wrap line-clamp-10">{entry.content}</p>
                  </div>
                );
              }
              if (entry.type === "tool") {
                const result = toolResults.get(entry.id);
                const description = getToolDescription(entry.name, entry.input);
                const toolData = result || { name: entry.name, input: entry.input };

                return (
                  <Tooltip key={`tool-${entry.id}`}>
                    <TooltipTrigger asChild>
                      <div className="flex items-start gap-1.5 text-xs cursor-help hover:bg-muted/50 rounded-md px-1.5 -mx-1 py-0.5 transition-colors">
                        <div className="shrink-0 mt-0.5">
                          {result?.isError ? (
                            <X className="h-3 w-3 text-destructive" />
                          ) : (
                            <Check className="h-3 w-3 text-green-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{entry.name}</span>
                            {description && (
                              <span className="text-muted-foreground font-mono truncate">
                                {description}
                              </span>
                            )}
                            <Info className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                          </div>
                        </div>
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
        <div className="p-4 space-y-4">
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
            const hasReasoningData = isAssistant && msg.reasoning_data?.reasoning && msg.reasoning_data.reasoning.length > 0;

            return (
              <div key={msg.id}>
                {/* Show reasoning from reasoning_data (saved in DB) */}
                {hasReasoningData && (
                  <div className="mb-1.5 ml-0">
                    <CollapsibleReasoningFromMetadata entries={msg.reasoning_data!.reasoning!} />
                  </div>
                )}
                {/* Fallback: show lastReasoning for the last assistant message if no reasoning_data */}
                {!hasReasoningData && !isStreaming && lastReasoning && isLastAssistant && (
                  <div className="mb-1.5">
                    <CollapsibleReasoning reasoning={lastReasoning} />
                  </div>
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
              <div className="max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 bg-muted/60">
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
