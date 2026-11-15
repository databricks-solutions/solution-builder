#!/usr/bin/env node
// `npm run db:generate` — generate the Drizzle SQL migrations from
// server/db/schema.ts into ./drizzle/, with a DETERMINISTIC baseline.
//
// Why: drizzle/ is a build artifact (gitignored). When it is absent (fresh
// clone, forked/seeded template, a `rm -rf drizzle`), drizzle-kit generates the
// baseline from scratch with a RANDOM tag (`0000_<adjective>_<hero>`) and
// `when = Date.now()`. Drizzle's migrator applies every migration whose `when`
// is newer than the last one recorded in `drizzle.__drizzle_migrations` — so a
// regenerated baseline looks "new" to an already-migrated Lakebase DB, re-runs
// its CREATE TABLEs, fails with "relation already exists", and the redeployed
// app 503s. Here the baseline always gets the same identity (tag `0000_init`,
// pinned `when`), so regenerating it from an unchanged schema.ts is a no-op
// against an existing DB and still fully applies to a fresh one.
//
// When drizzle/ already exists, drizzle-kit runs INCREMENTALLY: it never
// renames or rewrites existing migrations — it only appends a new one (with a
// real timestamp) if schema.ts changed. Keep drizzle/ between deploys of the
// same database if you evolve the schema after the first deploy.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const OUT = 'drizzle';
const JOURNAL = `${OUT}/meta/_journal.json`;
// Pinned `when` of the baseline migration. Must stay LOWER than any real
// Date.now() a DB could have recorded, so incremental migrations (real
// timestamps) always sort after it. Never change it once shipped.
const BASELINE_WHEN = 1700000000000;

const fresh = !existsSync(JOURNAL);
const args = ['generate', '--config', 'drizzle.config.ts', ...(fresh ? ['--name', 'init'] : [])];
const r = spawnSync('drizzle-kit', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) process.exit(r.status ?? 1);

// Pin the baseline's identity (only entry 0 — incremental migrations keep
// their real timestamps).
if (existsSync(JOURNAL)) {
  const journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
  const first = journal.entries?.[0];
  if (first && first.when !== BASELINE_WHEN) {
    first.when = BASELINE_WHEN;
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 2) + '\n');
  }
}

// `CREATE SCHEMA "app"` → `CREATE SCHEMA IF NOT EXISTS "app"`: the schema may
// already exist (created by a grant script or a previous app SP).
for (const f of readdirSync(OUT).filter((n) => n.endsWith('.sql'))) {
  const p = `${OUT}/${f}`;
  const before = readFileSync(p, 'utf8');
  const after = before.split('CREATE SCHEMA "').join('CREATE SCHEMA IF NOT EXISTS "');
  if (after !== before) writeFileSync(p, after);
}
