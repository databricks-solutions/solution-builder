/**
 * Incident queue — every open incident the correlation engine and the KPI anomaly model raised,
 * P1 first: one row per ROOT CAUSE candidate, not per alarm.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchIncidents, fetchSummary, fmtN, fmtTs, type IncidentRow, type Summary } from './api';
import { Pill, PriorityPill, StatusPill, TYPE_META, VERDICT, cn } from './ui';

export function IncidentsView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchIncidents('all').then(setRows).catch(() => setRows([]));
    fetchSummary().then(setSum).catch(() => {});
  }, [tick]);
  const shown = (rows ?? []).filter((r) => !q || `${r.title} ${r.suspected_node_id} ${r.market}`.toLowerCase().includes(q.toLowerCase()));
  const alarms = (rows ?? []).reduce((s, r) => s + r.alarm_count, 0);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">NOC shift · Dana Whitfield</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Incident queue</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {rows ? <><b>{fmtN(alarms)} alarms</b> in the last 24 h correlated into <b>{rows.length} incidents</b> by topology (sites → aggregation router), plus degradations the KPI anomaly model (<code>cell_kpi_anomaly_model@champion</code>) found with no alarm at all.</> : 'Loading…'}
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm">
            <Search className="size-4 text-[var(--muted-foreground)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by site, router, market" className="w-64 bg-transparent outline-none" />
          </label>
        </div>
        {sum && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone="bad">{sum.p1_open} P1 open</Pill>
            <Pill tone="warn">{fmtN(sum.sites_down)} sites down · {fmtN(sum.subscribers_down)} subscribers</Pill>
            <Pill tone="info">{sum.triaged} triaged by the Copilot</Pill>
            <Pill tone="neutral">{sum.tickets_opened} trouble ticket{sum.tickets_opened === 1 ? '' : 's'} opened · {fmtN(sum.alarms_suppressed)} child alarms suppressed</Pill>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Incident', 'What the correlation found', 'Blast radius', 'Alarms', 'Detected', 'Status'].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows === null && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-5 rounded bg-[var(--muted)] animate-pulse" /></td></tr>)}
              {rows !== null && shown.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">No incidents — the queue is mirrored from Delta on boot (Reset demo re-syncs it).</td></tr>}
              {shown.map((r) => {
                const meta = TYPE_META[r.incident_type] ?? TYPE_META.site_outage;
                const done = ['ticketed', 'closed_explained'].includes(r.status);
                return (
                  <tr key={r.id} onClick={() => nav(`/incidents/${r.id}`)} className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/50', done && 'opacity-70')}>
                    <td className="px-4 py-3 align-top"><div className="font-mono text-xs">{r.id}</div><PriorityPill p={r.ai_priority ?? r.suggested_priority} className="mt-1" /></td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2 font-medium"><meta.icon className="size-4 shrink-0 text-[var(--primary-light)]" />{r.title}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">{meta.label} · {r.market}{r.incident_type === 'kpi_anomaly' && r.top_factors[0] ? ` · ${r.top_factors[0]}` : ''}</div>
                      {r.ai_headline && <div className="mt-1 text-xs"><Pill tone={VERDICT[r.ai_verdict ?? '']?.tone}>{VERDICT[r.ai_verdict ?? '']?.label ?? r.ai_verdict}</Pill> <span className="text-[var(--foreground)]">{r.ai_headline}</span></div>}
                    </td>
                    <td className="px-4 py-3 align-top text-xs tabular-nums">
                      <div><b>{r.sites_affected}</b> site{r.sites_affected === 1 ? '' : 's'} · {fmtN(r.subscribers_served)} subs</div>
                      {r.enterprise_accounts.length > 0 && <div className="text-[var(--muted-foreground)]">{r.enterprise_accounts.length} enterprise account{r.enterprise_accounts.length === 1 ? '' : 's'}</div>}
                      {r.critical_facilities.length > 0 && <div className="font-medium text-[var(--brand-5)]">{r.critical_facilities.join(', ')}</div>}
                    </td>
                    <td className="px-4 py-3 align-top text-xs tabular-nums">{r.alarm_count > 0 ? <><b>{r.alarm_count}</b>{r.active_alarms > 0 ? <div className="text-[var(--brand-5)]">{r.active_alarms} active</div> : <div className="text-[var(--success)]">all cleared</div>}</> : <span className="text-[var(--muted-foreground)]">none — score {r.anomaly_score}</span>}</td>
                    <td className="px-4 py-3 align-top text-xs font-mono text-[var(--muted-foreground)]">{r.incident_type === 'kpi_anomaly' ? `flagged ${r.first_flagged_day ?? ''}` : fmtTs(r.detected_ts)}</td>
                    <td className="px-4 py-3 align-top space-y-1"><StatusPill status={r.status} />{r.ticket_id && <div className="font-mono text-[11px]">{r.ticket_id}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
