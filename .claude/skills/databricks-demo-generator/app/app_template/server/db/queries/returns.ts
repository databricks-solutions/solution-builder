import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { AuditEntry, EmailEntry } from '../schema.js';
import { fillTemplate, splitName } from '../../lib/templates.js';

export type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'escalated';
export type Decision = 'approved' | 'rejected' | 'escalated';
export type { AuditEntry, EmailEntry };

export type ReturnListRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerId: string | null;
  loyaltyTier: string | null;
  /** Premium tier from the ML model's predictions mirror.
   * `null` if no prediction exists for the customer (e.g. predictions
   * table hadn't been populated when sync ran). The agent's tiered offer
   * defaults missing-or-`standard` to the standard coupon. */
  finalTier: 'premium' | 'standard' | null;
  /** Was the CS team's explicit hand-tag on the customer (pass-through
   * from `customers.premium_status` via `customer_premium.premium_status_labeled`).
   * `null` when CS never reviewed them — those rows are the "hidden
   * premiums" the model identified if `finalTier='premium'`. */
  premiumStatusLabeled: 'premium' | 'not_premium' | null;
  /** Raw model output, 0–1. */
  premiumProb: number | null;
  /** Anger score from `ai_classify(return_reason_text)` in SDP, 0–1.
   * The Operations queue surfaces this as a column + default sort. */
  angerScore: number | null;
  sku: string | null;
  productName: string | null;
  category: string | null;
  lot: string | null;
  returnReason: string | null;
  returnValueUsd: string;
  status: ReturnStatus;
  /** Percent-off coupon the bulk tool applied (null until processed). */
  couponPctApplied: number | null;
  region: string | null;
  returnDate: string | null;
  createdAt: string;
  updatedAt: string;
};

