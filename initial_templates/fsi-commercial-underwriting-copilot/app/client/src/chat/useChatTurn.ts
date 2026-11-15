/**
 * `useChatTurn` — the send-a-turn engine shared by ChatView + ChatDock.
 *
 * Why this exists: both surfaces previously duplicated ~130 lines of
 * "start a turn, wire event handlers, stream into state, stop on abort,
 * snapshot thinking onto the assistant message on completion, refetch
 * history from the DB to pick up message IDs" boilerplate. This hook
 * captures all of that behind a single `send(text)` callback.
 *
 * Surface differences between the two callers:
 *   - ChatView uses the global `conversationStore` (optimistic append
 *     across mounts) — it wires `onAppend*` + `onPatchLast` callbacks to
 *     the store's helpers.
 *   - ChatDock owns local state (floating popup, not route-scoped) — it
 *     wires the same callbacks to its `setMessages` reducer.
 *
 * Keeping rendering concerns in each caller (EmptyState, suggested-next
 * chip, header, layout) was the right call — those really do differ. The
 * engine part is universal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from './streamChat';
import type { ThinkingEvent } from './ThinkingPanel';

/** Minimal shape of a chat message the hook needs to build the stream payload. */
type ChatTurnMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type UseChatTurnHandlers = {
  /** Append a user message optimistically. Called first when `send()` fires. */
  appendUser: (content: string) => void;
  /** Append an empty assistant bubble we'll stream into. */
  appendAssistant: () => void;
  /** Replace the streaming assistant bubble's content as deltas arrive. */
  updateLast: (content: string) => void;
  /** Patch fields (traceId, thinking, error, canceled) on the last message. */
  patchLast: (patch: {
    traceId?: string | null;
    thinking?: ThinkingEvent[];
    error?: string | null;
    canceled?: boolean;
    content?: string;
  }) => void;
  /** Read the latest messages (used to build the stream payload). */
  getMessages: () => ChatTurnMessage[];
  /** Called after the stream ends so the caller can refetch from the DB. */
  onTurnEnd?: () => void | Promise<void>;
};

export type UseChatTurnOptions = {
  /** Null while the conversation id is still being resolved. */
  conversationId: string | null;
  handlers: UseChatTurnHandlers;
};

export type UseChatTurnResult = {
  streaming: boolean;
  thinkingEvents: ThinkingEvent[];
  thinkingCompleted: boolean;
  thinkingClosed: boolean;
  setThinkingClosed: (v: boolean) => void;
  /** Call to start a turn. No-op while streaming or with empty text. */
  send: (text: string) => Promise<void>;
  /** Aborts the in-flight stream; the bubble gets a `canceled` flag and
   *  MessageBubble renders the "Canceled by the user" banner. */
  stop: () => void;
};

