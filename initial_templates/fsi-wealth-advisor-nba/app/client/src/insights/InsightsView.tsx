/**
 * Desk insights — the head of the wealth desk's four numbers, straight from the Delta gold tables via
 * the SQL warehouse (/api/charts/<key> → config/queries/<key>.sql).
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { Pill, cn } from '@/book/ui';

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

type Mim = { signal_type: string; households: number; amount_m: number };
type Conv = { approach: string; offers: number; conversion_pct: number };
type Ret = { follow_up: string; events: number; assets_retained_pct: number; outflows_m: number };
type Flow = { month: string; sweep_cash_m: number; outflows_m: number };

function Bars<T>({ rows, label, value, fmt, highlight }: { rows: T[]; label: (r: T) => string; value: (r: T) => number; fmt: (r: T) => string; highlight?: (r: T) => boolean }) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={label(r)} className="grid grid-cols-[190px_1fr_110px] items-center gap-3 text-sm">
          <span className={cn('truncate', highlight?.(r) && 'font-semibold')}>{label(r)}</span>
          <div className="h-3.5 rounded-full bg-[var(--muted)]"><div className="h-3.5 rounded-full" style={{ width: `${(value(r) / max) * 100}%`, background: highlight?.(r) ? 'var(--brand-5)' : 'var(--primary-light)' }} /></div>
          <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">{fmt(r)}</span>
        </div>
      ))}
    </div>
  );
}

function FlowChart({ rows }: { rows: Flow[] }) {
  const W = 720, H = 220, L = 44, B = 26, T = 12;
  const max = Math.max(1, ...rows.map((r) => r.sweep_cash_m));
  const maxO = Math.max(1, ...rows.map((r) => r.outflows_m));
  const x = (i: number) => L + (i * (W - L - 12)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const bw = (W - L) / rows.length * 0.45;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - 12} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" /><text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">${Math.round(max * f)}M</text></g>))}
      {rows.map((r, i) => (<rect key={r.month} x={x(i) - bw / 2} width={bw} y={H - B - (r.outflows_m / maxO) * (H - T - B) * 0.45} height={(r.outflows_m / maxO) * (H - T - B) * 0.45} fill="var(--brand-5)" opacity="0.55" rx="2" />))}
      <path d={rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.sweep_cash_m)}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth="3" />
      {rows.map((r, i) => (<g key={r.month + 't'}><circle cx={x(i)} cy={y(r.sweep_cash_m)} r="3.5" fill="var(--primary)" /><text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{r.month.slice(2)}</text></g>))}
    </svg>
  );
}

export function InsightsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const mim = useChart<Mim>('money_in_motion');
  const conv = useChart<Conv>('conversion_by_trigger');
  const ret = useChart<Ret>('retention_after_life_event');
  const flows = useChart<Flow>('flows_trend');
  const err = [mim, conv, ret, flows].find((c) => c.error)?.error;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Head of the wealth desk · all 36 advisors</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Desk insights</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        {err && <div className="text-sm text-[var(--destructive)]">{err}</div>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Opportunities across the firm <span className="text-xs font-normal text-[var(--muted-foreground)]">· active signals, $M (refi = mortgage balances)</span></div>
            <div className="mt-3">{mim.data ? <Bars rows={mim.data} label={(r) => r.signal_type} value={(r) => r.amount_m} fmt={(r) => `$${r.amount_m}M · ${r.households}`} /> : <div className="h-48 rounded-xl bg-[var(--muted)] animate-pulse" />}</div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Offer conversion: targeted vs generic <span className="text-xs font-normal text-[var(--muted-foreground)]">· 18 months of offers</span></div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Signal-triggered offers, by how fast the advisor acted, vs the default annual review.</p>
            <div className="mt-3">{conv.data ? <Bars rows={conv.data} label={(r) => r.approach} value={(r) => r.conversion_pct} fmt={(r) => `${r.conversion_pct}% · ${r.offers.toLocaleString()}`} highlight={(r) => r.approach.startsWith('Generic')} /> : <div className="h-32 rounded-xl bg-[var(--muted)] animate-pulse" />}</div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">After a death or an inheritance <span className="text-xs font-normal text-[var(--muted-foreground)]">· assets kept over the next 6 months</span></div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(ret.data ?? []).map((r) => (
                <div key={r.follow_up} className={cn('rounded-xl px-4 py-3', r.follow_up.startsWith('Nobody') ? 'bg-[#FDF3F1]' : 'bg-[var(--success-subtle)]')}>
                  <div className="text-xs text-[var(--muted-foreground)]">{r.follow_up}</div>
                  <div className={cn('text-3xl font-semibold tabular-nums', r.follow_up.startsWith('Nobody') && 'text-[var(--brand-5)]')}>{r.assets_retained_pct}%</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{r.events} events · ${r.outflows_m}M walked out</div>
                </div>
              ))}
              {!ret.data && <div className="col-span-2 h-24 rounded-xl bg-[var(--muted)] animate-pulse" />}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">Sweep cash vs outflows</div>
              <div className="flex gap-3 text-xs"><span className="font-semibold text-[var(--primary)]">● Sweep cash ($M)</span><span className="font-semibold text-[var(--brand-5)]">▮ External outflows</span></div>
            </div>
            {flows.data ? <FlowChart rows={flows.data} /> : <div className="mt-3 h-48 rounded-xl bg-[var(--muted)] animate-pulse" />}
          </div>
        </div>
      </div>
    </div>
  );
}
