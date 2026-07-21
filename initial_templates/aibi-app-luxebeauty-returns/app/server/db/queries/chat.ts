import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  conversations,
  feedback,
  messages,
  type ThinkingEntry,
} from '../schema.js';

export async function listConversations(db: AppDb, userEmail: string) {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userEmail, userEmail))
    .orderBy(desc(conversations.updatedAt));
}

export async function createConversation(
  db: AppDb,
  userEmail: string,
  title: string,
) {
  const rows = await db
    .insert(conversations)
    .values({ userEmail, title })
    .returning();
  return rows[0];
}

/**
 * Get-or-create the single persistent conversation for the floating chat
 * dock, scoped to the current user. One `kind='demo_dock'` row per user.
 */
export async function getOrCreateDockConversation(
  db: AppDb,
  userEmail: string,
) {
  const existing = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.userEmail, userEmail),
        eq(conversations.kind, 'demo_dock'),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const rows = await db
    .insert(conversations)
    .values({
      userEmail,
      title: 'Assistant',
      kind: 'demo_dock',
    })
    .returning();
  return rows[0];
}

export async function getConversationWithMessages(
  db: AppDb,
  userEmail: string,
  id: string,
) {
  const convoRows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userEmail, userEmail)));
  const convo = convoRows[0];
  if (!convo) return null;
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.position), asc(messages.createdAt));
  return { ...convo, messages: msgs };
}

export async function deleteConversation(
  db: AppDb,
  userEmail: string,
  id: string,
) {
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userEmail, userEmail)))
    .returning({ id: conversations.id });
  return rows.length > 0;
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
  const thinkingJson = JSON.stringify(thinking ?? []);

  // The INSERT computes `MAX(position) + 1` from a SELECT subquery — racy
  // when two requests on the same conversation arrive in the same tick
  // (e.g. operator double-clicks "send", two browser tabs). The unique
  // index `messages_convo_pos_uq` on (conversation_id, position) turns
  // that race into a 23505 unique_violation that we retry up to 5 times.
  // Both writes (INSERT message + UPDATE conversation.updated_at) live
  // in one transaction so a failure half-way leaves nothing behind.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`
          INSERT INTO app.messages (conversation_id, role, content, position, trace_id, thinking, error, canceled)
          SELECT
            ${conversationId}::uuid,
            ${role},
            ${content},
            COALESCE((SELECT MAX(position) FROM app.messages WHERE conversation_id = ${conversationId}::uuid), -1) + 1,
            ${traceId ?? null},
            ${thinkingJson}::jsonb,
            ${error ?? null},
            ${canceled ?? false}
          RETURNING id, position
        `);
        await tx
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
        return rows.rows[0] as { id: string; position: number };
      });
    } catch (e) {
      const pgCode = (e as { cause?: { code?: string }; code?: string })
        .cause?.code ?? (e as { code?: string }).code;
      const isPositionRace =
        pgCode === '23505' &&
        /messages_convo_pos_uq/.test((e as Error).message ?? '');
      if (isPositionRace && attempt < MAX_ATTEMPTS) {
        // Another insert beat us to this position — recompute MAX + 1.
        continue;
      }
      throw e;
    }
  }
  // Unreachable — the loop either returns or throws.
  throw new Error('appendMessage: exhausted retries');
}

export async function renameConversationIfDefault(
  db: AppDb,
  id: string,
  title: string,
) {
  await db
    .update(conversations)
    .set({ title })
    .where(and(eq(conversations.id, id), eq(conversations.title, 'New conversation')));
}

export async function getMessageById(db: AppDb, id: string) {
  const rows = await db.select().from(messages).where(eq(messages.id, id));
  return rows[0] ?? null;
}

export async function insertFeedback(
  db: AppDb,
  args: {
    messageId: string;
    userEmail: string;
    value: 'up' | 'down';
    rationale?: string;
    traceId?: string | null;
    mlflowAssessmentId?: string | null;
  },
) {
  const rows = await db
    .insert(feedback)
    .values({
      messageId: args.messageId,
      userEmail: args.userEmail,
      value: args.value,
      rationale: args.rationale,
      traceId: args.traceId ?? null,
      mlflowAssessmentId: args.mlflowAssessmentId ?? null,
    })
    .returning();
  return rows[0];
}
