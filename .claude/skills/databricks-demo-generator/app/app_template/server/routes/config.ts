import type { Application } from 'express';
import { getExecutionContext } from '@databricks/appkit';
import { getCurrentUserInfo } from '../lib/user.js';

/**
 * App metadata routes: /api/config, /api/me, /api/warehouse, /api/resources.
 * Stateless reads that describe "what is this app" to the client.
 */

// Configs are passed in (not read from disk again) so the caller owns the
// parse + validation step.
type Deps = {
  appConfig: {
    mlflowExperimentId?: string;
    dashboardId: string;
    /** Optional workspace resource ids exposed by /api/resources. */
    pipelineId?: string;
    warehouseId?: string;
    genieSpaceId?: string;
    masEndpointName?: string;
    kaEndpointName?: string;
    lakebaseProjectId?: string;
    appUrl?: string;
    mlModelName?: string;
    pdfVolumePath?: string;
    data?: {
      catalog: string;
      schema: string;
      tables: { returns: string; orders: string; customers: string };
    };
    branding: { appName: string };
    assistantScript?: Array<{
      label: string;
      prompt: string;
      triggerAfter?: string[];
    }>;
  };
  getAgentExperimentId: () => string | null;
};

/** One workspace resource as exposed by /api/resources. */
type ResourceEntry = { id: string; url: string };

/** Compose a deep-link URL from the workspace host + resource id. Returns
 *  an empty string if either is missing so the client can render the tile
 *  inert without an extra null check. */
function composeUrl(host: string, path: string, id: string | undefined): string {
  if (!host || !id) return '';
  return `${host}${path}${id}`;
}

/** Build the full resources map, one entry per resource. Server-side
 *  composition keeps URL templates in ONE place and the client never has
 *  to know what host it's on. */
function buildResources(
  host: string,
  cfg: Deps['appConfig'],
): Record<string, ResourceEntry> {
  const catalog = cfg.data?.catalog ?? '';
  const schema = cfg.data?.schema ?? '';
  const catalogPath = catalog && schema ? `/explore/data/${catalog}/${schema}` : '';
  const modelPath = cfg.mlModelName ? `/explore/data/models/${cfg.mlModelName.replace(/\./g, '/')}` : '';
  // pdfVolumePath looks like `/Volumes/<catalog>/<schema>/<volume>` —
  // the workspace UI maps it to `/explore/data/volumes/<catalog>/<schema>/<volume>`.
  const volumeUiPath = cfg.pdfVolumePath
    ? cfg.pdfVolumePath.replace(/^\/Volumes\//, '/explore/data/volumes/')
    : '';

  return {
    dashboard: {
      id: cfg.dashboardId ?? '',
      url: composeUrl(host, '/dashboardsv3/', cfg.dashboardId),
    },
    genie: {
      id: cfg.genieSpaceId ?? '',
      url: composeUrl(host, '/genie/rooms/', cfg.genieSpaceId),
    },
    pipeline: {
      id: cfg.pipelineId ?? '',
      url: composeUrl(host, '/pipelines/', cfg.pipelineId),
    },
    warehouse: {
      id: cfg.warehouseId ?? '',
      url: composeUrl(host, '/sql/warehouses/', cfg.warehouseId),
    },
    lakebase: {
      id: cfg.lakebaseProjectId ?? '',
      url: composeUrl(host, '/lakebase/projects/', cfg.lakebaseProjectId),
    },
    mas: {
      id: cfg.masEndpointName ?? '',
      url: composeUrl(host, '/ml/endpoints/', cfg.masEndpointName),
    },
    ka: {
      id: cfg.kaEndpointName ?? '',
      url: composeUrl(host, '/ml/endpoints/', cfg.kaEndpointName),
    },
    catalog: { id: `${catalog}.${schema}`, url: host && catalogPath ? `${host}${catalogPath}` : '' },
    model: { id: cfg.mlModelName ?? '', url: host && modelPath ? `${host}${modelPath}` : '' },
    volume: { id: cfg.pdfVolumePath ?? '', url: host && volumeUiPath ? `${host}${volumeUiPath}` : '' },
    // App URL is on a different host (*.databricksapps.com), so we don't
    // compose — it's stored verbatim.
    app: { id: cfg.appUrl ?? '', url: cfg.appUrl ?? '' },
  };
}

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

  // GET /api/resources — workspace resource ids + deep-link URLs.
  // Composed server-side from DATABRICKS_HOST + config/app.json. The
  // PlatformDiagram panel fetches this at mount and renders each tile as
  // a clickable link when the URL is non-empty.
  app.get('/api/resources', (_req, res) => {
    const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '');
    res.json(buildResources(host, deps.appConfig));
  });
}
