import type { Application } from 'express';
import { recentActivity } from '../db/queries/index.js';
import type { AppDb } from '../db/index.js';

/** Decision / AI-review feed across the queue (Home "Recent activity"). */
export function registerActivityRoutes(app: Application, deps: { db: AppDb }): void {
  app.get('/api/activity/recent', async (req, res) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100) : 20;
    res.json(await recentActivity(deps.db, limit));
  });
}
