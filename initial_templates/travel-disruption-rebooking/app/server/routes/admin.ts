import type { Application } from 'express';
import { execSql, syncFromDelta, wipeMirroredTables, type DataConfig } from '../db/sync.js';
import type { AppDb } from '../db/index.js';

/**
 * Demo-only admin routes. /api/admin/reset wipes the app-owned Lakebase tables, clears the desk's
 * Delta write-back (rebooking_plans / rebooking_decisions) and re-syncs Winter Storm Harlan from
 * Delta — click it between demos to start clean (AutoProtect's holds, every flight unplanned).
 */
export function registerAdminRoutes(app: Application, deps: { db: AppDb; data: DataConfig | undefined }): void {
  const { db, data } = deps;
  app.post('/api/admin/reset', async (_req, res) => {
    await wipeMirroredTables(db);
    const wh = process.env.DATABRICKS_WAREHOUSE_ID;
    if (data && wh) {
      const s = `${data.catalog}.${data.schema}`;
      await Promise.all([
        execSql(wh, `DELETE FROM ${s}.rebooking_decisions WHERE handling_method = 'DESK_AGENT'`),
        execSql(wh, `DELETE FROM ${s}.rebooking_plans WHERE status = 'COMMITTED'`),
      ]).catch((e) => console.error('[reset] Delta write-back cleanup failed:', (e as Error).message));
      await syncFromDelta(db, data, { forceIfAnyEmpty: true });
    }
    res.json({ ok: true });
  });
}
