/**
 * Case workbench — one application, end to end:
 *   left  : household + every verification document, the OCR "scan" next to the
 *           fields ai_extract pulled out of it (with confidence)
 *   right : the AI eligibility check (streamed steps → rule-by-rule table with
 *           citations → missing documents → policy-manual guidance → notice draft)
 *           and the caseworker decision that writes back to Lakebase + audit trail.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, CheckCircle2, ChevronDown, CircleAlert, FileSearch, Flag,
  Loader2, Send, ShieldCheck, Sparkles, UserRound, X, XCircle, Zap,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  DOC_LABEL, decide, fetchCase, fullName, money, runAssessment,
  type Assessment, type CaseDetail, type CaseDocument, type StepEvent,
} from './api';
import { DeadlineMeter, Pill, RESULT_LABEL, RESULT_TONE, StatusPill, cn } from './ui';

const FIELD_LABEL: Record<string, string> = {
  person_name: 'Name', issuer: 'Issued by', document_date: 'Date', expiration_date: 'Expires / ends',
  employment_end_date: 'Employment ends', gross_pay: 'Gross pay', pay_frequency: 'Frequency',
  street_address: 'Address', city: 'City', state: 'State', monthly_rent: 'Monthly rent',
  account_balance: 'Balance', declares_no_income: 'Declares no income',
};

function DocumentCard({ doc, highlighted }: { doc: CaseDocument; highlighted: boolean }) {
  const [open, setOpen] = useState(false);
  const fields = Object.entries(doc.extracted ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const conf = doc.extractionConfidence;
  return (
    <div className={cn('rounded-xl border bg-[var(--card)] transition-shadow', highlighted ? 'border-[var(--primary-light)] shadow-[0_0_0_3px_var(--info-subtle)]' : 'border-[var(--border)]')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <FileSearch className="size-4 text-[var(--primary-light)]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{DOC_LABEL[doc.docType] ?? doc.docType}</div>
          <div className="text-xs text-[var(--muted-foreground)] truncate">
            {doc.extracted?.issuer ?? doc.fileName} {doc.extracted?.document_date ? `· ${doc.extracted.document_date}` : ''}
          </div>
        </div>
        {conf != null && <Pill tone={conf >= 0.9 ? 'good' : 'warn'}>AI {Math.round(conf * 100)}%</Pill>}
        <ChevronDown className={cn('size-4 text-[var(--muted-foreground)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 border-t border-[var(--border)] p-3">
          <pre className="max-h-64 overflow-auto rounded-lg bg-[#FBFAF6] border border-[#ECE7DA] p-3 font-mono text-[11px] leading-relaxed text-[#3B3A36] whitespace-pre-wrap">{doc.documentText}</pre>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><Sparkles className="size-3" />Extracted by ai_extract</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {fields.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[var(--muted-foreground)]">{FIELD_LABEL[k] ?? k}</dt>
                  <dd className="font-medium">{typeof v === 'number' ? (['gross_pay', 'monthly_rent', 'account_balance'].includes(k) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

const STEP_ICON = { running: Loader2, done: CheckCircle2, error: CircleAlert };

function Steps({ steps }: { steps: StepEvent[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const Icon = STEP_ICON[s.status];
        return (
          <li key={s.id} className="flex gap-2.5 text-sm">
            <Icon className={cn('mt-0.5 size-4 shrink-0', s.status === 'running' && 'animate-spin text-[var(--primary-light)]', s.status === 'done' && 'text-[var(--success)]', s.status === 'error' && 'text-[var(--destructive)]')} />
            <div className="min-w-0">
              <div className="font-medium">{s.label}</div>
              {s.detail && <div className="text-xs text-[var(--muted-foreground)]">{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const REC = {
  APPROVE: { label: 'Recommend: approve', tone: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]', icon: CheckCircle2 },
  DENY: { label: 'Recommend: deny', tone: 'bg-[#FBE3E6] text-[#9B1C2E]', icon: XCircle },
  REQUEST_VERIFICATION: { label: 'Recommend: request missing documents', tone: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]', icon: AlertTriangle },
} as const;

function AssessmentView({ a, onHover }: { a: Assessment; onHover: (ids: string[]) => void }) {
  const R = REC[a.recommendation];
  return (
    <div className="space-y-4">
      <div className={cn('rounded-xl px-4 py-3', R.tone)}>
        <div className="flex items-center gap-2 font-semibold"><R.icon className="size-5" />{R.label}</div>
        <p className="mt-1 text-sm leading-relaxed">{a.summary}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>Countable income <b>{money(a.countable_monthly_income)}</b>/mo · limit {money(a.income_limit)}</span>
          {a.estimated_monthly_benefit != null && <span>Est. benefit <b>{money(a.estimated_monthly_benefit)}</b>/mo</span>}
          {a.timeliness.expedited && <span className="font-semibold">Expedited · 7-day standard</span>}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Rule-by-rule check</div>
        {a.rules.map((r) => (
          <div key={r.rule_id} data-rule={r.rule_id} onMouseEnter={() => onHover(r.evidence)} onMouseLeave={() => onHover([])}
            className="grid grid-cols-[88px_1fr] gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0">
            <div><Pill tone={RESULT_TONE[r.result]}>{r.result === 'PASS' ? <Check className="size-3" /> : r.result === 'FAIL' ? <X className="size-3" /> : r.result === 'FLAG' ? <Flag className="size-3" /> : <AlertTriangle className="size-3" />}{RESULT_LABEL[r.result]}</Pill></div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{r.rule_name}</div>
              <div className="text-xs text-[var(--foreground)]/80 leading-relaxed">{r.finding}</div>
              <div className="mt-0.5 text-[11px] text-[var(--primary-light)]">{r.cfr_citation} · {r.manual_section}</div>
            </div>
          </div>
        ))}
      </div>

      {a.missing_documents.length > 0 && (
        <div className="rounded-xl border border-[#F3C9CF] bg-[#FFF7F8] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#9B1C2E]"><AlertTriangle className="size-4" />Missing or insufficient documents ({a.missing_documents.length})</div>
          <ul className="mt-1.5 space-y-1 text-xs">
            {a.missing_documents.map((m) => <li key={m.item}><b>{m.item}</b> — {m.why} <span className="text-[var(--muted-foreground)]">Accept: {m.acceptable}</span></li>)}
          </ul>
        </div>
      )}

      {a.policy_guidance && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--info-subtle)]/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"><BookOpen className="size-4" />Policy manual (Genie agent)</div>
          <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">“{a.policy_guidance.question}”</div>
          <div className="mt-1.5 text-sm leading-relaxed space-y-1.5 [&_strong]:font-semibold"><ReactMarkdown>{a.policy_guidance.answer.replace(/\)\s+\*\*/g, ")\n\n**")}</ReactMarkdown></div>
          {a.policy_guidance.source && <div className="mt-1 text-[11px] text-[var(--primary-light)]">Sources: {a.policy_guidance.source}</div>}
        </div>
      )}
    </div>
  );
}

