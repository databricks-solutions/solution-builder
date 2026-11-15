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
    // `?limit=abc` → fallback 20; clamp to 100. Guards against NaN/array
    // values that would otherwise bind as `LIMIT NaN` and throw cryptically.
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100) : 20;
    const events = await recentActivity(deps.db, limit);
    res.json(events);
  });
}
