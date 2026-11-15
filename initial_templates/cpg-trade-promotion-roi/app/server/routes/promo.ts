import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import {
  applyReplan, getPlanEvent, getPromoEvent, listDecisions, listPlan, listPromoEvents, postEventSummary, revertEvent,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * REST surface of the Trade Promo Copilot UI.
 *   GET  /api/plan                 next-quarter draft calendar (Lakebase)
 *   GET  /api/plan/:id             one planned event + its re-plan scenarios + decisions
 *   POST /api/plan/:id/replan      WRITE-BACK from the UI: { scenarioKey, rationale }
 *   POST /api/plan/:id/revert      put the event back on its original draft tactic
 *   GET  /api/events               completed promotions (post-event analysis) ?retailer=&tactic=
 *   GET  /api/events/:id           one completed promotion with its weekly curve
 *   GET  /api/events-summary       retailer x tactic roll-up (ratio of sums)
 *   GET  /api/decisions            the approved re-plans log
 */
export function registerPromoRoutes(app: Application, deps: { db: AppDb }): void {
  const { db } = deps;
  const q = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  app.get('/api/plan', async (_req, res) => {
    res.json(await listPlan(db));
  });
  app.get('/api/plan/:id', async (req, res) => {
    const ev = await getPlanEvent(db, req.params.id);
    if (!ev) return void res.status(404).json({ error: 'not found' });
    res.json(ev);
  });
  app.post('/api/plan/:id/replan', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { scenarioKey?: string; rationale?: string };
    const r = await applyReplan(db, {
      planEventId: req.params.id, scenarioKey: body.scenarioKey ?? null, rationale: body.rationale ?? null,
      userEmail: getCurrentUserEmail(req), via: 'planner',
    });
    if ('error' in r) return void res.status(400).json(r);
    res.json(r);
  });
  app.post('/api/plan/:id/revert', async (req, res) => {
    const r = await revertEvent(db, req.params.id, getCurrentUserEmail(req));
    if ('error' in r) return void res.status(400).json(r);
    res.json(r);
  });
  app.get('/api/events', async (req, res) => {
    res.json(await listPromoEvents(db, { retailer: q(req.query.retailer), tactic: q(req.query.tactic) }));
  });
  app.get('/api/events/:id', async (req, res) => {
    const ev = await getPromoEvent(db, req.params.id);
    if (!ev) return void res.status(404).json({ error: 'not found' });
    res.json(ev);
  });
  app.get('/api/events-summary', async (req, res) => {
    res.json(await postEventSummary(db, { retailer: q(req.query.retailer), tactic: q(req.query.tactic) }));
  });
  app.get('/api/decisions', async (_req, res) => {
    res.json(await listDecisions(db));
  });
}
