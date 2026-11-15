import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[#FBE3E6] text-[#9B1C2E]',
  info: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
  brand: 'bg-[var(--primary)] text-[var(--primary-foreground)]',
};

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

export const RESULT_TONE: Record<string, Tone> = { PASS: 'good', FAIL: 'bad', NEEDS_INFO: 'warn', FLAG: 'info' };
export const RESULT_LABEL: Record<string, string> = { PASS: 'Pass', FAIL: 'Fail', NEEDS_INFO: 'Needs info', FLAG: 'Flag' };

export const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  pending_review: { label: 'Pending review', tone: 'neutral' },
  awaiting_verification: { label: 'Awaiting verification', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  denied: { label: 'Denied', tone: 'bad' },
  escalated: { label: 'Escalated', tone: 'info' },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

/** "Day 38 of 30" meter against the federal standard. */
export function DeadlineMeter({ daysOpen, standard, compact }: { daysOpen: number; standard: number; compact?: boolean }) {
  const pct = Math.min(100, (daysOpen / standard) * 100);
  const over = daysOpen > standard;
  const color = over ? 'var(--brand-5)' : pct > 70 ? 'var(--severity-warning)' : 'var(--success)';
  return (
    <div className={cn('flex items-center gap-2', compact ? 'min-w-[120px]' : 'min-w-[180px]')}>
      <div className="h-1.5 flex-1 rounded-full bg-[var(--muted)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={cn('text-xs tabular-nums whitespace-nowrap', over ? 'font-semibold text-[var(--brand-5)]' : 'text-[var(--muted-foreground)]')}>
        day {daysOpen}/{standard}
      </span>
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'bad' && 'text-[var(--brand-5)]', tone === 'warn' && 'text-[var(--severity-warning)]')}>{value}</div>
      {sub && <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{sub}</div>}
    </div>
  );
}