function toListRow(r: {
  return_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  loyalty_tier: string | null;
  final_tier: string | null;
  premium_status_labeled: string | null;
  premium_prob: number | string | null;
  anger_score: number | string | null;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  lot_id: string | null;
  return_reason: string | null;
  refund_amount_usd: string;
  status: ReturnStatus;
  coupon_pct_applied: number | null;
  region: string | null;
  return_date: string | null;
  created_at: string;
  updated_at: string;
}): ReturnListRow {
  return {
    id: r.return_id,
    customerId: r.customer_id,
    customerName: r.customer_name ?? '—',
    customerEmail: r.customer_email ?? '',
    loyaltyTier: r.loyalty_tier,
    finalTier:
      r.final_tier === 'premium' || r.final_tier === 'standard'
        ? r.final_tier
        : null,
    premiumStatusLabeled:
      r.premium_status_labeled === 'premium' ||
      r.premium_status_labeled === 'not_premium'
        ? r.premium_status_labeled
        : null,
    premiumProb:
      r.premium_prob === null || r.premium_prob === undefined
        ? null
        : Number(r.premium_prob),
    angerScore:
      r.anger_score === null || r.anger_score === undefined
        ? null
        : Number(r.anger_score),
    sku: r.product_id,
    productName: r.product_name,
    category: r.category,
    lot: r.lot_id,
    returnReason: r.return_reason,
    returnValueUsd:
      r.refund_amount_usd !== null && r.refund_amount_usd !== undefined
        ? Number(r.refund_amount_usd).toFixed(2)
        : '0.00',
    status: r.status,
    couponPctApplied: r.coupon_pct_applied,
    region: r.region,
    returnDate: r.return_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listReturns(
  db: AppDb,
  opts: {
    status?: ReturnStatus;
    lot?: string;
    tier?: 'premium' | 'standard';
    /** ISO-2 country code filter (joins through customers). Used by the
     *  Operations map: clicking a country narrows the queue to that geo. */
    country?: string;
    /** 'anger' = ORDER BY anger_score DESC (most upset first), the demo's
     *  `ai_classify` showcase. 'recent' (default) = ORDER BY return_date DESC.
     *  'value' = ORDER BY refund_amount_usd DESC. */
    sort?: 'anger' | 'recent' | 'value';
    limit?: number;
  } = {},
): Promise<ReturnListRow[]> {
  const limit = opts.limit ?? 200;
  const whereStatus = opts.status ? sql`AND r.status = ${opts.status}` : sql``;
  const whereLot = opts.lot ? sql`AND r.lot_id = ${opts.lot}` : sql``;
  const whereTier = opts.tier
    ? sql`AND cp.final_tier = ${opts.tier}`
    : sql``;
  const whereCountry = opts.country
    ? sql`AND c.country = ${opts.country}`
    : sql``;
  const orderBy =
    opts.sort === 'anger'
      ? sql`ORDER BY r.anger_score DESC NULLS LAST, r.return_date DESC NULLS LAST`
      : opts.sort === 'value'
        ? sql`ORDER BY r.refund_amount_usd DESC NULLS LAST, r.return_date DESC NULLS LAST`
        : sql`ORDER BY r.return_date DESC NULLS LAST, r.created_at DESC`;
  const result = await db.execute(sql`
    SELECT
      r.id AS return_id,
      r.lot_id, r.product_id, r.product_name, r.category, r.return_reason,
      r.refund_amount_usd::text AS refund_amount_usd,
      r.status, r.region, r.return_date,
      r.coupon_pct_applied,
      r.anger_score,
      r.created_at, r.updated_at,
      r.customer_id,
      (c.first_name || ' ' || c.last_name) AS customer_name,
      c.email AS customer_email,
      c.loyalty_tier,
      cp.final_tier,
      cp.premium_status_labeled,
      cp.premium_prob
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    LEFT JOIN app.customer_premium cp ON cp.customer_id = r.customer_id
    WHERE 1=1 ${whereStatus} ${whereLot} ${whereTier} ${whereCountry}
    ${orderBy}
    LIMIT ${limit}
  `);
  return (result.rows as Parameters<typeof toListRow>[0][]).map(toListRow);
}

export type ReturnDetailRow = {
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

export async function getReturn(
  db: AppDb,
  id: string,
): Promise<ReturnDetailRow | null> {
  const result = await db.execute(sql`
    SELECT
      r.id AS return_id,
      r.order_id,
      r.lot_id, r.facility, r.product_id, r.product_name, r.category,
      r.return_reason, r.return_reason_text, r.anger_score,
      r.refund_amount_usd::text AS refund_amount_usd,
      r.status, r.coupon_pct_applied,
      r.region, r.return_date, r.order_date, r.decided_at,
      r.created_at, r.updated_at,
      r.emails, r.ai_audit_trail,
      r.customer_id,
      (c.first_name || ' ' || c.last_name) AS customer_name,
      c.email AS customer_email,
      c.loyalty_tier,
      c.region AS customer_region,
      c.country AS customer_country,
      c.registration_date,
      o.total_usd::text AS order_total_usd,
      cp.final_tier,
      cp.premium_status_labeled,
      cp.premium_prob,
      cp.predicted_at
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    LEFT JOIN app.orders o ON o.id = r.order_id
    LEFT JOIN app.customer_premium cp ON cp.customer_id = r.customer_id
    WHERE r.id = ${id}
    LIMIT 1
  `);
  const row = result.rows[0] as
    | (Omit<
        ReturnDetailRow,
        'final_tier' | 'premium_status_labeled' | 'premium_prob' | 'anger_score'
      > & {
        final_tier: string | null;
        premium_status_labeled: string | null;
        premium_prob: number | string | null;
        anger_score: number | string | null;
      })
    | undefined;
  if (!row) return null;
  return {
    ...row,
    final_tier:
      row.final_tier === 'premium' || row.final_tier === 'standard'
        ? row.final_tier
        : null,
    premium_status_labeled:
      row.premium_status_labeled === 'premium' ||
      row.premium_status_labeled === 'not_premium'
        ? row.premium_status_labeled
        : null,
    premium_prob:
      row.premium_prob === null || row.premium_prob === undefined
        ? null
        : Number(row.premium_prob),
    anger_score:
      row.anger_score === null || row.anger_score === undefined
        ? null
        : Number(row.anger_score),
  } as ReturnDetailRow;
}

/**
 * Operator-driven single-return decision. Appends one audit entry and
 * flips the status in one statement.
 */
export async function decideReturn(
  db: AppDb,
  args: {
    id: string;
    userEmail: string;
    decision: Decision;
    notes?: string;
  },
): Promise<ReturnDetailRow | null> {
  const auditEntry: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: args.decision,
    notes: args.notes,
  };
  await db.execute(sql`
    UPDATE app.returns
    SET status = ${args.decision},
        decided_at = now(),
        updated_at = now(),
        ai_audit_trail = ai_audit_trail || ${JSON.stringify([auditEntry])}::jsonb
    WHERE id = ${args.id}
  `);
  return getReturn(db, args.id);
}

export async function returnsSummary(db: AppDb) {
  const rows = await db.execute(sql`
    SELECT
      status,
      COUNT(*)::int AS n,
      COALESCE(SUM(refund_amount_usd), 0)::text AS total_usd
    FROM app.returns
    GROUP BY status
  `);
  return rows.rows as Array<{ status: ReturnStatus; n: number; total_usd: string }>;
}

export async function facilitySummary(db: AppDb) {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(r.facility, 'Unknown') AS facility,
      COUNT(*)::int AS return_count,
      COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending_count,
      SUM(r.refund_amount_usd)::numeric::text AS total_refund_usd
    FROM app.returns r
    GROUP BY COALESCE(r.facility, 'Unknown')
    ORDER BY return_count DESC
  `);
  return rows.rows as Array<{
    facility: string;
    return_count: number;
    pending_count: number;
    total_refund_usd: string;
  }>;
}

export async function lotsByFacility(
  db: AppDb,
  facility: string,
  limit = 5,
) {
  const rows = await db.execute(sql`
    SELECT
      r.lot_id,
      COUNT(*)::int AS return_count,
      COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending_count,
      SUM(r.refund_amount_usd)::numeric::text AS total_refund_usd,
      COUNT(DISTINCT r.product_id)::int AS product_count,
      string_agg(DISTINCT r.product_name, ', ' ORDER BY r.product_name) AS product_names
    FROM app.returns r
    WHERE r.facility = ${facility}
      AND r.lot_id IS NOT NULL
    GROUP BY r.lot_id
    ORDER BY return_count DESC
    LIMIT ${limit}
  `);
  return rows.rows as Array<{
    lot_id: string;
    return_count: number;
    pending_count: number;
    total_refund_usd: string;
    product_count: number;
    product_names: string | null;
  }>;
}

export async function lotSummary(db: AppDb, limit = 10) {
  const rows = await db.execute(sql`
    SELECT
      r.lot_id,
      COUNT(*)::int AS return_count,
      COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending_count,
      SUM(r.refund_amount_usd)::numeric::text AS total_refund_usd,
      MAX(r.facility) AS facility,
      COUNT(DISTINCT r.product_id)::int AS product_count,
      string_agg(DISTINCT r.product_name, ', ' ORDER BY r.product_name) AS product_names
    FROM app.returns r
    WHERE r.lot_id IS NOT NULL
    GROUP BY r.lot_id
    ORDER BY return_count DESC
    LIMIT ${limit}
  `);
  return rows.rows as Array<{
    lot_id: string;
    return_count: number;
    pending_count: number;
    total_refund_usd: string;
    facility: string | null;
    product_count: number;
    product_names: string | null;
  }>;
}

export async function listCustomerOrders(
  db: AppDb,
  customerId: string,
  limit = 10,
) {
  const rows = await db.execute(sql`
    SELECT
      o.id AS order_id,
      o.order_date,
      o.total_usd::text AS total_usd,
      o.status,
      COUNT(r.id)::int AS item_count
    FROM app.orders o
    LEFT JOIN app.returns r ON r.order_id = o.id
    WHERE o.customer_id = ${customerId}
    GROUP BY o.id, o.order_date, o.total_usd, o.status
    ORDER BY o.order_date DESC
    LIMIT ${limit}
  `);
  return rows.rows as Array<{
    order_id: string;
    order_date: string | null;
    total_usd: string;
    status: string | null;
    item_count: number;
  }>;
}

/**
 * Recent activity across all returns. Unnest emails[] + ai_audit_trail[],
 * merge, order by `at`. OK at 33K rows; add an index if it slows.
 */
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

export async function recentActivity(
  db: AppDb,
  limit = 20,
): Promise<ActivityEvent[]> {
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT
        'email' AS kind,
        r.id AS return_id,
        (e->>'at') AS at,
        (e->>'direction') AS direction,
        (e->>'from') AS from_addr,
        (e->>'to') AS to_addr,
        (e->>'subject') AS subject,
        (e->>'body') AS body,
        NULL::text AS by_email,
        NULL::text AS action,
        NULL::text AS notes,
        NULL::text AS tool
      FROM app.returns r, jsonb_array_elements(r.emails) AS e
      UNION ALL
      SELECT
        'audit' AS kind,
        r.id AS return_id,
        (a->>'at') AS at,
        NULL, NULL, NULL, NULL, NULL,
        (a->>'by') AS by_email,
        (a->>'action') AS action,
        (a->>'notes') AS notes,
        (a->>'tool') AS tool
      FROM app.returns r, jsonb_array_elements(r.ai_audit_trail) AS a
    ) sub
    ORDER BY at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => {
    if (r.kind === 'email') {
      return {
        kind: 'email',
        return_id: r.return_id as string,
        at: r.at as string,
        direction: (r.direction as 'outgoing' | 'incoming') ?? 'outgoing',
        from: (r.from_addr as string | null) ?? null,
        to: (r.to_addr as string | null) ?? null,
        subject: (r.subject as string) ?? '',
        body: (r.body as string) ?? '',
      };
    }
    return {
      kind: 'audit',
      return_id: r.return_id as string,
      at: r.at as string,
      by: (r.by_email as string) ?? '',
      action: (r.action as string) ?? '',
      notes: (r.notes as string | null) ?? null,
      tool: (r.tool as string | null) ?? null,
    };
  });
}

// ============================================================================
// Premium-cohort breakdown for a lot — used by the agent's tier-split
// "what's the cohort?" tool. Joins returns × customers × predictions.
// Same predicate as processReturnBatchForLot (lot + status='pending')
// so what the agent quotes in Phase 2 matches what Phase 3 writes to.
//
// Reports BOTH the overall premium count AND the labeled-vs-predicted
// split so the agent can say "CS had tagged X; the model found Y more
// hidden premiums" — the story beat that proves the model is doing
// something a SQL filter can't.
// ============================================================================

export type LotPremiumBreakdown = {
  lot: string;
  total: number;
  premium_count: number;
  standard_count: number;
  /** Of the premium count, how many already had `premium_status_labeled='premium'`. */
  premium_labeled_count: number;
  /** Of the premium count, how many were untagged by CS but flagged by the model. */
  premium_predicted_hidden_count: number;
  /** Customers in this lot with no row in customer_premium at all
   *  (predictions table empty or pre-ML state). Folded into standard. */
  no_prediction_count: number;
  premium_refund_usd: number;
  standard_refund_usd: number;
  top_countries: Array<{ country: string; premium: number; total: number }>;
};

export async function lotPremiumBreakdown(
  db: AppDb,
  lot: string,
): Promise<LotPremiumBreakdown> {
  const totalsRes = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE cp.final_tier = 'premium')::int AS premium_count,
      COUNT(*) FILTER (WHERE cp.final_tier = 'standard' OR cp.final_tier IS NULL)::int AS standard_count,
      COUNT(*) FILTER (
        WHERE cp.final_tier = 'premium' AND cp.premium_status_labeled = 'premium'
      )::int AS premium_labeled_count,
      COUNT(*) FILTER (
        WHERE cp.final_tier = 'premium'
          AND (cp.premium_status_labeled IS NULL OR cp.premium_status_labeled <> 'premium')
      )::int AS premium_predicted_hidden_count,
      COUNT(*) FILTER (WHERE cp.final_tier IS NULL)::int AS no_prediction_count,
      COALESCE(SUM(r.refund_amount_usd) FILTER (WHERE cp.final_tier = 'premium'), 0)::text AS premium_refund_usd,
      COALESCE(SUM(r.refund_amount_usd) FILTER (WHERE cp.final_tier <> 'premium' OR cp.final_tier IS NULL), 0)::text AS standard_refund_usd
    FROM app.returns r
    LEFT JOIN app.customer_premium cp ON cp.customer_id = r.customer_id
    WHERE r.lot_id = ${lot} AND r.status = 'pending'
  `);
  const totals = (totalsRes.rows[0] ?? {}) as {
    total: number;
    premium_count: number;
    standard_count: number;
    premium_labeled_count: number;
    premium_predicted_hidden_count: number;
    no_prediction_count: number;
    premium_refund_usd: string;
    standard_refund_usd: string;
  };

  const countriesRes = await db.execute(sql`
    SELECT
      COALESCE(c.country, 'Unknown') AS country,
      COUNT(*) FILTER (WHERE cp.final_tier = 'premium')::int AS premium,
      COUNT(*)::int AS total
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    LEFT JOIN app.customer_premium cp ON cp.customer_id = r.customer_id
    WHERE r.lot_id = ${lot} AND r.status = 'pending'
    GROUP BY COALESCE(c.country, 'Unknown')
    ORDER BY premium DESC, total DESC
    LIMIT 5
  `);

  return {
    lot,
    total: totals.total ?? 0,
    premium_count: totals.premium_count ?? 0,
    standard_count: totals.standard_count ?? 0,
    premium_labeled_count: totals.premium_labeled_count ?? 0,
    premium_predicted_hidden_count: totals.premium_predicted_hidden_count ?? 0,
    no_prediction_count: totals.no_prediction_count ?? 0,
    premium_refund_usd: Number(totals.premium_refund_usd ?? 0),
    standard_refund_usd: Number(totals.standard_refund_usd ?? 0),
    top_countries: (countriesRes.rows as Array<{
      country: string;
      premium: number;
      total: number;
    }>).map((r) => ({
      country: r.country,
      premium: r.premium,
      total: r.total,
    })),
  };
}

// ============================================================================
// Geographic breakdown of the queue — drives the Operations page country
// panel. Aggregates the *currently-filtered* queue (status + optional lot)
// by country, returning per-country premium share so the panel can render
// "France: 32 affected, 24 premium (75%)" and let the user click to filter.
// ============================================================================

export type CountryBucket = {
  country: string;
  total: number;
  premium: number;
  /** Of the premium count, how many CS already tagged premium. */
  premium_labeled: number;
  /** Of the premium count, how many the model surfaced as hidden premiums. */
  premium_hidden: number;
  refund_usd: number;
};

export async function lotCountryBreakdown(
  db: AppDb,
  opts: {
    status?: ReturnStatus;
    lot?: string;
    limit?: number;
  } = {},
): Promise<CountryBucket[]> {
  const limit = opts.limit ?? 20;
  const whereStatus = opts.status
    ? sql`AND r.status = ${opts.status}`
    : sql``;
  const whereLot = opts.lot ? sql`AND r.lot_id = ${opts.lot}` : sql``;
  const res = await db.execute(sql`
    SELECT
      COALESCE(c.country, 'Unknown') AS country,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE cp.final_tier = 'premium')::int AS premium,
      COUNT(*) FILTER (
        WHERE cp.final_tier = 'premium' AND cp.premium_status_labeled = 'premium'
      )::int AS premium_labeled,
      COUNT(*) FILTER (
        WHERE cp.final_tier = 'premium'
          AND (cp.premium_status_labeled IS NULL OR cp.premium_status_labeled <> 'premium')
      )::int AS premium_hidden,
      COALESCE(SUM(r.refund_amount_usd), 0)::text AS refund_usd
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    LEFT JOIN app.customer_premium cp ON cp.customer_id = r.customer_id
    WHERE 1=1 ${whereStatus} ${whereLot}
    GROUP BY COALESCE(c.country, 'Unknown')
    ORDER BY total DESC
    LIMIT ${limit}
  `);
  return (
    res.rows as Array<{
      country: string;
      total: number;
      premium: number;
      premium_labeled: number;
      premium_hidden: number;
      refund_usd: string;
    }>
  ).map((r) => ({
    country: r.country,
    total: r.total,
    premium: r.premium,
    premium_labeled: r.premium_labeled,
    premium_hidden: r.premium_hidden,
    refund_usd: Number(r.refund_usd),
  }));
}

// ============================================================================
// Bulk: process_return_batch — one UPDATE, all returns at once,
// tiered per row by joining against the premium predictions mirror.
// ============================================================================

export type TierOffer = {
  coupon_code: string;
  percent_off: number;
  email_subject_template: string;
  email_body_template: string;
};

export type ProcessBatchResult = {
  premium_coupon: string;
  standard_coupon: string;
  premium_email_count: number;
  /** Of `premium_email_count`, how many recipients had `premium_status_labeled='premium'`. */
  premium_labeled_count: number;
  /** Of `premium_email_count`, how many were "hidden premiums" the model identified. */
  premium_predicted_hidden_count: number;
  standard_email_count: number;
  approved_count: number;
  total_refund_usd: number;
  skipped_return_ids: string[];
};


/**
 * Bulk process every PENDING return in `lot`, **tiered per row** by joining
 * against the premium predictions mirror:
 *   - look up eligible rows + customer info + final_tier in one query
 *   - for each row, pick the matching tier's coupon + templates
 *     (rows with no prediction default to the `standard` tier)
 *   - render the email template per customer in JS
 *   - in a single UPDATE: set coupon_pct_applied, append one email + two
 *     audit entries, flip to approved
 *
 * The tool only sends the lot (a scalar) + two TierOffer dicts — the SQL
 * does the row lookup and tier classification atomically with the update.
 * We never round-trip a list of IDs back to the agent and back to SQL,
 * so no `IN (…)` / `ANY (…)` headaches and no positional-param caps.
 *
 * PATTERN FOR FORKS — tier-driven bulk writes should follow this shape:
 *   1. Tool accepts a FILTER (lot, status, region — a scalar or two) and
 *      a `tier_offers: {premium, standard}` dict, never a list of IDs.
 *   2. SELECT the eligible rows once with their related data + the tier
 *      key (here: `final_tier` from `app.customer_premium`).
 *   3. Branch in JS per-row using the tier key to pick the offer; render
 *      templates in JS — Postgres' format()/interpolation is a footgun.
 *   4. One UPDATE ... FROM (VALUES ...) re-asserts the same filter so
 *      writes can't drift from reads, and records `coupon_pct_applied`
 *      so the queue tells the tiering story after the fact.
 */
export async function processReturnBatchForLot(
  db: AppDb,
  args: {
    lot: string;
    tier_offers: { premium: TierOffer; standard: TierOffer };
    from_email?: string;
    userEmail: string;
  },
): Promise<ProcessBatchResult> {
  // 1) Look up eligible rows + customer info + premium tier. Filter is the
  //    lot — a single bound parameter — so no `IN (…)`, no array expansion.
  const rowsRes = await db.execute(sql`
    SELECT
      r.id AS return_id,
      r.status,
      r.refund_amount_usd::text AS refund,
      (c.first_name || ' ' || c.last_name) AS customer_name,
      c.email AS customer_email,
      r.product_name,
      cp.final_tier,
      cp.premium_status_labeled
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    LEFT JOIN app.customer_premium cp ON cp.customer_id = r.customer_id
    WHERE r.lot_id = ${args.lot} AND r.status = 'pending'
  `);
  const rows = rowsRes.rows as Array<{
    return_id: string;
    status: string;
    refund: string;
    customer_name: string | null;
    customer_email: string | null;
    product_name: string | null;
    final_tier: string | null;
    premium_status_labeled: string | null;
  }>;

  // `status = 'pending'` is already in the WHERE — anything missing customer
  // info gets skipped here and reported back so the agent can flag it.
  const eligible = rows.filter((r) => r.customer_email && r.customer_name);
  const skipped = rows
    .filter((r) => !r.customer_email || !r.customer_name)
    .map((r) => r.return_id);

  if (eligible.length === 0) {
    return {
      premium_coupon: args.tier_offers.premium.coupon_code,
      standard_coupon: args.tier_offers.standard.coupon_code,
      premium_email_count: 0,
      premium_labeled_count: 0,
      premium_predicted_hidden_count: 0,
      standard_email_count: 0,
      approved_count: 0,
      total_refund_usd: 0,
      skipped_return_ids: skipped,
    };
  }

  const now = new Date().toISOString();
  const fromEmail = args.from_email ?? 'care@luxebeauty.example';

  // 2) Build the VALUES list: (id, coupon_pct, email_entry_json, audit_entries_json).
  //    Each row gets the tier's coupon + the matching email; rows with no
  //    prediction (or any non-'premium' tier value) fall through to standard.
  const valuesParts: ReturnType<typeof sql>[] = [];
  let totalRefundCents = 0;
  let premiumCount = 0;
  let premiumLabeledCount = 0;
  let premiumHiddenCount = 0;
  let standardCount = 0;

  for (const row of eligible) {
    const tier = row.final_tier === 'premium' ? 'premium' : 'standard';
    const offer = args.tier_offers[tier];
    if (tier === 'premium') {
      premiumCount++;
      if (row.premium_status_labeled === 'premium') premiumLabeledCount++;
      else premiumHiddenCount++;
    } else {
      standardCount++;
    }

    const { firstname, lastname } = splitName(row.customer_name!);
    const productName = row.product_name ?? 'your order';
    const subject = fillTemplate(offer.email_subject_template, {
      firstname,
      lastname,
      product_name: productName,
      coupon_code: offer.coupon_code,
    });
    const body = fillTemplate(offer.email_body_template, {
      firstname,
      lastname,
      product_name: productName,
      coupon_code: offer.coupon_code,
    });

    const emailEntry: EmailEntry = {
      at: now,
      direction: 'outgoing',
      from: fromEmail,
      to: row.customer_email!,
      subject,
      body,
    };
    // For the audit log, distinguish "CS-tagged premium" vs "hidden premium"
    // so finance / CS can later reconstruct the decision rationale per row.
    const labeledSuffix =
      tier === 'premium'
        ? row.premium_status_labeled === 'premium'
          ? ' (CS-tagged)'
          : ' (hidden — model-found)'
        : '';
    const auditEntries: AuditEntry[] = [
      {
        at: now,
        by: args.userEmail,
        action: 'email_sent',
        notes: `Tier=${tier}${labeledSuffix} · ${offer.percent_off}% coupon ${offer.coupon_code}`,
        tool: 'process_return_batch',
      },
      {
        at: now,
        by: args.userEmail,
        action: 'approved',
        notes: `Auto-approved with ${offer.percent_off}% coupon (${tier}${labeledSuffix})`,
        tool: 'process_return_batch',
      },
    ];

    valuesParts.push(
      sql`(${row.return_id}, ${offer.percent_off}::int, ${JSON.stringify([emailEntry])}::jsonb, ${JSON.stringify(auditEntries)}::jsonb)`,
    );

    const cents = Math.round(Number(row.refund) * 100);
    if (!Number.isNaN(cents)) totalRefundCents += cents;
  }

  // 3) One UPDATE ... FROM (VALUES ...) — hits every eligible row at once.
  //    The `r.lot_id = ${args.lot} AND r.status = 'pending'` re-assertion
  //    keeps this idempotent: if a concurrent run already approved some of
  //    these rows, they're filtered out automatically.
  await db.execute(sql`
    UPDATE app.returns AS r
    SET status = 'approved',
        coupon_pct_applied = v.coupon_pct,
        decided_at = now(),
        updated_at = now(),
        emails = r.emails || v.email_entry,
        ai_audit_trail = r.ai_audit_trail || v.audit_entries
    FROM (VALUES ${sql.join(valuesParts, sql`, `)}) AS v(id, coupon_pct, email_entry, audit_entries)
    WHERE r.id = v.id
      AND r.lot_id = ${args.lot}
      AND r.status = 'pending'
  `);

  return {
    premium_coupon: args.tier_offers.premium.coupon_code,
    standard_coupon: args.tier_offers.standard.coupon_code,
    premium_email_count: premiumCount,
    premium_labeled_count: premiumLabeledCount,
    premium_predicted_hidden_count: premiumHiddenCount,
    standard_email_count: standardCount,
    approved_count: eligible.length,
    total_refund_usd: totalRefundCents / 100,
    skipped_return_ids: skipped,
  };
}
