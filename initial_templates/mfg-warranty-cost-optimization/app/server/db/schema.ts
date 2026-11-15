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
 *   2. Warranty     (signals, claims) — early-warning signals + every claim with
 *                   its AI failure mode, mirrored from the Delta gold tables by
 *                   db/sync.ts at boot / on "Reset demo". Each signal row carries
 *                   the latest AI root-cause analysis, the supplier-notice draft
 *                   and an append-only audit trail.
 *   3. Write-back   (quality_cases) — the quality case the engineer (or the
 *                   copilot, on request) opens: root cause, containment actions,
 *                   projected exposure, campaign cost, supplier chargeback.
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
// Warranty signals + claims mirror + quality cases (write-back)
// ============================================================================

/** Early-warning signals (gold_early_warning, is_signal) mirrored at boot / "Reset demo". */
export const signals = appSchema.table(
  'signals',
  {
    id: text('id').primaryKey(), // SIG-xxxxxx
    failureMode: text('failure_mode').notNull(),
    failureModeLabel: text('failure_mode_label').notNull(),
    component: text('component'),
    supplierId: text('supplier_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    chargeable: boolean('chargeable').notNull().default(false),
    exposedUnits: integer('exposed_units'),
    claims90d: integer('claims_90d').notNull().default(0),
    claimsBase: integer('claims_base').notNull().default(0),
    claimsTotal: integer('claims_total').notNull().default(0),
    costToDate: doublePrecision('cost_to_date'),
    cost90d: doublePrecision('cost_90d'),
    avgClaimCost: doublePrecision('avg_claim_cost'),
    rate90d: doublePrecision('rate_90d'), // per 1K unit-years
    baselineRate: doublePrecision('baseline_rate'),
    rateRatio: doublePrecision('rate_ratio'),
    firstRecentClaim: date('first_recent_claim'),
    dealerCodeAgreement: doublePrecision('dealer_code_agreement'),
    /** suspect cohort (gold_signal_cohorts) + exposure (gold_signal_exposure) snapshot */
    cohort: jsonb('cohort').$type<SignalCohort | null>(),
    exposure: jsonb('exposure').$type<ExposureRow[]>().notNull().default([]),
    status: text('status', { enum: ['new', 'investigating', 'case_opened', 'monitoring'] }).notNull().default('new'),
    /** Latest AI root-cause analysis (analyze.ts). */
    analysis: jsonb('analysis').$type<SignalAnalysis | null>(),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    supplierNoticeDraft: text('supplier_notice_draft'),
    qualityCaseId: text('quality_case_id'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signals_status_idx').on(t.status)],
);

/** Every warranty claim with its AI failure mode (gold_claims) — the evidence + the claims explorer. */
export const claims = appSchema.table(
  'claims',
  {
    id: text('id').primaryKey(), // WC-26xxxx
    serial: text('serial').notNull(),
    modelName: text('model_name'),
    dealerName: text('dealer_name'),
    region: text('region'),
    claimDate: date('claim_date').notNull(),
    daysInService: integer('days_in_service'),
    customerComplaint: text('customer_complaint'),
    dealerLaborCode: text('dealer_labor_code'),
    failureMode: text('failure_mode'),
    failureModeLabel: text('failure_mode_label'),
    faultCode: text('fault_code'),
    waterExposure: boolean('water_exposure'),
    observedDamage: text('observed_damage'),
    matchesDealerCode: boolean('matches_dealer_code'),
    partNumber: text('part_number'),
    totalCost: doublePrecision('total_cost'),
    claimStatus: text('claim_status'),
    technicianName: text('technician_name'),
    technicianNotes: text('technician_notes'),
    firmware: text('firmware'),
    controllerLot: text('controller_lot'),
    brakeLot: text('brake_lot'),
    supplierId: text('supplier_id'),
    chargeable: boolean('chargeable').notNull().default(false),
  },
  (t) => [
    index('claims_mode_idx').on(t.failureMode, t.supplierId),
    index('claims_date_idx').on(t.claimDate),
  ],
);

/** Quality cases opened from a signal — the write-back (containment + chargeback decision). */
export const qualityCases = appSchema.table(
  'quality_cases',
  {
    id: text('id').primaryKey(), // QC-2026-0142
    signalId: text('signal_id').notNull(),
    title: text('title').notNull(),
    supplierId: text('supplier_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    rootCause: text('root_cause').notNull(),
    affectedLots: jsonb('affected_lots').$type<string[]>().notNull().default([]),
    affectedUnits: integer('affected_units'),
    containmentActions: jsonb('containment_actions').$type<ContainmentAction[]>().notNull().default([]),
    projectedExposure: doublePrecision('projected_exposure'),
    campaignCost: doublePrecision('campaign_cost'),
    chargebackAmount: doublePrecision('chargeback_amount'),
    supplierNotice: text('supplier_notice'),
    severity: text('severity').notNull().default('high'),
    status: text('status').notNull().default('open'),
    owner: text('owner').notNull(),
    notes: text('notes'),
    openedVia: text('opened_via').notNull().default('workbench'), // workbench | copilot
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quality_cases_signal_idx').on(t.signalId)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type SignalCohort = {
  dimension: string; // controller_lot | brake_lot | battery_lot | firmware_version
  suspect: Array<{ value: string; units: number; units_sold: number; units_in_stock: number; claims: number; rate: number }>;
  /** claims per 1,000 bike-years across every non-suspect value */
  rest_rate: number;
  all: Array<{ value: string; units: number; units_sold: number; claims: number; rate: number; suspect: boolean; in_scope?: boolean; unit_years?: number }>;
};

export type ExposureRow = {
  region: string; wet_region: boolean; units: number; units_in_field: number; units_in_stock: number;
  connected_in_field: number; claims_to_date: number; cost_to_date: number; annual_hazard: number;
  avg_remaining_years: number; projected_claims: number; projected_cost: number; avg_claim_cost: number;
};

export type Finding = { id: string; title: string; verdict: 'CONFIRMED' | 'RULED_OUT' | 'WATCH' | 'INFO'; detail: string; evidence?: string };

export type ContainmentAction = {
  key: string; label: string; detail: string; units: number | null; cost: number | null; recoverable: number | null;
  recommended: boolean;
};

export type SignalAnalysis = {
  headline: string;
  root_cause: string;
  summary: string;
  findings: Finding[];
  lots: Array<{ lot: string; units: number; units_in_stock: number; claims: number; rate: number; e21_rate: number | null; coating: string | null; ppap: string | null }>;
  telemetry: { suspect_e21_per_1k: number | null; other_e21_per_1k: number | null; at_risk_bikes: number | null } | null;
  exposure: { affected_units: number; in_field: number; in_stock: number; claims_to_date: number; cost_to_date: number; projected_claims: number; projected_cost: number; wet_share: number } | null;
  options: ContainmentAction[];
  chargeback: { to_date: number; campaign: number; total: number; basis: string } | null;
  supplier_guidance: { question: string; answer: string; source: string } | null;
  model: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_analysis' | 'case_opened' | 'notice_edited' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
