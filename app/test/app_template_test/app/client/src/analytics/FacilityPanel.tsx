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
import { Skeleton } from '@databricks/appkit-ui/react';
import { fetchFacilityLots, fetchFacilitySummary } from '@/lib/returns';
import type { FacilityLotRow, FacilityRow } from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { usePulseOnChange } from '@/lib/usePulseOnChange';

export function FacilityPanel() {
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [lots, setLots] = useState<FacilityLotRow[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);

  // Reload facilities on mount + every agent write. Cancellation flag
  // covers both paths so a stale response can't overwrite fresh data.
  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchFacilitySummary()
        .then((rows) => {
          if (cancelled) return;
          setFacilities(rows);
          setSelected((curr) => curr ?? rows[0]?.facility ?? null);
        })
        .catch((e) => {
          if (cancelled) return;
          console.error('[facility] reload failed', e);
        })
        .finally(() => {
          if (!cancelled) setLoadingFacilities(false);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Reload the selected facility's lots on selection change AND on agent
  // writes. The dataMutated refetch is a silent background swap — we only
  // flip `loadingLots` for the user-driven initial fetch (selection change),
  // never on every agent write.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingLots(true);
    function reload() {
      fetchFacilityLots(selected!, 5)
        .then((rows) => {
          if (!cancelled) setLots(rows);
        })
        .catch(() => {
          if (!cancelled) setLots([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingLots(false);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [selected]);

  const max = useMemo(
    () => Math.max(1, ...facilities.map((f) => f.return_count)),
    [facilities],
  );

  // Empty after a successful fetch — there's just no data. Hide quietly
  // (this is the "no facilities have returns" case, e.g. fresh reset).
  if (!loadingFacilities && facilities.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="display text-xl font-semibold tracking-tight">
            Where are the defects coming from?
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Returns by manufacturing facility. Pick one to drill into its
            worst production batches.
          </p>
        </div>
        {loadingFacilities ? (
          <Skeleton className="h-8 w-44 shrink-0 bg-muted" />
        ) : (
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
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2.5">
        {loadingFacilities ? (
          <div className="space-y-3 py-1">
            {['100%', '85%', '70%', '55%'].map((w) => (
              <Skeleton key={w} className="h-5 bg-muted" style={{ width: w }} />
            ))}
          </div>
        ) : (
          facilities.map((f) => (
            <FacilityBar
              key={f.facility}
              row={f}
              max={max}
              isSelected={f.facility === selected}
              onSelect={() => setSelected(f.facility)}
            />
          ))
        )}
      </div>

      {(loadingFacilities || selected) && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Top batches{selected ? ` · ${selected}` : ''}
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {(loadingFacilities || loadingLots) && (
              <div className="p-4 space-y-3">
                {['100%', '100%', '75%'].map((w, i) => (
                  <Skeleton key={i} className="h-4 bg-muted" style={{ width: w }} />
                ))}
              </div>
            )}
            {!loadingFacilities && !loadingLots && lots.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No batches with returns at this facility.
              </div>
            )}
            {!loadingFacilities && !loadingLots && lots.map((lot) => (
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

function FacilityBar({
  row: f,
  max,
  isSelected,
  onSelect,
}: {
  row: FacilityRow;
  max: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // Pulse the bar's row when its return_count moves between refetches
  // (e.g. the agent's bulk approval flipped pending rows out of this
  // facility's count). Same hook every Operations surface uses.
  const pulse = usePulseOnChange(f.return_count);
  const pct = (f.return_count / max) * 100;
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left group rounded-md ${
        pulse ? 'animate-pulse-row' : ''
      }`}
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
                : 'color-mix(in oklch, var(--primary) 22%, var(--muted))',
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
}

