/**
 * Chat panel component for the project page.
 * Displays conversation history and input for interacting with Claude.
 */

import { memo, useRef, useEffect, useState, useCallback } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ScrollArea } from "../ui/scroll-area";
import { Prose } from "../markdown-prose";
import type { Message } from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (message: string) => Promise<void>;
  isStreaming: boolean;
  streamingContent: string;
  onStop?: () => void;
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

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? "U" : "AI"}
      </div>

      {/* Message content */}
      <div
        className={`flex-1 max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isError
            ? "bg-destructive/10 border border-destructive/30"
            : "bg-muted"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-sm">
            <Prose className="text-inherit">{message.content}</Prose>
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
            )}
          </div>
        )}
      </div>
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
  streamingContent,
  onStop,
  placeholder = "Ask the AI to help build your demo...",
  title = "Use-Case Architect",
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

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
        <p className="text-xs text-muted-foreground mt-0.5">
          AI-powered assistant for building Databricks demos
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.length === 0 && !isStreaming && (
            <div className="text-center text-muted-foreground text-sm py-8">
              <p>No messages yet.</p>
              <p className="mt-1">
                Ask me to help you build your demo!
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming message */}
          {isStreaming && streamingContent && (
            <MessageBubble
              message={{ role: "assistant", content: streamingContent }}
              isStreaming
            />
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="shrink-0 p-4 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            className="min-h-[60px] max-h-[200px] resize-none text-sm"
            rows={2}
          />
          <div className="flex flex-col gap-2">
            {isStreaming ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={onStop}
                className="h-full"
              >
                Stop
              </Button>
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
    </div>
  );
});

export default ChatPanel;
