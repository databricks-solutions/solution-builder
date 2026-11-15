/**
 * 13-week projected inventory for one component at one plant.
 *   bars          — weekly requirement (AI_FORECAST × BOM)
 *   dashed grey   — balance if the POs had arrived on their PROMISED date
 *   orange        — current projection (POs at their REVISED ETA) — goes negative = stock-out
 *   navy          — projection with the selected mitigation plan
 *   amber dotted  — safety stock
 */
import { shortDate, num, type SimWeek, type ProjRow } from './api';

export function ProjectionChart({ rows, plan, height = 280 }: { rows: ProjRow[]; plan: SimWeek[] | null; height?: number }) {
  const W = 860, H = height, L = 56, R = 16, T = 18, B = 34;
  const vals = [
    ...rows.flatMap((r) => [r.projected_balance, r.balance_if_on_time, r.safety_stock_units, r.required_units]),
    ...(plan ?? []).flatMap((w) => [w.balance, w.safety_stock]),
    0,
  ];
  const max = Math.max(...vals) * 1.08, min = Math.min(...vals) * 1.15;
  const n = rows.length;
  const bw = (W - L - R) / n;
  const x = (i: number) => L + bw * i + bw / 2;
  const y = (v: number) => T + ((max - v) / (max - min || 1)) * (H - T - B);
  const path = (pts: number[]) => pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const ticks = 5;
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / ticks)));
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => (max - min) / s <= ticks + 1) ?? step * 10;
  const tickVals: number[] = [];
  for (let v = Math.ceil(min / niceStep) * niceStep; v <= max; v += niceStep) tickVals.push(v);
  const base = rows.map((r) => r.projected_balance);
  // shade the stock-out area under zero on the current projection
  const negArea = rows.map((r, i) => ({ i, v: r.projected_balance })).filter((p) => p.v < 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected inventory">
      {tickVals.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{num(v)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--foreground)" strokeOpacity="0.5" />
      {negArea.map((p) => (
        <rect key={p.i} x={L + bw * p.i + 2} width={bw - 4} y={y(0)} height={Math.max(0, y(p.v) - y(0))} fill="var(--brand-5)" opacity="0.14" />
      ))}
      {rows.map((r, i) => (
        <rect key={r.week_start} x={L + bw * i + bw * 0.3} width={bw * 0.4} y={y(r.required_units)} height={Math.max(0, y(0) - y(r.required_units))}
          fill="var(--brand-3)" opacity="0.35"><title>{`Requirement ${shortDate(r.week_start)}: ${num(r.required_units)}`}</title></rect>
      ))}
      <path d={path(rows.map((r) => r.safety_stock_units))} fill="none" stroke="var(--brand-4)" strokeWidth="2" strokeDasharray="2 4" />
      {plan && <path d={path(plan.map((w) => w.safety_stock))} fill="none" stroke="var(--brand-4)" strokeWidth="2" strokeDasharray="2 4" opacity="0.6" />}
      <path d={path(rows.map((r) => r.balance_if_on_time))} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeDasharray="5 5" />
      <path d={path(base)} fill="none" stroke="var(--brand-5)" strokeWidth={plan ? 2 : 3} opacity={plan ? 0.65 : 1} />
      {rows.map((r, i) => (
        <circle key={`b${i}`} cx={x(i)} cy={y(r.projected_balance)} r="3.2" fill={r.projected_balance < 0 ? 'var(--brand-5)' : 'var(--card)'} stroke="var(--brand-5)" strokeWidth="1.5">
          <title>{`${shortDate(r.week_start)} projected ${num(r.projected_balance)}${r.receipt_pos ? ` · receipt ${r.receipt_pos}` : ''}`}</title>
        </circle>
      ))}
      {plan && <path d={path(plan.map((w) => w.balance))} fill="none" stroke="var(--primary)" strokeWidth="3" />}
      {plan && plan.map((w, i) => <circle key={`p${i}`} cx={x(i)} cy={y(w.balance)} r="3.2" fill="var(--primary)"><title>{`${shortDate(w.week_start)} with plan ${num(w.balance)}`}</title></circle>)}
      {rows.map((r, i) => r.receipts > 0 && (
        <g key={`r${i}`}>
          <path d={`M${x(i) - 5},${H - B + 2} L${x(i) + 5},${H - B + 2} L${x(i)},${H - B - 6} Z`} fill="var(--success)" />
        </g>
      ))}
      {rows.map((r, i) => (
        <text key={`t${i}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill={r.projected_balance < 0 ? 'var(--brand-5)' : 'var(--muted-foreground)'} fontWeight={r.projected_balance < 0 ? 700 : 400}>
          {shortDate(r.week_start)}
        </text>
      ))}
    </svg>
  );
}

export function ChartLegend({ withPlan }: { withPlan: boolean }) {
  const item = (color: string, label: string, dash?: string, w = 3) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={color} strokeWidth={w} strokeDasharray={dash} /></svg>{label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
      {item('var(--brand-5)', 'Projected (POs at revised ETA)')}
      {item('var(--muted-foreground)', 'If POs had been on time', '5 5', 1.5)}
      {item('var(--brand-4)', 'Safety stock', '2 4', 2)}
      {withPlan && item('var(--primary)', 'With your plan')}
      <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-[var(--brand-3)] opacity-50" />Weekly requirement (AI_FORECAST × BOM)</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block text-[var(--success)]">▲</span>PO receipt</span>
    </div>
  );
}
