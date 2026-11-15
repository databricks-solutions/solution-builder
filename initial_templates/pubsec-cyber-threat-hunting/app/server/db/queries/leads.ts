import { desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { incidentCases, leads, type AuditEntry, type ContainmentAction, type Investigation } from '../schema.js';

/** Analyst queue + write-back queries (Lakebase). */
const OPEN = sql`${leads.status} IN ('open','investigating')`;

export async function listLeads(db: AppDb, f: { status?: string; q?: string; limit?: number }) {
  const where: ReturnType<typeof sql>[] = [sql`TRUE`];
  if (f.status === 'open') where.push(OPEN);
  else if (f.status === 'closed') where.push(sql`${leads.status} IN ('escalated','closed_benign')`);
  if (f.q) where.push(sql`(${leads.displayName} ILIKE ${'%' + f.q + '%'} OR ${leads.entityId} ILIKE ${'%' + f.q + '%'})`);
  const r = await db.execute(sql`
    SELECT id, entity_type, entity_id, display_name, department, role, risk_score, priority, top_factors, risk_trend,
           first_flagged, linked_alerts, alerts_closed_fp, status, case_id, disposition,
           (investigation->>'verdict') AS ai_verdict, (investigation->>'severity') AS ai_severity
    FROM app.leads WHERE ${sql.join(where, sql` AND `)}
    ORDER BY (status IN ('escalated','closed_benign')), risk_score DESC LIMIT ${f.limit ?? 200}`);
  return r.rows;
}

export async function leadSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE ${OPEN})::int AS open,
           COUNT(*) FILTER (WHERE ${OPEN} AND priority = 'critical')::int AS critical_open,
           COUNT(*) FILTER (WHERE investigated_at IS NOT NULL)::int AS investigated,
           COUNT(*) FILTER (WHERE status = 'escalated')::int AS escalated,
           COUNT(*) FILTER (WHERE status = 'closed_benign')::int AS closed_benign,
           (SELECT COUNT(*)::int FROM app.incident_cases) AS cases_opened
    FROM app.leads`);
  return r.rows[0] as Record<string, number>;
}

export async function getLead(db: AppDb, id: string) {
  const [l] = await db.select().from(leads).where(eq(leads.id, id));
  if (!l) return null;
  const c = l.caseId ? (await db.select().from(incidentCases).where(eq(incidentCases.id, l.caseId)))[0] ?? null : null;
  return { ...l, incidentCase: c };
}

export async function saveInvestigation(db: AppDb, id: string, inv: Investigation, by: string) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Threat Hunting Copilot', action: 'ai_investigation', tool: 'investigate_lead',
    notes: `${inv.verdict.replace('_', ' ')} · ${inv.severity} · ${inv.timeline.length} timeline events · ${inv.techniques.length} ATT&CK techniques · requested by ${by}`,
  };
  await db.update(leads).set({
    investigation: inv, investigatedAt: new Date(), updatedAt: new Date(),
    status: sql`CASE WHEN ${leads.status} = 'open' THEN 'investigating' ELSE ${leads.status} END`,
    auditTrail: sql`${leads.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(leads.id, id));
}

async function nextCaseId(db: AppDb): Promise<string> {
  const y = new Date().getUTCFullYear();
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.incident_cases`);
  const n = ((r.rows[0] as { n: number }).n ?? 0) + 183; // continues the historical IR numbering
  return `IR-${y}-${String(n).padStart(4, '0')}`;
}

export async function openIncidentCase(
  db: AppDb,
  p: { leadId: string; severity: string; title: string; containment: ContainmentAction[]; notes: string | null; userEmail: string },
) {
  const [l] = await db.select().from(leads).where(eq(leads.id, p.leadId));
  if (!l) return null;
  if (l.caseId) return getLead(db, p.leadId);
  const inv = l.investigation;
  const id = await nextCaseId(db);
  const entities = [...new Set([l.entityId, ...(inv?.timeline ?? []).map((t) => t.entity).filter(Boolean)])].slice(0, 12);
  await db.insert(incidentCases).values({
    id, leadId: l.id, title: p.title, severity: p.severity, summary: inv?.summary ?? null, entities,
    techniques: inv?.techniques ?? [], containment: p.containment.map((c) => ({ ...c, status: 'requested' as const })),
    timeline: inv?.timeline ?? [], notifications: inv?.notifications ?? [], recordsAtRisk: inv?.records_at_risk ?? null,
    analyst: p.userEmail, notes: p.notes,
  });
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: p.userEmail, action: 'case_opened',
    notes: `${id} opened (${p.severity}) · ${p.containment.length} containment actions requested: ${p.containment.map((c) => c.code).join(', ')}`,
  };
  await db.update(leads).set({
    status: 'escalated', caseId: id, disposition: 'ESCALATED', dispositionNotes: p.notes, decidedBy: p.userEmail, decidedAt: new Date(),
    updatedAt: new Date(), auditTrail: sql`${leads.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(leads.id, p.leadId));
  return getLead(db, p.leadId);
}

export async function closeLeadBenign(db: AppDb, p: { leadId: string; notes: string | null; userEmail: string }) {
  const entry: AuditEntry = { at: new Date().toISOString(), by: p.userEmail, action: 'closed_benign', notes: p.notes ?? undefined };
  const r = await db.update(leads).set({
    status: 'closed_benign', disposition: 'BENIGN', dispositionNotes: p.notes, decidedBy: p.userEmail, decidedAt: new Date(),
    updatedAt: new Date(), auditTrail: sql`${leads.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(leads.id, p.leadId)).returning({ id: leads.id });
  return r.length ? getLead(db, p.leadId) : null;
}

export async function listIncidentCases(db: AppDb) {
  return db.select().from(incidentCases).orderBy(desc(incidentCases.openedAt));
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT l.id AS lead_id, l.display_name AS entity, l.entity_type, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.leads l, jsonb_array_elements(l.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

export async function findLeadsForAgent(db: AppDb, p: { include_closed: boolean; limit: number }) {
  const rows = await listLeads(db, { status: p.include_closed ? undefined : 'open', limit: p.limit });
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    return { lead_id: x.id, entity: `${x.display_name} (${x.entity_type} ${x.entity_id})`, department: x.department, risk_score: x.risk_score,
             priority: x.priority, top_factors: x.top_factors, status: x.status, case_id: x.case_id, ai_verdict: x.ai_verdict };
  });
}
