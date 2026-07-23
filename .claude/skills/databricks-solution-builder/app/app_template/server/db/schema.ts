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
// Delta mirror
// ============================================================================

export const customers = appSchema.table('customers', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  region: text('region'),
  country: text('country'),
  city: text('city'),
  // City-anchored coords (anchor + ~5km jitter from the synth script).
  // Drives the Operations bubble map: per-city circles sized by COUNT(*).
  customerLat: doublePrecision('customer_lat'),
  customerLng: doublePrecision('customer_lng'),
  loyaltyTier: text('loyalty_tier'),
  // CS hand-tag — pass-through from bronze. NULL means "never reviewed",
  // not "not premium". The premium classifier in spec 03-ml-premium.md
  // trains only on the labeled rows and predicts on the NULL ones.
  premiumStatus: text('premium_status', { enum: ['premium', 'not_premium'] }),
  registrationDate: date('registration_date'),
});

// Read-only mirror of the ML model's batch predictions table
// (`{catalog}.{schema}.gold_customer_premium_predictions`, written by the
// notebook in spec `03-ml-premium.md`). The app never calls the model
// directly — downstream agent tools (`find_lot_premium_breakdown`, the
// per-row JOIN inside `process_return_batch`) read from this table to
// tier the offer. Refreshed by sync.ts on first boot + on "Reset demo".
//
// `premiumStatusLabeled` is the pass-through CS tag (also lives on
// `customers.premiumStatus` — duplicated here for single-table reads).
// `finalTier` is the rule that combines labeled + predicted: 'premium'
// if EITHER `premiumStatusLabeled = 'premium'` OR the model predicted
// premium; else 'standard'. The agent's bulk tool reads this column.
export const customerPremium = appSchema.table(
  'customer_premium',
  {
    customerId: text('customer_id').primaryKey(),
    premiumProb: doublePrecision('premium_prob').notNull(),
    finalTier: text('final_tier', { enum: ['premium', 'standard'] }).notNull(),
    premiumStatusLabeled: text('premium_status_labeled', {
      enum: ['premium', 'not_premium'],
    }),
    predictedAt: timestamp('predicted_at', { withTimezone: true }),
  },
  (t) => [index('customer_premium_tier_idx').on(t.finalTier)],
);

export const orders = appSchema.table(
  'orders',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    orderDate: date('order_date'),
    region: text('region'),
    totalUsd: doublePrecision('total_usd'),
    status: text('status'),
  },
  (t) => [index('orders_customer_idx').on(t.customerId, t.orderDate)],
);

export const returns = appSchema.table(
  'returns',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    customerId: text('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    returnDate: date('return_date'),
    orderDate: date('order_date'),
    refundAmountUsd: doublePrecision('refund_amount_usd').notNull(),
    returnReason: text('return_reason'),
    returnReasonText: text('return_reason_text'),
    // Anger score from `ai_classify(return_reason_text, ['angry','neutral','benign'])`
    // computed in SDP and synced as-is. 1.0=angry, 0.5=neutral, 0.0=benign.
    // The Operations queue is sortable by this — most upset customers
    // float to the top. Showcases AI Functions inside the pipeline.
    angerScore: doublePrecision('anger_score'),
    productId: text('product_id'),
    productName: text('product_name'),
    category: text('category'),
    lotId: text('lot_id'),
    facility: text('facility'),
    region: text('region'),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected', 'escalated'],
    })
      .notNull()
      .default('pending'),

    // Percent-off coupon the agent's bulk tool applied to this row,
    // chosen per-customer by joining against `customer_premium`:
    //   final_tier='premium'  → 20
    //   final_tier='standard' → 5
    // Null until the bulk tool runs. Operations table shows it as a badge
    // so the queue tells the model-driven tiering story even after the
    // chat session is closed.
    couponPctApplied: integer('coupon_pct_applied'),

    // Append-only correspondence timeline. Each entry:
    //   { at, direction, from?, to?, subject, body }
    emails: jsonb('emails').$type<EmailEntry[]>().notNull().default([]),

    // Append-only audit trail. Each entry:
    //   { at, by, action, notes?, tool? }
    aiAuditTrail: jsonb('ai_audit_trail')
      .$type<AuditEntry[]>()
      .notNull()
      .default([]),

    decidedAt: timestamp('decided_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('returns_status_idx').on(t.status, t.createdAt),
    index('returns_lot_idx').on(t.lotId),
    index('returns_customer_idx').on(t.customerId),
    index('returns_product_idx').on(t.productId),
  ],
);

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
  action: 'approved' | 'rejected' | 'escalated' | 'email_sent' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
