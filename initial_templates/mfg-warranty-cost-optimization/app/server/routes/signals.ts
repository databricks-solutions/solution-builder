import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import {
  getQualityCase, getSignal, listClaims, listQualityCases, listSignals, openQualityCase, saveAnalysis, signalClaims,
  signalWeekly, warrantySummary,
} from '../db/queries/index.js';
import type { DataConfig } from '../db/sync.js';
import { analyzeSignal } from '../services/analyze.js';
import { resolvedBackends } from '../services/resources.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * Warranty workbench routes.
 *   GET  /api/signals                 early-warning board (ranked by projected exposure)
 *   GET  /api/signals/summary         counts for the home page
 *   GET  /api/signals/:id             signal + its claims (AI failure mode, notes) + weekly trend + analysis
 *   POST /api/signals/:id/analyze     SSE — assemble the root-cause case (evidence → library → exposure → write-up)
 *   POST /api/signals/:id/case        write-back: open the quality case (containment + chargeback)
 *   GET  /api/claims                  claims explorer (AI failure mode vs dealer code)
 *   GET  /api/quality-cases           opened quality cases
 */
export function registerSignalRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; noticeModel: string },
): void {
  const { db } = deps;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  app.get('/api/signals', async (_req, res) => {
    res.json(await listSignals(db));
  });

  app.get('/api/signals/summary', async (_req, res) => {
    res.json(await warrantySummary(db));
  });

  app.get('/api/signals/:id', async (req, res) => {
    const s = await getSignal(db, req.params.id);
    if (!s) {
      res.status(404).json({ error: 'signal not found' });
      return;
    }
    const [cl, weekly] = await Promise.all([signalClaims(db, s, 400), signalWeekly(db, s)]);
    const qc = s.qualityCaseId ? await getQualityCase(db, s.qualityCaseId) : null;
    res.json({ ...s, claims: cl, weekly, qualityCase: qc });
  });

  app.post('/api/signals/:id/analyze', async (req, res) => {
    const s = await getSignal(db, req.params.id);
    if (!s) {
      res.status(404).json({ error: 'signal not found' });
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
      const cl = await signalClaims(db, s);
      const { genieSpaceId } = await resolvedBackends();
      const out = await analyzeSignal(req, s, cl.map((c) => ({
        id: c.id, dealer_labor_code: c.dealerLaborCode, water_exposure: c.waterExposure, fault_code: c.faultCode,
        total_cost: c.totalCost, region: c.region, claim_status: c.claimStatus,
      })), deps.data, { genieSpaceId, noticeModel: deps.noticeModel, onStep: (e) => send('step', e) });
      await saveAnalysis(db, s.id, out.analysis, out.notice, getCurrentUserEmail(req));
      send('result', { analysis: out.analysis, notice: out.notice });
    } catch (e) {
      console.error('[analyze] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/signals/:id/case', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { actions?: string[]; notes?: string; noticeText?: string };
    const s = await getSignal(db, req.params.id);
    if (!s) {
      res.status(404).json({ error: 'signal not found' });
      return;
    }
    if (!s.analysis) {
      res.status(400).json({ error: 'run the root-cause analysis first' });
      return;
    }
    const r = await openQualityCase(db, {
      signalId: s.id, actions: Array.isArray(body.actions) ? body.actions : [], notes: body.notes ?? null,
      noticeText: body.noticeText ?? null, userEmail: getCurrentUserEmail(req), openedVia: 'workbench',
    });
    if ('error' in r) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json(r);
  });

  app.get('/api/claims', async (req, res) => {
    res.json(await listClaims(db, {
      failureMode: str(req.query.mode), region: str(req.query.region), lot: str(req.query.lot), code: str(req.query.code),
      q: str(req.query.q), mismatchOnly: req.query.mismatch === '1', limit: Math.min(500, Number(req.query.limit) || 200),
    }));
  });

  app.get('/api/quality-cases', async (_req, res) => {
    res.json(await listQualityCases(db));
  });
}
