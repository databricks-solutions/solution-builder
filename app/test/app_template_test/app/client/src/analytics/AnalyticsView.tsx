/**
 * Analytics — warehouse-backed charts.
 *
 * Template intent: surfaces the "lakehouse analytics" half of the story.
 * Charts here run through AppKit's `analytics` plugin — queries live in
 * `app/analytics/*.sql`, typed at build time, executed against the SQL
 * warehouse configured in `config/app.json`. Typegen + caching come for
 * free from the plugin.
 *
 * We also show the warehouse name + state in the header row — reminding
 * the viewer these numbers are not a static mock, they're a live
 * Databricks warehouse query against the Delta lakehouse.
 *
 * Repurposing: add/remove SQL files under `app/analytics/`, rebuild to
 * regenerate types, then reference them in `<BarChart queryName=... />`.
 */
import { useEffect, useMemo, useState } from 'react';
import { BarChart, LineChart, DataTable, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { Database } from 'lucide-react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { FacilityPanel } from './FacilityPanel';

export function AnalyticsView() {
  const empty = useMemo(() => ({}), []);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Operations analytics
            </div>
            <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
              Where the returns are coming from.
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              Live queries against the SQL warehouse — the same numbers the
              assistant reasons about, on a single page. Use the queue to take
              action; use this page to spot patterns.
            </p>
          </div>
          {warehouse?.id && (
            <div
              className="shrink-0 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm"
              title={`Warehouse id: ${warehouse.id}`}
            >
              <Database className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Warehouse</span>
              <span className="font-medium">{warehouse.name}</span>
              {warehouse.state && (
                <span
                  className={`inline-block size-1.5 rounded-full ${
                    warehouse.state === 'RUNNING'
                      ? 'bg-[var(--status-running)]'
                      : 'bg-[var(--status-idle)]'
                  }`}
                />
              )}
            </div>
          )}
        </div>

        {/* Top row: two charts side-by-side. Trend (wider) + product mix. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <ChartCard
            title="Daily refund value"
            scope="Last 30 days"
            className="lg:col-span-3"
          >
            <LineChart
              queryKey="daily_refund_trend"
              parameters={empty}
              xKey="return_date"
              yKey="total_refund_usd"
              height={260}
              smooth
            />
          </ChartCard>

          <ChartCard
            title="Top products by returns"
            scope="All time"
            className="lg:col-span-2"
          >
            <BarChart
              queryKey="returns_by_product"
              parameters={empty}
              xKey="product_name"
              yKey="return_count"
              height={260}
            />
          </ChartCard>
        </div>

        <FacilityPanel />

        <ChartCard title="Worst production lots" scope="By return rate" flush>
          {/* Desktop / tablet: paginated table with column-level filter. */}
          <div className="hidden sm:block">
            <DataTable
              queryKey="worst_lots"
              parameters={empty}
              filterColumn="lot_id"
              filterPlaceholder="Filter by lot…"
              pageSize={10}
            />
          </div>
          {/* Phone: card list — same data, no horizontal scroll. */}
          <div className="sm:hidden">
            <WorstLotsMobile />
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

/**
 * Wraps a chart/table in a bordered card with a compact header (title +
 * scope chip). Cuts the wall-of-H2-text the page used to have and gives
 * every analytics block a consistent frame. `flush` removes inner padding
 * for components that draw their own (e.g. DataTable).
 */
function ChartCard({
  title,
  scope,
  className,
  flush,
  children,
}: {
  title: string;
  scope?: string;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card overflow-hidden ${className ?? ''}`}
    >
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {scope && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {scope}
          </span>
        )}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </div>
  );
}

/**
 * Phone-only renderer for the worst_lots query.
 *
 * Same data as the desktop DataTable, but one card per lot so all fields
 * are visible without horizontal scroll. The return-rate-% is the headline
 * (right side, big) since the table is sorted by it.
 *
 * Calls `useAnalyticsQuery` directly with the same `worst_lots` query key,
 * so type-safety + parameter binding stay identical to the DataTable.
 */
type WorstLotRow = {
  lot_id: string;
  product_name: string | null;
  facility: string | null;
  region: string | null;
  return_count: number;
  units_sold: number;
  return_rate_pct: number;
  total_refund_usd: number;
};

function WorstLotsMobile() {
  const empty = useMemo(() => ({}), []);
  const { data, isLoading, error } = useAnalyticsQuery<WorstLotRow>(
    'worst_lots',
    empty,
  );

  if (error) {
    return (
      <div className="px-4 py-3 text-sm text-destructive">
        Couldn't load lots: {String((error as Error).message ?? error)}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        No lots returned data.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {data.map((r) => {
        // Color the rate badge by severity — same thresholds as the
        // desktop anger column.
        const rateTone =
          r.return_rate_pct >= 20
            ? 'text-destructive'
            : r.return_rate_pct >= 10
              ? 'text-amber-600'
              : 'text-foreground';
        return (
          <li key={r.lot_id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground">
                  {r.lot_id}
                </div>
                <div className="text-sm font-medium truncate mt-0.5">
                  {r.product_name ?? '—'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {[r.facility, r.region].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`display text-xl font-semibold ${rateTone}`}>
                  {r.return_rate_pct}%
                </div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  return rate
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {r.return_count.toLocaleString()} returned ·{' '}
                {r.units_sold.toLocaleString()} sold
              </span>
              <span className="font-mono text-foreground">
                ${Number(r.total_refund_usd).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
