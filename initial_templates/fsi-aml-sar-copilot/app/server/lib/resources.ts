/**
 * Runtime resolution of the resources the setup job creates.
 *
 * The bundle can't know the Genie agent id at deploy time (the setup job creates it), so the job's
 * last task writes it to <catalog>.<schema>.demo_resources
 * (key, value). At boot — and lazily on first use if the warehouse was cold — the app reads that table
 * and fills in whatever the app env left empty. An explicit GENIE_SPACE_ID env value wins.
 */
import { query, T } from './sql.js';

let pending: Promise<void> | null = null;
const complete = () => !!process.env.GENIE_SPACE_ID;

async function load(): Promise<void> {
  const rows = await query(`SELECT key, value FROM ${T('demo_resources')}`);
  const kv = Object.fromEntries(rows.map((r) => [String(r.key), String(r.value ?? '')]));
  if (!process.env.GENIE_SPACE_ID && kv.genie_space_id) process.env.GENIE_SPACE_ID = kv.genie_space_id;
  console.log(`[resources] genie=${process.env.GENIE_SPACE_ID || '-'} (demo_resources)`);
}

/** Resolve the Genie agent id into process.env; retries on the next call if the lookup failed. */
export function ensureResources(): Promise<void> {
  if (complete()) return Promise.resolve();
  if (!pending) {
    pending = load().catch((e) => {
      console.warn('[resources] demo_resources lookup failed:', (e as Error).message);
      pending = null;
    });
  }
  return pending;
}
