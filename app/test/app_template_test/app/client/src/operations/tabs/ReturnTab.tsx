/**
 * "Return" tab of the drawer. Shows return-level fields + decision
 * history + the approve/reject/escalate form.
 */
import { useEffect, useState } from 'react';
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
  // Final-state rows have action buttons disabled by default to prevent
  // an accidental approved → rejected flip. Operator can opt in to an
  // override (rare but real — e.g. CS reopens a refund).
  const [overrideFinal, setOverrideFinal] = useState(false);
  // Reset override + notes when the drawer switches rows so opening
  // another already-decided return doesn't inherit the previous one's
  // override flag or notes draft.
  useEffect(() => {
    setOverrideFinal(false);
    setNotes('');
    setError(null);
  }, [detail.return_id]);

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
  const actionsLocked = isFinal && !overrideFinal;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Phone: 2-up grid so short fields pair up (Return date / Order date,
          Order total / Region) — saves vertical space so the drawer fits
          without scroll. Reason spans both columns (long text).
          sm+: 1 column of full-width rows; DetailRow renders its own
          internal label/value split. */}
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <DetailRow
          label="Reason"
          value={detail.return_reason_text ?? detail.return_reason ?? '—'}
          full
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
          <div className="mb-1.5">
            This return has been <strong>{detail.status}</strong>. The action
            buttons are locked to prevent an accidental flip.
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={overrideFinal}
              onChange={(e) => setOverrideFinal(e.target.checked)}
              className="size-3.5"
            />
            <span>Override — let me decide again</span>
          </label>
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
            disabled={actionsLocked}
            variant="success"
          />
          <ActionButton
            label="Reject"
            icon={<XCircle className="size-4" />}
            onClick={() => decide('rejected')}
            pending={pending === 'rejected'}
            disabled={actionsLocked}
            variant="neutral"
          />
          <ActionButton
            label="Escalate"
            icon={<AlertTriangle className="size-4" />}
            onClick={() => decide('escalated')}
            pending={pending === 'escalated'}
            disabled={actionsLocked}
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
  full,
}: {
  label: string;
  value: React.ReactNode;
  /** When true, the row spans both columns on phone (used for long Reason text). */
  full?: boolean;
}) {
  // Layout:
  // - Phone (parent grid-cols-2): each cell = one field with label above value.
  //   `full` cells span both columns (Reason text).
  // - sm+ (parent grid-cols-1): each cell becomes a sub-grid with label
  //   taking 1/3 width and value 2/3 — the classic side-by-side layout.
  return (
    <div
      className={`flex flex-col sm:grid sm:grid-cols-3 ${
        full ? 'col-span-2 sm:col-span-1' : ''
      }`}
    >
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="sm:col-span-2">{value}</dd>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  pending,
  disabled = false,
  variant,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  disabled?: boolean;
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
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
    >
      {icon}
      {pending ? '…' : label}
    </button>
  );
}
