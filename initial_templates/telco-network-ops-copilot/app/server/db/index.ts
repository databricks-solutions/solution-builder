import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { LakebasePool } from '@databricks/appkit';
import * as schema from './schema.js';

// AppKit 0.41+ hands us a LakebasePool (RoutingPool), not a literal pg.Pool.
// It implements the query/connect/end surface drizzle's node-postgres driver
// actually calls, but isn't structurally a full pg.Pool — so accept either.
// The cast keeps drizzle's typing happy; runtime is unaffected.
export function createDb(pool: Pool | LakebasePool) {
  return drizzle(pool as Pool, { schema, logger: false });
}

export type AppDb = ReturnType<typeof createDb>;
export { schema };
