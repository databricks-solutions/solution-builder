import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AppDb } from './index.js';

/**
 * Runs committed SQL migrations from ./drizzle/ at app startup.
 *
 * - Safe to call on every boot: Drizzle's migrator tracks applied migrations
 *   in a meta table and is a no-op if everything is up to date.
 * - In dev, the current user is the project owner (DDL allowed).
 * - In prod, the service principal runs this on first deploy, becomes the
 *   owner of `app` schema, and can run future migrations.
 *
 * NB: the migrations folder path is computed relative to this source file so
 * it resolves both under tsx-watch (dev) and tsdown-bundled (prod).
 */
export async function runMigrations(db: AppDb): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Dev: server/db/migrate.ts → ../../drizzle
  // Prod (bundled to dist/server.js): dist/ → ../drizzle
  const candidates = [
    resolve(here, '../../drizzle'),
    resolve(here, '../drizzle'),
  ];
  const fs = await import('node:fs');
  const migrationsFolder = candidates.find((p) => fs.existsSync(p));
  if (!migrationsFolder) {
    throw new Error(
      `No Drizzle migrations folder found. Tried: ${candidates.join(', ')}. ` +
        `Run \`npm run db:generate\` first.`,
    );
  }
  await warnOnSkippedMigrations(db, migrationsFolder);
  await migrate(db, { migrationsFolder });
}

/**
 * Drizzle applies a migration only if its `when` is newer than the last one
 * the DB recorded — it never compares content. So if drizzle/ was regenerated
 * from scratch AFTER schema.ts changed, the (pinned-`when`, see
 * scripts/db-generate.js) baseline is silently SKIPPED and the tables stay
 * stale. Detect that: a local migration older than the DB's last one whose
 * hash the DB never recorded. Warn (not fatal) — a drizzle-kit upgrade that
 * only reformats the SQL trips this too. Best-effort: any error is ignored.
 */
async function warnOnSkippedMigrations(db: AppDb, migrationsFolder: string): Promise<void> {
  try {
    const local = readMigrationFiles({ migrationsFolder });
    const res = await db.execute(sql`select hash, created_at from drizzle.__drizzle_migrations`);
    const rows = res.rows as Array<{ hash: string; created_at: string | number }>;
    if (rows.length === 0) return;
    const applied = new Set(rows.map((r) => r.hash));
    const last = Math.max(...rows.map((r) => Number(r.created_at)));
    const skipped = local.filter((m) => m.folderMillis <= last && !applied.has(m.hash));
    if (skipped.length > 0) {
      console.error(
        `[migrate] WARNING: ${skipped.length} local migration(s) differ from what this database applied and will be SKIPPED — ` +
          `the Lakebase tables may not match server/db/schema.ts. Cause: drizzle/ was regenerated from scratch after ` +
          `schema.ts changed. Fix: restore the drizzle/ folder this DB was migrated with and run \`npm run db:generate\` ` +
          `(incremental), or point the app at a fresh database.`,
      );
    }
  } catch {
    /* no migrations table yet (fresh DB) or not readable — nothing to compare */
  }
}
