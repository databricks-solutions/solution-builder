/**
 * CUO referrals — Marcus Oyelaran's queue. Reviews above the $25M senior underwriter authority or with an
 * appetite referral wait here; Approve & issue marks the decision issued (Lakebase) and writes it back to Delta
 * (uw_decisions) for the portfolio dashboard and Genie.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, Loader2, ShieldCheck, Undo2 } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { DECISION_LABEL, approveReferral, fetchReferrals, money, musd, sendBackReferral, type ReferralRow } from './api';
import { BandPill, StatusPill } from './ui';

function Row({ r, onDone }: { r: ReferralRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'back' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const p = r.pricing;
  async function act(kind: 'approve' | 'back') {
    setBusy(kind);
    try {
      if (kind === 'approve') {
        const out = await approveReferral(r.id, note || undefined);
        setMsg(`Issued — Delta write-back: ${out.deltaWriteBack ?? 'ok'}`);
      } else {
        await sendBackReferral(r.id, note || undefined);
        setMsg('Sent back to the underwriter.');
      }
      dataMutated.emit();
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/submissions/${r.id}`} className="font-display text-xl font-semibold text-[var(--primary)] hover:underline">{r.insured_name}</Link>
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">{r.id} · {r.broker_name} · {r.segment}, {r.state}<StatusPill status={r.status} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5 text-sm">
        {[
          ['Recommendation', DECISION_LABEL[r.review_decision], r.excluded_locations?.length ? `Loc ${r.excluded_locations.join(', ')} excluded` : 'all locations'],
          ['Premium', money(p?.total_premium), `${money(p?.property_premium)} property + ${money(p?.gl_premium)} GL`],
          ['TIV quoted', musd(p?.tiv_quoted), `of ${musd(p?.tiv_submitted)} submitted`],
          ['Broker target', p?.target_premium ? money(p.target_premium) : '—', p?.target_premium ? `${Math.round((100 * (p.total_premium - p.target_premium)) / p.target_premium)}% vs target` : ''],
        ].map(([l, v, s]) => (
          <div key={String(l)} className="rounded-xl bg-[var(--muted)]/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{l}</div>
            <div className="text-lg font-semibold tabular-nums">{v}</div>
            <div className="text-[11px] text-[var(--muted-foreground)]">{s}</div>
          </div>
        ))}
        <div className="rounded-xl bg-[var(--muted)]/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Risk model</div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs"><BandPill band={r.band_as_submitted} p={r.p_as_submitted} />→<BandPill band={r.band_verified} p={r.p_verified} /></div>
          <div className="text-[11px] text-[var(--muted-foreground)]">as submitted → verified</div>
        </div>
      </div>
      {r.referral_reasons?.length > 0 && <div className="text-sm"><b>Why it needs you:</b> {r.referral_reasons.join(' ')}</div>}
      {r.rationale && <div className="text-sm leading-relaxed text-[var(--muted-foreground)]">{r.rationale}</div>}
      <div className="text-xs text-[var(--muted-foreground)]">Drafted by {r.drafted_by} · {new Date(r.review_updated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      {r.status === 'referred' ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the file (optional)"
            className="min-w-[260px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
          <button disabled={!!busy} onClick={() => act('approve')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Approve &amp; issue
          </button>
          <button disabled={!!busy} onClick={() => act('back')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
            <Undo2 className="size-4" />Send back
          </button>
        </div>
      ) : (
        <div className="text-sm text-[var(--success)]"><Check className="mr-1 inline size-4" />{DECISION_LABEL[r.decision ?? r.review_decision]} issued by {r.decided_by}{r.decided_at ? ` at ${new Date(r.decided_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{r.cuo_note ? ` — “${r.cuo_note}”` : ''}</div>
      )}
      {msg && <div className="text-sm text-[var(--muted-foreground)]">{msg}</div>}
    </div>
  );
}

export function ReferralsView() {
  const [rows, setRows] = useState<ReferralRow[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchReferrals().then(setRows).catch(() => setRows([])); }, [tick]);
  const waiting = rows?.filter((r) => r.status === 'referred') ?? [];
  const done = rows?.filter((r) => r.status === 'decided') ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Chief Underwriting Officer · Marcus Oyelaran</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">CUO referrals</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Accounts above the $25M senior underwriter authority, or needing an appetite exception (TSI-AUTH-02), wait here with the full recommendation. Approving issues the decision and writes it back to Delta.</p>
        </div>
        {!rows && <div className="h-40 animate-pulse rounded-2xl bg-[var(--muted)]" />}
        {rows && waiting.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
            <ShieldCheck className="mx-auto mb-2 size-6" />Nothing waiting. Reviews referred from a submission workbench appear here.
          </div>
        )}
        {waiting.map((r) => <Row key={r.id} r={r} onDone={() => setTick((t) => t + 1)} />)}
        {done.length > 0 && <div className="pt-2 text-sm font-semibold text-[var(--muted-foreground)]">Decisions issued</div>}
        {done.map((r) => <Row key={r.id} r={r} onDone={() => setTick((t) => t + 1)} />)}
      </div>
    </div>
  );
}
