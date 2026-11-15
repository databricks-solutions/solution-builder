import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[#3A1412] text-[#FF9A8A]',
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

import { PRIORITY_LABEL, SSR_LABEL, STATUS_LABEL, type FlightStatus, type Priority } from './api';

export type { Tone };

const STATUS_TONE: Record<FlightStatus, Tone> = { unplanned: 'neutral', plan_drafted: 'info', awaiting_approval: 'warn', committed: 'good' };
export function FlightStatusPill({ status }: { status: FlightStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

const PRIO_TONE: Record<Priority, Tone> = { P1: 'bad', P2: 'warn', P3: 'bad', P4: 'info', P5: 'neutral', P6: 'neutral' };
export function PriorityPill({ p }: { p: Priority }) {
  return <Pill tone={PRIO_TONE[p]}>{p} · {PRIORITY_LABEL[p]}</Pill>;
}

export function SsrChips({ ssr }: { ssr: string }) {
  const codes = ssr.split(',').filter(Boolean);
  if (!codes.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} title={SSR_LABEL[c] ?? c}
          className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
            c === 'UMNR' || c.startsWith('WCH') ? 'bg-[#3A1A12] text-[#FF9A7A]' : c === 'INFT' ? 'bg-[#2E2508] text-[#FFD166]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]')}>
          {c}
        </span>
      ))}
    </span>
  );
}

const TIER_TONE: Record<string, string> = {
  Diamond: 'bg-[#1D3B66] text-[#D6E6FF]', Platinum: 'bg-[#2E3440] text-[#E4E8EE]', Gold: 'bg-[#3A2C08] text-[#FFD166]', Silver: 'bg-[#22262E] text-[#C9D1DC]',
};
export function TierBadge({ tier }: { tier: string }) {
  if (!TIER_TONE[tier]) return null;
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', TIER_TONE[tier])}>{tier}</span>;
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
