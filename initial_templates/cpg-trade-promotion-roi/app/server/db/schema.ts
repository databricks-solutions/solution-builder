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
 *   2. Delta mirror    (promo_events, plan_events, plan_scenarios) — the
 *                      OLTP copies of the gold tables that `db/sync.ts` pulls
 *                      at boot (post-event analysis, next-quarter plan forecast,
 *                      re-plan scenarios).
 *   3. Write-surface   plan_decisions + the mutable columns of plan_events:
 *                      an approved re-plan swaps the event's tactic in one
 *                      transaction and logs the before/after decision.
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
// Delta mirror — Crestwood trade promotions (synced from the gold tables at boot)
// ============================================================================

/** One week of a completed event's curve (gold_event_weekly). */
export type CurvePoint = {
  rel_week: number;
  phase: 'pre' | 'event' | 'post';
  week_start: string;
  actual: number;
  baseline: number;
  sister_actual: number;
  sister_baseline: number;
  shipped: number;
  on_deal: number;
};

/** Completed promotions with their post-event analysis (gold_event_roi + curve). Read-only. */
export const promoEvents = appSchema.table(
  'promo_events',
  {
    id: text('id').primaryKey(),
    eventName: text('event_name').notNull(),
    retailerId: text('retailer_id').notNull(),
    retailerName: text('retailer_name').notNull(),
    channel: text('channel'),
    sku: text('sku').notNull(),
    productName: text('product_name').notNull(),
    brand: text('brand'),
    tactic: text('tactic').notNull(),
    discountDepth: doublePrecision('discount_depth'),
    featureAd: boolean('feature_ad'),
    inStoreDisplay: boolean('in_store_display'),
    fundingMethod: text('funding_method'),
    startWeek: date('start_week').notNull(),
    endWeek: date('end_week'),
    weeks: integer('weeks'),
    quarter: text('quarter'),
    last52: boolean('last_52'),
    baselineUnits: doublePrecision('baseline_units'),
    actualUnits: doublePrecision('actual_units'),
    grossIncrementalUnits: doublePrecision('gross_incremental_units'),
    volumeLiftPct: doublePrecision('volume_lift_pct'),
    dipUnits: doublePrecision('dip_units'),
    cannibalizedUnits: doublePrecision('cannibalized_units'),
    forwardBuyUnits: doublePrecision('forward_buy_units'),
    netIncrementalUnits: doublePrecision('net_incremental_units'),
    allowancePerUnit: doublePrecision('allowance_per_unit'),
    tradeSpend: doublePrecision('trade_spend'),
    fixedFees: doublePrecision('fixed_fees'),
    subsidisedBaseline: doublePrecision('subsidised_baseline'),
    forwardBuyCost: doublePrecision('forward_buy_cost'),
    incrementalGp: doublePrecision('incremental_gp'),
    netProfit: doublePrecision('net_profit'),
    roi: doublePrecision('roi'),
    verdict: text('verdict'),
    curve: jsonb('curve').$type<CurvePoint[]>().notNull().default([]),
  },
  (t) => [index('promo_events_retailer_idx').on(t.retailerId, t.tactic)],
);

