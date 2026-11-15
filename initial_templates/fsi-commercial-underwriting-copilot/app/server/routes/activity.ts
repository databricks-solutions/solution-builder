import type { Application } from 'express';
import { recentActivity } from '../db/queries/index.js';
import type { AppDb } from '../db/index.js';

/**
 * Desk activity feed — reviews drafted, referrals, CUO approvals, decisions issued (from the submissions audit trails).
 * Powers the home-page "Recent desk activity" list.
 */
export function registerActivityRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  app.get('/api/activity/recent', async (req, res) => {
    // `?limit=abc` → fallback 20; clamp to 100. Guards against NaN/array
    // values that would otherwise bind as `LIMIT NaN` and throw cryptically.
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100) : 20;
    const events = await recentActivity(deps.db, limit);
    res.json(events);
  });
}
