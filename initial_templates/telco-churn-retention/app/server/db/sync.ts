import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { retentionCases, offers, type LastCall } from './schema.js';

/**
 * One-shot Delta → Lakebase sync.
 *
 * Template concern: Databricks Apps sit next to the lakehouse. The natural
 * shape for a write-capable operations app is "Delta is source of truth,
 * Lakebase is the OLTP mirror". This file is that mirror.
 *
 * Pulls the at-risk accounts (churn_scores x customers x features x latest call insight)
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

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    /** ML output: churn_scores (probability, tier, SHAP driver shares). */
    scores: string;
    customers: string;
    features: string;
    /** AI Functions output over call transcripts. */
    callInsights: string;
    offerCatalog: string;
    offerHistory: string;
  };
};

/** Tiers the desk works. Low-risk accounts stay in the lakehouse only. */
const WORKED_TIERS = `('Critical','High','Medium')`;

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.retention_cases`);
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
    `\`${cfg.catalog}\`.\`${cfg.schema}\`.${cfg.tables[name]}`;

  type CaseRow = Record<string, string | null>;
  const [caseRows, offerRows, rateRows] = await Promise.all([
    execSql<CaseRow>(
      warehouseId,
      `WITH last_call AS (
         SELECT * FROM ${fq('callInsights')}
         QUALIFY row_number() OVER (PARTITION BY customer_id ORDER BY call_ts DESC) = 1)
       SELECT s.customer_id, c.customer_name, c.segment, c.plan, c.lines, c.region, c.market,
              c.cell_site_id, f.tenure_months, c.contract_type, s.monthly_bill,
              s.churn_probability_30d, s.risk_tier, s.top_driver,
              to_json(named_struct('network', s.driver_network_pct, 'bill_shock', s.driver_bill_shock_pct,
                 'competitor', s.driver_competitor_pct, 'care', s.driver_care_pct,
                 'port_out_intent', s.driver_port_out_intent_pct, 'account', s.driver_account_pct)) AS drivers,
              to_json(s.top_reasons) AS reasons,
              to_json(named_struct('dropped_call_rate_3m', round(f.dropped_call_rate_3m, 2),
                 'dropped_call_rate_delta', round(f.dropped_call_rate_delta, 2),
                 'download_mbps_3m', round(f.download_mbps_3m, 0),
                 'bill_change_3m_pct', f.bill_change_3m_pct, 'promo_expired_90d', f.promo_expired_90d,
                 'promo_expiring_60d', f.promo_expiring_60d,
                 'competitor_promo_in_market', f.competitor_promo_in_market,
                 'port_out_pin_30d', f.port_out_pin_30d, 'care_calls_90d', f.care_calls_90d,
                 'retention_calls_90d', f.retention_calls_90d, 'device_balance', f.device_balance)) AS signals,
              s.annual_revenue_at_risk,
              CASE WHEN l.call_id IS NULL THEN NULL ELSE to_json(named_struct(
                 'callId', l.call_id, 'callTs', cast(l.call_ts AS STRING), 'sentiment', l.sentiment,
                 'intent', l.primary_intent, 'cancelThreat', l.cancel_threat,
                 'competitor', l.extracted.competitor, 'requestedRemedy', l.extracted.requested_remedy,
                 'summary', l.summary, 'transcript', l.transcript)) END AS last_call
       FROM ${fq('scores')} s
       JOIN ${fq('customers')} c USING (customer_id)
       JOIN ${fq('features')} f USING (customer_id)
       LEFT JOIN last_call l USING (customer_id)
       WHERE s.risk_tier IN ${WORKED_TIERS}`,
    ),
    execSql<CaseRow>(
      warehouseId,
      `SELECT * FROM ${fq('offerCatalog')}`,
    ),
    execSql<CaseRow>(
      warehouseId,
      `SELECT offer_code, primary_driver, count(*) AS n, round(avg(CAST(saved AS INT)), 3) AS rate
       FROM ${fq('offerHistory')} GROUP BY ALL`,
    ),
  ]);

  const num = (v: string | null) => (v == null ? 0 : Number(v));
  await chunkInsert(caseRows, 500, (chunk) =>
    db.insert(retentionCases).values(
      chunk.map((r) => ({
        customerId: r.customer_id!,
        customerName: r.customer_name!,
        segment: r.segment!,
        plan: r.plan!,
        lines: num(r.lines),
        region: r.region!,
        market: r.market!,
        cellSiteId: r.cell_site_id!,
        tenureMonths: num(r.tenure_months),
        contractType: r.contract_type!,
        monthlyBill: num(r.monthly_bill),
        churnProbability: num(r.churn_probability_30d),
        riskTier: r.risk_tier!,
        topDriver: r.top_driver!,
        drivers: JSON.parse(r.drivers ?? '{}') as Record<string, number>,
        reasons: JSON.parse(r.reasons ?? '[]') as string[],
        signals: JSON.parse(r.signals ?? '{}') as Record<string, number>,
        annualRevenueAtRisk: num(r.annual_revenue_at_risk),
        lastCall: r.last_call ? (JSON.parse(r.last_call) as LastCall) : null,
        auditTrail: [
          {
            at: new Date().toISOString(),
            by: 'churn_risk_model@champion',
            action: 'scored' as const,
            notes: `30-day churn probability ${(num(r.churn_probability_30d) * 100).toFixed(1)}% · top driver ${r.top_driver}`,
          },
        ],
      })),
    ).onConflictDoNothing(),
  );
  console.log(`[sync]   retention_cases: ${caseRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  await db.insert(offers).values(
    offerRows.map((r) => ({
      offerCode: r.offer_code!,
      offerName: r.offer_name!,
      targetDriver: r.target_driver!,
      description: r.description!,
      costType: r.cost_type!,
      costValue: num(r.cost_value),
      durationMonths: num(r.duration_months),
      eligibility: r.eligibility!,
      guardrailPct: num(r.guardrail_pct_of_12m_margin),
      grossMarginPct: num(r.gross_margin_pct),
      saveRates: Object.fromEntries(
        rateRows.filter((x) => x.offer_code === r.offer_code)
          .map((x) => [x.primary_driver!, { n: num(x.n), rate: num(x.rate) }]),
      ),
    })),
  ).onConflictDoNothing();
  console.log(`[sync]   offers: ${offerRows.length}; done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.retention_cases`);
    await tx.execute(sql`TRUNCATE TABLE app.offers`);
  });
}

/** Run one statement on the warehouse (exported for the Delta write-back). */
export async function execWarehouseSql<T>(statement: string, parameters?: Array<{ name: string; value: string | null; type?: string }>): Promise<T[]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) throw new Error('DATABRICKS_WAREHOUSE_ID not set');
  return execSql<T>(warehouseId, statement, parameters);
}

async function execSql<T>(
  warehouseId: string,
  statement: string,
  parameters?: Array<{ name: string; value: string | null; type?: string }>,
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
      ...(parameters ? { parameters } : {}),
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
