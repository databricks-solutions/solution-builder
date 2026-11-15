import type { CaseStatus, Clock, Lane } from './types';
import { fmtHours } from '@/lib/pa';

const pill = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap';

export const LANE_STYLE: Record<Lane, { cls: string; short: string; dot: string }> = {
  'Auto-approval lane': { cls: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]', short: 'Auto-approve', dot: 'var(--success)' },
  'Nurse fast-track': { cls: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]', short: 'Fast-track', dot: 'var(--brand-2)' },
  'Request information': { cls: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]', short: 'Request info', dot: 'var(--severity-warning)' },
  'Physician review': { cls: 'bg-[#FBE3DE] text-[#8A2B17]', short: 'MD review', dot: 'var(--destructive)' },
};

export function LaneBadge({ lane }: { lane: Lane | null }) {
  if (!lane) return <span className={`${pill} bg-muted text-muted-foreground`}>Not reviewed</span>;
  const s = LANE_STYLE[lane];
  return (
    <span className={`${pill} ${s.cls}`}>
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {s.short}
    </span>
  );
}

export function ClockBadge({ hours, clock }: { hours: number; clock: Clock }) {
  const cls =
    clock === 'breached'
      ? 'bg-destructive text-white'
      : clock === 'at_risk'
        ? 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)] ring-1 ring-[var(--severity-warning)]/40'
        : 'bg-muted text-muted-foreground';
  return <span className={`${pill} font-mono ${cls}`}>{fmtHours(hours)}</span>;
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  return urgency === 'Expedited' ? (
    <span className={`${pill} bg-[var(--primary)] text-white`}>Expedited · 72h</span>
  ) : (
    <span className={`${pill} bg-muted text-muted-foreground`}>Standard · 7d</span>
  );
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const m: Record<CaseStatus, [string, string]> = {
    open: ['Open', 'bg-muted text-foreground'],
    approved: ['Approved', 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]'],
    auto_approved: ['Auto-approved', 'bg-[var(--success)] text-white'],
    pended: ['Pended · info requested', 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]'],
    referred_md: ['Referred to Medical Director', 'bg-[#FBE3DE] text-[#8A2B17]'],
  };
  const [label, cls] = m[status];
  return <span className={`${pill} ${cls}`}>{label}</span>;
}

export function CriterionIcon({ status }: { status: string | null }) {
  if (status === 'Met')
    return <span className="size-5 shrink-0 rounded-full bg-[var(--success)] text-white text-[11px] flex items-center justify-center">✓</span>;
  if (status === 'Not Met')
    return <span className="size-5 shrink-0 rounded-full bg-destructive text-white text-[11px] flex items-center justify-center">✕</span>;
  return <span className="size-5 shrink-0 rounded-full bg-[var(--warning)] text-[var(--warning-foreground)] text-[11px] font-bold flex items-center justify-center">?</span>;
}
