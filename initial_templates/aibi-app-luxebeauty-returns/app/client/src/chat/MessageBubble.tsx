/**
 * Shared message bubble renderer. One component, two variants:
 *   - `variant="full"`     → ChatView (route `/c/:id`), larger type
 *   - `variant="compact"`  → ChatDock (floating popup), tighter layout
 *
 * Behaviour is identical:
 *   - user messages: right-aligned primary bubble
 *   - assistant messages: AI avatar + markdown body + optional
 *     reasoning toggle + optional feedback row + optional error banner
 *   - while streaming, an empty assistant bubble shows the rotating
 *     `<LiveStatus />` ticker alongside a spinner
 *
 * Keeping this together means changing how messages look is a one-file
 * edit. Before the refactor, ChatView and ChatDock each had their own
 * ~70-line `MessageBubble` / `Bubble` — they drifted.
 */
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Spinner } from '@databricks/appkit-ui/react';
import { FeedbackRow } from './FeedbackRow';
import { LiveStatus } from './LiveStatus';
import { ThinkingEventList, type ThinkingEvent } from './ThinkingPanel';

export type DisplayMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  traceId?: string | null;
  thinking?: ThinkingEvent[];
  error?: string | null;
  /** True when the turn was stopped by the user (Stop button or page
   *  disconnect). Renders a "Canceled by the user" banner below content. */
  canceled?: boolean | null;
};

type Variant = 'full' | 'compact';

export function MessageBubble({
  message,
  variant,
  streaming,
  workspaceUrl,
  experimentId,
}: {
  message: DisplayMessage;
  variant: Variant;
  streaming: boolean;
  workspaceUrl: string;
  experimentId: string | null;
}) {
  const [showThinking, setShowThinking] = useState(false);
  const s = sizingFor(variant);
  const {
    role,
    content,
    thinking = [],
    traceId = null,
    error = null,
    canceled = false,
    id,
  } = message;
  // Suppress feedback when the turn was canceled — no point thumbing-up
  // an answer the user stopped on purpose.
  const showFeedback = role === 'assistant' && !!content && !streaming && !canceled;

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className={`${s.userMaxW} rounded-2xl rounded-br-md bg-primary text-primary-foreground ${s.userPad} ${s.userText} leading-relaxed`}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${s.gap}`}>
      <div
        className={`${s.avatar} rounded-full flex items-center justify-center shrink-0 mt-0.5 text-primary-foreground font-semibold ${s.avatarText}`}
        style={{ background: 'var(--primary)' }}
      >
        AI
      </div>
      <div className="flex-1 min-w-0">
        {content ? (
          <>
            <div
              className={`prose prose-sm prose-neutral max-w-none ${s.body} [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:leading-relaxed [&_table]:my-3 [&_th]:bg-muted [&_th]:font-semibold [&_code]:font-mono`}
            >
              {/* skipHtml: the agent's markdown output is not sanitized
                 server-side, and a prompt-injected response could include
                 raw <iframe> / <style> / <a href="javascript:…"> markup.
                 ReactMarkdown doesn't execute scripts, but it does render
                 HTML tags by default. Matches ThinkingPanel's behavior. */}
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{content}</ReactMarkdown>
            </div>
            {thinking.length > 0 && !streaming && (
              <div className="mt-2">
                <button
                  onClick={() => setShowThinking((x) => !x)}
                  className={`${s.reasoningToggle} font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1`}
                >
                  {showThinking ? '▾' : '▸'} Reasoning ·{' '}
                  {thinking.filter((e) => e.kind === 'tool_call').length} tool
                  {thinking.filter((e) => e.kind === 'tool_call').length === 1
                    ? ''
                    : 's'}
                </button>
                {showThinking && (
                  <div
                    className={`mt-2 rounded-${variant === 'full' ? 'lg' : 'md'} border border-border bg-muted/30 ${s.reasoningPanelPad}`}
                  >
                    <ThinkingEventList events={thinking} />
                  </div>
                )}
              </div>
            )}
            {showFeedback && (
              <FeedbackRow
                messageId={id}
                traceId={traceId}
                workspaceUrl={workspaceUrl}
                experimentId={experimentId}
              />
            )}
          </>
        ) : streaming ? (
          <div className={`flex items-center gap-2 ${s.streamingPad}`}>
            <Spinner />
            <LiveStatus />
          </div>
        ) : error || canceled ? null : (
          // Defensive: empty content, not streaming, no error, not
          // canceled. Should never happen — the silent-failure backstops
          // in useChatTurn and the server's empty-turn guard both set
          // `error` for this case. Render a placeholder so the bubble is
          // never fully invisible if both guards somehow miss.
          <div className={`${s.errorText} text-muted-foreground italic`}>
            No response was generated.
          </div>
        )}
        {/* Canceled + error banners render BELOW the content so the user
            sees the partial answer first, then the reason it stopped. */}
        {canceled && !streaming && (
          <div className={`rounded-${variant === 'full' ? 'lg' : 'md'} border border-amber-500/40 bg-amber-500/10 ${s.errorPad} ${s.errorText} text-amber-700 dark:text-amber-300 mt-2`}>
            <div className="font-semibold">Canceled by the user</div>
          </div>
        )}
        {error && !streaming && (
          <div className={`rounded-${variant === 'full' ? 'lg' : 'md'} border border-destructive/40 bg-destructive/5 ${s.errorPad} ${s.errorText} text-destructive mt-2`}>
            <div className="font-semibold text-[10px] uppercase tracking-wide mb-0.5">
              The agent hit an error
            </div>
            <div className="whitespace-pre-wrap break-words">{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Per-variant sizing. Keeps the JSX above readable + makes the differences
// between full and compact explicit.
function sizingFor(variant: Variant) {
  if (variant === 'full') {
    return {
      gap: 'gap-3',
      avatar: 'size-8',
      avatarText: 'text-xs',
      userMaxW: 'max-w-[75%]',
      userPad: 'px-4 py-2.5',
      userText: 'text-[15px]',
      body: 'text-[15px]',
      errorPad: 'px-3 py-2 text-sm',
      errorText: 'text-sm',
      reasoningToggle: 'text-[11px]',
      reasoningPanelPad: 'px-4 py-3',
      streamingPad: 'pt-2',
    };
  }
  return {
    gap: 'gap-2',
    avatar: 'size-6',
    avatarText: 'text-[10px]',
    userMaxW: 'max-w-[85%]',
    userPad: 'px-3 py-2',
    userText: 'text-sm',
    body: 'text-sm',
    errorPad: 'px-2.5 py-1.5',
    errorText: 'text-[12px]',
    reasoningToggle: 'text-[10px]',
    reasoningPanelPad: 'px-3 py-2',
    streamingPad: 'pt-1.5',
  };
}
