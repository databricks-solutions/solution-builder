import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { approvePlan, completeTasks, getPatient, latestPlan, listTasks, listWorklist, savePlan, worklistSummary } from '../db/queries/index.js';
import type { PlanTask } from '../db/schema.js';
import * as cd from '../services/care-data.js';
import { buildTransitionPlan } from '../services/transition-plan.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { resolvedBackends } from '../services/resources.js';

/**
 * Care-transitions routes.
 *   GET  /api/command-center              KPIs, HF readmission by unit, 4 West by weekday, follow-up effect, trend, events,
 *                                         note-derived social risks, HRRP penalty (Delta) + worklist summary (Lakebase)
 *   GET  /api/hrrp                        HRRP performance per hospital × condition, penalty estimate, what-if inputs (Delta)
 *   GET  /api/worklist?unit=&condition=&tier=&hrrp=1   open discharges ranked by readmission risk (Lakebase)
 *   GET  /api/worklist/:encounterId       one patient: worklist row + prior admissions (Delta) + latest plan + tasks
 *   POST /api/worklist/:encounterId/plan  SSE — build the transition plan (saved as a draft)
 *   POST /api/plans/:planId/approve       coordinator approves → selected tasks written to outreach_tasks (Lakebase)
 *   GET  /api/tasks?status=               outreach task queue (Lakebase)
 *   POST /api/tasks/complete              mark tasks done
 */
export function registerCareRoutes(app: Application, deps: { db: AppDb; memoModel: string }): void {
  const { db } = deps;
  const wrap = (fn: express.RequestHandler): express.RequestHandler => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      console.error(`[care] ${req.method} ${req.path} failed`, e);
      if (!res.headersSent) res.status(500).json({ error: (e as Error).message });
    }
  };

  app.get('/api/command-center', wrap(async (_req, res) => {
    const [kpis, units, weekday, followup, trend, events, notes, penalty, summary] = await Promise.all([
      cd.kpis(), cd.unitHf('HF'), cd.signalByWeekday(), cd.followupEffect(), cd.hfTrend(), cd.unitEvents(cd.SIGNAL_UNIT), cd.noteSignals(),
      cd.hrrpPenalty(), worklistSummary(db),
    ]);
    res.json({ kpis, units, weekday, followup, trend, events, notes, penalty, summary });
  }));

  app.get('/api/hrrp', wrap(async (_req, res) => {
    const [performance, penalty, whatIf] = await Promise.all([cd.hrrpPerformance(), cd.hrrpPenalty(), cd.whatIfInputs()]);
    res.json({ performance, penalty, whatIf });
  }));

  app.get('/api/worklist', wrap(async (req, res) => {
    res.json(await listWorklist(db, {
      unitId: req.query.unit ? String(req.query.unit) : null, condition: req.query.condition ? String(req.query.condition) : null,
      tier: req.query.tier ? String(req.query.tier) : null, hrrpOnly: req.query.hrrp === '1',
    }));
  }));

  app.get('/api/worklist/:id', wrap(async (req, res) => {
    const p = await getPatient(db, String(req.params.id));
    if (!p) {
      res.status(404).json({ error: 'patient not on the worklist' });
      return;
    }
    const [history, plan, tasks] = await Promise.all([
      cd.patientHistory(p.patientId).catch(() => []), latestPlan(db, p.encounterId), listTasks(db, { encounterId: p.encounterId }),
    ]);
    res.json({ patient: p, history: history.filter((h) => h.encounter_id !== p.encounterId), plan, tasks });
  }));

  app.post('/api/worklist/:id/plan', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const p = await getPatient(db, String(req.params.id));
      if (!p) throw new Error('patient not on the worklist');
      const b = await resolvedBackends();
      const plan = await buildTransitionPlan(req, p, { genieSpaceId: b.genieSpaceId, memoModel: deps.memoModel, onStep: (e) => send('step', e) });
      const row = await savePlan(db, { plan, by: getCurrentUserEmail(req), via: 'workbench' });
      send('result', row);
    } catch (e) {
      console.error('[plan] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/plans/:planId/approve', express.json(), wrap(async (req, res) => {
    const b = (req.body ?? {}) as { tasks?: PlanTask[] };
    const row = await approvePlan(db, { id: String(req.params.planId), tasks: Array.isArray(b.tasks) ? b.tasks : [], by: getCurrentUserEmail(req) });
    if (!row) {
      res.status(404).json({ error: 'plan not found' });
      return;
    }
    res.json(row);
  }));

  app.get('/api/tasks', wrap(async (req, res) => {
    const s = req.query.status === 'open' || req.query.status === 'done' ? req.query.status : null;
    res.json(await listTasks(db, { status: s }));
  }));

  app.post('/api/tasks/complete', express.json(), wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String) : [];
    res.json(await completeTasks(db, ids, getCurrentUserEmail(req)));
  }));
}
