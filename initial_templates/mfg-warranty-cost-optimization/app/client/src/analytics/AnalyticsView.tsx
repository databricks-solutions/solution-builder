/**
 * Cost & recovery — the VP Quality's numbers, straight from the Delta gold tables via the
 * SQL warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. monthly claims per 1,000 bikes in service, total vs AI-classified controller water ingress
 *   2. Hanlin controller lots: claims per 1,000 bike-years + E21 telemetry, with the PCN
 *   3. supplier cost recovery over the last 4 settled quarters
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { moneyK } from '@/warranty/api';
import { Pill, cn } from '@/warranty/ui';

function useChart<T>(key: string) {
  const [s, set] = useState<{ data: T[] | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    fetch(`/api/charts/${key}`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error ?? `HTTP ${r.status}`); return b.data as T[]; })
      .then((data) => set({ data, error: null }))
      .catch((e) => set({ data: null, error: (e as Error).message }));
  }, [key]);
  return s;
}

type Trend = { month: string; claims_per_1k: number; water_ingress_per_1k: number; warranty_cost: number };
type Lot = { controller_lot: string; units_built: number; water_ingress_claims: number; water_claims_per_1k_unit_years: number; e21_bikes_per_1k_connected: number; pcn_reference: string; ppap_status: string };
type Rec = { supplier_name: string; attributable_cost: number; submitted: number; recovered: number; recovery_rate_pct: number };

function TrendChart({ rows }: { rows: Trend[] }) {
  const W = 720, H = 240, L = 40, B = 28, T = 12;
  const max = Math.ceil(Math.max(1, ...rows.map((r) => r.claims_per_1k)) / 2) * 2;
  const x = (i: number) => L + (i * (W - L - 12)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (k: keyof Trend) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(r[k]))}`).join(' ');
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map((v) => (
        <g key={v}><line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{v}</text></g>
      ))}
      <path d={`${path('water_ingress_per_1k')} L${x(rows.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--brand-5)" opacity="0.18" />
      <path d={path('claims_per_1k')} fill="none" stroke="var(--primary-light)" strokeWidth="2.5" />
      <path d={path('water_ingress_per_1k')} fill="none" stroke="var(--brand-5)" strokeWidth="3" />
      {rows.map((r, i) => (
        <g key={r.month}>
          <circle cx={x(i)} cy={y(Number(r.claims_per_1k))} r="3" fill="var(--primary-light)" />
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{new Date(`${r.month.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</text>
        </g>
      ))}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const trend = useChart<Trend>('monthly_claims_rate');
  const lots = useChart<Lot>('lot_quality');
  const rec = useChart<Rec>('supplier_recovery');
  const maxLot = Math.max(1, ...(lots.data ?? []).map((l) => l.water_claims_per_1k_unit_years));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">VP Quality · Daniel Okafor</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Cost &amp; recovery</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">Claims per 1,000 bikes in service, per month</div>
            <div className="flex gap-3 text-xs"><span className="text-[var(--primary-light)] font-semibold">● All claims</span><span className="text-[var(--brand-5)] font-semibold">● Controller water ingress (AI-classified)</span></div>
          </div>
          {trend.error && <div className="mt-3 text-sm text-[var(--destructive)]">{trend.error}</div>}
          {!trend.data && !trend.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {trend.data && <TrendChart rows={trend.data} />}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Hanlin MC-48 controller lots <span className="text-xs font-normal text-[var(--muted-foreground)]">· water-ingress claims per 1,000 bike-years</span></div>
            {lots.error && <div className="mt-2 text-sm text-[var(--destructive)]">{lots.error}</div>}
            <div className="mt-3 space-y-1.5">
              {(lots.data ?? []).map((l) => (
                <div key={l.controller_lot} className="grid grid-cols-[70px_1fr_150px] items-center gap-3 text-sm">
                  <span className={cn(l.pcn_reference && 'font-semibold text-[var(--brand-5)]')}>{l.controller_lot}</span>
                  <div className="h-3 rounded-full bg-[var(--muted)]"><div className="h-3 rounded-full" style={{ width: `${Math.max(1, (l.water_claims_per_1k_unit_years / maxLot) * 100)}%`, background: l.pcn_reference ? 'var(--brand-5)' : 'var(--primary-light)' }} /></div>
                  <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">{Math.round(l.water_claims_per_1k_unit_years)} · E21 {Math.round(l.e21_bikes_per_1k_connected)}{l.pcn_reference ? ` · ${l.pcn_reference}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">E21 = connected bikes (per 1,000) that reported the controller-moisture fault. HX-2608/09 are only weeks in service — telemetry already shows it.</div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="px-5 py-3 font-semibold">Supplier recovery <span className="text-xs font-normal text-[var(--muted-foreground)]">· last 4 settled quarters</span></div>
            {rec.error && <div className="px-5 pb-3 text-sm text-[var(--destructive)]">{rec.error}</div>}
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>{['Supplier', 'Attributable', 'Submitted', 'Recovered', 'Rate'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {(rec.data ?? []).map((r) => (
                  <tr key={r.supplier_name} className={cn('border-t border-[var(--border)]', r.recovery_rate_pct < 20 && 'bg-[#FFF5F1]')}>
                    <td className="px-4 py-2 font-medium">{r.supplier_name}</td>
                    <td className="px-4 py-2 tabular-nums">{moneyK(r.attributable_cost)}</td>
                    <td className="px-4 py-2 tabular-nums">{moneyK(r.submitted)}</td>
                    <td className="px-4 py-2 tabular-nums">{moneyK(r.recovered)}</td>
                    <td className={cn('px-4 py-2 tabular-nums', r.recovery_rate_pct < 20 && 'font-semibold text-[var(--brand-5)]')}>{r.recovery_rate_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
