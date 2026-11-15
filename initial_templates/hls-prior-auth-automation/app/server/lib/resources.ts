/**
 * Runtime resolution of the resources the setup job creates.
 *
 * The bundle can't know the Genie agent id at deploy time (the setup job creates it), so the job's
 * last task (src/deploy/export_resources.py) writes it to <catalog>.<schema>.demo_resources (key, value). At boot — and lazily on first use if
 * the warehouse was cold — the app reads that table and fills in whatever app config / .env left
 * empty. An explicit GENIE_SPACE_ID env value always wins.
 */
import { execSql, type DataConfig } from '../db/sync.js';

export type Backends = { genieSpaceId: string };

type Target = { genieSpaceId?: string };
let target: Target = {};
let data: DataConfig | undefined;
let pending: Promise<Backends> | null = null;

/** `t` is mutated in place (pass appConfig so /api/resources sees the resolved ids). */
export function configureResources(t: Target, d: DataConfig | undefined) {
  target = t;
  data = d;
}

async function load(): Promise<Backends> {
  if (!target.genieSpaceId && data && process.env.DATABRICKS_WAREHOUSE_ID) {
    const rows = await execSql<{ key: string; value: string }>(
      process.env.DATABRICKS_WAREHOUSE_ID,
      `SELECT key, value FROM ${data.catalog}.${data.schema}.demo_resources`,
    );
    const kv = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!target.genieSpaceId && kv.genie_space_id) target.genieSpaceId = kv.genie_space_id;
    console.log(`[resources] genie=${target.genieSpaceId || '-'} (from ${data.schema}.demo_resources)`);
  }
  return { genieSpaceId: target.genieSpaceId ?? '' };
}

/** Resolved backends; retries the lookup on the next call if it failed. */
export function resolvedBackends(): Promise<Backends> {
  if (target.genieSpaceId) {
    return Promise.resolve({ genieSpaceId: target.genieSpaceId });
  }
  if (!pending) {
    pending = load().catch((e) => {
      console.warn('[resources] demo_resources lookup failed:', (e as Error).message);
      pending = null;
      return { genieSpaceId: target.genieSpaceId ?? '' };
    });
  }
  return pending;
}
