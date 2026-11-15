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
 *   2. NOC workbench (incidents, trouble_tickets) — the correlated incident
 *                   queue mirrored from Delta (noc_incidents) by db/sync.ts at
 *                   boot / on "Reset demo", plus the write surface: the latest AI
 *                   triage per incident, the engineer's decision + audit trail,
 *                   and the trouble tickets (with field dispatches) opened from
 *                   the workbench.
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
// Delta mirror — the open NOC incident queue (<catalog>.<schema>.noc_incidents,
// built by alarm correlation + the KPI anomaly model). Delta is the source of
// truth; this is the writable OLTP copy the workbench + agents read and write.
// Synced once at boot by db/sync.ts; "Reset demo" re-syncs. Each incident row
// carries the latest AI triage, the decision and an append-only audit trail;
// opening a trouble ticket writes a row to app.trouble_tickets.
// ============================================================================

export const incidents = appSchema.table(
  'incidents',
  {
    id: text('id').primaryKey(), // INC-24417
    incidentType: text('incident_type').notNull(), // alarm_storm | power_alarm | backhaul_alarm | site_outage | kpi_anomaly
    title: text('title').notNull(),
    market: text('market'),
    suspectedNodeId: text('suspected_node_id').notNull(),
    suspectedNodeType: text('suspected_node_type').notNull(),
    cellId: text('cell_id'),
    detectedTs: text('detected_ts'), // Mountain local time "YYYY-MM-DD HH:MM:SS"
    firstAlarmTs: text('first_alarm_ts'),
    lastAlarmTs: text('last_alarm_ts'),
    firstFlaggedDay: text('first_flagged_day'),
    sitesAffected: integer('sites_affected').notNull().default(0),
    siteIds: jsonb('site_ids').$type<string[]>().notNull().default([]),
    subscribersServed: integer('subscribers_served').notNull().default(0),
    enterpriseAccounts: jsonb('enterprise_accounts').$type<string[]>().notNull().default([]),
    criticalFacilities: jsonb('critical_facilities').$type<string[]>().notNull().default([]),
    alarmCount: integer('alarm_count').notNull().default(0),
    criticalAlarms: integer('critical_alarms').notNull().default(0),
    activeAlarms: integer('active_alarms').notNull().default(0),
    transportAlarms: integer('transport_alarms').notNull().default(0),
    alarmTypes: jsonb('alarm_types').$type<string[]>().notNull().default([]),
    alarmIds: jsonb('alarm_ids').$type<string[]>().notNull().default([]),
    anomalyScore: doublePrecision('anomaly_score'),
    topFactors: jsonb('top_factors').$type<string[]>().notNull().default([]),
    suggestedPriority: text('suggested_priority').notNull(),
    status: text('status', { enum: ['open', 'triaged', 'ticketed', 'closed_explained'] }).notNull().default('open'),
    /** Latest AI triage (root cause, impact, timeline, action plan, dispatch). */
    triage: jsonb('triage').$type<Triage | null>(),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    ticketId: text('ticket_id'),
    decision: text('decision'), // TICKETED | EXPLAINED
    decisionNotes: text('decision_notes'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('incidents_status_idx').on(t.status)],
);

/** Trouble tickets opened from the workbench — the write-back (one parent ticket per root cause). */
export const troubleTickets = appSchema.table(
  'trouble_tickets',
  {
    id: text('id').primaryKey(), // TT-2026-41318
    incidentId: text('incident_id').notNull(),
    title: text('title').notNull(),
    priority: text('priority').notNull(), // P1..P4
    status: text('status').notNull().default('dispatched'),
    rootCause: text('root_cause'),
    rootNode: text('root_node'),
    summary: text('summary'),
    sitesAffected: integer('sites_affected').notNull().default(0),
    subscribersImpacted: integer('subscribers_impacted').notNull().default(0),
    childAlarmsSuppressed: integer('child_alarms_suppressed').notNull().default(0),
    actions: jsonb('actions').$type<PlanAction[]>().notNull().default([]),
    dispatches: jsonb('dispatches').$type<Dispatch[]>().notNull().default([]),
    notifications: jsonb('notifications').$type<string[]>().notNull().default([]),
    engineer: text('engineer').notNull(),
    notes: text('notes'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trouble_tickets_incident_idx').on(t.incidentId)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type TimelineEvent = {
  ts: string; // Mountain local time, "YYYY-MM-DD HH:MM"
  source: 'alarm' | 'optics' | 'kpi' | 'topology' | 'planned' | 'care' | 'ticket';
  entity: string;
  event: string;
  is_root_cause?: boolean;
};

export type PlanAction = {
  code: string; // A-01..A-10
  action: string;
  target: string;
  rationale: string;
  status?: 'requested' | 'done' | 'skipped';
};

export type Dispatch = {
  tech_id: string;
  name: string;
  skill: string;
  destination: string;
  task: string;
  eta_min: number | null;
  status?: 'dispatched' | 'en_route' | 'on_site';
};

export type Triage = {
  verdict: 'root_cause_identified' | 'degradation_confirmed' | 'explained' | 'needs_investigation';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  headline: string;
  summary: string;
  root_cause: { node: string; component: string; cause: string } | null;
  timeline: TimelineEvent[];
  impact: { sites_down: number; subscribers: number; enterprise_accounts: string[]; critical_facilities: string[]; note: string };
  actions: PlanAction[];
  dispatch: Dispatch[];
  notifications: string[];
  explanation_evidence: string[];
  child_alarms_to_suppress: number;
  estimated_restore: string | null;
  runbook_citations: string[];
  model: string;
  tool_calls: number;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_triage' | 'ticket_opened' | 'closed_explained' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
