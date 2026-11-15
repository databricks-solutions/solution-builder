/**
 * Live-ops console domain queries + the PLAN ENGINE.
 *
 * The plan engine is deterministic code, NOT a prompt: the agent proposes, this
 * file disposes. For a segment it prices every intervention in the catalog:
 *   coverage      targeted → this segment · region → this segment · global → every segment
 *                 with the same churn driver (GEM-SALE-50: every at-risk segment)
 *   cost          fixed_cost + cost_per_player x players targeted
 *   lift          holdout-measured retention lift from liveops_history (percentage points)
 *   LTV retained  lift x the covered players' predicted 12-month LTV (churn probability drops
 *                 by `lift`, so the expected loss drops by lift x LTV), capped at at-risk LTV
 *   allowed       targets this driver AND cost <= remaining live-ops budget AND (ROI >= 1 OR it is
 *                 player-safety spend — safety interventions are exempt from the ROI floor)
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { budget, interventions, segments, type AuditEntry, type StagedPlan } from '../schema.js';

export type SegmentRow = typeof segments.$inferSelect;
export type InterventionRow = typeof interventions.$inferSelect;

export async function listSegments(
  db: AppDb,
  f: { driver?: string | null; region?: string | null; status?: string | null; limit?: number },
): Promise<SegmentRow[]> {
  const conds = [];
  if (f.driver) conds.push(eq(segments.churnDriver, f.driver));
  if (f.region) conds.push(eq(segments.region, f.region));
  if (f.status) conds.push(inArray(segments.status, f.status.split(',') as SegmentRow['status'][]));
  return db
    .select()
    .from(segments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(segments.atRiskLtv))
    .limit(f.limit ?? 100);
}

export async function getSegment(db: AppDb, id: string): Promise<SegmentRow | null> {
  const rows = await db.select().from(segments).where(eq(segments.segmentId, id)).limit(1);
  return rows[0] ?? null;
}

export async function listInterventions(db: AppDb): Promise<InterventionRow[]> {
  return db.select().from(interventions);
}

/** Budget for the planning month minus every scheduled plan's cost (counted once per plan). */
export async function budgetStatus(db: AppDb) {
  const b = (await db.select().from(budget).limit(1))[0];
  const r = await db.execute(sql`
    SELECT coalesce(sum(cost), 0)::float AS committed, count(*)::int AS plans FROM (
      SELECT DISTINCT ON (staged_plan->>'stagedAt') (staged_plan->>'cost')::float AS cost
      FROM app.segments WHERE status = 'scheduled' AND staged_plan IS NOT NULL) x`);
  const committed = Number((r.rows[0] as { committed: number }).committed ?? 0);
  const total = b?.budgetUsd ?? 0;
  return {
    month: b?.month ?? '',
    description: b?.description ?? 'Live-ops budget',
    budget: total,
    committed,
    remaining: Math.max(0, total - committed),
    plansScheduled: Number((r.rows[0] as { plans: number }).plans ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Plan engine
// ---------------------------------------------------------------------------
export type InterventionEvaluation = {
  intervention_code: string;
  intervention_name: string;
  description: string;
  target_driver: string;
  kind: string;
  scope: string;
  covered_segments: string[];
  players_targeted: number;
  cost: number;
  expected_lift_pp: number;
  expected_players_retained: number;
  expected_ltv_retained: number;
  roi: number;
  lead_time_days: number;
  historical_runs: number;
  budget_remaining: number;
  within_budget: boolean;
  matches_driver: boolean;
  reason: string;
  allowed: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateInterventions(
  seg: SegmentRow,
  catalog: InterventionRow[],
  all: SegmentRow[],
  budgetRemaining: number,
): InterventionEvaluation[] {
  const evals = catalog.map((iv) => {
    const matches = iv.targetDriver === seg.churnDriver || iv.targetDriver === 'any';
    const cohort =
      iv.scope === 'global'
        ? all.filter((s) => iv.targetDriver === 'any' || s.churnDriver === iv.targetDriver)
        : [seg];
    const payersOnly = iv.code === 'TGT-OFFER';
    const players = cohort.reduce((a, s) => a + (payersOnly ? s.payersAtRisk : s.playersAtRisk), 0);
    const ltvBook = cohort.reduce((a, s) => a + (payersOnly ? s.ltvBook * 0.9 : s.ltvBook), 0);
    const atRisk = cohort.reduce((a, s) => a + s.atRiskLtv, 0);
    const cost = round2(iv.fixedCost + iv.costPerPlayer * players);
    const lift = iv.history.liftPp / 100;
    const ltvRetained = round2(Math.min(atRisk, lift * ltvBook));
    const roi = cost > 0 ? Math.round((ltvRetained / cost) * 100) / 100 : 0;
    const withinBudget = cost <= budgetRemaining;
    let reason = '';
    if (!matches) reason = `targets ${iv.targetDriver}, not ${seg.churnDriver}`;
    else if (!withinBudget) reason = `costs $${Math.round(cost).toLocaleString('en-US')} — over the $${Math.round(budgetRemaining).toLocaleString('en-US')} budget left`;
    else if (roi < 1 && iv.kind !== 'safety') reason = `ROI ${roi.toFixed(2)}x < 1 — retains less LTV than it costs`;
    else if (roi < 1) reason = `player-safety spend — exempt from the ROI floor (ROI ${roi.toFixed(2)}x)`;
    else reason = iv.scope === 'global' ? `covers ${cohort.length} segments (${cohort.map((s) => s.region).join(', ')})` : 'targets this segment';
    return {
      intervention_code: iv.code,
      intervention_name: iv.name,
      description: iv.description,
      target_driver: iv.targetDriver,
      kind: iv.kind,
      scope: iv.scope,
      covered_segments: cohort.map((s) => s.segmentId),
      players_targeted: players,
      cost,
      expected_lift_pp: iv.history.liftPp,
      expected_players_retained: Math.round(players * lift),
      expected_ltv_retained: ltvRetained,
      roi,
      lead_time_days: iv.leadTimeDays,
      historical_runs: iv.history.runs,
      budget_remaining: round2(budgetRemaining),
      within_budget: withinBudget,
      matches_driver: matches,
      reason,
      allowed: matches && withinBudget && (roi >= 1 || iv.kind === 'safety'),
    };
  });
  return evals.sort(
    (a, b) =>
      Number(b.allowed) - Number(a.allowed) ||
      Number(b.matches_driver) - Number(a.matches_driver) ||
      b.expected_ltv_retained - b.cost - (a.expected_ltv_retained - a.cost),
  );
}

export async function evaluateSegment(db: AppDb, id: string) {
  const seg = await getSegment(db, id);
  if (!seg) return null;
  const [catalog, all, b] = await Promise.all([listInterventions(db), listSegments(db, { limit: 500 }), budgetStatus(db)]);
  return { segment: seg, budget: b, interventions: evaluateInterventions(seg, catalog, all, b.remaining) };
}

export async function stagePlan(
  db: AppDb,
  args: {
    segmentId: string;
    interventionCode: string;
    startDate: string;
    playerMessage: string;
    rationale: string;
    userEmail: string;
  },
): Promise<{ ok: true; staged: StagedPlan } | { ok: false; error: string }> {
  const ev = await evaluateSegment(db, args.segmentId);
  if (!ev) return { ok: false, error: `No segment ${args.segmentId}` };
  if (ev.segment.status === 'scheduled') return { ok: false, error: `Segment already has a scheduled intervention (${ev.segment.stagedPlan?.interventionCode})` };
  const e = ev.interventions.find((x) => x.intervention_code === args.interventionCode);
  if (!e) return { ok: false, error: `Unknown intervention ${args.interventionCode}` };
  if (!e.allowed) return { ok: false, error: `PLAN ENGINE: ${e.intervention_code} not allowed — ${e.reason}` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate)) return { ok: false, error: 'start_date must be YYYY-MM-DD' };
  const earliest = new Date(Date.UTC(2026, 8, 28) + e.lead_time_days * 86400000).toISOString().slice(0, 10);
  const startDate = args.startDate < earliest ? earliest : args.startDate;
  const staged: StagedPlan = {
    interventionCode: e.intervention_code,
    interventionName: e.intervention_name,
    scope: e.scope,
    coveredSegments: e.covered_segments,
    playersTargeted: e.players_targeted,
    cost: e.cost,
    expectedLift: e.expected_lift_pp,
    expectedPlayersRetained: e.expected_players_retained,
    expectedLtvRetained: e.expected_ltv_retained,
    roi: e.roi,
    budgetRemainingAfter: round2(ev.budget.remaining - e.cost),
    startDate,
    playerMessage: args.playerMessage,
    rationale: args.rationale,
    stagedBy: 'Live-ops copilot',
    stagedAt: new Date().toISOString(),
  };
  const audit: AuditEntry = {
    at: staged.stagedAt,
    by: `agent (for ${args.userEmail})`,
    action: 'plan_staged',
    tool: 'stage_plan',
    notes: `${e.intervention_code} · $${Math.round(e.cost).toLocaleString('en-US')} · +${e.expected_lift_pp}pp · ${e.roi}x ROI · starts ${startDate}`,
  };
  await db
    .update(segments)
    .set({
      status: 'plan_ready',
      stagedPlan: staged,
      auditTrail: sql`${segments.auditTrail} || ${JSON.stringify([audit])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(segments.segmentId, args.segmentId));
  return { ok: true, staged };
}

/** Human decision on a staged plan. Scheduling re-checks the budget and marks every covered segment. */
export async function decidePlan(
  db: AppDb,
  args: { segmentId: string; decision: 'scheduled' | 'rejected'; userEmail: string },
): Promise<{ segment: SegmentRow; plan: StagedPlan }> {
  const seg = await getSegment(db, args.segmentId);
  if (!seg) throw new Error(`No segment ${args.segmentId}`);
  if (!seg.stagedPlan || seg.status !== 'plan_ready') throw new Error('No plan staged on this segment — ask the copilot for a plan first.');
  const plan = seg.stagedPlan;
  const now = new Date();
  if (args.decision === 'scheduled') {
    const b = await budgetStatus(db);
    if (plan.cost > b.remaining) throw new Error(`Budget: $${Math.round(plan.cost)} exceeds the $${Math.round(b.remaining)} left this month.`);
    const audit: AuditEntry = {
      at: now.toISOString(),
      by: args.userEmail,
      action: 'scheduled',
      notes: `${plan.interventionCode} scheduled for ${plan.startDate}${plan.coveredSegments.length > 1 ? ` (covers ${plan.coveredSegments.join(', ')})` : ''}`,
    };
    await db
      .update(segments)
      .set({
        status: 'scheduled',
        stagedPlan: plan,
        scheduledAt: now,
        scheduledBy: args.userEmail,
        auditTrail: sql`${segments.auditTrail} || ${JSON.stringify([audit])}::jsonb`,
        updatedAt: now,
      })
      .where(and(inArray(segments.segmentId, plan.coveredSegments), sql`${segments.status} <> 'scheduled'`));
  } else {
    const audit: AuditEntry = { at: now.toISOString(), by: args.userEmail, action: 'rejected', notes: `${plan.interventionCode} sent back` };
    await db
      .update(segments)
      .set({
        status: 'rejected',
        auditTrail: sql`${segments.auditTrail} || ${JSON.stringify([audit])}::jsonb`,
        updatedAt: now,
      })
      .where(eq(segments.segmentId, args.segmentId));
  }
  return { segment: (await getSegment(db, args.segmentId))!, plan };
}

/** Console KPIs from the Lakebase mirror (live: reflects every scheduled plan). */
export async function consoleKpis(db: AppDb) {
  const r = await db.execute(sql`
    SELECT
      coalesce(sum(players_at_risk), 0)::int      AS players_at_risk,
      coalesce(sum(critical_players), 0)::int     AS critical_players,
      coalesce(sum(at_risk_ltv), 0)::float        AS at_risk_ltv,
      coalesce(sum(whales_at_risk), 0)::int       AS whales_at_risk,
      count(*) FILTER (WHERE status = 'plan_ready')::int AS plans_ready,
      count(*) FILTER (WHERE status = 'scheduled')::int  AS segments_scheduled,
      coalesce(sum(at_risk_ltv) FILTER (WHERE status = 'scheduled'), 0)::float AS at_risk_ltv_covered,
      coalesce(sum((staged_plan->>'expectedLtvRetained')::float) FILTER (WHERE status = 'scheduled'
        AND segment_id = staged_plan->'coveredSegments'->>0), 0)::float AS ltv_retained_expected
    FROM app.segments`);
  const d = await db.execute(sql`
    SELECT churn_driver, sum(players_at_risk)::int AS players, sum(at_risk_ltv)::float AS at_risk,
           sum(whales_at_risk)::int AS whales, count(*)::int AS segments
    FROM app.segments GROUP BY 1 ORDER BY 3 DESC`);
  return { ...(r.rows[0] as Record<string, number>), drivers: d.rows, budget: await budgetStatus(db) };
}

/** Budget what-if: the copilot's best driver-matched plan per segment, picked greedily by net value (LTV kept − cost)
 *  within the budget, vs the legacy blanket gem sale. */
export async function whatIf(db: AppDb, p: { budget: number }) {
  const [catalog, all] = await Promise.all([listInterventions(db), listSegments(db, { limit: 500 })]);
  type Cand = InterventionEvaluation & { key: string };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  for (const s of all) {
    for (const e of evaluateInterventions(s, catalog, all, Number.POSITIVE_INFINITY)) {
      if (!e.matches_driver || e.target_driver === 'any' || (e.roi < 1 && e.kind !== 'safety')) continue;
      const key = `${e.intervention_code}:${e.covered_segments.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ ...e, key });
    }
  }
  cands.sort((a, b) => b.expected_ltv_retained - b.cost - (a.expected_ltv_retained - a.cost));
  let spend = 0, ltv = 0, players = 0;
  const covered = new Set<string>();
  const picked: Array<{ code: string; segments: string; cost: number; ltv: number }> = [];
  for (const c of cands) {
    if (c.covered_segments.some((x) => covered.has(x))) continue;
    if (spend + c.cost > p.budget) continue;
    spend += c.cost;
    ltv += c.expected_ltv_retained;
    players += c.expected_players_retained;
    c.covered_segments.forEach((x) => covered.add(x));
    picked.push({ code: c.intervention_code, segments: c.covered_segments.join(', '), cost: c.cost, ltv: c.expected_ltv_retained });
  }
  const sale = all.length ? evaluateInterventions(all[0], catalog, all, Number.POSITIVE_INFINITY).find((e) => e.intervention_code === 'GEM-SALE-50') : undefined;
  const totalAtRisk = all.reduce((a, s) => a + s.atRiskLtv, 0);
  return {
    budget: p.budget,
    at_risk_ltv: Math.round(totalAtRisk),
    copilot: {
      spend: Math.round(spend), ltv_retained: Math.round(ltv), players_retained: players,
      roi: spend ? Math.round((ltv / spend) * 100) / 100 : 0, segments_covered: covered.size, plan: picked,
    },
    blanket: sale
      ? {
          spend: Math.round(sale.cost), ltv_retained: Math.round(sale.expected_ltv_retained), players_retained: sale.expected_players_retained,
          roi: sale.roi, affordable: sale.cost <= p.budget, segments_covered: sale.covered_segments.length,
        }
      : null,
  };
}
