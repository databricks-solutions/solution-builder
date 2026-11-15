import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { claims, signals, type ExposureRow, type SignalCohort } from './schema.js';

/**
 * One-shot Delta → Lakebase sync.
 *
 * Delta (manufacturing.warranty_copilot) holds the governed gold tables; the app
 * mirrors what it needs for a snappy UI + transactional writes:
 *   - the flagged early-warning signals (gold_early_warning WHERE is_signal) with
 *     their suspect cohort (gold_signal_cohorts) + exposure (gold_signal_exposure)
 *   - every warranty claim with its AI failure mode (gold_claims)
 * Idempotent: skips when app.signals has rows, unless `forceIfAnyEmpty`
 * (the "Reset demo" button). The root-cause analysis itself queries Delta live
 * (services/analyze.ts) through the same warehouse.
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
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.signals`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync (signals + claims)…');
  const t0 = Date.now();
  const [sigRows, cohortRows, expoRows, claimRows] = await Promise.all([
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fqn(cfg, 'gold_early_warning')} WHERE is_signal`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fqn(cfg, 'gold_signal_cohorts')} ORDER BY signal_id, cohort_value`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fqn(cfg, 'gold_signal_exposure')} ORDER BY signal_id, projected_cost DESC`),
    execSql<Record<string, unknown>>(
      warehouseId,
      `SELECT claim_id, serial, model_name, dealer_name, region, CAST(claim_date AS STRING) AS claim_date, days_in_service,
              customer_complaint, dealer_labor_code, failure_mode, failure_mode_label, fault_code, water_exposure,
              observed_damage, matches_dealer_code, part_number_replaced, total_cost, claim_status, technician_name,
              technician_notes, firmware_at_claim, controller_lot, brake_lot, attributable_supplier_id, chargeable
       FROM ${fqn(cfg, 'gold_claims')}`,
    ),
  ]);
  console.log(`[sync] fetched ${sigRows.length} signals, ${claimRows.length} claims in ${Date.now() - t0}ms`);

  const cohortOf = (id: string): SignalCohort | null => {
    const rows = cohortRows.filter((r) => r.signal_id === id);
    if (!rows.length) return null;
    // rates are claims per 1,000 bike-years in service (young lots are not penalised for little exposure)
    const all = rows.map((r) => ({
      value: String(r.cohort_value), units: num(r.units) ?? 0, units_sold: num(r.units_sold) ?? 0,
      claims: num(r.claims) ?? 0, rate: num(r.claims_per_1k_unit_years) ?? 0, suspect: bool(r.is_suspect),
      in_scope: bool(r.in_scope), unit_years: num(r.unit_years) ?? 0,
    }));
    const sus = all.filter((x) => x.suspect);
    const suspect = rows.filter((r) => bool(r.is_suspect)).map((r) => ({
      value: String(r.cohort_value), units: num(r.units) ?? 0, units_sold: num(r.units_sold) ?? 0,
      units_in_stock: num(r.units_in_stock) ?? 0, claims: num(r.claims) ?? 0, rate: num(r.claims_per_1k_unit_years) ?? 0,
    }));
    const rest = all.filter((x) => !x.suspect);
    const restUy = rest.reduce((a, x) => a + x.unit_years, 0);
    const restRate = restUy > 0 ? (1000 * rest.reduce((a, x) => a + x.claims, 0)) / restUy : 0;
    void sus;
    return { dimension: String(rows[0].dimension), suspect, rest_rate: Math.round(restRate * 10) / 10, all };
  };
  const exposureOf = (id: string): ExposureRow[] =>
    expoRows.filter((r) => r.signal_id === id).map((r) => ({
      region: String(r.region), wet_region: bool(r.wet_region), units: num(r.units) ?? 0,
      units_in_field: num(r.units_in_field) ?? 0, units_in_stock: num(r.units_in_stock) ?? 0,
      connected_in_field: num(r.connected_in_field) ?? 0, claims_to_date: num(r.claims_to_date) ?? 0,
      cost_to_date: num(r.cost_to_date) ?? 0, annual_hazard: num(r.annual_hazard) ?? 0,
      avg_remaining_years: num(r.avg_remaining_warranty_years) ?? 0, projected_claims: num(r.projected_claims) ?? 0,
      projected_cost: num(r.projected_cost) ?? 0, avg_claim_cost: num(r.avg_claim_cost) ?? 0,
    }));

  await chunkInsert(sigRows, 200, (chunk) =>
    db.insert(signals).values(chunk.map((r) => ({
      id: String(r.signal_id),
      failureMode: String(r.failure_mode),
      failureModeLabel: String(r.failure_mode_label),
      component: str(r.component),
      supplierId: String(r.supplier_id),
      supplierName: String(r.supplier_name),
      chargeable: bool(r.chargeable),
      exposedUnits: num(r.exposed_units),
      claims90d: num(r.claims_90d) ?? 0,
      claimsBase: num(r.claims_base) ?? 0,
      claimsTotal: num(r.claims_total) ?? 0,
      costToDate: num(r.cost_to_date),
      cost90d: num(r.cost_90d),
      avgClaimCost: num(r.avg_claim_cost),
      rate90d: num(r.rate_90d_per_1k_unit_years),
      baselineRate: num(r.baseline_rate_per_1k_unit_years),
      rateRatio: num(r.rate_ratio),
      firstRecentClaim: str(r.first_recent_claim),
      dealerCodeAgreement: num(r.dealer_code_agreement),
      cohort: cohortOf(String(r.signal_id)),
      exposure: exposureOf(String(r.signal_id)),
    }))).onConflictDoNothing(),
  );
  await chunkInsert(claimRows, 1000, (chunk) =>
    db.insert(claims).values(chunk.map((r) => ({
      id: String(r.claim_id),
      serial: String(r.serial),
      modelName: str(r.model_name),
      dealerName: str(r.dealer_name),
      region: str(r.region),
      claimDate: String(r.claim_date),
      daysInService: num(r.days_in_service),
      customerComplaint: str(r.customer_complaint),
      dealerLaborCode: str(r.dealer_labor_code),
      failureMode: str(r.failure_mode),
      failureModeLabel: str(r.failure_mode_label),
      faultCode: str(r.fault_code),
      waterExposure: r.water_exposure === null || r.water_exposure === undefined ? null : bool(r.water_exposure),
      observedDamage: str(r.observed_damage),
      matchesDealerCode: r.matches_dealer_code === null || r.matches_dealer_code === undefined ? null : bool(r.matches_dealer_code),
      partNumber: str(r.part_number_replaced),
      totalCost: num(r.total_cost),
      claimStatus: str(r.claim_status),
      technicianName: str(r.technician_name),
      technicianNotes: str(r.technician_notes),
      firmware: str(r.firmware_at_claim),
      controllerLot: str(r.controller_lot),
      brakeLot: str(r.brake_lot),
      supplierId: str(r.attributable_supplier_id),
      chargeable: bool(r.chargeable),
    }))).onConflictDoNothing(),
  );
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.quality_cases RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.claims RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.signals RESTART IDENTITY CASCADE`);
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
