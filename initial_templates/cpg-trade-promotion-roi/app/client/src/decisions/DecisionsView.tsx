/**
 * Decisions — the write-back log: every approved re-plan the copilot (or a planner) wrote to
 * Lakebase (app.plan_decisions), with before/after forecast and the retailer notice to send.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ClipboardCheck, Database, Send } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchDecisions, moneyK, pct, signedK, unitsK, weekLabel, type PlanDecision } from '@/lib/promo';
import { Card, Kpi, Pill } from '@/lib/ui';

export function DecisionsView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<PlanDecision[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchDecisions().then(setRows).catch(() => setRows([])); }, [tick]);
  const live = (rows ?? []).filter((d) => d.toScenarioKey !== 'as_planned');
  const sum = (f: (d: PlanDecision) => number) => live.reduce((a, d) => a + f(d), 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <div>
          <h1 className="font-display text-3xl font-semibold">Approved re-plans</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            The promo-plan system of record (TPG-2027 §5.3): every change is one Lakebase transaction that swaps the planned event's tactic and
            logs the before/after forecast, the approver and the notice for the retailer's buyer.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Events re-planned" value={rows ? live.length : '…'} />
          <Kpi label="Net profit swing" value={rows ? signedK(sum((d) => (d.toNetProfit ?? 0) - (d.fromNetProfit ?? 0))) : '…'} tone="good" />
          <Kpi label="Trade spend change" value={rows ? signedK(sum((d) => (d.toTradeSpend ?? 0) - (d.fromTradeSpend ?? 0))) : '…'} />
          <Kpi label="Net volume change" value={rows ? `${sum((d) => (d.toVolume ?? 0) - (d.fromVolume ?? 0)) >= 0 ? '+' : ''}${unitsK(sum((d) => (d.toVolume ?? 0) - (d.fromVolume ?? 0)))} units` : '…'} sub="after the pantry-loading dip" />
        </div>
        <Card title="Decision log" icon={<Database className="size-4 text-[var(--primary-light)]" />}>
          {!rows ? <div className="h-32 animate-pulse rounded-xl bg-[var(--muted)]" /> : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--muted-foreground)]">
              <ClipboardCheck className="size-8 opacity-60" />
              No re-plans yet. Ask the copilot which events will lose money, then approve its re-plan.
              <button onClick={() => nav('/')} className="mt-1 text-xs text-[var(--primary-light)] hover:underline">Back to the promo calendar →</button>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((d) => (
                <div key={d.id} className="rounded-xl border border-[var(--border)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">{d.id} · {d.planEventId} · {d.retailerName} · {d.productName}</div>
                    <div className="flex items-center gap-2"><Pill tone="info">via {d.via}</Pill><span className="text-xs text-[var(--muted-foreground)]">{new Date(d.createdAt).toLocaleString()}</span></div>
                  </div>
                  <div className="mt-1 text-sm">
                    Week of {weekLabel(d.startWeek)}: <span className="line-through opacity-70">{d.fromLabel}</span> → <b>{d.toLabel}</b>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded-lg bg-[var(--muted)] px-3 py-2">Net profit<div className="text-sm font-semibold tabular-nums">{moneyK(d.fromNetProfit)} → {moneyK(d.toNetProfit)}</div></div>
                    <div className="rounded-lg bg-[var(--muted)] px-3 py-2">ROI<div className="text-sm font-semibold tabular-nums">{pct(d.fromRoi)} → {pct(d.toRoi)}</div></div>
                    <div className="rounded-lg bg-[var(--muted)] px-3 py-2">Trade spend<div className="text-sm font-semibold tabular-nums">{moneyK(d.fromTradeSpend)} → {moneyK(d.toTradeSpend)}</div></div>
                    <div className="rounded-lg bg-[var(--muted)] px-3 py-2">Net volume kept<div className="text-sm font-semibold tabular-nums">{unitsK(d.fromVolume)} → {unitsK(d.toVolume)}</div></div>
                  </div>
                  {d.rationale && <div className="mt-2 text-xs text-[var(--muted-foreground)]">Rationale: {d.rationale}</div>}
                  {d.retailerNotice && <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--info-subtle)] px-3 py-2 text-xs text-[var(--info-subtle-foreground)]"><Send className="mt-0.5 size-3.5 shrink-0" />{d.retailerNotice}</div>}
                  <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">Approved by {d.approvedBy}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
