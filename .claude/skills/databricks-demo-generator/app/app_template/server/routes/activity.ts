import type { Application } from 'express';
import { recentActivity } from '../db/queries/index.js';
import type { AppDb } from '../db/index.js';

/**
 * Unified activity feed — email sends, coupon issuance, return decisions.
 * Powers the home-page "Recent activity" list.
 */
export function registerActivityRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  app.get('/api/activity/recent', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 20), 100);
      const events = await recentActivity(deps.db, limit);
      res.json(events);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