const DECISIONS = [
  { key: 'APPROVED', label: 'Approve & send notice', icon: ShieldCheck, cls: 'bg-[var(--success)] text-white' },
  { key: 'RFI_SENT', label: 'Send document request', icon: Send, cls: 'bg-[var(--primary)] text-white' },
  { key: 'DENIED', label: 'Deny & send notice', icon: XCircle, cls: 'bg-[var(--destructive)] text-white' },
  { key: 'ESCALATED', label: 'Escalate to supervisor', icon: Flag, cls: 'bg-[var(--card)] border border-[var(--border)]' },
] as const;

const ACTION_LABEL: Record<string, string> = {
  ai_check: 'AI eligibility check', approved: 'Approved', denied: 'Denied', rfi_sent: 'Request for verification sent',
  escalated: 'Escalated', notice_edited: 'Notice edited', note: 'Note',
};

export function CaseWorkbench() {
  const { id = '' } = useParams();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [hover, setHover] = useState<string[]>([]);

  const load = useCallback(() => {
    fetchCase(id).then((d) => { setC(d); setNotice(d.noticeDraft ?? ''); setError(null); }).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { setSteps([]); load(); }, [load]);

  const run = async () => {
    setRunning(true);
    setSteps([]);
    await runAssessment(id, {
      step: (e) => setSteps((prev) => { const i = prev.findIndex((p) => p.id === e.id); return i >= 0 ? prev.map((p, j) => (j === i ? e : p)) : [...prev, e]; }),
      result: (r) => {
        setC((prev) => prev && { ...prev, assessment: r.assessment, noticeDraft: r.notice.text, noticeType: r.notice.type, noticeLanguage: r.notice.language });
        setNotice(r.notice.text);
      },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Eligibility check failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
    dataMutated.emit();
  };

  const submit = async (decision: string) => {
    setSaving(decision);
    try {
      const d = await decide(id, { decision, notes: notes || undefined, noticeText: notice });
      setC(d);
      setNotice(d.noticeDraft ?? '');
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (error && !c) return <div className="p-8 text-[var(--destructive)]">Could not load case {id}: {error}</div>;
  if (!c) return <div className="p-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-[var(--muted)] animate-pulse" />)}</div>;

  const a = c.assessment;
  const standard = c.expeditedScreening ? 7 : c.program === 'Medicaid' ? 45 : 30;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/cases" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft className="size-3" />Caseload</Link>
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-[var(--primary)] px-6 py-4 text-white">
          <div>
            <div className="text-xs text-white/70">{c.id} · filed {c.submittedDate} by {c.channel?.replace('_', ' ')} · {c.county} County</div>
            <h1 className="font-display text-2xl font-semibold">{fullName(c)}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="neutral" className="bg-white/15 text-white">{c.program}</Pill>
              <Pill tone="neutral" className="bg-white/15 text-white">Household of {c.householdSize}</Pill>
              {c.preferredLanguage && c.preferredLanguage !== 'English' && <Pill tone="neutral" className="bg-white/15 text-white">Prefers {c.preferredLanguage}</Pill>}
              {(c.expeditedScreening || a?.timeliness.expedited) && <Pill tone="bad"><Zap className="size-3" />Expedited</Pill>}
              <StatusPill status={c.status} />
            </div>
          </div>
          <div className="min-w-[240px] rounded-xl bg-white/10 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-white/70">Federal processing standard</div>
            <div className="mt-1 [&_span]:!text-white"><DeadlineMeter daysOpen={c.daysOpen} standard={a?.timeliness.standard_days ?? standard} /></div>
            <div className="mt-1 text-xs text-white/80">
              {c.daysOpen > (a?.timeliness.standard_days ?? standard) ? `${c.daysOpen - (a?.timeliness.standard_days ?? standard)} days past the deadline` : `${(a?.timeliness.standard_days ?? standard) - c.daysOpen} days left`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><UserRound className="size-4 text-[var(--primary-light)]" />Household</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-[var(--muted-foreground)]">Address</dt><dd>{c.streetAddress}, {c.city} WB {c.zipCode}</dd>
                <dt className="text-[var(--muted-foreground)]">Head of household</dt><dd>{fullName(c)}, {c.headAge}</dd>
                <dt className="text-[var(--muted-foreground)]">Children under 18</dt><dd>{c.childrenUnder18 ?? 0}</dd>
                <dt className="text-[var(--muted-foreground)]">Reported income</dt><dd>{money(c.reportedMonthlyIncome)}/mo</dd>
                <dt className="text-[var(--muted-foreground)]">Reported resources</dt><dd>{money(c.reportedLiquidResources)}</dd>
                <dt className="text-[var(--muted-foreground)]">Caseworker</dt><dd>{c.caseworkerName} <span className="text-[var(--muted-foreground)]">({c.caseworkerUnit})</span></dd>
              </dl>
            </div>
            <div className="flex items-center justify-between px-1">
              <div className="text-sm font-semibold">Verification documents ({c.documents.length})</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">click to see the scan vs. extracted fields</div>
            </div>
            {c.documents.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">No documents received.</div>}
            {c.documents.map((d) => <DocumentCard key={d.id} doc={d} highlighted={hover.includes(d.id)} />)}

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-sm font-semibold">Audit trail</div>
              {c.auditTrail.length === 0 && <div className="mt-1 text-xs text-[var(--muted-foreground)]">No actions yet.</div>}
              <ol className="mt-2 space-y-1.5">
                {[...c.auditTrail].reverse().map((e, i) => (
                  <li key={i} className="text-xs"><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span> · {e.by} · <span className="text-[var(--muted-foreground)]">{new Date(e.at).toLocaleString()}</span>{e.notes && <div className="text-[var(--muted-foreground)]">{e.notes}</div>}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />AI eligibility check</div>
                  <div className="text-xs text-[var(--muted-foreground)]">Reads every document, checks each {c.program} rule, consults the policy manual, drafts the notice. You decide.</div>
                </div>
                <button onClick={run} disabled={running} data-testid="run-check"
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {a ? 'Re-run check' : 'Run eligibility check'}
                </button>
              </div>
              {steps.length > 0 && <div className="mt-4 rounded-xl bg-[var(--muted)]/60 p-3"><Steps steps={steps} /></div>}
              {a && !running && <div className="mt-4"><AssessmentView a={a} onHover={setHover} /></div>}
              {!a && steps.length === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                  Not checked yet. The check takes ~20 seconds.
                </div>
              )}
            </div>

            {(a || c.decision) && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Resident notice {c.noticeType && <span className="font-normal text-[var(--muted-foreground)]">· {c.noticeType.replace(/_/g, ' ')} · {c.noticeLanguage}</span>}</div>
                  <Pill tone="info">AI draft — review before sending</Pill>
                </div>
                <textarea value={notice} onChange={(e) => setNotice(e.target.value)} disabled={!!c.decision} data-testid="notice"
                  className="h-72 w-full resize-y rounded-lg border border-[var(--border)] bg-[#FDFDFB] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary-light)]" />
                {c.decision ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-sm text-[var(--success-subtle-foreground)]">
                    <CheckCircle2 className="size-4" />
                    Decision recorded: <b>{c.decision.replace('_', ' ')}</b> by {c.decidedBy} · {c.decidedAt && new Date(c.decidedAt).toLocaleString()}
                    {c.monthlyBenefitAmount != null && <> · benefit {money(c.monthlyBenefitAmount)}/mo</>}
                  </div>
                ) : (
                  <>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Caseworker note (optional)"
                      className="h-9 w-full rounded-lg border border-[var(--border)] px-3 text-sm outline-none" />
                    <div className="flex flex-wrap gap-2">
                      {DECISIONS.map((d) => (
                        <button key={d.key} onClick={() => submit(d.key)} disabled={!!saving} data-decision={d.key}
                          className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50', d.cls,
                            a && ((a.recommendation === 'APPROVE' && d.key === 'APPROVED') || (a.recommendation === 'DENY' && d.key === 'DENIED') || (a.recommendation === 'REQUEST_VERIFICATION' && d.key === 'RFI_SENT')) && 'ring-2 ring-offset-2 ring-[var(--brand-4)]')}>
                          {saving === d.key ? <Loader2 className="size-4 animate-spin" /> : <d.icon className="size-4" />}{d.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
