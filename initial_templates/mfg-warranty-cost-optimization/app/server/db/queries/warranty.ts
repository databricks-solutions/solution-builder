import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { claims, qualityCases, signals, type AuditEntry, type ContainmentAction, type SignalAnalysis } from '../schema.js';

/**
 * Warranty queries over the Lakebase mirror (signals + claims) and the write-back
 * table (quality_cases). Signals are ranked by projected remaining-warranty exposure.
 */

const PROJECTED = sql.raw(`COALESCE((SELECT SUM((e->>'projected_cost')::float) FROM jsonb_array_elements(s.exposure) e), 0)`);
const AFFECTED = sql.raw(`COALESCE((SELECT SUM((e->>'units')::int) FROM jsonb_array_elements(s.exposure) e), 0)`);

export async function listSignals(db: AppDb) {
  const r = await db.execute(sql`
    SELECT s.id, s.failure_mode, s.failure_mode_label, s.component, s.supplier_id, s.supplier_name, s.chargeable,
           s.claims_90d, s.claims_base, s.claims_total, s.cost_to_date, s.cost_90d, s.rate_90d, s.baseline_rate, s.rate_ratio,
           s.first_recent_claim, s.status, s.quality_case_id, s.analyzed_at, s.dealer_code_agreement,
           (s.cohort->>'dimension') AS cohort_dimension,
           COALESCE((SELECT string_agg(x->>'value', ', ') FROM jsonb_array_elements(s.cohort->'suspect') x), '') AS cohort_values,
           ${PROJECTED}::float AS projected_cost, ${AFFECTED}::int AS affected_units
    FROM app.signals s ORDER BY ${PROJECTED} DESC`);
  return r.rows;
}

export async function getSignal(db: AppDb, id: string) {
  const [s] = await db.select().from(signals).where(eq(signals.id, id));
  return s ?? null;
}

export async function signalClaims(db: AppDb, s: { failureMode: string; supplierId: string }, limit = 2000) {
  return db.select().from(claims)
    .where(and(eq(claims.failureMode, s.failureMode), eq(claims.supplierId, s.supplierId)))
    .orderBy(desc(claims.claimDate)).limit(limit);
}

/** Weekly claim counts for a signal (sparkline), last 26 weeks. */
export async function signalWeekly(db: AppDb, s: { failureMode: string; supplierId: string }) {
  const r = await db.execute(sql`
    SELECT date_trunc('week', claim_date)::date AS week, COUNT(*)::int AS claims
    FROM app.claims WHERE failure_mode = ${s.failureMode} AND supplier_id = ${s.supplierId}
      AND claim_status <> 'rejected' AND claim_date >= CURRENT_DATE - 182
    GROUP BY 1 ORDER BY 1`);
  return r.rows as Array<{ week: string; claims: number }>;
}

export type ClaimFilters = { failureMode?: string; region?: string; lot?: string; code?: string; q?: string; mismatchOnly?: boolean; limit?: number };
export async function listClaims(db: AppDb, f: ClaimFilters) {
  const where: ReturnType<typeof sql>[] = [sql`TRUE`];
  if (f.failureMode) where.push(sql`${claims.failureMode} = ${f.failureMode}`);
  if (f.region) where.push(sql`${claims.region} = ${f.region}`);
  if (f.lot) where.push(sql`(${claims.controllerLot} = ${f.lot} OR ${claims.brakeLot} = ${f.lot})`);
  if (f.code) where.push(sql`${claims.dealerLaborCode} = ${f.code}`);
  if (f.mismatchOnly) where.push(sql`${claims.matchesDealerCode} = false`);
  if (f.q) where.push(sql`(${claims.id} ILIKE ${'%' + f.q + '%'} OR ${claims.technicianNotes} ILIKE ${'%' + f.q + '%'} OR ${claims.serial} ILIKE ${'%' + f.q + '%'})`);
  const rows = await db.execute(sql`
    SELECT id, serial, model_name, dealer_name, region, claim_date, days_in_service, customer_complaint, dealer_labor_code,
           failure_mode, failure_mode_label, fault_code, water_exposure, observed_damage, matches_dealer_code, part_number,
           total_cost, claim_status, technician_notes, firmware, controller_lot, supplier_id, chargeable
    FROM app.claims WHERE ${sql.join(where, sql` AND `)}
    ORDER BY claim_date DESC, id DESC LIMIT ${f.limit ?? 200}`);
  const agg = await db.execute(sql`
    SELECT failure_mode, failure_mode_label, COUNT(*)::int AS claims,
           COUNT(*) FILTER (WHERE claim_date > CURRENT_DATE - 90)::int AS claims_90d,
           ROUND(SUM(total_cost)::numeric, 0)::float AS cost,
           ROUND(AVG(CASE WHEN matches_dealer_code THEN 1 ELSE 0 END)::numeric, 3)::float AS code_agreement
    FROM app.claims WHERE claim_status <> 'rejected' GROUP BY 1, 2 ORDER BY claims_90d DESC`);
  return { claims: rows.rows, modes: agg.rows };
}

