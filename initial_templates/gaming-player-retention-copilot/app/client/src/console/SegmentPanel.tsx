/**
 * One at-risk segment: size + SHAP drivers, driver evidence, the top at-risk players,
 * AI-labelled chat (toxicity), the plan-engine table, and the intervention workflow:
 *   open / rejected → "Ask the copilot" (agent evaluates interventions + drafts + stage_plan)
 *   plan_ready      → staged plan + player message + Schedule / Send back (write-back)
 *   scheduled       → on the live-ops calendar + audit trail
 */
import { useCallback, useEffect, useState } from 'react';
import { Skeleton, Spinner } from '@databricks/appkit-ui/react';
import { CalendarCheck, Check, MessageSquareWarning, ShieldCheck, ShieldX, Sparkles, Undo2, X } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { DRIVER_META, fetchSegment, pct, postDecision, usd, usdK, type SegmentDetail } from '@/lib/liveops';
import { DriverChip, StatusChip, TierBadge } from './chips';

const LABEL_CLS: Record<string, string> = {
  harassment: 'bg-red-600 text-white', threat: 'bg-red-800 text-white', scam: 'bg-orange-500 text-white',
  trash_talk: 'bg-slate-500/25 text-slate-200', friendly: 'bg-emerald-500/20 text-emerald-300',
};

