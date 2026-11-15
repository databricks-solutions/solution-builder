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

import { DECISION_LABEL, STATUS_LABEL, type Decision, type SubStatus } from './api';

export type { Tone };

const STATUS_TONE: Record<SubStatus, Tone> = { new: 'neutral', review_drafted: 'info', referred: 'warn', decided: 'good' };
export function StatusPill({ status }: { status: SubStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

const DECISION_TONE: Record<Decision, Tone> = { QUOTE: 'good', QUOTE_WITH_CONDITIONS: 'info', DECLINE: 'bad', REQUEST_INFO: 'warn' };
export function DecisionPill({ d }: { d: Decision }) {
  return <Pill tone={DECISION_TONE[d]}>{DECISION_LABEL[d]}</Pill>;
}

const BAND_TONE: Record<string, Tone> = { Low: 'good', Moderate: 'warn', High: 'bad' };
export function BandPill({ band, p }: { band: string | null; p?: number | null }) {
  if (!band) return <span className="text-[var(--muted-foreground)]">—</span>;
  return <Pill tone={BAND_TONE[band] ?? 'neutral'}>{band}{p != null ? ` ${p.toFixed(2)}` : ''}</Pill>;
}

const LANE_TONE: Record<string, Tone> = {
  'Fast track': 'good', 'Underwriter review': 'neutral', 'Documents disagree': 'bad', 'Appetite referral': 'warn',
  'CUO authority referral': 'info', 'Request information': 'warn', 'Decline - out of appetite': 'bad',
};
export function LanePill({ lane }: { lane: string }) {
  return <Pill tone={LANE_TONE[lane] ?? 'neutral'}>{lane.replace(' - ', ' · ')}</Pill>;
}

const TIER_TONE: Record<string, string> = { Premier: 'bg-[#14213D] text-white', Preferred: 'bg-[#D9E6EC] text-[#1F3A4D]' };
export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier || !TIER_TONE[tier]) return null;
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
