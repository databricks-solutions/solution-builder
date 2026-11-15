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
 *   2. Care transitions (worklist, transition_plans, outreach_tasks) — the
 *                   open-discharge worklist mirrored from Delta at boot / on
 *                   "Reset demo" + the coordinator transition plans and outreach tasks (write-back).
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
// Care-transitions write surface.
//   worklist          — one row per OPEN discharge (planned, or discharged in the last
//                       7 days), seeded from Delta (transition_worklist: gold discharges +
//                       readmission_risk_model scores + AI Functions note insights) by
//                       db/sync.ts at boot / on "Reset demo". plan_status tracks the
//                       coordinator's progress.
//   transition_plans  — every transition plan the copilot built for a patient (facts,
//                       care-pathway guidance from the Genie agent (documents), the task list,
//                       risk what-if) + the coordinator's approval and an audit trail.
//   outreach_tasks    — the tasks written back when a plan is approved (or when the chat
//                       agent creates one): book follow-up, 48-hour call, Ride Assist, …
// Delta (healthcare_lifesciences.readmission_reduction) stays the source of truth for
// history; Lakebase holds the transactional care-team work.
// ============================================================================

export const worklist = appSchema.table(
  'worklist',
  {
    encounterId: text('encounter_id').primaryKey(),
    patientId: text('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    unitId: text('unit_id').notNull(),
    unitName: text('unit_name'),
    hospitalId: text('hospital_id').notNull(),
    hrrpCondition: text('hrrp_condition').notNull(),
    dischargeDate: text('discharge_date').notNull(),
    /** planned | discharged (from Delta) */
    status: text('status').notNull(),
    riskScore: doublePrecision('risk_score').notNull(),
    riskTier: text('risk_tier').notNull(),
    followupBooked: boolean('followup_booked').notNull(),
    /** Read-only snapshot from Delta (demographics, clinical, risk drivers, note insights, note text). */
    data: jsonb('data').$type<WorklistData>().notNull(),
    /** Coordinator progress: open | plan_drafted | plan_approved */
    planStatus: text('plan_status').notNull().default('open'),
    planId: uuid('plan_id'),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('worklist_risk_idx').on(t.riskScore), index('worklist_unit_idx').on(t.unitId)],
);

export const transitionPlans = appSchema.table(
  'transition_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: text('encounter_id').notNull(),
    patientName: text('patient_name').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Full plan: facts, pathway guidance, tasks, what-if risk, summary + call script. */
    plan: jsonb('plan').$type<TransitionPlan>().notNull(),
    /** draft | approved | discarded */
    status: text('status').notNull().default('draft'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
  },
  (t) => [index('transition_plans_enc_idx').on(t.encounterId, t.createdAt)],
);

export const outreachTasks = appSchema.table(
  'outreach_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: text('encounter_id').notNull(),
    patientName: text('patient_name').notNull(),
    unitId: text('unit_id'),
    planId: uuid('plan_id'),
    /** book_followup | call_48h | med_rec_call | lab_order | home_health | ride_assist | financial_counseling | interpreter_teach_back | other */
    taskType: text('task_type').notNull(),
    title: text('title').notNull(),
    detail: text('detail'),
    dueDate: text('due_date'),
    owner: text('owner').notNull(),
    /** open | done */
    status: text('status').notNull().default('open'),
    /** workbench | copilot */
    createdVia: text('created_via').notNull().default('workbench'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: text('completed_by'),
  },
  (t) => [index('outreach_tasks_status_idx').on(t.status, t.dueDate), index('outreach_tasks_enc_idx').on(t.encounterId)],
);

// ============================================================================
// JSON payload types
// ============================================================================

export type WorklistData = {
  age: number | null; sex: string | null; primary_language: string | null; payer: string | null; dual_eligible: boolean | null;
  hospital_name: string | null; condition_label: string | null; principal_dx: string | null; principal_dx_code: string | null;
  admit_date: string | null; discharge_dow: string | null; weekend_discharge: boolean | null; los_days: number | null;
  charlson_index: number | null; ed_visits_6m: number | null; prior_admits_12m: number | null; discharge_med_count: number | null;
  discharge_disposition: string | null; lives_alone: boolean | null; has_pcp: boolean | null; followup_date: string | null;
  followup_clinic: string | null; attending: string | null; medicare_ffs_65: boolean | null;
  risk_if_followup: number | null; risk_if_followup_hh: number | null; top_drivers: string[]; model_version: string | null;
  transportation_barrier: boolean | null; medication_affordability: boolean | null; caregiver_support: boolean | null;
  language_barrier: boolean | null; high_risk_med_change: boolean | null; med_changes: string[]; note_followup_status: string | null;
  pending_labs: string | null; sdoh_summary: string | null; note_text: string | null;
};

export type PlanTask = {
  task_type: string; title: string; detail: string; due_date: string; owner: string; source: string; selected: boolean;
};

export type TransitionPlan = {
  encounter_id: string; patient_name: string; as_of: string;
  facts: {
    unit: string; condition: string; discharge_date: string; discharge_dow: string; status: string; weekend_discharge: boolean;
    risk_score: number; risk_tier: string; risk_if_followup: number; risk_if_followup_hh: number; top_drivers: string[];
    followup_booked: boolean; note_followup_status: string | null; social_risks: string[]; med_changes: string[];
    high_risk_med_change: boolean; pending_labs: string | null; unit_context: string | null;
  };
  guidance: { question: string; answer: string; sources: string[] } | null;
  tasks: PlanTask[];
  summary: string;
  call_script: string;
  model_used: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_plan' | 'approved' | 'discarded' | 'tasks_created' | 'task_done' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
