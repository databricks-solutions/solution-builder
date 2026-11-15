import { desc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  campaigns, floorChanges, opportunities, yieldPlans, type AuditEntry, type FloorRecommendation, type RecoveryPlan,
} from '../schema.js';

/**
 * Yield-desk queries over the Lakebase mirror (campaigns + opportunities) and the write-back
 * tables (yield_plans, floor_changes). Campaigns are ranked by make-good liability.
 */

export async function listCampaigns(db: AppDb, opts: { atRiskOnly?: boolean } = {}) {
  const rows = await db.select().from(campaigns)
    .where(opts.atRiskOnly ? eq(campaigns.atRisk, true) : sql`TRUE`)
    .orderBy(desc(campaigns.makeGoodLiability), desc(campaigns.bookedRevenue));
  return rows.map(({ analysis, agencyNoticeDraft, auditTrail, ...r }) => ({ ...r, hasPlan: !!analysis }));
}

export async function getCampaign(db: AppDb, id: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return c ?? null;
}

/** Id, IO number, advertiser or campaign-name fragment → campaign (falls back to the top at-risk one). */
export async function resolveCampaign(db: AppDb, ref: string) {
  const direct = await getCampaign(db, ref);
  if (direct) return direct;
  const all = await db.select().from(campaigns).orderBy(desc(campaigns.makeGoodLiability));
  const q = ref.toLowerCase();
  const hit = all.find((c) => [c.ioNumber, c.name, c.advertiserName].some((v) => v.toLowerCase().includes(q) || q.includes(v.toLowerCase().split(' ')[0])));
  return hit ?? all.find((c) => c.atRisk) ?? null;
}

export async function listOpportunities(db: AppDb) {
  return db.select().from(opportunities).orderBy(desc(opportunities.revenueGap28d), opportunities.productName);
}

export async function getOpportunity(db: AppDb, productId: string) {
  const [o] = await db.select().from(opportunities).where(eq(opportunities.productId, productId));
  return o ?? null;
}

export async function saveAnalysis(db: AppDb, id: string, plan: RecoveryPlan, notice: string, by: string) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Ad Yield Copilot', action: 'ai_analysis', tool: 'recovery_plan',
    notes: `${plan.reallocations.length} reallocation(s) · ${Math.round(plan.impact.coverage_pct * 100)}% of shortfall covered · requested by ${by}`,
  };
  await db.update(campaigns).set({
    analysis: plan, analyzedAt: new Date(), agencyNoticeDraft: notice || null, updatedAt: new Date(),
    status: sql`CASE WHEN ${campaigns.status} = 'new' THEN 'plan_drafted' ELSE ${campaigns.status} END`,
    auditTrail: sql`${campaigns.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(campaigns.id, id));
}

async function nextId(db: AppDb, table: 'yield_plans' | 'floor_changes', prefix: string, base: number): Promise<string> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM app.${table}`));
  const n = (r.rows[0] as { n: number }).n;
  return `${prefix}-${new Date().getFullYear()}-${String(base + n).padStart(4, '0')}`;
}

async function insertFloorChange(db: AppDb, f: FloorRecommendation, p: { planId: string | null; userEmail: string; via: 'workbench' | 'copilot' | 'yield_board' }) {
  const id = await nextId(db, 'floor_changes', 'FC', 318);
  const [row] = await db.insert(floorChanges).values({
    id, productId: f.product_id, productName: f.product_name, fromGroup: f.from_group, toGroup: f.to_group,
    fromFloor: f.from_floor, toFloor: f.to_floor, releaseFromDeal: f.release_from_deal,
    expectedUplift30d: f.expected_uplift_window, expectedUpliftAnnualized: f.expected_uplift_annualized,
    planId: p.planId, rationale: f.detail, requestedBy: p.userEmail, requestedVia: p.via,
  }).returning();
  await db.update(opportunities).set({ floorChangeId: id }).where(eq(opportunities.productId, f.product_id));
  return row;
}

