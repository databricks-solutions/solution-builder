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
 *   2. SOC workbench (leads, incident_cases) — the open UEBA leads mirrored
 *                   from Delta by db/sync.ts at boot / on "Reset demo", plus the
 *                   write surface: the latest AI investigation per lead, the
 *                   analyst disposition + audit trail, and the incident cases
 *                   opened from the workbench.
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
// Delta mirror — the open UEBA lead queue (cybersecurity.threat_hunting_copilot.
// investigation_leads). Delta is the source of truth; this is the writable
// OLTP copy the analyst workbench + agent read and write. Synced once at boot
// by db/sync.ts; "Reset demo" re-syncs. Each lead row carries the latest AI
// investigation, the disposition and an append-only audit trail; opening an
// incident case writes a row to app.incident_cases.
// ============================================================================

export const leads = appSchema.table(
  'leads',
  {
    id: text('id').primaryKey(), // L-1042
    entityType: text('entity_type').notNull(), // user | host
    entityId: text('entity_id').notNull(),
    displayName: text('display_name').notNull(),
    department: text('department'),
    role: text('role'),
    riskScore: doublePrecision('risk_score').notNull(),
    priority: text('priority').notNull(), // critical | high | medium
    topFactors: jsonb('top_factors').$type<string[]>().notNull().default([]),
    riskTrend: jsonb('risk_trend').$type<number[]>().notNull().default([]),
    firstFlagged: date('first_flagged'),
    linkedAlerts: integer('linked_alerts').notNull().default(0),
    alertsClosedFp: integer('alerts_closed_fp').notNull().default(0),
    status: text('status', { enum: ['open', 'investigating', 'escalated', 'closed_benign'] }).notNull().default('open'),
    /** Latest AI investigation (timeline, ATT&CK mapping, containment plan). */
    investigation: jsonb('investigation').$type<Investigation | null>(),
    investigatedAt: timestamp('investigated_at', { withTimezone: true }),
    caseId: text('case_id'),
    disposition: text('disposition'), // ESCALATED | BENIGN
    dispositionNotes: text('disposition_notes'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('leads_status_idx').on(t.status), index('leads_entity_idx').on(t.entityId)],
);

/** Incident cases opened from the workbench — the write-back. */
export const incidentCases = appSchema.table(
  'incident_cases',
  {
    id: text('id').primaryKey(), // IR-2026-0183
    leadId: text('lead_id').notNull(),
    title: text('title').notNull(),
    severity: text('severity').notNull(), // SEV-1..SEV-4
    status: text('status').notNull().default('containment_in_progress'),
    summary: text('summary'),
    entities: jsonb('entities').$type<string[]>().notNull().default([]),
    techniques: jsonb('techniques').$type<Technique[]>().notNull().default([]),
    containment: jsonb('containment').$type<ContainmentAction[]>().notNull().default([]),
    timeline: jsonb('timeline').$type<TimelineEvent[]>().notNull().default([]),
    notifications: jsonb('notifications').$type<string[]>().notNull().default([]),
    recordsAtRisk: integer('records_at_risk'),
    analyst: text('analyst').notNull(),
    notes: text('notes'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('incident_cases_lead_idx').on(t.leadId)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type TimelineEvent = {
  ts: string; // agency local time, "YYYY-MM-DD HH:MM"
  source: 'auth' | 'vpn' | 'endpoint' | 'dns' | 'siem' | 'ueba' | 'ticket';
  entity: string;
  event: string;
  technique_id?: string | null;
};

export type Technique = { id: string; name: string; tactic: string; evidence: string; coverage?: string | null; playbook_section?: string | null };

export type ContainmentAction = {
  code: string; // C-01..C-09
  action: string;
  target: string;
  rationale: string;
  status?: 'requested' | 'done' | 'skipped';
};

export type Investigation = {
  verdict: 'confirmed_compromise' | 'suspicious' | 'benign';
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';
  headline: string;
  summary: string;
  timeline: TimelineEvent[];
  techniques: Technique[];
  containment: ContainmentAction[];
  notifications: string[];
  benign_evidence: string[];
  records_at_risk: number | null;
  playbook_citations: string[];
  model: string;
  tool_calls: number;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_investigation' | 'case_opened' | 'closed_benign' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
