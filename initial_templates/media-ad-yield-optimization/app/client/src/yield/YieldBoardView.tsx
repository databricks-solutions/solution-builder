/**
 * Yield board — every programmatic product (Crest+ streaming + FAST), last 28 days:
 * programmatic eCPM vs rate card vs open-auction clearing, sell-through, the floor group the ad
 * server applies vs the one the rate card assigns, and the revenue left on the table. Selecting a
 * product shows its weekly eCPM trend, the floor rule in force and a write-back action that queues
 * the floor-group restore for ad ops (Lakebase).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Tags } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { HERO_CAMPAIGN, HERO_PRODUCT, cpm, fetchOpportunities, imps, moneyK, pct, restoreFloor, type Opportunity } from '@/yield/api';
import { Kpi, Pill, cn } from '@/yield/ui';

function EcpmChart({ o }: { o: Opportunity }) {
  const rows = o.weekly;
  if (!rows.length) return null;
  const W = 640, H = 220, L = 40, B = 26, T = 10;
  const max = Math.ceil(Math.max(o.rateCardCpm ?? 0, ...rows.map((r) => Math.max(r.programmatic_ecpm, r.open_clearing ?? 0))) / 10) * 10;
  const x = (i: number) => L + (i * (W - L - 10)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (vals: Array<number | null>) => vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${x(i)},${y(v)}`)).join(' ');
  const change = rows.findIndex((r, i) => i > 0 && r.group !== rows[i - 1].group);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, max / 4, max / 2, (3 * max) / 4, max].map((v) => (
        <g key={v}><line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">${v}</text></g>
      ))}
      {o.rateCardCpm != null && <><line x1={L} x2={W - 10} y1={y(o.rateCardCpm)} y2={y(o.rateCardCpm)} stroke="var(--brand-4)" strokeDasharray="5 4" strokeWidth="1.5" /><text x={W - 12} y={y(o.rateCardCpm) - 4} textAnchor="end" fontSize="10" fill="var(--brand-4)">rate card {cpm(o.rateCardCpm)}</text></>}
      {change > 0 && <><line x1={x(change) - 0.5 * (x(1) - x(0))} x2={x(change) - 0.5 * (x(1) - x(0))} y1={T} y2={H - B} stroke="var(--brand-5)" strokeDasharray="3 3" /><text x={x(change) - 0.5 * (x(1) - x(0)) + 4} y={T + 10} fontSize="10" fill="var(--brand-5)">{o.currentRuleId} → {rows[change].group}</text></>}
      <path d={line(rows.map((r) => r.open_clearing))} fill="none" stroke="var(--brand-3)" strokeWidth="2.5" />
      <path d={line(rows.map((r) => r.programmatic_ecpm))} fill="none" stroke="var(--brand-5)" strokeWidth="3" />
      {rows.map((r, i) => i % 3 === 0 && (
        <text key={r.week} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{new Date(`${r.week.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>
      ))}
    </svg>
  );
}

export function YieldBoardView() {
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [sel, setSel] = useState<string>(HERO_PRODUCT);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetchOpportunities().then((r) => setRows([...r].sort((a, b) => Number(b.isLeak) - Number(a.isLeak) || (a.programmaticEcpm28d ?? 0) / (a.rateCardCpm ?? 1) - (b.programmaticEcpm28d ?? 0) / (b.rateCardCpm ?? 1)))).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);
  useEffect(() => dataMutated.subscribe(load), []);
  const o = rows?.find((r) => r.productId === sel) ?? rows?.[0];

  const restore = async () => {
    if (!o) return;
    setSaving(true);
    try {
      await restoreFloor(o.productId);
      await load();
      dataMutated.emit();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Programmatic pricing · last 28 days</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Yield board</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">Every Crest+ streaming and FAST product that is sold programmatically, with what it earns against its rate card and against what the open auction would pay. Rows in red are priced in the wrong floor group.</p>
        </div>
        {err && <div className="text-sm text-[var(--destructive)]">{err}</div>}
        <div className="grid gap-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>{['Product', 'Rate card', 'Prog. eCPM', '% of card', 'Open auction', 'Sell-through', 'Floor group in force', 'Left on table 28d'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {!rows && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={8} className="px-3 py-2"><div className="h-6 rounded bg-[var(--muted)] animate-pulse" /></td></tr>)}
                {rows?.map((r) => (
                  <tr key={r.productId} onClick={() => setSel(r.productId)} data-product={r.productId}
                    className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/60', r.isLeak && 'bg-[rgb(255_77_94/0.09)]', o?.productId === r.productId && 'outline outline-2 -outline-offset-2 outline-[var(--primary-light)]')}>
                    <td className="px-3 py-2"><div className="font-medium">{r.productName}</div><div className="text-[11px] text-[var(--muted-foreground)]">{r.platform} · {r.tier}</div></td>
                    <td className="px-3 py-2 tabular-nums">{cpm(r.rateCardCpm)}</td>
                    <td className={cn('px-3 py-2 tabular-nums font-semibold', r.isLeak && 'text-[var(--brand-5)]')}>{cpm(r.programmaticEcpm28d)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct((r.programmaticEcpm28d ?? 0) / (r.rateCardCpm ?? 1))}</td>
                    <td className="px-3 py-2 tabular-nums">{cpm(r.openClearing28d)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(r.sellThrough28d)}</td>
                    <td className="px-3 py-2">{r.groupMismatch ? <Pill tone="bad"><AlertTriangle className="size-3" />{r.currentGroup} (card: {r.rateCardGroup})</Pill> : <Pill tone="neutral">{r.currentGroup}</Pill>}</td>
                    <td className={cn('px-3 py-2 tabular-nums', (r.revenueGap28d ?? 0) > 0 && 'font-semibold text-[var(--brand-5)]')}>{(r.revenueGap28d ?? 0) > 0 ? moneyK(r.revenueGap28d) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {o && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{o.productName}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{o.platform} · {o.contentCategory} · {o.tier} · rate card {cpm(o.rateCardCpm)}</div>
                  </div>
                  {o.isLeak ? <Pill tone="bad">mis-priced</Pill> : <Pill tone="good">priced to card</Pill>}
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  <span className="font-semibold text-[var(--brand-5)]">● Programmatic eCPM</span>
                  <span className="font-semibold text-[var(--brand-3)]">● Open-auction clearing</span>
                  <span className="font-semibold text-[var(--brand-4)]">- - Rate card</span>
                </div>
                <EcpmChart o={o} />
                <div className="grid grid-cols-3 gap-2">
                  <Kpi label="Guaranteed" value={pct(o.guaranteedShare28d)} sub="of avails" />
                  <Kpi label="PMP deals" value={pct(o.pmpShare28d)} sub={`at ${cpm(o.pmpEcpm28d)}`} tone={o.isLeak ? 'bad' : undefined} />
                  <Kpi label="Open auction" value={pct(o.openShare28d)} sub={`clears ${cpm(o.openClearing28d)}`} />
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 font-semibold"><Tags className="size-4 text-[var(--primary-light)]" />Floor rule in force</div>
                <div className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
                  <span className="text-[var(--muted-foreground)]">Rule</span><span><b>{o.currentRuleId}</b> since {o.currentRuleSince} · {o.changeTicket}</span>
                  <span className="text-[var(--muted-foreground)]">Changed by</span><span>{o.currentRuleChangedBy}</span>
                  <span className="text-[var(--muted-foreground)]">Floor group</span><span>{o.currentGroup} · {cpm(o.currentFloor)} floor{o.groupMismatch && <> — the rate card says <b>{o.rateCardGroup}</b> ({cpm(o.rateCardGroupFloor)})</>}</span>
                  <span className="text-[var(--muted-foreground)]">Note</span><span className="text-[var(--foreground)]/80">{o.changeNote}</span>
                  <span className="text-[var(--muted-foreground)]">Open bids</span><span>median {cpm(o.p50Bid28d)} · p90 {cpm(o.p90Bid28d)} · expected fill {pct(o.fillRetention)}</span>
                </div>
                {o.groupMismatch && (
                  <div className="rounded-lg border border-[rgb(255_77_94/0.35)] bg-[rgb(255_77_94/0.09)] px-3 py-2 text-xs text-[var(--brand-ink)]">
                    Programmatic eCPM fell from <b>{cpm(o.programmaticEcpmBeforeRule)}</b> to <b>{cpm(o.programmaticEcpm28d)}</b> after {o.currentRuleId}: {imps(o.pmpImpressions28d)} impressions in 28 days went to the run-of-network PMP at {cpm(o.pmpEcpm28d)} while the open auction clears at {cpm(o.openClearing28d)}.
                    <b> {moneyK(o.revenueGapSinceRule)}</b> left on the table since the change, <b>{moneyK(o.revenueGap28d)}</b> in the last 28 days.
                  </div>
                )}
                {o.groupMismatch && (o.floorChangeId ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-xs text-[var(--success-subtle-foreground)]" data-testid="floor-change-done">
                    <CheckCircle2 className="size-4" />Floor change <b>{o.floorChangeId}</b> queued for ad ops — <Link to="/plans" className="underline">Yield actions</Link>
                  </div>
                ) : (
                  <button onClick={restore} disabled={saving} data-testid="restore-floor"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-60">
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Tags className="size-3.5" />}Restore {o.recommendedGroup} ({cpm(o.recommendedFloor)} floor) &amp; release from the RON PMP
                  </button>
                ))}
                {o.productId === HERO_PRODUCT && (
                  <Link to={`/campaigns/${HERO_CAMPAIGN}`} className="flex items-center gap-1 text-xs text-[var(--primary-light)] hover:underline">
                    This inventory has the best Auto-Intender reach — use it for the Summit Motors make-good <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
