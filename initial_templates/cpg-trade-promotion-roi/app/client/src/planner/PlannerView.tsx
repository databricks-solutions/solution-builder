/**
 * Promo Planner (home) — Elena Marsh, Director of Revenue Growth Management at Crestwood Snacks,
 * reviews next quarter's draft promo calendar before it goes to the retailers. The calendar IS the
 * page: retailer rows × 13 weeks, each event a block tagged by tactic. Every event carries a forecast
 * (ML baseline × the retailer's historical response). The copilot flags the money-losing events with
 * evidence, proposes a compliant re-plan and — after approval — writes the approved plan back to Lakebase.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, LineChart, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchPlan, moneyK, pct, signedK, weekLabel, type PlanEvent } from '@/lib/promo';
import { retailerChip } from '@/lib/retailers';
import { Card, Kpi, Pill, cn } from '@/lib/ui';
import { PlanDrawer } from './PlanDrawer';

// Tactic → block style. Red is reserved for the money-losing alarm, so no tactic uses it.
const TACTIC: Record<string, string> = {
  BOGO: 'bg-[#2A1F17] text-[#FFFBF2] border-[#2A1F17]',
  'Feature + Display': 'bg-[#E9A23B] text-[#2A1F17] border-[#B87A1E]',
  TPR: 'bg-[#FFFBF2] text-[#2A1F17] border-[#2A1F17]',
  'Multi-buy': 'bg-[#1F5C4D] text-[#FFFBF2] border-[#1F5C4D]',
};

export function PlannerView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [plan, setPlan] = useState<PlanEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchPlan()
      .then((p) => {
        setPlan(p);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [tick]);

  const s = useMemo(() => {
    if (!plan) return null;
    const sum = (xs: PlanEvent[], k: 'tradeSpend' | 'netProfit' | 'originalNetProfit') => xs.reduce((a, e) => a + (e[k] ?? 0), 0);
    const losing = plan.filter((e) => e.forecastFlag === 'Money-losing');
    const origLosing = plan.filter((e) => e.originalFlag === 'Money-losing');
    const replanned = plan.filter((e) => e.status !== 'draft');
    return {
      spend: sum(plan, 'tradeSpend'),
      profit: sum(plan, 'netProfit'),
      roi: sum(plan, 'netProfit') / Math.max(1, sum(plan, 'tradeSpend')),
      losing,
      origLosing,
      origLoss: sum(origLosing, 'originalNetProfit'),
      replanned,
      upside: replanned.reduce((a, e) => a + (e.netProfit ?? 0) - (e.originalNetProfit ?? 0), 0),
      retailers: [...new Map(plan.map((e) => [e.retailerId, e.retailerName])).entries()].sort(),
    };
  }, [plan]);

  const firstWeekStart = plan?.find((e) => e.planWeek === 1)?.startWeek;
  const weekStart = (w: number) => {
    if (!firstWeekStart) return '';
    const d = new Date(`${firstWeekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * (w - 1));
    return d.toISOString().slice(0, 10);
  };
  const script = config?.assistantScript ?? [];
  const valumaxLosing = s?.origLosing.filter((e) => e.retailerName.startsWith('ValuMax')) ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* Header: the plan's headline across the page, then the story and the scoreboard — no hero band. */}
        <header className="space-y-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              <span className="inline-block size-2.5 bg-[var(--primary)]" />
              Crestwood Snacks Co. · Revenue Growth Management · Next quarter
            </div>
            <h1 className="mt-2 max-w-5xl font-display text-[2.75rem] font-extrabold leading-[1.02] tracking-tight text-[var(--foreground)]">
              {!s ? (
                'Next quarter’s promo plan is ready for review.'
              ) : s.replanned.length && !s.losing.length ? (
                <>Re-plan approved: {signedK(s.upside)} of forecast profit recovered.</>
              ) : (
                <>
                  {s.origLosing.length} planned promotions will lose {moneyK(Math.abs(s.origLoss))} — and they’re the ones with the biggest
                  volume.
                </>
              )}
            </h1>
          </div>
          <div className="grid gap-6 xl:grid-cols-[1fr_640px] xl:items-end">
            <div className="min-w-0">
              <p className="max-w-3xl leading-relaxed text-[var(--muted-foreground)]">
                The draft calendar repeats last year’s “best” events: deep BOGOs at ValuMax Stores that tripled volume. Post-event analysis
                against the ML baseline says those spikes were borrowed from the weeks after, stolen from sister SKUs and bought ahead by
                the retailer at deal price.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    if (script[0]) void dockController.newAndSend(script[0].prompt);
                  }}
                  className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-bold text-[var(--primary-foreground)] shadow-[3px_3px_0_0_var(--brand-ink)] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_var(--brand-ink)]"
                >
                  <Sparkles className="size-4" />
                  {script[0]?.label ?? 'Ask the copilot'} <ArrowRight className="size-4" />
                </button>
                <button
                  onClick={() => void nav('/events')}
                  className="inline-flex items-center gap-2 rounded-md border-2 border-[var(--brand-ink)] px-4 py-1.5 text-sm font-semibold hover:bg-[var(--muted)]"
                >
                  <LineChart className="size-4" />
                  Post-event analysis
                </button>
                <button
                  onClick={() => void nav('/dashboard')}
                  className="inline-flex items-center gap-2 rounded-md border-2 border-[var(--brand-ink)] px-4 py-1.5 text-sm font-semibold hover:bg-[var(--muted)]"
                >
                  <BarChart3 className="size-4" />
                  Trade ROI dashboard
                </button>
              </div>
            </div>

            {/* Scoreboard: four shelf-talker figures in one bordered strip. */}
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border-2 border-[var(--brand-ink)] bg-[var(--card)] md:grid-cols-4 xl:w-[640px]">
              {s ? (
                <>
                  <div className="border-b border-r border-[var(--brand-ink)]/25 px-4 py-3 md:border-b-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Planned trade spend</div>
                    <div className="font-display text-2xl font-extrabold tabular-nums">{moneyK(s.spend)}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{plan?.length} events · 13 weeks</div>
                  </div>
                  <div className="border-b border-[var(--brand-ink)]/25 px-4 py-3 md:border-b-0 md:border-r">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Forecast net profit</div>
                    <div className={cn('font-display text-2xl font-extrabold tabular-nums', s.profit < 0 && 'text-[var(--primary)]')}>
                      {moneyK(s.profit)}
                    </div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">blended ROI {pct(s.roi, 1)}</div>
                  </div>
                  <div className="border-r border-[var(--brand-ink)]/25 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Money-losing</div>
                    <div
                      className={cn(
                        'font-display text-2xl font-extrabold tabular-nums',
                        s.losing.length ? 'text-[var(--primary)]' : 'text-[var(--success)]',
                      )}
                    >
                      {s.losing.length}
                    </div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {s.losing.length
                        ? `${moneyK(s.losing.reduce((a, e) => a + (e.netProfit ?? 0), 0))} forecast`
                        : 'none left in the plan'}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Re-plan upside</div>
                    <div className="font-display text-2xl font-extrabold tabular-nums text-[var(--success)]">{signedK(s.upside)}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{s.replanned.length} events re-planned</div>
                  </div>
                </>
              ) : (
                [0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse bg-[var(--muted)]" />)
              )}
            </div>
          </div>
        </header>

        {err && (
          <div className="rounded-xl border border-[var(--primary)]/40 bg-[#FBE3E1] px-4 py-3 text-sm text-[#8A2019]">
            Could not load the plan: {err}
          </div>
        )}

        {/* THE calendar — the hero of the page. */}
        <section className="rounded-2xl border-2 border-[var(--brand-ink)] bg-[var(--card)] p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-tight">Next quarter promo calendar</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Retailer × week. Click any block to see its forecast, the lift vs baseline and the re-plan options.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {Object.entries(TACTIC).map(([k, cls]) => (
                <span key={k} className={cn('rounded border px-1.5 py-0.5 font-semibold', cls)}>
                  {k}
                </span>
              ))}
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FBE3E1] px-2 py-0.5 font-semibold text-[#8A2019] ring-2 ring-[var(--primary)]">
                <AlertTriangle className="size-3" />
                Money-losing
              </span>
            </div>
          </div>
          {!s ? (
            <div className="h-72 animate-pulse rounded-xl bg-[var(--muted)]" />
          ) : (
            <div className="w-0 min-w-full overflow-x-auto">
              <div className="min-w-[1000px]">
                <div className="grid grid-cols-[190px_repeat(13,minmax(0,1fr))] gap-1 border-b-2 border-[var(--brand-ink)] pb-1.5 text-[11px] text-[var(--muted-foreground)]">
                  <div className="self-end font-bold uppercase tracking-wider">Retailer</div>
                  {Array.from({ length: 13 }, (_, i) => (
                    <div key={i} className="text-center leading-tight">
                      <div className="font-bold text-[var(--foreground)]">W{i + 1}</div>
                      <div className="text-[10px]">{weekLabel(weekStart(i + 1))}</div>
                    </div>
                  ))}
                </div>
                {s.retailers.map(([rid, name]) => {
                  const evs = plan!.filter((e) => e.retailerId === rid);
                  const chip = retailerChip(rid);
                  // stack overlapping events on lanes
                  const lanes: PlanEvent[][] = [];
                  for (const e of [...evs].sort((a, b) => a.planWeek - b.planWeek)) {
                    const lane = lanes.find((l) =>
                      l.every((x) => x.planWeek + x.weeks <= e.planWeek || e.planWeek + e.weeks <= x.planWeek),
                    );
                    if (lane) lane.push(e);
                    else lanes.push([e]);
                  }
                  const net = evs.reduce((a, e) => a + (e.netProfit ?? 0), 0);
                  return (
                    <div key={rid} className="grid grid-cols-[190px_1fr] gap-1 border-b border-[var(--border)] py-2.5">
                      <div className="flex items-center gap-2.5 pr-2">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-md font-display text-xs font-extrabold tracking-wide shadow-[2px_2px_0_0_var(--brand-ink)]"
                          style={{ background: chip.bg, color: chip.fg }}
                        >
                          {chip.code}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-bold leading-tight">{name}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)]">
                            {evs.length} events ·{' '}
                            <span className={net < 0 ? 'font-semibold text-[var(--primary)]' : ''}>{moneyK(net)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {lanes.map((lane) => (
                          <div
                            key={lane.map((x) => x.id).join('|')}
                            className="grid gap-1"
                            style={{
                              gridTemplateColumns: 'repeat(13, minmax(0, 1fr))',
                            }}
                          >
                            {lane.map((e) => {
                              const losing = e.forecastFlag === 'Money-losing' && e.status === 'draft';
                              return (
                                <button
                                  key={e.id}
                                  onClick={() => setOpen(e.id)}
                                  style={{
                                    gridColumn: `${e.planWeek} / span ${e.weeks}`,
                                  }}
                                  className={cn(
                                    'rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition hover:-translate-y-px hover:shadow-md',
                                    TACTIC[e.tactic] ?? TACTIC.TPR,
                                    losing && 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--card)]',
                                  )}
                                  title={`${e.id} · ${e.productName} · ${e.tactic}`}
                                >
                                  <div className="flex items-center gap-1 font-bold uppercase tracking-wide">
                                    {e.status !== 'draft' ? (
                                      <CheckCircle2 className="size-3 shrink-0" />
                                    ) : losing ? (
                                      <AlertTriangle className="size-3 shrink-0" />
                                    ) : null}
                                    <span className="truncate">{e.tactic}</span>
                                  </div>
                                  <div className="truncate font-medium">
                                    {e.productName.replace(/^Crestwood |^Ridgeline |^Twistwell /, '')}
                                  </div>
                                  <div className="tabular-nums opacity-90">
                                    {moneyK(e.netProfit)} · {pct(e.roi)}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <Card
            title={s?.replanned.length ? 'Re-planned events' : 'Flagged: forecast to lose money'}
            icon={<AlertTriangle className="size-4 text-[var(--primary)]" />}
            right={
              <button onClick={() => void nav('/decisions')} className="text-xs font-semibold text-[var(--primary-light)] hover:underline">
                Decisions →
              </button>
            }
          >
            {!s ? (
              <div className="h-32 animate-pulse rounded-xl bg-[var(--muted)]" />
            ) : (
              <div className="space-y-2">
                {(s.origLosing.length ? s.origLosing : s.losing).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setOpen(e.id)}
                    className={cn(
                      'w-full rounded-lg border-2 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]',
                      e.status === 'draft'
                        ? 'border-[var(--primary)]/60 bg-[#FFF4F2]'
                        : 'border-[var(--success)]/50 bg-[var(--success-subtle)]/50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-bold">
                          {e.id} · {e.productName}
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {e.retailerName} · week of {weekLabel(e.startWeek)} ·{' '}
                          {e.planWeek <= 4 ? 'inside 4 weeks — notify buyer now' : `${e.planWeek} weeks out`}
                        </div>
                      </div>
                      {e.status === 'draft' ? (
                        <Pill tone="bad">
                          {e.tactic} · {pct(e.roi)} ROI
                        </Pill>
                      ) : (
                        <Pill tone="good">
                          <CheckCircle2 className="size-3" />
                          {e.tactic} · {pct(e.roi)} ROI
                        </Pill>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs">
                      {e.status === 'draft' ? (
                        <>
                          Forecast net profit <b className="text-[var(--primary)]">{moneyK(e.netProfit)}</b> on {moneyK(e.tradeSpend)} of
                          trade spend
                        </>
                      ) : (
                        <>
                          Was {e.originalTactic}: {moneyK(e.originalNetProfit)} → now{' '}
                          <b className="text-[var(--success)]">{moneyK(e.netProfit)}</b> (
                          {signedK((e.netProfit ?? 0) - (e.originalNetProfit ?? 0))}) · {e.decisionId}
                        </>
                      )}
                    </div>
                  </button>
                ))}
                {valumaxLosing.length > 0 && s.replanned.length === 0 && (
                  <p className="pt-1 text-xs text-[var(--muted-foreground)]">
                    The ValuMax Joint Business Plan requires 6 promoted events a quarter — the events can be re-planned, not dropped.
                  </p>
                )}
              </div>
            )}
          </Card>
          <Card title="Ask the Trade Promo Copilot" icon={<MessagesSquare className="size-4 text-[var(--primary-light)]" />}>
            <p className="-mt-1 text-xs text-[var(--muted-foreground)]">
              Calendar and re-plan tools read Lakebase; evidence comes from the post-event analysis; policy questions and ad-hoc analytics
              go to the Genie agent (gold tables + the TPG-2027 / ValuMax JBP documents).
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {script.map((st, i) => (
                <button
                  key={st.prompt}
                  onClick={() => {
                    void (i === 0 ? dockController.newAndSend(st.prompt) : dockController.openAndSend(st.prompt));
                  }}
                  className="flex items-center gap-2 rounded-md border-2 border-[var(--brand-ink)]/20 bg-[var(--background)] px-3 py-2 text-left text-sm font-medium hover:border-[var(--brand-ink)]"
                >
                  <Sparkles className="size-3.5 shrink-0 text-[var(--primary)]" />
                  {st.prompt}
                </button>
              ))}
            </div>
            <button
              onClick={() => void nav('/events')}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--primary-light)] hover:underline"
            >
              <BarChart3 className="size-3.5" />
              See every past event against its ML baseline →
            </button>
          </Card>
        </section>

        {/* JBP guardrails — the numbers the re-plan has to respect, as one quiet strip. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
          <Kpi
            label="Events re-planned"
            value={s?.replanned.length ?? '…'}
            sub="approved changes in Lakebase"
            tone={s?.replanned.length ? 'good' : undefined}
          />
          <Kpi
            label="ValuMax events"
            value={plan ? plan.filter((e) => e.retailerId === 'R01').length : '…'}
            sub="JBP minimum: 6 per quarter"
          />
          <Kpi
            label="ValuMax endcap displays"
            value={plan ? plan.filter((e) => e.retailerId === 'R01' && e.inStoreDisplay).length : '…'}
            sub="JBP minimum 2 · up to 8 slots"
          />
          <Kpi
            label="Below +15% target"
            value={plan ? plan.filter((e) => e.forecastFlag === 'Below target').length : '…'}
            sub="may run — reviewed by RGM"
            tone="warn"
          />
        </div>
      </div>
      <PlanDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
