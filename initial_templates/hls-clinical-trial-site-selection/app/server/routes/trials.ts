import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { decidePlan, latestPlan, listSites, opsSummary, savePlan, type PlanDecision, type SiteView } from '../db/queries/index.js';
import * as td from '../services/trial-data.js';
import { analyzeRescue } from '../services/rescue.js';
import { resolvedBackends } from '../services/resources.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * Clinical-operations workbench routes.
 *   GET  /api/portfolio                   the sponsor's active trials: randomized vs plan (Delta)
 *   GET  /api/trials/:id/overview         enrollment curve, screen failures (coded vs AI-read), catchment funnel,
 *                                         SGLT2i trend, competition, activation cycle time, criteria (Delta)
 *   GET  /api/sites?view=                 site network with model scores + study-manager actions (Lakebase)
 *   GET  /api/ops/summary                 counts for the home page (Lakebase)
 *   POST /api/trials/:id/rescue           SSE — run the enrollment-rescue analysis, saved as a draft plan
 *   GET  /api/trials/:id/rescue/latest    the latest plan (draft / approved / rejected)
 *   POST /api/rescue/:planId/decision     study manager approves / rejects → write-back to Lakebase
 */
export function registerTrialRoutes(app: Application, deps: { db: AppDb; memoModel: string }): void {
  const { db } = deps;
  const wrap = (fn: express.RequestHandler): express.RequestHandler => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      console.error(`[trials] ${req.method} ${req.path} failed`, e);
      if (!res.headersSent) res.status(500).json({ error: (e as Error).message });
    }
  };

  app.get('/api/portfolio', wrap(async (_req, res) => {
    res.json(await td.portfolio());
  }));

  app.get('/api/trials/:id/overview', wrap(async (req, res) => {
    const id = String(req.params.id);
    const [portfolio, curve, plan, screenFails, coded, e4Trend, funnel, sglt2Trend, competition, activation, criteria] = await Promise.all([
      td.portfolio(), td.enrollmentCurve(id), td.fullPlan(id), td.screenFails(id), td.codedReasons(id), td.e4Trend(id), td.funnel(id),
      td.sglt2Trend(), td.competition(id), td.activationCycle(id), td.criteria(id),
    ]);
    const trial = portfolio.find((p) => p.trial_id === id);
    if (!trial) {
      res.status(404).json({ error: 'trial not found' });
      return;
    }
    res.json({ trial, curve, plan, screenFails, coded, e4Trend, funnel, sglt2Trend, competition, activation, criteria });
  }));

  app.get('/api/sites', wrap(async (req, res) => {
    const v = String(req.query.view ?? 'all') as SiteView;
    res.json(await listSites(db, ['active', 'candidates', 'actions', 'all'].includes(v) ? v : 'all'));
  }));

  app.get('/api/ops/summary', wrap(async (_req, res) => {
    res.json(await opsSummary(db));
  }));

  app.get('/api/trials/:id/rescue/latest', wrap(async (req, res) => {
    res.json(await latestPlan(db, String(req.params.id)));
  }));

  app.post('/api/trials/:id/rescue', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const { analysis, memo } = await analyzeRescue(req, String(req.params.id), {
        genieSpaceId: (await resolvedBackends()).genieSpaceId, memoModel: deps.memoModel, onStep: (e) => send('step', e),
      });
      const plan = await savePlan(db, { trialId: String(req.params.id), analysis, memo, by: getCurrentUserEmail(req) });
      send('result', plan);
    } catch (e) {
      console.error('[rescue] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/rescue/:planId/decision', express.json(), wrap(async (req, res) => {
    const b = (req.body ?? {}) as { decision?: string; notes?: string; memo?: string; selectedSiteIds?: string[]; closureSiteIds?: string[] };
    if (b.decision !== 'APPROVED' && b.decision !== 'REJECTED') {
      res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
      return;
    }
    const plan = await decidePlan(db, {
      id: String(req.params.planId), decision: b.decision as PlanDecision, notes: b.notes ?? null, memo: b.memo ?? null,
      selectedSiteIds: Array.isArray(b.selectedSiteIds) ? b.selectedSiteIds.map(String) : [],
      closureSiteIds: Array.isArray(b.closureSiteIds) ? b.closureSiteIds.map(String) : [], by: getCurrentUserEmail(req),
    });
    if (!plan) {
      res.status(404).json({ error: 'plan not found' });
      return;
    }
    res.json(plan);
  }));
}
