/** Hand-rolled SVG charts (no chart lib): enrollment curve + projections, horizontal bars. */
import type { Scenario } from '../../../shared/projection';
import type { CurvePoint } from './api';

const MONTH = (s: string) => {
  const [y, m] = s.slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
};
const label = (idx: number) => new Date(Date.UTC(Math.floor(idx / 12), idx % 12, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export const SCENARIO_COLOR: Record<string, string> = {
  status_quo: 'var(--brand-5)', amendment: 'var(--brand-4)', amendment_plus_sites: 'var(--success)',
};

export function EnrollmentChart({ curve, plan, target, scenarios, plannedLpi, height = 260 }: {
  curve: CurvePoint[]; plan: Array<{ month_start: string; planned_cum_randomized: number }>; target: number;
  scenarios?: Scenario[]; plannedLpi?: string; height?: number;
}) {
  const W = 760, H = height, L = 44, R = 16, T = 14, B = 26;
  const m0 = MONTH(curve[0]?.month_start ?? plan[0].month_start);
  const lastPlan = MONTH(plan[plan.length - 1].month_start);
  const lastScen = Math.max(0, ...(scenarios ?? []).flatMap((s) => s.curve.map((c) => MONTH(c.month))));
  const m1 = Math.min(Math.max(lastPlan, lastScen) + 1, m0 + 84);
  const yMax = Math.ceil((target * 1.05) / 100) * 100;
  const x = (m: number) => L + ((m - m0) / Math.max(1, m1 - m0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const path = (pts: Array<[number, number]>) => pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const actual = curve.map((c) => [MONTH(c.month_start), c.cum_randomized] as [number, number]);
  const last = actual[actual.length - 1];
  const ticks: number[] = [];
  for (let m = m0; m <= m1; m += Math.max(3, Math.round((m1 - m0) / 10 / 3) * 3)) ticks.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative randomized vs plan">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(yMax * f)} y2={y(yMax * f)} stroke="var(--border)" />
          <text x={L - 6} y={y(yMax * f) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{Math.round(yMax * f)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="var(--primary)" strokeDasharray="2 3" />
      <text x={L + 4} y={y(target) - 4} fontSize="10" fill="var(--primary)">target {target.toLocaleString()}</text>
      {plannedLpi && (
        <g>
          <line x1={x(MONTH(plannedLpi))} x2={x(MONTH(plannedLpi))} y1={T} y2={H - B} stroke="var(--primary)" strokeDasharray="4 4" opacity={0.5} />
          <text x={x(MONTH(plannedLpi)) + 4} y={T + 10} fontSize="10" fill="var(--primary)">planned last patient in</text>
        </g>
      )}
      <path d={path(plan.map((p) => [MONTH(p.month_start), p.planned_cum_randomized]))} fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeDasharray="6 4" />
      {(scenarios ?? []).map((s) => (
        <path key={s.key} d={path([last, ...s.curve.map((c) => [MONTH(c.month), c.cum] as [number, number])])} fill="none"
          stroke={SCENARIO_COLOR[s.key]} strokeWidth="2.5" strokeDasharray={s.key === 'status_quo' ? '3 3' : undefined} />
      ))}
      <path d={path(actual)} fill="none" stroke="var(--primary)" strokeWidth="3" />
      {last && <circle cx={x(last[0])} cy={y(last[1])} r="4" fill="var(--primary)" />}
      {ticks.map((m) => (
        <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{label(m)}</text>
      ))}
    </svg>
  );
}

/** Horizontal bars with an optional secondary (lighter) overlay value, e.g. site-coded vs real. */
export function HBars({ rows, max, highlight }: {
  rows: Array<{ key: string; label: string; value: number; inner?: number; right?: string }>; max?: number; highlight?: string;
}) {
  const mx = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,230px)_1fr_64px] items-center gap-3 text-sm">
          <span className={r.key === highlight ? 'truncate font-semibold text-[var(--brand-5)]' : 'truncate'} title={r.label}>{r.label}</span>
          <div className="relative h-3.5 rounded-full bg-[var(--muted)]">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.value / mx) * 100}%`, background: r.key === highlight ? 'var(--brand-5)' : 'var(--primary-light)', opacity: r.inner != null ? 0.35 : 1 }} />
            {r.inner != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.inner / mx) * 100}%`, background: r.key === highlight ? 'var(--brand-5)' : 'var(--primary-light)' }} />}
          </div>
          <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">{r.right ?? r.value.toLocaleString("en-US")}</span>
        </div>
      ))}
    </div>
  );
}
