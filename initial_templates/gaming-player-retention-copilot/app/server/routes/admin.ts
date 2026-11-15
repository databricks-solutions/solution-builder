import type { Application } from 'express';
import { execWarehouseSql, syncFromDelta, wipeMirroredTables } from '../db/sync.js';
import type { AppDb } from '../db/index.js';

/**
 * Demo-only admin routes. /api/admin/reset wipes the app-owned tables, clears the
 * Delta write-back table (liveops_schedule) and re-syncs the mirror from Delta —
 * click it between demos to start clean.
 */

type DataConfig = Parameters<typeof syncFromDelta>[1];

export function registerAdminRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined },
): void {
  const { db, data } = deps;
  app.post('/api/admin/reset', async (_req, res) => {
    await wipeMirroredTables(db);
    let deltaReset = 'skipped';
    if (data) {
      try {
        await execWarehouseSql(`DELETE FROM \`${data.catalog}\`.\`${data.schema}\`.liveops_schedule`);
        deltaReset = 'ok';
      } catch (e) {
        deltaReset = (e as Error).message;
        console.error('[reset] could not clear liveops_schedule:', deltaReset);
      }
      await syncFromDelta(db, data, { forceIfAnyEmpty: true });
    }
    res.json({ ok: true, deltaReset });
  });
}
