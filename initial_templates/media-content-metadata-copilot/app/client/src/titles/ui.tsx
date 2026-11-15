import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[rgb(255_107_87/0.16)] text-[#FFB0A3]',
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

export const RESULT_TONE: Record<string, Tone> = { PASS: 'good', FIX: 'warn', FLAG: 'bad' };
export const RESULT_LABEL: Record<string, string> = { PASS: 'Pass', FIX: 'Fix', FLAG: 'Flag' };

export const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  needs_review: { label: 'Needs review', tone: 'neutral' },
  proposal_ready: { label: 'AI proposal ready', tone: 'info' },
  approved: { label: 'Published', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

/** Completeness 0-100 bar (red < 40, amber < 80, green). */
export function CompletenessBar({ value, to, compact }: { value: number; to?: number | null; compact?: boolean }) {
  const color = (v: number) => (v < 40 ? 'var(--brand-5)' : v < 80 ? 'var(--brand-4)' : 'var(--success)');
  return (
    <div className={cn('flex items-center gap-2', compact ? 'min-w-[130px]' : 'min-w-[200px]')}>
      <div className="relative h-1.5 flex-1 rounded-full bg-[var(--muted)] overflow-hidden">
        {to != null && to > value && <div className="absolute inset-y-0 left-0 rounded-full opacity-25" style={{ width: `${to}%`, background: color(to) }} />}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value}%`, background: color(value) }} />
      </div>
      <span className="text-xs tabular-nums whitespace-nowrap">
        <b style={{ color: color(value) }}>{value}</b>
        {to != null && to !== value && <span className="text-[var(--muted-foreground)]"> → {to}</span>}
      </span>
    </div>
  );
}

/** Exposure vs a well-tagged peer (1.0 = as seen as its peers). */
export function ExposureBar({ actual, peer }: { actual: number; peer: number | null }) {
  const ratio = peer ? actual / peer : null;
  const pct = ratio == null ? 0 : Math.min(100, ratio * 100);
  const low = ratio != null && ratio < 0.4;
  return (
    <div className="min-w-[150px]">
      <div className="h-1.5 rounded-full bg-[var(--muted)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: low ? 'var(--brand-5)' : 'var(--primary-light)' }} /></div>
      <div className={cn('mt-0.5 text-[11px] tabular-nums', low ? 'text-[var(--brand-5)] font-semibold' : 'text-[var(--muted-foreground)]')}>
        {fmtK(actual)} {peer ? <>· {ratio!.toFixed(2)}× peer</> : null}
      </div>
    </div>
  );
}

export const fmtK = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
export const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(Number(x) * 100)}%`);

/** Tag chips for one metadata facet. */
export function Chips({ items, tone = 'neutral', empty = 'none', strike, highlight }: { items: string[]; tone?: Tone; empty?: string; strike?: string[]; highlight?: string[] }) {
  if (!items.length) return <span className="text-xs italic text-[var(--brand-5)]">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <Pill key={t} tone={highlight?.includes(t) ? 'good' : tone} className={cn(strike?.includes(t) && 'line-through opacity-60')}>{t}</Pill>
      ))}
    </div>
  );
}

/** Deterministic "key art" gradient per title (no images in the synthetic library). */
export function KeyArt({ title, id, className }: { title: string; id: string; className?: string }) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 40 + (h % 80)) % 360;
  return (
    <div className={cn('relative overflow-hidden rounded-xl text-white shadow-inner', className)}
      style={{ background: `linear-gradient(145deg, hsl(${a} 55% 28%), hsl(${b} 60% 45%))` }}>
      <div className="absolute inset-x-0 bottom-0 p-2.5 font-display text-sm font-semibold leading-tight drop-shadow">{title}</div>
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
