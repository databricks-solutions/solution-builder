import { eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { clients, type AuditEntry, type MeetingPrep } from '../schema.js';

/**
 * Morning Book queries (Lakebase). The book is ordered by book_rank (priority score from the
 * nightly model run); decided clients sink to the bottom so the advisor works top-down.
 */
const LIST_COLS = sql`id, household_name, primary_name, primary_age, segment, aum, sweep_cash, risk_profile, vulnerable,
  vulnerable_reason, book_rank, money_in_motion, lending_opportunity, aum_at_risk, signals_label, headline_signal, days_to_act,
  days_since_contact, top_model_action, top_model_status, best_suitable_action, best_expected_revenue, model_top_blocked,
  status, decision, decision_action, decided_at`;

export async function listBook(db: AppDb, f: { filter?: string; q?: string; limit?: number }) {
  const where: ReturnType<typeof sql>[] = [sql`TRUE`];
  if (f.filter === 'at_risk') where.push(sql`aum_at_risk > 0`);
  else if (f.filter === 'this_week') where.push(sql`days_to_act <= 14`);
  else if (f.filter === 'lending') where.push(sql`lending_opportunity > 0 OR signals_label ILIKE '%Home purchase%'`);
  else if (f.filter === 'blocked') where.push(sql`model_top_blocked`);
  else if (f.filter === 'decided') where.push(sql`decision IS NOT NULL`);
  if (f.q) where.push(sql`(id ILIKE ${'%' + f.q + '%'} OR household_name ILIKE ${'%' + f.q + '%'} OR primary_name ILIKE ${'%' + f.q + '%'})`);
  const r = await db.execute(sql`SELECT ${LIST_COLS} FROM app.clients WHERE ${sql.join(where, sql` AND `)}
    ORDER BY (decision IS NOT NULL), book_rank LIMIT ${f.limit ?? 300}`);
  return r.rows;
}

export async function bookSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS households,
      MAX(advisor_name) AS advisor_name,
      ROUND(SUM(aum))::float AS book_aum,
      ROUND(SUM(money_in_motion))::float AS money_in_motion,
      ROUND(SUM(aum_at_risk))::float AS aum_at_risk,
      ROUND(SUM(lending_opportunity))::float AS lending_opportunity,
      COUNT(*) FILTER (WHERE days_to_act <= 14)::int AS act_this_week,
      COUNT(*) FILTER (WHERE aum_at_risk > 0)::int AS at_risk_households,
      COUNT(*) FILTER (WHERE model_top_blocked)::int AS model_top_blocked,
      COUNT(*) FILTER (WHERE vulnerable)::int AS vulnerable,
      COUNT(*) FILTER (WHERE prepped_at IS NOT NULL)::int AS prepped,
      COUNT(*) FILTER (WHERE decision IS NOT NULL)::int AS decided,
      COUNT(*) FILTER (WHERE decision = 'meeting_booked')::int AS meetings_booked,
      ROUND(SUM(best_expected_revenue))::float AS expected_revenue
    FROM app.clients`);
  const bySignal = await db.execute(sql`
    SELECT s->>'type' AS signal, COUNT(DISTINCT c.id)::int AS households, ROUND(SUM((s->>'amount')::float))::float AS amount
    FROM app.clients c, jsonb_array_elements(c.signals) s
    WHERE s->>'type' NOT IN ('Death of spouse','New grandchild')
    GROUP BY 1 ORDER BY 3 DESC NULLS LAST`);
  return { ...(r.rows[0] as Record<string, unknown>), by_signal: bySignal.rows };
}

export async function getClient(db: AppDb, id: string) {
  const [c] = await db.select().from(clients).where(eq(clients.id, id));
  return c ?? null;
}

const entry = (by: string, action: AuditEntry['action'], notes?: string, tool?: string): AuditEntry => ({
  at: new Date().toISOString(), by, action, ...(notes ? { notes } : {}), ...(tool ? { tool } : {}),
});

export async function savePrep(db: AppDb, id: string, prep: MeetingPrep, by: string) {
  await db.update(clients).set({
    meetingPrep: prep, preppedAt: new Date(), outreachDraft: prep.outreach.body,
    status: sql`CASE WHEN ${clients.decision} IS NULL THEN 'prepped' ELSE ${clients.status} END`,
    auditTrail: sql`${clients.auditTrail} || ${JSON.stringify([entry(by, 'ai_prep', `Meeting prep: ${prep.agenda.map((a) => a.action_code).join(', ')}`, 'prep_meeting')])}::jsonb`,
    updatedAt: new Date(),
  }).where(eq(clients.id, id));
}

export type Decision = 'proposed' | 'meeting_booked' | 'not_now';

export async function decideClient(db: AppDb, p: { id: string; decision: Decision; action: string | null; notes: string | null; outreach: string | null; by: string }) {
  const label = { proposed: 'Proposal sent', meeting_booked: 'Meeting booked', not_now: 'Not now' }[p.decision];
  const [c] = await db.update(clients).set({
    status: p.decision, decision: p.decision, decisionAction: p.action, decisionNotes: p.notes,
    outreachDraft: p.outreach ?? sql`${clients.outreachDraft}`, decidedBy: p.by, decidedAt: new Date(),
    auditTrail: sql`${clients.auditTrail} || ${JSON.stringify([entry(p.by, p.decision, `${p.action ?? label}${p.notes ? `: ${p.notes}` : ''}`)])}::jsonb`,
    updatedAt: new Date(),
  }).where(eq(clients.id, p.id)).returning();
  return c ?? null;
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT c.id AS client_id, c.household_name, c.primary_name,
           e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.clients c, jsonb_array_elements(c.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

/** Compact rows for the chat agent's get_morning_book tool. */
export async function bookForAgent(db: AppDb, p: { filter: string | null; limit: number }) {
  const rows = (await listBook(db, { filter: p.filter ?? undefined, limit: p.limit })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    rank: r.book_rank, household_id: r.id, client: r.primary_name, age: r.primary_age, aum: r.aum,
    money_in_motion: r.money_in_motion, aum_at_risk: r.aum_at_risk, signals: r.signals_label, headline: r.headline_signal,
    act_within_days: r.days_to_act, days_since_contact: r.days_since_contact, vulnerable: r.vulnerable,
    model_top_action: r.top_model_action, model_top_status: r.top_model_status, best_suitable_action: r.best_suitable_action,
    decision: r.decision,
  }));
}
