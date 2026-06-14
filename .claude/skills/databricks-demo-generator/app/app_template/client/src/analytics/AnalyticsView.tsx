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
import { BarChart, LineChart, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { FacilityPanel } from './FacilityPanel';
import { RtPitch } from '@/architecture/RtPitch';

export function AnalyticsView() {
  const empty = useMemo(() => ({}), []);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
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

        <RtPitch
          warehouse={
            warehouse?.name
              ? { name: warehouse.name, state: warehouse.state ?? null }
              : null
          }
          latencyMs={null}
        />

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
              colors={[BRAND_PALETTE[0]]}
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
              colors={[BRAND_PALETTE[0]]}
              height={260}
            />
          </ChartCard>
        </div>

        <FacilityPanel />

        <ChartCard title="Worst production lots" scope="By return rate" flush>
          {/* Desktop / tablet: compact custom table — appkit's DataTable
              auto-mode gives wide auto-sized columns; we want a denser
              layout where Region + Returns + Rate + Refund fit without
              overflow. Phone-only card list lives in WorstLotsMobile. */}
          <div className="hidden sm:block">
            <WorstLotsTable />
          </div>
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
 * worst_lots — phone card list + desktop dense table.
 *
 * Both renderers share the query (one fetch), the row shape, the
 * severity thresholds, and the loading/error/empty states. The only
 * thing that varies between desktop and mobile is the row layout.
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

/** Color the rate by severity. Uses --severity-* tokens so a re-theme
 *  picks them up; thresholds are hardcoded business logic. */
function rateToneClass(pct: number): string {
  if (pct >= 20) return 'text-[var(--severity-danger)]';
  if (pct >= 10) return 'text-[var(--severity-warning)]';
  return 'text-foreground';
}

const compactUsd = (n: number) =>
  '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Shared fetch + state-handling. Returns either ready data or a
 *  fallback ReactNode to render in the empty / loading / error cases. */
function useWorstLots(): { data: WorstLotRow[] } | { fallback: React.ReactNode } {
  const empty = useMemo(() => ({}), []);
  // appkit-ui types union the result across all known queries; cast to the
  // specific row shape since we know `worst_lots` returns WorstLotRow.
  const result = useAnalyticsQuery('worst_lots', empty) as unknown as {
    data: WorstLotRow[] | null;
    error: unknown;
    isLoading?: boolean;
  };
  const { data, error, isLoading } = result;
  if (error) {
    return {
      fallback: (
        <div className="px-4 py-3 text-sm text-destructive">
          Couldn't load lots: {String((error as { message?: string })?.message ?? error)}
        </div>
      ),
    };
  }
  if (isLoading || !data) {
    return {
      fallback: (
        <div className="px-4 py-6 text-sm text-muted-foreground text-center">
          Loading…
        </div>
      ),
    };
  }
  if (data.length === 0) {
    return {
      fallback: (
        <div className="px-4 py-6 text-sm text-muted-foreground text-center">
          No lots returned data.
        </div>
      ),
    };
  }
  return { data };
}

function WorstLotsMobile() {
  const r = useWorstLots();
  if ('fallback' in r) return r.fallback;
  return (
    <ul className="divide-y divide-border">
      {r.data.map((row) => (
        <li key={row.lot_id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs text-muted-foreground">
                {row.lot_id}
              </div>
              <div className="text-sm font-medium truncate mt-0.5">
                {row.product_name ?? '—'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[row.facility, row.region].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={`display text-xl font-semibold ${rateToneClass(row.return_rate_pct)}`}
              >
                {row.return_rate_pct}%
              </div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                return rate
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {row.return_count.toLocaleString()} returned ·{' '}
              {row.units_sold.toLocaleString()} sold
            </span>
            <span className="font-mono text-foreground">
              {compactUsd(row.total_refund_usd)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function WorstLotsTable() {
  const r = useWorstLots();
  if ('fallback' in r) return r.fallback;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left font-medium px-3 py-2">Lot</th>
            <th className="text-left font-medium px-3 py-2">Product</th>
            <th className="text-left font-medium px-3 py-2">Facility</th>
            <th className="text-left font-medium px-3 py-2">Region</th>
            <th className="text-right font-medium px-3 py-2">Returns</th>
            <th className="text-right font-medium px-3 py-2">Rate</th>
            <th className="text-right font-medium px-3 py-2">Refund</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {r.data.map((row) => (
            <tr key={row.lot_id} className="hover:bg-muted/40">
              <td className="px-3 py-2 font-mono text-xs">{row.lot_id}</td>
              <td className="px-3 py-2 truncate max-w-[14rem]">
                {row.product_name ?? '—'}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.facility ?? '—'}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.region ?? '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {row.return_count.toLocaleString()}
              </td>
              <td
                className={`px-3 py-2 text-right font-semibold ${rateToneClass(row.return_rate_pct)}`}
              >
                {row.return_rate_pct}%
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {compactUsd(row.total_refund_usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
