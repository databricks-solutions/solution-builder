import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getJson, usd, fmtDateTime, type Json } from '@/lib/api';
import { DecisionBadge } from './Badges';

export function DecisionsView() {
  const [rows, setRows] = useState<Json[] | null>(null);
  useEffect(() => { getJson<{ decisions: Json[] }>('/api/decisions').then((r) => setRows(r.decisions)); }, []);
  return (
    <div className="px-8 py-6 space-y-4">
      <h1 className="font-display text-3xl">Decisions & audit</h1>
      <p className="text-sm text-muted-foreground">Every file / escalate / close decision is written to the governed Delta table <code>case_decisions</code> (with the full SAR narrative) and to the immutable <code>case_audit_log</code> — the compliance dashboard and Genie read them live.</p>
      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left">Decided</th><th className="px-3 py-2 text-left">Case</th><th className="px-3 py-2 text-left">Decision</th><th className="px-3 py-2 text-right">Alerts</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">BSA ID</th><th className="px-3 py-2 text-left">By</th><th className="px-3 py-2 text-left">Rationale</th></tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.decision_id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.decided_ts)}</td>
                <td className="px-3 py-2 whitespace-nowrap"><Link className="text-[#3E7CB1] hover:underline" to={`/case/${r.alert_id}`}>{r.alert_id}</Link><div className="text-[11px] text-muted-foreground">{r.cluster_id}</div></td>
                <td className="px-3 py-2"><DecisionBadge decision={r.decision} /></td>
                <td className="px-3 py-2 text-right">{r.alerts_covered}</td>
                <td className="px-3 py-2 text-right">{usd(r.amount_involved, true)}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.bsa_filing_ref ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{r.decided_by}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground max-w-md">{r.rationale}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No decisions yet — open a case from the alert queue.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
