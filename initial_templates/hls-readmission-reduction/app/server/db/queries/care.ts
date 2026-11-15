import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { outreachTasks, transitionPlans, worklist, type AuditEntry, type PlanTask, type TransitionPlan } from '../schema.js';

/**
 * Care-transitions write surface (Lakebase): the open-discharge worklist with the
 * coordinator's progress, transition plans with their approval, and outreach tasks.
 */

export type WorklistFilter = { unitId?: string | null; condition?: string | null; tier?: string | null; hrrpOnly?: boolean; limit?: number };

export async function listWorklist(db: AppDb, f: WorklistFilter = {}) {
  const where = [sql`TRUE`];
  if (f.unitId) where.push(eq(worklist.unitId, f.unitId));
  if (f.condition) where.push(eq(worklist.hrrpCondition, f.condition));
  if (f.tier) where.push(eq(worklist.riskTier, f.tier));
  if (f.hrrpOnly) where.push(sql`${worklist.hrrpCondition} <> 'OTHER'`);
  return db.select().from(worklist).where(and(...where)).orderBy(desc(worklist.riskScore)).limit(Math.max(1, Math.min(400, f.limit ?? 400)));
}

export async function getPatient(db: AppDb, encounterId: string) {
  const [row] = await db.select().from(worklist).where(eq(worklist.encounterId, encounterId));
  return row ?? null;
}

/** Find a worklist patient by encounter id or (partial) name — for the chat agent. */
export async function findPatient(db: AppDb, q: string) {
  const s = q.trim();
  const [byId] = await db.select().from(worklist).where(eq(worklist.encounterId, s));
  if (byId) return byId;
  const rows = await db.select().from(worklist).where(sql`${worklist.patientName} ILIKE ${'%' + s + '%'}`).orderBy(desc(worklist.riskScore)).limit(1);
  return rows[0] ?? null;
}

export async function worklistSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS patients,
           COUNT(*) FILTER (WHERE risk_tier = 'High')::int AS high_risk,
           COUNT(*) FILTER (WHERE risk_tier = 'High' AND NOT followup_booked)::int AS high_risk_no_followup,
           COUNT(*) FILTER (WHERE status = 'planned')::int AS planned,
           COUNT(*) FILTER (WHERE plan_status = 'plan_approved')::int AS plans_approved
    FROM app.worklist`);
  const t = await db.execute(sql`
    SELECT COUNT(*)::int AS tasks, COUNT(*) FILTER (WHERE status = 'open')::int AS open_tasks FROM app.outreach_tasks`);
  return { ...(r.rows[0] as Record<string, number>), ...(t.rows[0] as Record<string, number>) };
}

export async function savePlan(db: AppDb, p: { plan: TransitionPlan; by: string; via: 'workbench' | 'copilot' }) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Readmission Copilot', action: 'ai_plan', tool: 'build_transition_plan',
    notes: `${p.plan.tasks.length} tasks proposed · requested by ${p.by} (${p.via})`,
  };
  const [row] = await db.insert(transitionPlans).values({
    encounterId: p.plan.encounter_id, patientName: p.plan.patient_name, createdBy: p.by, plan: p.plan, auditTrail: [entry],
  }).returning();
  await db.update(worklist).set({ planStatus: 'plan_drafted', planId: row.id, updatedBy: p.by, updatedAt: new Date() })
    .where(and(eq(worklist.encounterId, p.plan.encounter_id), sql`${worklist.planStatus} <> 'plan_approved'`));
  return row;
}

export async function latestPlan(db: AppDb, encounterId: string) {
  const [row] = await db.select().from(transitionPlans).where(eq(transitionPlans.encounterId, encounterId)).orderBy(desc(transitionPlans.createdAt)).limit(1);
  return row ?? null;
}

/** Coordinator approves the plan → the selected tasks are written to outreach_tasks (write-back). */
export async function approvePlan(db: AppDb, p: { id: string; tasks: PlanTask[]; by: string }) {
  const [cur] = await db.select().from(transitionPlans).where(eq(transitionPlans.id, p.id));
  if (!cur) return null;
  const pat = await getPatient(db, cur.encounterId);
  const now = new Date();
  const chosen = p.tasks.filter((t) => t.selected);
  await db.transaction(async (tx) => {
    if (chosen.length) {
      await tx.insert(outreachTasks).values(chosen.map((t) => ({
        encounterId: cur.encounterId, patientName: cur.patientName, unitId: pat?.unitId ?? null, planId: cur.id, taskType: t.task_type,
        title: t.title, detail: t.detail, dueDate: t.due_date, owner: t.owner, createdVia: 'workbench', createdBy: p.by,
      })));
    }
    const entries: AuditEntry[] = [
      { at: now.toISOString(), by: p.by, action: 'approved' },
      { at: now.toISOString(), by: p.by, action: 'tasks_created', notes: `${chosen.length} outreach tasks: ${chosen.map((t) => t.title).join('; ')}` },
    ];
    await tx.update(transitionPlans).set({
      status: 'approved', decidedBy: p.by, decidedAt: now, plan: { ...cur.plan, tasks: p.tasks },
      auditTrail: sql`${transitionPlans.auditTrail} || ${JSON.stringify(entries)}::jsonb`,
    }).where(eq(transitionPlans.id, p.id));
    await tx.update(worklist).set({ planStatus: 'plan_approved', planId: cur.id, updatedBy: p.by, updatedAt: now })
      .where(eq(worklist.encounterId, cur.encounterId));
  });
  const [row] = await db.select().from(transitionPlans).where(eq(transitionPlans.id, p.id));
  return row;
}

/** A single outreach task written by the chat agent (write-back from the copilot). */
export async function createTask(db: AppDb, t: { encounterId: string; taskType: string; title: string; detail: string; dueDate: string; owner: string; by: string }) {
  const pat = await getPatient(db, t.encounterId);
  if (!pat) throw new Error(`No open discharge ${t.encounterId} on the worklist`);
  const [row] = await db.insert(outreachTasks).values({
    encounterId: t.encounterId, patientName: pat.patientName, unitId: pat.unitId, planId: pat.planId, taskType: t.taskType, title: t.title,
    detail: t.detail, dueDate: t.dueDate, owner: t.owner, createdVia: 'copilot', createdBy: t.by,
  }).returning();
  return row;
}

export async function listTasks(db: AppDb, opts: { status?: 'open' | 'done' | null; encounterId?: string | null } = {}) {
  const where = [sql`TRUE`];
  if (opts.status) where.push(eq(outreachTasks.status, opts.status));
  if (opts.encounterId) where.push(eq(outreachTasks.encounterId, opts.encounterId));
  return db.select().from(outreachTasks).where(and(...where)).orderBy(outreachTasks.status, outreachTasks.dueDate, desc(outreachTasks.createdAt)).limit(300);
}

export async function completeTasks(db: AppDb, ids: string[], by: string) {
  if (!ids.length) return [];
  return db.update(outreachTasks).set({ status: 'done', completedAt: new Date(), completedBy: by })
    .where(inArray(outreachTasks.id, ids)).returning();
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT p.id AS plan_id, p.patient_name, p.status, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.transition_plans p, jsonb_array_elements(p.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}
