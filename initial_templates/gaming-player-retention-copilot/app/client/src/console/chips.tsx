import { DRIVER_META, type SegmentStatus } from '@/lib/liveops';

export function TierBadge({ tier }: { tier: string }) {
  const cls =
    tier === 'Critical' ? 'bg-[rgb(255_77_94/0.14)] text-[#FF8A96] border-[rgb(255_77_94/0.4)]'
    : tier === 'High' ? 'bg-[rgb(255_201_60/0.14)] text-[#FFC93C] border-[rgb(255_201_60/0.4)]'
    : 'bg-[rgb(255_201_60/0.08)] text-[#FFD874] border-[rgb(255_201_60/0.3)]';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{tier}</span>;
}

export function DriverChip({ driver }: { driver: string }) {
  const m = DRIVER_META[driver] ?? DRIVER_META.engagement;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${m.color}15`, color: m.color }}>
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.short}
    </span>
  );
}

const STATUS: Record<SegmentStatus, [string, string]> = {
  open: ['Open', 'bg-[var(--muted)] text-[var(--muted-foreground)]'],
  plan_ready: ['Plan staged', 'bg-[rgb(0_229_255/0.14)] text-[#00E5FF]'],
  scheduled: ['Scheduled', 'bg-[rgb(182_255_59/0.16)] text-[#B6FF3B]'],
  rejected: ['Sent back', 'bg-[rgb(255_255_255/0.08)] text-[#B3A9D3]'],
};

export function StatusChip({ status }: { status: SegmentStatus }) {
  const [label, cls] = STATUS[status] ?? STATUS.open;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
