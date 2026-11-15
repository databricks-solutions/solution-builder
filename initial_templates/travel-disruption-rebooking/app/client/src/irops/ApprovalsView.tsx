/**
 * Approvals — the IROPS Duty Manager's queue (Tom Brennan). Plans over the partner-spend auto-approve limit
 * (or with a policy exception) wait here; Approve & commit tickets the rebookings (Lakebase) and writes them
 * back to Delta (rebooking_plans + rebooking_decisions) for the dashboard and Genie.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, Loader2, ShieldCheck, Undo2 } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { approvePlan, fetchApprovals, money, pct, sendBackPlan, type ApprovalRow } from './api';
import { FlightStatusPill, Pill } from './ui';

function Row({ r, onDone }: { r: ApprovalRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'back' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const m = r.metrics, ap = r.autoprotect;
  async function act(kind: 'approve' | 'back') {
    setBusy(kind);
    try {
      if (kind === 'approve') {
        const out = await approvePlan(r.id, note || undefined);
        setMsg(`Committed — Delta write-back: ${out.deltaWriteBack ?? 'ok'}`);
      } else {
        await sendBackPlan(r.id, note || undefined);
        setMsg('Sent back to the desk.');
      }
      dataMutated.emit();
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const delta = ap.total_cost - m.total_cost;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/flights/${r.id}`} className="font-display text-xl font-semibold text-[var(--primary)] hover:underline">{r.flight_number} → {r.destination_city ?? r.destination}</Link>
        <div className="flex items-center gap-2">{r.eu_uk_261 && <Pill tone="info">{r.eu_uk_261}</Pill>}<FlightStatusPill status={r.status} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6 text-sm">
        {[
          ['Home today', `${m.same_day} / ${m.pax}`, `AutoProtect ${ap.same_day}`],
          ['Priority today', `${m.priority_same_day} / ${m.priority_pax}`, `AutoProtect ${ap.priority_same_day}`],
          ['Misconnects', m.misconnects, `AutoProtect ${ap.misconnects}`],
          ['Partner spend', money(m.partner_spend), `${m.partner_seats} Lumen Air seats`],
          ['Total cost', money(m.total_cost), `${delta >= 0 ? money(delta) + ' less' : money(-delta) + ' more'} than AutoProtect`],
          ['Pred. detractors', pct(m.predicted_detractor_rate), `AutoProtect ${pct(ap.predicted_detractor_rate)}`],
        ].map(([l, v, s]) => (
          <div key={String(l)} className="rounded-xl bg-[var(--muted)]/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{l}</div>
            <div className="text-lg font-semibold tabular-nums">{v}</div>
            <div className="text-[11px] text-[var(--muted-foreground)]">{s}</div>
          </div>
        ))}
      </div>
      {r.approval_reasons?.length > 0 && <div className="text-sm"><b>Why it needs you:</b> {r.approval_reasons.join(' ')}</div>}
      {r.summary && <div className="text-sm leading-relaxed text-[var(--muted-foreground)]">{r.summary}</div>}
      <div className="text-xs text-[var(--muted-foreground)]">Drafted by {r.drafted_by} · {new Date(r.plan_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      {r.status === 'awaiting_approval' ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit trail (optional)"
            className="min-w-[260px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
          <button disabled={!!busy} onClick={() => act('approve')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
            {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Approve &amp; commit
          </button>
          <button disabled={!!busy} onClick={() => act('back')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
            <Undo2 className="size-4" />Send back
          </button>
        </div>
      ) : (
        <div className="text-sm text-[var(--success)]"><Check className="mr-1 inline size-4" />Committed by {r.approved_by}{r.committed_at ? ` at ${new Date(r.committed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{r.approval_note ? ` — “${r.approval_note}”` : ''}</div>
      )}
      {msg && <div className="text-sm text-[var(--muted-foreground)]">{msg}</div>}
    </div>
  );
}

export function ApprovalsView() {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchApprovals().then(setRows).catch(() => setRows([])); }, [tick]);
  const waiting = rows?.filter((r) => r.status === 'awaiting_approval') ?? [];
  const done = rows?.filter((r) => r.status === 'committed') ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">IROPS Duty Manager · Tom Brennan</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Approvals</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Plans that spend more than $6,000 on partner seats for one flight, or carry a policy exception, need your sign-off before anything is ticketed.</p>
        </div>
        {!rows && <div className="h-40 animate-pulse rounded-2xl bg-[var(--muted)]" />}
        {rows && waiting.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
            <ShieldCheck className="mx-auto mb-2 size-6" />Nothing waiting. Plans submitted from a flight workbench appear here.
          </div>
        )}
        {waiting.map((r) => <Row key={r.id} r={r} onDone={() => setTick((t) => t + 1)} />)}
        {done.length > 0 && <div className="pt-2 text-sm font-semibold text-[var(--muted-foreground)]">Committed today</div>}
        {done.map((r) => <Row key={r.id} r={r} onDone={() => setTick((t) => t + 1)} />)}
      </div>
    </div>
  );
}
