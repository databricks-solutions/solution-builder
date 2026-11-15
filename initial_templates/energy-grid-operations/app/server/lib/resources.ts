/**
 * Runtime resolution of the resources the setup job creates.
 *
 * The bundle can't know the Genie space id at deploy time (the setup job creates it), so the job's
 * last task writes it to <catalog>.<schema>.demo_resources (key, value). At boot — and lazily before
 * a chat turn if the first lookup failed (e.g. cold warehouse) — the app reads that table and fills
 * in whatever app config / .env left empty. An explicit GENIE_SPACE_ID env value always wins.
 */
import { execSql, fq } from './sql.js';

type Target = { genieSpaceId?: string };
let pending: Promise<void> | null = null;

async function load(target: Target): Promise<void> {
  const rows = await execSql<{ key: string; value: string }>(`SELECT key, value FROM ${fq('demo_resources')}`);
  const kv = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!target.genieSpaceId && kv.genie_space_id) target.genieSpaceId = kv.genie_space_id;
  console.log(`[resources] genie=${target.genieSpaceId || '-'} (from demo_resources)`);
}

/** Fill target.genieSpaceId from demo_resources; no-op once resolved, retried on the next call if it failed. */
export function ensureDemoResources(target: Target): Promise<void> {
  if (target.genieSpaceId) return Promise.resolve();
  if (!pending) {
    pending = load(target).catch((e) => {
      console.warn('[resources] demo_resources lookup failed:', (e as Error).message);
      pending = null;
    });
  }
  return pending;
}
