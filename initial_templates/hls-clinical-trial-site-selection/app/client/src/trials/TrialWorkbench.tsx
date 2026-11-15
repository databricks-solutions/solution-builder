/**
 * Trial workbench — Dr. Elena Marsh's view of one study (CASCADE-CKD).
 *
 *   top    : enrollment vs plan, screen failures (as coded vs the real reason the AI read
 *            from the coordinator notes), the EHR-network eligible pool criterion by criterion,
 *            site health (competition, activation, zero enrollers)
 *   bottom : the enrollment-rescue analysis (streamed) → amendment proposal with protocol
 *            citations, projection, ML-ranked rescue sites, closure review, editable memo →
 *            the study manager approves / rejects (write-back to Lakebase)
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, ArrowLeft, BookOpen, Building2, CheckCircle2, CircleDashed, FileText, FlaskConical, Loader2, ShieldAlert, Sparkles, XCircle } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { project } from '../../../shared/projection';
import { decidePlan, fetchLatestPlan, fetchOverview, monthLabel, n0, pct, runRescue, type Overview, type Plan, type StepEvent } from './api';
import { EnrollmentChart, HBars, SCENARIO_COLOR } from './charts';
import { Kpi, Pill, cn } from './ui';

const ACTION: Record<string, string> = {
  ai_analysis: 'AI rescue analysis', approved: 'Plan approved', rejected: 'Plan rejected', memo_edited: 'Memo edited',
  activation_requested: 'Rescue sites sent to start-up', closure_review: 'Closure review opened',
};

function Card({ title, icon: Icon, right, children, className }: { title: string; icon?: typeof Sparkles; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">{Icon && <Icon className="size-4 text-[var(--primary-light)]" />}{title}</div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function TrialWorkbench() {
  const { id = 'CASCADE-CKD' } = useParams();
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<'real' | 'coded'>('coded');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closure, setClosure] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState('');
  const [notes, setNotes] = useState('');
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    fetchOverview(id).then(setOv).catch((e) => setErr((e as Error).message));
    fetchLatestPlan(id).then((p) => p && adopt(p)).catch(() => {});
  }, [id]);

  function adopt(p: Plan) {
    setPlan(p);
    setSelected(new Set(p.selectedSiteIds));
    setClosure(new Set(p.closureSiteIds));
    setMemo(p.memo ?? '');
  }

  async function run() {
    setRunning(true);
    setSteps([]);
    setPlan(null);
    await runRescue(id, {
      step: (e) => setSteps((prev) => {
        const i = prev.findIndex((x) => x.id === e.id);
        if (i < 0) return [...prev, e];
        const n = [...prev];
        n[i] = e;
        return n;
      }),
      result: (p) => { adopt(p); dataMutated.emit(); },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Rescue analysis failed', status: 'error', detail: m }]),
    });
    setRunning(false);
  }

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!plan) return;
    setDeciding(true);
    try {
      const p = await decidePlan(plan.id, { decision, notes, memo, selectedSiteIds: [...selected], closureSiteIds: [...closure] });
      adopt(p);
      dataMutated.emit();
    } finally {
      setDeciding(false);
    }
  }

  const a = plan?.analysis;
  const liveProjection = useMemo(() => {
    if (!a) return null;
    return project(a.projection_params, a.rescue_sites.filter((s) => selected.has(s.site_id)));
  }, [a, selected]);

  if (err) return <div className="p-8 text-[var(--destructive)]">Could not load the trial: {err}</div>;
  if (!ov) return <div className="mx-auto max-w-7xl space-y-4 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-[var(--muted)]" />)}</div>;

  const t = ov.trial;
  const cur = ov.curve[ov.curve.length - 1];
  const complete = ov.curve.filter((c) => c.is_complete_month).slice(-3);
  const runRate = complete.reduce((s, c) => s + c.randomized, 0) / Math.max(1, complete.length);
  const totalFails = ov.screenFails.reduce((s, r) => s + r.n, 0);
  const e4 = ov.screenFails.find((r) => r.criterion_id === 'E4');
  const codedOther = ov.coded.find((c) => c.coded_reason === 'OTHER')?.n ?? 0;
  const crit = Object.fromEntries(ov.criteria.map((c) => [c.criterion_id, c]));
  const e4Assumed = crit.E4?.feasibility_assumed_pass_rate != null ? 1 - crit.E4.feasibility_assumed_pass_rate : 0.15;
  const failRows = view === 'real'
    ? ov.screenFails.slice(0, 7).map((r) => ({ key: r.criterion_id, label: `${r.criterion_id === 'CONSENT_WITHDRAWN' ? '' : `${r.criterion_id} · `}${r.criterion_name}`, value: r.n, inner: r.coded, right: `${Math.round((r.n / totalFails) * 100)}%` }))
    : ov.coded.slice(0, 7).map((r) => ({ key: r.coded_reason === 'E4' ? 'E4' : r.coded_reason, label: r.coded_reason === 'OTHER' ? 'OTHER (free text)' : `${r.coded_reason} · ${crit[r.coded_reason]?.short_name ?? r.coded_reason}`, value: r.n, right: `${Math.round((r.n / totalFails) * 100)}%` }));
  const f = ov.funnel;
  const funnel = [
    { key: 'pool', label: 'T2D + CKD within 30 mi', value: f.t2d_ckd },
    { key: 'I2', label: 'I2 · eGFR 25–<60', value: f.egfr },
    { key: 'I3', label: 'I3 · UACR 300–5000', value: f.uacr },
    { key: 'I4', label: 'I4 · HbA1c ≤ 10.5%', value: f.hba1c },
    { key: 'E4', label: 'E4 · no SGLT2i (current)', value: f.eligible_current, right: n0(f.eligible_current) },
    { key: 'E4a', label: 'E4 amended (stable SGLT2i OK)', value: f.eligible_amended, right: n0(f.eligible_amended) },
  ];
  const decided = plan && plan.status !== 'draft';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div>
          <Link to="/" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft className="size-3" />Portfolio</Link>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">{t.phase} · {t.indication} · protocol HAL-301 v3.0 · study manager {t.study_manager}</div>
              <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">{t.acronym} — enrollment rescue</h1>
            </div>
            <Pill tone={t.pct_of_plan < 0.8 ? 'bad' : 'good'}>{pct(t.pct_of_plan)} of plan</Pill>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Randomized" value={n0(cur.cum_randomized)} sub={`of ${n0(cur.planned_cum_randomized)} planned to date`} tone="bad" />
          <Kpi label="Target" value={n0(t.target_enrollment)} sub={`planned last patient in ${monthLabel(t.planned_lpi_date)}`} />
          <Kpi label="Run rate" value={`${runRate.toFixed(0)}/mo`} sub="last 3 complete months" />
          <Kpi label="Screen-fail rate" value={pct(t.screen_fail_rate)} sub={`${pct(t.planned_screen_fail_rate)} assumed in feasibility`} tone="warn" />
          <Kpi label="Active sites" value={t.active_sites} sub={<Link className="underline" to="/sites">site network →</Link>} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Card title="Cumulative randomized vs plan" icon={FlaskConical}
            right={<div className="flex gap-3 text-xs"><span className="font-semibold text-[var(--primary)]">— actual</span><span className="font-semibold text-[var(--primary-light)]">- - plan</span></div>}>
            <EnrollmentChart curve={ov.curve} plan={ov.plan} target={t.target_enrollment} plannedLpi={t.planned_lpi_date} />
          </Card>
          <Card title="Why patients fail screening" icon={AlertTriangle}
            right={
              <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
                <button onClick={() => setView('coded')} className={cn('rounded-md px-2 py-1', view === 'coded' && 'bg-[var(--muted)] font-semibold')}>As coded in EDC</button>
                <button onClick={() => setView('real')} className={cn('rounded-md px-2 py-1', view === 'real' && 'bg-[var(--primary)] font-semibold text-white')}>Real reason (AI)</button>
              </div>
            }>
            <HBars rows={failRows} highlight="E4" />
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {view === 'coded'
                ? <>Sites coded <b>{codedOther}</b> of {totalFails} failures as <b>OTHER</b> with a free-text note — the EDC report shows E4 at only {pct((ov.coded.find((c) => c.coded_reason === 'E4')?.n ?? 0) / totalFails)}. Switch to the AI view.</>
                : <><b>ai_classify</b> read every OTHER note: <b>E4 — SGLT2 inhibitor use</b> is {pct((e4?.n ?? 0) / totalFails)} of all screen failures (dark = coded by the site, light = recovered by AI). {e4 ? pct(e4.stable_sglt2i / e4.n) : ''} of them were on a <b>stable dose ≥ 12 weeks</b> (ai_query).</>}
            </p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Card title={`Eligible patients around the ${f.sites} active sites (EHR network)`} icon={FileText}>
            <HBars rows={funnel} highlight="E4" />
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-[var(--muted)] px-3 py-2 text-xs"><div className="text-[var(--muted-foreground)]">On an SGLT2i today</div><div className="text-lg font-semibold text-[var(--brand-5)]">{pct(f.pct_on_sglt2i)}</div><div className="text-[var(--muted-foreground)]">2023 feasibility assumed {pct(e4Assumed)}</div></div>
              <div className="rounded-xl bg-[var(--muted)] px-3 py-2 text-xs"><div className="text-[var(--muted-foreground)]">Stable ≥ 12 weeks</div><div className="text-lg font-semibold">{n0(f.stable_sglt2i)}</div><div className="text-[var(--muted-foreground)]">of {n0(f.on_sglt2i)} SGLT2i users</div></div>
              <div className="rounded-xl bg-[var(--success-subtle)] px-3 py-2 text-xs"><div className="text-[var(--muted-foreground)]">Eligible pool with amended E4</div><div className="text-lg font-semibold text-[var(--success)]">{(f.eligible_amended / f.eligible_current).toFixed(2)}×</div><div className="text-[var(--muted-foreground)]">{n0(f.eligible_current)} → {n0(f.eligible_amended)} patients</div></div>
            </div>
            <div className="mt-3 flex items-end gap-1" title="Share of the T2D+CKD population on an SGLT2 inhibitor, by quarter">
              {ov.sglt2Trend.map((q) => (
                <div key={q.quarter} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-[var(--primary-light)]" style={{ height: `${q.pct_on_sglt2i * 90}px`, opacity: 0.35 + q.pct_on_sglt2i }} />
                  <span className="text-[9px] text-[var(--muted-foreground)]">{q.quarter.replace('-Q', ' Q')}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">SGLT2 inhibitor use in T2D + CKD, {ov.sglt2Trend[0]?.quarter} → today: {pct(ov.sglt2Trend[0]?.pct_on_sglt2i)} → {pct(ov.sglt2Trend[ov.sglt2Trend.length - 1]?.pct_on_sglt2i)}</div>
          </Card>
          <Card title="Site health" icon={Building2}>
            {ov.competition && (
              <div className="rounded-xl border border-[#F3C9BF] bg-[#FDF1EE] px-4 py-3 text-sm">
                <div className="font-semibold text-[var(--brand-5)]">{ov.competition.acronym} ({ov.competition.sponsor}) opened {monthLabel(ov.competition.start_date)}</div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)]">{ov.competition.overlap_note}</div>
                <div className="mt-2 text-sm">At our <b>{ov.competition.sites}</b> shared sites randomization fell <b>{ov.competition.rate_before} → {ov.competition.rate_since}</b> per site per month (other sites: {ov.competition.rate_others_since}).</div>
              </div>
            )}
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Site activation (selection → first patient ready)</div>
            <div className="mt-1 space-y-1">
              {['central', 'local'].map((irb) => {
                const rows = ov.activation.filter((r) => r.irb_type === irb);
                const sites = rows.reduce((s, r) => s + r.sites, 0);
                const med = rows.length ? Math.round(rows.reduce((s, r) => s + r.median_days * r.sites, 0) / Math.max(1, sites)) : 0;
                return (
                  <div key={irb} className="grid grid-cols-[110px_1fr_70px] items-center gap-2 text-sm">
                    <span>{irb === 'central' ? 'Central IRB' : 'Local IRB'}</span>
                    <div className="h-3 rounded-full bg-[var(--muted)]"><div className="h-3 rounded-full" style={{ width: `${(med / 300) * 100}%`, background: irb === 'local' ? 'var(--brand-4)' : 'var(--primary-light)' }} /></div>
                    <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">~{med} days</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-[var(--muted-foreground)]">Rescue sites on the central IRB activate in ~4 months — the amendment itself takes ~6 weeks (central) to ~10 weeks (local) per SOP CLINOPS-014.</div>
          </Card>
        </div>

        {/* ── The rescue analysis ─────────────────────────────────────────── */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-[var(--brand-5)]" />Enrollment rescue plan</div>
              <div className="text-sm text-[var(--muted-foreground)]">Reads the screening log, the EHR-network catchment and the site model, asks the protocol (Genie agent), projects last-patient-in and drafts the amendment memo.</div>
            </div>
            <button onClick={run} disabled={running}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {plan ? 'Re-run rescue analysis' : 'Run rescue analysis'}
            </button>
          </div>

          {(running || (!plan && steps.length > 0)) && (
            <ol className="mt-4 space-y-2">
              {steps.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  {s.status === 'running' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--primary-light)]" /> : s.status === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" />}
                  <div><div className="font-medium">{s.label}</div>{s.detail && <div className="text-xs text-[var(--muted-foreground)]">{s.detail}</div>}</div>
                </li>
              ))}
              {running && <li className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><CircleDashed className="size-4 animate-spin" />working…</li>}
            </ol>
          )}

          {!plan && !running && steps.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
              No rescue plan yet for {t.acronym}. Run the analysis — it takes about a minute.
            </div>
          )}

          {a && liveProjection && (
            <div className="mt-5 space-y-5">
              {decided && (
                <div className={cn('flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium', plan!.status === 'approved' ? 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]' : 'bg-[#FBE3E6] text-[#9B1C2E]')}>
                  {plan!.status === 'approved' ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  Rescue plan {plan!.status} by {plan!.decidedBy} · {plan!.selectedSiteIds.length} rescue sites sent to start-up · {plan!.closureSiteIds.length} sites under closure review · written to Lakebase
                </div>
              )}
              <div className="rounded-xl bg-[var(--info-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--info-subtle-foreground)]">{a.summary}</div>

              <div className="grid gap-4 lg:grid-cols-2">
                {a.recommendation.amend.map((r) => (
                  <div key={r.criterion_id} className="rounded-2xl border-2 border-[var(--success)] p-4">
                    <div className="flex items-center gap-2 font-semibold text-[var(--success)]"><CheckCircle2 className="size-4" />Amend {r.criterion_id} — protocol v4.0</div>
                    <div className="mt-2 text-xs uppercase text-[var(--muted-foreground)]">From</div>
                    <div className="text-sm line-through decoration-[var(--brand-5)]/60">{r.from}</div>
                    <div className="mt-2 text-xs uppercase text-[var(--muted-foreground)]">To</div>
                    <div className="text-sm font-medium">{r.to}</div>
                    <div className="mt-2 text-xs text-[var(--muted-foreground)]">{r.why} Eligible pool {a.pool.multiplier}× · existing sites’ rate ×{a.projection_params.amendmentUplift.toFixed(2)} · ~{a.projection_params.rescreenBolus} prior screen-fails recoverable by re-screening.</div>
                  </div>
                ))}
                {a.recommendation.do_not_amend.map((r) => (
                  <div key={r.criterion_id} className="rounded-2xl border border-[var(--border)] p-4">
                    <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="size-4 text-[var(--brand-4)]" />Keep {r.criterion_id} (potassium ≤ 4.8) as is</div>
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">{r.why}</p>
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">E7 is {pct(a.screen_fails.by_criterion.find((x) => x.criterion_id === 'E7')?.share ?? 0)} of screen failures — tempting, but it is a safety criterion.</p>
                  </div>
                ))}
              </div>

              {a.protocol_guidance && (
                <div className="rounded-2xl border border-[var(--border)] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"><BookOpen className="size-4" />Protocol guidance (Genie agent over protocol v3.0, SAP, SOP)</div>
                  <div className="prose prose-sm mt-2 max-h-80 max-w-none overflow-y-auto pr-2 text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{a.protocol_guidance.answer}</ReactMarkdown></div>
                  {a.protocol_guidance.source && <div className="mt-2 text-xs text-[var(--muted-foreground)]">Sources: {a.protocol_guidance.source}</div>}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
                <div className="rounded-2xl border border-[var(--border)] p-4">
                  <div className="font-semibold">Projected cumulative randomized</div>
                  <EnrollmentChart curve={ov.curve} plan={ov.plan} target={t.target_enrollment} plannedLpi={t.planned_lpi_date} scenarios={liveProjection} height={240} />
                </div>
                <div className="space-y-2">
                  {liveProjection.map((s) => (
                    <div key={s.key} className="rounded-xl border border-[var(--border)] px-4 py-3" style={{ borderLeft: `5px solid ${SCENARIO_COLOR[s.key]}` }}>
                      <div className="text-xs text-[var(--muted-foreground)]">{s.label}</div>
                      <div className="flex items-baseline justify-between">
                        <div className="text-xl font-semibold">Last patient in {monthLabel(s.lpi_date)}</div>
                        <div className={cn('text-sm font-semibold', (s.months_late ?? 99) > 6 ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{s.months_late == null ? '>6 yrs' : `+${s.months_late} mo`}</div>
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)]">{s.monthly_rate_end} randomized / month at steady state</div>
                    </div>
                  ))}
                  <div className="text-[11px] text-[var(--muted-foreground)]">Deterministic projection (no LLM): run rate {a.projection_params.runRate}/mo; amendment effective after {a.projection_params.amendmentLagMonths} months; new sites ramp 50→75→100% from their activation month. Tick sites below to re-project.</div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)]">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="font-semibold">Rescue sites — ranked by site_enrollment_model@champion (v{a.model.version})</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{selected.size} selected · +{a.rescue_sites.filter((s) => selected.has(s.site_id)).reduce((x, s) => x + s.predicted_rate_amended, 0).toFixed(1)} randomized/mo once active</div>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      <tr>{['', '#', 'Site', 'IRB', 'Eligible (today → amended)', 'Track record', 'Predicted /mo', 'Active in', 'Exp. 12 mo'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {a.rescue_sites.map((s, i) => (
                        <tr key={s.site_id} className={cn('border-t border-[var(--border)]', selected.has(s.site_id) && 'bg-[var(--success-subtle)]/40')} title={s.rationale}>
                          <td className="px-3 py-2"><input type="checkbox" disabled={!!decided} checked={selected.has(s.site_id)} aria-label={`select ${s.site_name}`}
                            onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.site_id); else n.delete(s.site_id); return n; })} /></td>
                          <td className="px-3 py-2 tabular-nums text-[var(--muted-foreground)]">{i + 1}</td>
                          <td className="px-3 py-2"><div className="font-medium">{s.site_name}</div><div className="text-xs text-[var(--muted-foreground)]">{s.city}, {s.state}</div></td>
                          <td className="px-3 py-2"><Pill tone={s.irb_type === 'central' ? 'info' : 'warn'}>{s.irb_type}</Pill></td>
                          <td className="px-3 py-2 tabular-nums">{n0(s.eligible_current)} → <b>{n0(s.eligible_amended)}</b></td>
                          <td className="px-3 py-2 tabular-nums">{s.hist_rate.toFixed(2)}/mo</td>
                          <td className="px-3 py-2 tabular-nums font-semibold">{s.predicted_rate_amended.toFixed(2)}</td>
                          <td className="px-3 py-2 tabular-nums">{s.est_activation_months} mo</td>
                          <td className="px-3 py-2 tabular-nums">{s.expected_randomized_12m}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] p-4">
                <div className="font-semibold">Sites to review for closure — active ≥ 6 months, 0 randomized ({a.zero_enrollers.length})</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {a.zero_enrollers.map((z) => (
                    <label key={z.site_id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                      <input type="checkbox" disabled={!!decided} checked={closure.has(z.site_id)}
                        onChange={(e) => setClosure((prev) => { const n = new Set(prev); if (e.target.checked) n.add(z.site_id); else n.delete(z.site_id); return n; })} />
                      <span className="flex-1"><b>{z.site_name}</b> <span className="text-[var(--muted-foreground)]">({z.city}) · {z.months_active.toFixed(0)} mo · {z.screened} screened</span></span>
                      {z.competing_trial && <Pill tone="bad">{z.competing_trial}</Pill>}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Rescue-plan memo (AI draft — edit before approving)</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{a.model_used}</div>
                </div>
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} disabled={!!decided} rows={14}
                  className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs leading-relaxed" />
                {!decided && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Decision note (optional)"
                      className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" />
                    <button onClick={() => decide('REJECTED')} disabled={deciding} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">Reject</button>
                    <button onClick={() => decide('APPROVED')} disabled={deciding}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {deciding ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                      Approve rescue plan ({selected.size} sites)
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[var(--border)] p-4">
                <div className="font-semibold">Audit trail (Lakebase)</div>
                <ul className="mt-2 space-y-1 text-sm">
                  {plan!.auditTrail.map((e, i) => (
                    <li key={i} className="flex gap-3"><span className="w-40 shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{new Date(e.at).toLocaleString()}</span><span><b>{ACTION[e.action] ?? e.action}</b> · {e.by}{e.notes ? ` — ${e.notes}` : ''}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
