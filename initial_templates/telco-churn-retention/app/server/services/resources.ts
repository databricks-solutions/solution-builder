/**
 * Runtime resolution of the resources the setup job creates.
 *
 * The bundle can't know the Genie space id at deploy time (the setup job creates it), so the job's
 * last task writes it to <catalog>.<schema>.demo_resources (key, value). At boot — and lazily on
 * first use if the warehouse was cold — the app reads that table and fills in whatever app.yaml /
 * .env left empty. An explicit GENIE_SPACE_ID env value always wins.
 */
import { execWarehouseSql } from '../db/sync.js';

type DataConfig = { catalog: string; schema: string };
export type Backends = { genieSpaceId: string };

type Target = { genieSpaceId?: string };
let target: Target = {};
let data: DataConfig | undefined;
let pending: Promise<Backends> | null = null;

/** `t` is mutated in place (pass appConfig) so /api/resources sees the resolved id. */
export function configureResources(t: Target, d: DataConfig | undefined) {
  target = t;
  data = d;
}

async function load(): Promise<Backends> {
  if (!target.genieSpaceId && data) {
    const rows = await execWarehouseSql<{ key: string; value: string }>(
      `SELECT key, value FROM \`${data.catalog}\`.\`${data.schema}\`.demo_resources`,
    );
    const kv = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (kv.genie_space_id) target.genieSpaceId = kv.genie_space_id;
    console.log(`[resources] genie=${target.genieSpaceId || '-'} (from ${data.schema}.demo_resources)`);
  }
  if (!target.genieSpaceId) throw new Error('genie_space_id not found in demo_resources (has the setup job run?)');
  return { genieSpaceId: target.genieSpaceId };
}

/** Resolved backends; retries the lookup on the next call if it failed. */
export function resolvedBackends(): Promise<Backends> {
  if (target.genieSpaceId) return Promise.resolve({ genieSpaceId: target.genieSpaceId });
  if (!pending) {
    pending = load().catch((e) => {
      console.warn('[resources] demo_resources lookup failed:', (e as Error).message);
      pending = null;
      return { genieSpaceId: target.genieSpaceId ?? '' };
    });
  }
  return pending;
}
