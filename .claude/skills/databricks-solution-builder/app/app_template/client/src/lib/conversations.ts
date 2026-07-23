import { useEffect, useSyncExternalStore } from 'react';
import { okOrThrow } from './api';
import type { ThinkingEvent } from '@/chat/ThinkingPanel';

export type ConversationRow = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  position?: number;
  traceId?: string | null;
  thinking?: ThinkingEvent[];
  /** Populated on assistant rows when the agent run failed; reload-safe. */
  error?: string | null;
  /** True when the user stopped the turn (Stop button or client disconnect);
   *  reload-safe. UI renders a "Canceled by the user" banner. */
  canceled?: boolean | null;
  createdAt?: string;
};

/**
 * Client store that mirrors server conversations/messages.
 *
 * - Keeps the sidebar list in state.
 * - Keeps per-conversation messages in state for the currently open convo.
 * - Optimistic updates for user input + streaming assistant text; persistence
 *   happens server-side in /api/chat/stream, we re-fetch on completion.
 */

// Frozen empty array — returned by useConversationMessages when a convo
// isn't loaded yet. Stable reference so consumers' useMemo deps don't fire
// every render. Mutating it would throw (frozen).
const EMPTY_MESSAGES: Message[] = Object.freeze([]) as unknown as Message[];

type State = {
  list: ConversationRow[];
  listLoaded: boolean;
  /** Set if `reloadList` failed — surfaced by useConversationList. */
  listError: string | null;
  byId: Record<string, Message[]>;
  /** Per-id loading state for the messages fetch. */
  loading: Record<string, boolean>;
  /** Per-id error from the LAST failed `loadOne` (cleared on retry). */
  errors: Record<string, string>;
};

type Listener = () => void;

const INITIAL_STATE: State = {
  list: [],
  listLoaded: false,
  listError: null,
  byId: {},
  loading: {},
  errors: {},
};

class Store {
  private state: State = INITIAL_STATE;
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  private set(next: State) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  async reloadList() {
    try {
      const res = await okOrThrow(await fetch('/api/conversations'), '/api/conversations');
      const list = (await res.json()) as ConversationRow[];
      this.set({ ...this.state, list, listLoaded: true, listError: null });
    } catch (e) {
      this.set({ ...this.state, listLoaded: true, listError: (e as Error).message });
      throw e;
    }
  }

