import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { appMeta, caseCriteria, caseNotes, paCases } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the OPEN prior-auth queue.
 *
 * Delta is the source of truth (pa_requests + members/providers/policies +
 * the ai_query pre-review tables + clinical_notes). The workbench needs fast
 * row-level reads/writes, so the open queue is mirrored into Lakebase at boot
 * (skipped if `app.pa_cases` already has rows) and re-synced by "Reset demo".
 * Runs as the app service principal (needs SELECT on the schema).
 */
export type DataConfig = {
  catalog: string;
  schema: string;
  tables?: Record<string, string>;
};

type CaseRow = Record<string, string | null>;

const num = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: string | null | undefined) => v === 'true' || v === '1';
const ts = (v: string | null | undefined) => (v ? new Date(v) : null);

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.pa_cases`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId || !cfg.catalog || !cfg.schema) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID / catalog / schema not set — skipping Delta sync');
    return;
  }
  const fq = (t: string) => `${cfg.catalog}.${cfg.schema}.${t}`;
  console.log(`[sync] Delta → Lakebase: open PA queue from ${cfg.catalog}.${cfg.schema}…`);
  const t0 = Date.now();

  const [cases, crit, notes, snap] = await Promise.all([
    execSql<CaseRow>(
      warehouseId,
      `SELECT r.request_id, r.member_id, concat(m.first_name, ' ', m.last_name) AS member_name, m.age, m.sex,
              r.line_of_business, m.plan_name, r.provider_id, p.provider_name, p.npi, p.practice_group, p.specialty,
              r.policy_id, pol.policy_title, r.service_code, r.service_description, r.service_category,
              r.icd10_code, r.diagnosis_description, r.urgency, r.channel, r.received_ts, r.due_ts, r.sla_hours,
              r.status, r.est_cost_usd, r.requested_units, r.place_of_service, pol.auto_approval_eligible,
              a.ai_recommendation, a.ai_confidence, a.ai_rationale, a.missing_information, a.ai_lane,
               a.n_met, a.n_criteria, a.review_model, a.reviewed_at
       FROM ${fq('pa_requests')} r
       JOIN ${fq('members')} m ON m.member_id = r.member_id
       JOIN ${fq('providers')} p ON p.provider_id = r.provider_id
       JOIN ${fq('medical_policies')} pol ON pol.policy_id = r.policy_id
       LEFT JOIN ${fq('ai_case_review')} a ON a.request_id = r.request_id
       WHERE r.final_outcome = 'Open'`,
    ),
    execSql<CaseRow>(
      warehouseId,
      `SELECT r.request_id, pc.criterion_id, pc.criterion_number, pc.criterion_label, pc.criterion_text,
              e.status, e.evidence_quote, e.source_note_id
       FROM ${fq('pa_requests')} r
       JOIN ${fq('policy_criteria')} pc ON pc.policy_id = r.policy_id
       LEFT JOIN ${fq('ai_criteria_evidence')} e ON e.request_id = r.request_id AND e.criterion_id = pc.criterion_id
       WHERE r.final_outcome = 'Open'`,
    ),
    execSql<CaseRow>(
      warehouseId,
      `SELECT n.note_id, n.request_id, n.note_type, n.author, n.note_date, n.note_text
       FROM ${fq('clinical_notes')} n JOIN ${fq('pa_requests')} r ON r.request_id = n.request_id
       WHERE r.final_outcome = 'Open'`,
    ),
    execSql<CaseRow>(warehouseId, `SELECT as_of_ts FROM ${fq('snapshot_info')} LIMIT 1`),
  ]);

  await db.transaction(async (tx) => {
    await chunkInsert(cases, 500, (chunk) =>
      tx
        .insert(paCases)
        .values(
          chunk.map((r) => ({
            requestId: r.request_id!,
            memberId: r.member_id!,
            memberName: r.member_name,
            memberAge: num(r.age),
            memberSex: r.sex,
            lineOfBusiness: r.line_of_business,
            planName: r.plan_name,
            providerId: r.provider_id,
            providerName: r.provider_name,
            npi: r.npi,
            practiceGroup: r.practice_group,
            specialty: r.specialty,
            policyId: r.policy_id!,
            policyTitle: r.policy_title,
            serviceCode: r.service_code,
            serviceDescription: r.service_description,
            serviceCategory: r.service_category,
            icd10Code: r.icd10_code,
            diagnosis: r.diagnosis_description,
            urgency: r.urgency!,
            channel: r.channel,
            receivedAt: ts(r.received_ts)!,
            dueAt: ts(r.due_ts)!,
            slaHours: num(r.sla_hours)!,
            intakeStatus: r.status,
            estCostUsd: num(r.est_cost_usd),
            requestedUnits: num(r.requested_units),
            placeOfService: r.place_of_service,
            autoApprovalEligible: bool(r.auto_approval_eligible),
            aiRecommendation: r.ai_recommendation,
            aiConfidence: num(r.ai_confidence),
            aiRationale: r.ai_rationale,
            missingInformation: r.missing_information,
            aiLane: r.ai_lane,
            nMet: num(r.n_met),
            nCriteria: num(r.n_criteria),
            aiModel: r.review_model,
            aiReviewedAt: ts(r.reviewed_at),
          })),
        )
        .onConflictDoNothing(),
    );
    await chunkInsert(crit, 1000, (chunk) =>
      tx
        .insert(caseCriteria)
        .values(
          chunk.map((r) => ({
            requestId: r.request_id!,
            criterionId: r.criterion_id!,
            criterionNumber: num(r.criterion_number),
            label: r.criterion_label,
            criterionText: r.criterion_text,
            status: r.status ?? 'Not Reviewed',
            evidenceQuote: r.evidence_quote,
            sourceNoteId: r.source_note_id,
          })),
        )
        .onConflictDoNothing(),
    );
    await chunkInsert(notes, 500, (chunk) =>
      tx
        .insert(caseNotes)
        .values(
          chunk.map((r) => ({
            noteId: r.note_id!,
            requestId: r.request_id!,
            noteType: r.note_type,
            author: r.author,
            noteDate: r.note_date,
            noteText: r.note_text ?? '',
          })),
        )
        .onConflictDoNothing(),
    );
    const asOf = snap[0]?.as_of_ts;
    if (asOf) {
      await tx
        .insert(appMeta)
        .values({ key: 'as_of', value: new Date(asOf).toISOString() })
        .onConflictDoUpdate({ target: appMeta.key, set: { value: new Date(asOf).toISOString() } });
    }
  });
  console.log(
    `[sync] done in ${Date.now() - t0}ms — ${cases.length} cases, ${crit.length} criteria, ${notes.length} notes`,
  );
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.case_notes, app.case_criteria, app.pa_cases, app.app_meta RESTART IDENTITY CASCADE`);
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
