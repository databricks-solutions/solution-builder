import {
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*`.
 *
 * Two groups:
 *   1. Chat state   (conversations, messages, feedback) — the dock agent's
 *                   reload-safe history (thinking + error columns included).
 *   2. Planning     (plans, plan_events) — mitigation plans for supply
 *                   exposures (proposed by the copilot or the planner, booked
 *                   by the planner) + an append-only audit trail. Booked plans
 *                   are also written back to Delta (sop_plan_decisions).
 *
 * Why Lakebase: transactional Postgres semantics sitting next to the
 * lakehouse, with Unity Catalog governance. Lets the agent do real
 * transactional writes while the analytics layer still queries Delta.
 */
export const appSchema = pgSchema('app');

// ============================================================================
// Chat state
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    // 'default' for regular chats, 'demo_dock' for the floating dock's
    // persistent conversation (one per user).
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    // Captured reasoning steps (tool calls, outputs, intermediate messages)
    // for assistant messages. Shape matches client's ThinkingEvent union.
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    // If the agent run failed, the error message is persisted here so a
    // page reload still shows what went wrong (instead of an empty bubble).
    error: text('error'),
    // True when the turn was stopped by the user (Stop button or page
    // navigation away from an in-flight stream). The assistant's partial
    // streamed content is still kept in `content` for context; the UI
    // renders a "Canceled by the user" banner below it.
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Unique on (conversation_id, position) so the `SELECT MAX + 1` race in
    // appendMessage surfaces as a constraint error (caller retries) instead
    // of silently inserting two messages at the same position — which
    // would break the on-reload ordering. Doubles as the lookup index.
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Planning write surface — mitigation plans for supply exposures.
// The exposures themselves (projection, POs, levers) are read from the Delta
// gold tables (services/planner.ts). Lakebase holds what the planner and the
// copilot DO about them: proposed / booked plans + an append-only audit trail.
// A booked plan is also written back to Delta (sop_plan_decisions).
// ============================================================================

export type PlanAction = {
  optionId: string;
  type: 'transfer' | 'expedite' | 'alternate' | 'safety_stock';
  title: string;
  qty: number;
  cost: number;
  arrivalDate: string | null;
  documentNumber?: string;
};

export type PlanTotals = {
  planCost: number;
  annualCarryingCost: number;
  unitsShortBefore: number;
  unitsShortAfter: number;
  revenueAtRiskBefore: number;
  revenueAtRiskAfter: number;
  revenueProtected: number;
  weeksBelowSafetyStock: number;
  eoReleased: number;
  approver: string;
};

export const plans = appSchema.table(
  'plans',
  {
    id: text('id').primaryKey(), // PLN-xxxxxx
    exposureId: text('exposure_id').notNull(),
    status: text('status', { enum: ['proposed', 'booked'] }).notNull(),
    actions: jsonb('actions').$type<PlanAction[]>().notNull(),
    totals: jsonb('totals').$type<PlanTotals>().notNull(),
    rationale: text('rationale'),
    proposedBy: text('proposed_by').notNull(), // 'copilot' | user email
    bookedBy: text('booked_by'),
    deltaWritten: boolean('delta_written').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
  },
  (t) => [index('plans_exposure_idx').on(t.exposureId, t.status)],
);

export const planEvents = appSchema.table(
  'plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exposureId: text('exposure_id').notNull(),
    planId: text('plan_id'),
    actor: text('actor').notNull(),
    kind: text('kind', { enum: ['proposed', 'booked', 'note'] }).notNull(),
    detail: text('detail').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('plan_events_exposure_idx').on(t.exposureId, t.at)],
);

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
