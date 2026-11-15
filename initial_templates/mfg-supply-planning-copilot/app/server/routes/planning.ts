import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { bookPlan, markDeltaWritten, planStatusByExposure, plansFor, recentPlanEvents, saveProposal } from '../db/queries/index.js';
import { execSql, type DataConfig } from '../db/sync.js';
import type { PlanAction, PlanTotals } from '../db/schema.js';
import { exposureDetail, getExposure, loadPlanningData, overview, simulate, type ActionInput, type SimResult } from '../services/planner.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * Supply-planning workbench routes.
 *   GET  /api/overview                 control-tower KPIs, exposures (+ plan status), E&O, fill-rate trend, signals
 *   GET  /api/exposures/:id            projection, inbound POs, orders at risk, signals, priced mitigation options, plans
 *   POST /api/exposures/:id/simulate   {actions:[{option_id, qty}]} → re-projected balance + cost / revenue protected
 *   POST /api/exposures/:id/propose    save a proposed plan (the copilot uses the same code path)
 *   POST /api/exposures/:id/book       book the plan: Lakebase (plan + audit) + write-back to Delta sop_plan_decisions
 *   GET  /api/plan-events              recent plan activity (home page)
 *   GET  /api/inventory                inventory health (E&O, days of supply) + demand actual vs AI_FORECAST
 */

export function toPlan(sim: SimResult, baseline: SimResult, docs?: string[]): { actions: PlanAction[]; totals: PlanTotals } {
  return {
    actions: sim.actions.map((a, i) => ({ optionId: a.option_id, type: a.type, title: a.title, qty: a.qty, cost: a.cost, arrivalDate: a.arrival_date, documentNumber: docs?.[i] })),
    totals: {
      planCost: sim.plan_cost, annualCarryingCost: sim.annual_carrying_cost, unitsShortBefore: baseline.units_short,
      unitsShortAfter: sim.units_short, revenueAtRiskBefore: baseline.revenue_at_risk, revenueAtRiskAfter: sim.revenue_at_risk,
      revenueProtected: sim.revenue_protected, weeksBelowSafetyStock: sim.weeks_below_safety_stock, eoReleased: sim.eo_released,
      approver: sim.approver,
    },
  };
}

const DOC_PREFIX: Record<PlanAction['type'], string> = { transfer: 'TO', alternate: 'PO', expedite: 'EXR', safety_stock: 'SSC' };
const docNumber = (type: PlanAction['type']) => `${DOC_PREFIX[type]}-${type === 'alternate' ? 9 : 7}${Math.floor(10000 + Math.random() * 89999)}`;
const esc = (v: string | null | undefined) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

