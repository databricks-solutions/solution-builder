import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const cn = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  good: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
  warn: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
  bad: 'bg-[#FBE3E1] text-[#9B2A22]',
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

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'good' | 'warn' }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums',
        tone === 'bad' && 'text-[var(--brand-5)]', tone === 'good' && 'text-[var(--success)]', tone === 'warn' && 'text-[var(--severity-warning)]')}>{value}</div>
      {sub && <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{sub}</div>}
    </div>
  );
}

export function Card({ title, icon, right, children, className }: { title?: ReactNode; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold">{icon}{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Right-side slide-over panel (no portal needed — sits over the page). */
export function Drawer({ open, onClose, title, subtitle, children, width = 'max-w-3xl' }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string;
}) {
  // Escape dismisses the drawer (aria-modal dialogs are expected to close on Esc).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-label="Close panel" />
      <div className={cn('relative h-full w-full overflow-y-auto bg-[var(--background)] shadow-2xl', width)}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--card)] px-6 py-4">
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight">{title}</div>
            {subtitle && <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-5 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Horizontal "where the lift went" bar: net incremental | pantry-loading dip | cannibalization. */
export function LiftBar({ net, dip, cannib }: { net: number; dip: number; cannib: number }) {
  const t = Math.max(1, Math.max(net, 0) + Math.max(dip, 0) + Math.max(cannib, 0));
  const seg = (v: number) => `${(100 * Math.max(v, 0)) / t}%`;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div style={{ width: seg(net), background: 'var(--brand-2)' }} title="Net incremental" />
        <div style={{ width: seg(dip), background: 'var(--brand-4)' }} title="Pantry-loading dip" />
        <div style={{ width: seg(cannib), background: 'var(--brand-5)' }} title="Cannibalized sister SKUs" />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: 'var(--brand-2)' }} />Net incremental</span>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: 'var(--brand-4)' }} />Pantry loading (4 wks after)</span>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: 'var(--brand-5)' }} />Cannibalized sister SKUs</span>
      </div>
    </div>
  );
}
