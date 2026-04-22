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
import { BarChart, LineChart, DataTable } from '@databricks/appkit-ui/react';
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
      <div className="max-w-6xl mx-auto px-8 py-10 space-y-10">
        <div className="flex items-start justify-between gap-6">
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
                      ? 'bg-green-500'
                      : 'bg-amber-500'
                  }`}
                />
              )}
            </div>
          )}
        </div>

        <FacilityPanel />

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-xl font-semibold tracking-tight">
              Top products by return count
            </h2>
            <span className="text-xs text-muted-foreground">All time</span>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <BarChart
              queryKey="returns_by_product"
              parameters={empty}
              xKey="product_name"
              yKey="return_count"
              height={360}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-xl font-semibold tracking-tight">
              Daily refund value
            </h2>
            <span className="text-xs text-muted-foreground">Last 30 days</span>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <LineChart
              queryKey="daily_refund_trend"
              parameters={empty}
              xKey="return_date"
              yKey="total_refund_usd"
              height={280}
              smooth
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="display text-xl font-semibold tracking-tight">
            Worst production lots
          </h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <DataTable
              queryKey="worst_lots"
              parameters={empty}
              filterColumn="lot_id"
              filterPlaceholder="Filter by lot…"
              pageSize={10}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