export function SegmentPanel({ segmentId, onClose, onChanged }: { segmentId: string; onClose: () => void; onChanged: () => void }) {
  const [s, setS] = useState<SegmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [writeBack, setWriteBack] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSegment(segmentId).then((x) => { setS(x); setError(null); }).catch((e: Error) => setError(e.message));
  }, [segmentId]);
  useEffect(() => { setS(null); setWriteBack(null); load(); }, [load]);
  useEffect(() => dataMutated.subscribe(load), [load]);

  async function decide(decision: 'scheduled' | 'rejected') {
    setBusy(decision);
    try {
      const r = await postDecision(segmentId, decision);
      setWriteBack(
        decision === 'rejected' ? 'Plan sent back — ask the copilot for another option.'
        : r.deltaWriteBack === 'ok' ? 'Written back to Delta: liveops_schedule (dashboard + Genie see it)'
        : `Lakebase updated; Delta write-back failed: ${r.deltaWriteBack}`,
      );
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ask = () =>
    s && dockController.newAndSend(
      `Plan the intervention for the ${s.segmentName} segment (${s.segmentId}): pick the fix that addresses the driver within the October live-ops budget, draft the player message and stage it.`,
    );

  const FIX = ['difficulty', 'matchmaking', 'toxicity'];
  const driverRows = s
    ? Object.entries(s.drivers).filter(([, v]) => v > 1)
        .sort((a, b) => Number(FIX.includes(b[0])) - Number(FIX.includes(a[0])) || b[1] - a[1])
    : [];

  return (
    <aside data-testid="segment-panel" className="fixed bottom-0 right-0 top-0 z-40 flex w-[560px] max-w-full flex-col border-l bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b p-4">
        <div>
          {s ? (
            <>
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{s.segmentName}</h2><StatusChip status={s.status} /></div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <DriverChip driver={s.churnDriver} /> {s.segmentId} · {s.playersAtRisk.toLocaleString('en-US')} players at risk · {s.criticalPlayers} critical · {s.newPlayersAtRisk} new
              </div>
            </>
          ) : <Skeleton className="h-10 w-72 bg-muted" />}
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label="Close"><X className="size-4" /></button>
      </div>

      {error && <div className="m-3 rounded border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}

      {!s ? (
        <div className="space-y-3 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 bg-muted" />)}</div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Size + drivers */}
          <section className="rounded-lg border p-3">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">LTV at risk (12 mo)</div>
                <div className="text-3xl font-semibold text-[#C2410C]">{usd(s.atRiskLtv)}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                avg 14-day churn risk <span className="font-medium text-foreground">{pct(s.avgChurnProbability)}</span><br />
                LTV book {usdK(s.ltvBook)} · {s.payersAtRisk} payers · {s.whalesAtRisk} whales
              </div>
            </div>
            <div className="mt-3 text-xs font-medium text-muted-foreground">Why the model thinks so (avg SHAP share of the risk) · player_churn_model@champion</div>
            <div className="mt-1 space-y-1.5">
              {driverRows.map(([k, v]) => {
                const fixable = FIX.includes(k);
                return (
                  <div key={k} className={`flex items-center gap-2 text-xs ${fixable ? '' : 'text-muted-foreground'}`}>
                    <span className="w-36 shrink-0">{DRIVER_META[k]?.label ?? k}{fixable ? '' : ' · symptom'}</span>
                    <div className="h-2 flex-1 rounded bg-muted"><div className="h-2 rounded" style={{ width: `${v}%`, background: fixable ? DRIVER_META[k]?.color : '#CBD5E1' }} /></div>
                    <span className="w-10 text-right tabular-nums">{v.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Engagement, spend and profile features say <i>when</i> a player is leaving; the segment is named after its largest fixable cause (≥ 0.3 log-odds of added risk).</p>
          </section>

          {/* Evidence */}
          <section className="grid grid-cols-2 gap-2 text-xs">
            {s.evidence.map((e) => (
              <div key={e.label} className={`rounded-lg border p-2 ${e.bad ? 'border-red-500/30 bg-red-500/10' : ''}`}>
                <div className="text-muted-foreground">{e.label}</div>
                <div className={`mt-0.5 text-base font-semibold ${e.bad ? 'text-red-400' : ''}`}>{e.value}</div>
                {e.hint && <div className="text-[11px] text-muted-foreground">{e.hint}</div>}
              </div>
            ))}
          </section>

          {/* Chat sample (AI Functions) */}
          {s.chatSample.length > 0 && (
            <section className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium"><MessageSquareWarning className="size-4" />Chat received by these players · labelled by AI Functions (ai_classify)</div>
              <ul className="mt-2 space-y-1.5">
                {s.chatSample.map((c) => (
                  <li key={c.messageId} className="flex items-start gap-2 text-xs">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${LABEL_CLS[c.label] ?? 'bg-slate-100'}`}>{c.label.replace('_', ' ')}</span>
                    <span className="italic">“{c.text}”</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.channel} · {c.sentAt.slice(5, 10)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">The keyword filter flags both; only harassment, threats and scams count as a toxic encounter in the churn model.</p>
            </section>
          )}

          {/* Top players */}
          <section className="rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Top at-risk players (by LTV at risk)</div>
            <table className="w-full text-xs">
              <tbody>
                {s.topPlayers.slice(0, 5).map((p) => (
                  <tr key={p.playerId} className="border-t first:border-t-0 align-top">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{p.gamertag} <span className="text-muted-foreground">· {p.spenderTier} · {p.platform}</span></div>
                      <div className="text-[11px] text-muted-foreground">{p.reasons.slice(0, 2).join(' · ')}</div>
                    </td>
                    <td className="px-2 py-1.5"><TierBadge tier={p.riskTier} /></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pct(p.churnProbability)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{usd(p.atRiskLtv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Intervention plan */}
          <section className="rounded-lg border-2 border-primary/30 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Live-ops intervention</h3>
              <span className="text-xs text-muted-foreground">{s.budget.description}: <b className="text-foreground">{usd(s.budget.remaining)}</b> left of {usd(s.budget.budget)}</span>
            </div>

            {(s.status === 'open' || s.status === 'rejected') && (
              <>
                <p className="mt-1 text-xs text-muted-foreground">The copilot reads this segment, prices every intervention with the plan engine and drafts the player message. Nothing ships until you schedule it.</p>
                <button data-testid="ask-copilot" onClick={ask} className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                  <Sparkles className="mr-1 inline size-4" />Ask the copilot for a plan
                </button>
              </>
            )}

            {s.stagedPlan && s.status !== 'rejected' && (
              <div data-testid="staged-plan" className="mt-2 space-y-2">
                <div className="flex items-center justify-between rounded-md bg-violet-500/15 p-2">
                  <div>
                    <div className="font-semibold">{s.stagedPlan.interventionName} <span className="text-xs text-muted-foreground">({s.stagedPlan.interventionCode})</span></div>
                    <div className="text-xs text-muted-foreground">
                      +{s.stagedPlan.expectedLift} pts retention · ~{s.stagedPlan.expectedPlayersRetained.toLocaleString('en-US')} players kept · starts {s.stagedPlan.startDate}
                      {s.stagedPlan.coveredSegments.length > 1 && <> · covers {s.stagedPlan.coveredSegments.join(', ')}</>}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-semibold">{usd(s.stagedPlan.cost)}</div>
                    <div className="text-emerald-400">{usdK(s.stagedPlan.expectedLtvRetained)} LTV · {s.stagedPlan.roi}x ROI</div>
                  </div>
                </div>
                <div className="text-xs italic text-muted-foreground">{s.stagedPlan.rationale}</div>
                <div className="rounded-md border bg-background p-2 text-sm">
                  <div className="text-[11px] uppercase text-muted-foreground">In-game inbox · player message</div>
                  <p className="mt-1 whitespace-pre-wrap">{s.stagedPlan.playerMessage}</p>
                </div>
                {s.status === 'plan_ready' && (
                  <div className="flex gap-2">
                    <button data-testid="schedule-plan" disabled={!!busy} onClick={() => void decide('scheduled')} className="flex-1 rounded-lg bg-[#0E7C70] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                      {busy === 'scheduled' ? <Spinner className="inline size-4" /> : <CalendarCheck className="mr-1 inline size-4" />}Schedule for {s.stagedPlan.startDate}
                    </button>
                    <button disabled={!!busy} onClick={() => void decide('rejected')} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                      {busy === 'rejected' ? <Spinner className="inline size-4" /> : <Undo2 className="mr-1 inline size-4" />}Send back
                    </button>
                  </div>
                )}
                {s.status === 'scheduled' && (
                  <div data-testid="scheduled-banner" className="rounded-md bg-emerald-500/15 p-2 text-sm text-emerald-200">
                    <Check className="mr-1 inline size-4" />On the live-ops calendar for {s.stagedPlan.startDate} — {usd(s.stagedPlan.cost)} committed.{' '}
                    <span className="text-xs">({s.scheduledBy}, {s.scheduledAt?.slice(0, 16).replace('T', ' ')})</span>
                  </div>
                )}
              </div>
            )}
            {writeBack && <div className="mt-1 text-[11px] text-muted-foreground">{writeBack}</div>}

            <div className="mt-3 text-xs font-medium text-muted-foreground">Plan engine — every intervention for this segment</div>
            <table className="mt-1 w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr><th className="py-1 text-left">Intervention</th><th className="pl-2 text-right">Cost</th><th className="pl-2 text-right">Lift</th><th className="pl-3 text-right">LTV kept</th><th className="pl-3 text-right">ROI</th><th /></tr>
              </thead>
              <tbody>
                {s.interventions.map((o) => (
                  <tr key={o.intervention_code} className={`border-t ${o.matches_driver ? '' : 'opacity-50'}`} title={`${o.description}\n${o.reason}`}>
                    <td className="py-1">{o.allowed ? <ShieldCheck className="inline size-3.5 text-emerald-400" /> : <ShieldX className="inline size-3.5 text-red-500" />} {o.intervention_name}</td>
                    <td className="py-1 pl-2 text-right tabular-nums">{usdK(o.cost)}</td>
                    <td className="py-1 pl-2 text-right tabular-nums">+{o.expected_lift_pp}</td>
                    <td className="py-1 pl-3 text-right tabular-nums">{usdK(o.expected_ltv_retained)}</td>
                    <td className="py-1 pl-3 text-right tabular-nums">{o.roi.toFixed(1)}x</td>
                    <td className="py-1 pl-2 text-[10px] text-muted-foreground">{!o.matches_driver ? 'other driver' : !o.within_budget ? 'over budget' : o.roi < 1 ? 'ROI < 1' : o.scope === 'global' ? 'global' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Audit */}
          <section>
            <div className="text-xs font-medium text-muted-foreground">Audit trail</div>
            <ol className="mt-1 space-y-1 border-l pl-3 text-xs">
              {s.auditTrail.map((a, i) => (
                <li key={i}><span className="font-medium">{a.action.replace('_', ' ')}</span> · {a.by} · <span className="text-muted-foreground">{a.at.slice(0, 16).replace('T', ' ')}</span><div className="text-muted-foreground">{a.notes}</div></li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
  );
}
