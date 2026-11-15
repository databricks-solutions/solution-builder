/**
 * Home — Dana's utilization-management work queue at 08:00. Not a marketing hero: the page is a
 * triage board. Four lanes (auto-approve, nurse fast-track, request information, physician review)
 * hold the open requests as cards; each card carries its CMS SLA clock and a criteria checklist
 * (met / total). The most urgent request in each lane is on top. The PA Copilot chips and the
 * decision feed sit underneath.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, BarChart3, Bot, ClipboardList, MessageSquare, ShieldCheck, Zap } from 'lucide-react';
import { useSession } from '@/lib/api';
import { fetchActivity, fetchCases, fetchSummary, fmtDate, fmtHours, relTime } from '@/lib/pa';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type { ActivityEvent, CaseRow, Summary } from '@/shared/types';
import { AutoApproveDialog } from '@/queue/AutoApproveDialog';

const LANES = [
  { lane: 'Auto-approval lane', label: 'Auto-approve', tab: 'auto', color: '#15803D', help: 'All criteria met with cited evidence, on an auto-eligible policy' },
  { lane: 'Nurse fast-track', label: 'Nurse fast-track', tab: 'fast', color: '#0F766E', help: 'All criteria met; the policy needs nurse sign-off' },
  { lane: 'Request information', label: 'Request information', tab: 'info', color: '#B45309', help: 'Documentation gap: pend with a precise ask' },
  { lane: 'Physician review', label: 'Physician review', tab: 'md', color: '#9F1239', help: 'A criterion is not met: Medical Director only' },
] as const;
const CARDS_PER_LANE = 6;

function SlaClock({ hours, sla, clock }: { hours: number; sla: number; clock: CaseRow['clock'] }) {
  const frac = Math.max(0, Math.min(1, sla > 0 ? hours / sla : 0));
  const color = clock === 'breached' ? '#BE123C' : clock === 'at_risk' ? '#B45309' : '#0F766E';
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono font-semibold" style={{ color }}>{fmtHours(hours)}</span>
        <span className="font-mono text-[var(--muted-foreground)]">{sla}h clock</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-[#E3EBEC]">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${frac * 100}%`, background: color }} />
        <div className="absolute -inset-y-0.5 w-px bg-[#94A3B8]" style={{ left: '25%' }} title="at-risk threshold (25% of clock)" />
      </div>
    </div>
  );
}

function CriteriaTicks({ met, total }: { met: number | null; total: number | null }) {
  if (!total) return <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">criteria not reviewed</div>;
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-3 w-2 rounded-sm ${i < (met ?? 0) ? 'bg-[#0F766E]' : 'bg-[#E3EBEC]'}`} />
        ))}
      </div>
      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{met ?? 0}/{total} met</span>
    </div>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [s, setS] = useState<Summary | null>(null);
  const [board, setBoard] = useState<Record<string, CaseRow[]> | null>(null);
  const [act, setAct] = useState<ActivityEvent[]>([]);
  const [dialog, setDialog] = useState(false);
  const load = useCallback(() => {
    fetchSummary().then(setS).catch(() => {});
    Promise.all(LANES.map((l) => fetchCases({ lane: l.lane }).then((rows) => [l.lane, rows] as const)))
      .then((pairs) => setBoard(Object.fromEntries(pairs)))
      .catch(() => {});
    fetchActivity(6).then(setAct).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    return dataMutated.subscribe(load);
  }, [load]);

  const script = config?.assistantScript ?? [];
  const clear = (s?.lanes['Auto-approval lane'] ?? 0) + (s?.lanes['Nurse fast-track'] ?? 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* Header — a working title bar, not a hero */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] border-l-4 border-l-[var(--primary-light)] bg-[var(--card)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              MedVault Health Plan · Utilization management · {s ? fmtDate(s.asOf) : ''}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
              Dana, {s?.open ?? '…'} prior-auth requests are open. {clear || '…'} already meet every policy criterion.
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
              AI Functions read each clinical note against the medical policy overnight and cite the evidence per criterion. Clear cases no longer sit ~2.5 days
              in a FIFO queue: your time goes to the {s?.lanes['Request information'] ?? '…'} documentation gaps and the {s?.lanes['Physician review'] ?? '…'} physician reviews.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <button onClick={() => setDialog(true)} disabled={!s?.autoApprovable} data-testid="home-auto-approve"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#15803D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Zap className="size-4" /> Release {s?.autoApprovable ?? 0} auto-approvals
            </button>
            <button onClick={() => nav('/queue')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]">
              <ClipboardList className="size-4" /> Open my worklist <ArrowRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Queue health — one bar, SLA-first numbers */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] md:grid-cols-5">
          {[
            { label: 'Open requests', value: s?.open, tone: undefined },
            { label: 'Expedited · 72h clock', value: s?.expeditedOpen, tone: undefined },
            { label: 'Past SLA', value: s?.breached, tone: '#BE123C' },
            { label: 'At risk · <25% of clock', value: s?.atRisk, tone: '#B45309' },
            { label: 'Weekend faxes not indexed', value: s?.faxAwaitingIndexing, tone: '#B45309' },
          ].map((t) => (
            <div key={t.label} className="bg-[var(--card)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{t.label}</div>
              <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums" style={{ color: t.tone }}>{t.value ?? '—'}</div>
            </div>
          ))}
        </div>

        {/* Triage board */}
        <div className="grid gap-3 lg:grid-cols-4">
          {LANES.map((l) => {
            const rows = [...(board?.[l.lane] ?? [])].sort((a, b) => a.hoursRemaining - b.hoursRemaining);
            const count = s?.lanes[l.lane] ?? 0;
            return (
              <section key={l.lane} className="flex min-w-0 flex-col rounded-xl border border-[var(--border)] bg-[#F7FAFA]" aria-label={l.label}>
                <div className="rounded-t-xl border-b border-[var(--border)] bg-[var(--card)] px-3 py-3" style={{ borderTop: `3px solid ${l.color}` }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{l.label}</span>
                    <span className="font-mono text-xl font-semibold tabular-nums" style={{ color: l.color }}>{count}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">{l.help}</div>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {board === null && [0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-[var(--muted)]" />)}
                  {rows.slice(0, CARDS_PER_LANE).map((c) => (
                    <button key={c.requestId} onClick={() => nav(`/case/${c.requestId}`)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-left shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:border-[var(--primary-light)] hover:shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{c.requestId}</span>
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${c.urgency === 'Expedited' ? 'bg-[#0F4C4A] text-white' : 'bg-[#E3EBEC] text-[#334155]'}`}>
                          {c.urgency === 'Expedited' ? '72H' : '7D'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold">{c.memberName ?? c.memberId}</div>
                      <div className="truncate text-xs text-[var(--muted-foreground)]">{c.serviceDescription ?? c.policyTitle ?? ''}</div>
                      <SlaClock hours={c.hoursRemaining} sla={c.slaHours} clock={c.clock} />
                      <CriteriaTicks met={c.nMet} total={c.nCriteria} />
                    </button>
                  ))}
                  {board !== null && rows.length === 0 && <div className="px-2 py-6 text-center text-xs text-[var(--muted-foreground)]">Nothing in this lane.</div>}
                  {rows.length > CARDS_PER_LANE && (
                    <button onClick={() => nav(`/queue?tab=${l.tab}`)} className="rounded-lg py-2 text-xs font-medium text-[var(--primary)] hover:bg-white">
                      +{rows.length - CARDS_PER_LANE} more in the worklist →
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <section className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-1 flex items-center gap-2 font-semibold"><Bot className="size-4 text-[var(--primary)]" /> Ask PA Copilot</div>
            <div className="mb-3 text-xs text-[var(--muted-foreground)]">Agent with tools over the live queue, and the Genie agent over 120 days of PA history and the medical policy documents.</div>
            <div className="space-y-2">
              {script.map((st, i) => (
                <button key={i} onClick={() => dockController.newAndSend(st.prompt)} data-testid="starter-chip"
                  className="flex w-full items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--muted)]">
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" /> {st.prompt}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={() => nav('/queue')} className="flex flex-col gap-1.5 rounded-lg bg-[var(--muted)] p-3 text-left text-xs font-medium hover:bg-[#E3EBEC]"><ClipboardList className="size-4 text-[var(--primary)]" />Review with evidence</button>
              <button onClick={() => setDialog(true)} className="flex flex-col gap-1.5 rounded-lg bg-[var(--muted)] p-3 text-left text-xs font-medium hover:bg-[#E3EBEC]"><ShieldCheck className="size-4 text-[var(--primary)]" />Auto-approval lane</button>
              <button onClick={() => nav('/dashboard')} className="flex flex-col gap-1.5 rounded-lg bg-[var(--muted)] p-3 text-left text-xs font-medium hover:bg-[#E3EBEC]"><BarChart3 className="size-4 text-[var(--primary)]" />CMS ops dashboard</button>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-3 font-semibold">Decision feed</div>
            {act.length === 0 ? (
              <div className="text-sm text-[var(--muted-foreground)]">No decisions yet this session — open a case or release the auto-approval lane.</div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {act.map((e, i) => (
                  <li key={i} className="flex cursor-pointer justify-between gap-3 py-2 text-sm" onClick={() => nav(`/case/${e.requestId}`)}>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{e.action.replace('_', ' ')} · {e.memberName}</div>
                      <div className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">{e.requestId} · {e.policyTitle} · {e.by}</div>
                    </div>
                    <span className="whitespace-nowrap font-mono text-[11px] text-[var(--muted-foreground)]">{relTime(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      <AutoApproveDialog open={dialog} onClose={() => setDialog(false)} />
    </div>
  );
}
