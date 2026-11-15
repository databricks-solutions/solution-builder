/**
 * Submission queue — today's 24 broker submissions, triaged at intake: every PDF read with ai_parse_document,
 * the application compared with the SOV and loss runs, appetite / authority rules applied, ML risk scored twice.
 * Highest priority first.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileWarning } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchQueue, money, musd, shortDate, type QueueRow } from './api';
import { BandPill, LanePill, Pill, StatusPill, TierBadge, cn } from './ui';

export function QueueView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lane, setLane] = useState<string>('all');
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchQueue().then(setRows).catch((e) => setErr((e as Error).message)); }, [tick]);
  const lanes = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.triage_lane, (m.get(r.triage_lane) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = (rows ?? []).filter((r) => lane === 'all' || r.triage_lane === lane);
  const tiv = rows?.reduce((a, r) => a + Number(r.sov_tiv), 0) ?? 0;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Middle-market property &amp; package · Dana Whitfield · Mon 28 Sep 2026</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Submission queue</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {rows?.length ?? '…'} broker submissions, {musd(tiv)} of TIV. Every application, statement of values and loss run was read with
            ai_parse_document; the lane comes from comparing them against the appetite rules. Sorted by priority (premium potential,
            broker, effective date, open questions).
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button onClick={() => setLane('all')} className={cn('rounded-full border px-2.5 py-1', lane === 'all' ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--card)]')}>All {rows?.length ?? ''}</button>
          {lanes.map(([l, n]) => (
            <button key={l} onClick={() => setLane(l)} className={cn('rounded-full border px-2.5 py-1', lane === l ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--card)]')}>{l.replace(' - ', ' · ')} {n}</button>
          ))}
        </div>
        {err && <div className="text-sm text-[var(--destructive)]">{err}</div>}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Priority', 'Insured', 'Broker', 'Segment', 'TIV (SOV)', 'Effective', 'Documents', 'Risk as submitted', 'Risk verified', 'Triage lane', 'Desk'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!rows && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={11} className="px-3 py-2"><div className="h-5 animate-pulse rounded bg-[var(--muted)]" /></td></tr>)}
              {shown.map((r) => (
                <tr key={r.id} onClick={() => nav(`/submissions/${r.id}`)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/50">
                  <td className="px-3 py-2"><span className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--info-subtle)] text-xs font-semibold tabular-nums text-[var(--primary)]">{Math.round(r.priority_score)}</span></td>
                  <td className="px-3 py-2">
                    <div className="font-semibold whitespace-nowrap">{r.insured_name}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{r.id} · {r.sov_locations} location{r.sov_locations === 1 ? '' : 's'} · {r.state}</div>
                  </td>
                  <td className="px-3 py-2 text-xs"><div>{r.broker_name}</div><TierBadge tier={r.broker_tier} /></td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{r.segment}{r.hail_belt && <div className="text-[10px] text-[var(--muted-foreground)]">hail belt</div>}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{musd(r.sov_tiv)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums">{shortDate(r.effective_date)}<div className="text-[10px] text-[var(--muted-foreground)]">{r.days_to_effective} days</div></td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {r.discrepancy_count > 0
                      ? <span className="inline-flex items-center gap-1 font-semibold text-[var(--brand-5)]"><FileWarning className="size-3.5" />{r.discrepancy_count} disagree</span>
                      : <span className="text-[var(--muted-foreground)]">consistent</span>}
                    <div className="text-[10px] text-[var(--muted-foreground)]">{r.loss_run_claims} loss{r.loss_run_claims === 1 ? '' : 'es'} · {money(r.loss_run_incurred)}</div>
                  </td>
                  <td className="px-3 py-2"><BandPill band={r.band_as_submitted} p={r.p_as_submitted} /></td>
                  <td className="px-3 py-2"><BandPill band={r.band_verified} p={r.p_verified} /></td>
                  <td className="px-3 py-2"><LanePill lane={r.triage_lane} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusPill status={r.status} />
                    {r.review_premium != null && r.status !== 'new' && <div className="text-[11px] text-[var(--muted-foreground)]">{r.review_decision === 'DECLINE' ? 'decline' : money(r.review_premium)}{r.referral_required ? ' · CUO' : ''}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && <div className="flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]"><Pill>Risk = submission_risk_model@champion, P(loss ratio &gt; 100%)</Pill><Pill>Low &lt; 0.25 · Moderate &lt; 0.45 · High</Pill></div>}
      </div>
    </div>
  );
}
