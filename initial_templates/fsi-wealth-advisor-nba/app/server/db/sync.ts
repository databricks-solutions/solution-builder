import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { clients, type Account, type Liability, type Note, type Recommendation, type RuleResult, type Signal } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the advisor's Morning Book.
 *
 * Delta (financial_services.wealth_advisor_copilot) holds the whole firm (5,400 households);
 * the app only needs the book of the advisor it is demoed as (ADVISOR_ID, default ADV-007
 * Elena Marsh): every household with an active signal, ranked (household_opportunities),
 * with its signals, accounts, mortgages, the last CRM notes (+ AI Functions insights) and
 * every scored next-best action with its suitability rule results (nba_recommendations).
 * Idempotent: skips when app.clients has rows, unless `forceIfAnyEmpty` ("Reset demo").
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  advisorId: string;
  tables: {
    households: string;
    opportunities: string;
    recommendations: string;
    signals: string;
    accounts: string;
    liabilities: string;
    notes: string;
    noteInsights: string;
    advisors: string;
    decisions: string;
  };
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.clients`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log(`[sync] Starting Delta → Lakebase sync of the Morning Book for ${cfg.advisorId}…`);
  const t0 = Date.now();
  const fq = (name: keyof DataConfig['tables']) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
  const adv = cfg.advisorId.replace(/[^A-Za-z0-9-]/g, '');
  const BOOK = `household_id IN (SELECT household_id FROM ${fq('opportunities')} WHERE advisor_id = '${adv}')`;

  const [hhRows, sigRows, accRows, liabRows, noteRows, recRows] = await Promise.all([
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT o.*, h.primary_age, h.sweep_cash, h.net_worth_estimate, h.risk_profile, h.risk_score, h.time_horizon_years,
             h.liquidity_need, h.investment_experience, h.marital_status, h.vulnerable_client, h.vulnerable_reason,
             h.trusted_contact_on_file, h.tenure_years, CAST(h.last_contact_date AS STRING) AS last_contact, a.advisor_name
      FROM ${fq('opportunities')} o JOIN ${fq('households')} h USING (household_id)
      JOIN ${fq('advisors')} a ON a.advisor_id = o.advisor_id
      WHERE o.advisor_id = '${adv}'`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT household_id, signal_type, CAST(signal_date AS STRING) AS signal_date, amount, detail, days_to_act
      FROM ${fq('signals')} WHERE ${BOOK} ORDER BY days_to_act, amount DESC`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT household_id, account_id, account_type, custodian, balance, rate_pct, CAST(maturity_date AS STRING) AS maturity_date
      FROM ${fq('accounts')} WHERE ${BOOK} ORDER BY balance DESC`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT household_id, liability_id, liability_type, lender, balance, rate_pct, CAST(origination_date AS STRING) AS originated,
             monthly_payment, property_value
      FROM ${fq('liabilities')} WHERE ${BOOK}`),
    execSql<Record<string, unknown>>(warehouseId, `
      WITH n AS (
        SELECT household_id, note_id, CAST(note_date AS STRING) AS note_date, channel, note_text,
               row_number() OVER (PARTITION BY household_id ORDER BY note_date DESC, note_id DESC) AS rn
        FROM ${fq('notes')} WHERE ${BOOK})
      SELECT n.*, i.signal_category, i.mentioned_amount, i.mentioned_timeframe, i.family_member, i.other_institution,
             i.sentiment, i.flight_risk_mention
      FROM n LEFT JOIN ${fq('noteInsights')} i USING (note_id) WHERE n.rn <= 6`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT * FROM ${fq('recommendations')} WHERE ${BOOK} ORDER BY model_rank`),
  ]);
  console.log(`[sync] fetched ${hhRows.length} households, ${recRows.length} scored actions in ${Date.now() - t0}ms`);

  const group = <T,>(rows: Record<string, unknown>[], f: (r: Record<string, unknown>) => T) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = String(r.household_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f(r));
    }
    return m;
  };
  const sig = group(sigRows, (r): Signal => ({ type: String(r.signal_type), date: str(r.signal_date), amount: num(r.amount), detail: str(r.detail), days_to_act: num(r.days_to_act) }));
  const acc = group(accRows, (r): Account => ({ id: String(r.account_id), type: String(r.account_type), custodian: String(r.custodian), balance: Number(r.balance), rate: num(r.rate_pct), maturity: str(r.maturity_date) }));
  const liab = group(liabRows, (r): Liability => ({ id: String(r.liability_id), type: String(r.liability_type), lender: String(r.lender), balance: Number(r.balance), rate: Number(r.rate_pct), originated: str(r.originated), payment: num(r.monthly_payment), property_value: num(r.property_value) }));
  const notes = group(noteRows, (r): Note => ({
    id: String(r.note_id), date: String(r.note_date), channel: str(r.channel), text: String(r.note_text),
    ai: r.signal_category == null ? null : {
      category: str(r.signal_category), amount: str(r.mentioned_amount), timeframe: str(r.mentioned_timeframe),
      family_member: str(r.family_member), other_institution: str(r.other_institution), sentiment: str(r.sentiment),
      flight_risk: bool(r.flight_risk_mention),
    },
  }));
  const recs = group(recRows, (r): Recommendation => ({
    action_code: String(r.action_code), action_name: String(r.action_name), category: String(r.category), complexity: String(r.complexity),
    trigger: String(r.trigger_type), signal: String(r.signal_type), propensity: Number(r.propensity), assets_in_scope: Number(r.assets_in_scope),
    expected_revenue: Number(r.expected_revenue_12m), model_rank: Number(r.model_rank),
    status: String(r.suitability_status) as Recommendation['status'], suitable_rank: num(r.suitable_rank),
    failed_rules: String(r.failed_rules ?? ''), rules: JSON.parse(String(r.rule_results ?? '[]')) as RuleResult[],
    disclosures: String(r.required_disclosures ?? ''),
  }));

  for (const list of notes.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  await chunkInsert(hhRows, 200, (chunk) =>
    db.insert(clients).values(chunk.map((r) => {
      const id = String(r.household_id);
      return {
        id,
        advisorId: String(r.advisor_id),
        advisorName: str(r.advisor_name),
        householdName: String(r.household_name),
        primaryName: String(r.primary_name),
        primaryAge: num(r.primary_age),
        segment: str(r.segment),
        aum: Number(r.aum),
        sweepCash: num(r.sweep_cash),
        netWorth: num(r.net_worth_estimate),
        riskProfile: str(r.risk_profile),
        riskScore: num(r.risk_score),
        timeHorizonYears: num(r.time_horizon_years),
        liquidityNeed: str(r.liquidity_need),
        investmentExperience: str(r.investment_experience),
        maritalStatus: str(r.marital_status),
        vulnerable: bool(r.vulnerable_client),
        vulnerableReason: str(r.vulnerable_reason),
        trustedContactOnFile: bool(r.trusted_contact_on_file),
        tenureYears: num(r.tenure_years),
        lastContactDate: str(r.last_contact),
        bookRank: Number(r.book_rank),
        priorityScore: num(r.priority_score),
        moneyInMotion: num(r.money_in_motion),
        lendingOpportunity: num(r.lending_opportunity),
        aumAtRisk: num(r.aum_at_risk),
        signalsLabel: str(r.signals),
        headlineSignal: str(r.headline_signal),
        daysToAct: num(r.days_to_act),
        daysSinceContact: num(r.days_since_contact),
        topModelAction: str(r.top_model_action),
        topModelStatus: str(r.top_model_status),
        bestSuitableAction: str(r.best_suitable_action),
        bestExpectedRevenue: num(r.best_expected_revenue_12m),
        modelTopBlocked: bool(r.model_top_blocked),
        signals: sig.get(id) ?? [],
        accounts: acc.get(id) ?? [],
        liabilities: liab.get(id) ?? [],
        notes: notes.get(id) ?? [],
        recommendations: recs.get(id) ?? [],
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
    await tx.execute(sql`TRUNCATE TABLE app.clients RESTART IDENTITY CASCADE`);
  });
}

/** Parameterized statement on the warehouse (used for the Delta write-back). */
export async function execWarehouseSql(statement: string, parameters: Array<{ name: string; value: string | null; type?: string }>): Promise<void> {
  const { client } = getExecutionContext();
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
  type R = { statement_id: string; status: { state: string; error?: { message: string } } };
  let cur = (await client.apiClient.request({
    method: 'POST', path: '/api/2.0/sql/statements',
    payload: { statement, warehouse_id: warehouseId, wait_timeout: '30s', on_wait_timeout: 'CONTINUE', parameters },
    headers: new Headers(), raw: false, query: {},
  })) as R;
  const t0 = Date.now();
  while (!['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED'].includes(cur.status.state)) {
    if (Date.now() - t0 > 120_000) throw new Error('write-back timed out');
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({ method: 'GET', path: `/api/2.0/sql/statements/${cur.statement_id}`, headers: new Headers(), raw: false, query: {} })) as R;
  }
  if (cur.status.state !== 'SUCCEEDED') throw new Error(cur.status.error?.message ?? cur.status.state);
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
