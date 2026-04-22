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
  sku: string | null;
  productName: string | null;
  category: string | null;
  lot: string | null;
  returnReason: string | null;
  returnValueUsd: string;
  status: ReturnStatus;
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
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  lot_id: string | null;
  return_reason: string | null;
  refund_amount_usd: string;
  status: ReturnStatus;
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
    limit?: number;
  } = {},
): Promise<ReturnListRow[]> {
  const limit = opts.limit ?? 200;
  const whereStatus = opts.status ? sql`AND r.status = ${opts.status}` : sql``;
  const whereLot = opts.lot ? sql`AND r.lot_id = ${opts.lot}` : sql``;
  const result = await db.execute(sql`
    SELECT
      r.id AS return_id,
      r.lot_id, r.product_id, r.product_name, r.category, r.return_reason,
      r.refund_amount_usd::text AS refund_amount_usd,
      r.status, r.region, r.return_date,
      r.created_at, r.updated_at,
      r.customer_id,
      (c.first_name || ' ' || c.last_name) AS customer_name,
      c.email AS customer_email,
      c.loyalty_tier
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    WHERE 1=1 ${whereStatus} ${whereLot}
    ORDER BY r.return_date DESC NULLS LAST, r.created_at DESC
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
  refund_amount_usd: string;
  status: ReturnStatus;
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
  registration_date: string | null;
  order_total_usd: string | null;
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
      r.return_reason, r.return_reason_text,
      r.refund_amount_usd::text AS refund_amount_usd,
      r.status, r.region, r.return_date, r.order_date, r.decided_at,
      r.created_at, r.updated_at,
      r.emails, r.ai_audit_trail,
      r.customer_id,
      (c.first_name || ' ' || c.last_name) AS customer_name,
      c.email AS customer_email,
      c.loyalty_tier,
      c.region AS customer_region,
      c.registration_date,
      o.total_usd::text AS order_total_usd
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    LEFT JOIN app.orders o ON o.id = r.order_id
    WHERE r.id = ${id}
    LIMIT 1
  `);
  return (result.rows[0] ?? null) as ReturnDetailRow | null;
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
// Bulk: process_return_batch — one UPDATE, all returns at once.
// ============================================================================

export type ProcessBatchResult = {
  coupon_code: string;
  email_count: number;
  approved_count: number;
  total_refund_usd: number;
  skipped_return_ids: string[];
};


/**
 * Bulk process every pending return in `return_ids`:
 *   - render email template per customer
 *   - append one email + two audit entries to each return row
 *   - flip status to approved
 * All in a single UPDATE statement via VALUES (...).
 */
export async function processReturnBatch(
  db: AppDb,
  args: {
    return_ids: string[];
    coupon_code: string;
    email_subject: string;
    email_body: string;
    from_email?: string;
    userEmail: string;
  },
): Promise<ProcessBatchResult> {
  if (args.return_ids.length === 0) {
    return {
      coupon_code: args.coupon_code,
      email_count: 0,
      approved_count: 0,
      total_refund_usd: 0,
      skipped_return_ids: [],
    };
  }

  // Fetch eligible rows with customer info.
  const rowsRes = await db.execute(sql`
    SELECT
      r.id AS return_id,
      r.status,
      r.refund_amount_usd::text AS refund,
      (c.first_name || ' ' || c.last_name) AS customer_name,
      c.email AS customer_email,
      r.product_name
    FROM app.returns r
    LEFT JOIN app.customers c ON c.id = r.customer_id
    WHERE r.id = ANY(${args.return_ids})
  `);
  const rows = rowsRes.rows as Array<{
    return_id: string;
    status: string;
    refund: string;
    customer_name: string | null;
    customer_email: string | null;
    product_name: string | null;
  }>;

  const eligible = rows.filter(
    (r) => r.status === 'pending' && r.customer_email && r.customer_name,
  );
  const seen = new Set(rows.map((r) => r.return_id));
  const skipped = rows
    .filter((r) => r.status !== 'pending' || !r.customer_email)
    .map((r) => r.return_id)
    .concat(args.return_ids.filter((id) => !seen.has(id)));

  if (eligible.length === 0) {
    return {
      coupon_code: args.coupon_code,
      email_count: 0,
      approved_count: 0,
      total_refund_usd: 0,
      skipped_return_ids: skipped,
    };
  }

  const now = new Date().toISOString();
  const fromEmail = args.from_email ?? 'care@luxebeauty.example';

  // Build the VALUES list: (id, email_entry_json, audit_entries_json)
  // Each row gets one email and two audit entries appended.
  const valuesParts: ReturnType<typeof sql>[] = [];
  let totalRefundCents = 0;

  for (const row of eligible) {
    const { firstname, lastname } = splitName(row.customer_name!);
    const productName = row.product_name ?? 'your order';
    const subject = fillTemplate(args.email_subject, {
      firstname,
      lastname,
      product_name: productName,
      coupon_code: args.coupon_code,
    });
    const body = fillTemplate(args.email_body, {
      firstname,
      lastname,
      product_name: productName,
      coupon_code: args.coupon_code,
    });

    const emailEntry: EmailEntry = {
      at: now,
      direction: 'outgoing',
      from: fromEmail,
      to: row.customer_email!,
      subject,
      body,
    };
    const auditEntries: AuditEntry[] = [
      {
        at: now,
        by: args.userEmail,
        action: 'email_sent',
        tool: 'process_return_batch',
      },
      {
        at: now,
        by: args.userEmail,
        action: 'approved',
        notes: `Auto-approved with coupon ${args.coupon_code}`,
        tool: 'process_return_batch',
      },
    ];

    valuesParts.push(
      sql`(${row.return_id}, ${JSON.stringify([emailEntry])}::jsonb, ${JSON.stringify(auditEntries)}::jsonb)`,
    );

    const cents = Math.round(Number(row.refund) * 100);
    if (!Number.isNaN(cents)) totalRefundCents += cents;
  }

  // One UPDATE ... FROM (VALUES (...)) — hits every eligible row at once.
  await db.execute(sql`
    UPDATE app.returns AS r
    SET status = 'approved',
        decided_at = now(),
        updated_at = now(),
        emails = r.emails || v.email_entry,
        ai_audit_trail = r.ai_audit_trail || v.audit_entries
    FROM (VALUES ${sql.join(valuesParts, sql`, `)}) AS v(id, email_entry, audit_entries)
    WHERE r.id = v.id AND r.status = 'pending'
  `);

  return {
    coupon_code: args.coupon_code,
    email_count: eligible.length,
    approved_count: eligible.length,
    total_refund_usd: totalRefundCents / 100,
    skipped_return_ids: skipped,
  };
}

/**
 * Lot-scoped variant: fetch every pending return for `lot` and run the
 * same bulk update. Preferred over `processReturnBatch(return_ids)` for
 * the LLM tool, since asking the model to echo back hundreds of UUIDs
 * blows up the request (positional-param cap on some backends + big
 * payloads + easy miscount).
 */
export async function processReturnBatchForLot(
  db: AppDb,
  args: {
    lot: string;
    coupon_code: string;
    email_subject: string;
    email_body: string;
    from_email?: string;
    userEmail: string;
  },
): Promise<ProcessBatchResult> {
  const idsRes = await db.execute(sql`
    SELECT id FROM app.returns
    WHERE lot_id = ${args.lot} AND status = 'pending'
  `);
  const ids = (idsRes.rows as Array<{ id: string }>).map((r) => r.id);
  return processReturnBatch(db, {
    ...args,
    return_ids: ids,
  });
}
