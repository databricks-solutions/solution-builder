/**
 * Full-page chat view, routed at `/c/:id`.
 *
 * Peer of `ChatDock` (the floating bottom-right popup). The send-a-turn
 * engine is in `useChatTurn`, the bubble in `MessageBubble`, and the
 * event taxonomy in `streamChat` — this file is just the page shell
 * (header, scroll region, empty state, input form, suggested-next chip)
 * wired to the shared `conversationStore` for route-scoped history.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ArrowRight, ArrowUp, Sparkles, Square } from 'lucide-react';
import { Spinner } from '@databricks/appkit-ui/react';
import { ThinkingPanel } from './ThinkingPanel';
import { MessageBubble } from './MessageBubble';
import { pickNextStep } from './script';
import { useChatTurn } from './useChatTurn';
import {
  conversationStore,
  useConversationError,
  useConversationList,
  useConversationLoading,
  useConversationMessages,
} from '@/lib/conversations';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';

export function ChatView() {
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const conversationId = params.id!;

  const { list } = useConversationList();
  const msgs = useConversationMessages(conversationId);
  const loading = useConversationLoading(conversationId);
  const convoErr = useConversationError(conversationId);
  const convo = list.find((c) => c.id === conversationId);

  const [input, setInput] = useState('');
  // me + config come from SessionProvider — one fetch shared with every
  // other consumer (header, sidebar, home, dock, …).
  const { me, config } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);
  // "Stuck to bottom" — autoscroll on new messages, but only while the
  // user hasn't scrolled up. Re-engages when they scroll back to the
  // bottom. Same pattern as ChatDock + ThinkingPanel.
  const stickToBottomRef = useRef(true);
  const pendingConsumed = useRef(false);

  // Reset to sticky whenever we land on a new conversation route — old
  // conversation's scroll position must NOT bleed into the new one.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [conversationId]);

  function onMessagesScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickToBottomRef.current = nearBottom;
  }

  // Shared send-turn engine. Handlers bind to the global conversation store
  // so optimistic updates persist across remounts + show in the sidebar.
  const turn = useChatTurn({
    conversationId,
    handlers: {
      appendUser: (content) => {
        conversationStore.appendLocal(conversationId, { role: 'user', content });
        conversationStore.touch(
          conversationId,
          content.slice(0, 48) + (content.length > 48 ? '…' : ''),
        );
      },
      appendAssistant: () =>
        conversationStore.appendLocal(conversationId, {
          role: 'assistant',
          content: '',
        }),
      updateLast: (content) =>
        conversationStore.updateLastLocal(conversationId, content),
      patchLast: (patch) => conversationStore.patchLastLocal(conversationId, patch),
      getMessages: () => conversationStore.messagesFor(conversationId),
      onTurnEnd: async () => {
        // Operations page + activity feed subscribe to `dataMutated` — kicks
        // them to refetch so the agent's writes show up immediately.
        dataMutated.emit();
        // Final scroll-to-bottom only if the user hasn't scrolled away;
        // respects the same stick rule as the streaming-update effect.
        if (stickToBottomRef.current) {
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
            });
          });
        }
      },
    },
  });

  // Autoscroll on new messages / streaming tokens — only when stuck.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [msgs, turn.streaming, loading]);

  // If navigated from home with a pending prompt, consume + send.
  useEffect(() => {
    if (pendingConsumed.current) return;
    const pending = (location.state as { pendingPrompt?: string } | null)
      ?.pendingPrompt;
    if (pending && conversationId) {
      pendingConsumed.current = true;
      navigate(location.pathname, { replace: true, state: null });
      void turn.send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Sending always means the user wants to see the reply → re-engage stick.
    stickToBottomRef.current = true;
    void turn.send(input);
    setInput('');
  }

  const title = convo?.title ?? 'Conversation';
  const nextStep = useMemo(
    () => pickNextStep(config?.assistantScript ?? [], msgs),
    [config, msgs],
  );
  const firstStep = config?.assistantScript?.[0] ?? null;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] w-full relative bg-background">
      {!turn.thinkingClosed && (
        <ThinkingPanel
          events={turn.thinkingEvents}
          streaming={turn.streaming}
          completed={turn.thinkingCompleted}
          onClose={() => turn.setThinkingClosed(true)}
        />
      )}
      <div className="px-4 sm:px-8 py-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h2 className="font-medium text-foreground truncate">{title}</h2>
        </div>
      </div>
      <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 space-y-6">
          {loading && msgs.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <Spinner />
            </div>
          )}
          {convoErr.error && msgs.length === 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              <div className="font-semibold mb-1">Couldn't load conversation</div>
              <div className="text-destructive/80 mb-2">{convoErr.error}</div>
              <button
                type="button"
                onClick={convoErr.retry}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs hover:bg-destructive/15 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !convoErr.error && msgs.length === 0 && !turn.streaming && firstStep && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="size-14 rounded-full bg-muted flex items-center justify-center">
                <Sparkles className="size-6 text-muted-foreground" />
              </div>
              <div>
                <div className="font-semibold text-base">New conversation</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  I can investigate your data and take action on returns.
                </div>
              </div>
              <button
                onClick={() => {
                  stickToBottomRef.current = true;
                  void turn.send(firstStep.prompt);
                }}
                className="max-w-full rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-foreground/30 hover:shadow-sm transition-all inline-flex items-center gap-2"
              >
                <span className="truncate">
                  {firstStep.label ?? firstStep.prompt}
                </span>
                <ArrowRight className="size-3.5 shrink-0" />
              </button>
            </div>
          )}
          {msgs.map((m, i) => {
            const isStreamingLast =
              turn.streaming && i === msgs.length - 1 && m.role === 'assistant';
            return (
              <MessageBubble
                key={m.id ?? i}
                message={{
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  traceId: m.traceId ?? null,
                  thinking: m.thinking ?? [],
                  error: m.error ?? null,
                }}
                variant="full"
                streaming={isStreamingLast}
                workspaceUrl={me?.workspaceUrl ?? ''}
                // The agent's traces land in `agentMlflowExperimentId`
                // (auto-created at boot from `agentMlflowExperimentPath`).
                // Fall back to the hardcoded `mlflowExperimentId` for
                // setups that pin a legacy experiment via config.
                experimentId={
                  config?.agentMlflowExperimentId ??
                  config?.mlflowExperimentId ??
                  null
                }
              />
            );
          })}
        </div>
      </div>
      <div className="border-t border-border bg-background">
        {nextStep && !turn.streaming && msgs.length > 0 && (
          <div className="max-w-4xl mx-auto px-4 sm:px-8 pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5">
              Suggested next
            </div>
            <button
              onClick={() => {
                stickToBottomRef.current = true;
                void turn.send(nextStep.prompt);
              }}
              className="w-full text-left rounded-lg border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-4 py-2.5 text-sm text-foreground transition-all flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {nextStep.label ?? nextStep.prompt}
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        )}
        <form onSubmit={onSubmit} className="px-4 sm:px-8 py-4">
          <div className="max-w-4xl mx-auto flex items-end gap-2 rounded-2xl border-2 border-foreground/10 bg-card px-4 py-2.5 focus-within:border-foreground/30 transition-colors">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up…"
              disabled={turn.streaming}
              className="flex-1 bg-transparent outline-none text-base placeholder:text-muted-foreground py-1.5"
            />
            {turn.streaming ? (
              <button
                type="button"
                onClick={turn.stop}
                className="inline-flex items-center justify-center size-9 rounded-full bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
                aria-label="Stop"
                title="Stop"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex items-center justify-center size-9 rounded-full bg-foreground text-background disabled:opacity-30 hover:opacity-90 transition-opacity"
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
