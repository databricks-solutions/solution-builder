/**
 * Discharge worklist — every open discharge (planned in the next days, or discharged in the last 7 days)
 * ranked by readmission_risk_model@champion, mirrored into Lakebase. Selecting a patient opens the
 * transition workspace: risk + drivers + what-if, what AI Functions read in the discharge note, prior
 * admissions, and the transition plan (Genie agent over the pathway documents + pathway rules) the coordinator approves —
 * approval writes the outreach tasks back to Lakebase.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CheckCircle2, ChevronDown, ClipboardList, FileText, Loader2, Phone, Sparkles, TriangleAlert, XCircle } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { approvePlan, CONDITION, dayLabel, fetchPatient, fetchWorklist, pct, runPlan, type PatientDetail, type PlanRow, type PlanTask, type StepEvent, type WorklistRow } from './api';
import { RiskBar } from './charts';
import { Pill, cn } from './ui';

type Filter = 'hrrp' | '4w' | 'high' | 'all';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'hrrp', label: 'HRRP conditions' }, { key: '4w', label: '4 West' }, { key: 'high', label: 'High risk' }, { key: 'all', label: 'All open discharges' },
];
const TIER_TONE: Record<string, 'bad' | 'warn' | 'good'> = { High: 'bad', Medium: 'warn', Low: 'good' };
const PLAN_LABEL: Record<string, string> = { open: 'No plan', plan_drafted: 'Plan drafted', plan_approved: 'Plan approved' };

export function WorklistView() {
  const { id } = useParams();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('hrrp');
  const [rows, setRows] = useState<WorklistRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchWorklist({ hrrp: filter === 'hrrp', unit: filter === '4w' ? 'LRMC-4W' : undefined, tier: filter === 'high' ? 'High' : undefined })
      .then((r) => { setRows(r); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [filter, tick]);
  useEffect(() => {
    if (!id && rows && rows.length) nav(`/worklist/${rows[0].encounterId}`, { replace: true });
  }, [id, rows, nav]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(380px,0.9fr)_1.4fr]">
      <div className="flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Care-transitions coordinator</div>
          <h1 className="font-display text-2xl font-semibold text-[var(--primary)]">Discharge worklist</h1>
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">Planned discharges + discharged in the last 7 days · ranked by readmission_risk_model@champion</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cn('rounded-full border px-3 py-1 text-xs', filter === f.key ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] hover:border-[var(--primary-light)]')}>{f.label}</button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {err && <div className="p-4 text-sm text-[var(--destructive)]">{err}</div>}
          {!rows && !err && <div className="space-y-2 p-4">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--muted)]" />)}</div>}
          {rows?.map((r) => (
            <button key={r.encounterId} onClick={() => nav(`/worklist/${r.encounterId}`)}
              className={cn('grid w-full grid-cols-[1fr_92px] gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left hover:bg-[var(--muted)]/60', r.encounterId === id && 'bg-[var(--info-subtle)]')}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.patientName}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{r.data.age}{r.data.sex}</span>
                  {r.planStatus !== 'open' && <Pill tone={r.planStatus === 'plan_approved' ? 'good' : 'info'}>{PLAN_LABEL[r.planStatus]}</Pill>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <span>{r.unitId}</span>·<span>{CONDITION[r.hrrpCondition] ?? r.hrrpCondition}</span>·
                  <span className={cn(r.data.weekend_discharge && 'font-semibold text-[var(--brand-5)]')}>{r.status === 'planned' ? 'leaves' : 'left'} {dayLabel(r.dischargeDate)}</span>
                  {!r.followupBooked && <span className="font-semibold text-[var(--brand-5)]">· no follow-up</span>}
                  {r.data.transportation_barrier && <span>· no ride</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">{pct(r.riskScore)}</div>
                <RiskBar value={r.riskScore} marker={r.data.risk_if_followup ?? undefined} />
              </div>
            </button>
          ))}
          {rows && rows.length === 0 && <div className="p-4 text-sm text-[var(--muted-foreground)]">No open discharges for this filter.</div>}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">{id ? <PatientPanel key={id} id={id} /> : <div className="p-6 text-sm text-[var(--muted-foreground)]">Select a patient.</div>}</div>
    </div>
  );
}

function PatientPanel({ id }: { id: string }) {
  const [d, setD] = useState<PatientDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const reload = () => fetchPatient(id).then(setD).catch((e) => setErr((e as Error).message));
  useEffect(() => { reload(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="p-6 text-sm text-[var(--destructive)]">{err}</div>;
  if (!d) return <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-[var(--muted)]" />)}</div>;
  const p = d.patient;
  const x = p.data;
  const social = [
    x.lives_alone && 'Lives alone', x.transportation_barrier && 'Transportation barrier', x.medication_affordability && 'Medication cost concern',
    x.language_barrier && `Language: ${x.primary_language}`, x.caregiver_support && 'Caregiver at home', x.has_pcp === false && 'No PCP', x.dual_eligible && 'Dual eligible',
  ].filter(Boolean) as string[];
  const fuText = x.note_followup_status === 'booked' ? 'booked' : x.note_followup_status === 'patient_to_call' ? '“patient to call”' : 'not arranged';

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">{p.unitName} · {x.hospital_name}</div>
          <h2 className="font-display text-3xl font-semibold text-[var(--primary)]">{p.patientName} <span className="text-lg font-normal text-[var(--muted-foreground)]">{x.age} {x.sex === 'M' ? 'M' : 'F'} · {x.payer}</span></h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span>{x.principal_dx} <span className="text-[var(--muted-foreground)]">({x.principal_dx_code})</span></span>
            <Pill tone={x.weekend_discharge ? 'bad' : 'neutral'}>{p.status === 'planned' ? 'Planned discharge' : 'Discharged'} {dayLabel(p.dischargeDate)}</Pill>
            <Pill tone={p.followupBooked ? 'good' : 'bad'}>{p.followupBooked ? `Follow-up ${dayLabel(x.followup_date)} · ${x.followup_clinic}` : 'No 7-day follow-up booked'}</Pill>
            <span className="text-xs text-[var(--muted-foreground)]">{x.discharge_disposition} · LOS {x.los_days} d · {x.attending}</span>
          </div>
        </div>
        <button onClick={() => dockController.openAndSend(`Build the transition plan for ${p.patientName} and tell me what matters most.`)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--primary-light)]"><Sparkles className="size-3.5 text-[var(--brand-5)]" />Ask the copilot</button>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">30-day readmission risk</div>
            <Pill tone={TIER_TONE[p.riskTier]}>{p.riskTier}</Pill>
          </div>
          <div className="mt-2 flex items-end gap-4">
            <div className="text-5xl font-semibold tabular-nums">{pct(p.riskScore)}</div>
            {!p.followupBooked && x.risk_if_followup != null && (
              <div className="pb-1 text-sm">
                <div>→ <b className="text-[var(--success)]">{pct(x.risk_if_followup)}</b> with a 7-day follow-up</div>
                {x.risk_if_followup_hh != null && <div className="text-[var(--muted-foreground)]">→ {pct(x.risk_if_followup_hh)} with follow-up + home health</div>}
              </div>
            )}
          </div>
          <div className="mt-3"><RiskBar value={p.riskScore} marker={x.risk_if_followup ?? undefined} /></div>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Top drivers</div>
          <ul className="mt-1 space-y-1 text-sm">{x.top_drivers.map((t) => <li key={t} className="flex gap-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-4)]" />{t}</li>)}</ul>
          <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">readmission_risk_model@champion v{x.model_version} · Charlson {x.charlson_index} · {x.ed_visits_6m} ED visits / 6 mo · {x.prior_admits_12m} admissions / 12 mo · {x.discharge_med_count} discharge meds</div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">What the discharge note says</div>
            <span className="text-[11px] text-[var(--muted-foreground)]">AI Functions · ai_query → typed schema</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">{social.length ? social.map((s) => <Pill key={s} tone={/barrier|cost|Language|No PCP/.test(s) ? 'bad' : 'neutral'}>{s}</Pill>) : <span className="text-sm text-[var(--muted-foreground)]">No social risks found</span>}</div>
          {x.sdoh_summary && <p className="mt-2 text-sm">{x.sdoh_summary}</p>}
          <div className="mt-2 grid gap-1 text-sm">
            <div><span className="text-[var(--muted-foreground)]">Medication changes:</span> {x.med_changes.length ? x.med_changes.join('; ') : 'none'}{x.high_risk_med_change && <Pill tone="warn" className="ml-1">high-risk</Pill>}</div>
            <div><span className="text-[var(--muted-foreground)]">Follow-up as written:</span> <b className={x.note_followup_status === 'booked' ? '' : 'text-[var(--brand-5)]'}>{fuText}</b></div>
            {x.pending_labs && <div><span className="text-[var(--muted-foreground)]">Pending:</span> {x.pending_labs}</div>}
          </div>
          {x.note_text && (
            <button onClick={() => setShowNote((s) => !s)} className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--primary-light)]"><FileText className="size-3.5" />{showNote ? 'Hide' : 'Show'} discharge note<ChevronDown className={cn('size-3.5 transition', showNote && 'rotate-180')} /></button>
          )}
          {showNote && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--muted)] p-3 font-mono text-[11px] leading-relaxed">{x.note_text}</pre>}
        </div>
      </div>

      {d.history.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="font-semibold">Prior admissions</div>
          <div className="mt-2 space-y-1 text-sm">
            {d.history.map((h) => (
              <div key={h.encounter_id} className="flex flex-wrap items-center gap-2">
                <span className="w-24 tabular-nums text-[var(--muted-foreground)]">{h.discharge_date}</span><span>{h.condition_label}</span><span className="text-xs text-[var(--muted-foreground)]">{h.unit_name}</span>
                {h.readmitted_30d ? <Pill tone="bad">readmitted day {h.days_to_readmit} · {h.readmit_reason}</Pill> : <Pill>no readmission</Pill>}
                {!h.followup_7d_scheduled && <Pill tone="warn">no follow-up booked</Pill>}
              </div>
            ))}
          </div>
        </div>
      )}

      <PlanCard patient={p} initial={d.plan} tasks={d.tasks} onChange={reload} />
    </div>
  );
}

function PlanCard({ patient, initial, tasks, onChange }: { patient: WorklistRow; initial: PlanRow | null; tasks: PatientDetail['tasks']; onChange: () => void }) {
  const [plan, setPlan] = useState<PlanRow | null>(initial);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<PlanTask[]>(initial?.plan.tasks ?? []);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSel(plan?.plan.tasks ?? []); }, [plan]);
  const approved = plan?.status === 'approved';
  const nSel = useMemo(() => sel.filter((t) => t.selected).length, [sel]);

  const build = async () => {
    setRunning(true); setErr(null); setSteps([]);
    await runPlan(patient.encounterId, {
      step: (e) => setSteps((s) => [...s.filter((x) => x.id !== e.id), e]),
      result: (p) => { setPlan(p); dataMutated.emit(); onChange(); },
      error: (m) => setErr(m),
    });
    setRunning(false);
  };
  const approve = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const p = await approvePlan(plan.id, sel);
      setPlan(p);
      dataMutated.emit();
      onChange();
      // The approve controls collapse, so the page scroll can land below the plan card.
      requestAnimationFrame(() => document.getElementById('transition-plan')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setSaving(false);
  };

  return (
    <div id="transition-plan" className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-[var(--primary-light)]" />Transition plan</div>
        {!approved && (
          <button onClick={build} disabled={running}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{plan ? 'Rebuild plan' : 'Build transition plan'}
          </button>
        )}
        {approved && <Pill tone="good"><CheckCircle2 className="size-3" />Approved by {plan?.decidedBy} · {tasks.length} outreach tasks in Lakebase</Pill>}
      </div>
      {!plan && !running && steps.length === 0 && (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">The copilot combines the risk model, the AI-read discharge note, the unit context and Larkspur’s care pathways (the Genie agent over the pathway documents) into a task list with owners and due dates. You review it, then approve to write the outreach tasks.</p>
      )}
      {steps.length > 0 && (running || !plan || plan.createdAt > new Date(Date.now() - 60_000).toISOString()) && (
        <ol className="mt-3 space-y-1.5">
          {steps.map((s) => (
            <li key={s.id} className="flex gap-2 text-sm">
              {s.status === 'running' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--primary-light)]" /> : s.status === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--brand-4)]" />}
              <div><div>{s.label}</div>{s.detail && <div className="text-xs text-[var(--muted-foreground)]">{s.detail}</div>}</div>
            </li>
          ))}
        </ol>
      )}
      {err && <div className="mt-3 text-sm text-[var(--destructive)]">{err}</div>}
      {plan && (
        <div className="mt-4 space-y-4">
          {plan.plan.summary && <div className="rounded-xl bg-[var(--info-subtle)] p-3 text-sm leading-relaxed">{plan.plan.summary}</div>}
          {plan.plan.guidance && (
            <details className="rounded-xl border border-[var(--border)] p-3 text-sm" open={!approved}>
              <summary className="cursor-pointer font-medium">Care-pathway guidance <span className="text-xs font-normal text-[var(--muted-foreground)]">· Genie agent · {plan.plan.guidance.sources.join(', ') || 'Larkspur pathways'}</span></summary>
              <div className="mt-2 whitespace-pre-wrap leading-relaxed">{plan.plan.guidance.answer}</div>
            </details>
          )}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Outreach tasks {approved ? '(written to Lakebase)' : '— untick what you don’t want'}</div>
            <div className="mt-2 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              {sel.map((t, i) => (
                <label key={t.task_type + i} className={cn('flex gap-3 px-3 py-2.5 text-sm', !approved && 'cursor-pointer hover:bg-[var(--muted)]/50')}>
                  <input type="checkbox" className="mt-1" checked={t.selected} disabled={approved}
                    onChange={() => setSel((s) => s.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{t.title}</span><span className="text-xs tabular-nums text-[var(--muted-foreground)]">due {dayLabel(t.due_date)} · {t.owner}</span></div>
                    <div className="text-xs text-[var(--muted-foreground)]">{t.detail} <span className="italic">({t.source})</span></div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {plan.plan.call_script && (
            <details className="rounded-xl border border-[var(--border)] p-3 text-sm">
              <summary className="cursor-pointer font-medium"><Phone className="mr-1 inline size-3.5" />48-hour call script</summary>
              <div className="mt-2 whitespace-pre-wrap leading-relaxed">{plan.plan.call_script}</div>
            </details>
          )}
          {!approved && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-[var(--muted-foreground)]">Approving writes {nSel} tasks to the outreach queue (Lakebase) and marks the patient “plan approved”.</span>
              <button onClick={approve} disabled={saving || nSel === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Approve plan &amp; create {nSel} outreach tasks
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
