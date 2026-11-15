/**
 * Post-event analysis — every completed promotion of the last 104 weeks measured against the ML
 * baseline and netted for pantry loading, cannibalization and forward buying (gold_event_roi,
 * mirrored in Lakebase). Filter by retailer / tactic (deep-linked from the planner drawer), open an
 * event to see its weekly curve.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { LineChart, Sigma } from 'lucide-react';
import { dockController } from '@/chat/dockController';
import { fetchEvent, fetchEvents, fetchSummary, moneyK, pct, signedPct, unitsK, weekLabel, type PromoEvent, type TacticSummary } from '@/lib/promo';
import { Card, Drawer, LiftBar, Pill, cn } from '@/lib/ui';
import { CurveChart, CurveLegend } from './CurveChart';

const RETAILERS = [['', 'All retailers'], ['R01', 'ValuMax Stores'], ['R02', 'Greenleaf Market'], ['R03', 'Harbor Fresh Grocers'], ['R04', 'QuickPantry'], ['R05', 'BulkWise Club']];
const TACTICS = ['', 'BOGO', 'Feature + Display', 'TPR', 'Multi-buy'];

export function EventsView() {
  const [params, setParams] = useSearchParams();
  const retailer = params.get('retailer') ?? '';
  const tactic = params.get('tactic') ?? '';
  const [events, setEvents] = useState<PromoEvent[] | null>(null);
  const [summary, setSummary] = useState<TacticSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<'net' | 'date'>('net');

  useEffect(() => { setEvents(null); fetchEvents({ retailer, tactic }).then(setEvents).catch(() => setEvents([])); }, [retailer, tactic]);
  useEffect(() => { fetchSummary().then(setSummary).catch(() => setSummary([])); }, []);

  const rows = useMemo(() => {
    if (!events) return null;
    return [...events].sort((a, b) => (sort === 'net' ? (a.netProfit ?? 0) - (b.netProfit ?? 0) : b.startWeek.localeCompare(a.startWeek)));
  }, [events, sort]);
  const tot = useMemo(() => {
    if (!events?.length) return null;
    const s = (k: keyof PromoEvent) => events.reduce((a, e) => a + Number(e[k] ?? 0), 0);
    return { n: events.length, spend: s('tradeSpend'), profit: s('netProfit'), lift: s('grossIncrementalUnits') / Math.max(1, s('baselineUnits')),
      dip: s('dipUnits') / Math.max(1, s('grossIncrementalUnits')), can: s('cannibalizedUnits') / Math.max(1, s('grossIncrementalUnits')),
      lost: events.filter((e) => (e.netProfit ?? 0) < 0).length };
  }, [events]);
  const setQs = (kv: Record<string, string>) => { const p = new URLSearchParams(params); for (const [k, v] of Object.entries(kv)) { if (v) p.set(k, v); else p.delete(k); } setParams(p); };
  const setQ = (k: string, v: string) => setQs({ [k]: v });
  const matrix = useMemo(() => {
    const m = new Map<string, TacticSummary[]>();
    for (const r of summary ?? []) { if (!m.has(r.retailer_name)) m.set(r.retailer_name, []); m.get(r.retailer_name)!.push(r); }
    return m;
  }, [summary]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div>
          <h1 className="font-display text-3xl font-semibold">Post-event analysis</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
            {`Every completed promotion measured against the ML baseline (what would have sold without it), then netted for the pantry-loading dip in the 4 weeks after, the sales it stole from sister SKUs and — on off-invoice deals — the units the retailer forward-bought at deal price. ROI = (incremental gross profit − trade spend) ÷ trade spend.`}
          </p>
        </div>

        <Card title="ROI by retailer × tactic (last 104 weeks)" icon={<Sigma className="size-4 text-[var(--primary-light)]" />}>
          {!summary ? <div className="h-32 animate-pulse rounded-xl bg-[var(--muted)]" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase text-[var(--muted-foreground)]">
                  <tr><th className="py-1.5 pr-3">Retailer</th><th className="pr-3">Tactic</th><th className="pr-3">Funding</th><th className="pr-3 text-right">Events</th>
                    <th className="pr-3 text-right">Volume lift</th><th className="pr-3 text-right">Pantry loading</th><th className="pr-3 text-right">Cannibalization</th>
                    <th className="pr-3 text-right">Forward buy</th><th className="pr-3 text-right">Trade spend</th><th className="pr-3 text-right">Net profit</th><th className="text-right">ROI</th></tr>
                </thead>
                <tbody>
                  {[...matrix.entries()].map(([name, rs]) => rs.map((r, i) => (
                    <tr key={`${name}-${r.tactic}-${r.funding_method}`} onClick={() => setQs({ retailer: RETAILERS.find((x) => x[1] === name)?.[0] ?? '', tactic: r.tactic })}
                      className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/60', r.net_profit_usd < 0 && 'bg-[#FFF6F5]')}>
                      <td className="py-1.5 pr-3 font-medium">{i === 0 ? name : ''}</td>
                      <td className="pr-3">{r.tactic}</td>
                      <td className="pr-3 text-xs text-[var(--muted-foreground)]">{r.funding_method}</td>
                      <td className="pr-3 text-right tabular-nums">{r.events}</td>
                      <td className="pr-3 text-right tabular-nums">+{r.volume_lift_pct}%</td>
                      <td className="pr-3 text-right tabular-nums">{r.pantry_loading_pct_of_lift}%</td>
                      <td className="pr-3 text-right tabular-nums">{r.cannibalization_pct_of_lift}%</td>
                      <td className="pr-3 text-right tabular-nums">{r.forward_buy_pct_of_event_volume ? `${r.forward_buy_pct_of_event_volume}%` : '—'}</td>
                      <td className="pr-3 text-right tabular-nums">{moneyK(Number(r.trade_spend_usd))}</td>
                      <td className={cn('pr-3 text-right tabular-nums font-semibold', r.net_profit_usd < 0 ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{moneyK(Number(r.net_profit_usd))}</td>
                      <td className={cn('text-right tabular-nums font-semibold', r.roi_pct < 0 ? 'text-[var(--brand-5)]' : '')}>{r.roi_pct > 0 ? '+' : ''}{r.roi_pct}%</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Completed promotions" icon={<LineChart className="size-4 text-[var(--primary-light)]" />}
          right={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select value={retailer} onChange={(e) => setQ('retailer', e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1" aria-label="Retailer">
                {RETAILERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
              <select value={tactic} onChange={(e) => setQ('tactic', e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1" aria-label="Tactic">
                {TACTICS.map((t) => <option key={t} value={t}>{t || 'All tactics'}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as 'net' | 'date')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1" aria-label="Sort">
                <option value="net">Worst net profit first</option><option value="date">Most recent first</option>
              </select>
            </div>
          }>
          {tot && (
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><b className="tabular-nums">{tot.n}</b> events</span>
              <span>volume lift <b className="tabular-nums">{signedPct(tot.lift)}</b></span>
              <span>pantry loading <b className="tabular-nums">{pct(tot.dip)}</b> of lift</span>
              <span>cannibalization <b className="tabular-nums">{pct(tot.can)}</b> of lift</span>
              <span>trade spend <b className="tabular-nums">{moneyK(tot.spend)}</b></span>
              <span>net profit <b className={cn('tabular-nums', tot.profit < 0 ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{moneyK(tot.profit)}</b> (ROI {pct(tot.profit / Math.max(1, tot.spend), 1)})</span>
              <span><b className="tabular-nums">{tot.lost}</b> lost money</span>
            </div>
          )}
          {!rows ? <div className="h-48 animate-pulse rounded-xl bg-[var(--muted)]" /> : rows.length === 0 ? (
            <div className="text-sm text-[var(--muted-foreground)]">No completed promotions match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase text-[var(--muted-foreground)]">
                  <tr><th className="py-1.5 pr-3">Event</th><th className="pr-3">Week</th><th className="pr-3">Tactic</th><th className="pr-3 text-right">Lift</th>
                    <th className="pr-3 text-right">Net incr. units</th><th className="pr-3 text-right">Trade spend</th><th className="pr-3 text-right">Net profit</th><th className="pr-3 text-right">ROI</th><th>Verdict</th></tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} onClick={() => setOpen(e.id)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/60">
                      <td className="py-1.5 pr-3"><div className="font-medium">{e.productName}</div><div className="text-[11px] text-[var(--muted-foreground)]">{e.id} · {e.retailerName}</div></td>
                      <td className="pr-3 whitespace-nowrap">{weekLabel(e.startWeek)} {e.startWeek.slice(0, 4)}</td>
                      <td className="pr-3">{e.tactic} <span className="text-[11px] text-[var(--muted-foreground)]">{pct(e.discountDepth)} · {e.fundingMethod}</span></td>
                      <td className="pr-3 text-right tabular-nums">{signedPct(e.volumeLiftPct)}</td>
                      <td className="pr-3 text-right tabular-nums">{unitsK(e.netIncrementalUnits)}</td>
                      <td className="pr-3 text-right tabular-nums">{moneyK(e.tradeSpend)}</td>
                      <td className={cn('pr-3 text-right tabular-nums font-semibold', (e.netProfit ?? 0) < 0 ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{moneyK(e.netProfit)}</td>
                      <td className="pr-3 text-right tabular-nums">{pct(e.roi)}</td>
                      <td><Pill tone={e.verdict === 'Lost money' ? 'bad' : e.verdict === 'Marginal' ? 'warn' : 'good'}>{e.verdict}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <EventDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function EventDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [ev, setEv] = useState<PromoEvent | null>(null);
  useEffect(() => { setEv(null); if (id) fetchEvent(id).then(setEv).catch(() => setEv(null)); }, [id]);
  return (
    <Drawer open={!!id} onClose={onClose} title={ev ? `${ev.id} · ${ev.eventName}` : 'Loading…'}
      subtitle={ev ? `${weekLabel(ev.startWeek)} ${ev.startWeek.slice(0, 4)} · ${ev.weeks} week(s) · ${pct(ev.discountDepth)} off · ${ev.fundingMethod} · ${ev.featureAd ? 'feature ad' : 'no feature'}${ev.inStoreDisplay ? ' + endcap display' : ''}` : undefined}>
      {!ev ? <div className="h-60 animate-pulse rounded-xl bg-[var(--muted)]" /> : (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Weekly sales vs the ML baseline</div>
              <Pill tone={ev.verdict === 'Lost money' ? 'bad' : ev.verdict === 'Marginal' ? 'warn' : 'good'}>{ev.verdict} · ROI {pct(ev.roi)}</Pill>
            </div>
            <div className="mt-3"><CurveChart curve={ev.curve ?? []} /></div>
            <CurveLegend />
            {(ev.curve?.length ?? 0) > 0 && (
              <div className="mt-3 text-xs text-[var(--muted-foreground)]">
                Sister SKUs during the event: {unitsK(ev.curve!.filter((p) => p.phase === 'event').reduce((a, p) => a + p.sister_actual, 0))} sold vs{' '}
                {unitsK(ev.curve!.filter((p) => p.phase === 'event').reduce((a, p) => a + p.sister_baseline, 0))} expected.
                {' '}Retailer bought {unitsK(ev.curve!.reduce((a, p) => a + p.on_deal, 0))} units on deal.
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="font-semibold">The decomposition</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['ML baseline', unitsK(ev.baselineUnits)], ['Actual', unitsK(ev.actualUnits)], ['Gross incremental', unitsK(ev.grossIncrementalUnits)],
                ['Volume lift', signedPct(ev.volumeLiftPct)], ['Pantry-loading dip', unitsK(ev.dipUnits)], ['Cannibalized', unitsK(ev.cannibalizedUnits)],
                ['Forward-bought', unitsK(ev.forwardBuyUnits)], ['Net incremental', unitsK(ev.netIncrementalUnits)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-[var(--muted)] px-3 py-2"><div className="text-[10px] uppercase text-[var(--muted-foreground)]">{l}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
              ))}
            </div>
            <div className="mt-4"><LiftBar net={ev.netIncrementalUnits ?? 0} dip={ev.dipUnits ?? 0} cannib={ev.cannibalizedUnits ?? 0} /></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Trade spend', moneyK(ev.tradeSpend)], ['…on baseline units', moneyK(ev.subsidisedBaseline)], ['…on forward buy', moneyK(ev.forwardBuyCost)],
                ['Fixed fees', moneyK(ev.fixedFees)], ['Incremental gross profit', moneyK(ev.incrementalGp)], ['Net profit', moneyK(ev.netProfit)],
                ['ROI', pct(ev.roi)], ['Allowance / unit', `$${(ev.allowancePerUnit ?? 0).toFixed(2)}`],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-[var(--border)] px-3 py-2"><div className="text-[10px] uppercase text-[var(--muted-foreground)]">{l}</div>
                  <div className={cn('text-lg font-semibold tabular-nums', (l === 'Net profit' || l === 'ROI') && (ev.netProfit ?? 0) < 0 && 'text-[var(--brand-5)]')}>{v}</div></div>
              ))}
            </div>
            <button onClick={() => dockController.openAndSend(`Explain the post-event result of ${ev.id} (${ev.eventName}): where did the lift go and why is the ROI ${pct(ev.roi)}?`)}
              className="mt-4 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white">Ask the copilot to explain this event</button>
          </div>
        </>
      )}
    </Drawer>
  );
}
