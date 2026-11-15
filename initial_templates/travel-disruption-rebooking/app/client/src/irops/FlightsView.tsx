/**
 * Disrupted flights — every Winter Storm Harlan cancellation on the desk, worst AutoProtect outcome first
 * (special-assistance passengers left overnight + missed long-haul connections), with the plan status.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { dataMutated } from '@/lib/events';
import { clock, fetchFlights, money, type FlightRow } from './api';
import { FlightStatusPill, Pill, cn } from './ui';

export function FlightsView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<FlightRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchFlights().then(setRows).catch((e) => setErr((e as Error).message)); }, [tick]);
  const total = rows?.reduce((a, r) => a + r.pax, 0) ?? 0;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">IROPS desk · Marisol Vega · Winter Storm Harlan</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Disrupted flights</h1>
            <p className="text-sm text-[var(--muted-foreground)]">{rows?.length ?? '…'} cancelled flights, {total.toLocaleString()} passengers. Sorted by what AutoProtect got most wrong — special-assistance passengers left overnight plus missed long-haul connections.</p>
          </div>
        </div>
        {err && <div className="text-sm text-[var(--destructive)]">{err}</div>}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Flight', 'Route', 'Departs', 'Pax', 'Special assist.', 'Long-haul conn.', 'Escalated', 'AutoProtect today', 'SSR overnight', 'Misconnects', 'Desk'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!rows && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={11} className="px-3 py-2"><div className="h-5 animate-pulse rounded bg-[var(--muted)]" /></td></tr>)}
              {rows?.map((r) => (
                <tr key={r.id} onClick={() => nav(`/flights/${r.id}`)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/50">
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">{r.flight_number} {r.eu_uk_261 && <Pill tone="info">{r.eu_uk_261}</Pill>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.origin} → {r.destination} <span className="text-xs text-[var(--muted-foreground)]">{r.destination_city}</span></td>
                  <td className="px-3 py-2 tabular-nums">{clock(r.sched_dep)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.pax}</td>
                  <td className="px-3 py-2 tabular-nums">{r.special_assistance}{r.umnr > 0 && <span className="ml-1 text-xs font-semibold text-[var(--brand-5)]">{r.umnr} UMNR</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{r.onward || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{r.escalated || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{r.ap_same_day} <span className="text-xs text-[var(--muted-foreground)]">({Math.round((100 * r.ap_same_day) / Math.max(1, r.pax))}%)</span></td>
                  <td className={cn('px-3 py-2 tabular-nums', r.ap_ssr_overnight > 0 && 'font-semibold text-[var(--brand-5)]')}>{r.ap_ssr_overnight}</td>
                  <td className={cn('px-3 py-2 tabular-nums', r.ap_misconnects > 0 && 'font-semibold text-[var(--brand-5)]')}>{r.ap_misconnects}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FlightStatusPill status={r.status} />
                    {r.plan_same_day != null && <div className="text-[11px] text-[var(--muted-foreground)]">plan: {r.plan_same_day} today{r.plan_partner_spend ? ` · ${money(r.plan_partner_spend)} partner` : ''}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
