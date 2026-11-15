import { and, asc, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { planDecisions, planEvents, planScenarios, promoEvents } from '../schema.js';

/**
 * Crestwood trade-promotion queries over the Lakebase mirror.
 *   - the next-quarter draft calendar (plan_events) + its re-plan scenarios
 *   - completed promotions with their post-event analysis (promo_events)
 *   - the write-back: applyReplan() swaps a planned event's tactic in ONE transaction
 *     and logs the before/after decision (plan_decisions), revertDecision() undoes it.
 */

export type PlanEvent = typeof planEvents.$inferSelect;
export type PlanScenario = typeof planScenarios.$inferSelect;
export type PromoEvent = typeof promoEvents.$inferSelect;
export type PlanDecision = typeof planDecisions.$inferSelect;

export async function listPlan(db: AppDb): Promise<PlanEvent[]> {
  return db.select().from(planEvents).orderBy(asc(planEvents.planWeek), asc(planEvents.retailerId));
}

export async function getPlanEvent(db: AppDb, id: string) {
  const [ev] = await db.select().from(planEvents).where(eq(planEvents.id, id));
  if (!ev) return null;
  const scenarios = await db.select().from(planScenarios).where(eq(planScenarios.planEventId, id))
    .orderBy(desc(planScenarios.netProfit));
  const decisions = await db.select().from(planDecisions).where(eq(planDecisions.planEventId, id))
    .orderBy(desc(planDecisions.createdAt));
  return { ...ev, scenarios, decisions };
}

export async function listScenarios(db: AppDb, planEventId: string): Promise<PlanScenario[]> {
  return db.select().from(planScenarios).where(eq(planScenarios.planEventId, planEventId)).orderBy(desc(planScenarios.netProfit));
}

/** Completed promotions (without the weekly curve), optional retailer/tactic filters. */
export async function listPromoEvents(db: AppDb, f: { retailer?: string | null; tactic?: string | null } = {}) {
  const conds = [];
  if (f.retailer) conds.push(sql`(${promoEvents.retailerId} = ${f.retailer} OR ${promoEvents.retailerName} ILIKE ${'%' + f.retailer + '%'})`);
  if (f.tactic) conds.push(sql`${promoEvents.tactic} ILIKE ${f.tactic}`);
  const { curve: _curve, ...cols } = getTableColumns(promoEvents);
  void _curve;
  return db.select(cols).from(promoEvents).where(conds.length ? and(...conds) : undefined).orderBy(desc(promoEvents.startWeek));
}

export async function getPromoEvent(db: AppDb, id: string): Promise<PromoEvent | null> {
  const [ev] = await db.select().from(promoEvents).where(eq(promoEvents.id, id));
  return ev ?? null;
}

/** Aggregated post-event analysis for a retailer x tactic (ratio of sums, TPG-2027 §3.1). */
export async function postEventSummary(db: AppDb, f: { retailer?: string | null; tactic?: string | null; sku?: string | null }) {
  const conds = [];
  if (f.retailer) conds.push(sql`(retailer_id = ${f.retailer} OR retailer_name ILIKE ${'%' + f.retailer + '%'})`);
  if (f.tactic) conds.push(sql`tactic ILIKE ${f.tactic}`);
  if (f.sku) conds.push(sql`(sku = ${f.sku} OR product_name ILIKE ${'%' + f.sku + '%'})`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const r = await db.execute(sql`
    SELECT retailer_name, tactic, funding_method, COUNT(*)::int AS events,
      ROUND(SUM(baseline_units))::bigint AS baseline_units, ROUND(SUM(actual_units))::bigint AS actual_units,
      ROUND(SUM(gross_incremental_units))::bigint AS gross_incremental_units,
      ROUND((100 * SUM(gross_incremental_units) / NULLIF(SUM(baseline_units), 0))::numeric, 1)::float AS volume_lift_pct,
      ROUND(SUM(dip_units))::bigint AS pantry_loading_dip_units,
      ROUND((100 * SUM(dip_units) / NULLIF(SUM(gross_incremental_units), 0))::numeric, 1)::float AS pantry_loading_pct_of_lift,
      ROUND(SUM(cannibalized_units))::bigint AS cannibalized_units,
      ROUND((100 * SUM(cannibalized_units) / NULLIF(SUM(gross_incremental_units), 0))::numeric, 1)::float AS cannibalization_pct_of_lift,
      ROUND(SUM(forward_buy_units))::bigint AS forward_buy_units,
      ROUND((100 * SUM(forward_buy_units) / NULLIF(SUM(actual_units), 0))::numeric, 1)::float AS forward_buy_pct_of_event_volume,
      ROUND(SUM(net_incremental_units))::bigint AS net_incremental_units,
      ROUND(SUM(trade_spend))::bigint AS trade_spend_usd, ROUND(SUM(subsidised_baseline))::bigint AS subsidised_baseline_usd,
      ROUND(SUM(forward_buy_cost))::bigint AS forward_buy_cost_usd,
      ROUND(SUM(incremental_gp))::bigint AS incremental_gross_profit_usd, ROUND(SUM(net_profit))::bigint AS net_profit_usd,
      ROUND((100 * SUM(net_profit) / NULLIF(SUM(trade_spend), 0))::numeric, 1)::float AS roi_pct,
      COUNT(*) FILTER (WHERE net_profit < 0)::int AS events_lost_money
    FROM app.promo_events ${where}
    GROUP BY retailer_name, tactic, funding_method ORDER BY SUM(trade_spend) DESC`);
  return r.rows;
}

export async function listDecisions(db: AppDb): Promise<PlanDecision[]> {
  return db.select().from(planDecisions).orderBy(desc(planDecisions.createdAt));
}

const flagFor = (netProfit: number | null, roi: number | null) =>
  (netProfit ?? 0) < 0 ? 'Money-losing' : (roi ?? 0) < 0.15 ? 'Below target' : 'On track';

/**
 * WRITE-BACK. Re-plan one event onto a scenario, in one transaction:
 *   plan_events row takes the scenario's tactic / depth / funding / forecast, status = 'replanned'
 *   plan_decisions gets the before/after record (TPG-2027 §5.3).
 */
export async function applyReplan(
  db: AppDb,
  p: { planEventId: string; scenarioKey?: string | null; rationale?: string | null; userEmail: string; via: 'copilot' | 'planner' },
): Promise<{ decision: PlanDecision; event: PlanEvent } | { error: string }> {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(planEvents).where(eq(planEvents.id, p.planEventId)).for('update');
    if (!ev) return { error: `No planned event ${p.planEventId}` };
    const key = p.scenarioKey || ev.recommendedScenarioKey;
    if (!key) return { error: `No recommended scenario for ${ev.id}` };
    if (key === ev.scenarioKey) return { error: `${ev.id} already runs scenario "${key}"` };
    const [sc] = await tx.select().from(planScenarios)
      .where(and(eq(planScenarios.planEventId, ev.id), eq(planScenarios.scenarioKey, key)));
    if (!sc) return { error: `Scenario "${key}" does not exist for ${ev.id}` };
    const [cur] = await tx.select().from(planScenarios)
      .where(and(eq(planScenarios.planEventId, ev.id), eq(planScenarios.scenarioKey, ev.scenarioKey)));
    const n = await tx.execute(sql`SELECT COUNT(*)::int AS n FROM app.plan_decisions`);
    const id = `RP-${String(3001 + ((n.rows[0] as { n: number }).n ?? 0))}`;
    const toLabel = sc.label.replace(/^As planned: /, '');
    const fromLabel = (cur?.label ?? ev.tactic).replace(/^As planned: /, '');
    const weeksNotice = Math.floor((new Date(ev.startWeek).getTime() - Date.now()) / (7 * 86400e3));
    const notice = `Notify ${ev.retailerName} buyer: ${ev.productName}, week of ${ev.startWeek} — change ${fromLabel} → ${toLabel}` +
      (sc.promoPrice ? ` (promo price $${sc.promoPrice.toFixed(2)})` : '') + `; ${weeksNotice} ${weeksNotice === 1 ? 'week' : 'weeks'} before start.`;
    const [decision] = await tx.insert(planDecisions).values({
      id, planEventId: ev.id, retailerName: ev.retailerName, productName: ev.productName, startWeek: ev.startWeek,
      fromLabel, toLabel, toScenarioKey: sc.scenarioKey,
      fromNetProfit: ev.netProfit, toNetProfit: sc.netProfit, fromRoi: ev.roi, toRoi: sc.roi,
      fromTradeSpend: ev.tradeSpend, toTradeSpend: sc.tradeSpend, fromVolume: ev.volumeKept, toVolume: sc.volumeKept,
      rationale: p.rationale ?? null, approvedBy: p.userEmail, via: p.via, retailerNotice: notice,
    }).returning();
    const [event] = await tx.update(planEvents).set({
      scenarioKey: sc.scenarioKey, tactic: sc.tactic, discountDepth: sc.discountDepth, fundingMethod: sc.fundingMethod,
      featureAd: sc.featureAd, inStoreDisplay: sc.inStoreDisplay, promoPrice: sc.promoPrice,
      forecastUnits: sc.forecastUnits, netIncrementalUnits: sc.netIncrementalUnits, volumeKept: sc.volumeKept,
      tradeSpend: sc.tradeSpend, incrementalGp: sc.incrementalGp, netProfit: sc.netProfit, roi: sc.roi,
      forecastFlag: flagFor(sc.netProfit, sc.roi), status: sc.isAsPlanned ? 'draft' : 'replanned', decisionId: id,
      updatedAt: new Date(),
    }).where(eq(planEvents.id, ev.id)).returning();
    return { decision, event };
  });
}

/** Undo a re-plan: put the event back on its original draft tactic. */
export async function revertEvent(db: AppDb, planEventId: string, userEmail: string) {
  return applyReplan(db, { planEventId, scenarioKey: 'as_planned', rationale: 'Reverted to the original draft', userEmail, via: 'planner' });
}
