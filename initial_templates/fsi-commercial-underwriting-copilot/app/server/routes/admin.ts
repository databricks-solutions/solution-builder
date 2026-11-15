import type { Application } from 'express';
import { execSql, syncFromDelta, wipeMirroredTables, type DataConfig } from '../db/sync.js';
import type { AppDb } from '../db/index.js';

/**
 * Demo-only admin routes. /api/admin/reset wipes the app-owned Lakebase tables, clears the desk's Delta
 * write-back (uw_decisions) and re-syncs today's queue from Delta — click it between demos to start clean
 * (every submission new, no reviews, no referrals, no decisions, no conversations).
 */
export function registerAdminRoutes(app: Application, deps: { db: AppDb; data: DataConfig | undefined }): void {
  const { db, data } = deps;
  app.post('/api/admin/reset', async (_req, res) => {
    await wipeMirroredTables(db);
    const wh = process.env.DATABRICKS_WAREHOUSE_ID;
    if (data && wh) {
      await execSql(wh, `DELETE FROM ${data.catalog}.${data.schema}.uw_decisions`)
        .catch((e) => console.error('[reset] Delta write-back cleanup failed:', (e as Error).message));
      await syncFromDelta(db, data, { forceIfAnyEmpty: true });
    }
    res.json({ ok: true });
  });
}
