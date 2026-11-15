/**
 * Retained-revenue what-if: how much revenue does the desk keep if it contacts X% of
 * the worked tiers with (a) the driver-matched next-best offer inside the guardrail vs
 * (b) the legacy blanket 20% discount? Computed server-side (/api/whatif) from the live
 * case book + historical save rates by driver x offer.
 */
import { useEffect, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { fetchWhatIf, usd, usdK, type WhatIf, type WhatIfSide } from '@/lib/desk';

function Side({ title, s, accent, other }: { title: string; s: WhatIfSide; accent: string; other: WhatIfSide }) {
  const rows: Array<[string, string, boolean]> = [
    ['Expected saves', s.expected_saves.toLocaleString(), s.expected_saves >= other.expected_saves],
    ['Retained revenue (12 mo)', usdK(s.retained_revenue), s.retained_revenue >= other.retained_revenue],
    ['Offer spend', usdK(s.offer_spend), s.offer_spend <= other.offer_spend],
    ['Net margin impact', usdK(s.net_margin_impact), s.net_margin_impact >= other.net_margin_impact],
    ['Guardrail breaches', s.guardrail_breaches.toLocaleString(), s.guardrail_breaches <= other.guardrail_breaches],
  ];
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm" style={{ borderTop: `4px solid ${accent}` }}>
      <h3 className="font-semibold">{title}</h3>
      <dl className="mt-3 space-y-2">
        {rows.map(([k, v, win]) => (
          <div key={k} className="flex items-baseline justify-between">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${win ? 'text-[#C8106B]' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 text-xs font-medium text-muted-foreground">Offer mix (accounts contacted)</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {s.offer_mix.map((m) => <span key={m.code} className="rounded bg-muted px-2 py-0.5 text-xs">{m.code} · {m.accounts}</span>)}
      </div>
    </div>
  );
}

export function WhatIfView() {
  const [tiers, setTiers] = useState(['Critical', 'High']);
  const [contact, setContact] = useState(0.6);
  const [data, setData] = useState<WhatIf | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchWhatIf(tiers, contact).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [tiers, contact]);

  const toggle = (t: string) => setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const delta = data ? data.matched.retained_revenue - data.blanket.retained_revenue : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Retained-revenue what-if</h1>
          <p className="text-sm text-muted-foreground">Same accounts, same contact capacity — the only change is which offer the desk makes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-6 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Tiers worked</span>
            {['Critical', 'High', 'Medium'].map((t) => (
              <button key={t} onClick={() => toggle(t)} className={`rounded-full border px-3 py-1 text-xs ${tiers.includes(t) ? 'bg-primary text-primary-foreground' : ''}`}>{t}</button>
            ))}
          </div>
          <label className="flex flex-1 items-center gap-3 text-sm">
            <span className="whitespace-nowrap text-muted-foreground">Contact rate</span>
            <input data-testid="contact-rate" type="range" min={0.1} max={1} step={0.05} value={contact} onChange={(e) => setContact(Number(e.target.value))} className="flex-1 accent-[#C8106B]" />
            <span className="w-12 text-right font-semibold tabular-nums">{Math.round(contact * 100)}%</span>
          </label>
        </div>
        {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {!data ? <Skeleton className="h-72 bg-muted" /> : (
          <>
            <div className="rounded-xl bg-[#C8106B] p-5 text-white">
              <div className="text-sm text-[#FCE4F1]">Driver-matched offers keep an extra</div>
              <div className="text-4xl font-semibold">{usdK(delta)} <span className="text-lg font-normal">of annual revenue</span></div>
              <div className="mt-1 text-sm text-[#FCE4F1]">
                contacting {data.matched.contacted.toLocaleString()} of {data.matched.accounts.toLocaleString()} accounts, while spending{' '}
                {usd(data.blanket.offer_spend - data.matched.offer_spend)} less on offers and breaching the margin guardrail {data.matched.guardrail_breaches} times (vs {data.blanket.guardrail_breaches.toLocaleString()}).
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Side title="Copilot — driver-matched, within guardrail" s={data.matched} other={data.blanket} accent="#C8106B" />
              <Side title="Legacy — blanket 20% discount (DISC-20)" s={data.blanket} other={data.matched} accent="#94A3B8" />
            </div>
            <p className="text-xs text-muted-foreground">Expected saves = contact rate × 90-day churn probability (from the 30-day model score) × historical save rate of the chosen offer for the account's top driver (retention_offer_history). Net margin impact = retained revenue × 58% gross margin − expected offer spend.</p>
          </>
        )}
      </div>
    </div>
  );
}
