import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, Clock, Inbox, Search, Zap } from 'lucide-react';
import { fetchCases, fetchSummary, fmtDate } from '@/lib/pa';
import { dataMutated } from '@/lib/events';
import type { CaseRow, Summary } from '@/shared/types';
import { ClockBadge, LaneBadge, StatusBadge, UrgencyBadge } from '@/shared/badges';
import { AutoApproveDialog } from './AutoApproveDialog';

const TABS: Array<{ key: string; label: string; lane?: string; status?: string }> = [
  { key: 'all', label: 'All open' },
  { key: 'auto', label: 'Auto-approve', lane: 'Auto-approval lane' },
  { key: 'fast', label: 'Nurse fast-track', lane: 'Nurse fast-track' },
  { key: 'info', label: 'Request info', lane: 'Request information' },
  { key: 'md', label: 'MD review', lane: 'Physician review' },
  { key: 'decided', label: 'Decided', status: 'decided' },
];

export function QueueView() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const [q, setQ] = useState('');
  const [expOnly, setExpOnly] = useState(false);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);

  const load = useCallback(() => {
    const t = TABS.find((x) => x.key === tab) ?? TABS[0];
    Promise.all([fetchCases({ lane: t.lane, status: t.status === 'decided' ? 'all' : 'open' }), fetchSummary()])
      .then(([r, s]) => {
        setRows(t.status === 'decided' ? r.filter((x) => x.status !== 'open') : r);
        setSummary(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [tab]);

  useEffect(() => {
    load();
    return dataMutated.subscribe(load);
  }, [load]);

  const shown = useMemo(() => {
    let r = rows ?? [];
    if (expOnly) r = r.filter((x) => x.urgency === 'Expedited');
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) =>
        [x.requestId, x.memberName, x.practiceGroup, x.policyTitle, x.serviceCode, x.providerName].some((v) => v?.toLowerCase().includes(s)),
      );
    }
    return r;
  }, [rows, q, expOnly]);

  const laneCount = (lane?: string) => (lane ? (summary?.lanes[lane] ?? 0) : summary?.open ?? 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Utilization management · worklist</div>
            <h1 className="text-2xl font-semibold">Prior authorization queue</h1>
            <div className="text-sm text-muted-foreground">Snapshot {summary ? fmtDate(summary.asOf) : '…'} · clocks per CMS-0057-F (72h expedited · 7 days standard)</div>
          </div>
          <button
            onClick={() => setDialog(true)}
            disabled={!summary?.autoApprovable}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--success)] text-white font-medium shadow-sm disabled:opacity-40"
            data-testid="open-auto-approve"
          >
            <Zap className="size-4" /> Release auto-approval lane ({summary?.autoApprovable ?? 0})
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi icon={Inbox} label="Open requests" value={summary?.open} />
          <Kpi icon={Clock} label="Expedited open" value={summary?.expeditedOpen} />
          <Kpi icon={AlertTriangle} label="Past due" value={summary?.breached} tone="danger" />
          <Kpi icon={AlertTriangle} label="At risk (<25% of clock)" value={summary?.atRisk} tone="warn" />
          <Kpi icon={Zap} label="Decided this session" value={summary?.decided.total} tone="ok" />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setParams({ tab: t.key })}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.key ? 'border-[var(--primary)] font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              data-testid={`tab-${t.key}`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                {t.status === 'decided' ? summary?.decided.total ?? 0 : laneCount(t.lane)}
              </span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 pb-1">
            <label className="text-sm flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={expOnly} onChange={(e) => setExpOnly(e.target.checked)} /> Expedited only
            </label>
            <div className="relative">
              <Search className="size-4 absolute left-2 top-2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Member, request, group, CPT…"
                className="pl-8 pr-3 py-1.5 rounded-md border bg-card text-sm w-64"
              />
            </div>
          </div>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">SLA clock</th>
                <th className="text-left px-3 py-2">Request</th>
                <th className="text-left px-3 py-2">Member</th>
                <th className="text-left px-3 py-2">Service</th>
                <th className="text-left px-3 py-2">Requesting provider</th>
                <th className="text-left px-3 py-2">Intake</th>
                <th className="text-left px-3 py-2">AI pre-review</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows === null && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Loading queue…</td></tr>
              )}
              {rows !== null && shown.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Nothing in this lane.</td></tr>
              )}
              {shown.map((r) => (
                <tr key={r.requestId} onClick={() => nav(`/case/${r.requestId}`)} className="hover:bg-muted/40 cursor-pointer" data-testid="case-row">
                  <td className="px-3 py-2.5">
                    {r.status === 'open' ? <ClockBadge hours={r.hoursRemaining} clock={r.clock} /> : <StatusBadge status={r.status} />}
                    <div className="mt-1"><UrgencyBadge urgency={r.urgency} /></div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.requestId}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.memberName}</div>
                    <div className="text-xs text-muted-foreground">{r.memberAge}{r.memberSex} · {r.lineOfBusiness}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.policyTitle}</div>
                    <div className="text-xs text-muted-foreground">{r.serviceCode} · {r.policyId}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div>{r.practiceGroup}</div>
                    <div className="text-xs text-muted-foreground">{r.providerName}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <div>{r.channel}</div>
                    {r.intakeStatus === 'Intake / Indexing' && <div className="text-[var(--severity-warning)]">awaiting fax indexing</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <LaneBadge lane={r.aiLane} />
                    <div className="text-xs text-muted-foreground mt-1">{r.nMet}/{r.nCriteria} criteria met · {Math.round((r.aiConfidence ?? 0) * 100)}%</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <AutoApproveDialog open={dialog} onClose={() => setDialog(false)} />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value?: number; tone?: 'danger' | 'warn' | 'ok' }) {
  const color = tone === 'danger' ? 'var(--destructive)' : tone === 'warn' ? 'var(--severity-warning)' : tone === 'ok' ? 'var(--success)' : 'var(--primary)';
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" style={{ color }} />{label}</div>
      <div className="text-3xl font-semibold mt-1" style={{ color: tone ? color : undefined }}>{value ?? '—'}</div>
    </div>
  );
}
