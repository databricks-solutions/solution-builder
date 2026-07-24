/**
 * Small pill-style badges reused across the Operations page + home activity
 * feed. If you add a new status or tier, update both the type union in
 * shared/types.ts and the colour map here.
 */
import type { ReturnStatus } from './types';

export function StatusBadge({ status }: { status: ReturnStatus }) {
  const styles: Record<ReturnStatus, string> = {
    pending: 'bg-muted text-foreground',
    approved: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
    rejected: 'bg-muted text-muted-foreground',
    escalated: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
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
    gold: 'bg-[var(--tier-gold)] text-[var(--tier-gold-foreground)]',
    silver: 'bg-[var(--tier-silver)] text-[var(--tier-silver-foreground)]',
    bronze: 'bg-[var(--tier-bronze)] text-[var(--tier-bronze-foreground)]',
    platinum: 'bg-[var(--tier-platinum)] text-[var(--tier-platinum-foreground)]',
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
