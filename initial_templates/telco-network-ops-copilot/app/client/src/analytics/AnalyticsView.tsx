/**
 * Network analytics — straight from Delta via the SQL warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. alarms per 5 minutes over the last 4 hours — the storm vs the rest of the network
 *   2. the slow burn: dropped-call rate and VSWR per sector at the most degraded site (no alarm ever fired)
 *   3. 12 months of tickets: how often an early warning was ignored (ai_classify on resolution notes)
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { LineChart, Pill, cn } from '@/noc/ui';

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

type Bucket = { bucket: string; storm_alarms: number; other_alarms: number; storm_router: string };
type Burn = { day: string; sector: string; cell_id: string; drop_call_rate_pct: number; max_vswr: number; flagged_cell: string };
type Warn = { category: string; tickets: number; early_warning_ignored: number; pct_warned: number; avg_mttr_hours: number };

function StormChart({ rows }: { rows: Bucket[] }) {
  const W = 760, H = 220, L = 40, B = 26, T = 10;
  const max = Math.max(10, ...rows.map((r) => r.storm_alarms + r.other_alarms));
  const bw = (W - L - 12) / Math.max(1, rows.length);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((f) => (
        <g key={f}><line x1={L} x2={W - 12} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" /><text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{Math.round(max * f)}</text></g>
      ))}
      {rows.map((r, i) => {
        const x = L + i * bw;
        return (
          <g key={r.bucket}>
            <rect x={x + 1} y={y(r.other_alarms)} width={Math.max(1, bw - 2)} height={H - B - y(r.other_alarms)} fill="var(--primary-light)" opacity="0.5" />
            <rect x={x + 1} y={y(r.other_alarms + r.storm_alarms)} width={Math.max(1, bw - 2)} height={H - B - y(r.storm_alarms)} fill="var(--brand-5)"><title>{r.bucket}: {r.storm_alarms} alarms from {r.storm_router} and its sites</title></rect>
            {i % 3 === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{r.bucket}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const storm = useChart<Bucket>('alarm_timeline');
  const burn = useChart<Burn>('slow_burn');
  const warn = useChart<Warn>('early_warning');
  const stormTotal = (storm.data ?? []).reduce((s, r) => s + r.storm_alarms, 0);
  const days = [...new Set((burn.data ?? []).map((b) => b.day))].sort();
  const piv = (k: 'drop_call_rate_pct' | 'max_vswr') => days.map((d) => Object.fromEntries([['d', d], ...(burn.data ?? []).filter((b) => b.day === d).map((b) => [b.sector, b[k]])]));
  const flagged = burn.data?.[0]?.flagged_cell;
  const colors = ['#3CD7F0', '#FF4D5E', '#FFB020'];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Network operations · governed telemetry in Unity Catalog</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Network analytics</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="font-semibold">Alarms raised per 5 minutes — last 4 hours</div>
              <div className="text-xs text-[var(--muted-foreground)]">{stormTotal > 0 && <><b>{stormTotal}</b> alarms from <b>{storm.data?.[0]?.storm_router}</b>, its cell sites and its core-router ports in ten minutes — every one of them a symptom of the same failure.</>}</div>
            </div>
            <div className="flex gap-3 text-xs"><span className="font-semibold text-[var(--brand-5)]">● Storm router + its sites</span><span className="font-semibold text-[var(--primary-light)]">● Rest of the network</span></div>
          </div>
          {storm.error && <div className="mt-3 text-sm text-[var(--destructive)]">{storm.error}</div>}
          {!storm.data && !storm.error && <div className="mt-3 h-52 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {storm.data && <StormChart rows={storm.data} />}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-baseline justify-between"><div className="font-semibold">The slow burn — dropped-call rate % by sector{flagged ? ` (${flagged.slice(0, 7)})` : ''}</div><span className="flex gap-2 text-xs">{['A', 'B', 'C'].map((s, i) => <span key={s} style={{ color: colors[i] }} className="font-semibold">● {s}</span>)}</span></div>
            <div className="text-xs text-[var(--muted-foreground)]">Flagged by the KPI anomaly model; no threshold alarm ever fired.</div>
            {burn.error && <div className="mt-3 text-sm text-[var(--destructive)]">{burn.error}</div>}
            {burn.data ? <LineChart rows={piv('drop_call_rate_pct')} x="d" series={['A', 'B', 'C']} colors={colors} threshold={{ value: 2, label: 'customer-affecting 2.0%' }} unit="%" /> : !burn.error && <div className="mt-3 h-48 rounded-xl bg-[var(--muted)] animate-pulse" />}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">…while VSWR stays under the 2.0 alarm threshold</div>
            <div className="text-xs text-[var(--muted-foreground)]">Max VSWR per sector per day — water ingress in a jumper looks exactly like this.</div>
            {burn.data ? <LineChart rows={piv('max_vswr')} x="d" series={['A', 'B', 'C']} colors={colors} threshold={{ value: 2, label: 'vendor VSWR alarm 2.0' }} /> : !burn.error && <div className="mt-3 h-48 rounded-xl bg-[var(--muted)] animate-pulse" />}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">Outages with an ignored early warning <span className="text-xs font-normal text-[var(--muted-foreground)]">· 12 months of trouble tickets · <code>ai_classify</code> on the engineers&rsquo; resolution notes</span></div>
          {warn.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{warn.error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Category', 'Tickets', 'Early warning ignored', '% warned', 'Avg MTTR (h)'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!warn.data && !warn.error && <tr><td colSpan={5} className="px-4 py-3"><div className="h-5 rounded bg-[var(--muted)] animate-pulse" /></td></tr>}
              {(warn.data ?? []).map((r) => (
                <tr key={r.category} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-medium">{r.category.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 tabular-nums">{r.tickets}</td>
                  <td className="px-4 py-2 tabular-nums">{r.early_warning_ignored}</td>
                  <td className={cn('px-4 py-2 tabular-nums', r.pct_warned >= 40 && 'font-semibold text-[var(--brand-5)]')}>{r.pct_warned}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.avg_mttr_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
