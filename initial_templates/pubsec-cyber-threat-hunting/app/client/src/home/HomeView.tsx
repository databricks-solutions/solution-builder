/**
 * Home — the SOC console. A password spray ran for 19 days below every SIEM threshold,
 * then one guess worked. This page is the tier-2 hunter's board: a ticker of queue
 * health, the UEBA risk leaderboard, the priority lead's swimlane timeline, the ATT&CK
 * coverage matrix (blind spots in red), and the Copilot prompt rail.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, Radar } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  fetchActivity, fetchAttackMatrix, fetchEvidence, fetchLeads, fetchSummary, HERO_LEAD,
  type ActivityRow, type AttackCell, type Evidence, type LeadRow, type Summary,
} from '@/soc/api';
import { AttackMatrix } from '@/soc/attack-matrix';
import { SwimlaneTimeline } from '@/soc/timeline';
import { cn, PRIORITY_TONE, Pill, VERDICT } from '@/soc/ui';

const ACTION: Record<string, string> = { ai_investigation: 'AI_INVESTIGATION', case_opened: 'CASE_OPENED', closed_benign: 'CLOSED_BENIGN' };

function Panel({ title, meta, children, className }: { title: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-[var(--border)] bg-[var(--card)]', className)}>
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground)]">{title}</h2>
        {meta && <span className="ml-auto truncate font-mono text-[10px] text-[var(--muted-foreground)]">{meta}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Ticker({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="min-w-0 border-r border-[var(--border)] px-4 py-2 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('font-mono text-2xl font-semibold tabular-nums leading-tight', tone === 'bad' && 'text-[var(--brand-5)]', tone === 'warn' && 'text-[var(--severity-warning)]')}>{value}</div>
      {sub && <div className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? 'var(--brand-5)' : score >= 70 ? 'var(--severity-warning)' : 'var(--muted-foreground)';
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-right font-mono text-sm font-semibold tabular-nums" style={{ color }}>{Math.round(score)}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-none bg-[var(--muted)]">
        <div className="h-full" style={{ width: `${Math.min(100, score)}%`, background: color }} />
      </div>
    </div>
  );
}

function Sparkbars({ values }: { values: number[] }) {
  const v = values.slice(-21);
  return (
    <div className="flex h-5 items-end gap-px">
      {v.map((x, i) => (
        <div key={i} className="w-[3px]" style={{ height: `${Math.max(8, x)}%`, background: x >= 85 ? 'var(--brand-5)' : x >= 55 ? 'var(--severity-warning)' : 'var(--border)' }} />
      ))}
    </div>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const go = (to: string) => { void nav(to); };
  const { config } = useSession();
  const [sum, setSum] = useState<Summary | null>(null);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [matrix, setMatrix] = useState<AttackCell[] | null>(null);
  const [kpi, setKpi] = useState<{ mttd_days_identity: number; alerts_90d: number; tp_rate_pct: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    fetch('/api/charts/soc_kpis')
      .then((r) => r.json() as Promise<{ data?: Array<{ mttd_days_identity: number; alerts_90d: number; tp_rate_pct: number }> }>)
      .then((b) => setKpi(b.data?.[0] ?? null))
      .catch(() => {});
  }, []);
  useEffect(() => { fetchAttackMatrix().then(setMatrix).catch(() => setMatrix([])); }, []);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSummary().then(setSum).catch(() => {});
    fetchLeads('all').then(setLeads).catch(() => setLeads([]));
    fetchActivity(8).then(setActivity).catch(() => {});
    fetchEvidence(HERO_LEAD).then(setEvidence).catch(() => setEvidence({ trend: [], events: [] }));
  }, [tick]);

  const script = config?.assistantScript ?? [];
  const board = leads ?? [];
  const hero = board.find((l) => l.id === HERO_LEAD) ?? board[0];
  const heroMatrixStat = matrix ? matrix.filter((c) => c.detection_coverage === 'none').length : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* console header */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Cascadia SOC · Dept. of Revenue · Tier-2 threat hunt</div>
            <h1 className="mt-1 max-w-4xl text-[22px] font-semibold leading-snug">
              For 19 days someone guessed one password per account per day. The SIEM never fired. Then a guess worked.
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-[var(--muted-foreground)]">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[var(--success)]" />ueba_user_model@champion</span>
            <span>window 90d</span>
          </div>
        </div>

        {/* queue ticker */}
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] md:grid-cols-5">
          <Ticker label="Open UEBA leads" value={sum?.open ?? '…'} sub={`${sum?.investigated ?? 0} investigated by the copilot`} />
          <Ticker label="Critical" value={sum?.critical_open ?? '…'} tone={sum && sum.critical_open > 0 ? 'bad' : undefined} sub="priority = critical" />
          <Ticker label="Identity MTTD" value={kpi ? `${kpi.mttd_days_identity} d` : '…'} tone="warn" sub="first malicious → detected" />
          <Ticker label="SIEM alerts, 90d" value={kpi ? kpi.alerts_90d.toLocaleString() : '…'} sub={kpi ? `${kpi.tp_rate_pct}% true positive` : ''} />
          <Ticker label="Incident cases" value={sum?.cases_opened ?? '…'} sub={`${sum?.escalated ?? 0} escalated · ${sum?.closed_benign ?? 0} closed benign`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
          {/* UEBA leaderboard */}
          <Panel title="UEBA risk leaderboard" meta={`${board.length} entities · ranked by risk · 21-day trend`}>
            {leads === null && <div className="h-64 rounded bg-[var(--muted)] animate-pulse" />}
            {leads !== null && (
              <table className="w-full font-mono text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  <tr className="border-b border-[var(--border)]">
                    {['#', 'Entity', 'Risk', 'Trend', 'Top behaviour', 'Status'].map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {board.slice(0, 9).map((l, i) => (
                    <tr
                      key={l.id}
                      onClick={() => go(`/leads/${l.id}`)}
                      className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                    >
                      <td className="px-2 py-2 align-middle text-[var(--muted-foreground)] tabular-nums">{String(i + 1).padStart(2, '0')}</td>
                      <td className="px-2 py-2 align-middle">
                        <div className="font-sans text-[13px] font-medium">{l.display_name}</div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">{l.id} · {l.entity_id}{l.department ? ` · ${l.department}` : ''}</div>
                      </td>
                      <td className="px-2 py-2 align-middle"><ScoreBar score={l.risk_score} /></td>
                      <td className="px-2 py-2 align-middle"><Sparkbars values={l.risk_trend} /></td>
                      <td className="max-w-[260px] px-2 py-2 align-middle font-sans text-[12px] text-[var(--muted-foreground)]"><span className="line-clamp-2">{l.top_factors[0]}</span></td>
                      <td className="px-2 py-2 align-middle">
                        <div className="flex flex-col items-start gap-1">
                          <Pill tone={PRIORITY_TONE[l.priority]} className="uppercase">{l.priority}</Pill>
                          {l.ai_verdict && <Pill tone={VERDICT[l.ai_verdict]?.tone}>{VERDICT[l.ai_verdict]?.label.split(' — ')[0]}</Pill>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {board.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-[var(--muted-foreground)]">No leads — the queue is mirrored from Delta on boot (Reset demo re-syncs it).</td></tr>}
                </tbody>
              </table>
            )}
            <button onClick={() => go('/leads')} className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--primary-light)] hover:underline">
              all leads <ChevronRight className="size-3" />
            </button>
          </Panel>

          {/* priority lead */}
          <Panel title={`Priority 01 · ${hero?.id ?? HERO_LEAD}`} meta={hero ? `flagged ${hero.first_flagged ?? ''}`.trim() : ''}>
            {hero ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold leading-tight">{hero.display_name}</div>
                    <div className="font-mono text-[11px] text-[var(--muted-foreground)]">{hero.entity_id} · {hero.role}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">UEBA risk</div>
                    <div className="font-mono text-4xl font-semibold tabular-nums text-[var(--brand-5)] leading-none">{Math.round(hero.risk_score)}</div>
                  </div>
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Timeline · sign-in / VPN / EDR / DNS</div>
                  <SwimlaneTimeline events={evidence?.events ?? []} />
                </div>
                <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 font-mono text-[11px] text-[var(--muted-foreground)]">
                  {hero.top_factors.slice(0, 3).map((f) => <li key={f} className="flex gap-2"><span className="text-[var(--brand-5)]">▲</span><span>{f}</span></li>)}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => go(`/leads/${HERO_LEAD}`)} className="inline-flex items-center gap-2 rounded-sm bg-[var(--primary)] px-3 py-2 font-mono text-[12px] font-semibold text-[var(--primary-foreground)]">
                    <Radar className="size-3.5" />Open workbench
                  </button>
                  <button onClick={() => go('/dashboard')} className="rounded-sm border border-[var(--border)] px-3 py-2 font-mono text-[12px] hover:border-[var(--primary-light)]">CISO dashboard</button>
                </div>
              </>
            ) : (
              <div className="h-64 animate-pulse rounded bg-[var(--muted)]" />
            )}
          </Panel>
        </div>

        {/* ATT&CK coverage */}
        <Panel title="ATT&CK coverage · tactic matrix" meta={heroMatrixStat != null ? `${heroMatrixStat} techniques with no detection rule` : ''}>
          <AttackMatrix cells={matrix} />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* copilot rail */}
          <Panel title="Copilot · query rail" meta="SOC questions → Genie over telemetry · response → IR playbook">
            <div className="space-y-1.5">
              {script.map((s) => (
                <button
                  key={s.prompt}
                  onClick={() => void dockController.openAndSend(s.prompt)}
                  className="flex w-full items-start gap-2 rounded-sm border border-[var(--border)] px-3 py-2 text-left font-mono text-[12px] text-[var(--foreground)] hover:border-[var(--primary-light)] hover:bg-[var(--muted)]"
                >
                  <span className="text-[var(--primary)]">›</span>
                  <span>{s.prompt}</span>
                </button>
              ))}
            </div>
          </Panel>

          {/* workbench activity log */}
          <Panel title="Workbench log" meta="Lakebase write-back · audit trail">
            {activity.length === 0 && <div className="font-mono text-[12px] text-[var(--muted-foreground)]">no events yet — open a lead and click Investigate</div>}
            <ul className="space-y-1 font-mono text-[12px]">
              {activity.map((a) => (
                <li key={`${a.at}-${a.lead_id}-${a.action}`} className="flex items-center gap-3">
                  <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                  <button onClick={() => go(`/leads/${a.lead_id}`)} className="min-w-0 truncate text-left hover:underline">
                    <span className={cn('font-semibold', a.action === 'case_opened' ? 'text-[var(--brand-5)]' : a.action === 'closed_benign' ? 'text-[var(--success)]' : 'text-[var(--primary-light)]')}>{ACTION[a.action] ?? a.action}</span>
                    <span className="text-[var(--muted-foreground)]"> {a.lead_id} </span>{a.entity}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
