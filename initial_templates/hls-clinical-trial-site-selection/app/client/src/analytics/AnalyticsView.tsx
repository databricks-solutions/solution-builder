/**
 * Portfolio analytics — straight from the Delta gold tables via the SQL warehouse
 * (/api/charts/<key> → config/queries/<key>.sql):
 *   1. cumulative randomized as % of plan, per trial, by month since FPI
 *   2. top screen-failure reasons per trial (real criterion, incl. AI-recovered)
 *   3. site activation cycle time by trial and IRB type
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { Pill, cn } from '@/trials/ui';

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

type Pct = { trial_id: string; month_start: string; month_number: number; pct_of_plan: number };
type Reason = { trial_id: string; criterion_id: string; criterion_name: string; n: number; ai_recovered: number; share_pct: number };
type Act = { trial_id: string; irb_type: string; sites: number; median_days: number; avg_days: number };
const COLORS: Record<string, string> = { 'CASCADE-CKD': 'var(--brand-5)', 'TIDEWATER-HF': 'var(--brand-2)', 'SENTRY-AF': 'var(--brand-3)', 'LUMEN-MASH': 'var(--brand-4)', 'ORCHID-1': 'var(--brand-1)' };

function PctChart({ rows }: { rows: Pct[] }) {
  const W = 760, H = 260, L = 40, B = 26, T = 12;
  const trials = [...new Set(rows.map((r) => r.trial_id))];
  const maxM = Math.max(...rows.map((r) => r.month_number));
  const x = (m: number) => L + ((m - 2) / Math.max(1, maxM - 2)) * (W - L - 16);
  const y = (v: number) => T + (1 - v / 130) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 25, 50, 75, 100, 125].map((v) => (
        <g key={v}><line x1={L} x2={W - 16} y1={y(v)} y2={y(v)} stroke={v === 100 ? 'var(--primary)' : 'var(--border)'} strokeDasharray={v === 100 ? '4 4' : undefined} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{v}%</text></g>
      ))}
      {trials.map((t) => {
        const pts = rows.filter((r) => r.trial_id === t);
        return <path key={t} d={pts.map((r, i) => `${i ? 'L' : 'M'}${x(r.month_number)},${y(Math.min(130, r.pct_of_plan))}`).join(' ')} fill="none" stroke={COLORS[t] ?? 'var(--primary)'} strokeWidth={t === 'CASCADE-CKD' ? 3.5 : 2} />;
      })}
      {Array.from({ length: maxM - 1 }, (_, i) => i + 2).filter((m) => m % 3 === 0).map((m) => <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">month {m}</text>)}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const pctRows = useChart<Pct>('portfolio_pct_of_plan');
  const reasons = useChart<Reason>('screen_fail_top_reasons');
  const act = useChart<Act>('activation_cycle_time');
  const trials = [...new Set((reasons.data ?? []).map((r) => r.trial_id))];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">VP Clinical Operations · Raj Patel</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Portfolio analytics</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-semibold">Cumulative randomized as % of plan, by month since first patient in</div>
            <div className="flex flex-wrap gap-3 text-xs">{Object.entries(COLORS).map(([t, c]) => <span key={t} className="font-semibold" style={{ color: c }}>● {t}</span>)}</div>
          </div>
          {pctRows.error && <div className="mt-3 text-sm text-[var(--destructive)]">{pctRows.error}</div>}
          {!pctRows.data && !pctRows.error && <div className="mt-3 h-56 animate-pulse rounded-xl bg-[var(--muted)]" />}
          {pctRows.data && <PctChart rows={pctRows.data} />}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
            <div className="px-5 py-3 font-semibold">Top 3 screen-failure reasons per trial <span className="text-xs font-normal text-[var(--muted-foreground)]">· real criterion, incl. notes read by AI Functions</span></div>
            {reasons.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{reasons.error}</div>}
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>{['Trial', 'Criterion', 'Failures', 'Share', 'Recovered by AI'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {trials.flatMap((t) => (reasons.data ?? []).filter((r) => r.trial_id === t).map((r, i) => (
                  <tr key={`${t}-${r.criterion_id}`} className={cn('border-t border-[var(--border)]', r.trial_id === 'CASCADE-CKD' && r.criterion_id === 'E4' && 'bg-[#FDF1EE]')}>
                    <td className="px-4 py-2 font-medium">{i === 0 ? t : ''}</td>
                    <td className="px-4 py-2">{r.criterion_id} · {r.criterion_name}</td>
                    <td className="px-4 py-2 tabular-nums">{r.n}</td>
                    <td className="px-4 py-2 tabular-nums font-semibold">{r.share_pct}%</td>
                    <td className="px-4 py-2 tabular-nums">{r.ai_recovered || '—'}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
            <div className="px-5 py-3 font-semibold">Site activation cycle time <span className="text-xs font-normal text-[var(--muted-foreground)]">· selection → activation, median days</span></div>
            {act.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{act.error}</div>}
            <div className="space-y-2 px-5 pb-5">
              {(act.data ?? []).map((r) => (
                <div key={`${r.trial_id}-${r.irb_type}`} className="grid grid-cols-[150px_1fr_90px] items-center gap-3 text-sm">
                  <span>{r.trial_id} <span className="text-xs text-[var(--muted-foreground)]">{r.irb_type}</span></span>
                  <div className="h-3 rounded-full bg-[var(--muted)]"><div className="h-3 rounded-full" style={{ width: `${(r.median_days / 320) * 100}%`, background: r.irb_type === 'local' ? 'var(--brand-4)' : 'var(--primary-light)' }} /></div>
                  <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">{Math.round(r.median_days)} d · {r.sites} sites</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