export function registerPlanningRoutes(app: Application, deps: { db: AppDb; data: DataConfig | undefined }): void {
  const { db } = deps;
  const data = () => loadPlanningData(deps.data);
  const parseActions = (b: unknown): ActionInput[] => {
    const arr = (b as { actions?: unknown })?.actions;
    return Array.isArray(arr) ? arr.filter((a) => a && typeof a.option_id === 'string').map((a) => ({ option_id: a.option_id, qty: a.qty == null ? null : Number(a.qty) })) : [];
  };

  app.get('/api/overview', async (_req, res) => {
    const d = await data();
    const status = await planStatusByExposure(db);
    const o = overview(d);
    res.json({ ...o, exposures: o.exposures.map((e) => ({ ...e, plan: status[e.exposure_id] ?? null })) });
  });

  app.get('/api/exposures/:id', async (req, res) => {
    const d = await data();
    const e = getExposure(d, req.params.id);
    if (!e) { res.status(404).json({ error: 'exposure not found' }); return; }
    res.json({ ...exposureDetail(d, e), plans: await plansFor(db, e.exposure_id) });
  });

  app.post('/api/exposures/:id/simulate', express.json(), async (req, res) => {
    const d = await data();
    const e = getExposure(d, req.params.id);
    if (!e) { res.status(404).json({ error: 'exposure not found' }); return; }
    try { res.json(simulate(d, e, parseActions(req.body))); } catch (err) { res.status(400).json({ error: (err as Error).message }); }
  });

  app.post('/api/exposures/:id/propose', express.json(), async (req, res) => {
    const d = await data();
    const e = getExposure(d, req.params.id);
    if (!e) { res.status(404).json({ error: 'exposure not found' }); return; }
    const actions = parseActions(req.body);
    if (!actions.length) { res.status(400).json({ error: 'at least one action required' }); return; }
    const sim = simulate(d, e, actions);
    const { actions: acts, totals } = toPlan(sim, simulate(d, e, []));
    res.json(await saveProposal(db, { exposureId: e.exposure_id, actions: acts, totals, rationale: (req.body?.rationale as string) ?? null, by: getCurrentUserEmail(req) }));
  });

  app.post('/api/exposures/:id/book', express.json(), async (req, res) => {
    const d = await data();
    const e = getExposure(d, req.params.id);
    if (!e) { res.status(404).json({ error: 'exposure not found' }); return; }
    const existing = await plansFor(db, e.exposure_id);
    if (existing.booked) { res.status(409).json({ error: `a plan is already booked for ${e.exposure_id} (${existing.booked.id}) — use Reset demo to start over` }); return; }
    const actions = parseActions(req.body);
    if (!actions.length) { res.status(400).json({ error: 'select at least one mitigation' }); return; }
    const sim = simulate(d, e, actions);
    const docs = sim.actions.map((a) => docNumber(a.type));
    const { actions: acts, totals } = toPlan(sim, simulate(d, e, []), docs);
    const user = getCurrentUserEmail(req);
    const rationale = (req.body?.rationale as string) ?? existing.proposed?.rationale ?? null;
    const plan = await bookPlan(db, { exposureId: e.exposure_id, actions: acts, totals, rationale, by: user, proposedBy: existing.proposed?.proposedBy ?? user });

    // Write-back to Delta so the dashboard + Genie see the booked plan.
    let deltaWritten = false;
    let deltaError: string | null = null;
    if (deps.data && process.env.DATABRICKS_WAREHOUSE_ID) {
      const fq = `${deps.data.catalog}.${deps.data.schema}.sop_plan_decisions`;
      const summary = acts.map((a) => `${a.documentNumber} ${a.title} (${a.qty.toLocaleString()} ${a.type === 'safety_stock' ? 'wk' : 'u'})`).join('; ');
      try {
        await execSql(process.env.DATABRICKS_WAREHOUSE_ID, `INSERT INTO ${fq} VALUES (${esc(plan.id)}, ${esc(e.exposure_id)}, ${esc(e.component_id)}, ${esc(e.plant_id)}, ${esc(JSON.stringify(acts))}, ${esc(summary)}, ${totals.planCost}, ${totals.revenueProtected}, ${totals.unitsShortBefore}, ${totals.unitsShortAfter}, ${esc(user)}, current_timestamp(), ${esc(rationale)}, 'supply-planning-copilot')`);
        await markDeltaWritten(db, plan.id);
        deltaWritten = true;
      } catch (err) {
        deltaError = (err as Error).message;
        console.error('[book] Delta write-back failed', err);
      }
    }
    res.json({ plan: { ...plan, deltaWritten }, deltaError });
  });

  app.get('/api/plan-events', async (req, res) => {
    const raw = Number(req.query.limit);
    res.json(await recentPlanEvents(db, Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 50) : 10));
  });

  app.get('/api/inventory', async (_req, res) => {
    const d = await data();
    res.json({ as_of: d.asOf, health: d.health, demand: d.demand, plants: d.plants });
  });
}

/** Reset helper: remove the app's booked plans from Delta. */
export async function deleteDeltaDecisions(data: DataConfig | undefined): Promise<void> {
  if (!data || !process.env.DATABRICKS_WAREHOUSE_ID) return;
  await execSql(process.env.DATABRICKS_WAREHOUSE_ID, `DELETE FROM ${data.catalog}.${data.schema}.sop_plan_decisions WHERE source = 'supply-planning-copilot'`);
}
