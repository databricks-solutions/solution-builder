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
 *   2. Caseload     (cases, case_documents) — the OPEN applications mirrored
 *                   from Delta by db/sync.ts at boot / on "Reset demo", plus the
 *                   write surface: each case row carries the latest AI check
 *                   (assessment), the notice draft, the decision and an
 *                   append-only audit_trail (every AI check + human decision).
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
// Delta mirror — the open caseload (applications + household + documents).
// Delta (public_sector.eligibility_copilot) is the source of truth; this is
// the writable OLTP copy the workbench + agent read and write. Synced once at
// boot by db/sync.ts; "Reset demo" re-syncs.
// ============================================================================

export const cases = appSchema.table(
  'cases',
  {
    id: text('id').primaryKey(), // application_id, e.g. APP-240117
    householdId: text('household_id').notNull(),
    program: text('program').notNull(), // SNAP | Medicaid
    county: text('county').notNull(),
    regionType: text('region_type'),
    channel: text('channel'),
    submittedDate: date('submitted_date').notNull(),
    expeditedScreening: boolean('expedited_screening').notNull().default(false),
    reportedMonthlyIncome: doublePrecision('reported_monthly_income'),
    reportedLiquidResources: doublePrecision('reported_liquid_resources'),
    citizenshipVerifiedElectronically: boolean('citizenship_verified_electronically'),
    status: text('status', {
      enum: ['pending_review', 'awaiting_verification', 'approved', 'denied', 'escalated'],
    })
      .notNull()
      .default('pending_review'),
    rfiCount: integer('rfi_count').notNull().default(0),
    caseworkerId: text('caseworker_id'),
    caseworkerName: text('caseworker_name'),
    caseworkerUnit: text('caseworker_unit'),
    headFirstName: text('head_first_name').notNull(),
    headLastName: text('head_last_name').notNull(),
    headAge: integer('head_age'),
    householdSize: integer('household_size').notNull(),
    childrenUnder18: integer('children_under_18'),
    elderlyOrDisabled: boolean('elderly_or_disabled').notNull().default(false),
    preferredLanguage: text('preferred_language'),
    streetAddress: text('street_address'),
    city: text('city'),
    zipCode: text('zip_code'),
    phone: text('phone'),
    /** Latest AI eligibility check (rules, findings, citations, policy guidance). */
    assessment: jsonb('assessment').$type<CaseAssessment | null>(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }),
    /** Notice draft (AI-drafted, caseworker-editable) + the language it is in. */
    noticeDraft: text('notice_draft'),
    noticeType: text('notice_type'), // approval | denial | request_for_verification
    noticeLanguage: text('notice_language'),
    decision: text('decision'), // APPROVED | DENIED | RFI_SENT | ESCALATED
    decisionNotes: text('decision_notes'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    monthlyBenefitAmount: doublePrecision('monthly_benefit_amount'),
    /** Append-only audit trail: every AI check + human decision. */
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cases_status_idx').on(t.status),
    index('cases_county_idx').on(t.county),
    index('cases_caseworker_idx').on(t.caseworkerId),
  ],
);

export const caseDocuments = appSchema.table(
  'case_documents',
  {
    id: text('id').primaryKey(), // document_id
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    receivedDate: date('received_date'),
    fileName: text('file_name'),
    pageCount: integer('page_count'),
    documentText: text('document_text'),
    /** ai_extract output (typed fields) — computed in Delta by the setup job. */
    extracted: jsonb('extracted').$type<ExtractedFields>(),
    extractionConfidence: doublePrecision('extraction_confidence'),
  },
  (t) => [index('case_documents_case_idx').on(t.caseId)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type ExtractedFields = {
  person_name?: string | null;
  issuer?: string | null;
  document_date?: string | null;
  expiration_date?: string | null;
  employment_end_date?: string | null;
  gross_pay?: number | null;
  pay_frequency?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  monthly_rent?: number | null;
  account_balance?: number | null;
  declares_no_income?: boolean | null;
};

export type RuleResult = {
  rule_id: string;
  rule_name: string;
  category: string;
  result: 'PASS' | 'FAIL' | 'NEEDS_INFO' | 'FLAG';
  finding: string;
  evidence: string[]; // document ids used
  cfr_citation: string;
  manual_section: string;
};

export type CaseAssessment = {
  recommendation: 'APPROVE' | 'DENY' | 'REQUEST_VERIFICATION';
  summary: string;
  countable_monthly_income: number;
  income_limit: number;
  estimated_monthly_benefit: number | null;
  timeliness: { standard_days: number; days_open: number; days_remaining: number; overdue: boolean; expedited: boolean };
  rules: RuleResult[];
  missing_documents: Array<{ item: string; why: string; acceptable: string }>;
  policy_guidance: { question: string; answer: string; source: string } | null;
  model: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_check' | 'approved' | 'denied' | 'rfi_sent' | 'escalated' | 'notice_edited' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
