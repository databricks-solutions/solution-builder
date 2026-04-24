/**
 * Server boot — the ONE place where all backend pieces get wired together.
 *
 * Template responsibilities, in order:
 *   1. Read `config/app.json` (the use-case knobs — agent endpoint, warehouse,
 *      dashboard, Delta sync tables, branding, scripted demo chain).
 *   2. Create the AppKit app with the 3 plugins we rely on:
 *        - server()     → Express, OBO auth forwarding, serve-the-client
 *        - lakebase()   → Postgres pool backed by Databricks Lakebase
 *        - analytics()  → SQL-warehouse-backed typed queries (AnalyticsView)
 *   3. Run Drizzle migrations against Lakebase (safe-to-re-run on boot).
 *   4. One-shot sync of Delta tables into the Lakebase mirror (`syncFromDelta`)
 *      so the app has an OLTP-friendly local copy of the read-only lakehouse.
 *   5. Get-or-create the MLflow experiment that will hold agent traces, then
 *      `mlflow.init(...)` so `@openai/agents` runs are recorded automatically.
 *   6. Register the Express routes (config, chat, domain CRUD, admin).
 *
 * Repurposing this template: you mostly change `config/app.json`, the
 * Delta-mirror tables referenced in `db/sync.ts`, the schema in
 * `db/schema.ts`, and the agent in `server/agent/<yourAgent>.ts`. The rest
 * of the wiring here is the same regardless of use case.
 */
import { installLogger } from './lib/logger.js';
installLogger();

import {
  createApp,
  server,
  lakebase,
  analytics,
} from '@databricks/appkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as mlflow from 'mlflow-tracing';

import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { syncFromDelta } from './db/sync.js';
import { ensureMlflowExperiment } from './lib/mlflow.js';

import { registerConfigRoutes } from './routes/config.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerReturnsRoutes } from './routes/returns.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerDevLogRoutes } from './routes/dev-log.js';

// ============================================================================
// Config
// ============================================================================

type AppConfig = {
  agentEndpointName: string;
  masId?: string;
  mlflowExperimentId?: string;
  agentMlflowExperimentPath?: string;
  agentModel?: string;
  dashboardId: string;
  branding: { appName: string };
  assistantScript?: Array<{
    label: string;
    prompt: string;
    triggerAfter?: string[];
  }>;
  data?: {
    catalog: string;
    schema: string;
    tables: {
      returns: string;
      orderItems: string;
      orders: string;
      customers: string;
      products: string;
      productionLots: string;
    };
  };
};

const appConfig = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../config/app.json'),
    'utf8',
  ),
) as AppConfig;

// Per-process cache: which payload shape each MAS endpoint expects.
const endpointFormatCache = new Map<string, 'agent' | 'chat_completion'>();

// Populated by ensureMlflowExperiment() below; read by /api/config.
let agentExperimentId: string | null = null;

// ============================================================================
// Error logging — compact by default so bulk-insert failures (DrizzleQueryError
// with thousands of params) don't flood the terminal.
// ============================================================================

function logErrorCompact(prefix: string, err: unknown): void {
  const e = err as {
    name?: string;
    message?: string;
    stack?: string;
    cause?: { code?: string; detail?: string; constraint?: string; table?: string };
    query?: string;
  };
  // Drizzle stuffs the full query + every parameter value into err.message,
  // which can be 100k+ chars on bulk inserts — truncate everything hard.
  const parts = [truncate(e.message ?? String(err), 300)];
  if (e.cause?.code) parts.push(`pg=${e.cause.code}`);
  if (e.cause?.constraint) parts.push(`constraint=${e.cause.constraint}`);
  if (e.cause?.detail) parts.push(`detail=${truncate(e.cause.detail, 200)}`);
  if (e.query) parts.push(`query=${truncate(e.query, 200)}`);

  // Print the header + stack frames in a SINGLE console.error call so the
  // logger emits one timestamp/level prefix with indented continuation lines.
  // Strip the leading "Name: message" lines from e.stack (Node duplicates the
  // message at the top) — we already printed the message above.
  const header = `${prefix} ${parts.join(' | ')}`;
  const frames = e.stack
    ? e.stack
        .split('\n')
        .filter((l) => l.trimStart().startsWith('at '))
        .slice(0, 12)
        .map((l) => truncate(l.trimStart(), 300))
        .join('\n')
    : '';
  console.error(frames ? `${header}\n${frames}` : header);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s;
}

