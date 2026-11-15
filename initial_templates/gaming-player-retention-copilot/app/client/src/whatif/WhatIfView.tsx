/**
 * Budget what-if: with $X of live-ops budget, what does the copilot's driver-matched plan
 * (largest net value first, picked greedily inside the budget) keep, vs the legacy
 * blanket 50% gem sale? Computed server-side (/api/whatif) by the same plan engine the agent uses.
 */
import { useEffect, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { fetchWhatIf, usd, usdK, type WhatIf } from '@/lib/liveops';

function Row({ k, v, win }: { k: string; v: string; win?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${win ? 'text-[#B6FF3B]' : ''}`}>{v}</dd>
    </div>
  );
}

export function WhatIfView() {
  const [budget, setBudget] = useState(12000);
  const [data, setData] = useState<WhatIf | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchWhatIf(budget).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [budget]);

  const c = data?.copilot, b = data?.blanket;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Live-ops budget what-if</h1>
          <p className="text-sm text-muted-foreground">Same at-risk players, same budget — the only change is what live ops does with it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-6 rounded-xl border bg-card p-4">
          <label className="flex flex-1 items-center gap-3 text-sm">
            <span className="whitespace-nowrap text-muted-foreground">Monthly live-ops budget</span>
            <input data-testid="budget" type="range" min={2000} max={30000} step={1000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="flex-1 accent-[var(--brand-2)]" />
            <span className="w-20 text-right font-semibold tabular-nums">{usdK(budget)}</span>
          </label>
        </div>
        {error && <div className="rounded border border-red-300 bg-[rgb(255_77_94/0.1)] p-3 text-sm text-[var(--brand-5)]">{error}</div>}
        {!data || !c ? <Skeleton className="h-72 bg-muted" /> : (
          <>
            <div className="rounded-xl border border-[rgb(255_43_214/0.35)] bg-[radial-gradient(120%_140%_at_0%_0%,#4A0F5C_0%,#1A0B33_70%)] p-5 text-white">
              <div className="text-sm text-[#D8CFF0]">The copilot's driver-matched plan keeps</div>
              <div className="text-4xl font-semibold">{usdK(c.ltv_retained)} <span className="text-lg font-normal">of the {usdK(data.at_risk_ltv)} LTV at risk</span></div>
              <div className="mt-1 text-sm text-[#D8CFF0]">
                spending {usd(c.spend)} ({c.roi}x ROI) across {c.segments_covered} segments
                {b && <> — the blanket gem sale would cost {usd(b.spend)}{!b.affordable ? ' (over this budget)' : ''} and keep {usdK(b.ltv_retained)} ({b.roi}x).</>}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-card p-5 shadow-sm" style={{ borderTop: '4px solid #B6FF3B' }}>
                <h3 className="font-semibold">Copilot — driver-matched, within budget</h3>
                <dl className="mt-3 space-y-2">
                  <Row k="LTV retained (12 mo)" v={usdK(c.ltv_retained)} win={!b || c.ltv_retained >= b.ltv_retained} />
                  <Row k="Players retained" v={c.players_retained.toLocaleString('en-US')} win={!b || c.players_retained >= b.players_retained} />
                  <Row k="Spend" v={usd(c.spend)} win={!b || c.spend <= b.spend} />
                  <Row k="ROI" v={`${c.roi}x`} win={!b || c.roi >= b.roi} />
                </dl>
                <div className="mt-4 text-xs font-medium text-muted-foreground">Plan (largest net value first)</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {c.plan.map((p) => (
                    <li key={p.code + p.segments} className="flex justify-between gap-2 rounded bg-muted px-2 py-1">
                      <span><b>{p.code}</b> · {p.segments}</span><span className="tabular-nums">{usdK(p.cost)} → {usdK(p.ltv)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {b && (
                <div className="rounded-xl border bg-card p-5 shadow-sm" style={{ borderTop: '4px solid #94A3B8' }}>
                  <h3 className="font-semibold">Legacy — blanket 50% gem sale (GEM-SALE-50)</h3>
                  <dl className="mt-3 space-y-2">
                    <Row k="LTV retained (12 mo)" v={usdK(b.ltv_retained)} win={b.ltv_retained > c.ltv_retained} />
                    <Row k="Players retained" v={b.players_retained.toLocaleString('en-US')} win={b.players_retained > c.players_retained} />
                    <Row k="Spend (cannibalized gem revenue)" v={usd(b.spend)} />
                    <Row k="ROI" v={`${b.roi}x`} />
                  </dl>
                  <p className="mt-4 text-xs text-muted-foreground">{b.affordable ? 'Fits this budget, ' : 'Does not fit this budget, '}and it hits every player — including the {b.segments_covered} segments whose problem is a boss, a queue or harassment, not price.</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">LTV retained = holdout-measured retention lift of the intervention (liveops_history, Seasons 3–6) × the predicted 12-month LTV of the players it covers (player_ltv_model), capped at the at-risk LTV. A global patch covers every segment with the same driver; its fixed cost is paid once.</p>
          </>
        )}
      </div>
    </div>
  );
}