/** Next quarter's draft promo calendar (gold_plan_forecast). The copilot re-plans rows in place. */
export const planEvents = appSchema.table(
  'plan_events',
  {
    id: text('id').primaryKey(),
    retailerId: text('retailer_id').notNull(),
    retailerName: text('retailer_name').notNull(),
    sku: text('sku').notNull(),
    productName: text('product_name').notNull(),
    brand: text('brand'),
    startWeek: date('start_week').notNull(),
    endWeek: date('end_week'),
    planWeek: integer('plan_week').notNull(),
    weeks: integer('weeks').notNull(),
    plannerNote: text('planner_note'),
    // current plan (mutated by an approved re-plan)
    scenarioKey: text('scenario_key').notNull().default('as_planned'),
    tactic: text('tactic').notNull(),
    discountDepth: doublePrecision('discount_depth'),
    fundingMethod: text('funding_method'),
    featureAd: boolean('feature_ad'),
    inStoreDisplay: boolean('in_store_display'),
    promoPrice: doublePrecision('promo_price'),
    regularShelfPrice: doublePrecision('regular_shelf_price'),
    baselineUnits: doublePrecision('baseline_units'),
    forecastUnits: doublePrecision('forecast_units'),
    netIncrementalUnits: doublePrecision('net_incremental_units'),
    volumeKept: doublePrecision('volume_kept'),
    tradeSpend: doublePrecision('trade_spend'),
    incrementalGp: doublePrecision('incremental_gp'),
    netProfit: doublePrecision('net_profit'),
    roi: doublePrecision('roi'),
    forecastFlag: text('forecast_flag').notNull(),
    // the ORIGINAL draft (kept for before/after)
    originalTactic: text('original_tactic').notNull(),
    originalNetProfit: doublePrecision('original_net_profit'),
    originalRoi: doublePrecision('original_roi'),
    originalFlag: text('original_flag').notNull(),
    recommendedScenarioKey: text('recommended_scenario_key'),
    status: text('status', { enum: ['draft', 'replanned', 'approved'] }).notNull().default('draft'),
    decisionId: text('decision_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('plan_events_week_idx').on(t.planWeek)],
);

/** Candidate tactics per planned event (gold_plan_scenarios). Read-only. */
export const planScenarios = appSchema.table(
  'plan_scenarios',
  {
    planEventId: text('plan_event_id').notNull(),
    scenarioKey: text('scenario_key').notNull(),
    label: text('label').notNull(),
    tactic: text('tactic').notNull(),
    isAsPlanned: boolean('is_as_planned').notNull(),
    discountDepth: doublePrecision('discount_depth'),
    fundingMethod: text('funding_method'),
    featureAd: boolean('feature_ad'),
    inStoreDisplay: boolean('in_store_display'),
    promoPrice: doublePrecision('promo_price'),
    baselineUnits: doublePrecision('baseline_units'),
    forecastUnits: doublePrecision('forecast_units'),
    grossIncrementalUnits: doublePrecision('gross_incremental_units'),
    dipUnits: doublePrecision('dip_units'),
    cannibalizedUnits: doublePrecision('cannibalized_units'),
    forwardBuyUnits: doublePrecision('forward_buy_units'),
    netIncrementalUnits: doublePrecision('net_incremental_units'),
    volumeKept: doublePrecision('volume_kept'),
    tradeSpend: doublePrecision('trade_spend'),
    incrementalGp: doublePrecision('incremental_gp'),
    netProfit: doublePrecision('net_profit'),
    roi: doublePrecision('roi'),
    policyCompliant: boolean('policy_compliant').notNull(),
    policyNotes: text('policy_notes'),
    recommended: boolean('recommended').notNull(),
    analogEvents: integer('analog_events'),
  },
  (t) => [uniqueIndex('plan_scenarios_pk').on(t.planEventId, t.scenarioKey)],
);

/** WRITE-BACK: every approved re-plan (the promo-plan system of record, TPG-2027 §5.3). */
export const planDecisions = appSchema.table(
  'plan_decisions',
  {
    id: text('id').primaryKey(),
    planEventId: text('plan_event_id').notNull(),
    retailerName: text('retailer_name').notNull(),
    productName: text('product_name').notNull(),
    startWeek: date('start_week'),
    fromLabel: text('from_label').notNull(),
    toLabel: text('to_label').notNull(),
    toScenarioKey: text('to_scenario_key').notNull(),
    fromNetProfit: doublePrecision('from_net_profit'),
    toNetProfit: doublePrecision('to_net_profit'),
    fromRoi: doublePrecision('from_roi'),
    toRoi: doublePrecision('to_roi'),
    fromTradeSpend: doublePrecision('from_trade_spend'),
    toTradeSpend: doublePrecision('to_trade_spend'),
    fromVolume: doublePrecision('from_volume'),
    toVolume: doublePrecision('to_volume'),
    rationale: text('rationale'),
    approvedBy: text('approved_by').notNull(),
    via: text('via').notNull().default('copilot'),
    retailerNotice: text('retailer_notice'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('plan_decisions_event_idx').on(t.planEventId)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
