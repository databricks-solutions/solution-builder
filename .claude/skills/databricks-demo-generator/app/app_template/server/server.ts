/**
 * Server boot — the ONE place where all backend pieces get wired together.
 *
 * Template responsibilities, in order:
 *   1. Read `config/app.json` (the use-case knobs — agent endpoint, warehouse,
 *      dashboard, Delta sync tables, story copy).
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
  hero?: unknown;
  story?: unknown;
  starterQuestions?: string[];
  featuredAction?: unknown;
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
// Boot
// ============================================================================

const appkit = await createApp({
  plugins: [server({ autoStart: false }), lakebase(), analytics({})],
});

const db = createDb(appkit.lakebase.pool);
await runMigrations(db);
console.log('[app] Drizzle migrations up to date');

if (appConfig.data) {
  await syncFromDelta(db, appConfig.data);
} else {
  console.warn('[app] No `data` section in config/app.json — skipping Delta sync');
}

if (appConfig.agentMlflowExperimentPath) {
  const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
  if (host) {
    try {
      agentExperimentId = await ensureMlflowExperiment(
        host,
        appConfig.agentMlflowExperimentPath,
      );
      console.log(
        `[app] MLflow experiment ready: ${appConfig.agentMlflowExperimentPath} (id=${agentExperimentId})`,
      );
      // Wire the TS MLflow tracing SDK at the experiment we just resolved so
      // every OpenAI Agents SDK run (and any withSpan around tool execs)
      // lands in this experiment's Traces tab.
      mlflow.init({
        trackingUri: 'databricks',
        experimentId: agentExperimentId,
      });
      console.log('[app] mlflow-tracing initialized');
    } catch (e) {
      console.warn(
        '[app] Failed to resolve MLflow experiment — "Agent traces" link will be hidden:',
        (e as Error).message,
      );
    }
  }
}

// ============================================================================
// Routes
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
});

await appkit.server.start();