  async create(title?: string): Promise<ConversationRow> {
    const res = await okOrThrow(
      await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title ?? 'New conversation' }),
      }),
      'POST /api/conversations',
    );
    const convo = (await res.json()) as ConversationRow;
    this.set({
      ...this.state,
      list: [convo, ...this.state.list],
      byId: { ...this.state.byId, [convo.id]: [] },
    });
    return convo;
  }

  async loadOne(id: string) {
    // Clear any prior error for this id when starting a fresh load.
    const { [id]: _priorErr, ...restErrors } = this.state.errors;
    void _priorErr;
    this.set({
      ...this.state,
      loading: { ...this.state.loading, [id]: true },
      errors: restErrors,
    });
    try {
      const res = await okOrThrow(
        await fetch(`/api/conversations/${id}`),
        `GET /api/conversations/${id}`,
      );
      const convo = (await res.json()) as ConversationRow & { messages: Message[] };
      this.set({
        ...this.state,
        byId: { ...this.state.byId, [id]: convo.messages ?? [] },
        loading: { ...this.state.loading, [id]: false },
      });
      return convo;
    } catch (e) {
      // Record the error so useConversationError surfaces it instead of an
      // empty state that looks like "no messages yet".
      this.set({
        ...this.state,
        loading: { ...this.state.loading, [id]: false },
        errors: { ...this.state.errors, [id]: (e as Error).message },
      });
      throw e;
    }
  }

  isLoading(id: string): boolean {
    return this.state.loading[id] === true;
  }

  errorFor(id: string): string | null {
    return this.state.errors[id] ?? null;
  }

  async remove(id: string) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    const { [id]: _gone, ...byId } = this.state.byId;
    void _gone;
    const { [id]: _err, ...errors } = this.state.errors;
    void _err;
    this.set({
      ...this.state,
      list: this.state.list.filter((c) => c.id !== id),
      byId,
      errors,
    });
  }

  /** Optimistic message append — not persisted (server does that). */
  appendLocal(id: string, msg: Message) {
    const prev = this.state.byId[id] ?? [];
    this.set({ ...this.state, byId: { ...this.state.byId, [id]: [...prev, msg] } });
  }

  /** Update the last message's content in-place (for streaming). */
  updateLastLocal(id: string, content: string) {
    const prev = this.state.byId[id] ?? [];
    if (prev.length === 0) return;
    const next = [...prev];
    next[next.length - 1] = { ...next[next.length - 1], content };
    this.set({ ...this.state, byId: { ...this.state.byId, [id]: next } });
  }

  /** Patch fields (e.g. traceId) on the last message. */
  patchLastLocal(id: string, patch: Partial<Message>) {
    const prev = this.state.byId[id] ?? [];
    if (prev.length === 0) return;
    const next = [...prev];
    next[next.length - 1] = { ...next[next.length - 1], ...patch };
    this.set({ ...this.state, byId: { ...this.state.byId, [id]: next } });
  }

  /** Wipe client-side cache; call after /api/admin/reset. */
  clear() {
    this.state = INITIAL_STATE;
    this.listeners.forEach((l) => l());
  }

  /** Bump the convo's position in the list (like `updated_at` changed). */
  touch(id: string, maybeNewTitle?: string) {
    const idx = this.state.list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const hit = {
      ...this.state.list[idx],
      ...(maybeNewTitle ? { title: maybeNewTitle } : {}),
      updatedAt: new Date().toISOString(),
    };
    const rest = this.state.list.filter((c) => c.id !== id);
    this.set({ ...this.state, list: [hit, ...rest] });
  }

  messagesFor(id: string): Message[] {
    return this.state.byId[id] ?? EMPTY_MESSAGES;
  }
}

export const conversationStore = new Store();

export function useConversationList(): {
  list: ConversationRow[];
  loaded: boolean;
  error: string | null;
  retry: () => void;
} {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  useEffect(() => {
    if (!s.listLoaded) {
      conversationStore.reloadList().catch((e) => {
        console.error('[conversations] reloadList failed', e);
      });
    }
  }, [s.listLoaded]);
  return {
    list: s.list,
    loaded: s.listLoaded,
    error: s.listError,
    retry: () => {
      conversationStore.reloadList().catch((e) => {
        console.error('[conversations] retry reloadList failed', e);
      });
    },
  };
}

export function useConversationMessages(id: string | undefined): Message[] {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  useEffect(() => {
    if (id && !(id in s.byId) && !(id in s.errors)) {
      conversationStore.loadOne(id).catch((e) => {
        console.error(`[conversations] loadOne(${id}) failed`, e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Return the frozen empty sentinel (not a fresh `[]`) when nothing is
  // loaded yet, so consumers' useMemo deps don't fire every render.
  return id ? s.byId[id] ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
}

export function useConversationLoading(id: string | undefined): boolean {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  if (!id) return false;
  // Considered "loading" only when we're actively fetching OR we haven't
  // started yet (no byId, no recorded error). An errored convo is NOT
  // loading — useConversationError returns the message so the view can
  // render an actionable error state instead of an infinite spinner.
  if (s.loading[id] === true) return true;
  if (id in s.errors) return false;
  return !(id in s.byId);
}

/** Last-load error for a conversation, or null if none. The hook also
 *  exposes a `retry` so views can offer the user a "Try again" button. */
export function useConversationError(id: string | undefined): {
  error: string | null;
  retry: () => void;
} {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  return {
    error: id ? s.errors[id] ?? null : null,
    retry: () => {
      if (!id) return;
      conversationStore.loadOne(id).catch((e) => {
        console.error(`[conversations] retry loadOne(${id}) failed`, e);
      });
    },
  };
}
