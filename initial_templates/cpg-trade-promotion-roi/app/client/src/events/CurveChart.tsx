import type { CurvePoint } from '@/lib/promo';
import { unitsK, weekLabel } from '@/lib/promo';

/**
 * Event curve: actual vs ML baseline for the promoted SKU (top) and its sister SKUs (bottom),
 * with the event weeks shaded and the pantry-loading dip area filled.
 */
export function CurveChart({ curve, height = 220 }: { curve: CurvePoint[]; height?: number }) {
  if (!curve.length) return null;
  const W = 640, H = height, padL = 46, padR = 12, padT = 12, padB = 26;
  const xs = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, curve.length - 1);
  const max = Math.max(...curve.map((p) => Math.max(p.actual, p.baseline))) * 1.08;
  const ys = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = (k: 'actual' | 'baseline') => curve.map((p, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(p[k])}`).join(' ');
  const ev = curve.map((p, i) => (p.phase === 'event' ? i : -1)).filter((i) => i >= 0);
  const post = curve.map((p, i) => (p.phase === 'post' ? i : -1)).filter((i) => i >= 0);
  const band = ev.length ? { x0: xs(ev[0]) - 14, x1: xs(ev[ev.length - 1]) + 14 } : null;
  const dipArea = post.length
    ? `M${xs(post[0])},${ys(curve[post[0]].baseline)} ` +
      post.map((i) => `L${xs(i)},${ys(curve[i].baseline)}`).join(' ') + ' ' +
      [...post].reverse().map((i) => `L${xs(i)},${ys(Math.min(curve[i].actual, curve[i].baseline))}`).join(' ') + ' Z'
    : '';
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Actual vs baseline units by week">
      {band && <rect x={band.x0} y={padT} width={band.x1 - band.x0} height={H - padT - padB} fill="var(--brand-4)" opacity={0.18} rx={6} />}
      {band && <text x={(band.x0 + band.x1) / 2} y={padT + 12} textAnchor="middle" fontSize={10} fill="var(--severity-warning)" fontWeight={600}>PROMO</text>}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={ys(t)} y2={ys(t)} stroke="var(--border)" strokeDasharray="3 3" />
          <text x={padL - 6} y={ys(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{unitsK(t)}</text>
        </g>
      ))}
      {dipArea && <path d={dipArea} fill="var(--brand-5)" opacity={0.22} />}
      <path d={line('baseline')} fill="none" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" />
      <path d={line('actual')} fill="none" stroke="var(--brand-1)" strokeWidth={2.5} />
      {curve.map((p, i) => (
        <g key={p.week_start}>
          <circle cx={xs(i)} cy={ys(p.actual)} r={3} fill="var(--brand-1)" />
          {(i % 2 === 0 || curve.length < 9) && (
            <text x={xs(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{weekLabel(p.week_start)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function CurveLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
      <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4" style={{ background: 'var(--brand-1)' }} />Actual units (POS)</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--muted-foreground)' }} />ML baseline (baseline_demand_model@champion)</span>
      <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: 'var(--brand-5)', opacity: 0.4 }} />Pantry-loading dip</span>
    </div>
  );
}
