/**
 * Lead workbench — one UEBA lead, end to end:
 *   left  : the entity, the UEBA risk trend + why it was flagged, raw evidence from the logs
 *   right : the investigation agent (streamed pivots → verdict → incident timeline → ATT&CK
 *           mapping → containment plan from the IR playbook) and the analyst's write-back:
 *           open an incident case with the selected containment actions, or close as benign.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, BookOpen, CheckCircle2, CircleAlert, Crosshair, Loader2, Monitor, Radar, ShieldAlert, ShieldCheck, Sparkles, UserRound, XCircle,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  closeBenign, fetchEvidence, fetchLead, openCase, runInvestigation,
  type ContainmentAction, type Evidence, type Investigation, type LeadDetail, type StepEvent,
} from './api';
import { Pill, PRIORITY_TONE, RiskScore, SourceBadge, StatusPill, VERDICT, cn } from './ui';

function RiskTrend({ trend }: { trend: Evidence['trend'] }) {
  if (!trend.length) return <div className="h-24 rounded-lg bg-[var(--muted)] animate-pulse" />;
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {trend.map((t) => (
          <div key={t.d} className="group relative flex-1">
            <div className="rounded-t-sm" style={{ height: `${Math.max(3, t.risk) * 0.96}px`, background: t.risk >= 85 ? 'var(--brand-5)' : t.risk >= 55 ? 'var(--severity-warning)' : 'var(--primary-light)', opacity: t.risk < 55 ? 0.35 : 1 }} />
            <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white group-hover:block">{t.d}: {t.risk}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]"><span>{trend[0]?.d}</span><span>{trend[trend.length - 1]?.d}</span></div>
    </div>
  );
}

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
      {running && <li className="pl-6 text-xs text-[var(--muted-foreground)]">The agent decides its next pivot from what it just found…</li>}
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

export function LeadWorkbench() {
  const { id = '' } = useParams();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ev, setEv] = useState<Evidence | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [severity, setSeverity] = useState('SEV-1');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchLead(id).then((l) => {
      setLead(l);
      if (l.investigation) adopt(l.investigation);
    }).catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(() => {
    setLead(null); setInv(null); setSteps([]); setEv(null); setFlash(null);
    load();
    fetchEvidence(id).then(setEv).catch(() => setEv({ trend: [], events: [] }));
  }, [id, load]);

  function adopt(i: Investigation) {
    setInv(i);
    setSelected(new Set(i.containment.map((_, k) => k)));
    setSeverity(i.severity);
    setTitle(i.headline);
    setNotes(i.verdict === 'benign' ? i.benign_evidence.join('\n') : '');
  }

  async function investigate() {
    setRunning(true); setSteps([]); setInv(null); setFlash(null);
    await runInvestigation(id, {
      step: (s) => setSteps((prev) => (prev.some((p) => p.id === s.id) ? prev.map((p) => (p.id === s.id ? s : p)) : [...prev, s])),
      result: (i) => { adopt(i); dataMutated.emit(); },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Investigation failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
  }

  async function submitCase() {
    if (!inv) return;
    setBusy(true);
    try {
      const containment: ContainmentAction[] = inv.containment.filter((_, k) => selected.has(k));
      const l = await openCase(id, { severity, title, containment, notes });
      setLead(l);
      setFlash(`Incident ${l.caseId} opened (${severity}) · ${containment.length} containment actions requested — written to Lakebase`);
      dataMutated.emit();
    } finally { setBusy(false); }
  }
  async function submitBenign() {
    setBusy(true);
    try {
      const l = await closeBenign(id, notes);
      setLead(l);
      setFlash(`Lead ${id} closed as benign — disposition and evidence written to Lakebase`);
      dataMutated.emit();
    } finally { setBusy(false); }
  }

  const techById = useMemo(() => Object.fromEntries((inv?.techniques ?? []).map((t) => [t.id, t])), [inv]);
  if (err) return <div className="p-8 text-sm text-[var(--destructive)]">{err}</div>;
  if (!lead) return <div className="p-8"><div className="h-40 rounded-2xl bg-[var(--muted)] animate-pulse" /></div>;
  const decided = lead.status === 'escalated' || lead.status === 'closed_benign';
  const Icon = lead.entityType === 'user' ? UserRound : Monitor;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/leads" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline"><ArrowLeft className="size-3" />Lead queue</Link>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--info-subtle)] text-[var(--primary)]"><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold">{lead.displayName}</h1>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">{lead.id} · {lead.entityType} {lead.entityId}</span>
            </div>
            <div className="text-sm text-[var(--muted-foreground)]">{lead.entityType === 'user' ? `${lead.role ?? ''} · ${lead.department ?? ''}` : lead.role} · flagged {lead.firstFlagged}</div>
          </div>
          <Pill tone={PRIORITY_TONE[lead.priority]} className="capitalize">{lead.priority}</Pill>
          <StatusPill status={lead.status} />
          <div className="text-right"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">UEBA risk</div><RiskScore score={lead.riskScore} className="text-4xl" /></div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="space-y-4">
            <Section icon={Radar} title="UEBA risk — last 21 days">
              <RiskTrend trend={ev?.trend ?? []} />
              <div className="mt-3 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Why it was flagged (behaviours more than 3 sigma from peers)</div>
              <ul className="mt-1 space-y-1 text-sm">{lead.topFactors.map((f) => <li key={f} className="flex gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--severity-warning)]" />{f}</li>)}</ul>
              {lead.alertsClosedFp > 0 && <div className="mt-3 rounded-lg border border-[#5A2230] bg-[#3A1620] px-3 py-2 text-xs text-[#FF8A96]"><b>{lead.alertsClosedFp} SIEM alert{lead.alertsClosedFp > 1 ? 's' : ''}</b> on this entity {lead.alertsClosedFp > 1 ? "were" : "was"} closed as false positive by tier 1 in the last two weeks.</div>}
            </Section>
            <Section icon={Crosshair} title="Raw evidence (Delta, via SQL warehouse)" right={<span className="text-xs font-normal text-[var(--muted-foreground)]">latest 60 events</span>}>
              {!ev && <div className="h-40 rounded-lg bg-[var(--muted)] animate-pulse" />}
              <div className="max-h-[430px] overflow-y-auto pr-1">
                {ev?.events.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-[var(--border)] py-1.5 text-xs last:border-0">
                    <span className="w-[108px] shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">{e.ts.slice(0, 16).replace('T', ' ')}</span>
                    <SourceBadge source={e.src} />
                    <span className="min-w-0 break-words">{e.detail}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <div className="space-y-4">
            {!inv && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--card)] to-[var(--info-subtle)] p-6">
                <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />Investigate with the Copilot</div>
                <p className="mt-1 max-w-xl text-sm text-[var(--muted-foreground)]">An agent pivots across sign-in, VPN, EDR and DNS logs in Unity Catalog, follows every IP, host and domain it finds, checks travel approvals and service-desk tickets, asks the IR playbook (Genie agent), and returns an incident timeline mapped to MITRE ATT&amp;CK with a containment plan. You decide.</p>
                <button onClick={investigate} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"><Radar className="size-4" />Investigate this lead</button>
              </div>
            )}
            {(running || (steps.length > 0 && !inv)) && (
              <Section icon={Radar} title="Investigation in progress" right={running ? <Loader2 className="size-4 animate-spin" /> : null}>
                <Steps steps={steps} running={running} />
              </Section>
            )}

            {inv && (
              <>
                <div className={cn('rounded-2xl border p-5', inv.verdict === 'confirmed_compromise' ? 'border-[#5A2230] bg-[#241019]' : inv.verdict === 'benign' ? 'border-[#1F4A38] bg-[#0F2017]' : 'border-[var(--border)] bg-[var(--card)]')}>
                  <div className="flex flex-wrap items-center gap-2">
                    {inv.verdict === 'benign' ? <ShieldCheck className="size-5 text-[var(--success)]" /> : <ShieldAlert className="size-5 text-[var(--brand-5)]" />}
                    <Pill tone={VERDICT[inv.verdict]?.tone}>{VERDICT[inv.verdict]?.label}</Pill>
                    <Pill tone={inv.severity === 'SEV-1' ? 'bad' : inv.severity === 'SEV-2' ? 'warn' : 'neutral'}>{inv.severity}</Pill>
                    {inv.records_at_risk != null && inv.records_at_risk > 0 && <Pill tone="bad">{inv.records_at_risk.toLocaleString()} taxpayer records at risk</Pill>}
                    <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{inv.tool_calls} pivots · {inv.model} · {new Date(inv.generated_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-2 text-lg font-semibold leading-snug">{inv.headline}</div>
                  <p className="mt-1 text-sm leading-relaxed">{inv.summary}</p>
                  {steps.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-[var(--muted-foreground)]">Show the {steps.length} investigation steps</summary><div className="mt-2"><Steps steps={steps} running={false} /></div></details>}
                </div>

                {inv.timeline.length > 0 && (
                  <Section icon={Crosshair} title="Incident timeline">
                    <ol className="relative space-y-2 border-l border-[var(--border)] pl-4">
                      {inv.timeline.map((t, i) => (
                        <li key={i} className="relative text-sm">
                          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-[var(--card)]" style={{ background: t.technique_id ? 'var(--brand-5)' : 'var(--primary-light)' }} />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{t.ts}</span>
                            <SourceBadge source={t.source} />
                            <span className="font-mono text-[11px]">{t.entity}</span>
                            {t.technique_id && <span title={techById[t.technique_id]?.name} className="rounded bg-[var(--primary)] px-1.5 py-0.5 font-mono text-[10px] text-white">{t.technique_id}</span>}
                          </div>
                          <div className="mt-0.5">{t.event}</div>
                        </li>
                      ))}
                    </ol>
                  </Section>
                )}

                {inv.techniques.length > 0 && (
                  <Section icon={Radar} title="MITRE ATT&CK mapping" right={<span className="text-xs font-normal text-[var(--muted-foreground)]">coverage = does CDOR have a detection rule?</span>}>
                    <table className="w-full text-sm">
                      <tbody>
                        {inv.techniques.map((t) => (
                          <tr key={t.id} className="border-t border-[var(--border)] first:border-0 align-top">
                            <td className="py-2 pr-3 font-mono text-xs font-semibold">{t.id}</td>
                            <td className="py-2 pr-3"><div className="font-medium">{t.name}</div><div className="text-xs text-[var(--muted-foreground)]">{t.tactic}{t.playbook_section ? ` · ${t.playbook_section}` : ''}</div></td>
                            <td className="py-2 pr-3 text-xs">{t.evidence}</td>
                            <td className="py-2">{t.coverage ? <Pill tone={t.coverage === 'none' ? 'bad' : t.coverage === 'partial' ? 'warn' : 'good'}>{t.coverage === 'none' ? 'no detection' : `${t.coverage} coverage`}</Pill> : <Pill tone="neutral">not in playbook</Pill>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Section>
                )}

                {inv.benign_evidence.length > 0 && (
                  <Section icon={ShieldCheck} title="Why this is explained">
                    <ul className="space-y-1 text-sm">{inv.benign_evidence.map((b) => <li key={b} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />{b}</li>)}</ul>
                  </Section>
                )}

                {inv.containment.length > 0 && (
                  <Section icon={ShieldAlert} title="Containment plan (IR playbook PB-7.1)">
                    <ul className="space-y-2">
                      {inv.containment.map((c, k) => (
                        <li key={k}>
                          <label className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm', selected.has(k) ? 'border-[var(--primary-light)] bg-[var(--info-subtle)]/40' : 'border-[var(--border)]')}>
                            <input type="checkbox" disabled={decided} checked={selected.has(k)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="mt-1" />
                            <div><div><span className="font-mono text-xs">{c.code}</span> <b>{c.action}</b> — <span className="font-mono text-xs">{c.target}</span></div><div className="text-xs text-[var(--muted-foreground)]">{c.rationale}</div></div>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {inv.notifications.length > 0 && (
                      <div className="mt-3 rounded-lg border border-[#4A3A12] bg-[#2A2109] px-3 py-2 text-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#F3C76A]">Required notifications</div>
                        <ul className="mt-1 list-disc pl-5">{inv.notifications.map((n) => <li key={n}>{n}</li>)}</ul>
                      </div>
                    )}
                    {inv.playbook_citations.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-[var(--muted-foreground)]"><BookOpen className="size-3.5" />IR playbook: {inv.playbook_citations.map((c) => <Pill key={c} tone="info">{c}</Pill>)}</div>}
                  </Section>
                )}

                <div className="rounded-2xl border-2 border-[var(--primary)] bg-[var(--card)] p-5">
                  {flash && <div className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-sm font-medium text-[var(--success-subtle-foreground)]"><CheckCircle2 className="size-4" />{flash}</div>}
                  {decided ? (
                    <div className="text-sm">
                      <div className="font-semibold">{lead.status === 'escalated' ? <>Incident case <Link to="/cases" className="font-mono underline">{lead.caseId}</Link> opened</> : 'Closed as benign'}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">by {lead.decidedBy} · {lead.decidedAt ? new Date(lead.decidedAt).toLocaleString() : ''}</div>
                      {lead.incidentCase && <div className="mt-2 text-xs">{lead.incidentCase.containment.length} containment actions requested: {lead.incidentCase.containment.map((c) => c.code).join(', ')}</div>}
                    </div>
                  ) : (
                    <>
                      <div className="font-semibold">Analyst decision</div>
                      {inv.verdict !== 'benign' && (
                        <div className="mt-2 grid gap-2 md:grid-cols-[120px_1fr]">
                          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm">
                            {['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'].map((s) => <option key={s}>{s}</option>)}
                          </select>
                          <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm" placeholder="Case title" />
                        </div>
                      )}
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Analyst notes (saved with the disposition)" className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {inv.verdict !== 'benign' && (
                          <button disabled={busy} onClick={submitCase} className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-5)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}Open incident case &amp; request {selected.size} containment action{selected.size === 1 ? '' : 's'}
                          </button>
                        )}
                        <button disabled={busy} onClick={submitBenign} className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60', inv.verdict === 'benign' ? 'bg-[var(--success)] text-white' : 'border border-[var(--border)]')}>
                          <ShieldCheck className="size-4" />Close as benign
                        </button>
                        <button disabled={busy || running} onClick={investigate} className="ml-auto text-xs text-[var(--muted-foreground)] underline">Re-run investigation</button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {lead.auditTrail.length > 0 && (
              <Section icon={BookOpen} title="Audit trail">
                <ul className="space-y-1 text-xs">
                  {[...lead.auditTrail].reverse().map((a, i) => (
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
