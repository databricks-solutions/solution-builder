/**
 * Recovery analytics — Priya Shah's (VP Customer Experience) evidence, straight from the Delta tables via the
 * SQL warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. monthly same-day re-accommodation rate, AutoProtect vs the DEN desk-priority pilot
 *   2. the method scorecard (Dec–Jan): same day, SSR overnight, misconnects, split parties, cost per pax, NPS
 *   3. Winter Storm Harlan live: AutoProtect vs the plans the desk has committed (Delta write-back)
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { Pill, cn } from '@/irops/ui';
import { money } from '@/irops/api';

function useChart<T>(key: string, tick = 0) {
  const [s, set] = useState<{ data: T[] | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    fetch(`/api/charts/${key}`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error ?? `HTTP ${r.status}`); return b.data as T[]; })
      .then((data) => set({ data, error: null }))
      .catch((e) => set({ data: null, error: (e as Error).message }));
  }, [key, tick]);
  return s;
}

type Trend = { month: string; handling_method: string; disrupted_pax: number; same_day_pct: number; cost_per_pax: number; nps: number };
type Score = { handling_method: string; events: number; disrupted_pax: number; same_day_pct: number; ssr_overnight_pct: number; misconnect_pct: number; split_pct: number; cost_per_pax: number; nps: number };
type Recovery = { flight_number: string; destination: string; pax: number; special_assistance_pax: number; onward_long_haul_pax: number; ap_same_day: number; ap_special_assistance_overnight: number; ap_misconnects: number; desk_plan_committed: boolean | string; desk_same_day: number | null; desk_misconnects: number | null; desk_partner_spend_usd: number | null; desk_total_cost_usd: number | null; autoprotect_total_cost_usd: number | null; approved_by: string | null };

const METHOD = { AUTOPROTECT: 'AutoProtect', DESK_PRIORITY_PILOT: 'DEN desk-priority pilot' } as Record<string, string>;

function TrendChart({ rows }: { rows: Trend[] }) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const W = 720, H = 240, L = 40, B = 28, T = 12;
  const x = (m: string) => L + (months.indexOf(m) * (W - L - 12)) / Math.max(1, months.length - 1);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const line = (method: string) => rows.filter((r) => r.handling_method === method).sort((a, b) => a.month.localeCompare(b.month));
  const path = (pts: Trend[]) => pts.map((r, i) => `${i ? 'L' : 'M'}${x(r.month)},${y(Number(r.same_day_pct))}`).join(' ');
  const ap = line('AUTOPROTECT'), pilot = line('DESK_PRIORITY_PILOT');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{v}%</text></g>
      ))}
      <path d={path(ap)} fill="none" stroke="var(--primary-light)" strokeWidth="2.5" />
      {ap.map((r) => <circle key={r.month} cx={x(r.month)} cy={y(Number(r.same_day_pct))} r="3" fill="var(--primary-light)" />)}
      {pilot.map((r) => <circle key={r.month} cx={x(r.month)} cy={y(Number(r.same_day_pct))} r="6" fill="var(--brand-5)" />)}
      {months.map((m) => (
        <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{new Date(`${m.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</text>
      ))}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  const trend = useChart<Trend>('irops_monthly_trend');
  const score = useChart<Score>('method_scorecard');
  const rec = useChart<Recovery>('harlan_recovery', tick);
  const committed = (rec.data ?? []).filter((r) => r.desk_plan_committed === true || r.desk_plan_committed === 'true');
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">VP Customer Experience · Priya Shah</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Recovery analytics</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">Passengers re-accommodated the same day, by IROPS event month</div>
            <div className="flex gap-3 text-xs"><span className="text-[var(--primary-light)] font-semibold">● AutoProtect</span><span className="text-[var(--brand-5)] font-semibold">● DEN desk-priority pilot</span></div>
          </div>
          {trend.error && <div className="mt-3 text-sm text-[var(--destructive)]">{trend.error}</div>}
          {!trend.data && !trend.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {trend.data && <TrendChart rows={trend.data} />}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">AutoProtect vs priority re-accommodation <span className="text-xs font-normal text-[var(--muted-foreground)]">· IROPS events Dec 2025 – Feb 2026</span></div>
          {score.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{score.error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Handling', 'Events', 'Disrupted pax', 'Same day', 'Special assist. overnight', 'Misconnects', 'Parties split', 'Cost / pax', 'NPS'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(score.data ?? []).map((r) => (
                <tr key={r.handling_method} className={cn('border-t border-[var(--border)]', r.handling_method === 'DESK_PRIORITY_PILOT' && 'bg-[#2A1A14]')}>
                  <td className="px-4 py-2 font-medium">{METHOD[r.handling_method] ?? r.handling_method}</td>
                  <td className="px-4 py-2 tabular-nums">{r.events}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(r.disrupted_pax).toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums font-semibold">{r.same_day_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.ssr_overnight_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.misconnect_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.split_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{money(r.cost_per_pax)}</td>
                  <td className={cn('px-4 py-2 tabular-nums font-semibold', Number(r.nps) < 0 ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{r.nps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">Winter Storm Harlan — plans committed by the desk <span className="text-xs font-normal text-[var(--muted-foreground)]">· Delta write-back (rebooking_plans), live</span></div>
          {rec.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{rec.error}</div>}
          {rec.data && committed.length === 0 && <div className="px-5 pb-4 text-sm text-[var(--muted-foreground)]">No plan committed yet. Approve a plan and it lands here within seconds — the same table feeds the dashboard and Genie.</div>}
          {committed.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>{['Flight', 'Pax', 'Home today: AutoProtect → desk', 'Misconnects', 'Partner spend', 'Cost: AutoProtect → desk', 'Approved by'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {committed.map((r) => (
                  <tr key={r.flight_number} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2 font-medium">{r.flight_number} → {r.destination}</td>
                    <td className="px-4 py-2 tabular-nums">{r.pax}</td>
                    <td className="px-4 py-2 tabular-nums">{r.ap_same_day} → <b className="text-[var(--success)]">{r.desk_same_day}</b></td>
                    <td className="px-4 py-2 tabular-nums">{r.ap_misconnects} → <b>{r.desk_misconnects}</b></td>
                    <td className="px-4 py-2 tabular-nums">{money(r.desk_partner_spend_usd)}</td>
                    <td className="px-4 py-2 tabular-nums">{money(r.autoprotect_total_cost_usd)} → <b>{money(r.desk_total_cost_usd)}</b></td>
                    <td className="px-4 py-2">{r.approved_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
