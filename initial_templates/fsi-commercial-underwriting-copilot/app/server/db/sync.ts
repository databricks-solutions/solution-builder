import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { appetiteRules, documents, lossRunClaims, ratingFactors, sovLocations, submissions } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of today's underwriting queue.
 *
 * Delta (<catalog>.<schema>) holds the triaged queue (gold_submission_queue: application vs documents,
 * discrepancies, rules hit, ML scores, lane, priority), the AI-extracted SOV rows and loss-run claims, the
 * parsed documents, the rating plan and the appetite rules. The desk works on this OLTP copy. Idempotent:
 * skips when app.submissions has rows, unless `forceIfAnyEmpty` (the "Reset demo" button).
 */

export type DataConfig = { catalog: string; schema: string };

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('[')) {
    try { return (JSON.parse(v) as unknown[]).map(String); } catch { return []; }
  }
  return [];
};

export async function syncFromDelta(db: AppDb, cfg: DataConfig, opts: { forceIfAnyEmpty?: boolean } = {}): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.submissions`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync of the underwriting queue…');
  const t0 = Date.now();
  const s = `${cfg.catalog}.${cfg.schema}`;
  const [qRows, lRows, cRows, dRows, fRows, rRows] = await Promise.all([
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT q.*, CAST(q.received_ts AS STRING) received, CAST(q.effective_date AS STRING) eff, CAST(q.loss_run_valued AS STRING) lr_valued,
             to_json(q.discrepancies) discrepancies_json, to_json(q.rules_hit) rules_json
      FROM ${s}.gold_submission_queue q`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${s}.sov_locations`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT *, CAST(loss_date AS STRING) ld FROM ${s}.loss_run_claims`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT d.*, p.elements FROM ${s}.submission_documents d LEFT JOIN ${s}.submission_documents_parsed p USING (doc_id)`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${s}.rating_factors`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${s}.appetite_rules`),
  ]);
  console.log(`[sync] fetched ${qRows.length} submissions, ${lRows.length} SOV rows, ${cRows.length} loss-run claims in ${Date.now() - t0}ms`);

  await db.insert(submissions).values(qRows.map((r) => ({
    id: String(r.submission_id), insuredName: String(r.insured_name), businessDescription: str(r.business_description),
    brokerName: String(r.broker_name), brokerTier: str(r.broker_tier), brokerContact: str(r.broker_contact),
    segmentCode: String(r.segment_code ?? ''), segment: String(r.segment ?? ''), state: String(r.state ?? ''), hailBelt: bool(r.hail_belt),
    receivedTs: String(r.received).replace(' ', 'T').slice(0, 16), effectiveDate: str(r.eff), daysToEffective: num(r.days_to_effective),
    remarks: str(r.remarks), annualRevenue: num(r.annual_revenue), targetPremium: num(r.target_premium), expiringPremium: num(r.expiring_premium),
    priorCarrier: str(r.prior_carrier),
    app: {
      locations: num(r.app_locations), tiv: num(r.app_tiv), construction: str(r.app_construction), year_built: num(r.app_year_built),
      roof_year: num(r.app_roof_year), sprinklered: r.app_sprinklered == null ? null : bool(r.app_sprinklered),
      protection_class: num(r.app_protection_class), loss_count: num(r.app_loss_count), loss_amount: num(r.app_loss_amount),
    },
    sovTiv: num(r.sov_tiv) ?? 0, sovLocations: num(r.sov_locations) ?? 0, lossRunClaims: num(r.lr_claims) ?? 0,
    lossRunIncurred: num(r.lr_incurred) ?? 0, lossRunValued: str(r.lr_valued), lossRunYears: num(r.loss_run_years), lossRunCarrier: str(r.loss_run_carrier),
    discrepancies: arr(r.discrepancies_json), rulesHit: arr(r.rules_json),
    pAsSubmitted: num(r.p_as_submitted), pVerified: num(r.p_verified), bandAsSubmitted: str(r.band_as_submitted), bandVerified: str(r.band_verified),
    riskDrivers: str(r.risk_drivers), triageLane: String(r.triage_lane), priorityScore: num(r.priority_score) ?? 0, premiumPotential: num(r.premium_potential),
  }))).onConflictDoNothing();
  await chunkInsert(lRows, 500, (chunk) => db.insert(sovLocations).values(chunk.map((r) => ({
    id: `${r.submission_id}-${r.loc_no}`, submissionId: String(r.submission_id), locNo: num(r.loc_no) ?? 0, buildingName: String(r.building_name ?? ''),
    address: str(r.address), city: str(r.city), state: str(r.state), construction: str(r.construction), yearBuilt: num(r.year_built),
    roofYear: num(r.roof_year), roofAgeYears: num(r.roof_age_years), stories: num(r.stories), units: num(r.units), sprinklered: bool(r.sprinklered),
    protectionClass: num(r.protection_class), tiv: num(r.tiv) ?? 0, coastalTier1: bool(r.coastal_tier1),
  }))).onConflictDoNothing());
  await chunkInsert(cRows, 500, (chunk) => db.insert(lossRunClaims).values(chunk.map((r, i) => ({
    id: `${r.submission_id}-${r.claim_number ?? i}-${r.ld ?? ''}`, submissionId: String(r.submission_id), claimNumber: str(r.claim_number),
    lossDate: str(r.ld), line: str(r.line), locNo: num(r.loc_no), cause: str(r.cause), paid: num(r.paid) ?? 0, reserve: num(r.reserve) ?? 0,
    totalIncurred: num(r.total_incurred) ?? 0, status: str(r.status), windHail: bool(r.wind_hail),
  }))).onConflictDoNothing());
  await db.insert(documents).values(dRows.map((r) => ({
    id: String(r.doc_id), submissionId: String(r.submission_id), docType: String(r.doc_type), fileName: String(r.file_name),
    filePath: String(r.file_path), elements: num(r.elements),
  }))).onConflictDoNothing();
  await db.insert(ratingFactors).values(fRows.map((r) => ({
    id: String(r.factor_id), factorType: String(r.factor_type), factorKey: String(r.factor_key), value: num(r.value) ?? 0,
    description: str(r.description), docRef: str(r.doc_ref),
  }))).onConflictDoNothing();
  await db.insert(appetiteRules).values(rRows.map((r) => ({
    id: String(r.rule_id), docRef: String(r.doc_ref), title: String(r.title), action: String(r.action), threshold: num(r.threshold),
    description: str(r.description),
  }))).onConflictDoNothing();
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.loss_run_claims, app.sov_locations, app.documents, app.submissions, app.rating_factors, app.appetite_rules RESTART IDENTITY CASCADE`);
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
