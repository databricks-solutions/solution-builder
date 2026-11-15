import { DRIVER_META, type CaseStatus } from '@/lib/desk';

export function TierBadge({ tier }: { tier: string }) {
  const cls =
    tier === 'Critical' ? 'bg-[#FDE2EE] text-[#A10B57]'
    : tier === 'High' ? 'bg-[#FFE9DC] text-[#9A3412]'
    : 'bg-[#FFF3D6] text-[#7A5300]';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{tier}</span>;
}

export function DriverChip({ driver }: { driver: string }) {
  const m = DRIVER_META[driver] ?? DRIVER_META.account;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: `${m.color}1A`, color: m.color }}>
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.short}
    </span>
  );
}

const STATUS: Record<CaseStatus, [string, string]> = {
  open: ['Open', 'bg-[#F1E7EE] text-[#5E4A59]'],
  offer_ready: ['Offer staged', 'bg-[#E4EEFF] text-[#1D4ED8]'],
  accepted: ['Saved', 'bg-[#DDF4EA] text-[#0E6B48]'],
  declined: ['Declined', 'bg-[#EFEAEE] text-[#6B5B68]'],
};

export function StatusChip({ status }: { status: CaseStatus }) {
  const [label, cls] = STATUS[status] ?? STATUS.open;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
