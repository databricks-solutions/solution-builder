import { randomUUID } from 'node:crypto';
import type { AppDb } from '../index.js';
import type { Conversation, ThinkingEntry } from '../schema.js';

export async function listConversations(db: AppDb, userEmail: string) {
  return [...db.conversations.values()]
    .filter((c) => c.userEmail === userEmail)
    .sort((a, b) => +b.updatedAt - +a.updatedAt)
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
}

export async function createConversation(
  db: AppDb,
  userEmail: string,
  title: string,
  kind: Conversation['kind'] = 'default',
) {
  const now = new Date();
  const c: Conversation = { id: randomUUID(), userEmail, title, kind, createdAt: now, updatedAt: now };
  db.conversations.set(c.id, c);
  db.messages.set(c.id, []);
  return c;
}

export async function getOrCreateDockConversation(db: AppDb, userEmail: string) {
  const existing = [...db.conversations.values()].find(
    (c) => c.userEmail === userEmail && c.kind === 'demo_dock',
  );
  return existing ?? createConversation(db, userEmail, 'Assistant', 'demo_dock');
}

export async function getConversationWithMessages(db: AppDb, userEmail: string, id: string) {
  const c = db.conversations.get(id);
  if (!c || c.userEmail !== userEmail) return null;
  return { ...c, messages: db.messages.get(id) ?? [] };
}

export async function deleteConversation(db: AppDb, userEmail: string, id: string) {
  const c = db.conversations.get(id);
  if (!c || c.userEmail !== userEmail) return false;
  db.conversations.delete(id);
  db.messages.delete(id);
  return true;
}

export async function appendMessage(
  db: AppDb,
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  traceId?: string,
  thinking?: ThinkingEntry[],
  error?: string,
  canceled?: boolean,
) {
  const list = db.messages.get(conversationId);
  if (!list) throw new Error(`conversation ${conversationId} not found`);
  const m = {
    id: randomUUID(),
    conversationId,
    role,
    content,
    position: list.length,
    traceId: traceId ?? null,
    thinking: thinking ?? [],
    error: error ?? null,
    canceled: canceled ?? false,
    createdAt: new Date(),
  };
  list.push(m);
  const c = db.conversations.get(conversationId);
  if (c) c.updatedAt = new Date();
  return m;
}

export async function renameConversationIfDefault(db: AppDb, conversationId: string, title: string) {
  const c = db.conversations.get(conversationId);
  // 'Assistant' is the demo_dock row's placeholder title (see getOrCreateDockConversation).
  if (c && (c.title === 'New conversation' || c.title === 'Assistant')) c.title = title;
}

export async function getMessageById(db: AppDb, id: string) {
  for (const list of db.messages.values()) {
    const m = list.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

export async function insertFeedback(db: AppDb, row: Record<string, unknown>) {
  const r = { id: randomUUID(), ...row, createdAt: new Date() };
  db.feedback.push(r);
  return r as { id: string };
}
