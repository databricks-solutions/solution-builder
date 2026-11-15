import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, History, RotateCcw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { dockController } from '@/chat/dockController';
import { dataMutated } from '@/lib/events';
import {
  fetchPlanEvent, flagTone, moneyK, pct, replanEvent, revertPlanEvent, signedK, unitsK, weekLabel,
  type PlanEventDetail,
} from '@/lib/promo';
import { Drawer, Pill, cn } from '@/lib/ui';
import { LiftWaterfall } from './LiftWaterfall';

export function PlanDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const nav = useNavigate();
  const [ev, setEv] = useState<PlanEventDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    if (!id) { setEv(null); return; }
    fetchPlanEvent(id).then(setEv).catch((e: Error) => setErr(e.message));
  }, [id, tick]);

  async function apply(key: string) {
    if (!ev) return;
    setBusy(key); setErr(null);
    try {
      await replanEvent(ev.id, key, 'Re-planned from the promo calendar (planner UI)');
      dataMutated.emit();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function revert() {
    if (!ev) return;
    setBusy('revert'); setErr(null);
    try { await revertPlanEvent(ev.id); dataMutated.emit(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const cur = ev?.scenarios.find((s) => s.scenarioKey === ev.scenarioKey);
  return (
    <Drawer open={!!id} onClose={onClose}
      title={ev ? <>{ev.id} · {ev.retailerName} · {ev.productName}</> : 'Loading…'}
      subtitle={ev ? <>Week of {weekLabel(ev.startWeek)} ({ev.weeks} {ev.weeks > 1 ? 'weeks' : 'week'}) · planner note: “{ev.plannerNote}”</> : null}>
      {err && <div className="rounded-lg bg-[#FBE3E1] px-3 py-2 text-sm text-[#9B2A22]">{err}</div>}
      {!ev ? <div className="h-40 animate-pulse rounded-xl bg-[var(--muted)]" /> : (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--muted-foreground)]">Current plan</span>
              <span className="font-semibold">{cur?.label.replace(/^As planned: /, '') ?? ev.tactic}</span>
              <Pill tone={flagTone(ev.forecastFlag)}>{ev.forecastFlag}</Pill>
              {ev.status !== 'draft' && <Pill tone="good"><CheckCircle2 className="size-3" />Re-planned ({ev.decisionId})</Pill>}
            </div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]">
              {ev.fundingMethod} settlement · promo price ${ev.promoPrice?.toFixed(2)} (regular ${ev.regularShelfPrice?.toFixed(2)})
              {ev.featureAd ? ' · circular feature' : ''}{ev.inStoreDisplay ? ' · endcap display' : ''}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                ['ML baseline', unitsK(ev.baselineUnits), 'units w/o promo'],
                ['Forecast', unitsK(ev.forecastUnits), 'units in event'],
                ['Volume kept', unitsK(ev.volumeKept), 'after the dip'],
                ['Trade spend', moneyK(ev.tradeSpend), 'allowance + fees'],
                ['Net profit', moneyK(ev.netProfit), 'after trade spend'],
                ['ROI', pct(ev.roi), 'TPG-2027 §3.1'],
              ].map(([l, v, s]) => (
                <div key={l} className="rounded-lg bg-[var(--muted)] px-3 py-2">
                  <div className="text-[10px] uppercase text-[var(--muted-foreground)]">{l}</div>
                  <div className={cn('text-lg font-semibold tabular-nums', (l === 'Net profit' || l === 'ROI') && (ev.netProfit ?? 0) < 0 && 'text-[var(--brand-5)]')}>{v}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">{s}</div>
                </div>
              ))}
            </div>
            {cur && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium">Lift vs ML baseline, in units</div>
                <LiftWaterfall baseline={cur.baselineUnits ?? 0} gross={cur.grossIncrementalUnits ?? 0} dip={cur.dipUnits ?? 0} cannib={cur.cannibalizedUnits ?? 0} />
                {(cur.forwardBuyUnits ?? 0) > 0 && (
                  <div className="mt-2 text-xs text-[var(--severity-warning)]">
                    + {unitsK(cur.forwardBuyUnits)} units forward-bought by the retailer at deal price (off-invoice allowance paid, sold later at full price)
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => dockController.openAndSend(`Why is ${ev.id} (${ev.retailerName}, ${ev.productName}, ${ev.tactic}) forecast at ${pct(ev.roi)} ROI? Show the evidence from past events and the best compliant alternative.`)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white">
                <Sparkles className="size-3.5" />Ask the copilot about this event
              </button>
              <button onClick={() => { onClose(); void nav(`/events?retailer=${ev.retailerId}&tactic=${encodeURIComponent(ev.originalTactic)}`); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium">
                <History className="size-3.5" />Past {ev.originalTactic} events at {ev.retailerName}
              </button>
              {ev.status !== 'draft' && (
                <button onClick={() => void revert()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                  <RotateCcw className="size-3.5" />Revert to the original draft
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">Re-plan options</div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Forecast = ML baseline for these weeks × {ev.retailerName}&apos;s historical response to each tactic (lift, pantry loading, cannibalization, forward buying).
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase text-[var(--muted-foreground)]">
                  <tr><th className="py-1.5 pr-3">Option</th><th className="pr-3 text-right">Units</th><th className="pr-3 text-right">Volume kept</th>
                    <th className="pr-3 text-right">Trade spend</th><th className="pr-3 text-right">Net profit</th><th className="pr-3 text-right">ROI</th><th className="pr-3">Policy</th><th /></tr>
                </thead>
                <tbody>
                  {ev.scenarios.map((s) => {
                    const isCur = s.scenarioKey === ev.scenarioKey;
                    return (
                      <tr key={s.scenarioKey} className={cn('border-t border-[var(--border)]', s.recommended && 'bg-[var(--success-subtle)]/40')}>
                        <td className="py-2 pr-3">
                          <div className="font-medium">{s.label}</div>
                          <div className="flex gap-1 pt-0.5">
                            {s.recommended && <Pill tone="good">Recommended</Pill>}
                            {isCur && <Pill tone="info">Current</Pill>}
                            <Pill>{s.fundingMethod}</Pill>
                          </div>
                        </td>
                        <td className="pr-3 text-right tabular-nums">{unitsK(s.forecastUnits)}</td>
                        <td className="pr-3 text-right tabular-nums">{unitsK(s.volumeKept)}</td>
                        <td className="pr-3 text-right tabular-nums">{moneyK(s.tradeSpend)}</td>
                        <td className={cn('pr-3 text-right tabular-nums font-semibold whitespace-nowrap', (s.netProfit ?? 0) < 0 ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{moneyK(s.netProfit)}</td>
                        <td className="pr-3 text-right tabular-nums">{pct(s.roi)}</td>
                        <td className="pr-3">
                          {s.policyCompliant
                            ? <span title={s.policyNotes ?? ''} className="inline-flex items-center gap-1 text-xs text-[var(--success)]"><ShieldCheck className="size-3.5" />OK</span>
                            : <span title={s.policyNotes ?? ''} className="inline-flex items-center gap-1 text-xs text-[var(--brand-5)]"><ShieldAlert className="size-3.5" />{s.policyNotes?.split(';')[0]}</span>}
                        </td>
                        <td className="text-right">
                          {!isCur && (
                            <button onClick={() => void apply(s.scenarioKey)} disabled={!!busy}
                              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:border-[var(--primary-light)] disabled:opacity-50">
                              {busy === s.scenarioKey ? 'Saving…' : 'Apply'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {ev.decisions.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="font-semibold">Decision log (Lakebase)</div>
              <ul className="mt-2 space-y-2 text-sm">
                {ev.decisions.map((d) => (
                  <li key={d.id} className="rounded-lg bg-[var(--muted)] px-3 py-2">
                    <div><b>{d.id}</b> · {d.fromLabel} → <b>{d.toLabel}</b> · net profit {moneyK(d.fromNetProfit)} → {moneyK(d.toNetProfit)} ({signedK((d.toNetProfit ?? 0) - (d.fromNetProfit ?? 0))})</div>
                    <div className="text-xs text-[var(--muted-foreground)]">by {d.approvedBy} via {d.via} · {new Date(d.createdAt).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
