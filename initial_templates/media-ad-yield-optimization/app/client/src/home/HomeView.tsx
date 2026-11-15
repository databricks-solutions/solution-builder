/**
 * Home — the yield desk. Maya Chen (Director of Yield & Pricing, Aurora Crest Media) watches one screen:
 * a CPM ticker of every programmatic product against its rate card, a sell-through heatmap
 * (daypart x property) from the gold inventory table, the pacing blotter of live IOs, and the
 * yield leak. Every number comes from the same endpoints as before; nothing is invented here.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { ArrowUpRight, Sparkles, TerminalSquare } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  HERO_CAMPAIGN, HERO_PRODUCT, cpm, fetchActivity, fetchCampaigns, fetchOpportunities, fetchSellThrough, fetchSummary, imps, moneyK, pct, who,
  type ActivityRow, type Campaign, type Opportunity, type SellThroughCell, type Summary,
} from '@/yield/api';
import { cn } from '@/yield/ui';

const ACTION: Record<string, string> = {
  ai_analysis: 'RECOVERY PLAN', plan_approved: 'PLAN SENT', notice_edited: 'NOTICE EDITED', floor_change: 'FLOOR QUEUED', note: 'NOTE',
};

const DAYPART_ORDER = ['Overnight', 'Morning', 'Daytime', 'Early Fringe', 'Prime', 'Late Night'];

/** Tabular label + value cell used across the desk. */
function Tick({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' | 'amber' }) {
  return (
    <div className="min-w-0 border-l border-[var(--border)] pl-4 first:border-l-0 first:pl-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl font-medium tabular-nums', tone === 'down' && 'text-[var(--brand-5)]', tone === 'up' && 'text-[var(--brand-4)]', tone === 'amber' && 'text-[var(--brand-2)]')}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

function Panel({ title, meta, children, className }: { title: string; meta?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-h-0 flex-col border border-[var(--border)] bg-[var(--card)]', className)}>
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-2)]">{title}</h2>
        {meta && <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{meta}</span>}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

/** Heat colour for sell-through: dark at 0, amber at the top of the range. */
function heat(v: number | null): CSSProperties {
  if (v == null) return { background: 'transparent' };
  const a = Math.min(1, Math.max(0.06, (v - 0.4) / 0.6));
  return { background: `rgb(255 176 32 / ${a.toFixed(3)})`, color: a > 0.55 ? '#0B0F15' : 'var(--brand-ink)' };
}

function SellThroughHeatmap({ cells }: { cells: SellThroughCell[] | null }) {
  if (!cells) return <div className="h-40 animate-pulse bg-[var(--muted)]" />;
  if (cells.length === 0) return <div className="font-mono text-xs text-[var(--muted-foreground)]">No inventory rows in the last 28 days.</div>;
  const dayparts = [...new Set(cells.map((c) => c.daypart))].sort((a, b) => {
    const ia = DAYPART_ORDER.indexOf(a), ib = DAYPART_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const props = [...new Set(cells.map((c) => c.platform))].sort();
  const at = (d: string, p: string) => cells.find((c) => c.daypart === d && c.platform === p)?.sell_through ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 font-mono text-xs">
        <thead>
          <tr>
            <th className="w-28 text-left font-normal text-[var(--muted-foreground)]">DAYPART ↓ / PROPERTY →</th>
            {props.map((p) => <th key={p} className="px-1 pb-1 text-center font-normal uppercase text-[var(--muted-foreground)]">{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {dayparts.map((d) => (
            <tr key={d}>
              <td className="pr-2 text-right text-[var(--brand-ink)]">{d}</td>
              {props.map((p) => {
                const v = at(d, p);
                return (
                  <td key={p} className="h-11 min-w-[72px] text-center font-medium tabular-nums" style={heat(v)}>
                    {v == null ? '—' : pct(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-[var(--muted-foreground)]">
        <span>40%</span>
        <span className="h-2 w-40 bg-gradient-to-r from-[rgb(255_176_32/0.06)] to-[rgb(255_176_32/1)]" />
        <span>100% sold · last 28 days</span>
      </div>
    </div>
  );
}

/** Pacing bar: the fill is projected delivery; the tick is the 95% make-good line. */
function PacingBar({ value }: { value: number | null }) {
  const w = Math.min(100, Math.max(0, (value ?? 0) * 100));
  return (
    <div className="relative h-2.5 w-full bg-[var(--muted)]">
      <div className={cn('absolute inset-y-0 left-0', w < 95 ? 'bg-[var(--brand-5)]' : 'bg-[var(--brand-4)]')} style={{ width: `${w}%` }} />
      <div className="absolute -top-1 bottom-[-4px] w-px bg-[var(--brand-2)]" style={{ left: '95%' }} />
    </div>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [risk, setRisk] = useState<Campaign[] | null>(null);
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [cells, setCells] = useState<SellThroughCell[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchCampaigns(true).then(setRisk).catch(() => setRisk([]));
    fetchOpportunities().then(setOpps).catch(() => setOpps([]));
    fetchSummary().then(setSummary).catch(() => {});
    fetchActivity(10).then(setActivity).catch(() => {});
    fetchSellThrough().then((r) => setCells(r.data)).catch(() => setCells([]));
  }, [tick]);
  const hero = risk?.find((c) => c.id === HERO_CAMPAIGN) ?? risk?.[0];
  const leak = opps?.find((o) => o.productId === HERO_PRODUCT && o.isLeak) ?? opps?.find((o) => o.isLeak);
  const script = config?.assistantScript ?? [];
  const tickerRows = [...(opps ?? [])].sort((a, b) => Number(b.isLeak) - Number(a.isLeak) || (b.revenueGap28d ?? 0) - (a.revenueGap28d ?? 0)).slice(0, 8);

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-[1400px] space-y-3 px-5 py-4">
        {/* Status bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--border)] bg-[var(--card)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[var(--brand-4)]"><span className="size-1.5 animate-pulse rounded-full bg-[var(--brand-4)]" />Live</span>
            <span>Aurora Crest Media</span>
            <span className="text-[var(--border)]">|</span>
            <span>Ad sales yield desk</span>
            <span className="text-[var(--border)]">|</span>
            <span>Upfront season</span>
          </div>
          <div className="flex items-center gap-2 normal-case tracking-normal">
            {hero && (
              <button onClick={() => nav(`/campaigns/${hero.id}`)} className="inline-flex items-center gap-1 bg-[var(--brand-2)] px-3 py-1.5 font-mono text-xs font-semibold normal-case text-[#0B0F15]">
                Open {hero.advertiserName} IO <ArrowUpRight className="size-3.5" />
              </button>
            )}
            <button onClick={() => nav('/yield')} className="border border-[var(--border)] px-3 py-1.5 font-mono text-xs normal-case text-[var(--brand-ink)] hover:border-[var(--brand-2)]">Yield board</button>
            <button onClick={() => nav('/dashboard')} className="border border-[var(--border)] px-3 py-1.5 font-mono text-xs normal-case text-[var(--brand-ink)] hover:border-[var(--brand-2)]">Revenue dashboard</button>
          </div>
        </div>

        {/* Headline + the four numbers that matter */}
        <div className="grid gap-4 border border-[var(--border)] bg-[var(--card)] p-5 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight text-[var(--brand-ink)]">
              {leak && hero
                ? <>Premium sports clears at <span className="text-[var(--brand-2)]">{cpm(leak.pmpEcpm28d)}</span> while {hero.advertiserName}&rsquo;s auto launch is <span className="text-[var(--brand-5)]">{imps(hero.projectedShortfall)} impressions short</span>.</>
                : 'Where is the yield leaking this quarter?'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted-foreground)]">
              Four upfront IOs are pacing toward make-goods after <i>Harbor Lights</i> moved to Friday. Crest+ Live Sports, the best Auto-Intender reach in the
              portfolio, is selling through a run-of-network PMP. Maya Chen needs a plan that fixes both before the flights end.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:grid-cols-2">
            {summary ? (
              <>
                <Tick label="Make-good liability" value={moneyK(summary.make_good_liability)} sub={`${summary.at_risk} of ${summary.live_campaigns} live IOs < 95%`} tone="down" />
                <Tick label="Left on table · 28d" value={moneyK(summary.revenue_gap_28d)} sub={`${summary.leaks} mis-priced product${summary.leaks === 1 ? '' : 's'}`} tone="down" />
                <Tick label="Shortfall at flight end" value={imps(summary.shortfall)} sub="in-target impressions owed" tone="amber" />
                <Tick label="Plans · floor changes" value={`${summary.plans} · ${summary.floor_changes}`} sub="written back to Lakebase" />
              </>
            ) : [0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse bg-[var(--muted)]" />)}
          </div>
        </div>

        {/* CPM ticker: every programmatic product, programmatic eCPM vs its rate card */}
        <div className="border border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
            <TerminalSquare className="size-3.5" /> CPM ticker · programmatic eCPM vs rate card · 28d
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border)] md:grid-cols-4 xl:grid-cols-8 xl:divide-y-0">
            {!opps && [0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse bg-[var(--muted)]" />)}
            {tickerRows.map((o) => {
              const delta = o.rateCardCpm && o.programmaticEcpm28d != null ? o.programmaticEcpm28d / o.rateCardCpm - 1 : null;
              return (
                <button key={o.productId} onClick={() => nav('/yield')}
                  className={cn('px-3 py-2.5 text-left hover:bg-[var(--muted)]', o.isLeak && 'bg-[rgb(255_77_94/0.08)]')}>
                  <div className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">{o.productName}</div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className={cn('font-mono text-xl font-medium tabular-nums', o.isLeak ? 'text-[var(--brand-5)]' : 'text-[var(--brand-ink)]')}>{cpm(o.programmaticEcpm28d)}</span>
                    <span className="font-mono text-[11px] text-[var(--muted-foreground)]">RC {cpm(o.rateCardCpm)}</span>
                  </div>
                  <div className={cn('font-mono text-[11px]', delta != null && delta < -0.1 ? 'text-[var(--brand-5)]' : 'text-[var(--brand-4)]')}>
                    {delta == null ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta * 100).toFixed(0)}%`}
                    {o.isLeak && <span className="ml-1.5 text-[var(--brand-5)]">LEAK</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main grid: heatmap + pacing blotter | leak + command line + blotter */}
        <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
          <div className="grid gap-3">
            <Panel title="Sell-through · daypart × property" meta="gold_inventory_daily · 28d">
              <SellThroughHeatmap cells={cells} />
            </Panel>
            <Panel title="Pacing · live IOs at risk" meta={risk ? `${risk.length} below 95%` : ''}>
              {!risk && <div className="h-24 animate-pulse bg-[var(--muted)]" />}
              {risk?.length === 0 && <div className="font-mono text-xs text-[var(--muted-foreground)]">Every live IO is pacing to its guarantee.</div>}
              <div className="divide-y divide-[var(--border)]">
                {risk?.map((c) => (
                  <button key={c.id} onClick={() => nav(`/campaigns/${c.id}`)}
                    className={cn('grid w-full grid-cols-[minmax(0,1fr)_120px] gap-4 py-3 text-left hover:bg-[var(--muted)]/60', c.id === HERO_CAMPAIGN && 'bg-[rgb(255_77_94/0.05)]')}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--brand-ink)]">{c.name}</div>
                      <div className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">{c.ioNumber} · {c.targetSegment} · {c.agency}</div>
                      <div className="mt-2"><PacingBar value={c.projectedDeliveryPct} /></div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 font-mono text-[11px] text-[var(--muted-foreground)]">
                        <span>pacing <b className="text-[var(--brand-ink)]">{pct(c.pacing)}</b></span>
                        <span>proj <b className="text-[var(--brand-ink)]">{pct(c.projectedDeliveryPct)}</b> of {imps(c.bookedImpressions)}</span>
                        <span><b className="text-[var(--brand-5)]">{imps(c.projectedShortfall)}</b> short</span>
                        <span>{c.daysRemaining}d left</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Liability</div>
                      <div className="font-mono text-xl font-medium tabular-nums text-[var(--brand-5)]">{moneyK(c.makeGoodLiability)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid gap-3">
            <Panel title="Yield leak" meta={leak ? leak.currentGroup ?? '' : ''}>
              {!opps && <div className="h-24 animate-pulse bg-[var(--muted)]" />}
              {opps && !leak && <div className="font-mono text-xs text-[var(--muted-foreground)]">Every programmatic product is priced in its rate-card floor group.</div>}
              {leak && (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-[var(--brand-ink)]">{leak.productName}</div>
                  <div className="font-mono text-[11px] text-[var(--muted-foreground)]">
                    floor {cpm(leak.currentFloor)} · rate card group {leak.rateCardGroup} · {leak.currentRuleId}
                  </div>
                  {[
                    { label: 'Rate card', v: leak.rateCardCpm, c: 'var(--brand-3)' },
                    { label: 'Open auction clears', v: leak.openClearing28d, c: 'var(--brand-4)' },
                    { label: 'PMP eCPM (leaking)', v: leak.pmpEcpm28d, c: 'var(--brand-5)' },
                  ].map((r) => {
                    const max = Math.max(leak.rateCardCpm ?? 0, leak.openClearing28d ?? 0, leak.pmpEcpm28d ?? 0, 1);
                    return (
                      <div key={r.label}>
                        <div className="flex justify-between font-mono text-[11px] text-[var(--muted-foreground)]"><span>{r.label}</span><span className="tabular-nums text-[var(--brand-ink)]">{cpm(r.v)}</span></div>
                        <div className="mt-1 h-2 bg-[var(--muted)]"><div className="h-full" style={{ width: `${((r.v ?? 0) / max) * 100}%`, background: r.c }} /></div>
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
                    <Tick label="Lost since rule" value={moneyK(leak.revenueGapSinceRule)} tone="down" />
                    <Tick label="Annualised" value={moneyK(leak.revenueGapAnnualized)} tone="down" />
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Command line" meta="assistant">
              <div className="space-y-1.5 font-mono text-[13px]">
                {script.map((s) => (
                  <button key={s.prompt} onClick={() => dockController.openAndSend(s.prompt)}
                    className="flex w-full items-start gap-2 border border-[var(--border)] px-3 py-2 text-left text-[var(--brand-ink)] hover:border-[var(--brand-2)]">
                    <span className="text-[var(--brand-2)]">&gt;</span>
                    <span className="flex-1">{s.prompt}</span>
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                  </button>
                ))}
              </div>
              <p className="mt-3 font-mono text-[11px] text-[var(--muted-foreground)]">Yield questions read the live board · plans run SQL on the lakehouse · revenue goes to Genie · IO terms to the ad-sales library.</p>
            </Panel>

            <Panel title="Blotter" meta="recent activity">
              {activity.length === 0 && <div className="font-mono text-xs text-[var(--muted-foreground)]">No activity yet. Open an at-risk IO and build its recovery plan.</div>}
              <ul className="font-mono text-[12px]">
                {activity.map((a, i) => (
                  <li key={i} className="flex items-baseline gap-2 border-b border-[var(--border)] py-1.5 last:border-0">
                    <span className="w-14 shrink-0 tabular-nums text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button onClick={() => nav(a.campaign_id ? `/campaigns/${a.campaign_id}` : '/plans')} className="min-w-0 truncate text-left hover:text-[var(--brand-2)]">
                      <span className="text-[var(--brand-2)]">{ACTION[a.action] ?? a.action}</span> {a.subject} <span className="text-[var(--muted-foreground)]">{who(a.party)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
