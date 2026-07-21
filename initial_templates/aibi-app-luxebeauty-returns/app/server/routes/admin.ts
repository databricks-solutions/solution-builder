import type { Application } from 'express';
import { syncFromDelta, wipeMirroredTables } from '../db/sync.js';
import type { AppDb } from '../db/index.js';

/**
 * Demo-only admin routes. /api/admin/reset wipes the app-owned tables and
 * re-syncs the mirror from Delta — click it between demos to start clean.
 */

type DataConfig = Parameters<typeof syncFromDelta>[1];

export function registerAdminRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined },
): void {
  const { db, data } = deps;
  app.post('/api/admin/reset', async (_req, res) => {
    await wipeMirroredTables(db);
    if (data) {
      await syncFromDelta(db, data, { forceIfAnyEmpty: true });
    }
    res.json({ ok: true });
  });
}
