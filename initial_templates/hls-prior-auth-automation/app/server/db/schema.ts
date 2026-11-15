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
  primaryKey,
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
// ============================================================================
// Prior-authorization domain (MedVault Health Plan)
//
// Delta is the source of truth for the queue snapshot (pa_requests +
// ai_case_review + ai_criteria_evidence + clinical_notes). db/sync.ts mirrors
// the OPEN queue here at boot; the workbench writes decisions here (fast OLTP)
// and best-effort appends them to Delta `um_decisions` for the dashboard/Genie.
// ============================================================================

/** One row per open PA request, denormalized for the workbench. */
export const paCases = appSchema.table(
  'pa_cases',
  {
    requestId: text('request_id').primaryKey(),
    memberId: text('member_id').notNull(),
    memberName: text('member_name'),
    memberAge: integer('member_age'),
    memberSex: text('member_sex'),
    lineOfBusiness: text('line_of_business'),
    planName: text('plan_name'),
    providerId: text('provider_id'),
    providerName: text('provider_name'),
    npi: text('npi'),
    practiceGroup: text('practice_group'),
    specialty: text('specialty'),
    policyId: text('policy_id').notNull(),
    policyTitle: text('policy_title'),
    serviceCode: text('service_code'),
    serviceDescription: text('service_description'),
    serviceCategory: text('service_category'),
    icd10Code: text('icd10_code'),
    diagnosis: text('diagnosis'),
    urgency: text('urgency').notNull(),
    channel: text('channel'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    slaHours: integer('sla_hours').notNull(),
    intakeStatus: text('intake_status'),
    estCostUsd: doublePrecision('est_cost_usd'),
    requestedUnits: integer('requested_units'),
    placeOfService: text('place_of_service'),
    autoApprovalEligible: boolean('auto_approval_eligible').notNull().default(false),
    // AI pre-review (ai_query batch in Delta, or a live re-review)
    aiRecommendation: text('ai_recommendation'),
    aiConfidence: doublePrecision('ai_confidence'),
    aiRationale: text('ai_rationale'),
    missingInformation: text('missing_information'),
    aiLane: text('ai_lane'),
    nMet: integer('n_met'),
    nCriteria: integer('n_criteria'),
    aiModel: text('ai_model'),
    aiReviewedAt: timestamp('ai_reviewed_at', { withTimezone: true }),
    // Workbench decision (write-back)
    status: text('status', {
      enum: ['open', 'approved', 'auto_approved', 'pended', 'referred_md'],
    })
      .notNull()
      .default('open'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    decisionNote: text('decision_note'),
    providerLetter: text('provider_letter'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pa_cases_status_idx').on(t.status, t.dueAt),
    index('pa_cases_lane_idx').on(t.aiLane),
  ],
);

/** Per-criterion AI evidence for each open case (the citations). */
export const caseCriteria = appSchema.table(
  'case_criteria',
  {
    requestId: text('request_id')
      .notNull()
      .references(() => paCases.requestId, { onDelete: 'cascade' }),
    criterionId: text('criterion_id').notNull(),
    criterionNumber: integer('criterion_number'),
    label: text('label'),
    criterionText: text('criterion_text'),
    status: text('status'),
    evidenceQuote: text('evidence_quote'),
    sourceNoteId: text('source_note_id'),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.criterionId] })],
);

/** Submitted clinical documentation for each open case. */
export const caseNotes = appSchema.table(
  'case_notes',
  {
    noteId: text('note_id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => paCases.requestId, { onDelete: 'cascade' }),
    noteType: text('note_type'),
    author: text('author'),
    noteDate: text('note_date'),
    noteText: text('note_text').notNull(),
  },
  (t) => [index('case_notes_request_idx').on(t.requestId)],
);

/** Tiny key/value store — the queue snapshot timestamp (as_of). */
export const appMeta = appSchema.table('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type AuditEntry = {
  at: string;
  by: string;
  action: 'approved' | 'auto_approved' | 'pended' | 'referred_md' | 'ai_review' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
