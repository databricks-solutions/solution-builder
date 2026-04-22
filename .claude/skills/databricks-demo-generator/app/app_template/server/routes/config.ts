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
    agentEndpointName: string;
    mlflowExperimentId?: string;
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
  };
  getAgentExperimentId: () => string | null;
};

export function registerConfigRoutes(app: Application, deps: Deps): void {
  // GET /api/config — story, branding, agent endpoint, dashboard id, ...
  app.get('/api/config', (_req, res) => {
    const { appConfig, getAgentExperimentId } = deps;
    res.json({
      agentEndpointName: appConfig.agentEndpointName,
      mlflowExperimentId: appConfig.mlflowExperimentId ?? null,
      agentMlflowExperimentId: getAgentExperimentId(),
      dashboardId: appConfig.dashboardId,
      branding: appConfig.branding,
      hero: appConfig.hero,
      story: appConfig.story,
      starterQuestions: appConfig.starterQuestions ?? [],
      featuredAction: appConfig.featuredAction ?? null,
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

  // GET /api/warehouse — name for the warehouse the analytics plugin uses.
  // One-shot cache: warehouse ID can't change at runtime so we resolve the
  // name once.
  let warehouseCache: { id: string; name: string; state: string } | null = null;
  app.get('/api/warehouse', async (_req, res) => {
    try {
      const id = process.env.DATABRICKS_WAREHOUSE_ID;
      if (!id) {
        res.json({ id: null, name: null, state: null });
        return;
      }
      if (warehouseCache && warehouseCache.id === id) {
        res.json(warehouseCache);
        return;
      }
      const { client } = getExecutionContext();
      const w = await client.warehouses.get({ id });
      warehouseCache = {
        id,
        name: w.name ?? id,
        state: (w.state as string | undefined) ?? 'UNKNOWN',
      };
      res.json(warehouseCache);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
