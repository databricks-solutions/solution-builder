import type { Json } from '@/lib/api';
import { usd } from '@/lib/api';

/** Daily cash deposited (bars, red when any deposit was $8K–$10K) + outbound wires (dots). */
export function CashChart({ daily }: { daily: Json[] }) {
  if (!daily.length) return <div className="h-40 grid place-items-center text-sm text-muted-foreground">No activity in the last 60 days</div>;
  const W = 760, H = 190, pad = { l: 48, r: 10, t: 10, b: 24 };
  const max = Math.max(10000, ...daily.map((d) => Number(d.cash_in)), ...daily.map((d) => Number(d.wires_out)));
  const bw = (W - pad.l - pad.r) / daily.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#E1E6EE" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#5B6573">{usd(t, true)}</text>
        </g>
      ))}
      {daily.map((d, i) => (
        <g key={String(d.day)}>
          <rect x={pad.l + i * bw + 1} width={Math.max(1, bw - 2)} y={y(Number(d.cash_in))} height={H - pad.b - y(Number(d.cash_in))}
            fill={Number(d.sub_ctr) > 0 ? '#D1495B' : '#3E7CB1'} opacity={0.85}>
            <title>{`${d.day}: ${usd(d.cash_in)} cash (${d.sub_ctr} deposits $8K–$10K)`}</title>
          </rect>
          {Number(d.wires_out) > 0 && (
            <circle cx={pad.l + i * bw + bw / 2} cy={y(Number(d.wires_out))} r={4} fill="#0B2545">
              <title>{`${d.day}: ${usd(d.wires_out)} wired out`}</title>
            </circle>
          )}
          {i % 10 === 0 && <text x={pad.l + i * bw} y={H - 6} fontSize="10" fill="#5B6573">{String(d.day).slice(5)}</text>}
        </g>
      ))}
    </svg>
  );
}
