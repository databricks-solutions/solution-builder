import {
  text,
  timestamp,
  uuid,
  integer,
  doublePrecision,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*`.
 *
 * Template shape — three groups:
 *   1. Chat state      (conversations, messages, feedback) — REUSE AS-IS.
 *                      Every use case has chat. The `thinking` + `error`
 *                      jsonb/text columns on `messages` make conversations
 *                      reload-safe with full reasoning trails preserved.
 *   2. Delta mirror    (customers, orders, returns) — REPLACE for your
 *                      use case. These are the OLTP-friendly copies of
 *                      lakehouse Delta tables that `db/sync.ts` pulls at
 *                      boot. Rename + reshape for your domain.
 *   3. Write-surface   Domain-specific JSONB on the operations row. Here,
 *                      `returns.emails` + `returns.ai_audit_trail` are
 *                      append-only logs the agent writes through. This
 *                      denormalized shape (vs. side tables) makes it easy
 *                      to render a full "what happened to this record"
 *                      timeline without joins. Mirror this pattern on
 *                      whatever your primary operations entity is.
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
// Live-ops console — Lakebase OLTP mirror of the lakehouse + the console's own state
// ============================================================================

/** One row per at-risk player segment (top churn driver x region, from
 *  gold_risk_segments), denormalized with the evidence, average SHAP driver
 *  shares, the top at-risk players and (toxicity) AI-labelled chat samples.
 *  The console's own state (status, staged plan, schedule, audit) lives on the
 *  same row. */
export const segments = appSchema.table(
  'segments',
  {
    segmentId: text('segment_id').primaryKey(),
    segmentName: text('segment_name').notNull(),
    churnDriver: text('churn_driver').notNull(),
    region: text('region').notNull(),
    playersAtRisk: integer('players_at_risk').notNull(),
    criticalPlayers: integer('critical_players').notNull(),
    highPlayers: integer('high_players').notNull(),
    avgChurnProbability: doublePrecision('avg_churn_probability').notNull(),
    atRiskLtv: doublePrecision('at_risk_ltv').notNull(),
    ltvBook: doublePrecision('ltv_book').notNull(),
    payersAtRisk: integer('payers_at_risk').notNull(),
    whalesAtRisk: integer('whales_at_risk').notNull(),
    newPlayersAtRisk: integer('new_players_at_risk').notNull(),
    drivers: jsonb('drivers').$type<Record<string, number>>().notNull(),
    evidence: jsonb('evidence').$type<EvidenceTile[]>().notNull().default([]),
    topPlayers: jsonb('top_players').$type<TopPlayer[]>().notNull().default([]),
    chatSample: jsonb('chat_sample').$type<ChatLine[]>().notNull().default([]),
    status: text('status', { enum: ['open', 'plan_ready', 'scheduled', 'rejected'] })
      .notNull()
      .default('open'),
    stagedPlan: jsonb('staged_plan').$type<StagedPlan | null>(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    scheduledBy: text('scheduled_by'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('segments_driver_idx').on(t.churnDriver, t.atRiskLtv), index('segments_status_idx').on(t.status)],
);

/** intervention_catalog mirror + the holdout-measured lift of each intervention
 *  (from liveops_history) — the inputs of the plan engine. */
export const interventions = appSchema.table('interventions', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  targetDriver: text('target_driver').notNull(),
  kind: text('kind').notNull(),
  scope: text('scope').notNull(),
  description: text('description').notNull(),
  fixedCost: doublePrecision('fixed_cost').notNull(),
  costPerPlayer: doublePrecision('cost_per_player').notNull(),
  leadTimeDays: integer('lead_time_days').notNull(),
  history: jsonb('history').$type<{ runs: number; liftPp: number; costPerRetained: number }>().notNull(),
});

/** Live-ops budget for the planning month (liveops_budget mirror). */
export const budget = appSchema.table('budget', {
  month: text('month').primaryKey(),
  description: text('description').notNull(),
  budgetUsd: doublePrecision('budget_usd').notNull(),
});

export type EvidenceTile = { label: string; value: string; bad?: boolean; hint?: string };

export type TopPlayer = {
  playerId: string;
  gamertag: string;
  spenderTier: string;
  platform: string;
  churnProbability: number;
  riskTier: string;
  predictedLtv: number;
  atRiskLtv: number;
  reasons: string[];
};

export type ChatLine = { messageId: string; sentAt: string; channel: string; text: string; label: string; harmful: boolean };

export type StagedPlan = {
  interventionCode: string;
  interventionName: string;
  scope: string;
  coveredSegments: string[];
  playersTargeted: number;
  cost: number;
  expectedLift: number;
  expectedPlayersRetained: number;
  expectedLtvRetained: number;
  roi: number;
  budgetRemainingAfter: number;
  startDate: string;
  playerMessage: string;
  rationale: string;
  stagedBy: string;
  stagedAt: string;
};

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type AuditEntry = {
  at: string;
  by: string;
  action: 'scored' | 'plan_staged' | 'scheduled' | 'rejected' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
