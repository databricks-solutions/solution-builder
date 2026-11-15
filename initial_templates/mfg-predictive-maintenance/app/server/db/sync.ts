import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import {
  assets,
  assetTrend,
  failures,
  maintenanceHistory,
  maintenanceWindows,
  spareParts,
} from './schema.js';

/**
 * One-shot Delta → Lakebase sync (TechRobotics predictive maintenance).
 *
 * Delta (Unity Catalog) is the source of truth for telemetry, ML scores and CMMS history;
 * Lakebase is the OLTP mirror the control room reads + writes (work orders, part
 * reservations, window bookings). Runs at boot when app.assets is empty, and on "Reset demo".
 */
export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    /** Delta view: registry + ML risk + last PM + 24h sensors (gold). */
    assetHealth: string;
    /** Daily condition features (ML feature table). */
    features: string;
    workOrders: string;
    failures: string;
    spareParts: string;
    windows: string;
  };
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const ts = (v: unknown): Date | null => (v ? new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z')) : null);

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.assets`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync (parallel)…');
  const t0 = Date.now();
  const fq = (name: keyof DataConfig['tables']) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
  type Row = Record<string, unknown>;

  const [assetRows, trendRows, woRows, failRows, partRows, windowRows] = await Promise.all([
    execSql<Row>(warehouseId, `SELECT * FROM ${fq('assetHealth')}`),
    execSql<Row>(
      warehouseId,
      `SELECT asset_id, CAST(feature_date AS DATE) AS day, vib_mean, vib_baseline, temp_mean, temp_baseline, pressure_mean
       FROM ${fq('features')}
       WHERE feature_date >= (SELECT max(feature_date) FROM ${fq('features')}) - INTERVAL 60 DAYS`,
    ),
    execSql<Row>(
      warehouseId,
      `SELECT work_order_id, asset_id, work_type, scheduled_ts, vendor, technician, description,
              lubricant_used, parts_used, cost_usd, notes, failure_id
       FROM ${fq('workOrders')}`,
    ),
    execSql<Row>(warehouseId, `SELECT * FROM ${fq('failures')}`),
    execSql<Row>(warehouseId, `SELECT * FROM ${fq('spareParts')}`),
    execSql<Row>(warehouseId, `SELECT * FROM ${fq('windows')} WHERE start_ts >= current_timestamp()`),
  ]);
  console.log(`[sync]   queries done (${((Date.now() - t0) / 1000).toFixed(1)}s) — inserting…`);

  await chunkInsert(assetRows, 1000, (c) =>
    db.insert(assets).values(c.map((r) => ({
      id: String(r.asset_id),
      name: String(r.asset_name),
      assetType: String(r.asset_type),
      manufacturer: (r.manufacturer as string) ?? null,
      model: (r.model as string) ?? null,
      line: String(r.line),
      cell: (r.cell as string) ?? null,
      criticality: (r.criticality as string) ?? null,
      isBottleneck: r.is_bottleneck === true || r.is_bottleneck === 'true',
      downtimeCostPerHour: Number(r.downtime_cost_per_hour),
      riskScore: Number(r.risk_score ?? 0),
      riskTier: (r.risk_tier as string) ?? 'Healthy',
      failureProb7d: num(r.failure_prob_7d),
      predictedFailureMode: (r.predicted_failure_mode as string) ?? null,
      estDaysToFailure: num(r.est_days_to_failure),
      downtimeCostAtRiskUsd: num(r.downtime_cost_at_risk_usd),
      unplannedFailureCostUsd: num(r.unplanned_failure_cost_usd),
      topDriver1: (r.top_driver_1 as string) ?? null,
      topDriver2: (r.top_driver_2 as string) ?? null,
      topDriver3: (r.top_driver_3 as string) ?? null,
      vibRatio: num(r.vib_ratio),
      tempDeltaC: num(r.temp_delta_c),
      pressureRatio: num(r.pressure_ratio),
      lastPmAt: ts(r.last_pm_ts),
      lastPmVendor: (r.last_pm_vendor as string) ?? null,
      lastPmLubricant: (r.last_pm_lubricant as string) ?? null,
      lastPmWorkOrder: (r.last_pm_work_order as string) ?? null,
      vibration24h: num(r.vibration_24h_mm_s),
      temperature24h: num(r.temperature_24h_c),
      pressure24h: num(r.pressure_24h_bar),
      current24h: num(r.current_24h_a),
    }))).onConflictDoNothing(),
  );
  await chunkInsert(trendRows, 2000, (c) =>
    db.insert(assetTrend).values(c.map((r) => ({
      assetId: String(r.asset_id),
      day: String(r.day).slice(0, 10),
      vibration: num(r.vib_mean),
      vibrationBaseline: num(r.vib_baseline),
      temperature: num(r.temp_mean),
      temperatureBaseline: num(r.temp_baseline),
      pressure: num(r.pressure_mean),
    }))).onConflictDoNothing(),
  );
  await chunkInsert(woRows, 1000, (c) =>
    db.insert(maintenanceHistory).values(c.map((r) => ({
      id: String(r.work_order_id),
      assetId: String(r.asset_id),
      workType: String(r.work_type),
      scheduledAt: ts(r.scheduled_ts),
      vendor: (r.vendor as string) ?? null,
      technician: (r.technician as string) ?? null,
      description: (r.description as string) ?? null,
      lubricantUsed: (r.lubricant_used as string) ?? null,
      partsUsed: (r.parts_used as string) ?? null,
      costUsd: num(r.cost_usd),
      notes: (r.notes as string) ?? null,
      failureId: (r.failure_id as string) ?? null,
    }))).onConflictDoNothing(),
  );
  await chunkInsert(failRows, 500, (c) =>
    db.insert(failures).values(c.map((r) => ({
      id: String(r.failure_id),
      assetId: String(r.asset_id),
      failureAt: ts(r.failure_ts),
      failureMode: (r.failure_mode as string) ?? null,
      component: (r.component as string) ?? null,
      downtimeHours: num(r.downtime_hours),
      totalCostUsd: num(r.total_cost_usd),
      rootCause: (r.root_cause as string) ?? null,
    }))).onConflictDoNothing(),
  );
  await chunkInsert(partRows, 500, (c) =>
    db.insert(spareParts).values(c.map((r) => ({
      partNumber: String(r.part_number),
      description: String(r.description),
      compatibleModels: (r.compatible_models as string) ?? null,
      plantOnHand: Number(r.plant_on_hand_qty),
      regionalDcQty: Number(r.regional_dc_qty),
      unitCostUsd: Number(r.unit_cost_usd),
      leadTimeDays: num(r.supplier_lead_time_days),
      partClass: (r.part_class as string) ?? null,
    }))).onConflictDoNothing(),
  );
  await chunkInsert(windowRows, 500, (c) =>
    db.insert(maintenanceWindows).values(c.map((r) => ({
      id: String(r.window_id),
      line: String(r.line),
      startAt: ts(r.start_ts) as Date,
      endAt: ts(r.end_ts) as Date,
      capacityHours: Number(r.capacity_hours),
    }))).onConflictDoNothing(),
  );
  console.log(
    `[sync] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — assets=${assetRows.length} trend=${trendRows.length} history=${woRows.length} failures=${failRows.length} parts=${partRows.length} windows=${windowRows.length}`,
  );
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.work_orders, app.assets, app.asset_trend, app.maintenance_history,
                         app.failures, app.spare_parts, app.maintenance_windows RESTART IDENTITY CASCADE`);
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
