import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { appMeta, caseCriteria, caseNotes, paCases, type AuditEntry } from '../schema.js';

/**
 * Prior-auth workbench queries (Lakebase `app.*`).
 *
 * SLA clocks are computed against the queue SNAPSHOT time (`app_meta.as_of`,
 * written by the data generator as the latest Monday 08:00 UTC) so the demo
 * tells the same "Monday-morning backlog" story whenever it is shown.
 */

export type CaseRow = typeof paCases.$inferSelect;
export type Decision = 'approve' | 'pend' | 'refer_md';

const STATUS_FOR: Record<Decision, CaseRow['status']> = {
  approve: 'approved',
  pend: 'pended',
  refer_md: 'referred_md',
};

export async function getAsOf(db: AppDb): Promise<Date> {
  const r = await db.select().from(appMeta).where(eq(appMeta.key, 'as_of')).limit(1);
  return r[0] ? new Date(r[0].value) : new Date();
}

export function hoursRemaining(c: Pick<CaseRow, 'dueAt'>, asOf: Date): number {
  return Math.round(((new Date(c.dueAt).getTime() - asOf.getTime()) / 3_600_000) * 10) / 10;
}

export function clockState(c: Pick<CaseRow, 'dueAt' | 'slaHours'>, asOf: Date): 'breached' | 'at_risk' | 'ok' {
  const h = hoursRemaining(c, asOf);
  if (h <= 0) return 'breached';
  if (h <= Math.max(12, c.slaHours * 0.25)) return 'at_risk';
  return 'ok';
}

export type CaseListFilter = {
  lane?: string;
  urgency?: string;
  status?: string;
  q?: string;
};

export async function listCases(db: AppDb, f: CaseListFilter = {}) {
  const asOf = await getAsOf(db);
  const conds = [];
  if (f.status && f.status !== 'all') conds.push(eq(paCases.status, f.status as CaseRow['status']));
  if (f.lane) conds.push(eq(paCases.aiLane, f.lane));
  if (f.urgency) conds.push(eq(paCases.urgency, f.urgency));
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(
      sql`(${paCases.requestId} ILIKE ${like} OR ${paCases.memberName} ILIKE ${like} OR ${paCases.practiceGroup} ILIKE ${like} OR ${paCases.policyTitle} ILIKE ${like} OR ${paCases.serviceCode} ILIKE ${like})`,
    );
  }
  const rows = await db
    .select()
    .from(paCases)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(paCases.dueAt));
  return rows.map((r) => ({
    ...r,
    hoursRemaining: hoursRemaining(r, asOf),
    clock: clockState(r, asOf),
  }));
}

export async function caseSummary(db: AppDb) {
  const asOf = await getAsOf(db);
  const rows = await db.select().from(paCases);
  const open = rows.filter((r) => r.status === 'open');
  const lanes: Record<string, number> = {};
  for (const r of open) lanes[r.aiLane ?? 'Not reviewed'] = (lanes[r.aiLane ?? 'Not reviewed'] ?? 0) + 1;
  const decided = rows.filter((r) => r.status !== 'open');
  const by = (s: CaseRow['status']) => decided.filter((r) => r.status === s).length;
  const expedited = open.filter((r) => r.urgency === 'Expedited');
  return {
    asOf: asOf.toISOString(),
    total: rows.length,
    open: open.length,
    expeditedOpen: expedited.length,
    breached: open.filter((r) => clockState(r, asOf) === 'breached').length,
    atRisk: open.filter((r) => clockState(r, asOf) === 'at_risk').length,
    faxAwaitingIndexing: open.filter((r) => r.intakeStatus === 'Intake / Indexing').length,
    lanes,
    autoApprovable: open.filter(isAutoApprovable).length,
    decided: {
      total: decided.length,
      approved: by('approved'),
      autoApproved: by('auto_approved'),
      pended: by('pended'),
      referredMd: by('referred_md'),
    },
  };
}

