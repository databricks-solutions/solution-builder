/**
 * Northwind Federal — AML Investigator Copilot (Databricks App server).
 *
 * Forked from the solution-builder app_template, trimmed to what this use case needs:
 *   - AppKit server() plugin (Express, static client, dev Vite middleware)
 *   - SQL warehouse access via the statement-execution REST API (lib/sql.ts):
 *       reads  : gold_alert_queue, customers, transactions, network tables
 *       writes : case_decisions, case_audit_log, sar_drafts  (Delta, UC-governed)
 *   - The SAR-drafting agent (agent/sar-agent.ts): Foundation Model API tool-calling
 *     loop over the case data + the Genie agent (AML policy documents), streamed as SSE.
 *
 * Knobs (app.yaml in prod, .env locally): DEMO_CATALOG, DEMO_SCHEMA,
 * DATABRICKS_WAREHOUSE_ID, AGENT_MODEL, DASHBOARD_ID, GENIE_SPACE_ID
 */
if (process.env.DATABRICKS_HOST) {
  let h = process.env.DATABRICKS_HOST.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(h)) h = 'https://' + h;
  process.env.DATABRICKS_HOST = h;
}

import { installLogger } from './lib/logger.js';
installLogger();

import { createApp, server } from '@databricks/appkit';
import type { NextFunction, Request, Response } from 'express';
import { registerAmlRoutes } from './routes/aml.js';
import { registerDevLogRoutes } from './routes/dev-log.js';
import { ensureResources } from './lib/resources.js';
import { dbdemosTracker } from './lib/tracker.js';

function logErrorCompact(prefix: string, err: unknown): void {
  const e = err as { message?: string; stack?: string };
  const frames = (e.stack ?? '').split('\n').filter((l) => l.trim().startsWith('at ')).slice(0, 6).join('\n');
  console.error(`${prefix} ${String(e.message ?? err).slice(0, 400)}${frames ? '\n' + frames : ''}`);
}
process.on('unhandledRejection', (r) => logErrorCompact('[unhandledRejection]', r));
process.on('uncaughtException', (e) => logErrorCompact('[uncaughtException]', e));

await createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
  // dbdemos usage tracker (page views) — first, so it sees page loads before the static client.
  app.use(dbdemosTracker(process.env.DBDEMOS_APP_ID));
      registerAmlRoutes(app);
      if (process.env.DEV_CLIENT_ERROR_LOG === '1') registerDevLogRoutes(app, logErrorCompact);
      app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
        logErrorCompact(`[500] ${req.method} ${req.path}`, err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
    });
  },
});
void ensureResources();
console.log(
  `[boot] AML Copilot ready — data ${process.env.DEMO_CATALOG}.${process.env.DEMO_SCHEMA}, warehouse ${process.env.DATABRICKS_WAREHOUSE_ID}, model ${process.env.AGENT_MODEL}`,
);