process.on('unhandledRejection', (reason) => {
  logErrorCompact('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  logErrorCompact('[uncaughtException]', err);
});

// ============================================================================
// Boot
// ============================================================================

const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

const appkit = await createApp({
  plugins: [server({ autoStart: false }), lakebase(), analytics({})],
});
console.log(`[boot +${ms()}] AppKit created`);

const db = createDb(appkit.lakebase.pool);

// ============================================================================
// Routes — register immediately so server can start while DB catches up.
// ============================================================================

appkit.server.extend((app) => {
  registerConfigRoutes(app, {
    appConfig,
    getAgentExperimentId: () => agentExperimentId,
  });
  registerChatRoutes(app, {
    db,
    appConfig: {
      agentEndpointName: appConfig.agentEndpointName,
      agentModel: appConfig.agentModel,
    },
    formatCache: endpointFormatCache,
  });
  registerReturnsRoutes(app, { db });
  registerActivityRoutes(app, { db });
  registerAdminRoutes(app, { db, data: appConfig.data });

  if (process.env.DEV_CLIENT_ERROR_LOG === '1') {
    registerDevLogRoutes(app, logErrorCompact);
    console.log('[boot] DEV_CLIENT_ERROR_LOG=1 → /api/log/client-error enabled');
  }

  // Global error handler — Express 5 forwards unhandled async rejections
  // here automatically, so routes don't need individual try/catch blocks.
  // Logs a compact summary; huge params/queries (e.g. DrizzleQueryError with
  // 12k-param bulk inserts) would otherwise flood the terminal and crash it.
  app.use(
    (
      err: Error,
      req: import('express').Request,
      res: import('express').Response,
      _next: import('express').NextFunction,
    ) => {
      logErrorCompact(`[500] ${req.method} ${req.path}`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    },
  );
});

await appkit.server.start();
console.log(`[boot +${ms()}] Server listening — background init in progress…`);

// ============================================================================
// Background init — migrations, sync, MLflow run after server is up.
// Requests that hit the DB before migrations finish will fail; that's fine
// for dev — the UI will retry on next navigation.
// ============================================================================

// Resolve MLflow experiment ID (HTTP call) in parallel with DB init,
// but defer mlflow.init() until after sync — otherwise the SDK instruments
// sync queries that have no parent span and produces noisy warnings.
const mlflowIdPromise = (async () => {
  if (!appConfig.agentMlflowExperimentPath) return null;
  const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
  if (!host) return null;
  try {
    const id = await ensureMlflowExperiment(host, appConfig.agentMlflowExperimentPath);
    console.log(`[boot +${ms()}] MLflow experiment resolved (id=${id})`);
    return id;
  } catch (e) {
    console.warn('[boot] MLflow experiment failed — "Agent traces" link will be hidden:', (e as Error).message);
    return null;
  }
})();

// Migrations → sync → then activate MLflow tracing.
(async () => {
  try {
    await runMigrations(db);
    console.log(`[boot +${ms()}] Migrations up to date`);
    if (appConfig.data) {
      await syncFromDelta(db, appConfig.data);
      console.log(`[boot +${ms()}] Delta sync done`);
    }
  } catch (e) {
    logErrorCompact('[boot] DB init failed:', e);
  }
  // Now safe to enable tracing — sync queries are done.
  agentExperimentId = await mlflowIdPromise;
  if (agentExperimentId) {
    mlflow.init({ trackingUri: 'databricks', experimentId: agentExperimentId });
    console.log(`[boot +${ms()}] MLflow tracing active`);
  }
})();
