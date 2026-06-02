/**
 * Three KPI cards at the top of the Operations page: pending / approved /
 * escalated with counts + $ totals. Drives the "live update" demo moment —
 * click a decision and the numbers tick. When the agent's bulk write fires
 * `dataMutated`, each card's `count` is compared to the previous value and
 * only the cards that *moved* pulse a primary ring (see usePulseOnChange).
 */
import { AlertTriangle, CheckCircle2, PackageOpen } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { ReturnsSummary, ReturnStatus } from '@/shared/types';

export function KpiCards({ summary }: { summary: ReturnsSummary[] }) {
  const byStatus = new Map<ReturnStatus, ReturnsSummary>();
  for (const s of summary) byStatus.set(s.status, s);
  const pending = byStatus.get('pending');
  const approved = byStatus.get('approved');
  const escalated = byStatus.get('escalated');
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card
        label="Pending"
        count={pending?.n ?? 0}
        value={pending?.total_usd ?? '0'}
        icon={<PackageOpen className="size-4" />}
        tone="neutral"
      />
      <Card
        label="Approved"
        count={approved?.n ?? 0}
        value={approved?.total_usd ?? '0'}
        icon={<CheckCircle2 className="size-4" />}
        tone="success"
      />
      <Card
        label="Escalated to QA"
        count={escalated?.n ?? 0}
        value={escalated?.total_usd ?? '0'}
        icon={<AlertTriangle className="size-4" />}
        tone="danger"
      />
    </div>
  );
}

function Card({
  label,
  count,
  value,
  icon,
  tone,
}: {
  label: string;
  count: number;
  value: string;
  icon: React.ReactNode;
  tone: 'neutral' | 'success' | 'danger';
}) {
  const pulse = usePulseOnChange(count);
  const toneClass =
    tone === 'success'
      ? 'text-[var(--success-subtle-foreground)]'
      : tone === 'danger'
        ? 'text-destructive'
        : 'text-foreground';
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="display text-3xl font-semibold text-foreground">
          {count.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground">
          · $
          {Number(value).toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </div>
      </div>
    </div>
  );
}
