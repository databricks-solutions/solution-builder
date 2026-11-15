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
// Delta mirror — TechRobotics predictive maintenance (synced by db/sync.ts)
// ============================================================================

/** Fleet: one row per asset = assets + ML risk (asset_risk_scores) + last PM + 24h sensors
 *  (Delta view asset_health_current). Read-mostly; `status` + `openWorkOrderId` flip when the
 *  agent books a work order. */
export const assets = appSchema.table(
  'assets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    assetType: text('asset_type').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    line: text('line').notNull(),
    cell: text('cell'),
    criticality: text('criticality'),
    isBottleneck: boolean('is_bottleneck').notNull().default(false),
    downtimeCostPerHour: doublePrecision('downtime_cost_per_hour').notNull(),
    riskScore: integer('risk_score').notNull().default(0),
    riskTier: text('risk_tier').notNull().default('Healthy'),
    failureProb7d: doublePrecision('failure_prob_7d'),
    predictedFailureMode: text('predicted_failure_mode'),
    estDaysToFailure: doublePrecision('est_days_to_failure'),
    downtimeCostAtRiskUsd: doublePrecision('downtime_cost_at_risk_usd'),
    unplannedFailureCostUsd: doublePrecision('unplanned_failure_cost_usd'),
    topDriver1: text('top_driver_1'),
    topDriver2: text('top_driver_2'),
    topDriver3: text('top_driver_3'),
    vibRatio: doublePrecision('vib_ratio'),
    tempDeltaC: doublePrecision('temp_delta_c'),
    pressureRatio: doublePrecision('pressure_ratio'),
    lastPmAt: timestamp('last_pm_at', { withTimezone: true }),
    lastPmVendor: text('last_pm_vendor'),
    lastPmLubricant: text('last_pm_lubricant'),
    lastPmWorkOrder: text('last_pm_work_order'),
    vibration24h: doublePrecision('vibration_24h'),
    temperature24h: doublePrecision('temperature_24h'),
    pressure24h: doublePrecision('pressure_24h'),
    current24h: doublePrecision('current_24h'),
    status: text('status', { enum: ['monitoring', 'work_order_booked'] }).notNull().default('monitoring'),
    openWorkOrderId: text('open_work_order_id'),
  },
  (t) => [index('assets_risk_idx').on(t.riskScore)],
);

/** Daily condition trend per asset (last 60 days of asset_health_features). */
export const assetTrend = appSchema.table(
  'asset_trend',
  {
    assetId: text('asset_id').notNull(),
    day: date('day').notNull(),
    vibration: doublePrecision('vibration'),
    vibrationBaseline: doublePrecision('vibration_baseline'),
    temperature: doublePrecision('temperature'),
    temperatureBaseline: doublePrecision('temperature_baseline'),
    pressure: doublePrecision('pressure'),
  },
  (t) => [uniqueIndex('asset_trend_pk').on(t.assetId, t.day)],
);

/** CMMS history mirror (maintenance_work_orders). */
export const maintenanceHistory = appSchema.table(
  'maintenance_history',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    workType: text('work_type').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    vendor: text('vendor'),
    technician: text('technician'),
    description: text('description'),
    lubricantUsed: text('lubricant_used'),
    partsUsed: text('parts_used'),
    costUsd: doublePrecision('cost_usd'),
    notes: text('notes'),
    failureId: text('failure_id'),
  },
  (t) => [index('mh_asset_idx').on(t.assetId, t.scheduledAt)],
);

/** Historical breakdowns (failure_events). */
export const failures = appSchema.table('failures', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull(),
  failureAt: timestamp('failure_at', { withTimezone: true }),
  failureMode: text('failure_mode'),
  component: text('component'),
  downtimeHours: doublePrecision('downtime_hours'),
  totalCostUsd: doublePrecision('total_cost_usd'),
  rootCause: text('root_cause'),
});

/** MRO inventory — WRITE surface: booking a work order reserves parts here. */
export const spareParts = appSchema.table('spare_parts', {
  partNumber: text('part_number').primaryKey(),
  description: text('description').notNull(),
  compatibleModels: text('compatible_models'),
  plantOnHand: integer('plant_on_hand').notNull(),
  regionalDcQty: integer('regional_dc_qty').notNull(),
  reservedQty: integer('reserved_qty').notNull().default(0),
  unitCostUsd: doublePrecision('unit_cost_usd').notNull(),
  leadTimeDays: integer('lead_time_days'),
  partClass: text('part_class'),
});

/** Planned downtime windows — WRITE surface: bookedHours grows as work orders land. */
export const maintenanceWindows = appSchema.table('maintenance_windows', {
  id: text('id').primaryKey(),
  line: text('line').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  capacityHours: doublePrecision('capacity_hours').notNull(),
  bookedHours: doublePrecision('booked_hours').notNull().default(0),
});

/** Work orders created from the control room (by the agent or the engineer). */
export const workOrders = appSchema.table(
  'work_orders',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    priority: text('priority').notNull(),
    title: text('title').notNull(),
    tasks: jsonb('tasks').$type<string[]>().notNull().default([]),
    windowId: text('window_id'),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    durationHours: doublePrecision('duration_hours').notNull(),
    technicians: text('technicians'),
    parts: jsonb('parts').$type<WorkOrderPart[]>().notNull().default([]),
    partsCostUsd: doublePrecision('parts_cost_usd').notNull().default(0),
    laborCostUsd: doublePrecision('labor_cost_usd').notNull().default(0),
    unplannedCostAvoidedUsd: doublePrecision('unplanned_cost_avoided_usd').notNull().default(0),
    netSavingsUsd: doublePrecision('net_savings_usd').notNull().default(0),
    riskScoreAtBooking: integer('risk_score_at_booking'),
    rootCause: text('root_cause'),
    status: text('status', { enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] }).notNull().default('scheduled'),
    createdBy: text('created_by').notNull(),
    source: text('source', { enum: ['agent', 'manual'] }).notNull().default('agent'),
    aiAuditTrail: jsonb('ai_audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wo_asset_idx').on(t.assetId)],
);

export type WorkOrderPart = {
  part_number: string;
  description: string;
  qty: number;
  unit_cost_usd: number;
  source: 'plant_crib' | 'regional_dc_transfer';
};

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type EmailEntry = {
  at: string;
  direction: 'outgoing' | 'incoming';
  from?: string;
  to?: string;
  subject: string;
  body: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'work_order_booked' | 'parts_reserved' | 'window_reserved' | 'status_change' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
