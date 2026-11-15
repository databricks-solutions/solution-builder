import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import {
  applyFloorChange, approvePlan, getCampaign, getOpportunity, getPlan, listCampaigns, listFloorChanges, listOpportunities,
  listPlans, saveAnalysis, yieldSummary,
} from '../db/queries/index.js';
import type { DataConfig } from '../db/sync.js';
import { buildRecoveryPlan } from '../services/plan.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * Yield-desk routes.
 *   GET  /api/yield/summary            counts + money for the home page
 *   GET  /api/campaigns                live campaigns (?risk=1 → at-risk only), ranked by make-good liability
 *   GET  /api/campaigns/:id            campaign + lines + latest recovery plan + approved plan
 *   POST /api/campaigns/:id/plan       SSE — build the recovery plan (pacing → forecast → spare avails → IO terms → yield → write-up)
 *   POST /api/campaigns/:id/approve    write-back: approve the plan, send to ad ops (+ its floor changes)
 *   GET  /api/opportunities            programmatic yield board (eCPM vs rate card, floor group, revenue gap)
 *   GET  /api/opportunities/:id        one product + weekly trend
 *   POST /api/opportunities/:id/floor  write-back: queue the floor-group restore for ad ops
 *   GET  /api/plans | /api/floor-changes   the write-back tables
 */
export function registerYieldRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; backends: { genieSpaceId?: string; noticeModel?: string } },
): void {
  const { db } = deps;

  app.get('/api/yield/summary', async (_req, res) => {
    res.json(await yieldSummary(db));
  });

  app.get('/api/campaigns', async (req, res) => {
    res.json(await listCampaigns(db, { atRiskOnly: req.query.risk === '1' }));
  });

  app.get('/api/campaigns/:id', async (req, res) => {
    const c = await getCampaign(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'campaign not found' });
      return;
    }
    const plan = c.planId ? await getPlan(db, c.planId) : null;
    res.json({ ...c, approvedPlan: plan });
  });

  app.post('/api/campaigns/:id/plan', async (req, res) => {
    const c = await getCampaign(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'campaign not found' });
      return;
    }
    if (!deps.data) {
      res.status(503).json({ error: 'data config missing (DEMO_CATALOG / DEMO_SCHEMA)' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const out = await buildRecoveryPlan(req, c, deps.data, {
        genieSpaceId: deps.backends.genieSpaceId ?? '',
        noticeModel: deps.backends.noticeModel || 'databricks-claude-sonnet-4-5',
        onStep: (e) => send('step', e),
      });
      await saveAnalysis(db, c.id, out.plan, out.notice, getCurrentUserEmail(req));
      send('result', { plan: out.plan, notice: out.notice });
    } catch (e) {
      console.error('[plan] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/campaigns/:id/approve', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { notes?: string; noticeText?: string };
    const r = await approvePlan(db, {
      campaignId: req.params.id, notes: body.notes ?? null, noticeText: body.noticeText ?? null,
      userEmail: getCurrentUserEmail(req), via: 'workbench',
    });
    if ('error' in r) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json(r);
  });

  app.get('/api/opportunities', async (_req, res) => {
    res.json(await listOpportunities(db));
  });

  app.get('/api/opportunities/:id', async (req, res) => {
    const o = await getOpportunity(db, req.params.id);
    if (!o) {
      res.status(404).json({ error: 'product not found' });
      return;
    }
    res.json(o);
  });

  app.post('/api/opportunities/:id/floor', async (req, res) => {
    const r = await applyFloorChange(db, { productId: req.params.id, userEmail: getCurrentUserEmail(req), via: 'yield_board' });
    if ('error' in r) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json(r);
  });

  app.get('/api/plans', async (_req, res) => {
    res.json(await listPlans(db));
  });

  app.get('/api/floor-changes', async (_req, res) => {
    res.json(await listFloorChanges(db));
  });
}
