/**
 * Lead queue — every entity UEBA flagged this week, ranked by risk, with the
 * behaviours that deviated and the alerts tier 1 already closed on it.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Monitor, Search, UserRound } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchLeads, type LeadRow } from './api';
import { Pill, PRIORITY_TONE, RiskScore, Spark, StatusPill, VERDICT, cn } from './ui';

export function LeadsView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchLeads('all').then(setRows).catch(() => setRows([])); }, [tick]);
  const shown = (rows ?? []).filter((r) => !q || `${r.display_name} ${r.entity_id} ${r.department}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Tier 2 · Maya Okafor</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">UEBA lead queue</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Entities whose behaviour deviated on several axes at once this week (Isolation Forest, <code>ueba_user_model@champion</code>). Most have a boring explanation — one does not.</p>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm">
            <Search className="size-4 text-[var(--muted-foreground)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, host, department" className="w-64 bg-transparent outline-none" />
          </label>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Lead', 'Entity', 'Risk', '14-day trend', 'Why UEBA flagged it', 'Alerts', 'Status'].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows === null && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-5 rounded bg-[var(--muted)] animate-pulse" /></td></tr>)}
              {rows !== null && shown.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--muted-foreground)]">No leads — the queue is mirrored from Delta on boot (Reset demo re-syncs it).</td></tr>}
              {shown.map((r) => (
                <tr key={r.id} onClick={() => nav(`/leads/${r.id}`)} className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/50', ['escalated', 'closed_benign'].includes(r.status) && 'opacity-70')}>
                  <td className="px-4 py-3 align-top"><div className="font-mono text-xs">{r.id}</div><Pill tone={PRIORITY_TONE[r.priority]} className="mt-1 capitalize">{r.priority}</Pill></td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2 font-medium">{r.entity_type === 'user' ? <UserRound className="size-4 text-[var(--primary-light)]" /> : <Monitor className="size-4 text-[var(--primary-light)]" />}{r.display_name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{r.entity_type === 'user' ? `${r.entity_id} · ${r.department ?? ''}` : r.role}</div>
                  </td>
                  <td className="px-4 py-3 align-top"><RiskScore score={r.risk_score} className="text-2xl" /></td>
                  <td className="px-4 py-3 align-top"><Spark values={r.risk_trend} /></td>
                  <td className="px-4 py-3 align-top"><ul className="space-y-0.5 text-xs">{r.top_factors.slice(0, 3).map((f) => <li key={f}>· {f}</li>)}</ul></td>
                  <td className="px-4 py-3 align-top text-xs tabular-nums">{r.linked_alerts}{r.alerts_closed_fp > 0 && <div className="text-[var(--brand-5)] font-medium">{r.alerts_closed_fp} closed as FP</div>}</td>
                  <td className="px-4 py-3 align-top space-y-1"><StatusPill status={r.status} />{r.ai_verdict && <div><Pill tone={VERDICT[r.ai_verdict]?.tone}>{VERDICT[r.ai_verdict]?.label}</Pill></div>}{r.case_id && <div className="font-mono text-[11px]">{r.case_id}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
