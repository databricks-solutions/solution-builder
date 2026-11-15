import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { planEvents, plans, type PlanAction, type PlanTotals } from '../schema.js';

/** Mitigation plans (Lakebase): at most one `proposed` and one `booked` plan per exposure. */

export type PlanRow = typeof plans.$inferSelect;

const newId = () => `PLN-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

export async function plansFor(db: AppDb, exposureId: string): Promise<{ proposed: PlanRow | null; booked: PlanRow | null; events: Array<typeof planEvents.$inferSelect> }> {
  const rows = await db.select().from(plans).where(eq(plans.exposureId, exposureId)).orderBy(desc(plans.createdAt));
  const events = await db.select().from(planEvents).where(eq(planEvents.exposureId, exposureId)).orderBy(desc(planEvents.at)).limit(30);
  return { proposed: rows.find((r) => r.status === 'proposed') ?? null, booked: rows.find((r) => r.status === 'booked') ?? null, events };
}

export async function planStatusByExposure(db: AppDb): Promise<Record<string, { status: 'proposed' | 'booked'; planId: string; cost: number; revenueProtected: number }>> {
  const rows = await db.select().from(plans).orderBy(desc(plans.createdAt));
  const out: Record<string, { status: 'proposed' | 'booked'; planId: string; cost: number; revenueProtected: number }> = {};
  for (const r of rows) {
    const cur = out[r.exposureId];
    if (!cur || (cur.status === 'proposed' && r.status === 'booked')) {
      out[r.exposureId] = { status: r.status, planId: r.id, cost: r.totals.planCost, revenueProtected: r.totals.revenueProtected };
    }
  }
  return out;
}

export async function saveProposal(db: AppDb, p: { exposureId: string; actions: PlanAction[]; totals: PlanTotals; rationale: string | null; by: string }): Promise<PlanRow> {
  return db.transaction(async (tx) => {
    await tx.delete(plans).where(and(eq(plans.exposureId, p.exposureId), eq(plans.status, 'proposed')));
    const [row] = await tx.insert(plans).values({
      id: newId(), exposureId: p.exposureId, status: 'proposed', actions: p.actions, totals: p.totals,
      rationale: p.rationale, proposedBy: p.by,
    }).returning();
    await tx.insert(planEvents).values({
      exposureId: p.exposureId, planId: row.id, actor: p.by, kind: 'proposed',
      detail: `${p.actions.map((a) => a.title).join(' + ')} — cost $${Math.round(p.totals.planCost).toLocaleString()}, protects $${Math.round(p.totals.revenueProtected).toLocaleString()}`,
    });
    return row;
  });
}

export async function bookPlan(db: AppDb, p: { exposureId: string; actions: PlanAction[]; totals: PlanTotals; rationale: string | null; by: string; proposedBy: string }): Promise<PlanRow> {
  return db.transaction(async (tx) => {
    await tx.delete(plans).where(and(eq(plans.exposureId, p.exposureId), eq(plans.status, 'proposed')));
    const [row] = await tx.insert(plans).values({
      id: newId(), exposureId: p.exposureId, status: 'booked', actions: p.actions, totals: p.totals, rationale: p.rationale,
      proposedBy: p.proposedBy, bookedBy: p.by, bookedAt: new Date(),
    }).returning();
    await tx.insert(planEvents).values({
      exposureId: p.exposureId, planId: row.id, actor: p.by, kind: 'booked',
      detail: `Booked ${p.actions.map((a) => `${a.documentNumber ?? ''} ${a.title}`.trim()).join(' + ')} — $${Math.round(p.totals.planCost).toLocaleString()}, approver: ${p.totals.approver}`,
    });
    return row;
  });
}

export async function markDeltaWritten(db: AppDb, planId: string): Promise<void> {
  await db.update(plans).set({ deltaWritten: true }).where(eq(plans.id, planId));
}

export async function recentPlanEvents(db: AppDb, limit: number) {
  return db.execute(sql`SELECT e.exposure_id, e.plan_id, e.actor, e.kind, e.detail, e.at FROM app.plan_events e ORDER BY e.at DESC LIMIT ${limit}`).then((r) => r.rows);
}
