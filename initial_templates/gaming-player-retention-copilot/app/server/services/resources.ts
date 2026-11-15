/**
 * Runtime resolution of the Genie space the setup job creates.
 *
 * The bundle can't know the Genie space id at deploy time (the setup job creates it), so the
 * job's last task writes it to <catalog>.<schema>.demo_resources (key, value). At boot — and
 * lazily before a chat turn if the warehouse was cold — the app reads that table and fills in
 * `genieSpaceId` on the config objects it is given (mutated in place, so /api/resources and the
 * chat route see the resolved id). An explicit GENIE_SPACE_ID env value always wins.
 */
import { execSql } from '../db/sync.js';

type Target = { genieSpaceId?: string };
type Data = { catalog: string; schema: string } | undefined;

let targets: Target[] = [];
let data: Data;
let pending: Promise<string> | null = null;

export function configureResources(t: Target[], d: Data) {
  targets = t;
  data = d;
}

const current = () => targets.find((t) => t.genieSpaceId)?.genieSpaceId ?? '';

async function load(): Promise<string> {
  if (!current() && data?.catalog && data?.schema && process.env.DATABRICKS_WAREHOUSE_ID) {
    const rows = await execSql<{ key: string; value: string }>(
      process.env.DATABRICKS_WAREHOUSE_ID,
      `SELECT key, value FROM \`${data.catalog}\`.\`${data.schema}\`.demo_resources`,
    );
    const id = rows.find((r) => r.key === 'genie_space_id')?.value ?? '';
    if (id) for (const t of targets) t.genieSpaceId = id;
    console.log(`[resources] genie=${id || '-'} (from ${data.schema}.demo_resources)`);
  }
  return current();
}

/** Resolved Genie space id; retries the lookup on the next call if it failed or was empty. */
export function resolvedGenieSpaceId(): Promise<string> {
  if (current()) return Promise.resolve(current());
  if (!pending) {
    pending = load()
      .catch((e) => {
        console.warn('[resources] demo_resources lookup failed:', (e as Error).message);
        return '';
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
