import 'dotenv/config';
import type { Config } from 'drizzle-kit';

/**
 * drizzle-kit config for generating SQL migrations at dev time.
 *
 * Migrations are generated (`npm run db:generate`) into ./drizzle/ and
 * applied at app startup by server/db/migrate.ts. The migration is a BUILD
 * ARTIFACT — regenerated from server/db/schema.ts on every build/dev (wired
 * into `prebuild`/`predev`) and NOT committed (see .gitignore). This keeps the
 * DDL always in sync with schema.ts; a committed .sql would drift (edit
 * schema.ts, forget to regenerate → stale tables → boot crash). We do NOT use
 * `drizzle-kit push`.
 *
 * The dbCredentials block below is only used for `drizzle-kit introspect`
 * and similar schema-reading commands (not for migration generation).
 * Generation is schema-only and doesn't need a live connection.
 */
export default {
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['app'],
  dbCredentials: {
    host: process.env.PGHOST ?? '',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'databricks_postgres',
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    // user/password resolved by the pool at runtime via Lakebase OAuth;
    // drizzle-kit generate doesn't need them.
    user: process.env.PGUSER ?? '',
    password: '',
  },
} satisfies Config;
