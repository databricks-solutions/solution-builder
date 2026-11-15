/**
 * Incident workbench — one correlated incident, end to end:
 *   left  : the blast radius (every site under the parent router, down vs up) or the KPI trend per sector,
 *           plus the raw alarms from Delta
 *   right : the triage agent (streamed tool calls → root cause → customer impact → timeline → action plan
 *           from the runbook → field dispatch) and the engineer's write-back: open ONE parent trouble ticket
 *           with the selected actions + dispatches (child alarms suppressed), or close as explained.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, BookOpen, Building2, CheckCircle2, ClipboardList, Crosshair, Loader2, Radar, Sparkles, Target, Truck, Users, XCircle, Zap,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  closeExplained, fetchEvidence, fetchIncident, fmtN, fmtTs, openTicket, runTriage,
  type Evidence, type IncidentDetail, type StepEvent, type Triage,
} from './api';
import { LineChart, Pill, PriorityPill, SevBadge, SourceBadge, StatusPill, TYPE_META, VERDICT, cn } from './ui';

function Steps({ steps, running }: { steps: StepEvent[]; running: boolean }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} className="flex gap-2.5 text-sm">
          {s.status === 'running' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--primary-light)]" /> : s.status === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--brand-5)]" />}
          <div className="min-w-0">
            <div className="font-medium">{s.label}</div>
            {s.detail && <div className="text-xs text-[var(--muted-foreground)] break-words">{s.detail}</div>}
          </div>
        </li>
      ))}
      {running && <li className="pl-6 text-xs text-[var(--muted-foreground)]">The agent picks its next hop in the topology from what it just found…</li>}
    </ol>
  );
}

function Section({ icon: Icon, title, children, right }: { icon: typeof Radar; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="mb-3 flex items-center gap-2 font-semibold"><Icon className="size-4 text-[var(--primary-light)]" />{title}<span className="ml-auto">{right}</span></div>
      {children}
    </div>
  );
}

function BlastRadius({ ev, router }: { ev: Evidence; router: string }) {
  const down = ev.sites.filter((s) => s.is_down);
  const up = ev.sites.filter((s) => !s.is_down);
  return (
    <div>
      <div className="mb-2 text-sm"><b className="text-[var(--brand-5)]">{down.length} down</b> · <b className="text-[var(--success)]">{up.length} up</b> of {ev.sites.length} sites homed on <span className="font-mono">{router}</span></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1">
        {ev.sites.map((s) => (
          <div key={s.site_id} title={`${s.site_id} ${s.site_name} · ${s.backhaul_type} · ${s.subscribers_served} subs${s.critical_facility ? ` · ${s.critical_facility}` : ''}`}
            className={cn('rounded px-1 py-1 text-center font-mono text-[10px] leading-tight', s.is_down ? 'bg-[#FF4D5E] text-[#1A0306] font-semibold' : 'bg-[#0E2A21] text-[#7BF0C0]', s.critical_facility && 'ring-2 ring-offset-1 ring-[var(--brand-4)]')}>
            {s.site_id.slice(4)}{s.backhaul_type !== 'fiber' && <div className="text-[8px] opacity-90">MW backup</div>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted-foreground)]">
        <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-[#FF4D5E]" />down</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-[var(--success)]" />up</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-sm ring-2 ring-[var(--brand-4)]" />critical facility (hospital / 911)</span>
      </div>
    </div>
  );
}

function KpiTrend({ ev }: { ev: Evidence }) {
  const days = [...new Set(ev.trend.map((t) => t.d))].sort();
  const pivot = (k: keyof Evidence['trend'][number]) => days.map((d) => {
    const row: Record<string, unknown> = { d };
    for (const t of ev.trend.filter((x) => x.d === d)) row[t.sector] = t[k];
    return row;
  });
  const colors = ['#3CD7F0', '#FF4D5E', '#FFB020'];
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between text-xs"><span className="font-medium">Dropped-call rate %, by sector (21 days)</span><span className="flex gap-2">{['A', 'B', 'C'].map((s, i) => <span key={s} style={{ color: colors[i] }} className="font-semibold">● {s}</span>)}</span></div>
        <LineChart rows={pivot('drop_call_rate_pct')} x="d" series={['A', 'B', 'C']} colors={colors} threshold={{ value: 2, label: 'customer-affecting 2.0%' }} unit="%" height={170} />
      </div>
      <div>
        <div className="text-xs font-medium">Max VSWR by sector — the vendor alarm only fires at 2.0</div>
        <LineChart rows={pivot('max_vswr')} x="d" series={['A', 'B', 'C']} colors={colors} threshold={{ value: 2, label: 'VSWR alarm 2.0' }} height={130} />
      </div>
      <div>
        <div className="text-xs font-medium">Peak PRB utilization % by sector</div>
        <LineChart rows={pivot('peak_prb_utilization_pct')} x="d" series={['A', 'B', 'C']} colors={colors} unit="%" height={110} />
      </div>
    </div>
  );
}

export function IncidentWorkbench() {
  const { id = '' } = useParams();
  const [inc, setInc] = useState<IncidentDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ev, setEv] = useState<Evidence | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [tr, setTr] = useState<Triage | null>(null);
  const [selA, setSelA] = useState<Set<number>>(new Set());
  const [selD, setSelD] = useState<Set<number>>(new Set());
  const [priority, setPriority] = useState('P1');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchIncident(id).then((l) => {
      setInc(l);
      if (l.triage) adopt(l.triage);
    }).catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(() => {
    setInc(null); setTr(null); setSteps([]); setEv(null); setFlash(null);
    load();
    fetchEvidence(id).then(setEv).catch(() => setEv({ kind: 'kpi', sites: [], alarms: [], trend: [] }));
  }, [id, load]);

  function adopt(t: Triage) {
    setTr(t);
    setSelA(new Set(t.actions.map((_, k) => k)));
    setSelD(new Set(t.dispatch.map((_, k) => k)));
    setPriority(t.priority);
    setTitle(t.headline);
    setNotes(t.verdict === 'explained' ? t.explanation_evidence.join('\n') : '');
  }

  async function triage() {
    setRunning(true); setSteps([]); setTr(null); setFlash(null);
    await runTriage(id, {
      step: (s) => setSteps((prev) => (prev.some((p) => p.id === s.id) ? prev.map((p) => (p.id === s.id ? s : p)) : [...prev, s])),
      result: (t) => { adopt(t); dataMutated.emit(); },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Triage failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
  }

  async function submitTicket() {
    if (!tr) return;
    setBusy(true);
    try {
      const actions = tr.actions.filter((_, k) => selA.has(k));
      const dispatches = tr.dispatch.filter((_, k) => selD.has(k));
      const l = await openTicket(id, { priority, title, actions, dispatches, notes });
      setInc(l);
      setFlash(`Trouble ticket ${l.ticketId} opened (${priority}) · ${dispatches.length} technician${dispatches.length === 1 ? '' : 's'} dispatched${l.ticket?.childAlarmsSuppressed ? ` · ${l.ticket.childAlarmsSuppressed} child alarms suppressed` : ''} — written to Lakebase`);
      dataMutated.emit();
    } finally { setBusy(false); }
  }
  async function submitExplained() {
    setBusy(true);
    try {
      const l = await closeExplained(id, notes);
      setInc(l);
      setFlash(`${id} closed as explained — evidence written to Lakebase`);
      dataMutated.emit();
    } finally { setBusy(false); }
  }

  if (err) return <div className="p-8 text-sm text-[var(--destructive)]">{err}</div>;
  if (!inc) return <div className="p-8"><div className="h-40 rounded-2xl bg-[var(--muted)] animate-pulse" /></div>;
  const decided = inc.status === 'ticketed' || inc.status === 'closed_explained';
  const meta = TYPE_META[inc.incidentType] ?? TYPE_META.site_outage;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/incidents" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline"><ArrowLeft className="size-3" />Incident queue</Link>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--info-subtle)] text-[var(--primary)]"><meta.icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold">{inc.title}</h1>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">{inc.id}</span>
            </div>
            <div className="text-sm text-[var(--muted-foreground)]">{meta.label} · {inc.market} · {inc.incidentType === 'kpi_anomaly' ? `first flagged ${inc.firstFlaggedDay} · anomaly score ${inc.anomalyScore}` : `first alarm ${fmtTs(inc.firstAlarmTs)} · ${inc.alarmCount} alarms (${inc.activeAlarms} active)`}</div>
          </div>
          <PriorityPill p={tr?.priority ?? inc.suggestedPriority} />
          <StatusPill status={inc.status} />
          <div className="text-right"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Subscribers served</div><div className="text-3xl font-semibold tabular-nums text-[var(--primary)]">{fmtN(inc.subscribersServed)}</div></div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="space-y-4">
            {inc.incidentType === 'alarm_storm' ? (
              <Section icon={Target} title="Blast radius — topology correlation">
                {!ev ? <div className="h-40 rounded-lg bg-[var(--muted)] animate-pulse" /> : <BlastRadius ev={ev} router={inc.suspectedNodeId} />}
              </Section>
            ) : (
              <Section icon={Radar} title={`RAN KPIs — ${inc.suspectedNodeId}`}>
                {!ev ? <div className="h-40 rounded-lg bg-[var(--muted)] animate-pulse" /> : ev.trend.length ? <KpiTrend ev={ev} /> : <div className="text-sm text-[var(--muted-foreground)]">No KPI data.</div>}
                {inc.topFactors.length > 0 && (
                  <>
                    <div className="mt-3 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Why the anomaly model flagged it (vs the cell's own baseline)</div>
                    <ul className="mt-1 space-y-1 text-sm">{inc.topFactors.map((f) => <li key={f} className="flex gap-2"><Zap className="mt-0.5 size-3.5 shrink-0 text-[var(--severity-warning)]" />{f}</li>)}</ul>
                  </>
                )}
              </Section>
            )}
            {(inc.enterpriseAccounts.length > 0 || inc.criticalFacilities.length > 0) && (
              <Section icon={Building2} title="Enterprise accounts & critical facilities on these sites">
                <ul className="space-y-1 text-sm">{inc.enterpriseAccounts.map((a) => <li key={a}>· {a}</li>)}</ul>
                {inc.criticalFacilities.length > 0 && <div className="mt-2 flex gap-1">{inc.criticalFacilities.map((c) => <Pill key={c} tone="bad">{c}</Pill>)}</div>}
              </Section>
            )}
            <Section icon={Crosshair} title="Raw alarms (Delta, via SQL warehouse)" right={<span className="text-xs font-normal text-[var(--muted-foreground)]">latest 80, 24 h</span>}>
              {!ev && <div className="h-40 rounded-lg bg-[var(--muted)] animate-pulse" />}
              {ev && ev.alarms.length === 0 && <div className="text-sm text-[var(--muted-foreground)]">No alarm fired — this degradation is invisible to threshold alarming.</div>}
              <div className="max-h-[420px] overflow-y-auto pr-1">
                {ev?.alarms.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-[var(--border)] py-1.5 text-xs last:border-0">
                    <span className="w-[92px] shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">{a.ts.slice(5, 19).replace('T', ' ')}</span>
                    <SevBadge sev={a.severity} />
                    <span className="min-w-0 break-words"><span className="font-mono">{a.node_id}{a.detail ? ` ${a.detail}` : ''}</span> · {a.alarm_name}{a.cleared ? <span className="text-[var(--success)]"> · cleared {a.cleared.slice(11, 16)}</span> : ''}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <div className="space-y-4">
            {!tr && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--card)] to-[var(--info-subtle)] p-6">
                <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />Triage with the NOC Copilot</div>
                <p className="mt-1 max-w-xl text-sm text-[var(--muted-foreground)]">An agent walks the topology in Unity Catalog — parent router, backhaul links and their routes, optical levels, alarm history, RAN KPIs, planned work and 811 notices — sizes the customer impact, asks the NOC runbook (Genie agent), and proposes one parent ticket with an action plan and a field dispatch. You decide.</p>
                <button onClick={triage} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"><Radar className="size-4" />Triage this incident</button>
              </div>
            )}
            {(running || (steps.length > 0 && !tr)) && (
              <Section icon={Radar} title="Triage in progress" right={running ? <Loader2 className="size-4 animate-spin" /> : null}>
                <Steps steps={steps} running={running} />
              </Section>
            )}

            {tr && (
              <>
                <div className={cn('rounded-2xl border p-5', tr.verdict === 'root_cause_identified' ? 'border-[#FF4D5E]/50 bg-[#2A0F15]' : tr.verdict === 'explained' ? 'border-[#3DDC97]/40 bg-[#0C2319]' : 'border-[#FFB020]/40 bg-[#2A200B]')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={VERDICT[tr.verdict]?.tone}>{VERDICT[tr.verdict]?.label}</Pill>
                    <PriorityPill p={tr.priority} />
                    {tr.estimated_restore && <Pill tone="info">Restore: {tr.estimated_restore}</Pill>}
                    <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{tr.tool_calls} evidence calls · {tr.model} · {new Date(tr.generated_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-2 text-lg font-semibold leading-snug">{tr.headline}</div>
                  <p className="mt-1 text-sm leading-relaxed">{tr.summary}</p>
                  {tr.root_cause && (
                    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
                      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Root cause</div>
                      <div><span className="font-mono font-semibold">{tr.root_cause.node}</span> · <b>{tr.root_cause.component}</b> — {tr.root_cause.cause}</div>
                    </div>
                  )}
                  {steps.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-[var(--muted-foreground)]">Show the {steps.length} triage steps</summary><div className="mt-2"><Steps steps={steps} running={false} /></div></details>}
                </div>

                <Section icon={Users} title="Customer impact">
                  <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Sites down</div><div className="text-2xl font-semibold tabular-nums">{fmtN(tr.impact.sites_down)}</div></div>
                    <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Subscribers</div><div className="text-2xl font-semibold tabular-nums">{fmtN(tr.impact.subscribers)}</div></div>
                    <div className="col-span-2"><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Enterprise / critical</div>
                      <div className="mt-1 flex flex-wrap gap-1">{tr.impact.enterprise_accounts.map((a) => <Pill key={a} tone="warn">{a}</Pill>)}{tr.impact.critical_facilities.map((c) => <Pill key={c} tone="bad">{c}</Pill>)}{!tr.impact.enterprise_accounts.length && !tr.impact.critical_facilities.length && <span className="text-xs text-[var(--muted-foreground)]">none</span>}</div></div>
                  </div>
                  {tr.impact.note && <div className="mt-2 text-xs text-[var(--muted-foreground)]">{tr.impact.note}</div>}
                </Section>

                {tr.timeline.length > 0 && (
                  <Section icon={Crosshair} title="Timeline">
                    <ol className="relative space-y-2 border-l border-[var(--border)] pl-4">
                      {tr.timeline.map((t, i) => (
                        <li key={i} className="relative text-sm">
                          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-[var(--card)]" style={{ background: t.is_root_cause ? 'var(--brand-5)' : 'var(--primary-light)' }} />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{t.ts}</span>
                            <SourceBadge source={t.source} />
                            <span className="font-mono text-[11px]">{t.entity}</span>
                            {t.is_root_cause && <span className="rounded bg-[var(--brand-5)] px-1.5 py-0.5 text-[10px] font-semibold text-white">ROOT CAUSE</span>}
                          </div>
                          <div className="mt-0.5">{t.event}</div>
                        </li>
                      ))}
                    </ol>
                  </Section>
                )}

                {tr.explanation_evidence.length > 0 && (
                  <Section icon={CheckCircle2} title="Why this is explained">
                    <ul className="space-y-1 text-sm">{tr.explanation_evidence.map((b) => <li key={b} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />{b}</li>)}</ul>
                  </Section>
                )}

                {tr.actions.length > 0 && (
                  <Section icon={ClipboardList} title="Action plan (NOC runbook RB-7)">
                    <ul className="space-y-2">
                      {tr.actions.map((c, k) => (
                        <li key={k}>
                          <label className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm', selA.has(k) ? 'border-[var(--primary-light)] bg-[var(--info-subtle)]/40' : 'border-[var(--border)]')}>
                            <input type="checkbox" disabled={decided} checked={selA.has(k)} onChange={() => setSelA((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="mt-1" />
                            <div><div><span className="font-mono text-xs">{c.code}</span> <b>{c.action}</b> — <span className="text-xs">{c.target}</span></div><div className="text-xs text-[var(--muted-foreground)]">{c.rationale}</div></div>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {tr.notifications.length > 0 && (
                      <div className="mt-3 rounded-lg bg-[#2A200B] px-3 py-2 text-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#FFC466]">Required notifications</div>
                        <ul className="mt-1 list-disc pl-5">{tr.notifications.map((n) => <li key={n}>{n}</li>)}</ul>
                      </div>
                    )}
                    {tr.runbook_citations.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-[var(--muted-foreground)]"><BookOpen className="size-3.5" />NOC runbook: {tr.runbook_citations.map((c) => <Pill key={c} tone="info">{c}</Pill>)}</div>}
                  </Section>
                )}

                {tr.dispatch.length > 0 && (
                  <Section icon={Truck} title="Field dispatch">
                    <ul className="space-y-2">
                      {tr.dispatch.map((d, k) => (
                        <li key={k}>
                          <label className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm', selD.has(k) ? 'border-[var(--primary-light)] bg-[var(--info-subtle)]/40' : 'border-[var(--border)]')}>
                            <input type="checkbox" disabled={decided} checked={selD.has(k)} onChange={() => setSelD((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="mt-1" />
                            <div className="flex-1"><div><b>{d.name}</b> <span className="font-mono text-xs text-[var(--muted-foreground)]">{d.tech_id} · {d.skill}</span>{d.eta_min != null && <Pill tone="info" className="ml-2">ETA {d.eta_min} min</Pill>}</div><div className="text-xs">→ {d.destination}</div><div className="text-xs text-[var(--muted-foreground)]">{d.task}</div></div>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <div className="rounded-2xl border-2 border-[var(--primary)] bg-[var(--card)] p-5">
                  {flash && <div className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-sm font-medium text-[var(--success-subtle-foreground)]"><CheckCircle2 className="size-4" />{flash}</div>}
                  {decided ? (
                    <div className="text-sm">
                      <div className="font-semibold">{inc.status === 'ticketed' ? <>Trouble ticket <Link to="/tickets" className="font-mono underline">{inc.ticketId}</Link> opened</> : 'Closed as explained'}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">by {inc.decidedBy} · {inc.decidedAt ? new Date(inc.decidedAt).toLocaleString() : ''}</div>
                      {inc.ticket && <div className="mt-2 text-xs">{inc.ticket.actions.length} actions ({inc.ticket.actions.map((c) => c.code).join(', ')}) · {inc.ticket.dispatches.length} technician(s) dispatched{inc.ticket.childAlarmsSuppressed ? ` · ${inc.ticket.childAlarmsSuppressed} child alarms suppressed` : ''}</div>}
                    </div>
                  ) : (
                    <>
                      <div className="font-semibold">Engineer decision</div>
                      {tr.verdict !== 'explained' && (
                        <div className="mt-2 grid gap-2 md:grid-cols-[100px_1fr]">
                          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm">
                            {['P1', 'P2', 'P3', 'P4'].map((s) => <option key={s}>{s}</option>)}
                          </select>
                          <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm" placeholder="Ticket title" />
                        </div>
                      )}
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Engineer notes (saved with the decision)" className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {tr.verdict !== 'explained' && (
                          <button disabled={busy} onClick={submitTicket} className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-5)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                            {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}Open trouble ticket &amp; dispatch {selD.size} technician{selD.size === 1 ? '' : 's'}
                          </button>
                        )}
                        <button disabled={busy} onClick={submitExplained} className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60', tr.verdict === 'explained' ? 'bg-[var(--success)] text-[var(--success-foreground)]' : 'border border-[var(--border)]')}>
                          <CheckCircle2 className="size-4" />Close as explained
                        </button>
                        <button disabled={busy || running} onClick={triage} className="ml-auto text-xs text-[var(--muted-foreground)] underline">Re-run triage</button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {inc.auditTrail.length > 0 && (
              <Section icon={BookOpen} title="Audit trail">
                <ul className="space-y-1 text-xs">
                  {[...inc.auditTrail].reverse().map((a, i) => (
                    <li key={i} className="flex gap-2"><span className="w-[130px] shrink-0 font-mono text-[var(--muted-foreground)]">{new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><b className="shrink-0">{a.action.replace(/_/g, ' ')}</b><span className="text-[var(--muted-foreground)]">{a.by} — {a.notes}</span></li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
