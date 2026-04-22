/**
 * "Return" tab of the drawer. Shows return-level fields + decision
 * history + the approve/reject/escalate form.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { decideReturn } from '@/lib/returns';
import type { Decision, ReturnDetail } from '@/shared/types';

export function ReturnTab({
  detail,
  onMutated,
}: {
  detail: ReturnDetail;
  onMutated: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(d: Decision) {
    setPending(d);
    setError(null);
    try {
      await decideReturn(detail.return_id, d, notes || undefined);
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  const isFinal = detail.status !== 'pending';

  return (
    <div className="space-y-6 max-w-2xl">
      <dl className="grid grid-cols-3 gap-y-4 text-sm">
        <DetailRow
          label="Reason"
          value={detail.return_reason_text ?? detail.return_reason ?? '—'}
        />
        <DetailRow
          label="Refund"
          value={`$${Number(detail.refund_amount_usd).toLocaleString()}`}
        />
        <DetailRow label="Return date" value={detail.return_date ?? '—'} />
        <DetailRow label="Order date" value={detail.order_date ?? '—'} />
        <DetailRow
          label="Order total"
          value={
            detail.order_total_usd
              ? `$${Number(detail.order_total_usd).toLocaleString()}`
              : '—'
          }
        />
        <DetailRow label="Region" value={detail.region ?? '—'} />
      </dl>

      {isFinal && (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          This return has been {detail.status}. Further decisions will overwrite
          the status.
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add context for QA or the customer-success team…"
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
        {error && <div className="text-xs text-destructive">{error}</div>}
        <div className="flex gap-2">
          <ActionButton
            label="Approve"
            icon={<CheckCircle2 className="size-4" />}
            onClick={() => decide('approved')}
            pending={pending === 'approved'}
            variant="success"
          />
          <ActionButton
            label="Reject"
            icon={<XCircle className="size-4" />}
            onClick={() => decide('rejected')}
            pending={pending === 'rejected'}
            variant="neutral"
          />
          <ActionButton
            label="Escalate"
            icon={<AlertTriangle className="size-4" />}
            onClick={() => decide('escalated')}
            pending={pending === 'escalated'}
            variant="danger"
          />
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground col-span-1 pt-0.5">
        {label}
      </dt>
      <dd className="col-span-2">{value}</dd>
    </>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  pending,
  variant,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  variant: 'success' | 'neutral' | 'danger';
}) {
  const cls =
    variant === 'success'
      ? 'bg-success text-success-foreground hover:opacity-90'
      : variant === 'danger'
        ? 'bg-warning text-warning-foreground hover:opacity-90'
        : 'bg-muted text-foreground hover:bg-muted/70';
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {icon}
      {pending ? '…' : label}
    </button>
  );
}
