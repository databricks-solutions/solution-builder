/**
 * Floating chat dock — bottom-right on every page except /c/:id.
 *
 * Template concern: this is the "assistant is always one click away" entry
 * point. Pages can call `dockController.open()` / `openAndSend(prompt)` /
 * `newAndSend(prompt)` from anywhere to surface the assistant in context
 * (see HomeView journey cards + OperationsView "Ask the assistant" banner).
 *
 * One persistent conversation per user (kind='demo_dock'), resolved via
 * /api/dock-conversation. Survives reload, scoped by user email. When the
 * user navigates to `/c/:id` and back, the dock adopts that conversation.
 *
 * The "Suggested next" chip above the input walks the configured
 * `assistantScript` (`config/app.json`): first step is always available,
 * subsequent steps unlock once the last assistant message contains any of
 * the `triggerAfter` substrings. Only the next chip is rendered — this is
 * a demo-rail, not a full tree.
 *
 * Peer of `ChatView`. The send-a-turn engine lives in `useChatTurn` and is
 * identical between the two — only layout + which conversation they point
 * at differs.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { ArrowRight, ArrowUp, PenSquare, Sparkles, Square, X } from 'lucide-react';
import {
  fetchConfig,
  fetchDockConversation,
  fetchMe,
  type AppConfig,
  type Me,
  type ScriptStep,
} from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from './dockController';
import { conversationStore } from '@/lib/conversations';
import { ThinkingPanel } from './ThinkingPanel';
import { MessageBubble, type DisplayMessage } from './MessageBubble';
import { pickNextStep } from './script';
import { useChatTurn } from './useChatTurn';

export function ChatDock() {
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingAutoSend = useRef<string | null>(null);
  // Tracks the last /c/:id we saw; if the user navigates away from that
  // route, the dock auto-adopts that conversation so the chat carries over.
  const lastChatRouteId = useRef<string | null>(null);

  const hidden = location.pathname.startsWith('/c/');

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
    fetchMe().then(setMe).catch(console.error);
  }, []);

  // Fetch a conversation's history and swap it into the dock. History is
  // set BEFORE conversationId so the pending-auto-send effect doesn't race
  // against the fetch.
  async function loadConversation(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (res.ok) {
        const detail = (await res.json()) as { messages: DisplayMessage[] };
        setMessages(
          (detail.messages ?? []).map((m) => ({
            ...m,
            traceId: m.traceId ?? null,
            thinking: m.thinking ?? [],
            error: m.error ?? null,
          })),
        );
      } else {
        setMessages([]);
      }
      setConversationId(id);
    } catch (e) {
      console.error('[dock] load conversation failed', e);
    }
  }

  // Create a brand-new conversation, clear the dock, adopt in place.
  async function startNewConversation(title = 'New conversation') {
    setMessages([]);
    setConversationId(null);
    try {
      const convo = await conversationStore.create(title);
      setConversationId(convo.id);
      return convo.id;
    } catch (e) {
      console.error('[dock] new conversation failed', e);
      return null;
    }
  }

  // First open → resolve the persistent demo_dock conversation.
  useEffect(() => {
    if (!open || conversationId) return;
    void (async () => {
      try {
        const convo = await fetchDockConversation();
        await loadConversation(convo.id);
      } catch (e) {
        console.error('[dock] fetch demo_dock failed', e);
      }
    })();
  }, [open, conversationId]);

  // Track /c/:id in the URL — when the user leaves that route, adopt it.
  useEffect(() => {
    const match = location.pathname.match(/^\/c\/([^/]+)/);
    if (match) {
      lastChatRouteId.current = match[1];
    } else if (lastChatRouteId.current) {
      const id = lastChatRouteId.current;
      lastChatRouteId.current = null;
      if (id !== conversationId) void loadConversation(id);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // External controller: open / openAndSend / newAndSend from any page.
  useEffect(() => {
    return dockController.subscribe((req) => {
      setOpen(true);
      if (req.action === 'send') {
        pendingAutoSend.current = req.prompt;
      } else if (req.action === 'new') {
        pendingAutoSend.current = req.prompt;
        const title =
          req.prompt.slice(0, 48) + (req.prompt.length > 48 ? '…' : '');
        void startNewConversation(title);
      }
    });
  }, []);

  // Use the shared send-turn engine. Handlers wire messages into local state.
  const turn = useChatTurn({
    conversationId,
    handlers: {
      appendUser: (content) =>
        setMessages((ms) => [...ms, { role: 'user', content }]),
      appendAssistant: () =>
        setMessages((ms) => [...ms, { role: 'assistant', content: '' }]),
      updateLast: (content) =>
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          if (last?.role !== 'assistant') return ms;
          return [...ms.slice(0, -1), { ...last, content }];
        }),
      patchLast: (patch) =>
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          if (last?.role !== 'assistant') return ms;
          return [...ms.slice(0, -1), { ...last, ...patch }];
        }),
      getMessages: () => messages,
      // After the stream ends, refetch to pick up the server-assigned IDs
      // (needed for feedback) + persisted thinking trail.
      onTurnEnd: async () => {
        if (!conversationId) return;
        try {
          const res = await fetch(`/api/conversations/${conversationId}`);
          if (res.ok) {
            const detail = (await res.json()) as { messages: DisplayMessage[] };
            setMessages(
              (detail.messages ?? []).map((m) => ({
                ...m,
                traceId: m.traceId ?? null,
                thinking: m.thinking ?? [],
                error: m.error ?? null,
              })),
            );
          }
        } catch {
          /* keep optimistic state */
        }
        dataMutated.emit();
      },
    },
  });

  // Consume pending auto-send once the conversation is ready.
  useEffect(() => {
    if (!open || !conversationId || !pendingAutoSend.current) return;
    const prompt = pendingAutoSend.current;
    pendingAutoSend.current = null;
    void turn.send(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);

  // Autoscroll on new messages / streaming tokens.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [messages, turn.streaming]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void turn.send(input);
    setInput('');
  }

  const nextStep = useMemo(
    () => pickNextStep(config?.assistantScript ?? [], messages),
    [config, messages],
  );

  if (hidden) return null;

  return (
    <>
      {/* Shared thinking panel — top-right, above the dock */}
      {open && !turn.thinkingClosed && (
        <ThinkingPanel
          events={turn.thinkingEvents}
          streaming={turn.streaming}
          completed={turn.thinkingCompleted}
          onClose={() => turn.setThinkingClosed(true)}
        />
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-3 rounded-full px-6 py-3.5 text-base font-semibold shadow-lg hover:shadow-xl hover:scale-105 active:scale-100 transition-all duration-200"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in oklch, var(--primary) 82%, white) 0%, var(--primary) 55%, color-mix(in oklch, var(--primary) 88%, black) 100%)',
            color: 'var(--primary-foreground)',
          }}
        >
          <Sparkles className="size-5 animate-sparkle" />
          Ask the assistant — from question to resolution
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[440px] h-[620px] max-h-[85vh] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div
            className="px-4 py-3 border-b border-border flex items-center justify-between"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4" />
              Assistant
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void startNewConversation()}
                disabled={turn.streaming}
                className="p-1.5 rounded hover:bg-[var(--on-primary-hover)] transition-colors disabled:opacity-40"
                title="New conversation"
                aria-label="New conversation"
              >
                <PenSquare className="size-4" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-[var(--on-primary-hover)] transition-colors"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-background"
          >
            {messages.length === 0 && !turn.streaming && (
              <EmptyState
                firstStep={config?.assistantScript?.[0] ?? null}
                onPick={(p) => void turn.send(p)}
              />
            )}
            {messages.map((m, i) => {
              const isStreamingLast =
                turn.streaming &&
                i === messages.length - 1 &&
                m.role === 'assistant';
              return (
                <MessageBubble
                  key={m.id ?? i}
                  message={m}
                  variant="compact"
                  streaming={isStreamingLast}
                  workspaceUrl={me?.workspaceUrl ?? ''}
                  experimentId={config?.mlflowExperimentId ?? null}
                />
              );
            })}
          </div>

          {/* Suggested-next chip above the input */}
          {nextStep && !turn.streaming && messages.length > 0 && (
            <div className="px-4 py-2 border-t border-border bg-muted/30">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5">
                Suggested next
              </div>
              <button
                onClick={() => void turn.send(nextStep.prompt)}
                className="w-full text-left rounded-md border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-3 py-2 text-sm text-foreground transition-all flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {nextStep.label ?? nextStep.prompt}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={onSubmit}
            className="border-t border-border px-3 py-2.5 bg-card flex items-end gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={turn.streaming ? 'Working…' : 'Ask anything'}
              disabled={turn.streaming}
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
            />
            {turn.streaming ? (
              <button
                type="button"
                onClick={turn.stop}
                className="inline-flex items-center justify-center size-8 rounded-md bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
                aria-label="Stop"
                title="Stop"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex items-center justify-center size-8 rounded-md bg-foreground text-background disabled:opacity-30 hover:opacity-90 transition-opacity"
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({
  firstStep,
  onPick,
}: {
  firstStep: ScriptStep | null;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center">
        <Sparkles className="size-5 text-muted-foreground" />
      </div>
      <div>
        <div className="font-semibold text-sm">Ask me anything</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          I can investigate your data and take action on returns.
        </div>
      </div>
      {firstStep && (
        <button
          onClick={() => onPick(firstStep.prompt)}
          className="mt-2 max-w-full rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-foreground/30 transition-colors inline-flex items-center gap-1.5"
        >
          <span className="truncate">
            {firstStep.label ?? firstStep.prompt}
          </span>
          <ArrowRight className="size-3 shrink-0" />
        </button>
      )}
    </div>
  );
}
