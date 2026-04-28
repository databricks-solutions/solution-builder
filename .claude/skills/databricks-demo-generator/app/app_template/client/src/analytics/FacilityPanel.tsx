/**
 * Facility breakdown + batch drill-down — read-only pattern-spotting view.
 *
 * Answers: "Where are the defects coming from?"
 *   - Horizontal bar per facility (width = return count).
 *   - Click a bar OR pick from the dropdown → select that facility.
 *   - Below: the top batches at that facility. Each batch has an
 *     "Open in Operations →" link that jumps to the returns queue
 *     pre-filtered on that lot.
 *
 * Data comes from Lakebase (not the warehouse) so this stays fast and
 * reflects agent actions live.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Factory } from 'lucide-react';
import { Link } from 'react-router';
import { fetchFacilityLots, fetchFacilitySummary } from '@/lib/returns';
import type { FacilityLotRow, FacilityRow } from '@/shared/types';
import { dataMutated } from '@/lib/events';

export function FacilityPanel() {
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lots, setLots] = useState<FacilityLotRow[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);

  async function reloadFacilities() {
    try {
      const rows = await fetchFacilitySummary();
      setFacilities(rows);
      setSelected((curr) => curr ?? rows[0]?.facility ?? null);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    void reloadFacilities();
    return dataMutated.subscribe(() => {
      void reloadFacilities();
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingLots(true);
    fetchFacilityLots(selected, 5)
      .then(setLots)
      .catch(() => setLots([]))
      .finally(() => setLoadingLots(false));
  }, [selected]);

  const max = useMemo(
    () => Math.max(1, ...facilities.map((f) => f.return_count)),
    [facilities],
  );

  if (facilities.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="display text-xl font-semibold tracking-tight">
            Where are the defects coming from?
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Returns by manufacturing facility. Pick one to drill into its
            worst production batches.
          </p>
        </div>
        <select
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
        >
          {facilities.map((f) => (
            <option key={f.facility} value={f.facility}>
              {f.facility} · {f.return_count.toLocaleString()}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2.5">
        {facilities.map((f) => {
          const isSelected = f.facility === selected;
          const pct = (f.return_count / max) * 100;
          return (
            <button
              key={f.facility}
              onClick={() => setSelected(f.facility)}
              className="w-full text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-28 shrink-0 flex items-center gap-1.5 text-sm">
                  <Factory
                    className={`size-3.5 ${
                      isSelected ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  />
                  <span
                    className={
                      isSelected
                        ? 'font-semibold text-foreground'
                        : 'text-foreground/80 group-hover:text-foreground'
                    }
                  >
                    {f.facility}
                  </span>
                </div>
                <div className="flex-1 h-7 rounded-md bg-muted relative overflow-hidden">
                  <div
                    className="h-full rounded-md transition-all"
                    style={{
                      width: `${pct}%`,
                      background: isSelected
                        ? 'var(--primary)'
                        : 'color-mix(in oklch, var(--primary) 55%, var(--muted))',
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-end pr-2.5 text-xs font-medium text-foreground">
                    {f.return_count.toLocaleString()}
                  </div>
                </div>
                <div className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  ${Number(f.total_refund_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Top batches · {selected}
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {loadingLots && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                Loading…
              </div>
            )}
            {!loadingLots && lots.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No batches with returns at this facility.
              </div>
            )}
            {lots.map((lot) => (
              <div
                key={lot.lot_id}
                className="px-4 py-3 flex items-center gap-4 border-t first:border-t-0 border-border"
              >
                <div className="font-mono text-sm w-40 shrink-0">
                  {lot.lot_id}
                </div>
                <div className="flex-1 min-w-0 text-sm text-muted-foreground truncate">
                  {lot.product_names ?? `${lot.product_count} products`}
                </div>
                <div className="text-sm tabular-nums w-28 text-right">
                  {lot.return_count.toLocaleString()} returns
                </div>
                <div className="w-24 text-right text-sm text-muted-foreground tabular-nums">
                  ${Number(lot.total_refund_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <Link
                  to={`/operations?lot=${encodeURIComponent(lot.lot_id)}`}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open in Operations
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
