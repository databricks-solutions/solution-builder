/**
 * Analytics — the program director's two numbers, straight from the Delta gold
 * tables via the SQL warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. monthly SNAP 30-day timeliness, Tamarack vs the rest of the state
 *   2. the county scorecard (timeliness, procedural denials, approval, backlog per worker)
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { Pill, cn } from '@/cases/ui';

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

type Trend = { month: string; tamarack_on_time_pct: number; rest_of_state_on_time_pct: number };
type Score = { county: string; region_type: string; snap_on_time_pct: number; median_days: number; procedural_denial_pct: number; approval_pct: number; open_cases: number; overdue_cases: number; caseworkers: number; open_per_worker: number };

function TrendChart({ rows }: { rows: Trend[] }) {
  const W = 720, H = 240, L = 40, B = 28, T = 12;
  const x = (i: number) => L + (i * (W - L - 12)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const path = (k: keyof Trend) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(r[k]))}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{v}%</text></g>
      ))}
      <line x1={L} x2={W - 12} y1={y(95)} y2={y(95)} stroke="var(--success)" strokeDasharray="4 4" />
      <text x={W - 14} y={y(95) - 4} textAnchor="end" fontSize="10" fill="var(--success)">95% federal expectation</text>
      <path d={path('rest_of_state_on_time_pct')} fill="none" stroke="var(--primary-light)" strokeWidth="2.5" />
      <path d={path('tamarack_on_time_pct')} fill="none" stroke="var(--brand-5)" strokeWidth="3" />
      {rows.map((r, i) => (
        <g key={r.month}>
          <circle cx={x(i)} cy={y(Number(r.tamarack_on_time_pct))} r="3.5" fill="var(--brand-5)" />
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{new Date(`${r.month}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</text>
        </g>
      ))}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const trend = useChart<Trend>('county_timeliness_trend');
  const score = useChart<Score>('county_scorecard');
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Program director · Marcus Webb</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Timeliness &amp; equity</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">SNAP applications decided within 30 days</div>
            <div className="flex gap-3 text-xs"><span className="text-[var(--brand-5)] font-semibold">● Tamarack</span><span className="text-[var(--primary-light)] font-semibold">● Rest of Westbrook</span></div>
          </div>
          {trend.error && <div className="mt-3 text-sm text-[var(--destructive)]">{trend.error}</div>}
          {!trend.data && !trend.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {trend.data && <TrendChart rows={trend.data} />}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">County scorecard <span className="text-xs font-normal text-[var(--muted-foreground)]">· determinations in the last 3 months, backlog today</span></div>
          {score.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{score.error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['County', 'SNAP on time', 'Median days', 'Procedural denials', 'Approval', 'Open', 'Past deadline', 'Open per worker'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(score.data ?? []).map((r) => (
                <tr key={r.county} className={cn('border-t border-[var(--border)]', r.county === 'Tamarack' && 'bg-[#FFF3F4]')}>
                  <td className="px-4 py-2 font-medium">{r.county} <span className="text-xs text-[var(--muted-foreground)]">{r.region_type}</span></td>
                  <td className={cn('px-4 py-2 tabular-nums', r.snap_on_time_pct < 80 && 'font-semibold text-[var(--brand-5)]')}>{r.snap_on_time_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.median_days}</td>
                  <td className="px-4 py-2 tabular-nums">{r.procedural_denial_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.approval_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.open_cases}</td>
                  <td className="px-4 py-2 tabular-nums">{r.overdue_cases}</td>
                  <td className={cn('px-4 py-2 tabular-nums', r.open_per_worker > 20 && 'font-semibold text-[var(--brand-5)]')}>{r.open_per_worker}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