export function useChatTurn({
  conversationId,
  handlers,
}: UseChatTurnOptions): UseChatTurnResult {
  const [streaming, setStreaming] = useState(false);
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([]);
  const [thinkingCompleted, setThinkingCompleted] = useState(false);
  const [thinkingClosed, setThinkingClosed] = useState(false);
  // Ref mirror so handlers that fire after the last render (e.g. onCompleted
  // inside send's closure) can read the latest thinking events.
  const thinkingEventsRef = useRef<ThinkingEvent[]>([]);
  useEffect(() => {
    thinkingEventsRef.current = thinkingEvents;
  }, [thinkingEvents]);
  const abortRef = useRef<AbortController | null>(null);
  // Keep handlers in a ref so `send`'s identity stays stable across renders.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming || !conversationId) return;

      const h = handlersRef.current;
      // Build the payload BEFORE appending — `appendUser` is a setState that
      // hasn't flushed yet, so `getMessages()` would return the stale list
      // and the user's just-typed message would be missing from the payload
      // (server then rejects with "Empty message"). Read prior messages,
      // drop empty-content rows (failed prior turns leave an empty assistant
      // bubble in state — see `appendAssistant` + `patchLast({error})`),
      // then explicitly append the new user turn.
      const prior = h
        .getMessages()
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0,
        )
        .map((m) => ({ role: m.role, content: m.content }));
      const payload = [...prior, { role: 'user', content: trimmed }];
      h.appendUser(trimmed);
      h.appendAssistant();

      setStreaming(true);
      setThinkingEvents([]);
      setThinkingCompleted(false);
      setThinkingClosed(false);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Defensive flags: track whether the stream actually produced
      // anything useful. If everything stays false at end-of-stream
      // (no delta, no final, no error event, no abort, no completed
      // event), the bubble would render fully empty + invisible. The
      // `finally` block patches a generic error so the user always
      // sees SOMETHING after waiting.
      let sawAnyText = false;
      let sawError = false;
      let sawCompleted = false;
      try {
        let assistantText = '';
        await streamChat(
          { conversationId, messages: payload, signal: ctrl.signal },
          {
            onDelta: (delta) => {
              sawAnyText = true;
              assistantText += delta;
              h.updateLast(assistantText);
            },
            onFinalMessage: (t) => {
              sawAnyText = true;
              assistantText = t;
              h.updateLast(t);
            },
            onToolCall: (c) =>
              setThinkingEvents((xs) => [
                ...xs,
                {
                  kind: 'tool_call',
                  callId: c.callId,
                  name: c.name,
                  args: c.args,
                },
              ]),
            onToolOutput: (o) =>
              setThinkingEvents((xs) => [
                ...xs,
                { kind: 'tool_output', callId: o.callId, output: o.output },
              ]),
            onIntermediateMessage: (t) =>
              setThinkingEvents((xs) => [
                ...xs,
                { kind: 'intermediate_message', text: t },
              ]),
            onReasoningDelta: (delta) =>
              setThinkingEvents((xs) => {
                const last = xs[xs.length - 1];
                if (last?.kind === 'reasoning_stream') {
                  return [
                    ...xs.slice(0, -1),
                    { kind: 'reasoning_stream', text: last.text + delta },
                  ];
                }
                return [...xs, { kind: 'reasoning_stream', text: delta }];
              }),
            onReasoningDone: (text) =>
              setThinkingEvents((xs) => {
                const last = xs[xs.length - 1];
                if (last?.kind === 'reasoning_stream') {
                  return [
                    ...xs.slice(0, -1),
                    { kind: 'intermediate_message', text },
                  ];
                }
                return [...xs, { kind: 'intermediate_message', text }];
              }),
            onCompleted: (traceId) => {
              sawCompleted = true;
              setThinkingCompleted(true);
              // Snapshot the live events onto the assistant message so the
              // "▸ Reasoning · N tools" toggle is available immediately,
              // without waiting for the post-stream DB refetch.
              h.patchLast({
                traceId,
                thinking: thinkingEventsRef.current,
              });
            },
            // Surface the server-side error in the bubble's red panel
            // (rendered by MessageBubble when `error` is set) — NOT inside
            // `content`, which is the assistant's normal text.
            onError: (err) => {
              sawError = true;
              h.patchLast({ error: err });
            },
          },
        );
      } catch (e) {
        const err = e as Error;
        const aborted = ctrl.signal.aborted || err.name === 'AbortError';
        if (aborted) {
          // Flag the bubble as canceled; the MessageBubble renders the
          // "Canceled by the user" banner. Whatever streamed text we have
          // stays in `content` for context — the user sees how far the
          // agent got before they stopped it.
          h.patchLast({ canceled: true });
        } else {
          sawError = true;
          h.patchLast({ error: err.message || String(err) });
        }
      } finally {
        // Silent-failure backstop: stream closed cleanly but produced no
        // text, no error, no completion signal — the bubble would be empty
        // + invisible. Surface a generic "no response" so the user isn't
        // left guessing. Aborts (Stop button / disconnect) already set
        // `canceled` above and skip this branch.
        const aborted = ctrl.signal.aborted;
        if (!aborted && !sawAnyText && !sawError) {
          const msg = sawCompleted
            ? 'The agent finished without sending a response. Check the server logs.'
            : 'The connection closed before the agent could respond. Check the server logs.';
          console.error('[chat] silent failure', { sawCompleted, sawAnyText, sawError });
          h.patchLast({ error: msg });
        }
        abortRef.current = null;
        setStreaming(false);
        setThinkingCompleted(true);
        await handlersRef.current.onTurnEnd?.();
      }
    },
    [conversationId, streaming],
  );

  return {
    streaming,
    thinkingEvents,
    thinkingCompleted,
    thinkingClosed,
    setThinkingClosed,
    send,
    stop,
  };
}
