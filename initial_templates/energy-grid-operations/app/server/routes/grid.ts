import type { Application } from 'express';
import express from 'express';
import { getCurrentUserEmail } from '../lib/user.js';
import { assetDetail, gridOverview, listActions, logAction, reliefOptions, transformerCurve } from '../grid/queries.js';

const ID = /^T-\d{3}$/;

export function registerGridRoutes(app: Application): void {
  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      try {
        res.json(await fn(req, res));
      } catch (e) {
        console.error(`[grid] ${req.method} ${req.path} failed`, e);
        res.status(500).json({ error: (e as Error).message });
      }
    };
  const txId = (req: express.Request) => {
    const id = String(req.params.id);
    if (!ID.test(id)) throw new Error(`bad transformer id ${id}`);
    return id;
  };

  app.get('/api/grid/overview', wrap(() => gridOverview()));
  app.get('/api/grid/transformers/:id/curve', wrap((req) => transformerCurve(txId(req))));
  app.get('/api/grid/transformers/:id/options', wrap((req) => reliefOptions(txId(req))));
  app.get('/api/grid/transformers/:id/detail', wrap((req) => assetDetail(txId(req))));
  app.get('/api/grid/actions', wrap(() => listActions(20)));
  app.post('/api/grid/actions', express.json(), wrap(async (req) => {
    const optionId = String(req.body?.option_id ?? '');
    if (!/^T-\d{3}-OPT\d$/.test(optionId)) throw new Error('option_id required');
    return logAction({
      option_id: optionId,
      operator: getCurrentUserEmail(req),
      rationale: String(req.body?.rationale ?? 'Approved from the control-room console'),
      source: 'app',
    });
  }));
}
