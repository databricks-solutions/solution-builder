import type { Application } from 'express';
import { syncFromDelta, wipeMirroredTables, type DataConfig } from '../db/sync.js';
import { clearDeltaDecisions } from '../lib/writeback.js';
import type { AppDb } from '../db/index.js';

/** Demo reset: wipe the Lakebase mirror + Delta write-back, re-sync the open queue. */
export function registerAdminRoutes(app: Application, deps: { db: AppDb; data: DataConfig | undefined }): void {
  app.post('/api/admin/reset', async (_req, res) => {
    await wipeMirroredTables(deps.db);
    if (deps.data) {
      await clearDeltaDecisions(deps.data.catalog, deps.data.schema);
      await syncFromDelta(deps.db, deps.data, { forceIfAnyEmpty: true });
    }
    res.json({ ok: true });
  });
}
