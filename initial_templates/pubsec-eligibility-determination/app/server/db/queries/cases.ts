import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { caseDocuments, cases, type AuditEntry, type CaseAssessment } from '../schema.js';

/**
 * Caseload queries. "Standard" = the federal processing deadline for the case:
 * 7 days for expedited SNAP, 30 for SNAP, 45 for Medicaid. days_open is computed
 * live from submitted_date so the queue ages in real time.
 */
const STANDARD = sql`CASE WHEN ${cases.expeditedScreening} THEN 7 WHEN ${cases.program} = 'Medicaid' THEN 45 ELSE 30 END`;
const DAYS_OPEN = sql`(CURRENT_DATE - ${cases.submittedDate})`;
const OPEN = sql`${cases.status} IN ('pending_review','awaiting_verification','escalated')`;

export type CaseListFilters = { county?: string; status?: string; caseworker?: string; q?: string; limit?: number };

export async function listCases(db: AppDb, f: CaseListFilters) {
  const where: ReturnType<typeof sql>[] = [sql`TRUE`];
  if (f.county) where.push(sql`${cases.county} = ${f.county}`);
  if (f.caseworker) where.push(sql`${cases.caseworkerId} = ${f.caseworker}`);
  if (f.status === 'open') where.push(OPEN);
  else if (f.status === 'overdue') where.push(sql`${OPEN} AND ${DAYS_OPEN} > ${STANDARD}`);
  else if (f.status === 'decided') where.push(sql`${cases.decision} IS NOT NULL`);
  else if (f.status) where.push(sql`${cases.status} = ${f.status}`);
  if (f.q) where.push(sql`(${cases.id} ILIKE ${'%' + f.q + '%'} OR (${cases.headFirstName} || ' ' || ${cases.headLastName}) ILIKE ${'%' + f.q + '%'})`);
  const rows = await db.execute(sql`
    SELECT cases.id, cases.program, cases.county, cases.channel, cases.submitted_date, cases.status, cases.expedited_screening,
           cases.head_first_name, cases.head_last_name, cases.household_size, cases.preferred_language,
           cases.caseworker_id, cases.caseworker_name, cases.decision, cases.rfi_count,
           (cases.assessment->>'recommendation') AS ai_recommendation,
           (CURRENT_DATE - cases.submitted_date) AS days_open,
           CASE WHEN cases.expedited_screening THEN 7 WHEN cases.program = 'Medicaid' THEN 45 ELSE 30 END AS standard_days,
           COUNT(d.id)::int AS doc_count,
           BOOL_OR(d.doc_type = 'photo_id') IS TRUE AS has_id,
           BOOL_OR(d.doc_type IN ('lease','utility_bill')) IS TRUE AS has_residency,
           BOOL_OR(d.doc_type IN ('paystub','employer_letter','self_declaration')) IS TRUE AS has_income
    FROM app.cases LEFT JOIN app.case_documents d ON d.case_id = cases.id
    WHERE ${sql.join(where, sql` AND `)}
    GROUP BY cases.id
    ORDER BY (cases.decision IS NOT NULL), (CURRENT_DATE - cases.submitted_date) DESC
    LIMIT ${f.limit ?? 300}
  `);
  return rows.rows;
}

