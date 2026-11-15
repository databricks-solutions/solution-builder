import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { rescuePlans, siteOps, type AuditEntry, type RescueAnalysis } from '../schema.js';

/**
 * Clinical-ops write surface (Lakebase): the site network with the study
 * manager's actions, and the enrollment-rescue plans with their decisions.
 */

export type SiteView = 'active' | 'candidates' | 'actions' | 'all';

export async function listSites(db: AppDb, view: SiteView = 'all') {
  const where =
    view === 'active' ? sql`${siteOps.cascadeStatus} IN ('active','activating','not_activated')`
      : view === 'candidates' ? sql`${siteOps.cascadeStatus} = 'candidate'`
        : view === 'actions' ? sql`${siteOps.opsStatus} <> 'none'`
          : sql`TRUE`;
  return db.select().from(siteOps).where(where).orderBy(
    sql`CASE WHEN ${siteOps.cascadeStatus} = 'candidate' THEN coalesce((${siteOps.metrics}->>'rescue_rank')::float, 999) ELSE -coalesce((${siteOps.metrics}->>'randomized')::float, 0) END`,
  );
}

export async function getSite(db: AppDb, id: string) {
  const [s] = await db.select().from(siteOps).where(eq(siteOps.siteId, id));
  return s ?? null;
}

export async function opsSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE cascade_status = 'active')::int AS active_sites,
           COUNT(*) FILTER (WHERE cascade_status = 'active' AND (metrics->>'is_zero_enroller')::boolean)::int AS zero_enrollers,
           COUNT(*) FILTER (WHERE cascade_status = 'candidate' AND (metrics->>'rescue_eligible')::boolean)::int AS rescue_candidates,
           COUNT(*) FILTER (WHERE ops_status = 'activation_requested')::int AS activation_requested,
           COUNT(*) FILTER (WHERE ops_status = 'closure_review')::int AS closure_review
    FROM app.site_ops`);
  const p = await db.execute(sql`
    SELECT COUNT(*)::int AS plans, COUNT(*) FILTER (WHERE status = 'approved')::int AS approved, MAX(decided_at) AS last_decided_at
    FROM app.rescue_plans`);
  return { ...(r.rows[0] as Record<string, number>), ...(p.rows[0] as Record<string, unknown>) };
}

export async function savePlan(db: AppDb, p: { trialId: string; analysis: RescueAnalysis; memo: string; by: string }) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Trial Site Copilot', action: 'ai_analysis', tool: 'enrollment_rescue_analysis',
    notes: `Recommended amending E4 + ${p.analysis.rescue_sites.filter((s) => s.selected).length} rescue sites · requested by ${p.by}`,
  };
  const [row] = await db.insert(rescuePlans).values({
    trialId: p.trialId, createdBy: p.by, analysis: p.analysis, memo: p.memo || null,
    selectedSiteIds: p.analysis.rescue_sites.filter((s) => s.selected).map((s) => s.site_id),
    closureSiteIds: p.analysis.zero_enrollers.map((z) => z.site_id), auditTrail: [entry],
  }).returning();
  return row;
}

export async function latestPlan(db: AppDb, trialId: string) {
  const [row] = await db.select().from(rescuePlans).where(eq(rescuePlans.trialId, trialId)).orderBy(desc(rescuePlans.createdAt)).limit(1);
  return row ?? null;
}

export type PlanDecision = 'APPROVED' | 'REJECTED';

export async function decidePlan(
  db: AppDb,
  p: { id: string; decision: PlanDecision; notes?: string | null; memo?: string | null; selectedSiteIds: string[]; closureSiteIds: string[]; by: string },
) {
  const [cur] = await db.select().from(rescuePlans).where(eq(rescuePlans.id, p.id));
  if (!cur) return null;
  const now = new Date();
  const entries: AuditEntry[] = [];
  if (p.memo != null && p.memo !== (cur.memo ?? '')) entries.push({ at: now.toISOString(), by: p.by, action: 'memo_edited', notes: 'Study manager edited the AI-drafted memo.' });
  entries.push({ at: now.toISOString(), by: p.by, action: p.decision === 'APPROVED' ? 'approved' : 'rejected', notes: p.notes ?? undefined });
  await db.transaction(async (tx) => {
    if (p.decision === 'APPROVED') {
      if (p.selectedSiteIds.length) {
        await tx.update(siteOps).set({ opsStatus: 'activation_requested', opsNote: 'Rescue site — start-up on protocol v4.0', planId: p.id, updatedBy: p.by, updatedAt: now })
          .where(and(inArray(siteOps.siteId, p.selectedSiteIds), eq(siteOps.cascadeStatus, 'candidate')));
        entries.push({ at: now.toISOString(), by: p.by, action: 'activation_requested', notes: `${p.selectedSiteIds.length} rescue sites sent to site start-up` });
      }
      if (p.closureSiteIds.length) {
        await tx.update(siteOps).set({ opsStatus: 'closure_review', opsNote: 'Zero randomized after ≥ 6 months active (SOP CLINOPS-014 §2d)', planId: p.id, updatedBy: p.by, updatedAt: now })
          .where(inArray(siteOps.siteId, p.closureSiteIds));
        entries.push({ at: now.toISOString(), by: p.by, action: 'closure_review', notes: `${p.closureSiteIds.length} non-enrolling sites put under closure review` });
      }
    }
    await tx.update(rescuePlans).set({
      status: p.decision === 'APPROVED' ? 'approved' : 'rejected', memo: p.memo ?? cur.memo, decidedBy: p.by, decidedAt: now,
      decisionNotes: p.notes ?? null, selectedSiteIds: p.selectedSiteIds, closureSiteIds: p.closureSiteIds,
      auditTrail: sql`${rescuePlans.auditTrail} || ${JSON.stringify(entries)}::jsonb`,
    }).where(eq(rescuePlans.id, p.id));
  });
  const [row] = await db.select().from(rescuePlans).where(eq(rescuePlans.id, p.id));
  return row;
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT p.id AS plan_id, p.trial_id, p.status, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.rescue_plans p, jsonb_array_elements(p.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

export async function planStatusForAgent(db: AppDb, trialId: string) {
  const plan = await latestPlan(db, trialId);
  const actions = await db.select({ siteId: siteOps.siteId, siteName: siteOps.siteName, city: siteOps.city, opsStatus: siteOps.opsStatus })
    .from(siteOps).where(sql`${siteOps.opsStatus} <> 'none'`);
  return {
    latest_plan: plan ? { id: plan.id, status: plan.status, created_at: plan.createdAt, decided_by: plan.decidedBy, decided_at: plan.decidedAt, selected_sites: plan.selectedSiteIds.length, closure_review_sites: plan.closureSiteIds.length } : null,
    site_actions: actions,
  };
}
