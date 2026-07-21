/**
 * Types that cross the client/server boundary. Keep in sync with
 * server/db/queries/returns.ts + server/db/queries/chat.ts.
 *
 * The app is small enough that hand-copying these is simpler than a
 * shared package. If this file grows past ~200 lines, consider a
 * proper shared lib.
 *
 * ─────────────────────────────────────────────────────────────────────
 * REPURPOSING THE TEMPLATE (single most important file to update)
 * ─────────────────────────────────────────────────────────────────────
 * This is the canonical schema for the *domain* — every page, fetch
 * helper, badge, and SQL projection uses what's defined here. When you
 * swap the data model:
 *
 *   1. Replace the entity types below (`ReturnRow`, `FacilityRow`,
 *      `CustomerOrder`, `ActivityEvent`, etc.) with the shape your
 *      demo cares about.
 *   2. Update the matching SQL/Drizzle queries in
 *      `server/db/queries/returns.ts` so `/api/...` endpoints return
 *      rows that match the new types. Rename the queries file too.
 *   3. Update the fetch helpers in `client/src/lib/returns.ts` (rename
 *      to match your domain — e.g. `lib/turbines.ts`).
 *   4. The string-enum types (`ReturnStatus`, `Decision`, loyalty tier
 *      names, region names) drive badges in `shared/badges.tsx` — keep
 *      those two files aligned. Adding a new enum value means adding a
 *      matching color mapping in `badges.tsx`.
 *   5. The agent's tool argument schemas in
 *      `server/agent/refundops.ts` reference these types implicitly
 *      (the Zod schemas mirror `ReturnRow` field names).
 *      Update tool descriptions + Zod shapes when you swap entities.
 *
 * Search the codebase for each type name below to find all references
 * before renaming. There is no compile-time guarantee that SQL projects
 * the right columns — type-checking helps the client side, but the
 * server queries are stringly-typed against the warehouse.
 * ───────────────────────────────────────────────────────────────────── */

export type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'escalated';
export type Decision = 'approved' | 'rejected' | 'escalated';

export type ReturnRow = {
  id: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  loyaltyTier: string | null;
  /** Premium tier from the ML model's predictions mirror. `null` when
   * no prediction exists (or when the demo doesn't have an ML model). */
  finalTier: 'premium' | 'standard' | null;
  /** Original CS hand-tag (pass-through). `null` = "never reviewed by
   * CS"; combined with `finalTier='premium'` this means the model
   * surfaced a hidden premium — the demo's load-bearing story beat. */
  premiumStatusLabeled: 'premium' | 'not_premium' | null;
  /** Raw model output, 0.0–1.0. `null` when no prediction exists. */
  premiumProb: number | null;
  /** Per-return anger score from `ai_classify(return_reason_text)` in SDP.
   * 0=benign, 0.5=neutral, 1=angry. Drives the Operations queue's
   * default sort so the most upset customers float to the top. */
  angerScore: number | null;
  sku: string | null;
  productName: string | null;
  category: string | null;
  lot: string | null;
  returnReason: string | null;
  returnValueUsd: string;
  status: ReturnStatus;
  /** Percent-off coupon the agent's bulk tool applied to this row,
   * picked by tier (20 for 'premium', 5 for 'standard'). `null` until
   * the bulk tool has run. */
  couponPctApplied: number | null;
  region: string | null;
  returnDate: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export type ReturnDetail = {
  return_id: string;
  order_id: string | null;
  lot_id: string | null;
  facility: string | null;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  return_reason: string | null;
  return_reason_text: string | null;
  anger_score: number | null;
  refund_amount_usd: string;
  status: ReturnStatus;
  coupon_pct_applied: number | null;
  region: string | null;
  return_date: string | null;
  order_date: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  loyalty_tier: string | null;
  customer_region: string | null;
  customer_country: string | null;
  registration_date: string | null;
  order_total_usd: string | null;
  final_tier: 'premium' | 'standard' | null;
  premium_status_labeled: 'premium' | 'not_premium' | null;
  premium_prob: number | null;
  predicted_at: string | null;
  emails: EmailEntry[];
  ai_audit_trail: AuditEntry[];
};

export type ReturnsSummary = {
  status: ReturnStatus;
  n: number;
  total_usd: string;
};

/** Per-city aggregation for the Operations bubble map. One row per
 *  (city, country) with averaged customer_lat / customer_lng. The map
 *  plots a circle at (lat, lng), sized by `total`, colored by the
 *  premium share. */
export type CityBucket = {
  city: string;
  country: string;
  lat: number;
  lng: number;
  total: number;
  premium: number;
  refund_usd: number;
};

export type FacilityRow = {
  facility: string;
  return_count: number;
  pending_count: number;
  total_refund_usd: string;
};

export type FacilityLotRow = {
  lot_id: string;
  return_count: number;
  pending_count: number;
  total_refund_usd: string;
  product_count: number;
  product_names: string | null;
};

export type CustomerOrder = {
  order_id: string;
  order_date: string | null;
  total_usd: string;
  status: string | null;
  item_count: number;
};

export type ActivityEvent =
  | {
      kind: 'email';
      return_id: string;
      at: string;
      direction: 'outgoing' | 'incoming';
      from: string | null;
      to: string | null;
      subject: string;
      body: string;
    }
  | {
      kind: 'audit';
      return_id: string;
      at: string;
      by: string;
      action: string;
      notes: string | null;
      tool: string | null;
    };
