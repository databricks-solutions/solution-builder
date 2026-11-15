import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[#3A1620] text-[#FF8A96]',
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

export type { Tone };

export const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'neutral' },
  investigating: { label: 'Investigated', tone: 'info' },
  escalated: { label: 'Incident opened', tone: 'bad' },
  closed_benign: { label: 'Closed — benign', tone: 'good' },
};
export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
export const PRIORITY_TONE: Record<string, Tone> = { critical: 'bad', high: 'warn', medium: 'neutral' };
export const VERDICT: Record<string, { label: string; tone: Tone }> = {
  confirmed_compromise: { label: 'Confirmed compromise', tone: 'bad' },
  suspicious: { label: 'Suspicious — needs more work', tone: 'warn' },
  benign: { label: 'Benign — explained', tone: 'good' },
};
// Source badges on the raw-evidence stream — DARK console chips: a
// translucent same-hue wash + a bright label, so each log source reads
// like a SIEM field tag against the near-black event list.
export const SOURCE_STYLE: Record<string, { label: string; cls: string }> = {
  auth: { label: 'Sign-in', cls: 'bg-[#15283F] text-[#7FB2E6]' },
  vpn: { label: 'VPN', cls: 'bg-[#241C3C] text-[#B49BE8]' },
  endpoint: { label: 'EDR', cls: 'bg-[#33240F] text-[#E0A676]' },
  dns: { label: 'DNS', cls: 'bg-[#0F2E2A] text-[#5CCFBE]' },
  siem: { label: 'SIEM', cls: 'bg-[#20293A] text-[#9FB0C4]' },
  ueba: { label: 'UEBA', cls: 'bg-[#3A1620] text-[#FF8A96]' },
  ticket: { label: 'Ticket', cls: 'bg-[#20293A] text-[#9FB0C4]' },
};
export function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_STYLE[source] ?? { label: source, cls: 'bg-[var(--muted)]' };
  return <span className={cn('inline-flex w-[64px] shrink-0 justify-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', s.cls)}>{s.label}</span>;
}

/** Risk score 0-100 as a coloured number. */
export function RiskScore({ score, className }: { score: number; className?: string }) {
  const color = score >= 85 ? 'var(--brand-5)' : score >= 70 ? 'var(--severity-warning)' : 'var(--muted-foreground)';
  return <span className={cn('tabular-nums font-semibold', className)} style={{ color }}>{Math.round(score)}</span>;
}

/** Tiny bar sparkline of daily risk. */
export function Spark({ values, height = 22 }: { values: number[]; height?: number }) {
  const v = values.slice(-14);
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {v.map((x, i) => (
        <div key={i} className="w-[5px] rounded-sm" style={{ height: `${Math.max(6, x)}%`, background: x >= 85 ? 'var(--brand-5)' : x >= 55 ? 'var(--severity-warning)' : 'var(--border)' }} />
      ))}
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
