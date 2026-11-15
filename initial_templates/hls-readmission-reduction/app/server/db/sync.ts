import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { worklist, type WorklistData } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the care-transitions worklist.
 *
 * Delta (healthcare_lifesciences.readmission_reduction) holds the history and the
 * scores: transition_worklist = open discharges (planned, or discharged in the last
 * 7 days) + readmission_risk_model@champion scores + the AI Functions read of the
 * discharge note. The coordinator needs one writable row per patient so plan status
 * and outreach tasks are transactional. Idempotent: skips when app.worklist has rows,
 * unless `forceIfAnyEmpty` (the "Reset demo" button).
 */

export type DataConfig = { catalog: string; schema: string };

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : v === true || v === 'true');
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('[')) {
    try {
      return (JSON.parse(v) as unknown[]).map(String);
    } catch {
      return [];
    }
  }
  return [];
};

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.worklist`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync of the care-transitions worklist…');
  const t0 = Date.now();
  const s = `${cfg.catalog}.${cfg.schema}`;
  const rows = await execSql<Record<string, unknown>>(
    warehouseId,
    `SELECT encounter_id, patient_id, patient_name, age, sex, primary_language, payer, dual_eligible, hospital_id, hospital_name,
            unit_id, unit_name, hrrp_condition, condition_label, principal_dx, principal_dx_code, CAST(admit_date AS STRING) AS admit_date,
            CAST(discharge_date AS STRING) AS discharge_date, discharge_dow, weekend_discharge, status, los_days, charlson_index, ed_visits_6m,
            prior_admits_12m, discharge_med_count, discharge_disposition, lives_alone, has_pcp, followup_7d_scheduled,
            CAST(followup_date AS STRING) AS followup_date, followup_clinic, attending, medicare_ffs_65, risk_score, risk_if_followup,
            risk_if_followup_hh, risk_tier, to_json(top_drivers) AS top_drivers, model_version, transportation_barrier, medication_affordability,
            caregiver_support, language_barrier, high_risk_med_change, to_json(med_changes) AS med_changes, note_followup_status, pending_labs,
            sdoh_summary, note_text
     FROM ${s}.transition_worklist`,
  );
  console.log(`[sync] fetched ${rows.length} open discharges in ${Date.now() - t0}ms`);
  await chunkInsert(rows, 200, (chunk) =>
    db.insert(worklist).values(chunk.map((r) => {
      const data: WorklistData = {
        age: num(r.age), sex: str(r.sex), primary_language: str(r.primary_language), payer: str(r.payer), dual_eligible: bool(r.dual_eligible),
        hospital_name: str(r.hospital_name), condition_label: str(r.condition_label), principal_dx: str(r.principal_dx),
        principal_dx_code: str(r.principal_dx_code), admit_date: str(r.admit_date), discharge_dow: str(r.discharge_dow),
        weekend_discharge: bool(r.weekend_discharge), los_days: num(r.los_days), charlson_index: num(r.charlson_index),
        ed_visits_6m: num(r.ed_visits_6m), prior_admits_12m: num(r.prior_admits_12m), discharge_med_count: num(r.discharge_med_count),
        discharge_disposition: str(r.discharge_disposition), lives_alone: bool(r.lives_alone), has_pcp: bool(r.has_pcp),
        followup_date: str(r.followup_date), followup_clinic: str(r.followup_clinic), attending: str(r.attending),
        medicare_ffs_65: bool(r.medicare_ffs_65), risk_if_followup: num(r.risk_if_followup), risk_if_followup_hh: num(r.risk_if_followup_hh),
        top_drivers: arr(r.top_drivers), model_version: str(r.model_version), transportation_barrier: bool(r.transportation_barrier),
        medication_affordability: bool(r.medication_affordability), caregiver_support: bool(r.caregiver_support),
        language_barrier: bool(r.language_barrier), high_risk_med_change: bool(r.high_risk_med_change), med_changes: arr(r.med_changes),
        note_followup_status: str(r.note_followup_status), pending_labs: str(r.pending_labs), sdoh_summary: str(r.sdoh_summary),
        note_text: str(r.note_text),
      };
      return {
        encounterId: String(r.encounter_id), patientId: String(r.patient_id), patientName: String(r.patient_name), unitId: String(r.unit_id),
        unitName: str(r.unit_name), hospitalId: String(r.hospital_id), hrrpCondition: String(r.hrrp_condition),
        dischargeDate: String(r.discharge_date), status: String(r.status), riskScore: Number(r.risk_score), riskTier: String(r.risk_tier),
        followupBooked: bool(r.followup_7d_scheduled) ?? false, data,
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
    await tx.execute(sql`TRUNCATE TABLE app.outreach_tasks RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.transition_plans RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.worklist RESTART IDENTITY CASCADE`);
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
