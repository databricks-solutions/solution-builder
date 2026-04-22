import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { customers, orders, returns } from './schema.js';

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
    returns: string;
    orderItems: string;
    orders: string;
    customers: string;
    products: string;
    productionLots: string;
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

  console.log('[sync] Starting Delta → Lakebase sync…');
  const t0 = Date.now();

  const fq = (name: keyof DataConfig['tables']) =>
    `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;

  // 1) Customers — only retail rows that have a return.
  const customerRows = await execSql<{
    customer_id: string;
    email: string;
    first_name: string;
    last_name: string;
    region: string | null;
    loyalty_tier: string | null;
    registration_date: string | null;
  }>(
    warehouseId,
    `SELECT c.customer_id, c.email, c.first_name, c.last_name, c.region,
            c.loyalty_tier, c.registration_date
     FROM ${fq('customers')} c
     WHERE c.email IS NOT NULL AND c.first_name IS NOT NULL
       AND c.customer_id IN (
         SELECT DISTINCT o.customer_id
         FROM ${fq('orders')} o
         JOIN ${fq('orderItems')} oi ON oi.order_id = o.order_id
         JOIN ${fq('returns')} r ON r.order_item_id = oi.order_item_id
       )`,
  );
  if (customerRows.length) {
    await chunkInsert(customerRows, 2000, (chunk) =>
      db
        .insert(customers)
        .values(
          chunk.map((r) => ({
            id: r.customer_id,
            email: r.email,
            firstName: r.first_name,
            lastName: r.last_name,
            region: r.region,
            loyaltyTier: r.loyalty_tier,
            registrationDate: r.registration_date,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  console.log(`[sync]   customers: ${customerRows.length}`);

  // 2) Orders — any order referenced by a return.
  const orderRows = await execSql<{
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
       SELECT DISTINCT oi.order_id
       FROM ${fq('orderItems')} oi
       JOIN ${fq('returns')} r ON r.order_item_id = oi.order_item_id
     )`,
  );
  if (orderRows.length) {
    await chunkInsert(orderRows, 2000, (chunk) =>
      db
        .insert(orders)
        .values(
          chunk.map((r) => ({
            id: r.order_id,
            customerId: r.customer_id,
            orderDate: r.order_date,
            region: r.region,
            totalUsd: r.total_usd === null ? null : Number(r.total_usd),
            status: r.status,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  console.log(`[sync]   orders: ${orderRows.length}`);

  // 3) Returns — denormalized. We JOIN through order_items + orders to
  //    pull order_id + customer_id onto every return row so the UI never
  //    has to hop.
  const returnRows = await execSql<{
    return_id: string;
    order_id: string;
    customer_id: string;
    order_date: string | null;
    return_date: string | null;
    refund_amount_usd: number;
    return_reason: string | null;
    return_reason_text: string | null;
    product_id: string | null;
    product_name: string | null;
    category: string | null;
    lot_id: string | null;
    facility: string | null;
    region: string | null;
  }>(
    warehouseId,
    `SELECT r.return_id,
            oi.order_id,
            o.customer_id,
            r.order_date,
            r.return_date,
            r.refund_amount_usd,
            r.return_reason,
            r.return_reason_text,
            r.product_id,
            r.product_name,
            r.category,
            r.lot_id,
            r.facility,
            r.region
     FROM ${fq('returns')} r
     LEFT JOIN ${fq('orderItems')} oi ON oi.order_item_id = r.order_item_id
     LEFT JOIN ${fq('orders')} o ON o.order_id = oi.order_id`,
  );
  if (returnRows.length) {
    await chunkInsert(returnRows, 2000, (chunk) =>
      db
        .insert(returns)
        .values(
          chunk.map((r) => ({
            id: r.return_id,
            orderId: r.order_id,
            customerId: r.customer_id,
            orderDate: r.order_date,
            returnDate: r.return_date,
            refundAmountUsd: Number(r.refund_amount_usd),
            returnReason: r.return_reason,
            returnReasonText: r.return_reason_text,
            productId: r.product_id,
            productName: r.product_name,
            category: r.category,
            lotId: r.lot_id,
            facility: r.facility,
            region: r.region,
            status: 'pending' as const,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  console.log(`[sync]   returns: ${returnRows.length}`);

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

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
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
