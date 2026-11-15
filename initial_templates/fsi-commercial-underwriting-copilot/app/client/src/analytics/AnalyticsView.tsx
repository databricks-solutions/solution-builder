/**
 * Portfolio analytics — the portfolio team's evidence, straight from the Delta tables via the SQL warehouse
 * (/api/charts/<key> → config/queries/<key>.sql):
 *   1. loss ratio by portfolio cell and accident quarter (hail-belt habitational split out)
 *   2. hail-belt habitational by roof band vs the rest of the book — the signal behind TSI-UW-B-2026-07
 *   3. today's queue by triage lane + the decisions issued so far (Delta write-back, live)
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { Pill, cn } from '@/uw/ui';
import { money } from '@/uw/api';
import { BRAND_PALETTE } from '@/lib/brand';

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

type Row = { quarter: string; portfolio_cell: string; earned_premium: number; incurred: number; loss_ratio: number };
type Lane = { triage_lane: string; submissions: number; tiv_musd: number; hidden_high_risk: number; decisions_issued: number; premium_issued: number };

const HIGHLIGHT: Record<string, string> = { 'Habitational · Hail belt': 'var(--brand-5)', 'Roof > 15 yrs': 'var(--brand-5)', 'Roof <= 15 yrs': 'var(--brand-3)', 'Rest of book': 'var(--muted-foreground)' };

function LineChart({ rows, highlight }: { rows: Row[]; highlight?: Record<string, string> }) {
  const quarters = [...new Set(rows.map((r) => r.quarter))].sort();
  const series = [...new Set(rows.map((r) => r.portfolio_cell))];
  const W = 760, H = 260, L = 44, B = 28, T = 12;
  const max = Math.max(1.2, ...rows.map((r) => Number(r.loss_ratio)));
  const x = (q: string) => L + (quarters.indexOf(q) * (W - L - 150)) / Math.max(1, quarters.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const color = (s: string, i: number) => highlight?.[s] ?? BRAND_PALETTE[(i % 4) + 1] ?? 'var(--primary-light)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.4, 0.8, 1.2, 1.6].filter((v) => v <= max).map((v) => (
        <g key={v}><line x1={L} x2={W - 150} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{Math.round(v * 100)}%</text></g>
      ))}
      <line x1={L} x2={W - 150} y1={y(1)} y2={y(1)} stroke="var(--brand-5)" strokeDasharray="4 4" opacity="0.5" />
      {series.map((s, i) => {
        const pts = rows.filter((r) => r.portfolio_cell === s).sort((a, b) => a.quarter.localeCompare(b.quarter));
        const hot = highlight?.[s] === 'var(--brand-5)';
        const last = pts.at(-1);
        return (
          <g key={s} opacity={highlight && !highlight[s] ? 0.45 : 1}>
            <path d={pts.map((r, j) => `${j ? 'L' : 'M'}${x(r.quarter)},${y(Number(r.loss_ratio))}`).join(' ')} fill="none" stroke={color(s, i)} strokeWidth={hot ? 3.5 : 1.8} />
            {last && (!highlight || highlight[s]) && <text x={x(last.quarter) + 8} y={y(Number(last.loss_ratio)) + 4} fontSize="10" fill={color(s, i)} fontWeight={hot ? 700 : 400}>{s} {Math.round(Number(last.loss_ratio) * 100)}%</text>}
          </g>
        );
      })}
      {quarters.map((q) => <text key={q} x={x(q)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{q}</text>)}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  const trend = useChart<Row>('portfolio_lr_trend');
  const split = useChart<Row>('hail_belt_roof_split');
  const lanes = useChart<Lane>('queue_by_lane', tick);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Portfolio management · Marcus Oyelaran, CUO</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Portfolio analytics</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Loss ratio by portfolio cell <span className="text-xs font-normal text-[var(--muted-foreground)]">· accident quarter, 2024-Q3 – 2026-Q2</span></div>
            {trend.error && <div className="mt-3 text-sm text-[var(--destructive)]">{trend.error}</div>}
            {!trend.data && !trend.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
            {trend.data && <LineChart rows={trend.data} highlight={{ 'Habitational · Hail belt': 'var(--brand-5)' }} />}
            {trend.data && <div className="text-xs text-[var(--muted-foreground)]">Faded lines: the other six portfolio cells, all between 45% and 62% in 2026-Q2.</div>}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Hail-belt habitational by roof age <span className="text-xs font-normal text-[var(--muted-foreground)]">· the evidence behind TSI-UW-B-2026-07</span></div>
            {split.error && <div className="mt-3 text-sm text-[var(--destructive)]">{split.error}</div>}
            {!split.data && !split.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
            {split.data && <LineChart rows={split.data} highlight={HIGHLIGHT} />}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">Today’s queue by triage lane <span className="text-xs font-normal text-[var(--muted-foreground)]">· with decisions issued (Delta write-back, uw_decisions), live</span></div>
          {lanes.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{lanes.error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Triage lane', 'Submissions', 'TIV', 'Low on paper, high verified', 'Decisions issued', 'Premium issued'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(lanes.data ?? []).map((r) => (
                <tr key={r.triage_lane} className={cn('border-t border-[var(--border)]', r.triage_lane === 'Documents disagree' && 'bg-[#FDF3F0]')}>
                  <td className="px-4 py-2 font-medium">{r.triage_lane.replace(' - ', ' · ')}</td>
                  <td className="px-4 py-2 tabular-nums">{r.submissions}</td>
                  <td className="px-4 py-2 tabular-nums">${r.tiv_musd}M</td>
                  <td className={cn('px-4 py-2 tabular-nums', Number(r.hidden_high_risk) > 0 && 'font-semibold text-[var(--brand-5)]')}>{r.hidden_high_risk}</td>
                  <td className="px-4 py-2 tabular-nums">{r.decisions_issued}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(r.premium_issued) ? money(r.premium_issued) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
