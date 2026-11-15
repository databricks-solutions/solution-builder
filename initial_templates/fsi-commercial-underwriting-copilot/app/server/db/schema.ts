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
 *   2. UW desk      (submissions, sov_locations, loss_run_claims, documents,
 *                   rating_factors, appetite_rules) — today's queue mirrored from
 *                   Delta by db/sync.ts, plus the write surface: each submission
 *                   carries the latest underwriting review, its referral state,
 *                   the issued decision and an append-only audit trail.
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
// Delta mirror — today's underwriting queue (financial_services.commercial_underwriting_copilot).
// Delta is the source of truth (gold_submission_queue + the AI-extracted SOV / loss runs); this is the
// writable OLTP copy the desk + agent work on. Synced once at boot by db/sync.ts; "Reset demo" re-syncs.
// Every issued decision is ALSO written back to Delta (uw_decisions) for the dashboard / Genie.
// ============================================================================

export const submissions = appSchema.table(
  'submissions',
  {
    id: text('id').primaryKey(), // SUB-26-0417
    insuredName: text('insured_name').notNull(),
    businessDescription: text('business_description'),
    brokerName: text('broker_name').notNull(),
    brokerTier: text('broker_tier'),
    brokerContact: text('broker_contact'),
    segmentCode: text('segment_code').notNull(),
    segment: text('segment').notNull(),
    state: text('state').notNull(),
    hailBelt: boolean('hail_belt').notNull().default(false),
    receivedTs: text('received_ts').notNull(),
    effectiveDate: text('effective_date'),
    daysToEffective: integer('days_to_effective'),
    remarks: text('remarks'),
    annualRevenue: doublePrecision('annual_revenue'),
    targetPremium: doublePrecision('target_premium'),
    expiringPremium: doublePrecision('expiring_premium'),
    priorCarrier: text('prior_carrier'),
    // what the application SAYS
    app: jsonb('app').$type<AppStated>().notNull(),
    // what the documents SHOW (aggregates; rows live in sov_locations / loss_run_claims)
    sovTiv: doublePrecision('sov_tiv').notNull(),
    sovLocations: integer('sov_locations').notNull(),
    lossRunClaims: integer('loss_run_claims').notNull().default(0),
    lossRunIncurred: doublePrecision('loss_run_incurred').notNull().default(0),
    lossRunValued: text('loss_run_valued'),
    lossRunYears: integer('loss_run_years'),
    lossRunCarrier: text('loss_run_carrier'),
    discrepancies: jsonb('discrepancies').$type<string[]>().notNull().default([]),
    rulesHit: jsonb('rules_hit').$type<string[]>().notNull().default([]),
    // ML (submission_risk_model@champion batch scores)
    pAsSubmitted: doublePrecision('p_as_submitted'),
    pVerified: doublePrecision('p_verified'),
    bandAsSubmitted: text('band_as_submitted'),
    bandVerified: text('band_verified'),
    riskDrivers: text('risk_drivers'),
    triageLane: text('triage_lane').notNull(),
    priorityScore: doublePrecision('priority_score').notNull().default(0),
    premiumPotential: doublePrecision('premium_potential'),
    /** new → review_drafted → referred (awaiting CUO) → decided */
    status: text('status', { enum: ['new', 'review_drafted', 'referred', 'decided'] }).notNull().default('new'),
    review: jsonb('review').$type<UwReview | null>(),
    reviewUpdatedAt: timestamp('review_updated_at', { withTimezone: true }),
    decision: text('decision'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    cuoNote: text('cuo_note'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('submissions_status_idx').on(t.status)],
);

export const sovLocations = appSchema.table(
  'sov_locations',
  {
    id: text('id').primaryKey(), // SUB-26-0417-3
    submissionId: text('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
    locNo: integer('loc_no').notNull(),
    buildingName: text('building_name').notNull(),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    construction: text('construction'),
    yearBuilt: integer('year_built'),
    roofYear: integer('roof_year'),
    roofAgeYears: integer('roof_age_years'),
    stories: integer('stories'),
    units: integer('units'),
    sprinklered: boolean('sprinklered').notNull().default(false),
    protectionClass: integer('protection_class'),
    tiv: doublePrecision('tiv').notNull(),
    coastalTier1: boolean('coastal_tier1').notNull().default(false),
  },
  (t) => [index('sov_submission_idx').on(t.submissionId)],
);

export const lossRunClaims = appSchema.table(
  'loss_run_claims',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
    claimNumber: text('claim_number'),
    lossDate: text('loss_date'),
    line: text('line'),
    locNo: integer('loc_no'),
    cause: text('cause'),
    paid: doublePrecision('paid').notNull().default(0),
    reserve: doublePrecision('reserve').notNull().default(0),
    totalIncurred: doublePrecision('total_incurred').notNull().default(0),
    status: text('status'),
    windHail: boolean('wind_hail').notNull().default(false),
  },
  (t) => [index('lr_submission_idx').on(t.submissionId)],
);

export const documents = appSchema.table('documents', {
  id: text('id').primaryKey(), // SUB-26-0417-SOV
  submissionId: text('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  docType: text('doc_type').notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  elements: integer('elements'),
});

export const ratingFactors = appSchema.table('rating_factors', {
  id: text('id').primaryKey(),
  factorType: text('factor_type').notNull(),
  factorKey: text('factor_key').notNull(),
  value: doublePrecision('value').notNull(),
  description: text('description'),
  docRef: text('doc_ref'),
});

export const appetiteRules = appSchema.table('appetite_rules', {
  id: text('id').primaryKey(),
  docRef: text('doc_ref').notNull(),
  title: text('title').notNull(),
  action: text('action').notNull(),
  threshold: doublePrecision('threshold'),
  description: text('description'),
});

// ============================================================================
// JSONB shapes
// ============================================================================

export type AppStated = {
  locations: number | null; tiv: number | null; construction: string | null; year_built: number | null; roof_year: number | null;
  sprinklered: boolean | null; protection_class: number | null; loss_count: number | null; loss_amount: number | null;
};

export type RuleCheck = {
  rule_id: string; doc_ref: string; title: string;
  status: 'pass' | 'fail' | 'refer' | 'info' | 'resolved';
  detail: string; locations?: number[];
};

export type LocationQuote = {
  loc_no: number; building_name: string; city: string | null; construction: string | null; roof_age: number | null;
  sprinklered: boolean; tiv: number; included: boolean; exclusion_reason: string | null;
  factors: Record<string, number>; premium: number; wind_hail_deductible_pct: number;
};

export type UwDecision = 'QUOTE' | 'QUOTE_WITH_CONDITIONS' | 'DECLINE' | 'REQUEST_INFO';

export type UwReview = {
  review_id: string;
  submission_id: string;
  generated_at: string;
  drafted_by: string;
  discrepancies: string[];
  risk: { p_as_submitted: number | null; p_verified: number | null; band_as_submitted: string | null; band_verified: string | null; drivers: string | null };
  rules: RuleCheck[];
  guidance: { question: string; answer: string; sources: string[] } | null;
  locations: LocationQuote[];
  pricing: {
    tiv_submitted: number; tiv_quoted: number; property_premium: number; gl_premium: number; total_premium: number;
    rate_per_100: number; target_premium: number | null; experience_mod: number; ml_mod: number; ml_band: string | null;
  };
  decision: UwDecision;
  conditions: string[];
  excluded_locations: number[];
  referral_required: boolean;
  referral_reasons: string[];
  rationale: string;
  broker_letter: string;
  model: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'review_drafted' | 'referred' | 'approved' | 'sent_back' | 'decided' | 'note';
  notes?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
