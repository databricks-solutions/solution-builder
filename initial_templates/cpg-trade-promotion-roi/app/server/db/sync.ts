import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { planEvents, planScenarios, promoEvents, type CurvePoint } from './schema.js';

/**
 * One-shot Delta → Lakebase sync.
 *
 * Delta (retail_consumer_goods.trade_promotion_roi) holds the governed gold tables; the app
 * mirrors what it needs for a snappy UI + transactional writes:
 *   - gold_event_roi + gold_event_weekly → app.promo_events (post-event analysis + weekly curve)
 *   - gold_plan_forecast                 → app.plan_events  (next quarter's draft calendar)
 *   - gold_plan_scenarios                → app.plan_scenarios (re-plan candidates)
 * Idempotent: skips when app.plan_events has rows, unless `forceIfAnyEmpty` (the
 * "Reset the demo" button), which re-seeds the untouched draft calendar.
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables?: Record<string, string>;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const fqn = (cfg: DataConfig, t: string) => `${cfg.catalog}.${cfg.schema}.${t}`;

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.plan_events`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId || !cfg.catalog || !cfg.schema) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID / DEMO_CATALOG / DEMO_SCHEMA not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync (promo events + plan + scenarios)…');
  const t0 = Date.now();
  const [evRows, curveRows, planRows, scenRows] = await Promise.all([
    execSql<Record<string, unknown>>(warehouseId, `SELECT *, CAST(start_week AS STRING) AS sw, CAST(end_week AS STRING) AS ew FROM ${fqn(cfg, 'gold_event_roi')}`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT event_id, rel_week, phase, CAST(week_start AS STRING) AS week_start, actual_units, baseline_units,
        sister_actual_units, sister_baseline_units, units_shipped, units_on_deal FROM ${fqn(cfg, 'gold_event_weekly')} ORDER BY event_id, rel_week`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT *, CAST(start_week AS STRING) AS sw, CAST(end_week AS STRING) AS ew FROM ${fqn(cfg, 'gold_plan_forecast')}`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fqn(cfg, 'gold_plan_scenarios')}`),
  ]);
  console.log(`[sync] fetched ${evRows.length} events, ${planRows.length} planned events, ${scenRows.length} scenarios in ${Date.now() - t0}ms`);

  const curves = new Map<string, CurvePoint[]>();
  for (const r of curveRows) {
    const id = String(r.event_id);
    if (!curves.has(id)) curves.set(id, []);
    curves.get(id)!.push({
      rel_week: num(r.rel_week) ?? 0,
      phase: String(r.phase) as CurvePoint['phase'],
      week_start: String(r.week_start),
      actual: num(r.actual_units) ?? 0,
      baseline: num(r.baseline_units) ?? 0,
      sister_actual: num(r.sister_actual_units) ?? 0,
      sister_baseline: num(r.sister_baseline_units) ?? 0,
      shipped: num(r.units_shipped) ?? 0,
      on_deal: num(r.units_on_deal) ?? 0,
    });
  }
  const volumeKept = new Map<string, number | null>();
  for (const s of scenRows) if (bool(s.is_as_planned)) volumeKept.set(String(s.plan_event_id), num(s.volume_units_total));

  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.plan_scenarios`);
    await tx.execute(sql`TRUNCATE TABLE app.plan_events`);
    await tx.execute(sql`TRUNCATE TABLE app.promo_events`);
    await chunkInsert(evRows, 200, (chunk) =>
      tx.insert(promoEvents).values(chunk.map((r) => ({
        id: String(r.event_id),
        eventName: String(r.event_name),
        retailerId: String(r.retailer_id),
        retailerName: String(r.retailer_name),
        channel: str(r.channel),
        sku: String(r.sku),
        productName: String(r.product_name),
        brand: str(r.brand),
        tactic: String(r.tactic),
        discountDepth: num(r.discount_depth),
        featureAd: bool(r.feature_ad),
        inStoreDisplay: bool(r.in_store_display),
        fundingMethod: str(r.funding_method),
        startWeek: String(r.sw),
        endWeek: str(r.ew),
        weeks: num(r.weeks),
        quarter: str(r.quarter),
        last52: bool(r.is_last_52_weeks),
        baselineUnits: num(r.baseline_units),
        actualUnits: num(r.actual_units),
        grossIncrementalUnits: num(r.gross_incremental_units),
        volumeLiftPct: num(r.volume_lift_pct),
        dipUnits: num(r.post_event_dip_units),
        cannibalizedUnits: num(r.cannibalized_units),
        forwardBuyUnits: num(r.forward_buy_units),
        netIncrementalUnits: num(r.net_incremental_units),
        allowancePerUnit: num(r.allowance_per_unit_usd),
        tradeSpend: num(r.trade_spend_usd),
        fixedFees: num(r.fixed_fees_usd),
        subsidisedBaseline: num(r.subsidised_baseline_usd),
        forwardBuyCost: num(r.forward_buy_cost_usd),
        incrementalGp: num(r.incremental_gross_profit_usd),
        netProfit: num(r.net_profit_usd),
        roi: num(r.roi),
        verdict: str(r.verdict),
        curve: curves.get(String(r.event_id)) ?? [],
      }))),
    );
    await chunkInsert(planRows, 200, (chunk) =>
      tx.insert(planEvents).values(chunk.map((r) => ({
        id: String(r.plan_event_id),
        retailerId: String(r.retailer_id),
        retailerName: String(r.retailer_name),
        sku: String(r.sku),
        productName: String(r.product_name),
        brand: str(r.brand),
        startWeek: String(r.sw),
        endWeek: str(r.ew),
        planWeek: num(r.plan_week) ?? 0,
        weeks: num(r.weeks) ?? 1,
        plannerNote: str(r.planner_note),
        scenarioKey: 'as_planned',
        tactic: String(r.tactic),
        discountDepth: num(r.discount_depth),
        fundingMethod: str(r.funding_method),
        featureAd: bool(r.feature_ad),
        inStoreDisplay: bool(r.in_store_display),
        promoPrice: num(r.promo_price_usd),
        regularShelfPrice: num(r.regular_shelf_price_usd),
        baselineUnits: num(r.baseline_units),
        forecastUnits: num(r.forecast_units),
        netIncrementalUnits: num(r.net_incremental_units),
        volumeKept: volumeKept.get(String(r.plan_event_id)) ?? null,
        tradeSpend: num(r.trade_spend_usd),
        incrementalGp: num(r.incremental_gross_profit_usd),
        netProfit: num(r.net_profit_usd),
        roi: num(r.roi),
        forecastFlag: String(r.forecast_flag),
        originalTactic: String(r.tactic),
        originalNetProfit: num(r.net_profit_usd),
        originalRoi: num(r.roi),
        originalFlag: String(r.forecast_flag),
        recommendedScenarioKey: str(r.recommended_scenario_key),
        status: 'draft' as const,
      }))),
    );
    await chunkInsert(scenRows, 200, (chunk) =>
      tx.insert(planScenarios).values(chunk.map((r) => ({
        planEventId: String(r.plan_event_id),
        scenarioKey: String(r.scenario_key),
        label: String(r.scenario_label),
        tactic: String(r.tactic),
        isAsPlanned: bool(r.is_as_planned),
        discountDepth: num(r.discount_depth),
        fundingMethod: str(r.funding_method),
        featureAd: bool(r.feature_ad),
        inStoreDisplay: bool(r.in_store_display),
        promoPrice: num(r.promo_price_usd),
        baselineUnits: num(r.baseline_units),
        forecastUnits: num(r.forecast_units),
        grossIncrementalUnits: num(r.gross_incremental_units),
        dipUnits: num(r.post_event_dip_units),
        cannibalizedUnits: num(r.cannibalized_units),
        forwardBuyUnits: num(r.forward_buy_units),
        netIncrementalUnits: num(r.net_incremental_units),
        volumeKept: num(r.volume_units_total),
        tradeSpend: num(r.trade_spend_usd),
        incrementalGp: num(r.incremental_gross_profit_usd),
        netProfit: num(r.net_profit_usd),
        roi: num(r.roi),
        policyCompliant: bool(r.policy_compliant),
        policyNotes: str(r.policy_notes),
        recommended: bool(r.recommended),
        analogEvents: num(r.analog_events),
      }))),
    );
  });
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.plan_decisions`);
  });
}

export async function execSql<T>(warehouseId: string, statement: string): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: { schema: { columns: Array<{ name: string }> } };
    result?: { chunk_index: number; row_count: number; data_array?: Array<Array<unknown>>; next_chunk_index?: number };
  };
  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: { statement, warehouse_id: warehouseId, wait_timeout: '50s', on_wait_timeout: 'CONTINUE', disposition: 'INLINE', format: 'JSON_ARRAY' },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  // Cap polling at 10 minutes: a warehouse can take a couple of minutes to wake, but a
  // statement stuck in RUNNING beyond that is broken — fail loud instead of blocking boot.
  const deadline = Date.now() + 10 * 60 * 1000;
  let cur = initial;
  while (!['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED'].includes(cur.status.state)) {
    if (Date.now() > deadline) throw new Error(`[sync] SQL still ${cur.status.state} after 10 minutes (statement_id=${cur.statement_id})`);
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET', path: `/api/2.0/sql/statements/${cur.statement_id}`, headers: new Headers(), raw: false, query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') throw new Error(`[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`);

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
      method: 'GET', path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(), raw: false, query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}
