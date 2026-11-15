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
 *   2. Yield desk   (campaigns, opportunities) — live campaigns with pacing /
 *                   make-good risk and the programmatic yield opportunities,
 *                   mirrored from the Delta gold tables by db/sync.ts at boot /
 *                   on "Reset demo". Each campaign row carries the latest AI
 *                   recovery plan, the agency-notice draft and an audit trail.
 *   3. Write-back   (yield_plans, floor_changes) — the recovery plan the yield
 *                   manager (or the copilot, on request) approves and sends to
 *                   ad ops, and the floor-price changes it includes.
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
// Yield desk mirror (campaigns + opportunities) + write-back (yield_plans, floor_changes)
// ============================================================================

/** Live + booked campaigns (gold_campaign_pacing + gold_line_pacing) mirrored at boot / "Reset demo". */
export const campaigns = appSchema.table(
  'campaigns',
  {
    id: text('id').primaryKey(),
    ioNumber: text('io_number').notNull(),
    name: text('name').notNull(),
    advertiserName: text('advertiser_name').notNull(),
    advertiserCategory: text('advertiser_category'),
    agency: text('agency'),
    dealType: text('deal_type'),
    targetSegmentId: text('target_segment_id').notNull(),
    targetSegment: text('target_segment').notNull(),
    flightStart: date('flight_start', { mode: 'string' }).notNull(),
    flightEnd: date('flight_end', { mode: 'string' }).notNull(),
    deliveryStatus: text('delivery_status').notNull(),
    salesOwner: text('sales_owner'),
    makeGoodTerms: text('make_good_terms'),
    bookedImpressions: doublePrecision('booked_impressions').notNull(),
    bookedRevenue: doublePrecision('booked_revenue').notNull(),
    bookedCpm: doublePrecision('booked_cpm').notNull(),
    flightDays: integer('flight_days'),
    daysRemaining: integer('days_remaining'),
    delivered: doublePrecision('delivered'),
    expectedToDate: doublePrecision('expected_to_date'),
    pacing: doublePrecision('pacing'),
    runRateDaily: doublePrecision('run_rate_daily'),
    projectedDelivery: doublePrecision('projected_delivery'),
    projectedDeliveryPct: doublePrecision('projected_delivery_pct'),
    projectedShortfall: doublePrecision('projected_shortfall'),
    makeGoodLiability: doublePrecision('make_good_liability'),
    atRisk: boolean('at_risk').notNull().default(false),
    riskProductId: text('risk_product_id'),
    riskProductName: text('risk_product_name'),
    riskProductAvailsChange: doublePrecision('risk_product_avails_change'),
    lines: jsonb('lines').$type<CampaignLine[]>().notNull().default([]),
    // workflow
    status: text('status', { enum: ['new', 'plan_drafted', 'plan_approved'] }).notNull().default('new'),
    analysis: jsonb('analysis').$type<RecoveryPlan | null>(),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    agencyNoticeDraft: text('agency_notice_draft'),
    planId: text('plan_id'),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_risk_idx').on(t.atRisk, t.makeGoodLiability)],
);

/** Programmatic yield opportunities (gold_yield_opportunities) mirrored at boot / "Reset demo". */
export const opportunities = appSchema.table('opportunities', {
  productId: text('product_id').primaryKey(),
  productName: text('product_name').notNull(),
  platform: text('platform'),
  contentCategory: text('content_category'),
  tier: text('tier'),
  rateCardCpm: doublePrecision('rate_card_cpm'),
  rateCardGroup: text('rate_card_group'),
  rateCardGroupFloor: doublePrecision('rate_card_group_floor'),
  currentGroup: text('current_group'),
  currentFloor: doublePrecision('current_floor'),
  currentRuleId: text('current_rule_id'),
  currentRuleSince: date('current_rule_since', { mode: 'string' }),
  currentRuleChangedBy: text('current_rule_changed_by'),
  changeTicket: text('change_ticket'),
  changeNote: text('change_note'),
  sellThrough28d: doublePrecision('sell_through_28d'),
  guaranteedShare28d: doublePrecision('guaranteed_share_28d'),
  pmpShare28d: doublePrecision('pmp_share_28d'),
  openShare28d: doublePrecision('open_share_28d'),
  ecpm28d: doublePrecision('ecpm_28d'),
  programmaticEcpm28d: doublePrecision('programmatic_ecpm_28d'),
  pmpEcpm28d: doublePrecision('pmp_ecpm_28d'),
  openClearing28d: doublePrecision('open_clearing_28d'),
  p50Bid28d: doublePrecision('p50_bid_28d'),
  p90Bid28d: doublePrecision('p90_bid_28d'),
  fillRetention: doublePrecision('fill_retention'),
  pmpImpressions28d: doublePrecision('pmp_impressions_28d'),
  programmaticEcpmBeforeRule: doublePrecision('programmatic_ecpm_before_rule'),
  groupMismatch: boolean('group_mismatch').notNull().default(false),
  revenueGap28d: doublePrecision('revenue_gap_28d'),
  revenueGapAnnualized: doublePrecision('revenue_gap_annualized'),
  revenueGapSinceRule: doublePrecision('revenue_gap_since_rule'),
  recommendedGroup: text('recommended_group'),
  recommendedFloor: doublePrecision('recommended_floor'),
  isLeak: boolean('is_leak').notNull().default(false),
  weekly: jsonb('weekly').$type<Array<{ week: string; programmatic_ecpm: number; open_clearing: number | null; pmp_share: number; group: string }>>().notNull().default([]),
  floorChangeId: text('floor_change_id'),
});

/** WRITE-BACK: the recovery plan approved by the yield manager and sent to ad ops. */
export const yieldPlans = appSchema.table('yield_plans', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  title: text('title').notNull(),
  advertiserName: text('advertiser_name').notNull(),
  reallocations: jsonb('reallocations').$type<Reallocation[]>().notNull().default([]),
  floorChanges: jsonb('floor_changes').$type<FloorRecommendation[]>().notNull().default([]),
  impressionsMoved: doublePrecision('impressions_moved'),
  shortfallCovered: doublePrecision('shortfall_covered'),
  liabilityAvoided: doublePrecision('liability_avoided'),
  displacedRevenue: doublePrecision('displaced_revenue'),
  floorUplift: doublePrecision('floor_uplift'),
  netImpact: doublePrecision('net_impact'),
  agencyNotice: text('agency_notice'),
  adOpsInstructions: text('ad_ops_instructions'),
  status: text('status', { enum: ['sent_to_ad_ops', 'live'] }).notNull().default('sent_to_ad_ops'),
  approvedBy: text('approved_by').notNull(),
  approvedVia: text('approved_via', { enum: ['workbench', 'copilot'] }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** WRITE-BACK: floor-price / inventory-group changes queued for ad ops. */
export const floorChanges = appSchema.table('floor_changes', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  fromGroup: text('from_group'),
  toGroup: text('to_group'),
  fromFloor: doublePrecision('from_floor'),
  toFloor: doublePrecision('to_floor'),
  releaseFromDeal: text('release_from_deal'),
  expectedUplift30d: doublePrecision('expected_uplift_30d'),
  expectedUpliftAnnualized: doublePrecision('expected_uplift_annualized'),
  planId: text('plan_id'),
  rationale: text('rationale'),
  status: text('status', { enum: ['pending_ad_ops', 'applied'] }).notNull().default('pending_ad_ops'),
  requestedBy: text('requested_by').notNull(),
  requestedVia: text('requested_via', { enum: ['workbench', 'copilot', 'yield_board'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignLine = {
  line_id: string; product_id: string; product_name: string; platform: string; tier: string;
  booked: number; cpm: number; delivered: number; expected: number; pacing: number | null;
  run_rate: number; planned_daily: number; projected: number; avails_change: number | null;
};

export type Finding = { id: string; title: string; verdict: 'CONFIRMED' | 'RULED_OUT' | 'INFO'; detail: string };

export type SpareOption = {
  product_id: string; product_name: string; platform: string; tier: string; eligible: boolean; reason: string;
  spare_avails: number; audience_share: number; in_target_spare: number; displaced_ecpm: number; programmatic_fill: number;
};

export type Reallocation = {
  product_id: string; product_name: string; tier: string; impressions: number; daily_cap: number;
  displaced_ecpm: number; displaced_revenue: number; audience_share: number;
};

export type FloorRecommendation = {
  product_id: string; product_name: string; from_group: string; to_group: string; from_floor: number; to_floor: number;
  release_from_deal: string | null; expected_uplift_window: number; expected_uplift_annualized: number; window_days: number; detail: string;
};

export type RecoveryPlan = {
  headline: string;
  diagnosis: string;
  summary: string;
  findings: Finding[];
  pacing: { booked: number; delivered: number; expected: number; pacing: number; projected: number; projected_pct: number; shortfall: number; liability: number; days_remaining: number; cpm: number };
  weekly_avails: Array<{ week: string; avails: number }>;
  spare: SpareOption[];
  reallocations: Reallocation[];
  floor_changes: FloorRecommendation[];
  impact: { impressions_moved: number; shortfall_covered: number; coverage_pct: number; liability_avoided: number; displaced_revenue: number; floor_uplift: number; net_impact: number };
  contract_guidance: { question: string; answer: string; source: string } | null;
  ad_ops_instructions: string;
  model: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_analysis' | 'plan_approved' | 'notice_edited' | 'floor_change' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
