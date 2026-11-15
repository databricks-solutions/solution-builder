/**
 * Submission workbench — one broker submission, end to end:
 *   left  : what the application SAYS vs what the documents SHOW (AI-extracted statement of values + loss run),
 *           the original PDFs, the ML risk as submitted vs verified.
 *   right : the underwriting review (streamed steps → decision + premium → per-location pricing → rules with
 *           guideline references → Genie guideline answer → rationale → broker letter) and the issue / refer actions.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, CheckCircle2, ChevronDown, CircleAlert, FileText, Gavel, Loader2, Mail,
  RefreshCw, Scale, Send, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  DECISION_LABEL, fetchSubmission, issueDecision, money, musd, pdfUrl, runReview, shortDate, type Review, type StepEvent, type SubmissionDetail,
} from './api';
import { BandPill, LanePill, Pill, StatusPill, TierBadge, cn } from './ui';

function Steps({ steps }: { steps: StepEvent[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} className="flex gap-2 text-sm">
          {s.status === 'running' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--primary-light)]" />
            : s.status === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
              : <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" />}
          <div className="min-w-0">
            <div className="font-medium">{s.label}</div>
            {s.detail && <div className="text-xs text-[var(--muted-foreground)] break-words">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const RULE_TONE = { pass: 'good', fail: 'bad', refer: 'warn', info: 'info', resolved: 'neutral' } as const;
const DOC_LABEL: Record<string, string> = { APPLICATION: 'Application (ACORD 125/140)', SOV: 'Statement of values', LOSS_RUN: 'Loss run' };

function Compare({ s }: { s: SubmissionDetail }) {
  const oldestRoof = Math.min(...s.locations.map((l) => l.roofYear ?? 9999));
  const frame = s.locations.filter((l) => (l.construction ?? '').toLowerCase().includes('frame'));
  const unspr = s.locations.filter((l) => !l.sprinklered);
  const rows: Array<[string, string, string, boolean]> = [
    ['Locations', String(s.app.locations ?? '—'), String(s.locations.length), (s.app.locations ?? 0) !== s.locations.length],
    ['Total insured value', musd(s.app.tiv), musd(s.sovTiv), Math.abs((s.app.tiv ?? 0) - s.sovTiv) / Math.max(1, s.sovTiv) > 0.02],
    ['Construction', s.app.construction ?? '—', frame.length ? `${frame.length} frame (Loc ${frame.map((l) => l.locNo).join(', ')})` : [...new Set(s.locations.map((l) => l.construction))].join(', '),
      !!frame.length && !(s.app.construction ?? '').toLowerCase().includes('frame')],
    ['Roof last replaced', String(s.app.roof_year ?? '—'), `oldest ${oldestRoof} (${2026 - oldestRoof} yrs)`, oldestRoof < (s.app.roof_year ?? 0)],
    ['Sprinklered', s.app.sprinklered ? 'Yes' : 'No', unspr.length ? `${unspr.length} building(s) not sprinklered` : 'All buildings', !!s.app.sprinklered && unspr.length > 0],
    ['Losses, 5 years', `${s.app.loss_count ?? 0} · ${money(s.app.loss_amount)}`, `${s.claims.length} · ${money(s.lossRunIncurred)}`,
      s.claims.length > (s.app.loss_count ?? 0) || s.lossRunIncurred > (s.app.loss_amount ?? 0) * 1.05 + 1000],
  ];
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
        <tr><th className="py-1.5 text-left font-medium" /><th className="py-1.5 text-left font-medium">Application says</th><th className="py-1.5 text-left font-medium">Documents show (SOV + loss run)</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, a, d, bad]) => (
          <tr key={k} className={cn('border-t border-[var(--border)]', bad && 'bg-[#FBE9E5]')}>
            <td className="py-1.5 pr-2 text-[var(--muted-foreground)]">{k}</td>
            <td className="py-1.5 pr-2 tabular-nums">{a}</td>
            <td className={cn('py-1.5 tabular-nums', bad && 'font-semibold text-[var(--brand-5)]')}>{bad && <AlertTriangle className="mr-1 inline size-3.5" />}{d}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sov({ s, review }: { s: SubmissionDetail; review: Review | null }) {
  const q = new Map((review?.locations ?? []).map((l) => [l.loc_no, l]));
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
        <tr>{['#', 'Building', 'Construction', 'Built', 'Roof', 'Sprk', 'PC', 'TIV', ...(review ? ['Premium'] : [])].map((h) => <th key={h} className="py-1.5 pr-2 text-left font-medium">{h}</th>)}</tr>
      </thead>
      <tbody>
        {s.locations.map((l) => {
          const old = (l.roofAgeYears ?? 0) > 15;
          const lq = q.get(l.locNo);
          return (
            <tr key={l.id} className={cn('border-t border-[var(--border)]', lq && !lq.included && 'bg-[#FBE9E5]')}>
              <td className="py-1.5 pr-2 tabular-nums">{l.locNo}</td>
              <td className="py-1.5 pr-2"><div className="font-medium">{l.buildingName}</div><div className="text-[11px] text-[var(--muted-foreground)]">{l.address}, {l.city} {l.state}{l.units ? ` · ${l.units} units` : ''}</div></td>
              <td className={cn('py-1.5 pr-2 text-xs', (l.construction ?? '').toLowerCase().includes('frame') && 'font-semibold text-[var(--brand-5)]')}>{l.construction}</td>
              <td className="py-1.5 pr-2 tabular-nums">{l.yearBuilt}</td>
              <td className={cn('py-1.5 pr-2 tabular-nums', old && 'font-semibold text-[var(--brand-5)]')}>{l.roofYear}<div className="text-[10px]">{l.roofAgeYears} yrs</div></td>
              <td className={cn('py-1.5 pr-2', !l.sprinklered && 'font-semibold text-[var(--brand-5)]')}>{l.sprinklered ? 'Y' : 'N'}</td>
              <td className="py-1.5 pr-2 tabular-nums">{l.protectionClass}</td>
              <td className="py-1.5 pr-2 tabular-nums">{musd(l.tiv)}</td>
              {review && <td className="py-1.5 tabular-nums">{lq?.included ? money(lq.premium) : <span className="text-xs font-semibold text-[var(--brand-5)]">excluded</span>}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SubmissionWorkbench() {
  const { id = '' } = useParams();
  const [s, setS] = useState<SubmissionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'compare' | 'sov' | 'losses' | 'docs'>('compare');
  const [letterOpen, setLetterOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(() => fetchSubmission(id).then(setS).catch((e) => setErr((e as Error).message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => dataMutated.subscribe(() => { load(); }), [load]);

  async function run() {
    setRunning(true);
    setSteps([]);
    setResult(null);
    await runReview(id, {
      step: (e) => setSteps((x) => [...x.filter((y) => y.id !== e.id), e]),
      result: () => { load(); dataMutated.emit(); },
      error: (m) => setSteps((x) => [...x, { id: 'err', label: 'Review failed', status: 'error', detail: m }]),
    });
    setRunning(false);
  }

  async function issue() {
    setActing(true);
    try {
      const r = await issueDecision(id);
      setResult(r.status === 'decided' ? `Issued to the broker — written to Lakebase and back to Delta (uw_decisions): ${r.deltaWriteBack}` : 'Referred to the Chief Underwriting Officer.');
      await load();
      dataMutated.emit();
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  if (err) return <div className="p-8 text-[var(--destructive)]">{err}</div>;
  if (!s) return <div className="p-8"><div className="h-40 animate-pulse rounded-2xl bg-[var(--muted)]" /></div>;
  const r = s.review;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/queue" className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"><ArrowLeft className="size-4" />Submission queue</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              {s.id} · received {shortDate(s.receivedTs)} · {s.brokerName} <TierBadge tier={s.brokerTier} /> · {s.brokerContact}
            </div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">{s.insuredName}</h1>
            <div className="text-sm text-[var(--muted-foreground)]">{s.segment} · {s.state}{s.hailBelt ? ' (hail belt)' : ''} · property + GL package effective <b className="text-[var(--foreground)]">{shortDate(s.effectiveDate)}</b> ({s.daysToEffective} days){s.targetPremium ? ` · broker target ${money(s.targetPremium)}` : ''}</div>
          </div>
          <div className="flex items-center gap-2"><LanePill lane={s.triageLane} /><StatusPill status={s.status} /></div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">TIV (SOV)</div><div className="text-xl font-semibold tabular-nums">{musd(s.sovTiv)}</div><div className="text-[11px] text-[var(--muted-foreground)]">{s.locations.length} locations</div></div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Discrepancies</div><div className={cn('text-xl font-semibold tabular-nums', s.discrepancies.length && 'text-[var(--brand-5)]')}>{s.discrepancies.length}</div><div className="text-[11px] text-[var(--muted-foreground)]">application vs documents</div></div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Loss run, 5 yrs</div><div className={cn('text-xl font-semibold tabular-nums', s.claims.length > (s.app.loss_count ?? 0) && 'text-[var(--brand-5)]')}>{s.claims.length} · {money(s.lossRunIncurred)}</div><div className="text-[11px] text-[var(--muted-foreground)]">application: {s.app.loss_count} · {money(s.app.loss_amount)}</div></div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Risk as submitted</div><div className="mt-1"><BandPill band={s.bandAsSubmitted} p={s.pAsSubmitted} /></div><div className="text-[11px] text-[var(--muted-foreground)]">on the application</div></div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Risk verified</div><div className="mt-1"><BandPill band={s.bandVerified} p={s.pVerified} /></div><div className="text-[11px] text-[var(--muted-foreground)] truncate" title={s.riskDrivers ?? ''}>{s.riskDrivers}</div></div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="flex flex-wrap gap-1 px-4 pt-3">
                <div className="flex gap-1 rounded-lg bg-[var(--muted)] p-0.5 text-sm">
                  {([['compare', 'Application vs documents'], ['sov', `Statement of values (${s.locations.length})`], ['losses', `Loss run (${s.claims.length})`], ['docs', `PDFs (${s.documents.length})`]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)} className={cn('rounded-md px-3 py-1', tab === k && 'bg-[var(--card)] shadow-sm font-medium')}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="px-4 pb-4 pt-2">
                {tab === 'compare' && (
                  <div className="space-y-3">
                    <Compare s={s} />
                    {s.discrepancies.length > 0 && (
                      <ul className="space-y-1 rounded-xl border border-[#F2C9BF] bg-[#FDF3F0] p-3 text-xs">
                        {s.discrepancies.map((d) => <li key={d} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-5)]" />{d}</li>)}
                      </ul>
                    )}
                    {s.remarks && <div className="rounded-xl bg-[var(--muted)]/50 p-3 text-xs"><span className="font-semibold">Broker remarks:</span> <span className="italic">“{s.remarks}”</span></div>}
                  </div>
                )}
                {tab === 'sov' && <Sov s={s} review={r} />}
                {tab === 'losses' && (
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr>{['Date', 'Loc', 'Line', 'Cause', 'Incurred', 'Status'].map((h) => <th key={h} className="py-1.5 pr-2 text-left font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {s.claims.length === 0 && <tr><td colSpan={6} className="py-3 text-sm text-[var(--muted-foreground)]">No losses reported — {s.lossRunCarrier}, valued {shortDate(s.lossRunValued)}, {s.lossRunYears} years.</td></tr>}
                      {s.claims.map((c) => (
                        <tr key={c.id} className={cn('border-t border-[var(--border)]', c.windHail && 'bg-[#FBE9E5]')}>
                          <td className="py-1.5 pr-2 tabular-nums">{shortDate(c.lossDate)}</td><td className="py-1.5 pr-2 tabular-nums">{c.locNo}</td>
                          <td className="py-1.5 pr-2 text-xs">{c.line}</td><td className={cn('py-1.5 pr-2', c.windHail && 'font-semibold text-[var(--brand-5)]')}>{c.cause}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{money(c.totalIncurred)}</td><td className="py-1.5 text-xs">{c.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {tab === 'docs' && (
                  <div className="space-y-2">
                    {s.documents.map((d) => (
                      <a key={d.id} href={pdfUrl(d.id)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--primary-light)]">
                        <span className="flex items-center gap-2"><FileText className="size-4 text-[var(--primary-light)]" /><b>{DOC_LABEL[d.docType] ?? d.docType}</b> <span className="text-xs text-[var(--muted-foreground)]">{d.fileName}</span></span>
                        <span className="text-xs text-[var(--muted-foreground)]">ai_parse_document · {d.elements ?? '—'} elements · open PDF</span>
                      </a>
                    ))}
                    <p className="text-xs text-[var(--muted-foreground)]">Parsed at intake with ai_parse_document; fields extracted with ai_query (JSON-schema output) and the segment with ai_classify — tables in UC: submission_documents_parsed, application_extract, sov_locations, loss_run_claims.</p>
                  </div>
                )}
              </div>
            </div>
            {s.auditTrail.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="mb-1 text-sm font-semibold">File history</div>
                <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
                  {s.auditTrail.map((a, i) => <li key={i}><b className="text-[var(--foreground)]">{a.action.replace(/_/g, ' ')}</b> · {a.by} · {new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{a.notes ? ` — ${a.notes}` : ''}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />Underwriting review</div>
                {r && s.status !== 'decided' && s.status !== 'referred' && !running && (
                  <button onClick={run} className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline"><RefreshCw className="size-3" />Re-run</button>
                )}
              </div>
              {!r && !running && (
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Reconciles the application with the statement of values and loss run, scores the risk model on both, checks every
                    appetite, documentation and authority rule, asks the Genie agent about the guideline documents, rates each location on the
                    TSI-RATE-03 plan and drafts the file rationale and broker letter. Nothing is sent until you issue it.
                  </p>
                  <button onClick={run} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white">
                    <Scale className="size-4" />Run underwriting review
                  </button>
                </div>
              )}
              {(running || (steps.length > 0 && !r)) && <div className="mt-3"><Steps steps={steps} /></div>}
              {r && !running && (
                <div className="mt-3 space-y-4">
                  <div className={cn('rounded-xl px-4 py-3 text-white', r.decision === 'DECLINE' ? 'bg-[var(--brand-5)]' : 'bg-[var(--primary)]')}>
                    <div className="text-[11px] uppercase tracking-wider text-white/60">Recommended · {new Date(r.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-2xl font-semibold">{DECISION_LABEL[r.decision]}{r.decision.startsWith('QUOTE') && <> · <span className="tabular-nums">{money(r.pricing.total_premium)}</span></>}</div>
                    <div className="text-sm text-white/80">
                      {r.decision.startsWith('QUOTE')
                        ? <>{musd(r.pricing.tiv_quoted)} of {musd(r.pricing.tiv_submitted)} TIV quoted{r.excluded_locations.length ? ` — Loc ${r.excluded_locations.join(', ')} excluded` : ''} · {money(r.pricing.property_premium)} property + {money(r.pricing.gl_premium)} GL · rate {r.pricing.rate_per_100.toFixed(3)} per $100</>
                        : r.decision === 'DECLINE' ? 'Outside Tidewell appetite' : 'Indication withheld until the missing documents arrive'}
                    </div>
                    {r.referral_required && <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs"><ShieldCheck className="size-3.5" />Needs CUO approval</div>}
                  </div>
                  {r.decision.startsWith('QUOTE') && (
                    <table className="w-full text-sm">
                      <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="py-1 text-left font-medium">Location</th><th className="py-1 text-right font-medium">TIV</th><th className="py-1 text-right font-medium">Roof</th><th className="py-1 text-right font-medium">Premium</th></tr></thead>
                      <tbody>
                        {r.locations.map((l) => (
                          <tr key={l.loc_no} className="border-t border-[var(--border)]">
                            <td className="py-1.5">{l.loc_no}. {l.building_name}{!l.included && <div className="text-[11px] font-semibold text-[var(--brand-5)]">{l.exclusion_reason}</div>}</td>
                            <td className="py-1.5 text-right tabular-nums">{musd(l.tiv)}</td>
                            <td className={cn('py-1.5 text-right tabular-nums', (l.roof_age ?? 0) > 15 && 'text-[var(--brand-5)]')}>{l.roof_age} yrs</td>
                            <td className={cn('py-1.5 text-right tabular-nums font-semibold', !l.included && 'text-[var(--muted-foreground)] line-through font-normal')}>{l.included ? money(l.premium) : 'excluded'}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-[var(--border)] text-xs text-[var(--muted-foreground)]"><td className="py-1.5" colSpan={4}>experience ×{r.pricing.experience_mod} · risk model ({r.pricing.ml_band}) ×{r.pricing.ml_mod}{r.pricing.target_premium ? ` · broker target ${money(r.pricing.target_premium)}` : ''} · TSI-RATE-03</td></tr>
                      </tbody>
                    </table>
                  )}
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="size-4 text-[var(--primary-light)]" />Appetite, documentation &amp; authority</div>
                    <ul className="space-y-1">
                      {r.rules.map((c) => (
                        <li key={c.rule_id} className="flex items-start gap-2 text-sm">
                          <Pill tone={RULE_TONE[c.status]}>{c.status}</Pill>
                          <span><b>{c.title}</b> <span className="text-[11px] text-[var(--muted-foreground)]">{c.doc_ref}</span> — <span className="text-[var(--muted-foreground)]">{c.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {r.conditions.length > 0 && (
                    <div>
                      <div className="mb-1 text-sm font-semibold">Conditions</div>
                      <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--muted-foreground)]">{r.conditions.map((c) => <li key={c}>{c}</li>)}</ul>
                    </div>
                  )}
                  {r.rationale && <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-sm leading-relaxed"><div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">File rationale{r.referral_required ? ' · for the CUO' : ''}</div>{r.rationale}</div>}
                </div>
              )}
            </div>

            {r?.guidance && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-[var(--primary-light)]" />Underwriting guidelines <span className="text-xs font-normal text-[var(--muted-foreground)]">· Genie agent (documents)</span></div>
                <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">{r.guidance.question}</div>
                <div className="prose prose-sm mt-2 max-w-none text-sm leading-relaxed"><ReactMarkdown>{r.guidance.answer}</ReactMarkdown></div>
                {r.guidance.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.guidance.sources.map((x) => <Pill key={x} tone="neutral">{x}</Pill>)}</div>}
              </div>
            )}

            {r?.broker_letter && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <button onClick={() => setLetterOpen(!letterOpen)} className="flex w-full items-center justify-between gap-2 text-left font-semibold">
                  <span className="flex items-center gap-2"><Mail className="size-4 text-[var(--primary-light)]" />Letter to {s.brokerContact ?? 'the broker'} <span className="text-xs font-normal text-[var(--muted-foreground)]">· sent on issue</span></span>
                  <ChevronDown className={cn('size-4 transition-transform', letterOpen && 'rotate-180')} />
                </button>
                {letterOpen && <div className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[var(--muted-foreground)]">{r.broker_letter}</div>}
              </div>
            )}

            {r && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-3">
                {s.status === 'decided' ? (
                  <div className="flex items-start gap-2 text-sm text-[var(--success)]">
                    <Check className="mt-0.5 size-4" />
                    <div><b>{DECISION_LABEL[s.decision ?? r.decision]} issued</b> by {s.decidedBy} at {s.decidedAt ? new Date(s.decidedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}{s.cuoNote ? ` — ${s.cuoNote}` : ''}. Written to Lakebase and back to Delta (uw_decisions).</div>
                  </div>
                ) : s.status === 'referred' ? (
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 text-[var(--severity-warning)]" />
                    <div><b>With the Chief Underwriting Officer.</b> {r.referral_reasons.join(' ')} <Link to="/referrals" className="text-[var(--primary-light)] underline">Open referrals</Link></div>
                  </div>
                ) : (
                  <>
                    {r.referral_required ? (
                      <div className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 text-[var(--severity-warning)]" /><div><b>Needs CUO approval:</b> {r.referral_reasons.join(' ')}</div></div>
                    ) : (
                      <div className="flex items-start gap-2 text-sm"><Gavel className="mt-0.5 size-4 text-[var(--success)]" /><div>Within senior underwriter authority — you can issue it directly.</div></div>
                    )}
                    <button disabled={acting} onClick={issue} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {acting ? <Loader2 className="size-4 animate-spin" /> : r.referral_required ? <Send className="size-4" /> : r.decision === 'DECLINE' ? <XCircle className="size-4" /> : <Gavel className="size-4" />}
                      {r.referral_required ? 'Refer to CUO' : `Issue ${DECISION_LABEL[r.decision].toLowerCase()}`}
                    </button>
                  </>
                )}
                {result && <div className="text-sm text-[var(--muted-foreground)]">{result}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
