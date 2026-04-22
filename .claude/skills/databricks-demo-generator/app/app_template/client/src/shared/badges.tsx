/**
 * Small pill-style badges reused across the Operations page + home activity
 * feed. If you add a new status or tier, update both the type union in
 * shared/types.ts and the colour map here.
 */
import type { ReturnStatus } from './types';

export function StatusBadge({ status }: { status: ReturnStatus }) {
  const styles: Record<ReturnStatus, string> = {
    pending: 'bg-muted text-foreground',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-muted text-muted-foreground',
    escalated: 'bg-amber-100 text-amber-900',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    gold: 'bg-amber-100 text-amber-900',
    silver: 'bg-slate-100 text-slate-700',
    bronze: 'bg-orange-100 text-orange-900',
    platinum: 'bg-violet-100 text-violet-800',
  };
  const cls = styles[tier.toLowerCase()] ?? 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${cls}`}
    >
      {tier}
    </span>
  );
}