/** The MV-UM-000 auto-approval rule, re-checked at write time. */
export function isAutoApprovable(r: CaseRow): boolean {
  return (
    r.status === 'open' &&
    r.aiLane === 'Auto-approval lane' &&
    r.autoApprovalEligible &&
    r.aiRecommendation === 'APPROVE' &&
    (r.aiConfidence ?? 0) >= 0.85 &&
    r.nCriteria !== null &&
    r.nMet === r.nCriteria
  );
}

export async function getCase(db: AppDb, requestId: string) {
  const asOf = await getAsOf(db);
  const [c] = await db.select().from(paCases).where(eq(paCases.requestId, requestId)).limit(1);
  if (!c) return null;
  const [criteria, notes] = await Promise.all([
    db.select().from(caseCriteria).where(eq(caseCriteria.requestId, requestId)).orderBy(asc(caseCriteria.criterionNumber)),
    db.select().from(caseNotes).where(eq(caseNotes.requestId, requestId)).orderBy(asc(caseNotes.noteId)),
  ]);
  return {
    ...c,
    hoursRemaining: hoursRemaining(c, asOf),
    clock: clockState(c, asOf),
    autoApprovable: isAutoApprovable(c),
    criteria,
    notes,
  };
}

export async function decideCase(
  db: AppDb,
  args: { requestId: string; decision: Decision; userEmail: string; note?: string | null; providerLetter?: string | null },
) {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: STATUS_FOR[args.decision] as AuditEntry['action'],
    notes: args.note ?? undefined,
  };
  const [row] = await db
    .update(paCases)
    .set({
      status: STATUS_FOR[args.decision],
      decidedAt: new Date(),
      decidedBy: args.userEmail,
      decisionNote: args.note ?? null,
      providerLetter: args.providerLetter ?? null,
      auditTrail: sql`${paCases.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(paCases.requestId, args.requestId), eq(paCases.status, 'open')))
    .returning();
  return row ?? null;
}

export async function autoApprovalCandidates(db: AppDb) {
  const asOf = await getAsOf(db);
  const rows = await db.select().from(paCases).where(eq(paCases.status, 'open')).orderBy(asc(paCases.dueAt));
  return rows.filter(isAutoApprovable).map((r) => ({ ...r, hoursRemaining: hoursRemaining(r, asOf) }));
}

/** Approve every case that passes the auto-approval rule (optionally a subset). */
export async function autoApproveBatch(db: AppDb, args: { by: string; requestIds?: string[] | null }) {
  const candidates = (await autoApprovalCandidates(db)).filter(
    (r) => !args.requestIds || args.requestIds.length === 0 || args.requestIds.includes(r.requestId),
  );
  if (candidates.length === 0) return [];
  const ids = candidates.map((r) => r.requestId);
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    by: 'AUTO-RULE-v1',
    action: 'auto_approved',
    notes: `All policy criteria met with cited evidence (AI confidence >= 0.85); released by ${args.by}`,
  };
  return db
    .update(paCases)
    .set({
      status: 'auto_approved',
      decidedAt: new Date(),
      decidedBy: 'AUTO-RULE-v1',
      decisionNote: `Auto-approved under MV-UM-000 (released by ${args.by})`,
      auditTrail: sql`${paCases.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(inArray(paCases.requestId, ids), eq(paCases.status, 'open')))
    .returning();
}

export async function saveAiReview(
  db: AppDb,
  requestId: string,
  review: {
    recommendation: string;
    confidence: number;
    rationale: string;
    missing_information: string;
    criteria: Array<{ criterion_id: string; status: string; evidence: string; source_note_id: string }>;
    model: string;
  },
  by: string,
) {
  const nMet = review.criteria.filter((c) => c.status === 'Met').length;
  // Evidence guard (same as build_ai_review.sql): each Met criterion cites its own specific quote.
  const metQuotes = review.criteria.filter((c) => c.status === 'Met').map((c) => c.evidence.trim().toLowerCase());
  const evidenceSpecific = new Set(metQuotes).size === metQuotes.length && metQuotes.every((q) => q.length >= 25 && !q.startsWith('prior authorization') && !q.startsWith('request prior authorization'));
  const [c] = await db.select().from(paCases).where(eq(paCases.requestId, requestId)).limit(1);
  if (!c) return null;
  const n = c.nCriteria ?? review.criteria.length;
  const allMet = nMet === n;
  const lane =
    allMet && evidenceSpecific && review.recommendation === 'APPROVE' && c.autoApprovalEligible && review.confidence >= 0.85
      ? 'Auto-approval lane'
      : allMet && review.recommendation === 'APPROVE'
        ? 'Nurse fast-track'
        : review.recommendation === 'PEND'
          ? 'Request information'
          : 'Physician review';
  await db.transaction(async (tx) => {
    for (const cr of review.criteria) {
      await tx
        .update(caseCriteria)
        .set({
          status: cr.status,
          evidenceQuote: cr.evidence.replace(/^["“]+|["”]+$/g, '') || null,
          sourceNoteId: cr.source_note_id || null,
        })
        .where(and(eq(caseCriteria.requestId, requestId), eq(caseCriteria.criterionId, cr.criterion_id)));
    }
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      by,
      action: 'ai_review',
      tool: review.model,
      notes: `${review.recommendation} (${Math.round(review.confidence * 100)}%) - ${lane}`,
    };
    await tx
      .update(paCases)
      .set({
        aiRecommendation: review.recommendation,
        aiConfidence: Math.round(review.confidence * 100) / 100,
        aiRationale: review.rationale,
        missingInformation: review.missing_information || null,
        aiLane: lane,
        nMet,
        aiModel: review.model,
        aiReviewedAt: new Date(),
        auditTrail: sql`${paCases.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(paCases.requestId, requestId));
  });
  return getCase(db, requestId);
}

/** Aggregations over the open queue — used by the agent + Home. */
export async function queueBreakdown(db: AppDb) {
  const asOf = await getAsOf(db);
  const open = (await db.select().from(paCases)).filter((r) => r.status === 'open');
  const group = <K extends string>(key: (r: CaseRow) => K) => {
    const m = new Map<K, { n: number; autoApprovable: number; pend: number; breached: number; atRisk: number }>();
    for (const r of open) {
      const k = key(r);
      const g = m.get(k) ?? { n: 0, autoApprovable: 0, pend: 0, breached: 0, atRisk: 0 };
      g.n++;
      if (isAutoApprovable(r)) g.autoApprovable++;
      if (r.aiLane === 'Request information') g.pend++;
      const cs = clockState(r, asOf);
      if (cs === 'breached') g.breached++;
      if (cs === 'at_risk') g.atRisk++;
      m.set(k, g);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.n - a.n);
  };
  return {
    asOf: asOf.toISOString(),
    byPolicy: group((r) => `${r.policyId} ${r.policyTitle ?? ''}`.trim()),
    byPracticeGroup: group((r) => r.practiceGroup ?? 'Unknown'),
    byChannel: group((r) => r.channel ?? 'Unknown'),
    byUrgency: group((r) => r.urgency),
  };
}

export async function recentActivity(db: AppDb, limit: number) {
  const rows = await db
    .select({ requestId: paCases.requestId, memberName: paCases.memberName, policyTitle: paCases.policyTitle, auditTrail: paCases.auditTrail })
    .from(paCases)
    .where(sql`jsonb_array_length(${paCases.auditTrail}) > 0`);
  const events = rows.flatMap((r) =>
    r.auditTrail.map((e) => ({ ...e, requestId: r.requestId, memberName: r.memberName, policyTitle: r.policyTitle })),
  );
  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.slice(0, limit);
}
