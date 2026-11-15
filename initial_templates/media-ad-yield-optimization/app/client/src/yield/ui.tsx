import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[rgb(255_77_94/0.16)] text-[#FF8A98]',
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

export const VERDICT_TONE: Record<string, Tone> = { CONFIRMED: 'bad', RULED_OUT: 'good', WATCH: 'warn', INFO: 'info' };
export const VERDICT_LABEL: Record<string, string> = { CONFIRMED: 'Confirmed', RULED_OUT: 'Ruled out', WATCH: 'Watch', INFO: 'Evidence' };

export const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'At risk — no plan', tone: 'bad' },
  plan_drafted: { label: 'Plan drafted', tone: 'warn' },
  plan_approved: { label: 'Plan sent to ad ops', tone: 'good' },
};

export function StatusPill({ status, atRisk = true }: { status: string; atRisk?: boolean }) {
  if (!atRisk && status === 'new') return <Pill tone="good">On pace</Pill>;
  const s = STATUS_LABEL[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

/** Tiny inline sparkline. */
export function Sparkline({ values, color = 'var(--brand-5)', w = 120, h = 28 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i * w) / Math.max(1, values.length - 1)},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
