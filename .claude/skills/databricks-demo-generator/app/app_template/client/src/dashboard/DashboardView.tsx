/**
 * Embedded Databricks AI/BI dashboard.
 *
 * Template intent: showcases that a published Lakeview / AI/BI dashboard
 * can live inside the app, same SSO, same data, one click away. Point
 * `config.dashboardId` at the dashboard you care about; the iframe handles
 * the rest. `?o=<workspace_id>` is required for the embed to attach to the
 * right workspace.
 */
import { useEffect, useState } from 'react';
import { fetchMe, fetchConfig, type Me, type AppConfig } from '@/lib/api';

export function DashboardView() {
  const [me, setMe] = useState<Me | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchMe(), fetchConfig()])
      .then(([m, c]) => {
        setMe(m);
        setCfg(c);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return <div className="p-6 text-destructive">Error: {error}</div>;
  }
  if (!me || !cfg) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!me.workspaceUrl) {
    return (
      <div className="p-6 text-destructive">
        DATABRICKS_HOST is not configured on the server.
      </div>
    );
  }

  const base = `${me.workspaceUrl.replace(/\/$/, '')}/embed/dashboardsv3/${cfg.dashboardId}`;
  const src = me.workspaceId ? `${base}?o=${me.workspaceId}` : base;

  return (
    <iframe
      src={src}
      className="w-full h-[calc(100vh-56px)] border-0"
      title="Databricks dashboard"
      allow="clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