/** Floor recommendation for a mis-grouped product straight from the yield board (no campaign plan). */
export function floorRecommendationFor(o: typeof opportunities.$inferSelect, windowDays = 30): FloorRecommendation | null {
  if (!o.groupMismatch || !o.recommendedGroup || o.recommendedFloor == null) return null;
  const perDay = (o.pmpImpressions28d ?? 0) / 28;
  const uplift = perDay * windowDays * Math.max(0, (o.openClearing28d ?? 0) * (o.fillRetention ?? 0) - (o.pmpEcpm28d ?? 0)) / 1000;
  return {
    product_id: o.productId, product_name: o.productName, from_group: o.currentGroup ?? '', to_group: o.recommendedGroup,
    from_floor: o.currentFloor ?? 0, to_floor: o.recommendedFloor, release_from_deal: o.currentGroup === 'RON-DEFAULT' ? 'PMP-RON-STREAM' : null,
    expected_uplift_window: Math.round(uplift), expected_uplift_annualized: Math.round((uplift * 365) / windowDays), window_days: windowDays,
    detail: `Restore ${o.recommendedGroup} ($${o.recommendedFloor.toFixed(2)} floor, rate card ${o.rateCardGroup}); ${o.currentRuleId} put it in ${o.currentGroup} on ${o.currentRuleSince}. PMP impressions sell at $${(o.pmpEcpm28d ?? 0).toFixed(2)} vs $${(o.openClearing28d ?? 0).toFixed(2)} open-auction clearing.`,
  };
}

export async function applyFloorChange(db: AppDb, p: { productId: string; userEmail: string; via: 'copilot' | 'yield_board' }) {
  const o = await getOpportunity(db, p.productId);
  if (!o) return { error: `no programmatic product ${p.productId}` } as const;
  if (o.floorChangeId) {
    const [existing] = await db.select().from(floorChanges).where(eq(floorChanges.id, o.floorChangeId));
    if (existing) return { change: existing, existing: true } as const;
  }
  const f = floorRecommendationFor(o);
  if (!f) return { error: `${o.productName} is already priced in its rate-card floor group (${o.currentGroup}); no change recommended.` } as const;
  const change = await insertFloorChange(db, f, { planId: null, userEmail: p.userEmail, via: p.via });
  return { change, existing: false } as const;
}

export type ApprovePlanInput = {
  campaignId: string; notes?: string | null; noticeText?: string | null; userEmail: string; via: 'workbench' | 'copilot';
};

