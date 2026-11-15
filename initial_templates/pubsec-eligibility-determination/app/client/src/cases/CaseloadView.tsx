/**
 * Caseload — the open queue from Lakebase. Three scopes (my caseload / Tamarack
 * backlog / statewide), status filter, search. Each row shows the federal
 * deadline meter and which verification documents are on file, so a missing
 * paystub or ID is visible before anyone opens the case.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, Check, FileText, Home, IdCard, Search, Wallet, Zap } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchCases, fetchSummary, fullName, type CaseRow, type Summary } from './api';
import { DeadlineMeter, Kpi, Pill, StatusPill, cn } from './ui';

const SCOPES = [
  { key: 'mine', label: 'My caseload', params: { caseworker: 'CW-SURGE-01' } },
  { key: 'tamarack', label: 'Tamarack backlog', params: { county: 'Tamarack' } },
  { key: 'state', label: 'Statewide', params: {} },
] as const;
const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Past deadline' },
  { key: 'awaiting_verification', label: 'Awaiting verification' },
  { key: 'decided', label: 'Decided' },
];

function DocDot({ ok, icon: Icon, label }: { ok: boolean; icon: typeof IdCard; label: string }) {
  return (
    <span title={`${label}: ${ok ? 'on file' : 'missing'}`}
      className={cn('inline-flex size-6 items-center justify-center rounded-md',
        ok ? 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]' : 'bg-[#FBE3E6] text-[#9B1C2E]')}>
      <Icon className="size-3.5" />
    </span>
  );
}

export function CaseloadView() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') ?? 'mine';
  const status = sp.get('status') ?? 'open';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  const scopeDef = SCOPES.find((s) => s.key === scope) ?? SCOPES[0];

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      Promise.all([
        fetchCases({ ...scopeDef.params, status, q: q || undefined }),
        fetchSummary(scope === 'state' ? undefined : 'Tamarack'),
      ])
        .then(([r, s]) => { if (alive) { setRows(r); setSummary(s); setError(null); } })
        .catch((e) => alive && setError((e as Error).message));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [scope, status, q, tick, scopeDef]);

  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  const counts = useMemo(() => ({ n: rows?.length ?? 0 }), [rows]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Westbrook DHS · Economic Assistance</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Caseload</h1>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {SCOPES.map((s) => (
              <button key={s.key} onClick={() => set('scope', s.key)}
                className={cn('px-3 py-1.5 text-sm rounded-md transition-colors',
                  scope === s.key ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label={scope === 'state' ? 'Open statewide' : 'Open in Tamarack (county)'} value={summary.open} sub={`all programs · avg ${summary.avg_days_open} days open`} />
            <Kpi label="Past federal deadline" value={summary.overdue} tone="bad" sub="7 / 30 / 45-day standard" />
            <Kpi label="Expedited, past 7 days" value={summary.expedited_late} tone="bad" sub={`${summary.expedited_open} expedited open`} />
            <Kpi label="Awaiting verification" value={summary.awaiting_verification} tone="warn" sub="documents requested" />
            <Kpi label="Decided in the workbench" value={summary.decided} sub={`${summary.ai_checked} AI-checked`} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button key={s.key} onClick={() => set('status', s.key)}
              className={cn('rounded-full border px-3 py-1 text-xs',
                status === s.key ? 'border-[var(--primary)] bg-[var(--info-subtle)] text-[var(--primary)] font-medium' : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]')}>
              {s.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2">
            <Search className="size-4 text-[var(--muted-foreground)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or application #"
              className="h-8 w-56 bg-transparent text-sm outline-none" />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-2 text-left">Applicant</th>
                <th className="px-3 py-2 text-left">Program</th>
                <th className="px-3 py-2 text-left">County · channel</th>
                <th className="px-3 py-2 text-left">Deadline</th>
                <th className="px-3 py-2 text-left">Documents on file</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {error && <tr><td colSpan={6} className="px-4 py-6 text-[var(--destructive)]">Could not load the caseload: {error}</td></tr>}
              {!error && rows === null && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-5 rounded bg-[var(--muted)] animate-pulse" /></td></tr>
              ))}
              {rows?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">No cases match this view.</td></tr>}
              {rows?.map((r) => {
                const gaps = [r.has_id, r.has_residency, r.has_income].filter((x) => !x).length;
                return (
                  <tr key={r.id} onClick={() => nav(`/cases/${r.id}`)} data-case-id={r.id}
                    className="border-t border-[var(--border)] cursor-pointer hover:bg-[var(--info-subtle)]/40">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{fullName(r)}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">{r.id} · household of {r.household_size}{r.preferred_language && r.preferred_language !== 'English' ? ` · ${r.preferred_language}` : ''}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Pill tone={r.program === 'SNAP' ? 'brand' : 'info'}>{r.program}</Pill>
                        {r.expedited_screening && <Pill tone="bad"><Zap className="size-3" />Expedited</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--muted-foreground)]">{r.county} · {r.channel?.replace('_', ' ')}</td>
                    <td className="px-3 py-2.5"><DeadlineMeter daysOpen={Number(r.days_open)} standard={Number(r.standard_days)} compact /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <DocDot ok={r.has_id} icon={IdCard} label="Identity" />
                        <DocDot ok={r.has_residency} icon={Home} label="Residency" />
                        <DocDot ok={r.has_income} icon={Wallet} label="Income" />
                        <span className="ml-1 text-xs text-[var(--muted-foreground)] inline-flex items-center gap-1"><FileText className="size-3" />{r.doc_count}</span>
                        {gaps > 0 && <span className="ml-1 text-xs text-[#9B1C2E] inline-flex items-center gap-1"><AlertTriangle className="size-3" />{gaps} missing</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={r.status} />
                        {r.ai_recommendation && !r.decision && <Pill tone="info"><Check className="size-3" />AI checked</Pill>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows && rows.length > 0 && <div className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted-foreground)]">{counts.n} cases · oldest first</div>}
        </div>
      </div>
    </div>
  );
}
