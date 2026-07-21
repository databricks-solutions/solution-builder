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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { ArrowRight, ArrowUp, ChevronLeft, PenSquare, Sparkles, Square, X } from 'lucide-react';
import { Spinner } from '@databricks/appkit-ui/react';
import {
  fetchDockConversation,
  useSession,
  type ScriptStep,
} from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from './dockController';
import { conversationStore } from '@/lib/conversations';
import { ThinkingPanel } from './ThinkingPanel';
import { MessageBubble, type DisplayMessage } from './MessageBubble';
import { pickNextStep } from './script';
import { useChatTurn } from './useChatTurn';

// localStorage key — remembers the conversation the user is actively
// using IN THE DOCK so navigation between pages doesn't lose it. Cleared
// when the user explicitly closes the dock with the X button. Per-tab is
// fine; sessionStorage would lose it across reloads of the same tab,
// which is the opposite of what we want.
const DOCK_CONV_STORAGE_KEY = 'app:dock:active-conversation-id';

export function ChatDock() {
  const location = useLocation();

  // me + config come from the SessionProvider — fetched ONCE at the
  // app root and reused everywhere. No per-component fetches here.
  const { me, config } = useSession();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  // Loading flags — keep the UI honest about what's happening:
  //   • `loading`     → fetching an existing conversation's history
  //   • `creatingNew` → POST /api/conversations is in flight
  // Both render a Spinner so the user never sees "weird empty state".
  const [loading, setLoading] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // "Stuck to bottom" — autoscroll on new messages, but only while the user
  // hasn't scrolled up. Flips back on once they scroll back to the bottom.
  // Same pattern as ThinkingPanel.
  const stickToBottomRef = useRef(true);
  // Forward-ref to the chat-turn `stop()` so `startNewConversation` can
  // abort any in-flight stream BEFORE clearing UI state (otherwise the
  // old turn keeps writing to setMessages of the new conversation).
  // The actual fn is set right after useChatTurn() runs below.
  const turnStopRef = useRef<(() => void) | null>(null);
  const pendingAutoSend = useRef<string | null>(null);
  // Bumped every time dockController fires send/new. The auto-send effect
  // depends on this so a click while the dock is ALREADY open + idle
  // (deps `open`/`conversationId`/`streaming` all unchanged) still triggers
  // the send. Without this, the banner click on an already-open dock would
  // queue the prompt into `pendingAutoSend` but never consume it.
  const [autoSendNonce, setAutoSendNonce] = useState(0);
  // Tracks the last /c/:id we saw; if the user navigates away from that
  // route, the dock auto-adopts that conversation so the chat carries over.
  const lastChatRouteId = useRef<string | null>(null);

  const hidden = location.pathname.startsWith('/c/');

  // Fetch a conversation's history and swap it into the dock. History is
  // set BEFORE conversationId so the pending-auto-send effect doesn't race
  // against the fetch. Sets `loading` so the messages area shows a spinner
  // while the request is in flight (avoids briefly rendering "Ask me
  // anything" empty state during the swap).
  const loadConversation = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
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
        setConversationId(id);
        // Reset to sticky on a fresh load so the new conversation lands at
        // the bottom (state-of-the-art chat scroll behavior).
        stickToBottomRef.current = true;
        return;
      }
      // 404 (or other non-OK): the cached id points to a row that no
      // longer exists — e.g. the DB was wiped or the row was deleted
      // between sessions. Do NOT adopt this id; that would cause every
      // chat turn to FK-violate on insert into app.messages. Drop the
      // cache and fall back to the demo_dock conversation so the dock
      // has a valid row to write into.
      console.warn(`[dock] conversation ${id} not found (HTTP ${res.status}) — clearing cache and re-resolving dock conversation`);
      try { window.localStorage.removeItem(DOCK_CONV_STORAGE_KEY); } catch { /* no-op */ }
      setMessages([]);
      try {
        const convo = await fetchDockConversation();
        setConversationId(convo.id);
        stickToBottomRef.current = true;
      } catch (e) {
        console.error('[dock] fallback to demo_dock failed', e);
        // Leave conversationId null — the first user send will create one
        // via the explicit startNewConversation path.
      }
    } catch (e) {
      console.error('[dock] load conversation failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a brand-new conversation, clear the dock, adopt in place. Always
  // creates a fresh row — the `creatingNew` flag drives a spinner so even
  // if the POST is slow the user sees feedback instead of a frozen button.
  //
  // RACE NOTE: while the POST is in flight, `conversationId` is null AND
  // `open` is true, which would otherwise trigger the "first open / restore"
  // effect below. That effect would read the stale localStorage id and
  // overwrite our state with the OLD conversation just before the new id
  // arrives. Two protections:
  //   1. We clear localStorage immediately so the restore effect can't pick
  //      up a stale id, even if it fires during the POST.
  //   2. The restore effect explicitly skips while `creatingNew` is true.
  const startNewConversation = useCallback(
    async (title = 'New conversation'): Promise<string | null> => {
      // Abort any in-flight stream FIRST. If a previous turn is still
      // streaming, its reader keeps writing to setMessages — we'd see
      // "first message arrives then stops" because the stale stream is
      // overwriting the new conversation's empty state. Aborting also
      // lets the auto-send effect fire (it waits for streaming=false).
      turnStopRef.current?.();
      setCreatingNew(true);
      // Clear immediately — both UI state AND the restore-pointer — so
      // nothing can resurrect the previous conversation while we wait.
      try {
        window.localStorage.removeItem(DOCK_CONV_STORAGE_KEY);
      } catch { /* private mode / storage disabled — no-op */ }
      setMessages([]);
      setConversationId(null);
      stickToBottomRef.current = true;
      try {
        const convo = await conversationStore.create(title);
        setConversationId(convo.id);
        try {
          window.localStorage.setItem(DOCK_CONV_STORAGE_KEY, convo.id);
        } catch { /* private mode / storage disabled — no-op */ }
        return convo.id;
      } catch (e) {
        console.error('[dock] new conversation failed', e);
        return null;
      } finally {
        setCreatingNew(false);
      }
    },
    [],
  );

  // First open → resolve which conversation to show. Priority order:
  //   1. localStorage (the user was just chatting before a navigation)
  //   2. /api/dock-conversation (the persistent demo_dock fallback)
  // This is what makes "open dock → navigate → reopen dock" feel
  // continuous rather than dropping back to the demo_dock conversation.
  //
  // Skip while `creatingNew` is true — see the RACE NOTE on
  // startNewConversation. Otherwise this effect would race against the
  // POST and adopt the stale localStorage id.
  useEffect(() => {
    if (!open || conversationId || creatingNew) return;
    void (async () => {
      const stored = (() => {
        try {
          return window.localStorage.getItem(DOCK_CONV_STORAGE_KEY);
        } catch { return null; }
      })();
      if (stored) {
        await loadConversation(stored);
        return;
      }
      try {
        const convo = await fetchDockConversation();
        await loadConversation(convo.id);
      } catch (e) {
        console.error('[dock] fetch demo_dock failed', e);
      }
    })();
  }, [open, conversationId, creatingNew, loadConversation]);

  // Persist the active conversation id whenever it changes while the dock
  // is open — survives route changes (the dock unmounts on `/c/:id`) and
  // tab reloads. We DON'T persist when the dock is closed because closing
  // is the user's "I'm done" signal.
  useEffect(() => {
    if (!open || !conversationId) return;
    try {
      window.localStorage.setItem(DOCK_CONV_STORAGE_KEY, conversationId);
    } catch { /* no-op */ }
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
    // We deliberately depend ONLY on location.pathname — adding
    // `loadConversation` and `conversationId` would re-run this effect on
    // every conversation switch, fighting against the user's intent. We
    // only care about the route transition itself. `loadConversation` is
    // stable (useCallback with []), so reading the latest one off the
    // closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // External controller: open / openAndSend / newAndSend from any page.
  useEffect(() => {
    return dockController.subscribe((req) => {
      setOpen(true);
      if (req.action === 'send') {
        pendingAutoSend.current = req.prompt;
        setAutoSendNonce((n) => n + 1);
      } else if (req.action === 'new') {
        pendingAutoSend.current = req.prompt;
        setAutoSendNonce((n) => n + 1);
        const title =
          req.prompt.slice(0, 48) + (req.prompt.length > 48 ? '…' : '');
        void startNewConversation(title);
      }
    });
  }, [startNewConversation]);

  // Closing the dock is the user's "I'm done" signal — drop the persisted
  // conversation pointer so the next open starts clean (demo_dock fallback).
  const closeDock = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.removeItem(DOCK_CONV_STORAGE_KEY);
    } catch { /* no-op */ }
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
      // After the stream ends, refetch to pick up server-assigned IDs
      // (needed for feedback) + persisted thinking trail.
      //
      // Belt-and-braces against the [DONE]-vs-persist race: only adopt the
      // refetched list if it's at least as long as the optimistic state AND
      // its last message is an assistant with content. Otherwise the server
      // hasn't persisted our turn yet — keep the optimistic bubble so the
      // user doesn't see their answer disappear. The race itself is fixed
      // server-side (persist BEFORE [DONE] — see chat-stream/index.ts),
      // but this guards against any future regression of that ordering.
      onTurnEnd: async () => {
        if (!conversationId) return;
        try {
          const res = await fetch(`/api/conversations/${conversationId}`);
          if (res.ok) {
            const detail = (await res.json()) as { messages: DisplayMessage[] };
            const incoming = detail.messages ?? [];
            const incomingLast = incoming[incoming.length - 1];
            setMessages((current) => {
              const lostContent =
                incoming.length < current.length ||
                incomingLast?.role !== 'assistant' ||
                !(incomingLast.content?.trim()?.length ?? 0);
              if (lostContent) {
                console.warn(
                  '[dock] refetch missing the just-streamed assistant — keeping optimistic state',
                  { current: current.length, incoming: incoming.length },
                );
                return current;
              }
              return incoming.map((m) => ({
                ...m,
                traceId: m.traceId ?? null,
                thinking: m.thinking ?? [],
                error: m.error ?? null,
              }));
            });
          }
        } catch {
          /* keep optimistic state */
        }
        dataMutated.emit();
      },
    },
  });

  // Expose `turn.stop` to startNewConversation via a ref — see comment at
  // turnStopRef declaration. Updates every render (cheap, just a ref write).
  turnStopRef.current = turn.stop;

  // Consume pending auto-send once the conversation is ready AND no
  // previous turn is still streaming. Without the streaming check we'd
  // silently lose the prompt: useChatTurn.send returns early when
  // streaming is true (it can't run two turns concurrently), but the
  // effect would still null out pendingAutoSend.current — the chip click
  // would just disappear. Re-running on `streaming` flipping to false
  // means the queued prompt fires the moment the previous turn ends.
  useEffect(() => {
    if (!open || !conversationId || !pendingAutoSend.current) return;
    if (turn.streaming) return; // wait for in-flight turn to finish
    const prompt = pendingAutoSend.current;
    pendingAutoSend.current = null;
    void turn.send(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId, turn.streaming, autoSendNonce]);

  // Autoscroll on new messages / streaming tokens — but ONLY if the user
  // hasn't scrolled up. Once they scroll up they break the stick; once
  // they scroll back to the bottom it re-engages. State-of-the-art chat
  // scroll: Slack / iMessage / ChatGPT all do this.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, turn.streaming, loading]);

  function onMessagesScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    // 40px tolerance — "close enough to the bottom" still counts as stuck.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickToBottomRef.current = nearBottom;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Sending always means the user is engaged with the latest reply →
    // re-stick to bottom so the response streams into view.
    stickToBottomRef.current = true;
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
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 inline-flex items-center gap-2 sm:gap-3 rounded-full px-4 sm:px-6 py-3 sm:py-3.5 text-sm sm:text-base font-semibold shadow-lg hover:shadow-xl hover:scale-105 active:scale-100 transition-all duration-200"
          style={{
            background: 'var(--dock-gradient)',
            color: 'var(--primary-foreground)',
          }}
        >
          <Sparkles className="size-5 animate-sparkle" />
          <span className="hidden sm:inline">Ask the assistant — from question to resolution</span>
          <span className="sm:hidden">Ask the assistant</span>
        </button>
      )}

      {open && (
        // Mobile: full-screen sheet (inset-0, no rounded corners).
        // Tablet/desktop: fixed 440×760 dock flush against the bottom-right
        // corner (no margin) — reads as a docked panel, not a floating
        // popup. Only the top-left corner gets rounded so the inside corner
        // against the viewport edge stays sharp.
        <div className="fixed inset-0 sm:inset-auto sm:bottom-0 sm:right-0 z-40 sm:w-[440px] sm:h-[760px] sm:max-h-[92vh] sm:rounded-tl-2xl border-0 sm:border-l sm:border-t border-border bg-card shadow-2xl flex flex-col overflow-hidden">
          {/* Header — clicking anywhere on it (outside the action buttons)
              collapses the dock. Same behavior as the X button.
              On mobile the dock is full-screen, so we add a prominent
              "Back" chevron on the LEFT to make the close affordance
              obvious (the small X top-right is easy to miss on a phone). */}
          <div
            onClick={closeDock}
            className="px-3 sm:px-4 py-3 border-b border-border flex items-center justify-between cursor-pointer select-none"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            role="button"
            aria-label="Collapse assistant"
            title="Click to collapse"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 text-sm font-semibold">
              {/* Phone-only Back chevron. stopPropagation isn't needed —
                  clicking it ALSO collapses the dock (same handler), the
                  chevron just makes it look like a "back" action. */}
              <button
                type="button"
                onClick={closeDock}
                className="sm:hidden -ml-1 p-1 rounded hover:bg-[var(--on-primary-hover)] transition-colors"
                aria-label="Back"
                title="Back"
              >
                <ChevronLeft className="size-5" strokeWidth={2.5} />
              </button>
              <Sparkles className="size-4 hidden sm:inline" />
              Assistant
            </div>
            {/* stopPropagation so clicking the inner buttons doesn't also
                trigger the header's collapse handler. */}
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => void startNewConversation()}
                // Disabled while a turn is streaming OR a previous "new"
                // POST hasn't returned yet — prevents double-creates.
                disabled={turn.streaming || creatingNew}
                className="p-1.5 rounded hover:bg-[var(--on-primary-hover)] transition-colors disabled:opacity-40"
                title="New conversation"
                aria-label="New conversation"
              >
                {creatingNew ? <Spinner /> : <PenSquare className="size-4" />}
              </button>
              <button
                onClick={closeDock}
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
            onScroll={onMessagesScroll}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-background"
          >
            {/* Conversation switch in flight — show a spinner so the user
                never sees a stale-then-empty flash. */}
            {loading && messages.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <Spinner />
              </div>
            )}
            {/* `pendingAutoSend.current` guard: if a banner click queued a
                prompt that hasn't been consumed yet, suppress the empty
                state so we don't briefly flash the "default first question"
                between loadConversation finishing and the auto-send effect
                running. */}
            {!loading && messages.length === 0 && !turn.streaming && !creatingNew && !pendingAutoSend.current && (
              <EmptyState
                firstStep={config?.assistantScript?.[0] ?? null}
                onPick={(p) => {
                  stickToBottomRef.current = true;
                  void turn.send(p);
                }}
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
                  // The agent's traces land in `agentMlflowExperimentId`
                  // (the experiment we auto-create at server boot from
                  // `agentMlflowExperimentPath`). Fall back to the
                  // hardcoded `mlflowExperimentId` for setups that pin a
                  // legacy experiment via config.
                  experimentId={
                    config?.agentMlflowExperimentId ??
                    config?.mlflowExperimentId ??
                    null
                  }
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
                onClick={() => {
                  stickToBottomRef.current = true;
                  void turn.send(nextStep.prompt);
                }}
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
