import { useMemo, useState } from 'react';
import type { Curve } from '@/lib/grid';
import { fmtHour } from '@/lib/grid';

/**
 * Hand-rolled SVG load chart: last 36 h of SCADA (solid), 48 h forecast (dashed)
 * with the P10–P90 band, nameplate + emergency rating lines, and (optionally)
 * the post-action curve of the selected relief option (green).
 */
export function LoadChart({
  curve, post, postLabel,
}: {
  curve: Curve;
  post?: Array<{ ts: string; post_action_mva: number }>;
  postLabel?: string;
}) {
  const W = 760, H = 280, L = 44, R = 12, T = 14, B = 28;
  const [hover, setHover] = useState<number | null>(null);

  const g = useMemo(() => {
    const pts = [
      ...curve.actual.map((a) => ({ ts: a.ts, act: a.load_mva } as Record<string, number | string>)),
      ...curve.forecast.map((f) => ({ ts: f.ts, fc: f.forecast_mva, lo: f.forecast_mva_p10, hi: f.forecast_mva_p90 } as Record<string, number | string>)),
    ];
    const postBy = new Map((post ?? []).map((p) => [p.ts, p.post_action_mva]));
    pts.forEach((p) => { if (postBy.has(p.ts as string)) p.post = postBy.get(p.ts as string)!; });
    const nameplate = curve.forecast[0]?.nameplate_mva ?? 0;
    const emergency = curve.forecast[0]?.emergency_mva ?? nameplate * 1.2;
    const vals = pts.flatMap((p) => [p.act, p.hi, p.post].filter((v) => typeof v === 'number') as number[]);
    const yMax = Math.max(emergency * 1.04, ...vals);
    const yMin = Math.min(...vals, nameplate * 0.3) * 0.9;
    const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
    const path = (key: string) => {
      let d = '';
      pts.forEach((p, i) => {
        const v = p[key];
        if (typeof v !== 'number') return;
        d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      });
      return d;
    };
    const fcStart = curve.actual.length - 1;
    const band = pts.map((p, i) => (typeof p.hi === 'number' ? `${x(i)},${y(p.hi)}` : null)).filter(Boolean).join(' ')
      + ' ' + pts.map((p, i) => (typeof p.lo === 'number' ? `${x(i)},${y(p.lo as number)}` : null)).filter(Boolean).reverse().join(' ');
    // bridge actual → forecast so the dashed line starts at "now"
    const bridge = curve.forecast.length && curve.actual.length
      ? `M${x(fcStart)},${y(curve.actual[fcStart].load_mva)}L${x(fcStart + 1)},${y(curve.forecast[0].forecast_mva)}` : '';
    const ticks = Array.from({ length: 5 }, (_, k) => yMin + ((yMax - yMin) * k) / 4);
    const dayMarks = pts.map((p, i) => ({ i, ts: p.ts as string })).filter((p) => p.ts.endsWith('T00:00'));
    return { pts, x, y, path, band, bridge, nameplate, emergency, ticks, fcStart, dayMarks };
  }, [curve, post]);

  const hp = hover !== null ? g.pts[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - L) / (W - L - R)) * (g.pts.length - 1));
          setHover(Math.max(0, Math.min(g.pts.length - 1, i)));
        }}>
        {g.ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={g.y(t)} y2={g.y(t)} stroke="var(--cr-grid)" />
            <text x={L - 6} y={g.y(t) + 4} textAnchor="end" fontSize="10" fill="var(--cr-dim)">{t.toFixed(0)}</text>
          </g>
        ))}
        <text x={4} y={T + 4} fontSize="10" fill="var(--cr-dim)">MVA</text>
        {g.dayMarks.map((d) => (
          <g key={d.ts}>
            <line x1={g.x(d.i)} x2={g.x(d.i)} y1={T} y2={H - B} stroke="var(--cr-grid)" strokeDasharray="2 3" />
            <text x={g.x(d.i) + 4} y={H - 10} fontSize="10" fill="var(--cr-dim)">
              {new Date(d.ts + ':00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </text>
          </g>
        ))}
        <rect x={g.x(g.fcStart)} y={T} width={W - R - g.x(g.fcStart)} height={H - T - B} fill="var(--cr-forecast-bg)" />
        <text x={g.x(g.fcStart) + 4} y={T + 12} fontSize="10" fill="var(--cr-dim)">NOW · forecast →</text>
        <polygon points={g.band} fill="var(--cr-band)" />
        <line x1={L} x2={W - R} y1={g.y(g.emergency)} y2={g.y(g.emergency)} stroke="var(--risk-high)" strokeDasharray="6 4" />
        <text x={W - R - 4} y={g.y(g.emergency) - 4} textAnchor="end" fontSize="10" fill="var(--risk-high)">Emergency {g.emergency.toFixed(0)} MVA</text>
        <line x1={L} x2={W - R} y1={g.y(g.nameplate)} y2={g.y(g.nameplate)} stroke="var(--risk-critical)" strokeWidth="1.5" />
        <text x={W - R - 4} y={g.y(g.nameplate) - 4} textAnchor="end" fontSize="10" fill="var(--risk-critical)">Nameplate {g.nameplate.toFixed(0)} MVA</text>
        <path d={g.path('act')} fill="none" stroke="var(--cr-actual)" strokeWidth="2.2" />
        <path d={g.bridge} fill="none" stroke="var(--cr-forecast)" strokeWidth="2.2" strokeDasharray="5 3" />
        <path d={g.path('fc')} fill="none" stroke="var(--cr-forecast)" strokeWidth="2.2" strokeDasharray="5 3" />
        {post && <path d={g.path('post')} fill="none" stroke="var(--cr-post)" strokeWidth="2.6" />}
        {hover !== null && <line x1={g.x(hover)} x2={g.x(hover)} y1={T} y2={H - B} stroke="var(--cr-dim)" />}
      </svg>
      <div className="flex flex-wrap gap-4 text-[11px] mt-1" style={{ color: 'var(--cr-dim)' }}>
        <Legend color="var(--cr-actual)" label="SCADA actual" />
        <Legend color="var(--cr-forecast)" label="Load forecast (P10–P90 band)" dashed />
        {post && <Legend color="var(--cr-post)" label={postLabel ?? 'After action'} />}
      </div>
      {hp && (
        <div className="absolute top-2 left-14 rounded-md px-2.5 py-1.5 text-[11px] pointer-events-none"
          style={{ background: 'var(--cr-panel-2)', border: '1px solid var(--cr-border)', color: 'var(--cr-text)' }}>
          <div className="font-semibold">{fmtHour(hp.ts as string)}</div>
          {typeof hp.act === 'number' && <div>Actual {hp.act.toFixed(2)} MVA · {(hp.act / g.nameplate * 100).toFixed(0)}%</div>}
          {typeof hp.fc === 'number' && <div>Forecast {hp.fc.toFixed(2)} MVA · {(hp.fc / g.nameplate * 100).toFixed(0)}%</div>}
          {typeof hp.post === 'number' && <div style={{ color: 'var(--cr-post)' }}>After action {hp.post.toFixed(2)} MVA · {(hp.post / g.nameplate * 100).toFixed(0)}%</div>}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" stroke={color} strokeWidth="2.4" strokeDasharray={dashed ? '4 2' : undefined} /></svg>
      {label}
    </span>
  );
}
