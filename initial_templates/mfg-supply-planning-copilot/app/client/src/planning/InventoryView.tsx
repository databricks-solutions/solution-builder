/**
 * Inventory health — inventory optimization view for the VP Supply Chain:
 *   excess & obsolete by plant, days of supply per component × plant, fill-rate trend,
 *   supplier on-time delivery (warehouse query via /api/charts) and the plans the app
 *   wrote back to Delta (sop_plan_decisions).
 */
import { useEffect, useState } from 'react';
import { fetchInventory, fetchOverview, money, num, pct, shortDate, type Health, type Inventory, type Overview } from './api';
import { Pill, cn } from './ui';
import { dataMutated } from '@/lib/events';

function useChart<T>(key: string, tick: number) {
  const [s, set] = useState<{ data: T[] | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    fetch(`/api/charts/${key}`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error ?? `HTTP ${r.status}`); return b.data as T[]; })
      .then((data) => set({ data, error: null }))
      .catch((e) => set({ data: null, error: (e as Error).message }));
  }, [key, tick]);
  return s;
}

type Otd = { month: string; supplier_name: string; on_time_pct: number; avg_days_late: number; pos_received: number };
type Booked = { plan_id: string; exposure_id: string; plant_id: string; component_id: string; action_summary: string; plan_cost: number; revenue_protected: number; booked_by: string; booked_at: string };
const SUP_COLORS: Record<string, string> = { 'Nanhai Precision Castings': 'var(--brand-5)', 'Kessler Sensorik GmbH': 'var(--brand-4)', 'Brightline Electronics': 'var(--brand-3)', 'Voltara Motor Components': 'var(--primary-light)' };
const PLANT_COLORS: Record<string, string> = { Dayton: 'var(--brand-5)', Monterrey: 'var(--primary-light)', Wroclaw: 'var(--brand-4)' };

