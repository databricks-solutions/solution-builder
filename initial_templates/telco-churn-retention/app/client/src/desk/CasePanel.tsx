/**
 * The agent's workspace for one caller — two columns, rendered inline beside the queue:
 *   Subscriber 360 (left)  — risk ring, SHAP drivers, the account's signals, the last care call (AI Functions)
 *   Offer desk (right)     — next-best offer workflow: open → "Ask the copilot" (agent evaluates the guardrail,
 *                             drafts the outreach, stages it) → offer_ready → Accept / Decline (write-back to Delta)
 */
import { useCallback, useEffect, useState } from 'react';
import { Skeleton, Spinner } from '@databricks/appkit-ui/react';
import { Check, ChevronDown, ChevronUp, MessageSquareQuote, ShieldCheck, ShieldX, Sparkles, X } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { DRIVER_META, fetchCase, orderedReasons, pct, postDecision, usd, type CaseDetail } from '@/lib/desk';
import { DriverChip, StatusChip, TierBadge } from './chips';

const SENTIMENT: Record<string, string> = {
  negative: 'bg-[#FDE2E4] text-[#9B1C2E]', mixed: 'bg-[#FFF3D6] text-[#7A5300]',
  neutral: 'bg-[#F1E7EE] text-[#5E4A59]', positive: 'bg-[#DDF4EA] text-[#0E6B48]',
};

