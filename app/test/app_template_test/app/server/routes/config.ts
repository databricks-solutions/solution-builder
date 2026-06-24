import type { Application } from 'express';
import { getExecutionContext } from '@databricks/appkit';
import { getCurrentUserInfo } from '../lib/user.js';

/**
 * App metadata routes: /api/config, /api/me, /api/warehouse.
 * Stateless reads that describe "what is this app" to the client.
 */

// Configs are passed in (not read from disk again) so the caller owns the
// parse + validation step.
type Deps = {
  appConfig: {
    mlflowExperimentId?: string;
    dashboardId: string;
    branding: { appName: string };
    assistantScript?: Array<{
      label: string;
      prompt: string;
      triggerAfter?: string[];
    }>;
  };
  getAgentExperimentId: () => string | null;
};

export function registerConfigRoutes(app: Application, deps: Deps): void {
  // GET /api/config — branding, dashboard id, MLflow links, script chain.
  // The data-backend endpoint (MAS / Genie) lives server-side ONLY; the
  // client never needs to know the name. Don't expose secrets/connection
  // strings on this endpoint.
  app.get('/api/config', (_req, res) => {
    const { appConfig, getAgentExperimentId } = deps;
    res.json({
      mlflowExperimentId: appConfig.mlflowExperimentId ?? null,
      agentMlflowExperimentId: getAgentExperimentId(),
      dashboardId: appConfig.dashboardId,
      branding: appConfig.branding,
      assistantScript: appConfig.assistantScript ?? [],
    });
  });

  // GET /api/me — who's viewing. Logic lives in lib/user.ts so it's
  // consistent with getCurrentUserEmail elsewhere.
  app.get('/api/me', (req, res) => {
    const info = getCurrentUserInfo(req);
    const ctx = getExecutionContext();
    const isUserContext = 'isUserContext' in ctx && ctx.isUserContext === true;
    res.json({ ...info, isUserContext });
  });

  // GET /api/warehouse — name + state for the warehouse the analytics
  // plugin uses. Cached for 30s: the ID never changes at runtime but
  // `state` (RUNNING / STOPPED / STARTING) does, so a forever-cache would
  // lie after a warehouse pause/resume mid-session.
  const WAREHOUSE_CACHE_TTL_MS = 30_000;
  let warehouseCache:
    | { id: string; name: string; state: string; expiresAt: number }
    | null = null;
  app.get('/api/warehouse', async (_req, res) => {
    const id = process.env.DATABRICKS_WAREHOUSE_ID;
    if (!id) {
      res.json({ id: null, name: null, state: null });
      return;
    }
    const now = Date.now();
    if (
      warehouseCache &&
      warehouseCache.id === id &&
      warehouseCache.expiresAt > now
    ) {
      const { expiresAt: _e, ...payload } = warehouseCache;
      void _e;
      res.json(payload);
      return;
    }
    const { client } = getExecutionContext();
    const w = await client.warehouses.get({ id });
    warehouseCache = {
      id,
      name: w.name ?? id,
      state: (w.state as string | undefined) ?? 'UNKNOWN',
      expiresAt: now + WAREHOUSE_CACHE_TTL_MS,
    };
    const { expiresAt: _e, ...payload } = warehouseCache;
    void _e;
    res.json(payload);
  });
}