/** The write-back: approve a campaign's recovery plan and send it to ad ops (idempotent per campaign). */
export async function approvePlan(db: AppDb, p: ApprovePlanInput) {
  const c = await getCampaign(db, p.campaignId);
  if (!c) return { error: `campaign ${p.campaignId} not found` } as const;
  if (c.planId) {
    const [existing] = await db.select().from(yieldPlans).where(eq(yieldPlans.id, c.planId));
    if (existing) return { plan: existing, existing: true } as const;
  }
  const a = c.analysis;
  if (!a) return { error: `Campaign ${c.id} has no recovery plan yet — build it first.` } as const;
  const id = await nextId(db, 'yield_plans', 'YP', 207);
  const [row] = await db.insert(yieldPlans).values({
    id, campaignId: c.id, title: a.headline || `Recovery plan — ${c.name}`, advertiserName: c.advertiserName,
    reallocations: a.reallocations, floorChanges: a.floor_changes,
    impressionsMoved: a.impact.impressions_moved, shortfallCovered: a.impact.shortfall_covered,
    liabilityAvoided: a.impact.liability_avoided, displacedRevenue: a.impact.displaced_revenue,
    floorUplift: a.impact.floor_uplift, netImpact: a.impact.net_impact,
    agencyNotice: p.noticeText ?? c.agencyNoticeDraft ?? null, adOpsInstructions: a.ad_ops_instructions,
    approvedBy: p.userEmail, approvedVia: p.via, notes: p.notes ?? null,
  }).returning();
  const changes = [];
  for (const f of a.floor_changes) {
    const o = await getOpportunity(db, f.product_id);
    if (o?.floorChangeId) continue;
    changes.push(await insertFloorChange(db, f, { planId: id, userEmail: p.userEmail, via: p.via === 'copilot' ? 'copilot' : 'workbench' }));
  }
  const entries: AuditEntry[] = [];
  if (p.noticeText != null && c.agencyNoticeDraft != null && p.noticeText !== c.agencyNoticeDraft) {
    entries.push({ at: new Date().toISOString(), by: p.userEmail, action: 'notice_edited', notes: 'Yield manager edited the AI-drafted agency notice.' });
  }
  entries.push({
    at: new Date().toISOString(), by: p.via === 'copilot' ? `Ad Yield Copilot (for ${p.userEmail})` : p.userEmail, action: 'plan_approved',
    notes: `${id} · ${a.reallocations.map((r) => `${(r.impressions / 1e6).toFixed(1)}M → ${r.product_name}`).join(' · ')}${a.floor_changes.length ? ` · floor ${a.floor_changes.map((f) => `${f.product_name} → ${f.to_group}`).join(', ')}` : ''}${p.notes ? ` · ${p.notes}` : ''}`,
  });
  await db.update(campaigns).set({
    status: 'plan_approved', planId: id, updatedAt: new Date(),
    agencyNoticeDraft: p.noticeText ?? c.agencyNoticeDraft,
    auditTrail: sql`${campaigns.auditTrail} || ${JSON.stringify(entries)}::jsonb`,
  }).where(eq(campaigns.id, c.id));
  return { plan: row, floorChanges: changes, existing: false } as const;
}

export async function listPlans(db: AppDb) {
  return db.select().from(yieldPlans).orderBy(desc(yieldPlans.createdAt));
}

export async function getPlan(db: AppDb, id: string) {
  const [p] = await db.select().from(yieldPlans).where(eq(yieldPlans.id, id));
  return p ?? null;
}

export async function listFloorChanges(db: AppDb) {
  return db.select().from(floorChanges).orderBy(desc(floorChanges.createdAt));
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT * FROM (
      SELECT c.id AS campaign_id, c.name AS subject, c.advertiser_name AS party,
             e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
      FROM app.campaigns c, jsonb_array_elements(c.audit_trail) e
      UNION ALL
      SELECT NULL, f.product_name, f.id, to_char(f.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), f.requested_by, 'floor_change',
             f.from_group || ' $' || f.from_floor || ' → ' || f.to_group || ' $' || f.to_floor || COALESCE(' · release ' || f.release_from_deal, '')
      FROM app.floor_changes f WHERE f.plan_id IS NULL
    ) x ORDER BY at DESC LIMIT ${limit}`);
  return r.rows;
}

export async function yieldSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM app.campaigns) AS live_campaigns,
      (SELECT COUNT(*)::int FROM app.campaigns WHERE at_risk) AS at_risk,
      (SELECT COALESCE(SUM(make_good_liability), 0)::float FROM app.campaigns WHERE at_risk) AS make_good_liability,
      (SELECT COALESCE(SUM(projected_shortfall), 0)::float FROM app.campaigns WHERE at_risk) AS shortfall,
      (SELECT COALESCE(SUM(booked_revenue), 0)::float FROM app.campaigns) AS booked_revenue_live,
      (SELECT COUNT(*)::int FROM app.opportunities WHERE is_leak) AS leaks,
      (SELECT COALESCE(SUM(revenue_gap_28d), 0)::float FROM app.opportunities) AS revenue_gap_28d,
      (SELECT COALESCE(SUM(revenue_gap_annualized), 0)::float FROM app.opportunities) AS revenue_gap_annualized,
      (SELECT COUNT(*)::int FROM app.yield_plans) AS plans,
      (SELECT COUNT(*)::int FROM app.floor_changes) AS floor_changes`);
  return r.rows[0];
}

export { desc };
