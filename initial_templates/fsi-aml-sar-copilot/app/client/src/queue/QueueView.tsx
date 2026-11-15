import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowUpRight, Network, Sparkles, TrendingUp } from 'lucide-react';
import { getJson, usd, type Json } from '@/lib/api';
import { DecisionBadge, Kpi, RiskBar } from '@/ops/Badges';

export function QueueView() {
  const [rows, setRows] = useState<Json[] | null>(null);
  const [kpi, setKpi] = useState<Json | null>(null);
  const [sort, setSort] = useState<'ml' | 'rules'>('ml');
  const [openOnly, setOpenOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    Promise.all([getJson<{ alerts: Json[] }>('/api/queue'), getJson('/api/kpis')])
      .then(([q, k]) => { setRows(q.alerts); setKpi(k); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const hotNetwork = useMemo(() => {
    if (!rows) return null;
    const by: Record<string, Json[]> = {};
    rows.filter((r) => Number(r.cluster_size) >= 3 && Number(r.ml_risk_score) >= 70).forEach((r) => (by[r.cluster_id] ??= []).push(r));
    const best = Object.entries(by).sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) return null;
    const cid = best[0];
    // Describe the WHOLE network case (every open alert on it), not only its ML-critical subset.
    const list = rows.filter((r) => r.cluster_id === cid);
    const avgRules = Math.round(list.reduce((s, r) => s + Number(r.rules_rank), 0) / list.length);
    const worstMl = Math.max(...list.map((r) => Number(r.ml_rank)));
    const parties = new Set(list.map((r) => r.customer_id)).size;
    return { cid, n: list.length, avgRules, worstMl, parties, size: list[0].cluster_size, first: list.sort((a, b) => a.ml_rank - b.ml_rank)[0] };
  }, [rows]);

  const view = useMemo(() => {
    if (!rows) return [];
    const r = rows.filter((x) => !openOnly || !x.decision || x.decision === 'escalate');
    return [...r].sort((a, b) => (sort === 'ml' ? a.ml_rank - b.ml_rank : a.rules_rank - b.rules_rank || a.ml_rank - b.ml_rank));
  }, [rows, sort, openOnly]);

  return (
    <div className="px-8 py-6 space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl">Alert queue</h1>
          <p className="text-sm text-muted-foreground">
            Transaction-monitoring alerts awaiting triage — ranked by the <span className="font-medium text-foreground">ML alert-risk model</span> (probability the alert ends in a SAR), trained on 12 months of investigator dispositions.
          </p>
        </div>
      </header>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-5 gap-3">
        <Kpi label="Open alerts" value={kpi?.open_alerts ?? '…'} sub={kpi ? `${kpi.decided} decided via Copilot` : undefined} />
        <Kpi label="ML critical (≥ 70)" value={kpi?.critical_open ?? '…'} tone="alert" sub="still undecided" />
        <Kpi label="Critical networks" value={kpi?.critical_networks ?? '…'} sub="multi-party cases" />
        <Kpi label="Past 10-day triage SLA" value={kpi?.past_triage_sla ?? '…'} sub="BSA/AML Policy §2" />
        <Kpi label="Historical false-positive rate" value={kpi ? `${(Number(kpi.fp_rate) * 100).toFixed(1)}%` : '…'} sub="rules-only triage, 12 months" />
      </div>

      {hotNetwork && (
        <div className="rounded-xl border border-[#D1495B]/30 bg-gradient-to-r from-[#D1495B]/10 to-transparent p-4 flex items-center gap-4">
          <Sparkles className="h-8 w-8 text-[#D1495B] shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-base">The model surfaced a {hotNetwork.size}-party network the rules engine buried</div>
            <div className="text-muted-foreground">
              {hotNetwork.n} alerts on {hotNetwork.parties} linked parties sit at an average <b>rules rank #{hotNetwork.avgRules}</b> of {rows?.length} — every one of them is now in the <b>ML top {hotNetwork.worstMl}</b>.
              Individually each looks like a low-risk customer; together they share a suite, phones and a login device.
            </div>
          </div>
          <Link to={`/network/${hotNetwork.cid}`} className="inline-flex items-center gap-1 rounded-md bg-[#0B2545] px-3 py-2 text-sm text-white hover:opacity-90">
            <Network className="h-4 w-4" /> View network
          </Link>
          <Link to={`/case/${hotNetwork.first.alert_id}`} className="inline-flex items-center gap-1 rounded-md bg-[#D1495B] px-3 py-2 text-sm text-white hover:opacity-90">
            Open top case <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Rank by</span>
        <div className="inline-flex rounded-md border bg-card p-0.5">
          {(['ml', 'rules'] as const).map((k) => (
            <button key={k} onClick={() => setSort(k)} data-testid={`sort-${k}`}
              className={`rounded px-3 py-1 ${sort === k ? 'bg-[#0B2545] text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {k === 'ml' ? 'ML risk (default)' : 'Rules score (legacy)'}
            </button>
          ))}
        </div>
        <label className="ml-4 flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Hide decided alerts
        </label>
        <span className="ml-auto text-muted-foreground">{view.length} alerts</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left w-14">#</th>
              <th className="px-3 py-2 text-left">Subject</th>
              <th className="px-3 py-2 text-left">Scenario</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Rule score</th>
              <th className="px-3 py-2 text-left">ML risk</th>
              <th className="px-3 py-2 text-left">Network</th>
              <th className="px-3 py-2 text-right">Age</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {!rows && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={9} className="px-3 py-3"><div className="h-4 rounded bg-muted animate-pulse" /></td></tr>
            ))}
            {view.slice(0, 120).map((r, i) => {
              const other = sort === 'ml' ? r.rules_rank : r.ml_rank;
              const jump = Number(r.rules_rank) - Number(r.ml_rank);
              return (
                <tr key={r.alert_id} onClick={() => nav(`/case/${r.alert_id}`)} data-testid="queue-row"
                  className="border-t cursor-pointer hover:bg-[#3E7CB1]/5">
                  <td className="px-3 py-2 tabular-nums">
                    <div className="font-semibold">{i + 1}</div>
                    <div className="text-[10px] text-muted-foreground">{sort === 'ml' ? 'rules' : 'ML'} #{other}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{r.alert_id} · {r.occupation_or_industry} · KYC {r.kyc_risk_rating}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.scenario}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(r.triggered_amount, true)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{Number(r.rule_score).toFixed(0)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <RiskBar score={r.ml_risk_score} />
                      {sort === 'ml' && jump > 100 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[#D1495B]" title="Rank gained vs rules engine"><TrendingUp className="h-3 w-3" />{jump}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {Number(r.cluster_size) >= 3 ? (
                      <Link to={`/network/${r.cluster_id}`} onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#0B2545]/10 px-2 py-0.5 text-[11px] font-medium text-[#0B2545] hover:bg-[#0B2545]/20">
                        <Network className="h-3 w-3" /> {r.cluster_size} parties
                      </Link>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{r.age_days}d</td>
                  <td className="px-3 py-2"><DecisionBadge decision={r.decision} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
