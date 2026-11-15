import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { caseDocuments, cases, type ExtractedFields } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the OPEN caseload.
 *
 * Delta (public_sector.eligibility_copilot) holds 12 months of applications;
 * the workbench only needs the open ones (pending_review / awaiting_verification)
 * + their household, caseworker, verification documents and the ai_extract
 * output computed by the setup job. Idempotent: skips when app.cases has rows,
 * unless `forceIfAnyEmpty` (the "Reset demo" button).
 *
 * Also exposes `loadRulebook()` — program_rules + income_limits read once from
 * Delta and cached; the eligibility check (services/assess.ts) uses it.
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    applications: string;
    households: string;
    caseworkers: string;
    documents: string;
    extractions: string;
    counties: string;
    programRules: string;
    incomeLimits: string;
  };
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.cases`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync of the open caseload…');
  const t0 = Date.now();
  const fq = (name: keyof DataConfig['tables']) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
  const OPEN = `a.status IN ('pending_review','awaiting_verification')`;

  const [caseRows, docRows] = await Promise.all([
    execSql<Record<string, unknown>>(
      warehouseId,
      `SELECT a.application_id, a.household_id, a.program, a.county_name, c.region_type, a.channel,
              a.submitted_date, a.expedited_screening, a.reported_monthly_income, a.reported_liquid_resources,
              a.citizenship_verified_electronically, a.status, a.rfi_count, a.caseworker_id,
              w.caseworker_name, w.unit AS caseworker_unit,
              h.head_first_name, h.head_last_name, h.head_age, h.household_size, h.children_under_18,
              h.elderly_or_disabled_member, h.preferred_language, h.street_address, h.city, h.zip_code, h.phone
       FROM ${fq('applications')} a
       JOIN ${fq('households')} h ON h.household_id = a.household_id
       JOIN ${fq('counties')} c ON c.county_name = a.county_name
       LEFT JOIN ${fq('caseworkers')} w ON w.caseworker_id = a.caseworker_id
       WHERE ${OPEN}`,
    ),
    execSql<Record<string, unknown>>(
      warehouseId,
      `SELECT d.document_id, d.application_id, d.doc_type, d.received_date, d.file_name, d.page_count, d.document_text,
              e.person_name, e.issuer, CAST(e.document_date AS STRING) AS document_date,
              CAST(e.expiration_date AS STRING) AS expiration_date,
              CAST(e.employment_end_date AS STRING) AS employment_end_date, e.gross_pay, e.pay_frequency,
              e.street_address, e.city, e.state, e.monthly_rent, e.account_balance, e.declares_no_income,
              e.extraction_confidence
       FROM ${fq('documents')} d
       JOIN ${fq('applications')} a ON a.application_id = d.application_id
       LEFT JOIN ${fq('extractions')} e ON e.document_id = d.document_id
       WHERE ${OPEN}`,
    ),
  ]);
  console.log(`[sync] fetched ${caseRows.length} open cases, ${docRows.length} documents in ${Date.now() - t0}ms`);

  await chunkInsert(caseRows, 1000, (chunk) =>
    db.insert(cases).values(chunk.map((r) => ({
      id: String(r.application_id),
      householdId: String(r.household_id),
      program: String(r.program),
      county: String(r.county_name),
      regionType: (r.region_type as string) ?? null,
      channel: (r.channel as string) ?? null,
      submittedDate: String(r.submitted_date),
      expeditedScreening: bool(r.expedited_screening),
      reportedMonthlyIncome: num(r.reported_monthly_income),
      reportedLiquidResources: num(r.reported_liquid_resources),
      citizenshipVerifiedElectronically: bool(r.citizenship_verified_electronically),
      status: r.status as 'pending_review' | 'awaiting_verification',
      rfiCount: num(r.rfi_count) ?? 0,
      caseworkerId: (r.caseworker_id as string) ?? null,
      caseworkerName: (r.caseworker_name as string) ?? null,
      caseworkerUnit: (r.caseworker_unit as string) ?? null,
      headFirstName: String(r.head_first_name),
      headLastName: String(r.head_last_name),
      headAge: num(r.head_age),
      householdSize: num(r.household_size) ?? 1,
      childrenUnder18: num(r.children_under_18),
      elderlyOrDisabled: bool(r.elderly_or_disabled_member),
      preferredLanguage: (r.preferred_language as string) ?? null,
      streetAddress: (r.street_address as string) ?? null,
      city: (r.city as string) ?? null,
      zipCode: (r.zip_code as string) ?? null,
      phone: (r.phone as string) ?? null,
    }))).onConflictDoNothing(),
  );
  await chunkInsert(docRows, 1000, (chunk) =>
    db.insert(caseDocuments).values(chunk.map((r) => {
      const extracted: ExtractedFields = {
        person_name: (r.person_name as string) ?? null,
        issuer: (r.issuer as string) ?? null,
        document_date: (r.document_date as string) ?? null,
        expiration_date: (r.expiration_date as string) ?? null,
        employment_end_date: (r.employment_end_date as string) ?? null,
        gross_pay: num(r.gross_pay),
        pay_frequency: (r.pay_frequency as string) ?? null,
        street_address: (r.street_address as string) ?? null,
        city: (r.city as string) ?? null,
        state: (r.state as string) ?? null,
        monthly_rent: num(r.monthly_rent),
        account_balance: num(r.account_balance),
        declares_no_income: r.declares_no_income === null || r.declares_no_income === undefined ? null : bool(r.declares_no_income),
      };
      return {
        id: String(r.document_id),
        caseId: String(r.application_id),
        docType: String(r.doc_type),
        receivedDate: (r.received_date as string) ?? null,
        fileName: (r.file_name as string) ?? null,
        pageCount: num(r.page_count),
        documentText: (r.document_text as string) ?? null,
        extracted,
        extractionConfidence: num(r.extraction_confidence),
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
    await tx.execute(sql`TRUNCATE TABLE app.case_documents RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.cases RESTART IDENTITY CASCADE`);
  });
}

// ── Rulebook (program_rules + income_limits), cached ────────────────────────

export type ProgramRule = {
  rule_id: string; program: string; rule_order: number; category: string; rule_name: string;
  requirement: string; required_documents: string; cfr_citation: string; manual_section: string;
};
export type IncomeLimit = {
  household_size: number; snap_gross_monthly_limit: number; snap_net_monthly_limit: number;
  snap_max_allotment: number; medicaid_monthly_limit: number; snap_resource_limit: number;
  snap_resource_limit_elderly_disabled: number;
};
export type Rulebook = { rules: ProgramRule[]; limits: IncomeLimit[] };

let rulebookCache: Promise<Rulebook> | null = null;
export function loadRulebook(cfg: DataConfig): Promise<Rulebook> {
  if (!rulebookCache) {
    const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
    const fq = (name: keyof DataConfig['tables']) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
    rulebookCache = Promise.all([
      execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fq('programRules')} ORDER BY program, rule_order`),
      execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${fq('incomeLimits')} ORDER BY household_size`),
    ]).then(([r, l]) => ({
      rules: r.map((x) => ({ ...(x as unknown as ProgramRule), rule_order: Number(x.rule_order) })),
      limits: l.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Number(v)])) as unknown as IncomeLimit),
    }));
    rulebookCache.catch(() => { rulebookCache = null; });
  }
  return rulebookCache;
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
