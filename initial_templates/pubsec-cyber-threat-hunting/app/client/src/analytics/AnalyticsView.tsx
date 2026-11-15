/**
 * Hunt analytics — the two things the SIEM rules miss, straight from Delta via the
 * SQL warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. failed passwords per day from hosting networks (the low-and-slow spray) vs everyone else
 *   2. detection-rule efficacy: alert volume vs true positives, per ATT&CK technique
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { Pill, cn } from '@/soc/ui';

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

type Day = { day: string; hosting_failures: number; hosting_accounts: number; other_failures: number };
type Rule = { rule_name: string; source: string; technique_id: string; technique_name: string; alerts: number; true_positives: number; tp_rate_pct: number; false_positives: number };

function SprayChart({ rows }: { rows: Day[] }) {
  const W = 760, H = 240, L = 40, B = 28, T = 12;
  const max = Math.max(10, ...rows.map((r) => r.hosting_failures + r.other_failures));
  const bw = (W - L - 12) / rows.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((f) => (
        <g key={f}><line x1={L} x2={W - 12} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" /><text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{Math.round(max * f)}</text></g>
      ))}
      {rows.map((r, i) => {
        const x = L + i * bw;
        return (
          <g key={r.day}>
            <rect x={x + 1} y={y(r.other_failures)} width={bw - 2} height={H - B - y(r.other_failures)} fill="var(--primary-light)" opacity="0.35" />
            <rect x={x + 1} y={y(r.other_failures + r.hosting_failures)} width={bw - 2} height={H - B - y(r.hosting_failures)} fill="var(--brand-5)"><title>{r.day}: {r.hosting_failures} failed passwords from hosting networks on {r.hosting_accounts} accounts</title></rect>
            {i % 5 === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{r.day.slice(5)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const spray = useChart<Day>('spray_daily');
  const rules = useChart<Rule>('rule_efficacy');
  const days = (spray.data ?? []).filter((d) => d.hosting_failures > 0);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Threat hunting · governed telemetry in Unity Catalog</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Hunt analytics</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="font-semibold">Failed passwords per day — last 45 days</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                {days.length > 0 && <>Hosting / VPS networks: <b>{days.reduce((s, d) => s + d.hosting_failures, 0).toLocaleString()}</b> failures over <b>{days.length}</b> days, never more than one per account per day — the “&gt;5 in 10 minutes” rule cannot fire.</>}
              </div>
            </div>
            <div className="flex gap-3 text-xs"><span className="font-semibold text-[var(--brand-5)]">● Hosting / VPS networks</span><span className="font-semibold text-[var(--primary-light)]">● Office + home ISPs</span></div>
          </div>
          {spray.error && <div className="mt-3 text-sm text-[var(--destructive)]">{spray.error}</div>}
          {!spray.data && !spray.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {spray.data && <SprayChart rows={spray.data} />}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">Detection rule efficacy <span className="text-xs font-normal text-[var(--muted-foreground)]">· 90 days · true-positive rate = TP / dispositioned alerts</span></div>
          {rules.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{rules.error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Rule', 'Source', 'ATT&CK', 'Alerts', 'True positives', 'TP rate', 'False positives'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!rules.data && !rules.error && <tr><td colSpan={7} className="px-4 py-3"><div className="h-5 rounded bg-[var(--muted)] animate-pulse" /></td></tr>}
              {(rules.data ?? []).map((r) => (
                <tr key={r.rule_name} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-medium">{r.rule_name}</td>
                  <td className="px-4 py-2">{r.source}</td>
                  <td className="px-4 py-2 text-xs"><span className="font-mono">{r.technique_id}</span> {r.technique_name}</td>
                  <td className="px-4 py-2 tabular-nums">{r.alerts.toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums">{r.true_positives}</td>
                  <td className={cn('px-4 py-2 tabular-nums', r.tp_rate_pct < 2 && 'font-semibold text-[var(--brand-5)]')}>{r.tp_rate_pct}%</td>
                  <td className="px-4 py-2 tabular-nums">{r.false_positives.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
