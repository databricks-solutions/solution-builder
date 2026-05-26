/**
 * "Where the affected customers live" — geographic breakdown of the
 * current queue (scoped to the same status/lot filter as the table).
 *
 * Each country renders as a horizontal stacked bar:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ premium (CS)  premium (hidden)    standard           │
 *   └──────────────────────────────────────────────────────┘
 * Total count + premium % on the right; click to filter the queue
 * to that country.
 *
 * Designed as a panel, not a literal map: a SVG world map would need a
 * geo library (leaflet/d3-geo/react-simple-maps), the table data is
 * country-coded (ISO-2), and a sorted list with stacked bars conveys
 * the same "where is the impact concentrated" story without the dep.
 * If the demo needs a true world map, swap the panel for the AI/BI
 * Dashboard's `/dashboard` route — it ships a choropleth on the same
 * Delta data.
 */
import { useEffect, useState } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { fetchCountryBreakdown } from '@/lib/returns';
import { dataMutated } from '@/lib/events';
import type { CountryBucket, ReturnStatus } from '@/shared/types';

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  FR: 'France',
  GB: 'United Kingdom',
  DE: 'Germany',
  IT: 'Italy',
  ES: 'Spain',
  JP: 'Japan',
  AU: 'Australia',
  KR: 'South Korea',
  SG: 'Singapore',
};

function flag(iso: string): string {
  if (iso.length !== 2) return '🌐';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return (
    String.fromCodePoint(A + (iso.charCodeAt(0) - a)) +
    String.fromCodePoint(A + (iso.charCodeAt(1) - a))
  );
}

type Props = {
  status: ReturnStatus | 'all';
  lot: string;
  selectedCountry: string | null;
  onCountrySelect: (country: string | null) => void;
};

export function CountryPanel({
  status,
  lot,
  selectedCountry,
  onCountrySelect,
}: Props) {
  const [rows, setRows] = useState<CountryBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCountryBreakdown({
      status: status === 'all' ? undefined : status,
      lot: lot || undefined,
    })
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [status, lot]);

  // Refetch whenever the agent writes to the queue — keeps the panel
  // in sync with the bulk-tool's tier flips (premium % per country
  // can change as predictions land).
  useEffect(() => {
    return dataMutated.subscribe(() => {
      fetchCountryBreakdown({
        status: status === 'all' ? undefined : status,
        lot: lot || undefined,
      })
        .then(setRows)
        .catch((e) => setError((e as Error).message));
    });
  }, [status, lot]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Couldn't load country breakdown: {error}
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
        <RefreshCw className="size-3.5 animate-spin" />
        Loading geographic breakdown…
      </div>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            Where the affected customers live
          </h3>
        </div>
        <div className="text-xs text-muted-foreground">
          Click a country to filter the queue
        </div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const pctPremium =
            r.total > 0 ? Math.round((r.premium / r.total) * 100) : 0;
          const labeledFrac = r.premium > 0 ? r.premium_labeled / r.total : 0;
          const hiddenFrac = r.premium > 0 ? r.premium_hidden / r.total : 0;
          const standardFrac = r.total > 0 ? (r.total - r.premium) / r.total : 0;
          const widthFrac = r.total / maxTotal;
          const active = selectedCountry === r.country;
          return (
            <li key={r.country}>
              <button
                type="button"
                onClick={() => onCountrySelect(active ? null : r.country)}
                className={`w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors ${
                  active ? 'bg-primary/8' : ''
                }`}
                title={`${r.total} affected · ${r.premium} premium (${r.premium_labeled} CS-tagged + ${r.premium_hidden} hidden)`}
              >
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-base shrink-0" aria-hidden>
                    {flag(r.country)}
                  </span>
                  <span
                    className={`shrink-0 w-32 truncate ${
                      active ? 'font-semibold text-foreground' : 'text-foreground'
                    }`}
                  >
                    {COUNTRY_NAMES[r.country] ?? r.country}
                  </span>
                  <div
                    className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden flex"
                    style={{ maxWidth: `${Math.max(20, widthFrac * 100)}%` }}
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${labeledFrac * 100}%` }}
                      title={`${r.premium_labeled} CS-tagged premium`}
                    />
                    <div
                      className="h-full bg-primary/55"
                      style={{ width: `${hiddenFrac * 100}%` }}
                      title={`${r.premium_hidden} hidden premium (model-found)`}
                    />
                    <div
                      className="h-full bg-muted-foreground/30"
                      style={{ width: `${standardFrac * 100}%` }}
                      title={`${r.total - r.premium} standard`}
                    />
                  </div>
                  <div className="shrink-0 text-xs font-mono tabular-nums text-muted-foreground w-24 text-right">
                    {r.total} · {pctPremium}% prem
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-primary" />
          premium · CS-tagged
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-primary/55" />
          premium · hidden (model)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-muted-foreground/30" />
          standard
        </span>
      </div>
    </div>
  );
}
