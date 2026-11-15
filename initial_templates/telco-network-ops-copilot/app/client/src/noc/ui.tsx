import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Activity, BatteryWarning, Cable, RadioTower, Waypoints, type LucideIcon } from 'lucide-react';

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[#3A1219] text-[#FF8C98]',
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
  triaged: { label: 'Triaged', tone: 'info' },
  ticketed: { label: 'Ticket opened', tone: 'bad' },
  closed_explained: { label: 'Closed — explained', tone: 'good' },
};
export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
export const PRIORITY_TONE: Record<string, Tone> = { P1: 'bad', P2: 'warn', P3: 'info', P4: 'neutral' };
export function PriorityPill({ p, className }: { p: string; className?: string }) {
  return <Pill tone={PRIORITY_TONE[p] ?? 'neutral'} className={cn('font-semibold', className)}>{p}</Pill>;
}
export const VERDICT: Record<string, { label: string; tone: Tone }> = {
  root_cause_identified: { label: 'Root cause identified', tone: 'bad' },
  degradation_confirmed: { label: 'Degradation confirmed', tone: 'warn' },
  explained: { label: 'Explained — no action', tone: 'good' },
  needs_investigation: { label: 'Needs investigation', tone: 'neutral' },
};
export const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  alarm_storm: { label: 'Alarm storm', icon: Waypoints },
  power_alarm: { label: 'Power', icon: BatteryWarning },
  backhaul_alarm: { label: 'Backhaul', icon: Cable },
  site_outage: { label: 'Site outage', icon: RadioTower },
  kpi_anomaly: { label: 'KPI anomaly', icon: Activity },
};
export const SOURCE_STYLE: Record<string, { label: string; cls: string }> = {
  alarm: { label: 'Alarm', cls: 'bg-[#3A1219] text-[#FF8C98]' },
  optics: { label: 'Optics', cls: 'bg-[#0C2A3D] text-[#7CC8FF]' },
  kpi: { label: 'KPI', cls: 'bg-[#33230B] text-[#FFC466]' },
  topology: { label: 'Topology', cls: 'bg-[#22173A] text-[#C4B0FF]' },
  planned: { label: 'Planned', cls: 'bg-[#0E2A24] text-[#7BF0C0]' },
  care: { label: 'Care', cls: 'bg-[#1A2430] text-[#B8C6D3]' },
  ticket: { label: 'Ticket', cls: 'bg-[#1A2430] text-[#B8C6D3]' },
};
export function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_STYLE[source] ?? { label: source, cls: 'bg-[var(--muted)]' };
  return <span className={cn('inline-flex w-[68px] shrink-0 justify-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', s.cls)}>{s.label}</span>;
}
export const SEV_CLS: Record<string, string> = {
  critical: 'bg-[#FF4D5E] text-[#1A0306]', major: 'bg-[#FFB020] text-[#1F1400]', minor: 'bg-[#3A2F0C] text-[#FFD27A]', warning: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
};
export function SevBadge({ sev }: { sev: string }) {
  return <span className={cn('inline-flex w-[58px] shrink-0 justify-center rounded px-1 py-0.5 text-[10px] font-semibold uppercase', SEV_CLS[sev] ?? SEV_CLS.warning)}>{sev}</span>;
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

/** Multi-series line chart (SVG) — one line per series key, optional horizontal threshold. */
export function LineChart({ rows, x, series, colors, threshold, height = 200, unit = '' }: {
  rows: Array<Record<string, unknown>>; x: string; series: string[]; colors: string[]; threshold?: { value: number; label: string }; height?: number; unit?: string;
}) {
  const W = 640, H = height, L = 40, B = 22, T = 10, R = 10;
  const xs = [...new Set(rows.map((r) => String(r[x])))].sort();
  const vals = rows.flatMap((r) => series.map((s) => Number(r[s]))).filter((v) => Number.isFinite(v));
  const max = Math.max(threshold?.value ?? 0, ...vals) * 1.1 || 1;
  const min = Math.min(0, ...vals);
  const px = (i: number) => L + (i / Math.max(1, xs.length - 1)) * (W - L - R);
  const py = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((f) => { const v = min + (max - min) * f; return (
        <g key={f}><line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="var(--border)" /><text x={L - 5} y={py(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{v.toFixed(v < 10 ? 1 : 0)}{unit}</text></g>
      ); })}
      {threshold && <g><line x1={L} x2={W - R} y1={py(threshold.value)} y2={py(threshold.value)} stroke="var(--brand-5)" strokeDasharray="4 3" /><text x={W - R} y={py(threshold.value) - 4} textAnchor="end" fontSize="10" fill="var(--brand-5)">{threshold.label}</text></g>}
      {series.map((s, k) => {
        const pts = xs.map((xv, i) => { const r = rows.find((row) => String(row[x]) === xv); const v = r ? Number(r[s]) : NaN; return Number.isFinite(v) ? `${px(i)},${py(v)}` : null; }).filter(Boolean);
        return <polyline key={s} points={pts.join(' ')} fill="none" stroke={colors[k % colors.length]} strokeWidth={2.2} />;
      })}
      {xs.map((xv, i) => (i % Math.ceil(xs.length / 7) === 0 ? <text key={xv} x={px(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{xv.slice(5, 10)}</text> : null))}
    </svg>
  );
}
