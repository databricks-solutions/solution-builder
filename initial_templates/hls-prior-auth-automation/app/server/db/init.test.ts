import { describe, it, expect, vi } from 'vitest';
import { runDbInit } from './init.js';
import type { AppDb } from './index.js';
import type { DataConfig } from './sync.js';

// runDbInit never touches the db handle itself — it only threads it to the
// injected runMigrations/syncFromDelta — so a bare cast is a sufficient fake.
const fakeDb = {} as AppDb;
const data: DataConfig = {
  catalog: 'solution_builder',
  schema: 'demo_oregon_sports_ops_replacement',
  tables: { returns: 'silver_returns', orders: 'silver_orders', customers: 'raw_customers' },
};

describe('runDbInit — migrations fatal, Delta sync best-effort', () => {
  // The regression this locks: a missing/rebuilding source table used to set the
  // sticky migrationsFailure flag and 503 every /api route for the app's lifetime.
  it('a failed Delta sync is NOT fatal — resolves with syncError, reports it, app boots', async () => {
    const syncErr = new Error(
      '[sync] SQL failed: [TABLE_OR_VIEW_NOT_FOUND] The table or view ' +
        '`solution_builder`.`demo_oregon_sports_ops_replacement`.`gold_data_quality` cannot be found',
    );
    const runMigrations = vi.fn(async () => {});
    const onSyncError = vi.fn();

    const res = await runDbInit(fakeDb, data, {
      runMigrations,
      syncFromDelta: async () => {
        throw syncErr;
      },
      onSyncError,
    });

    expect(runMigrations).toHaveBeenCalledOnce();
    expect(res.syncError).toBe(syncErr); // reported, NOT thrown
    expect(onSyncError).toHaveBeenCalledWith(syncErr);
  });

  it('a failed migration IS fatal — rejects so the boot gate 503s', async () => {
    const migErr = new Error('relation "app.__drizzle_migrations" is broken');
    const syncFromDelta = vi.fn(async () => {});

    await expect(
      runDbInit(fakeDb, data, {
        runMigrations: async () => {
          throw migErr;
        },
        syncFromDelta,
      }),
    ).rejects.toBe(migErr);

    // Sync must never run when migrations failed.
    expect(syncFromDelta).not.toHaveBeenCalled();
  });

  it('no data config (local-dev / preview) — migrations STILL run, no sync attempted', async () => {
    const runMigrations = vi.fn(async () => {});
    const syncFromDelta = vi.fn(async () => {});

    const res = await runDbInit(fakeDb, undefined, {
      runMigrations,
      syncFromDelta,
    });

    expect(runMigrations).toHaveBeenCalledOnce(); // migrations must not be skipped
    expect(syncFromDelta).not.toHaveBeenCalled();
    expect(res.syncError).toBeNull();
  });

  it('happy path — BOTH migrations and sync run → no syncError', async () => {
    const runMigrations = vi.fn(async () => {});
    const syncFromDelta = vi.fn(async () => {});

    const res = await runDbInit(fakeDb, data, {
      runMigrations,
      syncFromDelta,
    });

    expect(runMigrations).toHaveBeenCalledOnce();
    expect(syncFromDelta).toHaveBeenCalledOnce(); // sync actually reached, not silently skipped
    expect(res.syncError).toBeNull();
  });
});
