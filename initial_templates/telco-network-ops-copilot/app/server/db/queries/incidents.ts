import { desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { incidents, troubleTickets, type AuditEntry, type Dispatch, type PlanAction, type Triage } from '../schema.js';

/** NOC incident queue + write-back queries (Lakebase). */
const OPEN = sql`${incidents.status} IN ('open','triaged')`;
/** Still an outage: a dispatched (ticketed) incident is live until it is resolved. */
const LIVE = sql`${incidents.status} IN ('open','triaged','ticketed')`;
const PRIO_ORDER = sql`CASE suggested_priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END`;

export async function listIncidents(db: AppDb, f: { status?: string; q?: string; limit?: number }) {
  const where: ReturnType<typeof sql>[] = [sql`TRUE`];
  if (f.status === 'open') where.push(OPEN);
  else if (f.status === 'closed') where.push(sql`${incidents.status} IN ('ticketed','closed_explained')`);
  if (f.q) where.push(sql`(${incidents.title} ILIKE ${'%' + f.q + '%'} OR ${incidents.suspectedNodeId} ILIKE ${'%' + f.q + '%'})`);
  const r = await db.execute(sql`
    SELECT id, incident_type, title, market, suspected_node_id, suspected_node_type, cell_id, detected_ts, first_alarm_ts, first_flagged_day,
           sites_affected, subscribers_served, enterprise_accounts, critical_facilities, alarm_count, critical_alarms, active_alarms,
           transport_alarms, alarm_types, anomaly_score, top_factors, suggested_priority, status, ticket_id, decision,
           (triage->>'verdict') AS ai_verdict, (triage->>'priority') AS ai_priority, (triage->>'headline') AS ai_headline
    FROM app.incidents WHERE ${sql.join(where, sql` AND `)}
    ORDER BY (status IN ('ticketed','closed_explained')), ${PRIO_ORDER}, active_alarms DESC, detected_ts DESC LIMIT ${f.limit ?? 200}`);
  return r.rows;
}

export async function incidentSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE ${OPEN})::int AS open,
           COUNT(*) FILTER (WHERE ${LIVE} AND suggested_priority = 'P1')::int AS p1_open,
           COALESCE(SUM(sites_affected) FILTER (WHERE ${LIVE} AND active_alarms > 0 AND incident_type IN ('alarm_storm','site_outage','backhaul_alarm')), 0)::int AS sites_down,
           COALESCE(SUM(subscribers_served) FILTER (WHERE ${LIVE} AND active_alarms > 0 AND incident_type IN ('alarm_storm','site_outage','backhaul_alarm')), 0)::int AS subscribers_down,
           COALESCE(SUM(alarm_count) FILTER (WHERE ${LIVE}), 0)::int AS alarms_open_incidents,
           COUNT(*) FILTER (WHERE triaged_at IS NOT NULL)::int AS triaged,
           COUNT(*) FILTER (WHERE status = 'ticketed')::int AS ticketed,
           COUNT(*) FILTER (WHERE status = 'closed_explained')::int AS closed_explained,
           (SELECT COUNT(*)::int FROM app.trouble_tickets) AS tickets_opened,
           (SELECT COALESCE(SUM(child_alarms_suppressed), 0)::int FROM app.trouble_tickets) AS alarms_suppressed
    FROM app.incidents`);
  return r.rows[0] as Record<string, number>;
}

export async function getIncident(db: AppDb, id: string) {
  const [l] = await db.select().from(incidents).where(eq(incidents.id, id));
  if (!l) return null;
  const t = l.ticketId ? (await db.select().from(troubleTickets).where(eq(troubleTickets.id, l.ticketId)))[0] ?? null : null;
  return { ...l, ticket: t };
}

export async function saveTriage(db: AppDb, id: string, tr: Triage, by: string) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'NOC Copilot', action: 'ai_triage', tool: 'triage_incident',
    notes: `${tr.verdict.replace(/_/g, ' ')} · ${tr.priority} · ${tr.actions.length} actions · ${tr.dispatch.length} dispatch(es) · requested by ${by}`,
  };
  await db.update(incidents).set({
    triage: tr, triagedAt: new Date(), updatedAt: new Date(),
    status: sql`CASE WHEN ${incidents.status} = 'open' THEN 'triaged' ELSE ${incidents.status} END`,
    auditTrail: sql`${incidents.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(incidents.id, id));
}

