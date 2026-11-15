/**
 * Grid Ops Copilot — server boot.
 *
 *   1. Read config/app.json (JSONC, ${ENV} placeholders substituted).
 *   2. AppKit app with the server() plugin (Express, OBO header forwarding, serves client/dist).
 *   3. Routes: /api/config + /api/me + /api/warehouse (routes/config.ts), chat (routes/chat.ts,
 *      in-memory conversations), grid domain + write-back (routes/grid.ts), client error log.
 *   4. Background: get-or-create the MLflow experiment for agent traces, then mlflow.init.
 *
 * Data: every domain read/write goes through the SQL warehouse (lib/sql.ts) against the Delta
 * tables in ${DEMO_CATALOG}.${DEMO_SCHEMA}. The durable write-back is `operator_actions`.
 * (Forked from the solution-builder app_template; its Lakebase mirror was dropped because
 * this demo's only write is one audit row per approved action.)
 */
if (process.env.DATABRICKS_HOST) {
  let h = process.env.DATABRICKS_HOST.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(h)) h = 'https://' + h;
  process.env.DATABRICKS_HOST = h;
}

import { installLogger } from './lib/logger.js';
installLogger();

import { createApp, server, getExecutionContext } from '@databricks/appkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import * as mlflow from 'mlflow-tracing';

import { createDb } from './db/index.js';
import { ensureMlflowExperiment } from './lib/mlflow.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerGridRoutes } from './routes/grid.js';
import { registerDevLogRoutes } from './routes/dev-log.js';
import { resetActions } from './grid/queries.js';
import { ensureDemoResources } from './lib/resources.js';
import { dbdemosTracker } from './lib/tracker.js';

type AppConfig = {
  /** dbdemos tracker app id (unique per demo); empty disables tracking. */
  dbdemosAppId?: string;
  genieSpaceId?: string;
  agentModel?: string;
  mlflowExperimentId?: string;
  agentMlflowExperimentPath?: string;
  dashboardId: string;
  warehouseId?: string;
  appUrl?: string;
  branding: { appName: string };
  assistantScript?: Array<{ label: string; prompt: string; triggerAfter?: string[] }>;
  data: { catalog: string; schema: string };
};

const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../config/app.json');
function loadAppConfig(): AppConfig {
  let raw = readFileSync(CONFIG_PATH, 'utf8');
  raw = raw.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::([^}]*))?\}/g, (_, name, dflt) => {
    const v = process.env[name];
    return v !== undefined && v !== '' ? v : (dflt ?? '');
  });
  const cfg = parseJsonc(raw, [], { allowTrailingComma: true }) as AppConfig;
  if (!cfg?.branding?.appName) throw new Error(`[config] ${CONFIG_PATH}: branding.appName is required`);
  process.env.DEMO_CATALOG ||= cfg.data?.catalog;
  process.env.DEMO_SCHEMA ||= cfg.data?.schema;
  // Deployed: the platform injects this app's own URL.
  cfg.appUrl ||= process.env.DATABRICKS_APP_URL ?? '';
  // GENIE_SPACE_ID=auto (bundle default) → resolved from demo_resources (lib/resources.ts).
  if (cfg.genieSpaceId === 'auto') cfg.genieSpaceId = '';
  return cfg;
}
const appConfig = loadAppConfig();

function logErrorCompact(prefix: string, err: unknown): void {
  const e = err as { message?: string; stack?: string };
  const frames = (e.stack ?? '').split('\n').filter((l) => l.trimStart().startsWith('at ')).slice(0, 8).join('\n');
  console.error(`${prefix} ${String(e.message ?? err).slice(0, 300)}${frames ? `\n${frames}` : ''}`);
}
process.on('unhandledRejection', (r) => logErrorCompact('[unhandledRejection]', r));
process.on('uncaughtException', (e) => logErrorCompact('[uncaughtException]', e));

let agentExperimentId: string | null = null;
const db = createDb();

await createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
  // dbdemos usage tracker (page views) — first, so it sees page loads before the static client.
  app.use(dbdemosTracker(appConfig.dbdemosAppId));
      registerConfigRoutes(app, { appConfig, getAgentExperimentId: () => agentExperimentId });
      // Genie space id: env wins; otherwise read from <schema>.demo_resources (written by the setup job).
      // Resolved at boot, and again before a chat turn if that first lookup failed.
      void ensureDemoResources(appConfig);
      app.use('/api/chat/stream', (_req, _res, next) => { void ensureDemoResources(appConfig).then(() => next()); });
      registerChatRoutes(app, {
        db,
        appConfig: { get genieSpaceId() { return appConfig.genieSpaceId ?? ''; }, agentModel: appConfig.agentModel },
      });
      registerGridRoutes(app);
      registerDevLogRoutes(app, logErrorCompact);
      // Demo reset (header "Reset demo"): clear the action log + in-memory chats.
      app.post('/api/admin/reset', async (_req, res) => {
        try {
          await resetActions();
          db.conversations.clear();
          db.messages.clear();
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ error: (e as Error).message });
        }
      });
    });
    void initMlflow();
  },
});
console.log('[boot] Grid Ops Copilot listening');

// mlflow-tracing logs a harmless span-upload failure (trace metadata is still recorded) from two
// call sites: "Trace data upload failed for <id>:" and "Failed to export trace <id>:", both wrapping
// "Failed to upload to …". Match that exact shape so no other error is hidden; note it once.
let mlflowUploadErrorSeen = false;
const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const prefix = typeof args[0] === 'string' ? args[0] : '';
  const wrapped =
    args[1] instanceof Error ? args[1].message : typeof args[1] === 'string' ? args[1] : '';
  if (
    (prefix.startsWith('Trace data upload failed for') || prefix.startsWith('Failed to export trace')) &&
    wrapped.startsWith('Failed to upload to')
  ) {
    if (!mlflowUploadErrorSeen) {
      mlflowUploadErrorSeen = true;
      console.log('[mlflow] trace span upload to workspace storage failed (harmless: trace metadata is still recorded)');
    }
    return;
  }
  origError(...args);
};

async function initMlflow() {
  const appName = (process.env.DATABRICKS_APP_NAME ?? '').trim();
  const path = appConfig.agentMlflowExperimentPath
    || (appName ? `/Shared/solution_builder/${appName}-agent-traces` : '');
  const host = process.env.DATABRICKS_HOST ?? '';
  if (!path || !host) {
    console.warn('[boot] no MLflow experiment path — agent traces disabled');
    return;
  }
  try {
    agentExperimentId = await ensureMlflowExperiment(host, path);
    const { client } = getExecutionContext();
    const h = new Headers();
    await client.config.authenticate(h);
    const token = /^Bearer\s+(.+)$/i.exec(h.get('Authorization') ?? '')?.[1];
    mlflow.init({
      trackingUri: 'databricks',
      experimentId: agentExperimentId,
      // Deployed: the SDK resolves the app SP from DATABRICKS_CLIENT_ID/SECRET — passing a token as well
      // makes the exporter fail with "more than one authorization method". Locally, pass the profile token.
      host,
      ...(token && !process.env.DATABRICKS_CLIENT_ID ? { databricksToken: token } : {}),
    });
    console.log(`[boot] MLflow tracing active → ${path} (${agentExperimentId})`);
  } catch (e) {
    console.warn(`[boot] MLflow bootstrap failed for ${path}:`, (e as Error).message);
  }
}
