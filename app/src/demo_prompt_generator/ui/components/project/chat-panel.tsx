/**
 * Chat panel component for the project page.
 * Displays conversation history and input for interacting with Claude.
 */

import { memo, useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Prose } from "../markdown-prose";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Server, Database, Boxes, Pencil, Loader2, Check, X, Brain, Wrench, ChevronDown, ChevronRight, Trash2, Info } from "lucide-react";
import type { Message, ReasoningEntry } from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResourceInfo {
  clusterName?: string | null;
  warehouseName?: string | null;
  catalog?: string | null;
  schema?: string | null;
}

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
  // Match patterns like /Users/.../projects/{uuid}/ or ./projects/{uuid}/
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
  resources?: ResourceInfo;
  onEditResources?: () => void;
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

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      {/* Message content */}
      <div
        className={`max-w-[90%] rounded-lg ${
          isUser
            ? "px-3 py-2 bg-primary text-primary-foreground"
            : isError
            ? "px-3 py-2 bg-destructive/10 border border-destructive/30"
            : "px-3 py-2 bg-muted"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-xs">
            <Prose className="text-inherit prose-xs">{message.content}</Prose>
            {isStreaming && (
              <span className="inline-block w-1.5 h-3 ml-1 bg-current animate-pulse" />
            )}
          </div>
        )}
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
        // Actually hide after fade animation (500ms)
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

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinking, tools, storedThinking, storedTools]);

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
      className={`fixed top-20 right-4 w-96 max-h-80 bg-background border border-border rounded-lg shadow-lg z-50 flex flex-col overflow-hidden transition-all duration-500 ${
        isFadingOut ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"
      }`}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-medium">Live Reasoning</span>
          {isStreaming && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <button
          onClick={handleClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Thinking */}
        {displayThinking && (
          <div className="text-[11px]">
            <div className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-500 mb-1">
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
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Wrench className="h-3 w-3" />
                <span>Tools ({displayTools.size})</span>
              </div>
              {Array.from(displayTools.entries()).map(([toolId, tool]) => {
                const description = getToolDescription(tool.name, tool.input);
                return (
                  <Tooltip key={toolId}>
                    <TooltipTrigger asChild>
                      <div className="flex items-start gap-2 px-2 py-1.5 bg-muted/50 rounded text-[10px] cursor-help hover:bg-muted/70">
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
                              <span className="text-muted-foreground font-mono truncate text-[9px]">
                                {description}
                              </span>
                            )}
                            <Info className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
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
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>See reasoning ({reasoning.tools.size} tool{reasoning.tools.size !== 1 ? "s" : ""})</span>
      </button>
      {isOpen && (
        <TooltipProvider delayDuration={200}>
          <div className="mt-2 space-y-2 pl-4 border-l-2 border-muted">
            {reasoning.thinking && (
              <div className="text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-500 mb-1">
                  <Brain className="h-3 w-3" />
                  <span>Thinking</span>
                </div>
                <p className="whitespace-pre-wrap line-clamp-10">{reasoning.thinking}</p>
              </div>
            )}
            {reasoning.tools.size > 0 && (
              <div className="space-y-1">
                {Array.from(reasoning.tools.entries()).map(([toolId, tool]) => {
                  const description = getToolDescription(tool.name, tool.input);
                  return (
                    <Tooltip key={toolId}>
                      <TooltipTrigger asChild>
                        <div className="flex items-start gap-1.5 text-[10px] cursor-help hover:bg-muted/50 rounded px-1 -mx-1 py-0.5">
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
                              <Info className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
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

  // Count tools for the summary
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
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>See reasoning ({toolCount} tool{toolCount !== 1 ? "s" : ""})</span>
      </button>
      {isOpen && (
        <TooltipProvider delayDuration={200}>
          <div className="mt-2 space-y-2 pl-4 border-l-2 border-muted">
            {entries.map((entry, idx) => {
              if (entry.type === "thinking") {
                return (
                  <div key={`thinking-${idx}`} className="text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-500 mb-1">
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
                      <div className="flex items-start gap-1.5 text-[10px] cursor-help hover:bg-muted/50 rounded px-1 -mx-1 py-0.5">
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
                            <Info className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
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
              // Skip tool_result entries (already merged above)
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
  resources,
  onEditResources,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages, thinking, or tools
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingThinking, streamingTools]);

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

  return (
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">{title}</h2>
        {/* Resource info row */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {resources?.clusterName && (
            <button
              onClick={onEditResources}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Cluster"
            >
              <Server className="h-3 w-3" />
              <span className="truncate max-w-[80px]">{resources.clusterName}</span>
            </button>
          )}
          {resources?.warehouseName && (
            <button
              onClick={onEditResources}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Warehouse"
            >
              <Database className="h-3 w-3" />
              <span className="truncate max-w-[80px]">{resources.warehouseName}</span>
            </button>
          )}
          {(resources?.catalog || resources?.schema) && (
            <button
              onClick={onEditResources}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Catalog.Schema"
            >
              <Boxes className="h-3 w-3" />
              <span className="truncate max-w-[100px]">
                {resources?.catalog || "default"}.{resources?.schema || "default"}
              </span>
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {onClearSession && messages.length > 0 && (
              <button
                onClick={onClearSession}
                disabled={isStreaming || isClearingSession}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                title="Clear session history"
              >
                {isClearingSession ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                <span>Clear</span>
              </button>
            )}
            {onEditResources && (
              <button
                onClick={onEditResources}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="h-3 w-3" />
                <span>Edit resources</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto p-4"
      >
        <div className="space-y-3">
          {(messages.length === 0 || isClearingSession) && !isStreaming && (
            <div className="text-center text-muted-foreground text-xs py-8">
              {isClearingSession ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p>Clearing session...</p>
                </div>
              ) : isLoadingMessages ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p>Loading messages...</p>
                </div>
              ) : (
                <>
                  <p>No messages yet.</p>
                  <p className="mt-1">
                    Ask me to help you build your demo!
                  </p>
                </>
              )}
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
                  <div className="mb-1 ml-0">
                    <CollapsibleReasoningFromMetadata entries={msg.reasoning_data!.reasoning!} />
                  </div>
                )}
                {/* Fallback: show lastReasoning for the last assistant message if no reasoning_data */}
                {!hasReasoningData && !isStreaming && lastReasoning && isLastAssistant && (
                  <div className="mb-1">
                    <CollapsibleReasoning reasoning={lastReasoning} />
                  </div>
                )}
                <MessageBubble message={msg} />
              </div>
            );
          })}

          {/* Pending user message (shown immediately while waiting for agent) */}
          {pendingUserMessage && (
            <MessageBubble
              message={{ role: "user", content: pendingUserMessage }}
            />
          )}

          {/* Streaming AI response bubble - shows loading dots until content arrives */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-lg px-3 py-2 bg-muted">
                {streamingContent ? (
                  <div className="text-xs">
                    <Prose className="text-inherit prose-xs">{streamingContent}</Prose>
                    <span className="inline-block w-1.5 h-3 ml-1 bg-current animate-pulse" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Anchor for auto-scroll to bottom */}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 p-3 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            className="min-h-[50px] max-h-[150px] resize-none text-xs"
            rows={2}
          />
          <div className="flex flex-col gap-2">
            {isStreaming ? (
              <button
                onClick={onStop}
                className="h-full min-h-[50px] w-10 flex items-center justify-center bg-destructive hover:bg-destructive/90 rounded-md transition-colors"
                title="Stop generation"
              >
                {/* Animated shape: square morphs to circle with bounce */}
                <div
                  className="w-4 h-4 bg-white"
                  style={{
                    animation: "morph 2.5s ease-in-out infinite",
                  }}
                />
                <style>{`
                  @keyframes morph {
                    0%, 15% {
                      border-radius: 2px;
                      transform: scale(1);
                    }
                    20% {
                      transform: scale(1.15);
                    }
                    25%, 45% {
                      border-radius: 50%;
                      transform: scale(1);
                    }
                    50% {
                      transform: scale(1.15);
                    }
                    55%, 100% {
                      border-radius: 2px;
                      transform: scale(1);
                    }
                  }
                `}</style>
              </button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!input.trim()}
                size="sm"
                className="h-full"
              >
                Send
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>

      {/* Live reasoning popup - floats on top-right of page */}
      <LiveReasoningPopup
        isStreaming={isStreaming}
        thinking={streamingThinking || ""}
        tools={streamingTools || new Map()}
      />
    </div>
  );
});

export default ChatPanel;
