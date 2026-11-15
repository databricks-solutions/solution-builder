/**
 * Live-Ops Console — the home screen, laid out as a game HUD: a season banner with the cohort
 * retention curve (Season 6 vs Season 7 installs at D1 / D7 / D30) as the hero, a stat strip, the
 * churn drivers as boss cards, segments as game cards ranked by LTV at risk, and a live-ops
 * calendar of staged or scheduled interventions. Clicking a card opens the SegmentPanel.
 * Refreshes on `dataMutated` (the agent staged a plan / a plan was scheduled).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { CalendarDays, Hourglass, MessageSquareWarning, Skull, Sparkles, TrendingDown } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { DRIVER_META, fetchKpis, fetchSegments, pct, usd, usdK, type Kpis, type SegmentSummary } from '@/lib/liveops';
import { SegmentPanel } from './SegmentPanel';
import { DriverChip, StatusChip } from './chips';

const REGIONS = ['NA', 'EU', 'LATAM', 'APAC', 'OCE'];
const ICON = { difficulty: Skull, matchmaking: Hourglass, toxicity: MessageSquareWarning, engagement: TrendingDown } as const;

export const OPENING_QUESTION = 'Why did retention drop after the Season 7 launch, and which segment puts the most revenue at risk?';

/** Cohort curve: Season 6 (pre) vs Season 7 (post) installs at D1 / D7 / D30. */
function CohortCurve({ pre, post }: { pre: { d1: number; d7: number; d30: number } | null; post: { d1: number; d7: number; d30: number } | null }) {
  const W = 460, H = 220, PAD = { l: 36, r: 56, t: 22, b: 30 };
  const xs = [PAD.l, PAD.l + (W - PAD.l - PAD.r) / 2, W - PAD.r];
  const labels = ['D1', 'D7', 'D30'];
  const vals = [pre, post].flatMap((c) => (c ? [c.d1, c.d7, c.d30] : []));
  const max = Math.max(10, ...vals) * 1.15;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = (c: { d1: number; d7: number; d30: number }) => [c.d1, c.d7, c.d30].map((v, i) => `${xs[i]},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke="rgb(255 255 255 / 0.07)" />
      ))}
      {labels.map((l, i) => (
        <text key={l} x={xs[i]} y={H - 8} textAnchor="middle" className="fill-[var(--muted-foreground)] font-mono text-[11px]">{l}</text>
      ))}
      {pre && (
        <>
          <polyline points={line(pre)} fill="none" stroke="var(--brand-3)" strokeWidth={2.5} strokeDasharray="6 5" strokeLinejoin="round" />
          {[pre.d1, pre.d7, pre.d30].map((v, i) => (
            <circle key={`pre${i}`} cx={xs[i]} cy={y(v)} r={4} fill="#0A0714" stroke="var(--brand-3)" strokeWidth={2} />
          ))}
          {[pre.d1, pre.d7, pre.d30].map((v, i) => (
            <text key={`prel${i}`} x={xs[i]} y={y(v) - 10} textAnchor="middle" className="fill-[var(--brand-3)] font-mono text-[11px] font-semibold">S6 {v}%</text>
          ))}
          
        </>
      )}
      {post && (
        <>
          <polyline points={line(post)} fill="none" stroke="var(--brand-2)" strokeWidth={3.5} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgb(255 43 214 / 0.8))' }} />
          {[post.d1, post.d7, post.d30].map((v, i) => (
            <g key={`post${i}`}>
              <circle cx={xs[i]} cy={y(v)} r={6} fill="var(--brand-2)" />
              <text x={xs[i]} y={y(v) + 22} textAnchor="middle" className="fill-[var(--brand-2)] font-mono text-[12px] font-bold">S7 {v}%</text>
            </g>
          ))}
                  </>
      )}
    </svg>
  );
}

/** Season 7 retention at D1 / D7 / D30 as three separate cells, Season 6 baseline under each. */
function RetentionTile({ post, pre }: { post: { d1: number; d7: number; d30: number }; pre: { d1: number; d7: number; d30: number } }) {
  const cells = [
    { k: 'D1', v: post.d1, p: pre.d1 },
    { k: 'D7', v: post.d7, p: pre.d7 },
    { k: 'D30', v: post.d30, p: pre.d30 },
  ];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Retention · S7 installs</div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {cells.map((c) => (
          <div key={c.k} className="min-w-0 rounded-lg bg-[var(--muted)] px-1.5 py-1.5">
            <div className="font-mono text-[10px] font-bold text-[var(--muted-foreground)]">{c.k}</div>
            <div className="whitespace-nowrap text-[16px] font-extrabold leading-tight tabular-nums text-[var(--brand-5)]">{c.v}%</div>
            <div className="whitespace-nowrap font-mono text-[10px] tabular-nums text-[var(--brand-3)]">S6 {c.p}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** HUD stat cell. */
function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-1 text-[26px] font-extrabold leading-none tabular-nums ${tone === 'bad' ? 'text-[var(--brand-5)]' : tone === 'good' ? 'text-[var(--primary)]' : ''}`}>{value}</div>
      <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">{sub}</div>
    </div>
  );
}

