import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { customers, customerPremium, orders, returns } from './schema.js';

/**
 * One-shot Delta → Lakebase sync.
 *
 * Template concern: Databricks Apps sit next to the lakehouse. The natural
 * shape for a write-capable operations app is "Delta is source of truth,
 * Lakebase is the OLTP mirror". This file is that mirror.
 *
 * Pulls the subset of rows relevant to returns (customers/orders/items/lots
 * referenced by a return) via the Databricks SQL Statements API. Idempotent
 * in the "only-if-destination-empty" sense — if `app.customers` has rows,
 * we skip. Pass `{ forceIfAnyEmpty: true }` to re-sync on demand (used by
 * the "Reset demo" button).
 *
 * For reset: the caller TRUNCATEs the mirror tables first, then calls this.
 *
 * Repurposing: rewrite the SELECTs to pull your own domain, keep the
 * Databricks SQL API helper (`execSql`) + chunked INSERT helpers.
 */

type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    /** silver_returns — already carries customer_id + product + lot per
     *  spec 01-lakeflow.md, so no joins are needed in sync. */
    returns: string;
    /** bronze_orders — provides order-level customer_id + totalUsd. */
    orders: string;
    /** bronze_customers — primary customer dimension with geo + premium tag. */
    customers: string;
    /** Predictions written by the ML notebook (spec 03-ml-premium.md).
     *  Optional: omit for demos without an ML model — sync just skips. */
    customerPremium?: string;
  };
};

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.customers`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }

  console.log('[sync] Starting Delta → Lakebase sync (parallel)…');
  const t0 = Date.now();

  const fq = (name: keyof DataConfig['tables']) =>
    `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;

  // Fire all 4 warehouse queries in parallel (the slow part), then insert
  // sequentially respecting FK order: customers → orders → returns. The
  // premium-predictions table has no FK constraint into customers (so it
  // can be synced independently of which customers actually appear in
  // returns) but we still wait on its query before inserting.
  const hasPremiumTable = Boolean(cfg.tables.customerPremium);
  const [customerRows, orderRows, returnRows, premiumRows] = await Promise.all([
    execSql<{
      customer_id: string;
      email: string;
      first_name: string;
      last_name: string;
      region: string | null;
      country: string | null;
      city: string | null;
      customer_lat: number | null;
      customer_lng: number | null;
      loyalty_tier: string | null;
      premium_status: string | null;
      registration_date: string | null;
    }>(
      warehouseId,
      // silver_returns carries customer_id per spec 01-lakeflow.md, so we
      // can scope customers directly to "anyone who appears in returns".
      `SELECT c.customer_id, c.email, c.first_name, c.last_name, c.region,
              c.country, c.city, c.customer_lat, c.customer_lng,
              c.loyalty_tier, c.premium_status, c.registration_date
       FROM ${fq('customers')} c
       WHERE c.email IS NOT NULL AND c.first_name IS NOT NULL
         AND c.customer_id IN (
           SELECT DISTINCT r.customer_id FROM ${fq('returns')} r
         )`,
    ),
    execSql<{
      order_id: string;
      customer_id: string | null;
      order_date: string | null;
      region: string | null;
      total_usd: number | null;
      status: string | null;
    }>(
      warehouseId,
      `SELECT o.order_id, o.customer_id, o.order_date, o.region, o.total_usd, o.status
       FROM ${fq('orders')} o
       WHERE o.order_id IN (
         SELECT DISTINCT r.order_id FROM ${fq('returns')} r
       )`,
    ),
    execSql<{
      return_id: string;
      order_id: string;
      customer_id: string;
      order_date: string | null;
      return_date: string | null;
      refund_amount_usd: number;
      return_reason: string | null;
      return_reason_text: string | null;
      anger_score: number | null;
      product_id: string | null;
      product_name: string | null;
      category: string | null;
      lot_id: string | null;
      facility: string | null;
      region: string | null;
    }>(
      warehouseId,
      // silver_returns is already denormalized per spec 01-lakeflow.md
      // (customer_id, product, lot, facility, region all on the row +
      // anger_score from ai_classify). No joins needed.
      `SELECT r.return_id,
              r.order_id,
              r.customer_id,
              r.order_date,
              r.return_date,
              r.refund_amount_usd,
              r.return_reason,
              r.return_reason_text,
              r.anger_score,
              r.product_id,
              r.product_name,
              r.category,
              r.lot_id,
              r.facility,
              r.region
       FROM ${fq('returns')} r`,
    ),
    // Predictions for the same customer set that owns the returns. If
    // the demo has no ML model, `customerPremium` is unset in config →
    // skip the query (resolve to []) and the insert below becomes a no-op.
    hasPremiumTable
      ? execSql<{
          customer_id: string;
          premium_prob: number;
          final_tier: string;
          premium_status_labeled: string | null;
          predicted_at: string | null;
        }>(
          warehouseId,
          `SELECT customer_id, premium_prob, final_tier,
                  premium_status_labeled, predicted_at
           FROM ${cfg.catalog}.${cfg.schema}.${cfg.tables.customerPremium}
           WHERE customer_id IN (
             SELECT DISTINCT r.customer_id FROM ${fq('returns')} r
           )`,
        )
      : Promise.resolve([] as Array<{
          customer_id: string;
          premium_prob: number;
          final_tier: string;
          premium_status_labeled: string | null;
          predicted_at: string | null;
        }>),
  ]);
  console.log(`[sync]   queries done (${((Date.now() - t0) / 1000).toFixed(1)}s) — inserting…`);

  // Insert in FK order: customers → orders → returns.
  // Chunk sizes target ~(rows × columns) < 65_535 (Postgres's int16 bind-param limit),
  // kept well below the ceiling for safety.
  if (customerRows.length) {
    await chunkInsert(customerRows, 5_000, (chunk) =>
      db.insert(customers).values(
        chunk.map((r) => ({
          id: r.customer_id,
          email: r.email,
          firstName: r.first_name,
          lastName: r.last_name,
          region: r.region,
          country: r.country,
          city: r.city,
          customerLat: r.customer_lat === null ? null : Number(r.customer_lat),
          customerLng: r.customer_lng === null ? null : Number(r.customer_lng),
          loyaltyTier: r.loyalty_tier,
          premiumStatus:
            r.premium_status === 'premium' || r.premium_status === 'not_premium'
              ? r.premium_status
              : null,
          registrationDate: r.registration_date,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   customers: ${customerRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (orderRows.length) {
    await chunkInsert(orderRows, 5_000, (chunk) =>
      db.insert(orders).values(
        chunk.map((r) => ({
          id: r.order_id,
          customerId: r.customer_id,
          orderDate: r.order_date,
          region: r.region,
          totalUsd: r.total_usd === null ? null : Number(r.total_usd),
          status: r.status,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   orders: ${orderRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (returnRows.length) {
    await chunkInsert(returnRows, 2_500, (chunk) =>
      db.insert(returns).values(
        chunk.map((r) => ({
          id: r.return_id,
          orderId: r.order_id,
          customerId: r.customer_id,
          orderDate: r.order_date,
          returnDate: r.return_date,
          refundAmountUsd: Number(r.refund_amount_usd),
          returnReason: r.return_reason,
          returnReasonText: r.return_reason_text,
          angerScore: r.anger_score === null ? null : Number(r.anger_score),
          productId: r.product_id,
          productName: r.product_name,
          category: r.category,
          lotId: r.lot_id,
          facility: r.facility,
          region: r.region,
          status: 'pending' as const,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   returns: ${returnRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // Premium predictions — small table (one row per customer), no FK
  // dependency on the others, but insert last so failures here don't
  // strand the main mirror in a half-loaded state.
  if (premiumRows.length) {
    await chunkInsert(premiumRows, 5_000, (chunk) =>
      db.insert(customerPremium).values(
        chunk.map((r) => ({
          customerId: r.customer_id,
          premiumProb: Number(r.premium_prob),
          finalTier: (r.final_tier === 'premium' ? 'premium' : 'standard') as
            | 'premium'
            | 'standard',
          premiumStatusLabeled:
            r.premium_status_labeled === 'premium' ||
            r.premium_status_labeled === 'not_premium'
              ? r.premium_status_labeled
              : null,
          predictedAt: r.predicted_at ? new Date(r.predicted_at) : null,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   premium predictions: ${premiumRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[sync] Done in ${dt}s`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.returns RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.orders RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.customers RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.customer_premium RESTART IDENTITY CASCADE`);
  });
}

async function execSql<T>(
  warehouseId: string,
  statement: string,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  // Cap total polling at 10 minutes. The warehouse can take a couple of
  // minutes to spin from idle + scan, but a state stuck in RUNNING beyond
  // 10 min is broken — fail loud instead of silently blocking boot forever.
  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}
