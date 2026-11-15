/**
 * Retention Desk — the agent's home screen, built like a call-centre retention console.
 * Top: the churn story (monthly churn trend + the driver-matched vs blanket aha).
 * Left: the caller queue, ranked by revenue at risk, filterable by tier, SHAP driver and region.
 * Right: the selected caller — subscriber 360, risk drivers, last care call, and the offer desk.
 * Refreshes on `dataMutated` (the agent staged an offer / a decision landed).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { PhoneCall, Sparkles } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { DRIVER_META, fetchCases, fetchKpis, pct, usd, usdK, type CaseSummary, type Kpis } from '@/lib/desk';
import { CasePanel } from './CasePanel';
import { DriverChip, StatusChip, TierBadge } from './chips';

const REGIONS = ['Southwest', 'Texas', 'Southeast', 'Midwest', 'Northeast', 'West'];
const TIERS = [
  { v: 'Critical', label: 'Critical' },
  { v: 'Critical,High', label: 'Critical + High' },
  { v: 'Critical,High,Medium', label: 'All worked' },
];

function Sparkline({ values, highlightFrom }: { values: number[]; highlightFrom: number }) {
  if (values.length < 2) return null;
  const w = 240, h = 60, max = Math.max(...values) * 1.1, min = Math.min(...values) * 0.8;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <rect x={x(highlightFrom) - 6} y={0} width={w - x(highlightFrom) + 12} height={h} rx={8} fill="#C8106B" opacity={0.08} />
      <polyline points={pts} fill="none" stroke="#C8106B" strokeWidth={2.5} strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i >= highlightFrom ? 3.5 : 2} fill={i >= highlightFrom ? '#FF5A3C' : '#C8106B'} />
      ))}
    </svg>
  );
}

export function DeskView() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState('Critical,High');
  const [driver, setDriver] = useState('');
  const [region, setRegion] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    const p: Record<string, string> = { tier, limit: '150' };
    if (driver) p.driver = driver;
    if (region) p.region = region;
    Promise.all([fetchKpis(), fetchCases(p)])
      .then(([k, c]) => { setKpis(k); setCases(c); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [tier, driver, region]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => dataMutated.subscribe(load), [load]);
  // Open the top of the queue by default so the desk is never an empty pane.
  useEffect(() => {
    if (!selected && cases && cases.length) setSelected(cases[0].customerId);
  }, [cases, selected]);

  const trend = useMemo(() => (kpis?.lake.trend ?? []).map((t) => Number(t.churn_rate_pct)), [kpis]);
  const latest = trend.at(-1) ?? 0;
  const baseline = trend.length > 4 ? trend.slice(0, 9).reduce((a, b) => a + b, 0) / 9 : 0;
  const strat = kpis?.lake.strategy ?? [];
  const matched = strat.find((s) => s.offer_strategy.startsWith('Driver'));
  const blanket = strat.find((s) => s.offer_strategy.startsWith('Blanket'));
  const d = kpis?.desk;
  const decided = (d?.accepted ?? 0) + (d?.declined ?? 0);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-[1480px] space-y-5 p-6">
        {/* ── Story ──────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-5 rounded-3xl bg-card p-6 shadow-sm lg:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#FCE4F1] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#8A0D4F]">
              <PhoneCall className="size-3.5" />Veridian Mobile · Retention desk · Sep 30, 2026
            </div>
            <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.1] tracking-tight">
              Postpaid churn is up <span className="text-[#C8106B]">{baseline ? `${Math.round(((latest - baseline) / baseline) * 100)}%` : '—'}</span> since July.
              <br />It's three problems, not one.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              A 5G core migration degraded 5 Southwest sites, the Switch &amp; Save promo is rolling off, and Crest Wireless launched $25/line in
              8 markets. The churn model explains <em>why</em> each caller might leave; the copilot picks the offer that fixes that reason,
              inside the margin guardrail.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="flex items-center gap-1.5 rounded-full bg-[#C8106B] px-4 py-2 text-sm font-bold text-white shadow hover:bg-[#A10B57]"
                onClick={() => dockController.newAndSend('Why is postpaid churn up since July, and which driver costs us the most revenue?')}>
                <Sparkles className="size-4" />Ask why churn is up
              </button>
              <button className="rounded-full border-2 border-[#EBDDE6] px-4 py-2 text-sm font-bold hover:border-[#C8106B]/40"
                onClick={() => dockController.newAndSend('Who are the 5 critical accounts I should call first in the Southwest?')}>
                Who do I call first?
              </button>
            </div>
          </div>
          <div className="rounded-2xl bg-[#FBF6F9] p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-muted-foreground">Monthly postpaid churn</span>
              <span className="font-display text-3xl font-extrabold">{latest ? `${latest.toFixed(2)}%` : '—'}</span>
            </div>
            <div className="mt-2 rounded-xl bg-card p-2">
              {trend.length ? <Sparkline values={trend} highlightFrom={9} /> : <Skeleton className="h-[60px] w-[240px] bg-muted" />}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Oct 2025 → Sep 2026 · baseline {baseline.toFixed(2)}%/mo before July</div>
            {matched && blanket && (
              <div className="mt-3 rounded-xl bg-[#FDE2EE] p-3 text-sm text-[#5C0A3A]">
                <b>The aha:</b> driver-matched offers saved <b>{matched.save_rate_pct}%</b> of at-risk customers vs <b>{blanket.save_rate_pct}%</b> for
                the blanket 20% discount, at {usd(Number(matched.avg_cost))} vs {usd(Number(blanket.avg_cost))} per offer (Aug–Sep pilot).
              </div>
            )}
          </div>
        </section>

        {error && <div className="rounded-2xl border border-[#F5B5C0] bg-[#FFF1F3] p-3 text-sm text-[#9B1C2E]">{error}</div>}

        {/* ── Desk KPIs ──────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {d ? (
            <>
              <Kpi label="Critical accounts" value={d.critical.toLocaleString()} sub={`+ ${d.high.toLocaleString()} high · ${d.medium.toLocaleString()} medium`} tone="bad" />
              <Kpi label="Revenue at risk, 12 mo" value={usdK(d.revenue_at_risk)} sub={`probability-weighted · ARPU book ${usdK(d.arpu_book_at_risk)}`} tone="bad" />
              <Kpi label="Offers staged" value={String(d.offers_ready)} sub="drafted by the copilot, awaiting the customer" />
              <Kpi label="Desk save rate" value={decided ? pct(d.accepted / decided) : '—'} sub={`${d.accepted} accepted · ${d.declined} declined`} tone="good" />
              <Kpi label="Revenue saved" value={usdK(d.revenue_saved)} sub={`offer spend ${usd(d.offer_spend)} · written back to Delta`} tone="good" />
            </>
          ) : (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl bg-muted" />)
          )}
        </section>

        {/* ── Desk: queue + case ─────────────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="flex min-h-[600px] flex-col rounded-3xl bg-card shadow-sm xl:max-h-[calc(100vh-180px)]">
            <div className="space-y-3 border-b border-[#F0E4EB] p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-lg font-extrabold">Caller queue</h2>
                <span className="text-xs text-muted-foreground">by revenue at risk</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TIERS.map((t) => (
                  <button key={t.v} onClick={() => setTier(t.v)}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${tier === t.v ? 'bg-[#C8106B] text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(d?.drivers ?? []).map((x) => {
                  const m = DRIVER_META[x.top_driver];
                  const on = driver === x.top_driver;
                  return (
                    <button key={x.top_driver} onClick={() => setDriver(on ? '' : x.top_driver)}
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition"
                      style={{ background: on ? m?.color : `${m?.color}1A`, color: on ? '#fff' : m?.color }}>
                      {m?.short} · {usdK(x.at_risk)}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <select value={region} onChange={(e) => setRegion(e.target.value)} className="w-full rounded-xl border border-[#EBDDE6] bg-background px-3 py-1.5 text-xs font-semibold">
                  <option value="">All regions</option>
                  {REGIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                {driver && <button className="shrink-0 text-xs font-bold text-[#C8106B] underline" onClick={() => setDriver('')}>clear</button>}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
              {!cases && Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-2xl bg-muted" />)}
              {cases?.map((c) => {
                const on = selected === c.customerId;
                const initials = c.customerName.split(' ').map((p) => p[0]).slice(0, 2).join('');
                return (
                  <button key={c.customerId} data-testid="case-row" onClick={() => setSelected(c.customerId)}
                    className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${on ? 'bg-[#FDE2EE] ring-2 ring-[#C8106B]/40' : 'hover:bg-muted'}`}>
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${on ? 'bg-[#C8106B] text-white' : 'bg-muted text-foreground'}`}>{initials}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold">{c.customerName}</span>
                        <TierBadge tier={c.riskTier} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                        <DriverChip driver={c.topDriver} /><span className="truncate">{c.market} · {c.lines} lines</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-display text-base font-extrabold tabular-nums text-[#C8106B]">{pct(c.churnProbability, 1)}</div>
                      <div className="text-[10px] font-semibold text-muted-foreground">{usdK(c.annualRevenueAtRisk)} at risk</div>
                      <div className="mt-0.5"><StatusChip status={c.status} /></div>
                    </div>
                  </button>
                );
              })}
              {cases && cases.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No callers match these filters.</div>}
            </div>
          </section>

          {selected ? (
            <CasePanel customerId={selected} onChanged={load} />
          ) : (
            <div className="flex min-h-[400px] items-center justify-center rounded-3xl bg-card text-sm text-muted-foreground shadow-sm">Pick a caller from the queue.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-3xl font-extrabold ${tone === 'bad' ? 'text-[#C8106B]' : tone === 'good' ? 'text-[#13835B]' : ''}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
