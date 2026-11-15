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
// Retention desk — Lakebase OLTP mirror of the lakehouse + the desk's own state
// ============================================================================

/** One row per at-risk account the desk works (Critical/High/Medium tiers from
 *  churn_scores), denormalized with profile, features, SHAP driver shares and the
 *  latest AI-analyzed care call. The desk's own state (status, staged offer,
 *  decision, audit trail) lives on the same row. */
export const retentionCases = appSchema.table(
  'retention_cases',
  {
    customerId: text('customer_id').primaryKey(),
    customerName: text('customer_name').notNull(),
    segment: text('segment').notNull(),
    plan: text('plan').notNull(),
    lines: integer('lines').notNull(),
    region: text('region').notNull(),
    market: text('market').notNull(),
    cellSiteId: text('cell_site_id').notNull(),
    tenureMonths: integer('tenure_months').notNull(),
    contractType: text('contract_type').notNull(),
    monthlyBill: doublePrecision('monthly_bill').notNull(),
    churnProbability: doublePrecision('churn_probability').notNull(),
    riskTier: text('risk_tier').notNull(),
    topDriver: text('top_driver').notNull(),
    drivers: jsonb('drivers').$type<Record<string, number>>().notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    signals: jsonb('signals').$type<Record<string, number>>().notNull(),
    annualRevenueAtRisk: doublePrecision('annual_revenue_at_risk').notNull(),
    lastCall: jsonb('last_call').$type<LastCall | null>(),
    status: text('status', { enum: ['open', 'offer_ready', 'accepted', 'declined'] })
      .notNull()
      .default('open'),
    stagedOffer: jsonb('staged_offer').$type<StagedOffer | null>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cases_tier_idx').on(t.riskTier, t.annualRevenueAtRisk),
    index('cases_status_idx').on(t.status),
  ],
);

/** offer_catalog mirror + the historical save rate of each offer per driver
 *  (from retention_offer_history) — the inputs of the guardrail engine. */
export const offers = appSchema.table('offers', {
  offerCode: text('offer_code').primaryKey(),
  offerName: text('offer_name').notNull(),
  targetDriver: text('target_driver').notNull(),
  description: text('description').notNull(),
  costType: text('cost_type').notNull(),
  costValue: doublePrecision('cost_value').notNull(),
  durationMonths: integer('duration_months').notNull(),
  eligibility: text('eligibility').notNull(),
  guardrailPct: doublePrecision('guardrail_pct').notNull(),
  grossMarginPct: doublePrecision('gross_margin_pct').notNull(),
  saveRates: jsonb('save_rates').$type<Record<string, { n: number; rate: number }>>().notNull(),
});

export type LastCall = {
  callId: string;
  callTs: string;
  sentiment: string;
  intent: string;
  cancelThreat: boolean;
  competitor: string | null;
  requestedRemedy: string | null;
  summary: string;
  transcript: string;
};

export type StagedOffer = {
  offerCode: string;
  offerName: string;
  cost: number;
  guardrailCap: number;
  expectedSaveRate: number;
  expectedRetainedRevenue: number;
  channel: 'sms' | 'email' | 'call';
  subject: string;
  message: string;
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
  action: 'scored' | 'offer_staged' | 'accepted' | 'declined' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
