import {
  text,
  timestamp,
  date,
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
 * Two groups:
 *   1. Chat state   (conversations, messages, feedback) — the dock agent's
 *                   reload-safe history (thinking + error columns included).
 *   2. Morning Book (clients) — the advisor's households with an active
 *                   money-in-motion signal, mirrored from Delta by db/sync.ts at
 *                   boot / on "Reset demo", plus the write surface: meeting prep
 *                   (AI), outreach draft, the advisor's decision and an
 *                   append-only audit_trail.
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
// Delta mirror — the advisor's Morning Book (one row per client household with
// an active signal). Delta (financial_services.wealth_advisor_copilot) is the
// source of truth for profile, signals, ML scores and suitability results; this
// is the writable OLTP copy the app + agent read and write. Synced at boot by
// db/sync.ts; "Reset demo" re-syncs.
// ============================================================================

export const clients = appSchema.table(
  'clients',
  {
    id: text('id').primaryKey(), // household_id, e.g. HH-10042
    advisorId: text('advisor_id').notNull(),
    advisorName: text('advisor_name'),
    householdName: text('household_name').notNull(),
    primaryName: text('primary_name').notNull(),
    primaryAge: integer('primary_age'),
    segment: text('segment'),
    aum: doublePrecision('aum').notNull(),
    sweepCash: doublePrecision('sweep_cash'),
    netWorth: doublePrecision('net_worth'),
    riskProfile: text('risk_profile'),
    riskScore: integer('risk_score'),
    timeHorizonYears: integer('time_horizon_years'),
    liquidityNeed: text('liquidity_need'),
    investmentExperience: text('investment_experience'),
    maritalStatus: text('marital_status'),
    vulnerable: boolean('vulnerable').notNull().default(false),
    vulnerableReason: text('vulnerable_reason'),
    trustedContactOnFile: boolean('trusted_contact_on_file'),
    tenureYears: integer('tenure_years'),
    lastContactDate: date('last_contact_date'),
    // Opportunity metrics (household_opportunities)
    bookRank: integer('book_rank').notNull(),
    priorityScore: doublePrecision('priority_score'),
    moneyInMotion: doublePrecision('money_in_motion'),
    lendingOpportunity: doublePrecision('lending_opportunity'),
    aumAtRisk: doublePrecision('aum_at_risk'),
    signalsLabel: text('signals_label'),
    headlineSignal: text('headline_signal'),
    daysToAct: integer('days_to_act'),
    daysSinceContact: integer('days_since_contact'),
    topModelAction: text('top_model_action'),
    topModelStatus: text('top_model_status'),
    bestSuitableAction: text('best_suitable_action'),
    bestExpectedRevenue: doublePrecision('best_expected_revenue'),
    modelTopBlocked: boolean('model_top_blocked').notNull().default(false),
    // Detail (JSONB snapshots from Delta)
    signals: jsonb('signals').$type<Signal[]>().notNull().default([]),
    accounts: jsonb('accounts').$type<Account[]>().notNull().default([]),
    liabilities: jsonb('liabilities').$type<Liability[]>().notNull().default([]),
    notes: jsonb('notes').$type<Note[]>().notNull().default([]),
    recommendations: jsonb('recommendations').$type<Recommendation[]>().notNull().default([]),
    // Write surface
    status: text('status', { enum: ['new', 'prepped', 'proposed', 'meeting_booked', 'not_now'] }).notNull().default('new'),
    meetingPrep: jsonb('meeting_prep').$type<MeetingPrep | null>(),
    preppedAt: timestamp('prepped_at', { withTimezone: true }),
    outreachDraft: text('outreach_draft'),
    decision: text('decision'),
    decisionAction: text('decision_action'),
    decisionNotes: text('decision_notes'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clients_advisor_idx').on(t.advisorId, t.bookRank), index('clients_status_idx').on(t.status)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type Signal = { type: string; date: string | null; amount: number | null; detail: string | null; days_to_act: number | null };
export type Account = { id: string; type: string; custodian: string; balance: number; rate: number | null; maturity: string | null };
export type Liability = { id: string; type: string; lender: string; balance: number; rate: number; originated: string | null; payment: number | null; property_value: number | null };
export type Note = {
  id: string; date: string; channel: string | null; text: string;
  ai?: { category: string | null; amount: string | null; timeframe: string | null; family_member: string | null; other_institution: string | null; sentiment: string | null; flight_risk: boolean } | null;
};
export type RuleResult = { rule_id: string; rule: string; result: 'PASS' | 'FAIL' | 'REVIEW'; finding: string; citation: string };
export type Recommendation = {
  action_code: string; action_name: string; category: string; complexity: string; trigger: string; signal: string;
  propensity: number; assets_in_scope: number; expected_revenue: number; model_rank: number;
  status: 'PASS' | 'REVIEW' | 'FAIL'; suitable_rank: number | null; failed_rules: string; rules: RuleResult[]; disclosures: string;
};
export type MeetingPrep = {
  headline: string;
  why_now: string[];
  model_pick: { action_code: string; action_name: string; propensity: number; status: string; blocked_because: string[] } | null;
  agenda: Array<{ action_code: string; action_name: string; status: string; assets: number; talking_point: string }>;
  deferred: Array<{ action_code: string; reason: string }>;
  disclosures: Array<{ code: string; text: string }>;
  policy_guidance: { question: string; answer: string; sources: string } | null;
  outreach: { channel: string; subject: string; body: string };
  call_opener: string;
  model: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_prep' | 'proposed' | 'meeting_booked' | 'not_now' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