export function CasePanel({ customerId, onChanged }: { customerId: string; onChanged: () => void }) {
  const [c, setC] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [writeBack, setWriteBack] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchCase(customerId).then((x) => { setC(x); setError(null); }).catch((e: Error) => setError(e.message));
  }, [customerId]);
  useEffect(() => { setC(null); setWriteBack(null); setShowTx(false); load(); }, [load]);
  useEffect(() => dataMutated.subscribe(load), [load]);

  async function decide(decision: 'accepted' | 'declined') {
    setBusy(decision);
    try {
      const r = await postDecision(customerId, decision);
      setWriteBack(r.deltaWriteBack === 'ok' ? 'Written back to Delta: retention_decisions' : `Lakebase updated; Delta write-back failed: ${r.deltaWriteBack}`);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ask = () =>
    c && dockController.newAndSend(`Recommend the next-best offer for ${c.customerName} (${c.customerId}) and draft the outreach — stay within the margin guardrail.`);

  if (error && !c) return <div className="m-3 rounded-2xl border border-[#F5B5C0] bg-[#FFF1F3] p-4 text-sm text-[#9B1C2E]">{error}</div>;
  if (!c) {
    return (
      <div className="grid min-w-0 flex-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[520px] rounded-2xl bg-muted" />
        <Skeleton className="h-[520px] rounded-2xl bg-muted" />
      </div>
    );
  }

  const driverRows = Object.entries(c.drivers).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const s = c.signals ?? {};
  const initials = c.customerName.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const dash = 2 * Math.PI * 44;
  const risk = Math.min(1, c.churnProbability * 2.5);

  return (
    <div data-testid="case-panel" className="grid min-w-0 flex-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── Subscriber 360 ─────────────────────────────────────────── */}
      <div className="min-w-0 space-y-4">
        <section className="rounded-3xl bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-[#C8106B] to-[#F25BA8] font-display text-lg font-extrabold text-white">{initials}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-extrabold">{c.customerName}</h2>
                <TierBadge tier={c.riskTier} />
                <StatusChip status={c.status} />
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {c.customerId} · {c.market} ({c.region}) · {c.segment} · {c.plan} · {c.lines} lines · {c.tenureMonths} mo tenure · {c.contractType}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly bill</div>
              <div className="font-display text-xl font-extrabold tabular-nums">{usd(c.monthlyBill)}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-[180px_1fr]">
            {/* Risk ring */}
            <div className="flex flex-col items-center justify-center">
              <svg viewBox="0 0 110 110" className="size-40">
                <circle cx="55" cy="55" r="44" fill="none" stroke="#F7EEF4" strokeWidth="11" />
                <circle cx="55" cy="55" r="44" fill="none" stroke="#C8106B" strokeWidth="11" strokeLinecap="round"
                  strokeDasharray={`${dash * risk} ${dash}`} transform="rotate(-90 55 55)" />
                <text x="55" y="58" textAnchor="middle" fontSize="20" fontWeight="800" fill="#2B1A27" fontFamily="Nunito">{pct(c.churnProbability, 1)}</text>
                <text x="55" y="75" textAnchor="middle" fontSize="8.5" fill="#7A6373" fontFamily="Figtree">30-day churn</text>
              </svg>
              <div className="text-center text-xs text-muted-foreground">
                <span className="font-display text-base font-extrabold text-[#C8106B]">{usd(c.annualRevenueAtRisk)}</span> revenue at risk
              </div>
            </div>

            {/* SHAP drivers */}
            <div>
              <div className="text-sm font-bold">Why they might leave</div>
              <div className="text-xs text-muted-foreground">SHAP share of the risk · churn_risk_model@champion</div>
              <div className="mt-3 space-y-2.5">
                {driverRows.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 font-medium">{DRIVER_META[k]?.label ?? k}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-2.5 rounded-full" style={{ width: `${v}%`, background: DRIVER_META[k]?.color }} />
                    </div>
                    <span className="w-10 text-right font-semibold tabular-nums">{v.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <ul className="mt-3 space-y-1 text-xs text-[#5E4A59]">
                {orderedReasons(c.reasons, c.topDriver).map((r) => <li key={r} className="flex gap-1.5"><span className="text-[#C8106B]">●</span>{r}</li>)}
              </ul>
            </div>
          </div>
        </section>

        {/* Signals */}
        <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {[
            ['Dropped calls', `${s.dropped_call_rate_3m ?? '—'}%`, (s.dropped_call_rate_3m ?? 0) > 2],
            ['5G download', `${s.download_mbps_3m ?? '—'} Mbps`, (s.download_mbps_3m ?? 999) < 100],
            ['Bill change, 3 mo', `${(s.bill_change_3m_pct ?? 0) > 0 ? '+' : ''}${s.bill_change_3m_pct ?? 0}%`, (s.bill_change_3m_pct ?? 0) > 15],
            ['Port-out PIN (30 d)', s.port_out_pin_30d ? 'Requested' : 'None', Boolean(s.port_out_pin_30d)],
            ['Crest promo nearby', s.competitor_promo_in_market ? 'Yes' : 'No', Boolean(s.competitor_promo_in_market)],
            ['Care calls (90 d)', String(s.care_calls_90d ?? 0), (s.care_calls_90d ?? 0) >= 2],
          ].map(([label, value, bad]) => (
            <div key={String(label)} className={`rounded-2xl p-3.5 ${bad ? 'bg-[#FFF1F3] ring-1 ring-[#F5B5C0]' : 'bg-card shadow-sm'}`}>
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              <div className={`mt-0.5 font-display text-lg font-extrabold ${bad ? 'text-[#A10B57]' : ''}`}>{value}</div>
            </div>
          ))}
        </section>

        {/* Last care call */}
        {c.lastCall && (
          <section className="rounded-3xl bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold"><MessageSquareQuote className="size-4 text-[#C8106B]" />Last care call · {c.lastCall.callTs.slice(0, 10)}</div>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SENTIMENT[c.lastCall.sentiment] ?? SENTIMENT.neutral}`}>{c.lastCall.sentiment}</span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">{c.lastCall.intent.replace(/_/g, ' ')}</span>
                {c.lastCall.cancelThreat && <span className="rounded-full bg-[#D7263D] px-2.5 py-0.5 text-xs font-semibold text-white">cancel threat</span>}
              </div>
            </div>
            <p className="mt-2 text-sm leading-relaxed">{c.lastCall.summary}</p>
            {c.lastCall.requestedRemedy && <p className="mt-1 text-xs text-muted-foreground">Asked for: <i>{c.lastCall.requestedRemedy}</i></p>}
            <button className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#C8106B]" onClick={() => setShowTx(!showTx)}>
              {showTx ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}{showTx ? 'Hide' : 'Show'} transcript
            </button>
            {showTx && <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-muted p-3 text-[11px] leading-relaxed">{c.lastCall.transcript}</pre>}
          </section>
        )}

        {/* Audit */}
        {c.auditTrail.length > 0 && (
          <section className="rounded-3xl bg-card p-5 shadow-sm">
            <div className="text-sm font-bold">Audit trail</div>
            <ol className="mt-2 space-y-1.5 border-l-2 border-[#F0DCE7] pl-3 text-xs">
              {c.auditTrail.map((a, i) => (
                <li key={i}><span className="font-semibold">{a.action.replace('_', ' ')}</span> · {a.by} · <span className="text-muted-foreground">{a.at.slice(0, 16).replace('T', ' ')}</span>{a.notes && <div className="text-muted-foreground">{a.notes}</div>}</li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {/* ── Offer desk ─────────────────────────────────────────────── */}
      <aside className="min-w-0 space-y-4">
        <section className="rounded-3xl border-2 border-[#C8106B]/25 bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-extrabold">Next-best offer</h3>
            <DriverChip driver={c.topDriver} />
          </div>

          {c.status === 'open' && (
            <>
              <p className="mt-1.5 text-xs text-muted-foreground">The copilot reads this caller, runs the margin guardrail over the catalog and drafts the outreach. Nothing is sent until the customer answers.</p>
              <button data-testid="ask-copilot" onClick={ask} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-[#C8106B] px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-[#A10B57]">
                <Sparkles className="size-4" />Ask the copilot for the next-best offer
              </button>
            </>
          )}

          {c.stagedOffer && (
            <div data-testid="staged-offer" className="mt-3 space-y-3">
              <div className="rounded-2xl bg-gradient-to-br from-[#C8106B] to-[#E0457F] p-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Staged offer</div>
                <div className="font-display text-xl font-extrabold">{c.stagedOffer.offerName}</div>
                <div className="text-xs opacity-80">{c.stagedOffer.offerCode}</div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="font-display text-3xl font-extrabold">{pct(c.stagedOffer.expectedSaveRate)}</div>
                    <div className="text-xs opacity-90">predicted save rate for {DRIVER_META[c.topDriver]?.label.toLowerCase()} churners</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-display text-lg font-bold">{usd(c.stagedOffer.cost)}</div>
                    <div className="flex items-center justify-end gap-1 opacity-90"><ShieldCheck className="size-3.5" />within {usd(c.stagedOffer.guardrailCap)} cap</div>
                  </div>
                </div>
              </div>
              <div className="text-xs italic text-muted-foreground">{c.stagedOffer.rationale}</div>
              <div className="rounded-2xl border border-[#EBDDE6] bg-background p-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.stagedOffer.channel} · {c.stagedOffer.subject}</div>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{c.stagedOffer.message}</p>
              </div>
              {c.status === 'offer_ready' && (
                <div className="flex gap-2">
                  <button data-testid="accept-offer" disabled={!!busy} onClick={() => void decide('accepted')} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#13835B] px-3 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                    {busy === 'accepted' ? <Spinner className="size-4" /> : <Check className="size-4" />}Customer accepted
                  </button>
                  <button disabled={!!busy} onClick={() => void decide('declined')} className="flex flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-[#EBDDE6] px-3 py-2.5 text-sm font-bold hover:bg-muted disabled:opacity-50">
                    {busy === 'declined' ? <Spinner className="size-4" /> : <X className="size-4" />}Declined
                  </button>
                </div>
              )}
              {(c.status === 'accepted' || c.status === 'declined') && (
                <div className={`rounded-2xl p-3 text-sm ${c.status === 'accepted' ? 'bg-[#DDF4EA] text-[#0E6B48]' : 'bg-muted'}`}>
                  {c.status === 'accepted' ? `Saved: ${usd(c.monthlyBill * 12)} annual revenue retained.` : 'Customer declined the offer.'}{' '}
                  <span className="text-xs opacity-80">({c.decidedBy}, {c.decidedAt?.slice(0, 16).replace('T', ' ')})</span>
                </div>
              )}
              {writeBack && <div className="text-[11px] text-muted-foreground">{writeBack}</div>}
            </div>
          )}
        </section>

        {/* Guardrail: every offer for this account, as cards */}
        <section className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-1">
          <div className="px-1 text-sm font-bold md:col-span-2 2xl:col-span-1">Every offer for this account <span className="font-normal text-muted-foreground">· margin guardrail</span></div>
          {c.offers.map((o) => {
            const blocked = !o.allowed;
            return (
              <div key={o.offer_code} title={o.eligibility_reason}
                className={`flex items-center gap-3 rounded-2xl border bg-card p-3 ${blocked ? 'border-[#EBDDE6] opacity-70' : 'border-[#C8106B]/20'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-bold">
                    {o.allowed ? <ShieldCheck className="size-4 shrink-0 text-[#13835B]" /> : <ShieldX className="size-4 shrink-0 text-[#D7263D]" />}
                    <span className="truncate">{o.offer_name}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {usd(o.cost)} · cap {usd(o.guardrail_cap)}{!o.eligible ? ' · not eligible' : !o.within_guardrail ? ' · over cap' : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-extrabold tabular-nums text-[#C8106B]">{pct(o.expected_save_rate)}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">save rate</div>
                </div>
              </div>
            );
          })}
        </section>
      </aside>
    </div>
  );
}
