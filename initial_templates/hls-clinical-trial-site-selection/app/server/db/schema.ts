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
 * Two groups:
 *   1. Chat state   (conversations, messages, feedback) — the dock agent's
 *                   reload-safe history (thinking + error columns included).
 *   2. Clinical ops (site_ops, rescue_plans) — the site network mirrored from
 *                   Delta at boot / on "Reset demo" + the study manager's
 *                   rescue-plan decisions (write-back) with an audit trail.
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
// Clinical-operations write surface.
//   site_ops      — one row per network site for CASCADE-CKD, seeded from Delta
//                   (gold_site_performance + site_scores) by db/sync.ts at boot /
//                   on "Reset demo". The study manager's actions land here:
//                   activation requested (rescue site), closure review (zero enroller).
//   rescue_plans  — every enrollment-rescue analysis the copilot ran, with the
//                   amendment proposal, the projection, the selected sites and the
//                   study manager's decision + an append-only audit trail.
// Delta (healthcare_lifesciences.trial_site_selection) stays the source of truth
// for history; Lakebase holds the transactional decisions.
// ============================================================================

export const siteOps = appSchema.table(
  'site_ops',
  {
    siteId: text('site_id').primaryKey(),
    trialId: text('trial_id').notNull(),
    siteName: text('site_name').notNull(),
    city: text('city'),
    state: text('state'),
    region: text('region'),
    siteType: text('site_type'),
    irbType: text('irb_type'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** active | activating | not_activated | candidate (from Delta) */
    cascadeStatus: text('cascade_status').notNull(),
    /** Performance + model scores, read-only snapshot from Delta. */
    metrics: jsonb('metrics').$type<SiteMetrics>().notNull(),
    /** Study-manager action: none | activation_requested | closure_review | keep */
    opsStatus: text('ops_status').notNull().default('none'),
    opsNote: text('ops_note'),
    planId: uuid('plan_id'),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('site_ops_status_idx').on(t.cascadeStatus), index('site_ops_ops_idx').on(t.opsStatus)],
);

export const rescuePlans = appSchema.table(
  'rescue_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trialId: text('trial_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Full analysis (root cause, protocol guidance, projection, ranked sites). */
    analysis: jsonb('analysis').$type<RescueAnalysis>().notNull(),
    /** AI-drafted amendment proposal memo, study-manager editable. */
    memo: text('memo'),
    /** draft | approved | rejected */
    status: text('status').notNull().default('draft'),
    selectedSiteIds: jsonb('selected_site_ids').$type<string[]>().notNull().default([]),
    closureSiteIds: jsonb('closure_site_ids').$type<string[]>().notNull().default([]),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNotes: text('decision_notes'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
  },
  (t) => [index('rescue_plans_trial_idx').on(t.trialId, t.createdAt)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type SiteMetrics = {
  principal_investigator?: string | null;
  activation_date?: string | null;
  months_active?: number | null;
  screened?: number | null;
  randomized?: number | null;
  randomized_per_month?: number | null;
  screen_fail_rate?: number | null;
  cycle_time_days?: number | null;
  days_in_startup?: number | null;
  is_zero_enroller?: boolean | null;
  competing_trial?: string | null;
  rand_per_month_before_competitor?: number | null;
  rand_per_month_since_competitor?: number | null;
  eligible_current_protocol?: number | null;
  eligible_amended_e4?: number | null;
  amendment_pool_multiplier?: number | null;
  hist_rate_per_month?: number | null;
  has_dkd_competitor?: boolean | null;
  prior_halcyra_trials?: number | null;
  predicted_rate_current?: number | null;
  predicted_rate_amended?: number | null;
  est_activation_months?: number | null;
  expected_randomized_12m?: number | null;
  rescue_eligible?: boolean | null;
  rescue_rank?: number | null;
  score_rationale?: string | null;
};

export type ProjectionScenario = {
  key: 'status_quo' | 'amendment' | 'amendment_plus_sites';
  label: string;
  monthly_rate_end: number;
  lpi_date: string | null;
  months_late: number | null;
  curve: Array<{ month: string; cum: number }>;
};

export type RescueSite = {
  site_id: string; site_name: string; city: string | null; state: string | null; irb_type: string | null;
  eligible_current: number; eligible_amended: number; predicted_rate_amended: number; est_activation_months: number;
  expected_randomized_12m: number; hist_rate: number; rationale: string; selected: boolean;
};

export type RescueAnalysis = {
  trial_id: string;
  as_of: string;
  enrollment: { randomized: number; planned_to_date: number; target: number; pct_of_plan: number; run_rate_3m: number;
    planned_lpi: string; months_left: number; active_sites: number; screen_fail_rate: number; planned_screen_fail_rate: number };
  screen_fails: { total: number; by_criterion: Array<{ criterion_id: string; name: string; n: number; coded: number; share: number }>;
    e4_share_first6: number; e4_share_last6: number; e4_coded_share: number; e4_stable_share: number; ai_recovered: number };
  pool: { current: number; amended: number; multiplier: number; pct_on_sglt2i: number; feasibility_assumed_pct: number };
  model: { name: string; version: string; rate_multiplier: number };
  competition: { acronym: string; sites: number; rate_before: number; rate_since: number };
  zero_enrollers: Array<{ site_id: string; site_name: string; city: string | null; months_active: number; screened: number; competing_trial: string | null }>;
  protocol_guidance: { question: string; answer: string; source: string } | null;
  recommendation: { amend: Array<{ criterion_id: string; from: string; to: string; why: string }>; do_not_amend: Array<{ criterion_id: string; why: string }> };
  rescue_sites: RescueSite[];
  projection: ProjectionScenario[];
  projection_params: { target: number; randomizedToDate: number; startMonth: string; runRate: number; amendmentUplift: number;
    amendmentLagMonths: number; rescreenBolus: number; plannedLpi: string };
  summary: string;
  model_used: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_analysis' | 'approved' | 'rejected' | 'memo_edited' | 'activation_requested' | 'closure_review' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