export async function caseSummary(db: AppDb, county?: string) {
  const scope = county ? sql`${cases.county} = ${county}` : sql`TRUE`;
  const r = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${OPEN})::int AS open,
      COUNT(*) FILTER (WHERE ${OPEN} AND ${DAYS_OPEN} > ${STANDARD})::int AS overdue,
      COUNT(*) FILTER (WHERE ${OPEN} AND ${cases.expeditedScreening})::int AS expedited_open,
      COUNT(*) FILTER (WHERE ${OPEN} AND ${cases.expeditedScreening} AND ${DAYS_OPEN} > 7)::int AS expedited_late,
      COUNT(*) FILTER (WHERE ${cases.status} = 'awaiting_verification')::int AS awaiting_verification,
      COUNT(*) FILTER (WHERE ${cases.decidedAt} IS NOT NULL)::int AS decided,
      COUNT(*) FILTER (WHERE ${cases.assessedAt} IS NOT NULL)::int AS ai_checked,
      ROUND(AVG(${DAYS_OPEN}) FILTER (WHERE ${OPEN}), 1)::float AS avg_days_open
    FROM app.cases WHERE ${scope}`);
  const byCounty = await db.execute(sql`
    SELECT county, COUNT(*) FILTER (WHERE ${OPEN})::int AS open,
           COUNT(*) FILTER (WHERE ${OPEN} AND ${DAYS_OPEN} > ${STANDARD})::int AS overdue
    FROM app.cases GROUP BY county ORDER BY overdue DESC, open DESC`);
  return { ...(r.rows[0] as Record<string, number>), by_county: byCounty.rows };
}

export async function getCase(db: AppDb, id: string) {
  const [c] = await db.select().from(cases).where(eq(cases.id, id));
  if (!c) return null;
  const docs = await db.select().from(caseDocuments).where(eq(caseDocuments.caseId, id)).orderBy(caseDocuments.docType);
  const daysOpen = Math.floor((Date.now() - new Date(`${c.submittedDate}T00:00:00Z`).getTime()) / 86_400_000);
  return { ...c, daysOpen, documents: docs };
}

export async function saveAssessment(
  db: AppDb,
  id: string,
  a: CaseAssessment,
  notice: { type: string; language: string; text: string },
  by: string,
) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Eligibility Copilot', action: 'ai_check', tool: 'eligibility_check',
    notes: `Recommendation ${a.recommendation} · ${a.rules.filter((r) => r.result === 'PASS').length}/${a.rules.length} rules pass · requested by ${by}`,
  };
  await db.update(cases).set({
    assessment: a, assessedAt: new Date(), noticeDraft: notice.text || null, noticeType: notice.type,
    noticeLanguage: notice.language, updatedAt: new Date(),
    auditTrail: sql`${cases.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(cases.id, id));
}

export type Decision = 'APPROVED' | 'DENIED' | 'RFI_SENT' | 'ESCALATED';

export async function decideCase(
  db: AppDb,
  p: { id: string; decision: Decision; notes?: string | null; noticeText?: string | null; userEmail: string },
) {
  const status = ({ APPROVED: 'approved', DENIED: 'denied', RFI_SENT: 'awaiting_verification', ESCALATED: 'escalated' } as const)[p.decision];
  const action = ({ APPROVED: 'approved', DENIED: 'denied', RFI_SENT: 'rfi_sent', ESCALATED: 'escalated' } as const)[p.decision];
  const [cur] = await db.select().from(cases).where(eq(cases.id, p.id));
  if (!cur) return null;
  const entries: AuditEntry[] = [];
  if (p.noticeText != null && p.noticeText !== (cur.noticeDraft ?? '')) {
    entries.push({ at: new Date().toISOString(), by: p.userEmail, action: 'notice_edited', notes: 'Caseworker edited the AI-drafted notice before sending.' });
  }
  entries.push({ at: new Date().toISOString(), by: p.userEmail, action, notes: p.notes ?? undefined });
  const benefit = p.decision === 'APPROVED' ? (cur.assessment?.estimated_monthly_benefit ?? null) : null;
  await db.update(cases).set({
    status, decision: p.decision, decisionNotes: p.notes ?? null, decidedBy: p.userEmail, decidedAt: new Date(),
    noticeDraft: p.noticeText ?? cur.noticeDraft, monthlyBenefitAmount: benefit,
    rfiCount: p.decision === 'RFI_SENT' ? cur.rfiCount + 1 : cur.rfiCount, updatedAt: new Date(),
    auditTrail: sql`${cases.auditTrail} || ${JSON.stringify(entries)}::jsonb`,
  }).where(and(eq(cases.id, p.id)));
  return getCase(db, p.id);
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT c.id AS case_id, c.head_first_name || ' ' || c.head_last_name AS applicant, c.program, c.county,
           e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.cases c, jsonb_array_elements(c.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

export async function findCasesForAgent(db: AppDb, p: { county: string | null; overdue_only: boolean; limit: number }) {
  const rows = await listCases(db, { county: p.county ?? undefined, status: p.overdue_only ? 'overdue' : 'open', limit: p.limit });
  return rows;
}

export { desc };