export function ConsoleView() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<SegmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driver, setDriver] = useState('');
  const [region, setRegion] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    const p: Record<string, string> = { limit: '100' };
    if (driver) p.driver = driver;
    if (region) p.region = region;
    Promise.all([fetchKpis(), fetchSegments(p)])
      .then(([k, s]) => { setKpis(k); setRows(s); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [driver, region]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => dataMutated.subscribe(load), [load]);

  const pre = kpis?.lake.retention?.find((r) => r.period === 'pre');
  const post = kpis?.lake.retention?.find((r) => r.period === 'post');
  const aPre = kpis?.lake.arpdau?.find((r) => r.period === 'pre');
  const aPost = kpis?.lake.arpdau?.find((r) => r.period === 'post');
  const matched = kpis?.lake.strategy?.find((s) => s.strategy.startsWith('Driver'));
  const blanket = kpis?.lake.strategy?.find((s) => s.strategy.startsWith('Blanket'));
  const live = kpis?.live;
  const maxAtRisk = Math.max(1, ...(live?.drivers ?? []).map((x) => x.at_risk));
  const d7Drop = pre && post ? Math.round(((Number(pre.d7) - Number(post.d7)) / Number(pre.d7)) * 100) : null;
  const toNum = (r: { d1: string; d7: string; d30: string } | undefined) => (r ? { d1: Number(r.d1), d7: Number(r.d7), d30: Number(r.d30) } : null);
  const budgetLeftPct = live?.budget ? Math.max(0, Math.min(100, (live.budget.remaining / Math.max(1, live.budget.budget)) * 100)) : 0;
  const calendar = useMemo(
    () => (rows ?? []).filter((s) => s.stagedPlan).sort((a, b) => (a.stagedPlan!.startDate < b.stagedPlan!.startDate ? -1 : 1)),
    [rows],
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] space-y-5 p-6">
          {/* Season banner */}
          <section className="relative overflow-hidden rounded-2xl border border-[rgb(255_43_214/0.35)] bg-[radial-gradient(120%_140%_at_0%_0%,#4A0F5C_0%,#1A0B33_55%,#0A0714_100%)] p-7 shadow-[0_0_60px_-20px_rgb(255_43_214/0.6)]">
            <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(115deg, #fff 0 2px, transparent 2px 22px)' }} />
            <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-2)] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#0A0714]">
                  Season 7 · The Drowned Crown · live
                </div>
                <h1 className="mt-4 text-[38px] font-extrabold uppercase leading-[0.98] tracking-tight text-[var(--brand-ink)]">
                  New players quit at D7 <span className="text-[var(--brand-2)]">{d7Drop != null ? `−${d7Drop}%` : '—'}</span> since Season 7 launched.
                  <span className="block text-[26px] font-bold text-[var(--muted-foreground)]">Three problems, not one.</span>
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#D8CFF0]">
                  A boss wall at stage 7-4, five-minute ranked queues in APAC and OCE, and harassment of newcomers in the cross-play Raid Finder. The
                  churn and LTV models score every active player and explain why; the copilot sizes the loss and plans the fix that addresses it, inside
                  the October live-ops budget.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button data-testid="ask-why" onClick={() => dockController.newAndSend(OPENING_QUESTION)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-extrabold uppercase tracking-wide text-[#0A0714] shadow-[0_0_24px_-4px_rgb(182_255_59/0.7)]">
                    <Sparkles className="size-4" />Ask why retention dropped
                  </button>
                  <button onClick={() => dockController.newAndSend('Size the revenue at risk: how much LTV is at risk by churn driver and by region, and how many whales?')}
                    className="rounded-lg border border-[rgb(255_255_255/0.25)] px-4 py-2 text-sm font-bold uppercase tracking-wide text-[var(--brand-ink)] hover:bg-white/10">
                    Size the at-risk revenue
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0A0714]/70 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Cohort retention · D1 / D7 / D30</span>
                  <span className="flex gap-3 text-[11px] font-semibold">
                    <span className="text-[var(--brand-3)]">— — Season 6</span>
                    <span className="text-[var(--brand-2)]">— Season 7</span>
                  </span>
                </div>
                <div className="mt-2">{pre && post ? <CohortCurve pre={toNum(pre)} post={toNum(post)} /> : <Skeleton className="h-[200px] w-full bg-muted" />}</div>
                {matched && blanket && (
                  <div className="mt-3 rounded-lg border border-[rgb(182_255_59/0.35)] bg-[rgb(182_255_59/0.08)] p-3 text-sm">
                    <b className="text-[var(--primary)]">The aha:</b> driver-matched fixes lifted 14-day retention{' '}
                    <b>+{matched.avg_lift_pp} pts</b> at {usd(Number(matched.cost_per_retained))} per retained player. The blanket 50% gem sale:{' '}
                    <b>+{blanket.avg_lift_pp} pts</b> at {usd(Number(blanket.cost_per_retained))}.
                  </div>
                )}
              </div>
            </div>
          </section>

          {error && <div className="rounded-lg border border-[var(--brand-5)]/50 bg-[rgb(255_77_94/0.1)] p-3 text-sm text-[var(--brand-5)]">{error}</div>}

          {/* HUD */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {live && pre && post ? (
              <>
                <RetentionTile post={toNum(post)!} pre={toNum(pre)!} />
                <Stat label="ARPDAU" value={aPost ? `$${Number(aPost.arpdau).toFixed(3)}` : '—'} sub={aPre ? `was $${Number(aPre.arpdau).toFixed(3)} · DAU ${Number(aPost?.dau ?? 0).toLocaleString('en-US')}` : ''} tone="bad" />
                <Stat label="Players at risk" value={live.players_at_risk.toLocaleString('en-US')} sub={`${live.critical_players.toLocaleString('en-US')} critical · ${live.whales_at_risk} whales · next 14 days`} tone="bad" />
                <Stat label="LTV at risk · 12 mo" value={usdK(live.at_risk_ltv)} sub="churn probability × predicted LTV" tone="bad" />
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Live-ops budget · Oct</div>
                  <div className="mt-1 text-[26px] font-extrabold leading-none tabular-nums text-[var(--primary)]">{usdK(live.budget.remaining)}</div>
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${budgetLeftPct}%` }} /></div>
                  <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                    {live.budget.plansScheduled ? `${usdK(live.budget.committed)} committed · ${live.budget.plansScheduled} scheduled` : `of ${usdK(live.budget.budget)} · nothing scheduled`}
                  </div>
                </div>
              </>
            ) : (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px] bg-muted" />)
            )}
          </section>

          {/* Boss cards: churn drivers */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em]">Boss fights · at-risk players by top churn driver</h2>
              {driver && <button className="text-xs font-semibold text-[var(--primary)] underline" onClick={() => setDriver('')}>clear filter</button>}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              {(live?.drivers ?? []).map((x) => {
                const m = DRIVER_META[x.churn_driver];
                const Icon = ICON[x.churn_driver] ?? TrendingDown;
                const active = driver === x.churn_driver;
                return (
                  <button key={x.churn_driver} data-testid={`driver-${x.churn_driver}`} onClick={() => setDriver(active ? '' : x.churn_driver)}
                    className={`group relative overflow-hidden rounded-xl border bg-[var(--card)] p-4 text-left transition hover:-translate-y-0.5 ${active ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}>
                    <div className="absolute inset-x-0 top-0 h-1" style={{ background: m?.color }} />
                    <div className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4" style={{ color: m?.color }} />{m?.label}</div>
                    <div className="mt-2 text-[28px] font-extrabold leading-none tabular-nums">{usdK(x.at_risk)}</div>
                    <div className="mt-1 text-xs text-[var(--muted-foreground)]">{x.players.toLocaleString('en-US')} players · {x.whales} whale{x.whales === 1 ? '' : 's'}</div>
                    <div className="mt-3 h-2 rounded-full bg-[var(--muted)]"><div className="h-2 rounded-full" style={{ width: `${(x.at_risk / maxAtRisk) * 100}%`, background: m?.color, boxShadow: `0 0 12px ${m?.color}` }} /></div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Segment cards */}
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em]">Segments · ranked by LTV at risk</h2>
              <span className="text-xs text-[var(--muted-foreground)]">segment = top churn driver × region · players with ≥ 20% churn risk</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)} className="ml-auto rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs">
                <option value="">All regions</option>
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            {!rows && <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[170px] bg-muted" />)}</div>}
            {rows && rows.length === 0 && <div className="rounded-xl border border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">No segments match these filters.</div>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rows?.map((s) => {
                const ev = s.evidence[0];
                const m = DRIVER_META[s.churnDriver] ?? DRIVER_META.engagement;
                return (
                  <button key={s.segmentId} data-testid="segment-row" data-segment={s.segmentId} onClick={() => setSelected(s.segmentId)}
                    className={`flex flex-col rounded-xl border bg-[var(--card)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--brand-2)] ${selected === s.segmentId ? 'border-[var(--brand-2)] shadow-[0_0_30px_-8px_rgb(255_43_214/0.6)]' : 'border-[var(--border)]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <DriverChip driver={s.churnDriver} />
                      <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">{s.region}</span>
                    </div>
                    <div className="mt-3 text-[15px] font-bold leading-snug">{s.segmentName}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{s.segmentId} · {s.criticalPlayers} critical · {s.newPlayersAtRisk} new players</div>
                    <div className="mt-3 text-xs">{ev ? <><span className={ev.bad ? 'font-bold text-[var(--brand-5)]' : 'font-bold'}>{ev.value}</span> <span className="text-[var(--muted-foreground)]">{ev.label}</span></> : <span className="text-[var(--muted-foreground)]">no evidence</span>}</div>
                    <div className="mt-auto pt-4">
                      <div className="flex items-end justify-between">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">LTV at risk</div>
                          <div className="text-2xl font-extrabold tabular-nums" style={{ color: m.color }}>{usd(s.atRiskLtv)}</div>
                        </div>
                        <div className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                          {s.playersAtRisk.toLocaleString('en-US')} players<br />{s.payersAtRisk} payers · {s.whalesAtRisk} whales
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <div className="flex flex-1 items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-[var(--muted)]"><div className="h-1.5 rounded-full bg-[var(--brand-5)]" style={{ width: `${Math.min(100, s.avgChurnProbability * 100)}%` }} /></div>
                          <span className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">{pct(s.avgChurnProbability)} risk</span>
                        </div>
                        <StatusChip status={s.status} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Live-ops calendar */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.14em]"><CalendarDays className="size-4 text-[var(--brand-3)]" />Live-ops calendar</div>
            {calendar.length === 0 ? (
              <div className="text-sm text-[var(--muted-foreground)]">Nothing staged yet. Open a segment and ask the copilot for a plan; staged events land here with their start date.</div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {calendar.map((s) => (
                  <button key={s.segmentId} onClick={() => setSelected(s.segmentId)}
                    className="min-w-[230px] rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-3 text-left hover:border-[var(--brand-3)]">
                    <div className="font-mono text-[11px] font-bold uppercase text-[var(--brand-3)]">{s.stagedPlan!.startDate}</div>
                    <div className="mt-1 text-sm font-bold leading-snug">{s.stagedPlan!.interventionName}</div>
                    <div className="mt-1 text-xs text-[var(--muted-foreground)]">{s.segmentName} · {usdK(s.stagedPlan!.cost)} · {usdK(s.stagedPlan!.expectedLtvRetained)} LTV back</div>
                    <div className="mt-2"><StatusChip status={s.status} /></div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      {selected && <SegmentPanel segmentId={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}
