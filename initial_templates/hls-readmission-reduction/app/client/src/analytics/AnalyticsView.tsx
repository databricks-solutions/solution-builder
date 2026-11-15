/**
 * Readmission analytics — straight from the Delta gold tables via the SQL warehouse
 * (/api/charts/<key> → config/queries/<key>.sql):
 *   1. 30-day readmission rate by condition, last 26 weeks vs before
 *   2. 7-day follow-up booked by discharge weekday: 4 West heart failure vs the rest of the system
 *   3. estimated HRRP excess readmission ratio per hospital × condition, 12 months vs last 6 months
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { HBars } from '@/care/charts';
import { Pill } from '@/care/ui';

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

type ByCond = { condition_label: string; before_pct: number; last_26w_pct: number; discharges: number };
type ByDow = { discharge_dow: string; four_west_hf_pct: number; rest_of_system_pct: number };
type Err = { hospital_condition: string; err_12m: number; err_last_6m: number; discharges: number };

function Card({ title, sub, children, error }: { title: string; sub?: string; children: React.ReactNode; error?: string | null }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="font-semibold">{title} {sub && <span className="text-xs font-normal text-[var(--muted-foreground)]">· {sub}</span>}</div>
      {error && <div className="mt-2 text-sm text-[var(--destructive)]">{error}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const cond = useChart<ByCond>('readmission_rate_by_condition');
  const dow = useChart<ByDow>('followup_rate_by_weekday');
  const err = useChart<Err>('hrrp_err_by_condition');
  const skeleton = <div className="h-40 animate-pulse rounded-xl bg-[var(--muted)]" />;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Readmissions Committee · monthly review</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Readmission analytics</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="30-day readmission rate by condition" sub="last 26 weeks (dark) vs before (light)" error={cond.error}>
            {cond.data ? <HBars highlight="Heart failure" max={35} rows={cond.data.map((r) => ({ key: r.condition_label, label: r.condition_label, value: Math.max(r.before_pct, r.last_26w_pct), inner: r.last_26w_pct, right: `${r.before_pct}% → ${r.last_26w_pct}%` }))} /> : skeleton}
          </Card>
          <Card title="7-day follow-up booked by discharge weekday" sub="HRRP conditions, last 26 weeks" error={dow.error}>
            {dow.data ? (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-[var(--brand-5)]">4 West · heart failure</div>
                <HBars highlight="x" max={100} rows={dow.data.map((r) => ({ key: r.discharge_dow, label: r.discharge_dow, value: r.four_west_hf_pct ?? 0, right: `${r.four_west_hf_pct ?? 0}%` }))} />
                <div className="text-xs font-semibold text-[var(--muted-foreground)]">Every other unit / condition</div>
                <HBars max={100} rows={dow.data.map((r) => ({ key: r.discharge_dow, label: r.discharge_dow, value: r.rest_of_system_pct ?? 0, right: `${r.rest_of_system_pct ?? 0}%` }))} />
              </div>
            ) : skeleton}
          </Card>
        </div>
        <Card title="Estimated HRRP excess readmission ratio" sub="hospital · condition, trailing 12 months — bars start at 0.80; above 1.00 = penalty; right: 12 months → last 6 months" error={err.error}>
          {err.data ? <HBars highlight="LRMC · HF" max={0.4} rows={err.data.map((r) => ({ key: r.hospital_condition, label: r.hospital_condition, value: Math.max(0, r.err_12m - 0.8), right: `${r.err_12m.toFixed(2)} → ${r.err_last_6m.toFixed(2)}` }))} /> : skeleton}
        </Card>
      </div>
    </div>
  );
}
