import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { siteOps, type SiteMetrics } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the CASCADE-CKD site network.
 *
 * Delta (healthcare_lifesciences.trial_site_selection) holds the history: every
 * site's performance (gold_site_performance), features (gold_site_features) and the
 * ML scores (site_scores, site_enrollment_model@champion). The workbench needs one
 * writable row per site so the study manager's actions (activate a rescue site,
 * put a zero-enroller under closure review) are transactional. Idempotent: skips
 * when app.site_ops has rows, unless `forceIfAnyEmpty` (the "Reset demo" button).
 */

export type DataConfig = { catalog: string; schema: string; trialId: string };

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : v === true || v === 'true');
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.site_ops`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync of the site network…');
  const t0 = Date.now();
  const s = `${cfg.catalog}.${cfg.schema}`;
  const rows = await execSql<Record<string, unknown>>(
    warehouseId,
    `SELECT f.site_id, f.site_name, f.city, f.state, f.region, f.site_type, f.irb_type, f.latitude, f.longitude,
            f.cascade_status, f.principal_investigator, f.eligible_current_protocol, f.eligible_amended_e4,
            f.amendment_pool_multiplier, f.prior_halcyra_trials,
            CAST(p.activation_date AS STRING) AS activation_date, p.months_active, p.screened, p.randomized,
            p.randomized_per_month, p.screen_fail_rate, p.cycle_time_days, p.days_in_startup, p.is_zero_enroller,
            p.competing_trial, p.rand_per_month_before_competitor, p.rand_per_month_since_competitor,
            sc.hist_rate_per_month, sc.has_dkd_competitor, sc.predicted_rate_current, sc.predicted_rate_amended,
            sc.est_activation_months, sc.expected_randomized_12m, sc.rescue_eligible, sc.rescue_rank, sc.score_rationale
     FROM ${s}.gold_site_features f
     LEFT JOIN ${s}.gold_site_performance p ON p.site_id = f.site_id AND p.trial_id = '${cfg.trialId}'
     LEFT JOIN ${s}.site_scores sc ON sc.site_id = f.site_id
     WHERE f.cascade_status <> 'candidate' OR f.therapeutic_focus IN ('Nephrology', 'Endocrinology', 'Multi-specialty')
        OR sc.rescue_eligible  -- every site the rescue analysis can propose must be mirrored, or its approval write-back is dropped`,
  );
  console.log(`[sync] fetched ${rows.length} sites in ${Date.now() - t0}ms`);
  await chunkInsert(rows, 500, (chunk) =>
    db.insert(siteOps).values(chunk.map((r) => {
      const metrics: SiteMetrics = {
        principal_investigator: str(r.principal_investigator), activation_date: str(r.activation_date),
        months_active: num(r.months_active), screened: num(r.screened), randomized: num(r.randomized),
        randomized_per_month: num(r.randomized_per_month), screen_fail_rate: num(r.screen_fail_rate),
        cycle_time_days: num(r.cycle_time_days), days_in_startup: num(r.days_in_startup),
        is_zero_enroller: bool(r.is_zero_enroller), competing_trial: str(r.competing_trial),
        rand_per_month_before_competitor: num(r.rand_per_month_before_competitor),
        rand_per_month_since_competitor: num(r.rand_per_month_since_competitor),
        eligible_current_protocol: num(r.eligible_current_protocol), eligible_amended_e4: num(r.eligible_amended_e4),
        amendment_pool_multiplier: num(r.amendment_pool_multiplier), hist_rate_per_month: num(r.hist_rate_per_month),
        has_dkd_competitor: bool(r.has_dkd_competitor), prior_halcyra_trials: num(r.prior_halcyra_trials),
        predicted_rate_current: num(r.predicted_rate_current), predicted_rate_amended: num(r.predicted_rate_amended),
        est_activation_months: num(r.est_activation_months), expected_randomized_12m: num(r.expected_randomized_12m),
        rescue_eligible: bool(r.rescue_eligible), rescue_rank: num(r.rescue_rank), score_rationale: str(r.score_rationale),
      };
      return {
        siteId: String(r.site_id), trialId: cfg.trialId, siteName: String(r.site_name), city: str(r.city), state: str(r.state),
        region: str(r.region), siteType: str(r.site_type), irbType: str(r.irb_type), latitude: num(r.latitude),
        longitude: num(r.longitude), cascadeStatus: String(r.cascade_status), metrics,
      };
    })).onConflictDoNothing(),
  );
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.rescue_plans RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.site_ops RESTART IDENTITY CASCADE`);
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