function LineChart({ series, xs, yMin, yMax, fmt }: { series: Array<{ name: string; color: string; values: Array<number | null> }>; xs: string[]; yMin: number; yMax: number; fmt: (v: number) => string }) {
  const W = 600, H = 200, L = 44, R = 10, T = 10, B = 24;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, xs.length - 1);
  const y = (v: number) => T + ((yMax - v) / (yMax - yMin)) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const v = yMin + (yMax - yMin) * f; return <g key={f}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{fmt(v)}</text></g>; })}
      {series.map((s) => {
        const d = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(Math.max(yMin, v))}`)).filter(Boolean).map((p, j) => `${j ? 'L' : 'M'}${p}`).join(' ');
        return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={s.color === 'var(--brand-5)' ? 3 : 2} />;
      })}
      {xs.map((w, i) => (i % Math.ceil(xs.length / 6) === 0 ? <text key={w} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">{shortDate(w)}</text> : null))}
    </svg>
  );
}

export function InventoryView() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchInventory().then(setInv).catch(() => {}); fetchOverview().then(setO).catch(() => {}); }, [tick]);
  const otd = useChart<Otd>('supplier_otd_monthly', 0);
  const booked = useChart<Booked>('booked_plans', tick);

  const eo = (inv?.health ?? []).filter((h) => h.eo_value > 0).sort((a, b) => b.eo_value - a.eo_value);
  const eoByPlant = Object.entries(eo.reduce<Record<string, number>>((a, h) => ({ ...a, [h.plant_name]: (a[h.plant_name] ?? 0) + h.eo_value }), {})).sort((a, b) => b[1] - a[1]);
  const plants = Object.values(inv?.plants ?? {});
  const comps = [...new Set((inv?.health ?? []).map((h) => h.component_id))].sort();
  const cell = (c: string, p: string) => inv?.health.find((h) => h.component_id === c && h.plant_name === p);
  const dosTone = (h: Health) => (h.eo_category === 'Obsolete' ? 'bg-[#EDE7F6] text-[#4A2C82]' : h.eo_category === 'Excess' ? 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]' : (h.days_of_supply ?? 99) < 14 ? 'bg-[#FDE3DA] text-[#9A2E0E] font-semibold' : 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]');
  const months = [...new Set((otd.data ?? []).map((r) => r.month))].sort();
  const sups = [...new Set((otd.data ?? []).map((r) => r.supplier_name))];
  const fillXs = (o?.fill_trend ?? []).map((r) => String(r.week_start));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">VP Supply Chain · Tom Becker</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Inventory health &amp; excess / obsolete</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Days of supply = on hand ÷ forward daily requirement (13-week AI_FORECAST × BOM). Obsolete = no forward demand and no issue in 90+ days; Excess = more than 26 weeks of cover.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-baseline justify-between"><div className="font-semibold">Excess &amp; obsolete</div><div className="text-2xl font-semibold tabular-nums">{money(o?.eo_value, true)}</div></div>
            <div className="mt-3 space-y-1.5">
              {eoByPlant.map(([p, v]) => (
                <div key={p} className="grid grid-cols-[90px_1fr_70px] items-center gap-3 text-sm">
                  <span>{p}</span>
                  <div className="h-3 rounded-full bg-[var(--muted)]"><div className="h-3 rounded-full" style={{ width: `${(v / (eoByPlant[0]?.[1] || 1)) * 100}%`, background: PLANT_COLORS[p] ?? 'var(--primary-light)' }} /></div>
                  <span className="text-right tabular-nums text-xs">{money(v, true)}</span>
                </div>
              ))}
            </div>
            <table className="mt-4 w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="py-1 text-left">Component · plant</th><th className="text-left">Category</th><th className="text-right">Units</th><th className="text-right">Value</th></tr></thead>
              <tbody>
                {eo.map((h) => (
                  <tr key={h.plant_id + h.component_id} className="border-t border-[var(--border)]">
                    <td className="py-1.5">{h.component_id} <span className="text-xs text-[var(--muted-foreground)]">· {h.plant_name} · {h.days_since_last_issue} d since last issue</span></td>
                    <td><Pill tone={h.eo_category === 'Obsolete' ? 'bad' : 'warn'}>{h.eo_category}</Pill></td>
                    <td className="text-right tabular-nums">{num(h.eo_units)}</td>
                    <td className="text-right tabular-nums font-medium">{money(h.eo_value, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 overflow-x-auto">
            <div className="font-semibold">Days of supply by component and plant</div>
            <table className="mt-3 w-full text-xs">
              <thead><tr><th className="py-1 text-left text-[11px] uppercase text-[var(--muted-foreground)]">Component</th>{plants.map((p) => <th key={p} className="px-2 text-center text-[11px] uppercase text-[var(--muted-foreground)]">{p}</th>)}</tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c}>
                    <td className="py-1 pr-2 font-mono">{c}</td>
                    {plants.map((p) => { const h = cell(c, p); return (
                      <td key={p} className="px-1 py-0.5 text-center">
                        {h ? <div className={cn('rounded-md px-2 py-1 tabular-nums', dosTone(h))} title={`${num(h.on_hand_units)} on hand · ${num(h.avg_weekly_requirement)}/wk · ${h.eo_category}`}>{h.eo_category === 'Obsolete' ? 'no demand' : `${num(h.days_of_supply)} d`}</div> : <span className="text-[var(--muted-foreground)]">·</span>}
                      </td>); })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted-foreground)]"><span className="rounded bg-[#FDE3DA] px-1.5">&lt; 14 days</span><span className="rounded bg-[var(--success-subtle)] px-1.5">healthy</span><span className="rounded bg-[var(--warning-subtle)] px-1.5">excess</span><span className="rounded bg-[#EDE7F6] px-1.5">obsolete</span></div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-baseline justify-between"><div className="font-semibold">Unit fill rate by plant, weekly</div><div className="flex gap-3 text-xs">{plants.map((p) => <span key={p} style={{ color: PLANT_COLORS[p] }} className="font-semibold">● {p}</span>)}</div></div>
            {o ? <LineChart xs={fillXs} yMin={0.85} yMax={1} fmt={(v) => pct(v, 0)} series={plants.map((p) => ({ name: p, color: PLANT_COLORS[p] ?? 'var(--primary)', values: (o.fill_trend ?? []).map((r) => (r[p] as number | null) ?? null) }))} /> : <div className="h-48 rounded-xl bg-[var(--muted)] animate-pulse" />}
            <div className="text-xs text-[var(--muted-foreground)]">Target 97% (CSP-06 §6.4). Dayton’s SG-400 finished goods have trailed demand since the June surge.</div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-baseline justify-between"><div className="font-semibold">Supplier on-time delivery, monthly</div><div className="flex flex-wrap justify-end gap-2 text-[11px]">{sups.map((s) => <span key={s} style={{ color: SUP_COLORS[s] }} className="font-semibold">● {s.split(' ')[0]}</span>)}</div></div>
            {otd.error && <div className="text-sm text-[var(--destructive)]">{otd.error}</div>}
            {otd.data ? <LineChart xs={months} yMin={0} yMax={100} fmt={(v) => `${Math.round(v)}%`} series={sups.map((s) => ({ name: s, color: SUP_COLORS[s] ?? 'var(--primary)', values: months.map((m) => otd.data!.find((r) => r.month === m && r.supplier_name === s)?.on_time_pct ?? null) }))} /> : !otd.error && <div className="h-48 rounded-xl bg-[var(--muted)] animate-pulse" />}
            <div className="text-xs text-[var(--muted-foreground)]">Received POs on or before the promised date (SQL warehouse, gold_supplier_performance_monthly).</div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">Plans written back to Delta <span className="text-xs font-normal text-[var(--muted-foreground)]">· sop_plan_decisions (read live from the SQL warehouse)</span></div>
          {booked.error && <div className="px-5 pb-3 text-sm text-[var(--destructive)]">{booked.error}</div>}
          {booked.data && booked.data.length === 0 && <div className="px-5 pb-4 text-sm text-[var(--muted-foreground)]">No plans booked yet.</div>}
          {booked.data && booked.data.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr>{['Plan', 'Exposure', 'Actions', 'Cost', 'Revenue protected', 'Booked'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
              <tbody>
                {booked.data.map((b) => (
                  <tr key={b.plan_id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2 font-mono text-xs">{b.plan_id}</td><td className="px-4 py-2">{b.exposure_id}</td>
                    <td className="px-4 py-2 text-xs">{b.action_summary}</td><td className="px-4 py-2 tabular-nums">{money(b.plan_cost)}</td>
                    <td className="px-4 py-2 tabular-nums text-[var(--success)] font-medium">{money(b.revenue_protected, true)}</td>
                    <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">{b.booked_by} · {shortDate(b.booked_at)}</td>
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
