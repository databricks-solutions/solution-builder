import { useEffect, useSyncExternalStore } from 'react';
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

type State = {
  list: ConversationRow[];
  listLoaded: boolean;
  byId: Record<string, Message[]>;
  /** Per-id loading state for the messages fetch. */
  loading: Record<string, boolean>;
};

type Listener = () => void;

class Store {
  private state: State = { list: [], listLoaded: false, byId: {}, loading: {} };
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
    const res = await fetch('/api/conversations');
    if (!res.ok) throw new Error(`/api/conversations: ${res.status}`);
    const list = (await res.json()) as ConversationRow[];
    this.set({ ...this.state, list, listLoaded: true });
  }

  async create(title?: string): Promise<ConversationRow> {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? 'New conversation' }),
    });
    if (!res.ok) throw new Error(`POST /api/conversations: ${res.status}`);
    const convo = (await res.json()) as ConversationRow;
    this.set({
      ...this.state,
      list: [convo, ...this.state.list],
      byId: { ...this.state.byId, [convo.id]: [] },
    });
    return convo;
  }

  async loadOne(id: string) {
    this.set({
      ...this.state,
      loading: { ...this.state.loading, [id]: true },
    });
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error(`GET /api/conversations/${id}: ${res.status}`);
      const convo = (await res.json()) as ConversationRow & { messages: Message[] };
      this.set({
        ...this.state,
        byId: { ...this.state.byId, [id]: convo.messages ?? [] },
        loading: { ...this.state.loading, [id]: false },
      });
      return convo;
    } catch (e) {
      this.set({
        ...this.state,
        loading: { ...this.state.loading, [id]: false },
      });
      throw e;
    }
  }

  isLoading(id: string): boolean {
    return this.state.loading[id] === true;
  }

  async remove(id: string) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    const { [id]: _gone, ...byId } = this.state.byId;
    void _gone;
    this.set({
      ...this.state,
      list: this.state.list.filter((c) => c.id !== id),
      byId,
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
    this.state = { list: [], listLoaded: false, byId: {}, loading: {} };
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
    return this.state.byId[id] ?? [];
  }
}

export const conversationStore = new Store();

export function useConversationList(): {
  list: ConversationRow[];
  loaded: boolean;
} {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  useEffect(() => {
    if (!s.listLoaded) conversationStore.reloadList().catch(console.error);
  }, [s.listLoaded]);
  return { list: s.list, loaded: s.listLoaded };
}

export function useConversationMessages(id: string | undefined): Message[] {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  useEffect(() => {
    if (id && !(id in s.byId)) {
      conversationStore.loadOne(id).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return id ? s.byId[id] ?? [] : [];
}

export function useConversationLoading(id: string | undefined): boolean {
  const s = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
  );
  if (!id) return false;
  // First-fetch state: not in byId yet AND currently loading (or never
  // started loading but will be shortly via the messages effect).
  return s.loading[id] === true || !(id in s.byId);
}
