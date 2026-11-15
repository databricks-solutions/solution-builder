/**
 * Lift-vs-baseline waterfall for ONE event, in units.
 *
 *   baseline ──► + gross lift ──► − pantry-loading dip ──► − cannibalized sister SKUs ──► after
 *
 * `after` = baseline + net incremental (the volume the category keeps once the dip and the
 * cannibalization are netted out). Forward-buying is trade cost, not volume, so it stays a
 * note under the chart (see PlanDrawer), same as the post-event analysis.
 */
import { unitsK } from '@/lib/promo';

type Props = { baseline: number; gross: number; dip: number; cannib: number };

export function LiftWaterfall({ baseline, gross, dip, cannib }: Props) {
  const base = Math.max(0, baseline);
  const top = base + Math.max(0, gross);
  const afterDip = top - Math.max(0, dip);
  const after = Math.max(0, afterDip - Math.max(0, cannib));
  const max = Math.max(1, top, base);
  const H = 160;
  const y = (v: number) => `${(Math.max(0, v) / max) * 100}%`;

  // each bar: [label, bottom level, top level, colour, value text]
  const bars: Array<{
    label: string;
    lo: number;
    hi: number;
    bg: string;
    text: string;
  }> = [
    {
      label: 'ML baseline',
      lo: 0,
      hi: base,
      bg: '#8C7B6B',
      text: unitsK(base),
    },
    {
      label: '+ Lift',
      lo: base,
      hi: top,
      bg: '#1F5C4D',
      text: `+${unitsK(gross)}`,
    },
    {
      label: '− Pantry dip',
      lo: afterDip,
      hi: top,
      bg: '#F3D27A',
      text: `−${unitsK(dip)}`,
    },
    {
      label: '− Cannibal.',
      lo: after,
      hi: afterDip,
      bg: '#7A1F17',
      text: `−${unitsK(cannib)}`,
    },
    { label: 'Kept', lo: 0, hi: after, bg: '#2A1F17', text: unitsK(after) },
  ];

  return (
    <div>
      <div
        className="flex items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 pb-2 pt-3"
        style={{ height: H + 56 }}
      >
        {bars.map((b) => (
          <div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center">
            <div className="relative w-full flex-1">
              <div
                className="absolute inset-x-1 rounded-sm"
                style={{
                  bottom: y(b.lo),
                  height: `${Math.max(2, ((b.hi - b.lo) / max) * 100)}%`,
                  background: b.bg,
                }}
                title={`${b.label}: ${Math.round(b.hi - b.lo).toLocaleString('en-US')} units`}
              />
            </div>
            <div className="mt-1.5 text-center text-xs font-semibold tabular-nums">{b.text}</div>
            <div className="text-center text-[10px] leading-tight text-[var(--muted-foreground)]">{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
