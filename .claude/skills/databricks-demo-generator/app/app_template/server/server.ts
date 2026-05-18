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
 * ─────────────────────────────────────────────────────────────────────
 * REPURPOSING THIS TEMPLATE
 * ─────────────────────────────────────────────────────────────────────
 * The structural wiring (boot order, plugin set, route registration) is
 * use-case agnostic — leave it alone. Customization happens here:
 *
 *   • `config/app.json`              — branding, agent endpoint name OR
 *                                       Genie space ID, MLflow experiment
 *                                       path, dashboard id, Delta source
 *                                       tables, scripted demo prompts.
 *   • `db/schema.ts`                 — Lakebase OLTP tables (the writable
 *                                       mirror the agent + UI both use).
 *   • `db/sync.ts`                   — one-shot copy from Delta → Lakebase
 *                                       at boot. Update the table list.
 *   • `db/queries/returns.ts`        — domain queries; rename + rewrite.
 *   • `agent/refundops.ts`           — the agent itself. Rename the file
 *                                       to match your domain, update the
 *                                       import below, and rewrite tools +
 *                                       instructions.
 *   • `routes/returns.ts`            — REST endpoints for the queue. Add
 *                                       new routes for your domain.
 *
 * Cross-file: `client/src/shared/types.ts` is the single source of truth
 * for the domain types and is the FIRST thing to update when swapping
 * the data model.
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
  /** MAS serving-endpoint name. Set this OR `genieSpaceId` (one of the
   * two) — the agent registers `ask_mas` if this is set, `ask_genie`
   * otherwise. See server/agent/tools/{mas,genie}.ts. */
  masEndpointName?: string;
  /** Genie space ID (32-char hex). Set this OR `masEndpointName`.
   * The two are mutually-exclusive in the default template — if your
   * demo really needs both, edit makeTools() to register both factories. */
  genieSpaceId?: string;
  /** Pinned MLflow experiment id, used by AppHeader's "Experiment" link.
   * Optional — most demos rely on `agentMlflowExperimentPath` below to
   * auto-create a per-app experiment instead of pinning a legacy one. */
  mlflowExperimentId?: string;
  /** Workspace path where the agent's traces will be recorded. Auto-
   * created at server boot if it doesn't exist; the resulting experiment
   * id is published as `agentMlflowExperimentId` on /api/config and is
   * what the chat "View trace" deep-link points at.
   *
   * IMPORTANT: leave this set in `config/app.json`. If empty, traces have
   * nowhere to land and the chat shows "Trace pending…" forever — which
   * is also why the previous version of this template had a real value
   * baked in. The path should be unique per app (we use the app name)
   * so multiple demos in the same workspace don't share an experiment.
   *
   * Format: `/Users/<email>/<app-name>-agent-traces`
   * Example: `/Users/me@databricks.com/luxebeauty-operations-agent-traces`
   *
   * The path is created via the MLflow REST API (POST /api/2.0/mlflow/
   * experiments/create); the running app's principal must have CAN_EDIT
   * on the parent folder. In Databricks Apps the service principal owns
   * its own /Users/<sp> folder, so the standard pattern works in prod
   * too. See `lib/mlflow.ts` for the bootstrap. */
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
  plugins: [
    server({ autoStart: false }),
    // Pass full resource paths so AppKit's resource registry can resolve
    // permissions + bundle bindings (suppresses the dev-mode "missing
    // required resources" warning). The actual pg.Pool connection still
    // uses PGHOST/PGDATABASE/PGPORT/PGSSLMODE from env.
    lakebase({
      branch: process.env.LAKEBASE_BRANCH,
      database: process.env.LAKEBASE_DATABASE,
    }),
    analytics({}),
  ],
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
  // The template demo registers `ask_mas`. If your demo uses Genie
  // instead, swap masEndpointName here for genieSpaceId and update
  // refundops.ts AgentContext + makeTools() accordingly.
  if (!appConfig.masEndpointName) {
    console.warn(
      '[boot] config.masEndpointName is empty — the agent won\'t have an ask_mas tool. Set it in config/app.json, or wire ask_genie if your demo uses Genie.',
    );
  }
  registerChatRoutes(app, {
    db,
    appConfig: {
      masEndpointName: appConfig.masEndpointName ?? '',
      agentModel: appConfig.agentModel,
    },
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
  if (!appConfig.agentMlflowExperimentPath) {
    // Loud warning so this never silently breaks the "View trace" link in
    // the chat (the symptom is "Trace pending…" forever — see FeedbackRow).
    // Set `agentMlflowExperimentPath` in config/app.json. See the field
    // doc on AppConfig above for the recommended format.
    console.warn(
      '[boot] config.agentMlflowExperimentPath is empty — agent traces will NOT be recorded and the chat "View trace" link will show "Trace pending…". Set a path like "/Users/<your-email>/<app-name>-agent-traces" in config/app.json.',
    );
    return null;
  }
  const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
  if (!host) {
    console.warn('[boot] DATABRICKS_HOST not set — skipping MLflow experiment bootstrap.');
    return null;
  }
  try {
    const id = await ensureMlflowExperiment(host, appConfig.agentMlflowExperimentPath);
    console.log(`[boot +${ms()}] MLflow experiment resolved (id=${id}) — traces will land at ${appConfig.agentMlflowExperimentPath}`);
    return id;
  } catch (e) {
    console.warn(
      `[boot] MLflow experiment bootstrap failed for ${appConfig.agentMlflowExperimentPath} — "View trace" link will show "Trace pending…":`,
      (e as Error).message,
    );
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

    // Silence one specific mlflow-tracing warning that fires for every
    // Lakebase query made outside an agent turn (route handlers persisting
    // messages, list endpoints, etc.). The Lakebase pool auto-creates an
    // OTel `lakebase.query` span on every pool.query call; when there's
    // no parent mlflow trace (because the call isn't inside withSpan),
    // mlflow-tracing's exporter logs "No trace ID found for span
    // lakebase.query. Skipping." once per query.
    //
    // This is intentional behavior — those queries don't belong in an
    // agent trace — but it produces log noise on every chat-stream
    // request (~3 queries before the agent runs). Inside an agent turn,
    // queries DO get adopted via withSpan (see chat-stream/agent-stream.ts).
    const origWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === 'string' &&
        first.includes('No trace ID found for span lakebase.query')
      ) {
        return;
      }
      origWarn(...args);
    };
  }
})();
