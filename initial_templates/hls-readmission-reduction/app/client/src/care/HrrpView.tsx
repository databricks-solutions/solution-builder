/**
 * HRRP exposure — the CMS Hospital Readmissions Reduction Program estimate per hospital × condition
 * (hrrp_performance / hrrp_penalty_estimate, Delta) and a deterministic what-if (shared/hrrp.ts):
 * book a 7-day follow-up for X% of 4 West's weekend heart-failure discharges → readmissions avoided,
 * new HF excess readmission ratio, penalty saved. No LLM in the numbers.
 */
import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { hrrpWhatIf, type HrrpWhatIfInputs } from '../../../shared/hrrp';
import { fetchHrrp, n0, pct, usd, type HrrpRow, type PenaltyRow } from './api';
import { Kpi, Pill, cn } from './ui';

export function HrrpView() {
  const [d, setD] = useState<{ performance: HrrpRow[]; penalty: PenaltyRow[]; whatIf: HrrpWhatIfInputs } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState(75);
  useEffect(() => { fetchHrrp().then(setD).catch((e) => setErr((e as Error).message)); }, []);
  const w = useMemo(() => (d ? hrrpWhatIf(d.whatIf, target / 100) : null), [d, target]);
  const lrmc = d?.penalty.find((p) => p.hospital_id === 'LRMC');
  const total = d?.penalty.reduce((a, p) => a + p.penalty_usd, 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Finance &amp; Quality · CMS Hospital Readmissions Reduction Program</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">HRRP penalty exposure</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
            Medicare FFS 65+, trailing 12 months of closed 30-day windows. Excess readmission ratio (ERR) estimated as observed vs national rate, credibility-weighted so small volumes don’t swing it. CMS risk-adjusts over 3 years, so treat this as a management estimate.
            The payment reduction is capped at 3% of Medicare base-operating DRG payments and applies to <i>every</i> Medicare discharge.
          </p>
        </div>
        {err && <div className="text-sm text-[var(--destructive)]">{err}</div>}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Estimated penalty · 3 hospitals" value={d ? usd(total) : '…'} sub="trailing 12-month ERRs" />
          <Kpi label="Larkspur Regional" value={lrmc ? usd(lrmc.penalty_usd) : '…'} tone="bad" sub={lrmc ? `heart failure line ${usd(lrmc.top_condition_usd)}` : ''} />
          <Kpi label="Larkspur Regional HF ERR" value={lrmc ? lrmc.hf_err_estimate.toFixed(2) : '…'} tone="bad" sub={lrmc ? `last 6 months ${lrmc.hf_err_last_6m.toFixed(2)} · 1.00 = national` : ''} />
          <Kpi label="Excess readmissions (12 mo)" value={d ? n0(d.penalty.reduce((a, p) => a + p.excess_readmissions, 0)) : '…'} sub="above the national rate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">What if 4 West booked the weekend follow-ups?</div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Larkspur Regional, same 12-month HRRP window. Weekend = discharged Friday to Sunday. Deterministic, with no LLM in these numbers.</p>
            {d && w && (
              <>
                <div className="mt-4 flex items-center gap-4">
                  <input type="range" min={Math.round(d.whatIf.weekend_followup_share * 100)} max={95} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" aria-label="Target follow-up share" />
                  <div className="w-44 text-right text-sm"><b className="text-2xl tabular-nums">{target}%</b> of weekend HF discharges leave with a 7-day follow-up</div>
                </div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)]">today {pct(d.whatIf.weekend_followup_share)} of {d.whatIf.weekend_discharges} weekend HF Medicare discharges on 4 West (12 months) · readmission rate {pct(d.whatIf.rate_without_followup, 1)} without vs {pct(d.whatIf.rate_with_followup, 1)} with a follow-up</div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-[var(--muted)] p-3"><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Readmissions avoided</div><div className="text-2xl font-semibold tabular-nums">{w.readmissions_avoided}<span className="text-sm font-normal"> in 12 mo</span></div></div>
                  <div className="rounded-xl bg-[var(--muted)] p-3"><div className="text-[11px] uppercase text-[var(--muted-foreground)]">HF ERR</div><div className="text-2xl font-semibold tabular-nums">{w.hf_err_now.toFixed(2)} → <span className="text-[var(--success)]">{w.hf_err_new.toFixed(2)}</span></div></div>
                  <div className="rounded-xl bg-[var(--muted)] p-3"><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Penalty saved</div><div className="text-2xl font-semibold tabular-nums text-[var(--success)]">{usd(w.penalty_saved)}</div><div className="text-[11px] text-[var(--muted-foreground)]">{usd(w.penalty_now)} → {usd(w.penalty_new)}</div></div>
                </div>
              </>
            )}
            {!d && !err && <div className="mt-3 h-40 animate-pulse rounded-xl bg-[var(--muted)]" />}
            <div className="mt-4 flex gap-2 rounded-lg bg-[var(--info-subtle)] p-3 text-xs"><Info className="size-4 shrink-0" />HRRP penalties are set from discharges two to three years earlier. A readmission avoided this quarter lowers the penalty paid in FY+2 and stays in three overlapping performance windows.</div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Estimated penalty by hospital</div>
            <div className="mt-3 space-y-3">
              {(d?.penalty ?? []).map((p) => (
                <div key={p.hospital_id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{p.hospital_name}</span>
                    <span className="text-sm tabular-nums"><b>{usd(p.penalty_usd)}</b> <span className="text-xs text-[var(--muted-foreground)]">({(p.penalty_pct * 100).toFixed(2)}% of {usd(p.medicare_base_drg_payments)})</span></span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
                    <span>top line: <b className={cn(p.top_condition === 'HF' && 'text-[var(--brand-5)]')}>{p.top_condition}</b> {usd(p.top_condition_usd)}</span>·<span>HF ERR {p.hf_err_estimate?.toFixed(2)} (last 6 mo {p.hf_err_last_6m?.toFixed(2)})</span>·
                    <span>{n0(p.excess_readmissions)} excess readmissions</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          <div className="px-5 py-3 font-semibold">Excess readmission ratio by hospital × condition</div>
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Hospital', 'Condition', 'Discharges', 'Readmit rate', 'National', 'ERR 12 mo', 'ERR last 6 mo', 'Payment share', 'Penalty line'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(d?.performance ?? []).map((r) => (
                <tr key={r.hospital_id + r.hrrp_condition} className={cn('border-t border-[var(--border)]', r.hospital_id === 'LRMC' && r.hrrp_condition === 'HF' && 'bg-[#FDF1EE]')}>
                  <td className="px-4 py-2">{r.hospital_id}</td>
                  <td className="px-4 py-2 font-medium">{r.condition_label}</td>
                  <td className="px-4 py-2 tabular-nums">{n0(r.discharges)}</td>
                  <td className="px-4 py-2 tabular-nums">{pct(r.observed_rate, 1)}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--muted-foreground)]">{pct(r.national_readmission_rate, 1)}</td>
                  <td className="px-4 py-2 tabular-nums"><Pill tone={r.err_estimate > 1.05 ? 'bad' : r.err_estimate > 1 ? 'warn' : 'good'}>{r.err_estimate.toFixed(2)}</Pill></td>
                  <td className="px-4 py-2 tabular-nums">{r.err_last_6m?.toFixed(2)}</td>
                  <td className="px-4 py-2 tabular-nums">{pct(r.payment_share, 1)}</td>
                  <td className="px-4 py-2 tabular-nums font-semibold">{r.penalty_usd > 0 ? usd(r.penalty_usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