export async function saveAnalysis(db: AppDb, id: string, a: SignalAnalysis, notice: string, by: string) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Warranty Copilot', action: 'ai_analysis', tool: 'root_cause_case',
    notes: `${a.findings.filter((f) => f.verdict === 'CONFIRMED').length} findings confirmed · ${a.findings.filter((f) => f.verdict === 'RULED_OUT').length} ruled out · requested by ${by}`,
  };
  await db.update(signals).set({
    analysis: a, analyzedAt: new Date(), supplierNoticeDraft: notice || null, updatedAt: new Date(),
    status: sql`CASE WHEN ${signals.status} = 'new' THEN 'investigating' ELSE ${signals.status} END`,
    auditTrail: sql`${signals.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(signals.id, id));
}

async function nextCaseId(db: AppDb): Promise<string> {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.quality_cases`);
  const n = (r.rows[0] as { n: number }).n;
  return `QC-${new Date().getFullYear()}-${String(142 + n).padStart(4, '0')}`;
}

export type OpenCaseInput = {
  signalId: string; actions: string[]; notes?: string | null; noticeText?: string | null; userEmail: string;
  openedVia: 'workbench' | 'copilot'; rootCause?: string | null;
};

/** The write-back: open a quality case from a signal's analysis (idempotent per signal). */
export async function openQualityCase(db: AppDb, p: OpenCaseInput) {
  const s = await getSignal(db, p.signalId);
  if (!s) return { error: `signal ${p.signalId} not found` } as const;
  if (s.qualityCaseId) {
    const [existing] = await db.select().from(qualityCases).where(eq(qualityCases.id, s.qualityCaseId));
    if (existing) return { case: existing, existing: true } as const;
  }
  const a = s.analysis;
  const opts = (a?.options ?? []) as ContainmentAction[];
  const keys = p.actions.length ? p.actions : opts.filter((o) => o.recommended).map((o) => o.key);
  const chosen = opts.filter((o) => keys.includes(o.key));
  const campaign = chosen.find((o) => o.key.startsWith('campaign'));
  const chargeback = chosen.some((o) => o.key === 'chargeback')
    ? (a?.chargeback ? a.chargeback.to_date + (campaign?.cost ?? 0) : null)
    : null;
  const lots = (s.cohort?.suspect ?? []).map((x) => x.value);
  const scope = a?.lots?.length && s.cohort?.dimension === 'controller_lot'
    ? a.lots.filter((l) => l.coating?.includes('PCN') || lots.includes(l.lot)).map((l) => l.lot) : lots;
  const id = await nextCaseId(db);
  const [row] = await db.insert(qualityCases).values({
    id, signalId: s.id,
    title: a?.headline || `${s.failureModeLabel} — ${s.supplierName}`,
    supplierId: s.supplierId, supplierName: s.supplierName,
    rootCause: p.rootCause || a?.root_cause || s.failureModeLabel,
    affectedLots: scope,
    affectedUnits: a?.exposure?.affected_units ?? null,
    containmentActions: chosen,
    projectedExposure: a?.exposure?.projected_cost ?? null,
    campaignCost: campaign?.cost ?? null,
    chargebackAmount: chargeback,
    supplierNotice: p.noticeText ?? s.supplierNoticeDraft ?? null,
    severity: (a?.exposure?.projected_cost ?? 0) > 250_000 ? 'high' : 'medium',
    status: 'open', owner: p.userEmail, notes: p.notes ?? null, openedVia: p.openedVia,
  }).returning();
  const entries: AuditEntry[] = [];
  if (p.noticeText != null && s.supplierNoticeDraft != null && p.noticeText !== s.supplierNoticeDraft) {
    entries.push({ at: new Date().toISOString(), by: p.userEmail, action: 'notice_edited', notes: 'Engineer edited the AI-drafted supplier notice.' });
  }
  entries.push({ at: new Date().toISOString(), by: p.openedVia === 'copilot' ? `Warranty Copilot (for ${p.userEmail})` : p.userEmail, action: 'case_opened', notes: `${id} · ${chosen.map((o) => o.label).join(' · ')}${p.notes ? ` · ${p.notes}` : ''}` });
  await db.update(signals).set({
    status: 'case_opened', qualityCaseId: id, updatedAt: new Date(),
    supplierNoticeDraft: p.noticeText ?? s.supplierNoticeDraft,
    auditTrail: sql`${signals.auditTrail} || ${JSON.stringify(entries)}::jsonb`,
  }).where(eq(signals.id, s.id));
  return { case: row, existing: false } as const;
}

export async function listQualityCases(db: AppDb) {
  return db.select().from(qualityCases).orderBy(desc(qualityCases.createdAt));
}

export async function getQualityCase(db: AppDb, id: string) {
  const [c] = await db.select().from(qualityCases).where(eq(qualityCases.id, id));
  return c ?? null;
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT s.id AS signal_id, s.failure_mode_label AS signal, s.supplier_name AS supplier,
           e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.signals s, jsonb_array_elements(s.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

export async function warrantySummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM app.signals) AS signals,
      (SELECT COUNT(*)::int FROM app.signals WHERE status = 'new') AS signals_new,
      (SELECT COUNT(*)::int FROM app.quality_cases) AS quality_cases,
      (SELECT COALESCE(SUM(chargeback_amount), 0)::float FROM app.quality_cases) AS chargebacks_filed,
      (SELECT COUNT(*)::int FROM app.claims WHERE claim_date > CURRENT_DATE - 90 AND claim_status <> 'rejected') AS claims_90d,
      (SELECT COUNT(*)::int FROM app.claims WHERE claim_date > CURRENT_DATE - 90 AND matches_dealer_code = false) AS miscoded_90d`);
  return r.rows[0];
}

export { desc };
