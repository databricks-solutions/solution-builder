import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { campaigns, opportunities, type CampaignLine } from './schema.js';

/**
 * One-shot Delta → Lakebase sync.
 *
 * Delta (<catalog>.<schema>) holds the governed gold tables; the app mirrors what it needs
 * for a snappy UI + transactional writes:
 *   - live + booked campaigns with pacing / make-good risk (gold_campaign_pacing) and their
 *     lines (gold_line_pacing)
 *   - the programmatic yield opportunities (gold_yield_opportunities) + a 20-week eCPM trend
 * Idempotent: skips when app.campaigns has rows, unless `forceIfAnyEmpty` (the "Reset demo"
 * button). The recovery plan itself queries Delta live (services/plan.ts) through the same warehouse.
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

/**
 * Resource IDs the setup job resolved (Genie agent, dashboard) — read from
 * <schema>.app_config so a fresh `bundle deploy` + `bundle run` needs no env editing.
 */
export async function readAppConfigTable(cfg: DataConfig): Promise<Record<string, string>> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) return {};
  const rows = await execSql<{ key: string; value: string }>(warehouseId, `SELECT key, value FROM ${fqn(cfg, 'app_config')}`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.campaigns`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync (campaigns + yield opportunities)…');
  const t0 = Date.now();
  const [campRows, lineRows, oppRows, weeklyRows] = await Promise.all([
    execSql<Record<string, unknown>>(warehouseId, `SELECT *, CAST(flight_start AS STRING) AS fs, CAST(flight_end AS STRING) AS fe FROM ${fqn(cfg, 'gold_campaign_pacing')} WHERE status = 'Live'`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fqn(cfg, 'gold_line_pacing')} WHERE status = 'Live' ORDER BY line_id`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT *, CAST(current_rule_since AS STRING) AS since FROM ${fqn(cfg, 'gold_yield_opportunities')}`),
    execSql<Record<string, unknown>>(
      warehouseId,
      `SELECT product_id, CAST(week_start AS STRING) AS week,
              ROUND(1000 * SUM(programmatic_revenue) / NULLIF(SUM(programmatic_impressions), 0), 2) AS programmatic_ecpm,
              ROUND(1000 * SUM(open_auction_revenue) / NULLIF(SUM(open_auction_impressions), 0), 2) AS open_clearing,
              ROUND(SUM(pmp_impressions) / NULLIF(SUM(programmatic_impressions), 0), 3) AS pmp_share,
              MAX_BY(inventory_group, inventory_date) AS grp
       FROM ${fqn(cfg, 'gold_inventory_daily')}
       WHERE programmatic_impressions > 0 AND week_start >= date_sub(date_trunc('WEEK', current_date()), 7 * 20)
         AND week_start < date_trunc('WEEK', current_date())
       GROUP BY product_id, week_start ORDER BY product_id, week_start`,
    ),
  ]);
  console.log(`[sync] fetched ${campRows.length} live campaigns, ${lineRows.length} lines, ${oppRows.length} opportunities in ${Date.now() - t0}ms`);

  const linesOf = (id: string): CampaignLine[] =>
    lineRows.filter((r) => r.campaign_id === id).map((r) => ({
      line_id: String(r.line_id), product_id: String(r.product_id), product_name: String(r.product_name),
      platform: String(r.platform), tier: String(r.tier), booked: num(r.booked_impressions) ?? 0, cpm: num(r.cpm) ?? 0,
      delivered: num(r.delivered) ?? 0, expected: num(r.expected_to_date) ?? 0, pacing: num(r.pacing),
      run_rate: num(r.run_rate_daily) ?? 0, planned_daily: num(r.planned_daily) ?? 0, projected: num(r.projected_delivery) ?? 0,
      avails_change: num(r.avails_change_since_start),
    }));

  await chunkInsert(campRows, 200, (chunk) =>
    db.insert(campaigns).values(chunk.map((r) => ({
      id: String(r.campaign_id),
      ioNumber: String(r.io_number),
      name: String(r.campaign_name),
      advertiserName: String(r.advertiser_name),
      advertiserCategory: str(r.advertiser_category),
      agency: str(r.agency),
      dealType: str(r.deal_type),
      targetSegmentId: String(r.target_segment_id),
      targetSegment: String(r.target_segment),
      flightStart: String(r.fs),
      flightEnd: String(r.fe),
      deliveryStatus: String(r.status),
      salesOwner: str(r.sales_owner),
      makeGoodTerms: str(r.make_good_terms),
      bookedImpressions: num(r.booked_impressions) ?? 0,
      bookedRevenue: num(r.booked_revenue) ?? 0,
      bookedCpm: num(r.booked_cpm) ?? 0,
      flightDays: num(r.flight_days),
      daysRemaining: num(r.days_remaining),
      delivered: num(r.delivered),
      expectedToDate: num(r.expected_to_date),
      pacing: num(r.pacing),
      runRateDaily: num(r.run_rate_daily),
      projectedDelivery: num(r.projected_delivery),
      projectedDeliveryPct: num(r.projected_delivery_pct),
      projectedShortfall: num(r.projected_shortfall),
      makeGoodLiability: num(r.make_good_liability),
      atRisk: bool(r.at_risk),
      riskProductId: str(r.risk_product_id),
      riskProductName: str(r.risk_product_name),
      riskProductAvailsChange: num(r.risk_product_avails_change),
      lines: linesOf(String(r.campaign_id)),
    }))).onConflictDoNothing(),
  );
  await chunkInsert(oppRows, 100, (chunk) =>
    db.insert(opportunities).values(chunk.map((r) => ({
      productId: String(r.product_id),
      productName: String(r.product_name),
      platform: str(r.platform),
      contentCategory: str(r.content_category),
      tier: str(r.tier),
      rateCardCpm: num(r.rate_card_cpm),
      rateCardGroup: str(r.rate_card_inventory_group),
      rateCardGroupFloor: num(r.rate_card_group_floor),
      currentGroup: str(r.current_inventory_group),
      currentFloor: num(r.current_floor_cpm),
      currentRuleId: str(r.current_rule_id),
      currentRuleSince: str(r.since),
      currentRuleChangedBy: str(r.current_rule_changed_by),
      changeTicket: str(r.change_ticket),
      changeNote: str(r.change_note),
      sellThrough28d: num(r.sell_through_28d),
      guaranteedShare28d: num(r.guaranteed_share_28d),
      pmpShare28d: num(r.pmp_share_28d),
      openShare28d: num(r.open_auction_share_28d),
      ecpm28d: num(r.ecpm_28d),
      programmaticEcpm28d: num(r.programmatic_ecpm_28d),
      pmpEcpm28d: num(r.pmp_ecpm_28d),
      openClearing28d: num(r.open_clearing_cpm_28d),
      p50Bid28d: num(r.p50_open_bid_cpm_28d),
      p90Bid28d: num(r.p90_open_bid_cpm_28d),
      fillRetention: num(r.fill_retention),
      pmpImpressions28d: num(r.pmp_impressions_28d),
      programmaticEcpmBeforeRule: num(r.programmatic_ecpm_before_rule),
      groupMismatch: bool(r.group_mismatch),
      revenueGap28d: num(r.revenue_gap_28d),
      revenueGapAnnualized: num(r.revenue_gap_annualized),
      revenueGapSinceRule: num(r.revenue_gap_since_rule),
      recommendedGroup: str(r.recommended_inventory_group),
      recommendedFloor: num(r.recommended_floor_cpm),
      isLeak: bool(r.is_leak),
      weekly: weeklyRows.filter((w) => w.product_id === r.product_id).map((w) => ({
        week: String(w.week), programmatic_ecpm: num(w.programmatic_ecpm) ?? 0, open_clearing: num(w.open_clearing),
        pmp_share: num(w.pmp_share) ?? 0, group: String(w.grp),
      })),
    }))).onConflictDoNothing(),
  );
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.yield_plans RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.floor_changes RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.campaigns RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.opportunities RESTART IDENTITY CASCADE`);
  });
}

export async function execSql<T>(
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
