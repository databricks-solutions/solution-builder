import type { Application } from 'express';
import { syncFromDelta, wipeMirroredTables, type DataConfig } from '../db/sync.js';
import type { AppDb } from '../db/index.js';
import { deleteDeltaDecisions } from './planning.js';

/**
 * Demo-only admin route. /api/admin/reset wipes everything the app wrote
 * (Lakebase plans + audit + conversations, and the booked plans it wrote back
 * to Delta), then reloads the planning data — click it between demos.
 */
export function registerAdminRoutes(app: Application, deps: { db: AppDb; data: DataConfig | undefined }): void {
  const { db, data } = deps;
  app.post('/api/admin/reset', async (_req, res) => {
    await wipeMirroredTables(db);
    let deltaError: string | null = null;
    try { await deleteDeltaDecisions(data); } catch (e) { deltaError = (e as Error).message; console.error('[reset] Delta cleanup failed', e); }
    if (data) await syncFromDelta(db, data, { forceIfAnyEmpty: true });
    res.json({ ok: true, deltaError });
  });
}
