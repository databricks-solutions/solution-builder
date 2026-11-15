import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, X, Zap } from 'lucide-react';
import { fetchAutoApprovable, releaseAutoApprovals } from '@/lib/pa';
import { dataMutated } from '@/lib/events';
import type { CaseRow } from '@/shared/types';

/** Confirm + release the auto-approval lane (MV-UM-000 rule, approve-only). */
export function AutoApproveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setDone(null);
    setError(null);
    fetchAutoApprovable().then(setRows).catch((e: Error) => setError(e.message));
  }, [open]);

  if (!open) return null;
  const byPolicy = Object.entries(
    (rows ?? []).reduce<Record<string, number>>((m, r) => ((m[r.policyTitle ?? r.policyId] = (m[r.policyTitle ?? r.policyId] ?? 0) + 1), m), {}),
  ).sort((a, b) => b[1] - a[1]);
  const exp = (rows ?? []).filter((r) => r.urgency === 'Expedited').length;

  async function release() {
    setBusy(true);
    try {
      const r = await releaseAutoApprovals();
      setDone(r.approved);
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-xl border" onClick={(e) => e.stopPropagation()} data-testid="auto-approve-dialog">
        <div className="flex items-start justify-between p-5 border-b">
          <div className="flex gap-3">
            <div className="size-10 rounded-lg bg-[var(--success-subtle)] flex items-center justify-center">
              <Zap className="size-5 text-[var(--success)]" />
            </div>
            <div>
              <div className="font-semibold text-lg">Release the auto-approval lane</div>
              <div className="text-sm text-muted-foreground">Rule MV-UM-000 · approve-only · every decision audited</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-destructive">{error}</div>}
          {done !== null ? (
            <div className="flex flex-col items-center text-center gap-2 py-6">
              <CheckCircle2 className="size-12 text-[var(--success)]" />
              <div className="text-2xl font-semibold">{done} requests approved</div>
              <div className="text-sm text-muted-foreground max-w-sm">
                Decisions written to Lakebase (audit trail) and appended to Delta <code>um_decisions</code> — the ops dashboard and Genie see them next refresh.
              </div>
            </div>
          ) : rows === null ? (
            <div className="text-sm text-muted-foreground">Checking the queue…</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Cases" value={rows.length} />
                <Stat label="Expedited" value={exp} />
                <Stat label="Est. value" value={`$${Math.round(rows.reduce((s, r) => s + (r.estCostUsd ?? 0), 0) / 1000)}k`} />
              </div>
              <div className="rounded-lg bg-muted/60 p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-[var(--primary)]" /> Every case passed all four checks</div>
                <ul className="text-muted-foreground list-disc pl-6 space-y-0.5">
                  <li>Policy is marked auto-approval eligible</li>
                  <li>AI marked <b>every</b> criterion Met, each with a quoted piece of evidence</li>
                  <li>Recommendation APPROVE with confidence ≥ 0.85</li>
                  <li>Automation never denies or pends — everything else stays with a nurse</li>
                </ul>
              </div>
              <div className="max-h-40 overflow-y-auto text-sm divide-y border rounded-lg">
                {byPolicy.map(([p, n]) => (
                  <div key={p} className="flex justify-between px-3 py-1.5">
                    <span>{p}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-muted">{done !== null ? 'Close' : 'Cancel'}</button>
          {done === null && (
            <button
              disabled={busy || !rows || rows.length === 0}
              onClick={release}
              className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--success)] text-white disabled:opacity-50"
              data-testid="confirm-release"
            >
              {busy ? 'Releasing…' : `Approve ${rows?.length ?? ''} requests`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