async function nextTicketId(db: AppDb): Promise<string> {
  const y = new Date().getUTCFullYear();
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.trouble_tickets`);
  const n = ((r.rows[0] as { n: number }).n ?? 0) + 41318; // continues the historical TT numbering
  return `TT-${y}-${n}`;
}

export async function openTroubleTicket(
  db: AppDb,
  p: { incidentId: string; priority: string; title: string; actions: PlanAction[]; dispatches: Dispatch[]; notes: string | null; userEmail: string },
) {
  const [l] = await db.select().from(incidents).where(eq(incidents.id, p.incidentId));
  if (!l) return null;
  if (l.ticketId) return getIncident(db, p.incidentId);
  const tr = l.triage;
  const id = await nextTicketId(db);
  const suppress = p.actions.some((a) => a.code === 'A-01') ? Math.max(0, (tr?.child_alarms_to_suppress ?? l.alarmCount)) : 0;
  await db.insert(troubleTickets).values({
    id, incidentId: l.id, title: p.title, priority: p.priority,
    rootCause: tr?.root_cause ? `${tr.root_cause.component}: ${tr.root_cause.cause}` : null, rootNode: tr?.root_cause?.node ?? l.suspectedNodeId,
    summary: tr?.summary ?? null, sitesAffected: tr?.impact?.sites_down ?? l.sitesAffected, subscribersImpacted: tr?.impact?.subscribers ?? l.subscribersServed,
    childAlarmsSuppressed: suppress,
    actions: p.actions.map((a) => ({ ...a, status: 'requested' as const })),
    dispatches: p.dispatches.map((d) => ({ ...d, status: 'dispatched' as const })),
    notifications: tr?.notifications ?? [], engineer: p.userEmail, notes: p.notes,
  });
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: p.userEmail, action: 'ticket_opened',
    notes: `${id} opened (${p.priority}) · ${p.actions.length} actions (${p.actions.map((a) => a.code).join(', ')}) · ${p.dispatches.length} technician(s) dispatched${suppress ? ` · ${suppress} child alarms suppressed` : ''}`,
  };
  await db.update(incidents).set({
    status: 'ticketed', ticketId: id, decision: 'TICKETED', decisionNotes: p.notes, decidedBy: p.userEmail, decidedAt: new Date(),
    updatedAt: new Date(), auditTrail: sql`${incidents.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(incidents.id, p.incidentId));
  return getIncident(db, p.incidentId);
}

export async function closeExplained(db: AppDb, p: { incidentId: string; notes: string | null; userEmail: string }) {
  const entry: AuditEntry = { at: new Date().toISOString(), by: p.userEmail, action: 'closed_explained', notes: p.notes ?? undefined };
  const r = await db.update(incidents).set({
    status: 'closed_explained', decision: 'EXPLAINED', decisionNotes: p.notes, decidedBy: p.userEmail, decidedAt: new Date(),
    updatedAt: new Date(), auditTrail: sql`${incidents.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(incidents.id, p.incidentId)).returning({ id: incidents.id });
  return r.length ? getIncident(db, p.incidentId) : null;
}

export async function listTroubleTickets(db: AppDb) {
  return db.select().from(troubleTickets).orderBy(desc(troubleTickets.openedAt));
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT l.id AS incident_id, l.title AS entity, l.incident_type AS entity_type, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.incidents l, jsonb_array_elements(l.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

export async function findIncidentsForAgent(db: AppDb, p: { include_closed: boolean; limit: number }) {
  const rows = await listIncidents(db, { status: p.include_closed ? undefined : 'open', limit: p.limit });
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    return { incident_id: x.id, type: x.incident_type, title: x.title, market: x.market, suggested_priority: x.suggested_priority,
             sites_affected: x.sites_affected, subscribers_served: x.subscribers_served, alarms: x.alarm_count, active_alarms: x.active_alarms,
             detected: x.detected_ts, status: x.status, ticket_id: x.ticket_id, ai_verdict: x.ai_verdict, ai_headline: x.ai_headline };
  });
}
