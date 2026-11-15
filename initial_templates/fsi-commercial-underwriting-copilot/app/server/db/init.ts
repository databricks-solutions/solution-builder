import type { AppDb } from './index.js';
import type { DataConfig } from './sync.js';

/**
 * Boot-time DB initialization policy, split by how fatal each step is.
 *
 * Two steps run at boot, and they are NOT equally fatal — conflating them was
 * a real production bug:
 *
 *   • **Migrations are FATAL.** A schema that won't migrate means the app
 *     genuinely cannot serve its own tables. We must surface that: the boot
 *     gate in `server.ts` turns a thrown error into a 503 carrying the message,
 *     so an LLM customizing the template sees the real failure in the browser,
 *     not just the terminal.
 *
 *   • **The Delta → Lakebase mirror sync is BEST-EFFORT.** It copies demo data
 *     into the Lakebase mirror for convenience, but the source tables live in a
 *     *separately-built* demo schema that can be transiently absent (mid-rebuild
 *     — a `gold_*` table dropped-and-recreated) or briefly unreachable
 *     (warehouse cold-start). A missing source table must NOT take the whole app
 *     down.
 *
 * Before this split, both steps shared one try/catch in `server.ts`, so a single
 * `[sync] SQL failed: [TABLE_OR_VIEW_NOT_FOUND] …` set the sticky
 * `migrationsFailure` flag and EVERY DB-backed `/api/*` route then 503'd for the
 * app's whole lifetime — the "Couldn't load app config" card / a dead Operations
 * page — even though the schema was fine and the missing table reappeared minutes
 * later. `runDbInit` instead throws only when migrations fail, and reports a sync
 * failure via the returned `syncError` (+ the `onSyncError` hook) so the caller
 * logs it loudly and boots DEGRADED. Recovery: if the sync failed before any rows
 * committed (empty mirror), the next cold boot re-runs it automatically (the sync
 * only runs when `app.customers` is empty). If it committed some tables then failed
 * (partial mirror), that empty-guard skips it, so a partial mirror is cleared by a
 * manual "Reset demo" (or `syncFromDelta(..., { forceIfAnyEmpty: true })`).
 */
export interface DbInitDeps {
  runMigrations: (db: AppDb) => Promise<void>;
  syncFromDelta: (db: AppDb, cfg: DataConfig) => Promise<void>;
  /** Invoked with the sync error when the best-effort Delta sync fails. */
  onSyncError?: (err: Error) => void;
}

/**
 * Run boot-time DB init. Rejects ONLY on a migration failure (genuinely fatal);
 * a Delta-sync failure resolves with `{ syncError }` set so the app can boot
 * degraded rather than 503 wholesale.
 *
 * @param data  the `config.data` block, or `undefined` in local-dev / preview
 *              with no warehouse — when absent, no sync is attempted.
 */
export async function runDbInit(
  db: AppDb,
  data: DataConfig | undefined,
  deps: DbInitDeps,
): Promise<{ syncError: Error | null }> {
  // Fatal: let a migration failure propagate so the boot gate surfaces it.
  await deps.runMigrations(db);

  // Nothing to mirror (no data section → local-dev / preview with no warehouse).
  if (!data) return { syncError: null };

  // Best-effort: a missing/rebuilding source table or a warehouse hiccup must
  // never be fatal. Report it and let the app boot with an empty/partial mirror.
  try {
    await deps.syncFromDelta(db, data);
    return { syncError: null };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    deps.onSyncError?.(err);
    return { syncError: err };
  }
}
