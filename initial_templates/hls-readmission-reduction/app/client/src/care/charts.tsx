/** Hand-rolled SVG charts (no chart lib): monthly trend lines, weekday grouped bars, horizontal bars. */
import { monthShort, type DowRow, type TrendRow } from './api';

const LINE_COLOR: Record<string, string> = { '4 West': 'var(--brand-5)', 'Rest of Larkspur': 'var(--primary-light)' };

/** Monthly HF 30-day readmission rate, 4 West vs the rest of the system, with a marker where the change happened. */
export function TrendChart({ rows, markerMonth, height = 230 }: { rows: TrendRow[]; markerMonth?: string; height?: number }) {
  const W = 760, H = height, L = 40, R = 16, T = 14, B = 26;
  const months = [...new Set(rows.map((r) => r.discharge_month))].sort();
  const groups = [...new Set(rows.map((r) => r.group_name))];
  const yMax = Math.max(0.4, Math.ceil(Math.max(...rows.map((r) => r.rate)) * 10) / 10);
  const x = (i: number) => L + (i / Math.max(1, months.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const mi = markerMonth ? months.findIndex((m) => m >= markerMonth) : -1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Heart-failure readmission rate by month">
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5].filter((v) => v <= yMax).map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {mi > 0 && (
        <g>
          <rect x={x(mi)} y={T} width={W - R - x(mi)} height={H - T - B} fill="var(--brand-5)" opacity={0.06} />
          <line x1={x(mi)} x2={x(mi)} y1={T} y2={H - B} stroke="var(--brand-5)" strokeDasharray="4 4" opacity={0.6} />
          <text x={x(mi) + 5} y={T + 11} fontSize="10" fill="var(--brand-5)">weekend navigator left · Saturday HF clinic cut</text>
        </g>
      )}
      {groups.map((g) => {
        const pts = months.map((m, i) => ({ i, r: rows.find((r) => r.discharge_month === m && r.group_name === g) })).filter((p) => p.r);
        return (
          <g key={g}>
            <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.r!.rate).toFixed(1)}`).join(' ')} fill="none" stroke={LINE_COLOR[g] ?? 'var(--primary)'} strokeWidth={g === '4 West' ? 3 : 2} />
            {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.r!.rate)} r={g === '4 West' ? 3 : 2} fill={LINE_COLOR[g] ?? 'var(--primary)'} />)}
          </g>
        );
      })}
      {months.map((m, i) => (i % 3 === 0 ? <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{monthShort(m)}</text> : null))}
    </svg>
  );
}

/** 4 West HF by discharge weekday: follow-up booked % (bars) and readmission rate (dots), before vs last 26 weeks. */
export function WeekdayChart({ rows, height = 220 }: { rows: DowRow[]; height?: number }) {
  const W = 760, H = height, L = 40, R = 16, T = 16, B = 30;
  const bw = (W - L - R) / Math.max(1, rows.length);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Follow-up booked and readmission rate by discharge weekday">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cx = L + bw * i + bw / 2;
        const weekend = ['Fri', 'Sat', 'Sun'].includes(r.discharge_dow);
        return (
          <g key={r.discharge_dow}>
            {weekend && <rect x={L + bw * i + 2} y={T} width={bw - 4} height={H - T - B} fill="var(--brand-5)" opacity={0.05} />}
            <rect x={cx - 26} y={y(r.fu_before)} width={22} height={H - B - y(r.fu_before)} rx={3} fill="var(--primary-light)" opacity={0.35} />
            <rect x={cx - 2} y={y(r.fu_last26)} width={22} height={H - B - y(r.fu_last26)} rx={3} fill={weekend ? 'var(--brand-5)' : 'var(--primary-light)'} />
            <text x={cx + 9} y={y(r.fu_last26) - 4} textAnchor="middle" fontSize="10" fontWeight={600} fill={weekend ? 'var(--brand-5)' : 'var(--foreground)'}>{Math.round(r.fu_last26 * 100)}%</text>
            <circle cx={cx + 34} cy={y(r.rate_last26)} r={5} fill="var(--brand-4)" stroke="white" strokeWidth={1.5} />
            <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fontWeight={weekend ? 700 : 400} fill={weekend ? 'var(--brand-5)' : 'var(--muted-foreground)'}>{r.discharge_dow}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars with an optional secondary (lighter) overlay value. */
export function HBars({ rows, max, highlight }: {
  rows: Array<{ key: string; label: string; value: number; inner?: number; right?: string }>; max?: number; highlight?: string;
}) {
  const mx = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,230px)_1fr_96px] items-center gap-3 text-sm">
          <span className={r.key === highlight ? 'truncate font-semibold text-[var(--brand-5)]' : 'truncate'} title={r.label}>{r.label}</span>
          <div className="relative h-3.5 rounded-full bg-[var(--muted)]">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (r.value / mx) * 100)}%`, background: r.key === highlight ? 'var(--brand-5)' : 'var(--primary-light)', opacity: r.inner != null ? 0.35 : 1 }} />
            {r.inner != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (r.inner / mx) * 100)}%`, background: r.key === highlight ? 'var(--brand-5)' : 'var(--primary-light)' }} />}
          </div>
          <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">{r.right ?? r.value.toLocaleString('en-US')}</span>
        </div>
      ))}
    </div>
  );
}

/** Small risk gauge bar 0-60%. */
export function RiskBar({ value, marker }: { value: number; marker?: number }) {
  const w = (v: number) => `${Math.min(100, (v / 0.6) * 100)}%`;
  const color = value >= 0.3 ? 'var(--brand-5)' : value >= 0.18 ? 'var(--brand-4)' : 'var(--success)';
  return (
    <div className="relative h-2 w-full rounded-full bg-[var(--muted)]">
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(value), background: color }} />
      {marker != null && <div className="absolute -inset-y-1 w-0.5 rounded bg-[var(--foreground)]" style={{ left: w(marker) }} title="with a 7-day follow-up" />}
    </div>
  );
}
