/**
 * Embedded Databricks AI/BI dashboard.
 *
 * Template intent: showcases that a published Lakeview / AI/BI dashboard
 * can live inside the app, same SSO, same data, one click away. Point
 * `config.dashboardId` at the dashboard you care about; the iframe handles
 * the rest. `?o=<workspace_id>` is required for the embed to attach to the
 * right workspace.
 *
 * The "Open in Databricks" pill jumps to the standalone published dashboard
 * (Databricks One view) — same data, full-screen, no app chrome.
 */
import { ArrowUpRight } from 'lucide-react';
import { useSession } from '@/lib/api';

export function DashboardView() {
  const { me, config: cfg, meError, configError } = useSession();
  const error = meError ?? configError;

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

  const workspaceBase = me.workspaceUrl.replace(/\/$/, '');
  const embedBase = `${workspaceBase}/embed/dashboardsv3/${cfg.dashboardId}`;
  const src = me.workspaceId ? `${embedBase}?o=${me.workspaceId}` : embedBase;

  // Standalone published view — Databricks One layout (full-screen, no
  // app chrome). isDbOne=true unlocks the polished viewer; utm_source
  // matches what the Databricks One launcher uses.
  const standaloneUrl = (() => {
    const path = `${workspaceBase}/dashboardsv3/${cfg.dashboardId}/published`;
    const params = new URLSearchParams({
      isDbOne: 'true',
      utm_source: 'databricks-one',
    });
    if (me.workspaceId) params.set('o', me.workspaceId);
    return `${path}?${params.toString()}`;
  })();

  return (
    <div className="relative h-[calc(100vh-56px)]">
      <iframe
        src={src}
        className="w-full h-full border-0"
        title="Databricks dashboard"
        allow="clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
      <a
        href={standaloneUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:border-foreground/30 hover:shadow transition-all"
        title="Open this dashboard standalone in Databricks One"
      >
        Open in Databricks
        <ArrowUpRight className="size-3.5" />
      </a>
    </div>
  );
}
