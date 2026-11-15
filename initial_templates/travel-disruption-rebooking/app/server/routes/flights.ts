import express, { type Application, type Request } from 'express';
import type { AppDb } from '../db/index.js';
import {
  approvalQueue, commitPlan, eventSummary, getFlight, listFlights, loadGuardrails, savePlan, setStatus, toEngine,
} from '../db/queries/index.js';
import { execSql, type DataConfig } from '../db/sync.js';
import type { ReaccomPlan } from '../db/schema.js';
import { planFlight, type StepEvent } from '../services/reaccom.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { resolvedBackends } from '../services/resources.js';

/**
 * IROPS desk routes.
 *   GET  /api/event/summary          Winter Storm Harlan KPIs (live Lakebase mirror)
 *   GET  /api/flights                cancelled flights, worst AutoProtect outcome first
 *   GET  /api/flights/:id            manifest + options + hotels + latest plan
 *   POST /api/flights/:id/plan       SSE — run the re-accommodation plan (manifest → inventory → policy documents → allocate → notify)
 *   POST /api/flights/:id/submit     desk → Duty Manager approval queue (or straight to commit when no approval needed)
 *   POST /api/flights/:id/approve    Duty Manager approves → commit (Lakebase) + write-back (Delta)
 *   POST /api/flights/:id/send-back  Duty Manager returns the plan with a note
 *   GET  /api/approvals              approval queue + committed plans
 */
export type PlanRunner = (req: Request, flightId: string, onStep: (e: StepEvent) => void) => Promise<ReaccomPlan | null>;

export function makePlanRunner(deps: { db: AppDb; genieSpaceId: string; model: string }): PlanRunner {
  return async (req, flightId, onStep) => {
    const f = await getFlight(deps.db, flightId);
    if (!f) return null;
    const e = toEngine(f);
    const guardrails = await loadGuardrails(deps.db);
    const genieSpaceId = deps.genieSpaceId || (await resolvedBackends()).genieSpaceId;
    const { plan } = await planFlight(req, { ...e, guardrails, draftedBy: getCurrentUserEmail(req) }, {
      genieSpaceId, model: deps.model, onStep,
    });
    await savePlan(deps.db, flightId, plan, getCurrentUserEmail(req));
    return plan;
  };
}

/** Delta write-back of a committed plan (rebooking_plans + rebooking_decisions). Best-effort — returns 'ok' or the error. */
export async function writeBackToDelta(data: DataConfig | undefined, plan: ReaccomPlan, by: string, note: string | null): Promise<string> {
  const wh = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!data || !wh) return 'skipped (no warehouse / data config)';
  const q = (v: string | null | undefined) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'NULL' : String(Math.round(v * 100) / 100));
  const s = `${data.catalog}.${data.schema}`;
  const m = plan.metrics, ap = plan.autoprotect;
  try {
    await execSql(wh, `INSERT INTO ${s}.rebooking_plans VALUES (${q(plan.plan_id)}, ${q(plan.flight_id)}, ${q(plan.flight_number)}, 'COMMITTED',
      ${m.pax}, ${m.same_day}, ${m.overnight}, ${m.priority_same_day}, ${m.misconnects}, ${n(m.partner_spend)}, ${m.hotel_rooms},
      ${n(m.total_cost)}, ${n(m.cost_per_pax)}, ${n(m.predicted_detractor_rate)}, ${ap.same_day}, ${n(ap.total_cost)},
      ${plan.requires_approval}, ${q(plan.drafted_by)}, ${q(by)}, ${q(note)}, current_timestamp())`);
    const rows = plan.assignments.map((a) => `(${q(`${plan.plan_id}-${a.pax_id}`)}, ${q(plan.plan_id)}, ${q(a.pax_id)}, ${q(a.pnr)}, ${q(plan.flight_id)},
      ${q(a.option_id)}, ${q(a.label)}, CAST(${q(a.arrive.replace('T', ' ') + ':00')} AS TIMESTAMP_NTZ), ${a.same_day}, ${!a.same_day},
      ${q(a.hotel_id)}, ${q(a.priority)}, ${q(a.priority_reason)}, ${n(a.cost_usd)}, 'DESK_AGENT', ${q(by)}, current_timestamp())`);
    for (let i = 0; i < rows.length; i += 200) {
      await execSql(wh, `INSERT INTO ${s}.rebooking_decisions VALUES ${rows.slice(i, i + 200).join(',\n')}`);
    }
    return 'ok';
  } catch (e) {
    console.error('[commit] Delta write-back failed:', (e as Error).message);
    return (e as Error).message.slice(0, 300);
  }
}

export function registerFlightRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; runPlan: PlanRunner },
): void {
  const { db } = deps;

  app.get('/api/event/summary', async (_req, res) => { res.json(await eventSummary(db)); });
  app.get('/api/flights', async (_req, res) => { res.json(await listFlights(db)); });
  app.get('/api/approvals', async (_req, res) => { res.json(await approvalQueue(db)); });

  app.get('/api/flights/:id', async (req, res) => {
    const f = await getFlight(db, req.params.id);
    if (!f) {
      res.status(404).json({ error: 'flight not found' });
      return;
    }
    res.json(f);
  });

  app.post('/api/flights/:id/plan', async (req, res) => {
    const f = await getFlight(db, req.params.id);
    if (!f) {
      res.status(404).json({ error: 'flight not found' });
      return;
    }
    if (f.status === 'committed') {
      res.status(409).json({ error: 'plan already committed' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const plan = await deps.runPlan(req, req.params.id, (e) => send('step', e));
      send('result', { plan });
    } catch (e) {
      console.error('[plan] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  const commit = async (req: Request, id: string, note: string | null) => {
    const by = getCurrentUserEmail(req);
    const f = await commitPlan(db, id, by, note);
    if (!f?.plan) return null;
    const deltaWriteBack = await writeBackToDelta(deps.data, f.plan, by, note);
    return { flight: f, deltaWriteBack };
  };

  app.post('/api/flights/:id/submit', express.json(), async (req, res) => {
    const f = await getFlight(db, req.params.id);
    if (!f?.plan) {
      res.status(400).json({ error: 'run the re-accommodation plan first' });
      return;
    }
    if (f.status === 'committed') {
      res.status(409).json({ error: 'already committed' });
      return;
    }
    if (f.plan.requires_approval) {
      await setStatus(db, f.id, 'awaiting_approval', getCurrentUserEmail(req), 'submitted', (req.body?.note as string) || f.plan.approval_reasons.join(' '));
      res.json({ status: 'awaiting_approval', flight: await getFlight(db, f.id) });
      return;
    }
    const out = await commit(req, f.id, 'Within guardrails — auto-approved');
    res.json({ status: 'committed', ...out });
  });

  app.post('/api/flights/:id/approve', express.json(), async (req, res) => {
    const f = await getFlight(db, req.params.id);
    if (!f || f.status !== 'awaiting_approval') {
      res.status(409).json({ error: 'no plan awaiting approval' });
      return;
    }
    const out = await commit(req, f.id, (req.body?.note as string) || null);
    res.json({ status: 'committed', ...out });
  });

  app.post('/api/flights/:id/send-back', express.json(), async (req, res) => {
    const f = await getFlight(db, req.params.id);
    if (!f || f.status !== 'awaiting_approval') {
      res.status(409).json({ error: 'no plan awaiting approval' });
      return;
    }
    await setStatus(db, f.id, 'plan_drafted', getCurrentUserEmail(req), 'sent_back', (req.body?.note as string) || 'Sent back by the Duty Manager');
    res.json({ status: 'plan_drafted', flight: await getFlight(db, f.id) });
  });
}
