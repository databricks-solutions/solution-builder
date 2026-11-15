import type { Conversation, Message } from './schema.js';

/** In-memory chat store (per app process). Same call surface the template's
 *  Drizzle/Lakebase store exposed, so routes/chat.ts + chat-stream are unchanged. */
export type AppDb = {
  conversations: Map<string, Conversation>;
  messages: Map<string, Message[]>;
  feedback: Array<Record<string, unknown>>;
};

export function createDb(): AppDb {
  return { conversations: new Map(), messages: new Map(), feedback: [] };
}
