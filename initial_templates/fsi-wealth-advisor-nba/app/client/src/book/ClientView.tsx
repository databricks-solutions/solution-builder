/**
 * Client page — one household, end to end:
 *   left  : profile, money-in-motion signals, accounts, mortgage, CRM notes with the AI Functions read-out
 *   right : every next-best action scored by the propensity model, with its suitability verdict (S1-S7);
 *           "Prep meeting" streams the copilot's work (model → suitability → policy library → brief + email);
 *           the advisor edits the email and logs a decision → Lakebase + Delta write-back + audit trail.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BookOpen, CalendarCheck, Check, CheckCircle2, ChevronDown, CircleAlert, Clock, Database,
  Loader2, Mail, NotebookPen, Phone, Send, ShieldAlert, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  ACTION_SHORT, decide, fetchClient, money, runPrep, short,
  type ClientDetail, type MeetingPrep, type Recommendation, type StepEvent,
} from './api';
import { Pill, StatusPill, SuitPill, cn } from './ui';

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
              {s.detail && <div className="text-xs text-[var(--muted-foreground)] break-words">{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Card({ title, icon: Icon, children, right }: { title: string; icon?: typeof Clock; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">{Icon && <Icon className="size-4 text-[var(--primary-light)]" />}{title}</div>
        {right}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

function ActionRow({ r }: { r: Recommendation }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/50', r.status === 'FAIL' && 'bg-[#FDF3F1]')}>
        <td className="px-3 py-2 tabular-nums text-[var(--muted-foreground)]">{r.model_rank}</td>
        <td className="px-3 py-2">
          <div className={cn('text-sm font-medium', r.status === 'FAIL' && 'line-through decoration-[var(--brand-5)]')}>{ACTION_SHORT[r.action_code] ?? r.action_name}</div>
          <div className="text-[11px] text-[var(--muted-foreground)]">{r.complexity} · triggered by {r.signal === 'Calendar' ? 'calendar' : r.signal}</div>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 rounded-full bg-[var(--muted)]"><div className="h-1.5 rounded-full bg-[var(--primary-light)]" style={{ width: `${Math.min(100, r.propensity * 100)}%` }} /></div>
            <span className="text-xs tabular-nums">{Math.round(r.propensity * 100)}%</span>
          </div>
        </td>
        <td className="px-3 py-2 text-right text-xs tabular-nums">{short(r.assets_in_scope)}</td>
        <td className="px-3 py-2 text-right text-xs tabular-nums">{r.expected_revenue > 0 ? money(r.expected_revenue) : '—'}</td>
        <td className="px-3 py-2"><div className="flex items-center gap-1"><SuitPill status={r.status} />{r.failed_rules && <span className="text-[10px] text-[var(--brand-5)]">{r.failed_rules}</span>}<ChevronDown className={cn('size-3.5 text-[var(--muted-foreground)] transition-transform', open && 'rotate-180')} /></div></td>
      </tr>
      {open && (
        <tr className="bg-[var(--muted)]/40">
          <td colSpan={6} className="px-4 py-2">
            <div className="grid gap-1">
              {r.rules.map((x) => (
                <div key={x.rule_id} className="grid grid-cols-[70px_150px_1fr] items-start gap-2 text-xs">
                  <Pill tone={x.result === 'PASS' ? 'good' : x.result === 'FAIL' ? 'bad' : 'warn'}>{x.result === 'PASS' ? <Check className="size-3" /> : x.result === 'FAIL' ? <X className="size-3" /> : <AlertTriangle className="size-3" />}{x.rule_id}</Pill>
                  <span className="font-medium">{x.rule}</span>
                  <span>{x.finding} <span className="text-[var(--primary-light)]">· {x.citation}</span></span>
                </div>
              ))}
              <div className="text-[11px] text-[var(--muted-foreground)]">Disclosures: {r.disclosures}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PrepView({ p, part }: { p: MeetingPrep; part: 'brief' | 'policy' }) {
  if (part === 'policy') return <PolicyView p={p} />;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[var(--primary)] px-4 py-3 text-white">
        <div className="text-[11px] uppercase tracking-wide text-white/60">Meeting brief</div>
        <div className="mt-0.5 font-semibold leading-snug">{p.headline}</div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-white/85">{p.why_now.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
      {p.model_pick && p.model_pick.status === 'FAIL' && (
        <div className="rounded-xl border border-[#F0C4BC] bg-[#FDF3F1] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#8E2F24]"><ShieldAlert className="size-4" />Model’s #1 pick blocked: {ACTION_SHORT[p.model_pick.action_code] ?? p.model_pick.action_name} <span className="font-normal">(propensity {Math.round(p.model_pick.propensity * 100)}%)</span></div>
          <ul className="mt-1.5 space-y-0.5 text-xs text-[#5E231C]">{p.model_pick.blocked_because.map((b) => <li key={b}>✕ {b}</li>)}</ul>
        </div>
      )}
      <div className="rounded-xl border border-[var(--border)]">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Agenda — suitable actions only</div>
        {p.agenda.map((a, i) => (
          <div key={a.action_code} className="grid grid-cols-[24px_1fr_auto] gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0">
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--success-subtle)] text-xs font-semibold text-[var(--primary)]">{i + 1}</span>
            <div>
              <div className="text-sm font-medium">{ACTION_SHORT[a.action_code] ?? a.action_name}</div>
              <div className="text-xs leading-relaxed text-[var(--foreground)]/80">{a.talking_point}</div>
            </div>
            <div className="text-right"><SuitPill status={a.status} /><div className="mt-0.5 text-[11px] tabular-nums text-[var(--muted-foreground)]">{a.assets > 0 ? short(a.assets) : ''}</div></div>
          </div>
        ))}
      </div>
      {p.deferred.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Not on this agenda</div>
          <ul className="mt-1 space-y-1 text-xs">{p.deferred.map((d) => <li key={d.action_code}><b>{ACTION_SHORT[d.action_code] ?? d.action_code}</b> — {d.reason}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function PolicyView({ p }: { p: MeetingPrep }) {
  return (
    <div className="space-y-3">
      {p.policy_guidance && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--success-subtle)]/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"><BookOpen className="size-4" />Policy library (Genie agent)</div>
          <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">“{p.policy_guidance.question}”</div>
          <div className="mt-1.5 text-sm leading-relaxed space-y-1.5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"><ReactMarkdown>{p.policy_guidance.answer}</ReactMarkdown></div>
          {p.policy_guidance.sources && <div className="mt-1 text-[11px] text-[var(--primary-light)]">Sources: {p.policy_guidance.sources}</div>}
        </div>
      )}
      <div className="rounded-xl border border-[var(--border)] px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Required disclosures</div>
        <ul className="mt-1 space-y-0.5 text-xs">{p.disclosures.map((d) => <li key={d.code}><b>{d.code}</b> {d.text}</li>)}</ul>
      </div>
      {p.call_opener && (
        <div className="rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><Phone className="size-3" />Call opener · {p.outreach.channel}</div>
          <p className="mt-1 text-sm italic leading-relaxed">“{p.call_opener}”</p>
        </div>
      )}
    </div>
  );
}

const DECISIONS = [
  { key: 'meeting_booked', label: 'Meeting booked', icon: CalendarCheck, cls: 'bg-[var(--primary)] text-white' },
  { key: 'proposed', label: 'Send email & log proposal', icon: Send, cls: 'bg-[var(--primary-light)] text-white' },
  { key: 'not_now', label: 'Not now', icon: Clock, cls: 'bg-[var(--card)] border border-[var(--border)]' },
] as const;

const AUDIT_LABEL: Record<string, string> = { ai_prep: 'AI meeting prep', proposed: 'Proposal sent', meeting_booked: 'Meeting booked', not_now: 'Not now', note: 'Note' };

export function ClientView() {
  const { id = '' } = useParams();
  const [c, setC] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [action, setAction] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [writeBack, setWriteBack] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchClient(id).then((d) => {
      setC(d);
      setEmail(d.outreachDraft ?? '');
      setAction((a) => a || d.meetingPrep?.agenda[0]?.action_code || d.bestSuitableAction || '');
      setError(null);
    }).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { setSteps([]); setWriteBack(null); setAction(''); load(); }, [load]);

  const prep = async () => {
    setRunning(true);
    setSteps([]);
    await runPrep(id, {
      step: (e) => setSteps((prev) => { const i = prev.findIndex((p) => p.id === e.id); return i >= 0 ? prev.map((p, j) => (j === i ? e : p)) : [...prev, e]; }),
      result: (r) => {
        setC((prev) => prev && { ...prev, meetingPrep: r.prep, outreachDraft: r.prep.outreach.body });
        setEmail(r.prep.outreach.body);
        setAction(r.prep.agenda[0]?.action_code ?? '');
        setTimeout(() => document.getElementById('meeting-brief')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Meeting prep failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
    dataMutated.emit();
  };

  const submit = async (decision: string) => {
    setSaving(decision);
    try {
      const r = await decide(id, { decision, action: action || undefined, notes: notes || undefined, outreach: email || undefined });
      setC(r.client);
      setWriteBack(r.deltaWriteBack);
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (error && !c) return <div className="p-8 text-sm text-[var(--destructive)]">{error}</div>;
  if (!c) return <div className="p-8"><div className="h-64 rounded-2xl bg-[var(--muted)] animate-pulse" /></div>;
  const recs = [...c.recommendations].sort((a, b) => a.model_rank - b.model_rank);
  const p = c.meetingPrep;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/book" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline"><ArrowLeft className="size-3" />My book</Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>#{c.bookRank} in your book</span><span>·</span><span>{c.id}</span><StatusPill status={c.status} /></div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">{c.primaryName}{c.primaryAge ? <span className="text-xl font-normal text-[var(--muted-foreground)]">, {c.primaryAge}</span> : null}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Pill tone="info">{c.segment}</Pill>
              <Pill>{c.riskProfile} ({c.riskScore}/5)</Pill>
              <Pill>{c.timeHorizonYears}-yr horizon</Pill>
              <Pill>Liquidity need: {c.liquidityNeed}</Pill>
              <Pill>Experience: {c.investmentExperience}</Pill>
              {c.vulnerable && <Pill tone="warn"><ShieldAlert className="size-3" />{c.vulnerableReason}</Pill>}
              {c.trustedContactOnFile && <Pill tone="good">Trusted contact on file</Pill>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['AUM', short(c.aum)], ['Sweep cash (0.25%)', short(c.sweepCash)], ['Money in motion', short(c.moneyInMotion)],
              ['AUM at risk', (c.aumAtRisk ?? 0) > 0 ? short(c.aumAtRisk) : '—'], ['Last contact', c.daysSinceContact != null ? `${c.daysSinceContact} days` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{k}</div>
                <div className={cn('text-lg font-semibold tabular-nums', k === 'AUM at risk' && (c.aumAtRisk ?? 0) > 0 && 'text-[var(--brand-5)]', k === 'Last contact' && (c.daysSinceContact ?? 0) > 90 && 'text-[var(--brand-5)]')}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
          <div className="space-y-4">
            <Card title="Signals — why this household is in the book today" icon={Sparkles}>
              <ul className="space-y-2">
                {c.signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className={cn('mt-1 size-2 shrink-0 rounded-full', s.type === 'External outflow' || s.type === 'Death of spouse' ? 'bg-[var(--brand-5)]' : 'bg-[var(--brand-4)]')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{s.type}</span>
                        <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{s.amount ? short(s.amount) : ''}{s.date ? ` · ${s.date}` : ''}</span>
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)]">{s.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Accounts" icon={Database}>
              <table className="w-full text-xs">
                <tbody>
                  {c.accounts.map((a) => (
                    <tr key={a.id} className="border-t border-[var(--border)] first:border-t-0">
                      <td className="py-1.5">{a.type}{a.custodian !== 'Calder Pine' && <span className="text-[var(--muted-foreground)]"> · {a.custodian}</span>}</td>
                      <td className="py-1.5 text-right text-[var(--muted-foreground)]">{a.rate != null ? `${a.rate.toFixed(2)}%` : ''}{a.maturity ? ` · matures ${a.maturity}` : ''}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{money(a.balance)}</td>
                    </tr>
                  ))}
                  {c.liabilities.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--border)]">
                      <td className="py-1.5">{l.type} · {l.lender}</td>
                      <td className={cn('py-1.5 text-right', l.rate >= 6.65 ? 'font-semibold text-[var(--brand-5)]' : 'text-[var(--muted-foreground)]')}>{l.rate.toFixed(2)}% vs 5.90% today</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">−{money(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="CRM notes — read by AI Functions" icon={NotebookPen}>
              <ul className="space-y-3">
                {c.notes.map((n) => (
                  <li key={n.id} className="text-sm">
                    <div className="text-[11px] text-[var(--muted-foreground)]">{n.date} · {n.channel}</div>
                    <div className="leading-relaxed">{n.text}</div>
                    {n.ai && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Pill tone="info"><Sparkles className="size-3" />{n.ai.category}</Pill>
                        {n.ai.amount && <Pill>amount: {n.ai.amount}</Pill>}
                        {n.ai.family_member && <Pill>family: {n.ai.family_member}</Pill>}
                        {n.ai.other_institution && <Pill tone="bad">other firm: {n.ai.other_institution}</Pill>}
                        {n.ai.sentiment && <Pill>{n.ai.sentiment}</Pill>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Next best actions — model ranking × suitability" icon={ShieldCheck}
              right={<span className="text-[11px] text-[var(--muted-foreground)]">nba_propensity_model@champion · rules S1–S7</span>}>
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr><th className="px-3 py-1 text-left">#</th><th className="px-3 py-1 text-left">Action</th><th className="px-3 py-1 text-left">Propensity</th><th className="px-3 py-1 text-right">Assets</th><th className="px-3 py-1 text-right">Exp. rev/yr</th><th className="px-3 py-1 text-left">Suitability</th></tr>
                </thead>
                <tbody>{recs.map((r) => <ActionRow key={r.action_code} r={r} />)}</tbody>
              </table>
            </Card>

            <Card title="Meeting prep" icon={Sparkles}
              right={
                <button onClick={prep} disabled={running}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{p ? 'Re-run meeting prep' : 'Prep meeting'}
                </button>
              }>
              {steps.length > 0 && <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3"><Steps steps={steps} /></div>}
              {!p && steps.length === 0 && (
                <p className="text-sm text-[var(--muted-foreground)]">The copilot reads the file, ranks the actions, removes anything unsuitable, checks the policy library and drafts the brief + a compliant outreach email.</p>
              )}
              {p && <div className="text-sm text-[var(--muted-foreground)]">Brief ready below — prepared {new Date(p.generated_at).toLocaleString()}.</div>}
            </Card>

            {c.auditTrail.length > 0 && (
              <Card title="Audit trail" icon={Clock}>
                <ul className="space-y-1 text-xs">
                  {[...c.auditTrail].reverse().map((a, i) => (
                    <li key={i} className="flex justify-between gap-3"><span><b>{AUDIT_LABEL[a.action] ?? a.action}</b>{a.notes ? ` — ${a.notes}` : ''}</span><span className="shrink-0 text-[var(--muted-foreground)]">{a.by} · {new Date(a.at).toLocaleString()}</span></li>
                  ))}
                </ul>
              </Card>
            )}
            <button onClick={() => dockController.openAndSend(`Brief me on ${c.primaryName} (${c.id}): what changed, what the model suggests, and what I can actually offer.`)}
              className="text-xs font-medium text-[var(--primary-light)] hover:underline">Ask the copilot about {c.primaryName} →</button>
          </div>
        </div>
        {p && (
          <div id="meeting-brief" className="grid gap-4 xl:grid-cols-2">
            <PrepView p={p} part="brief" />
            <div className="space-y-4">
              <PrepView p={p} part="policy" />
              <Card title="Outreach & decision" icon={Mail}>
                {p.outreach.subject && <div className="mb-1 text-xs"><span className="text-[var(--muted-foreground)]">Subject:</span> <b>{p.outreach.subject}</b></div>}
                <textarea value={email} onChange={(e) => setEmail(e.target.value)} rows={10}
                  className="w-full rounded-lg border border-[var(--border)] bg-[#FCFBF7] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary-light)]" />
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr]">
                  <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm">
                    {recs.filter((r) => r.status !== 'FAIL').map((r) => <option key={r.action_code} value={r.action_code}>{ACTION_SHORT[r.action_code] ?? r.action_name}</option>)}
                  </select>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional) — e.g. Thursday 10am, Daniel joining"
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm outline-none" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {DECISIONS.map((d) => (
                    <button key={d.key} onClick={() => submit(d.key)} disabled={!!saving}
                      className={cn('inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60', d.cls)}>
                      {saving === d.key ? <Loader2 className="size-4 animate-spin" /> : <d.icon className="size-4" />}{d.label}
                    </button>
                  ))}
                </div>
                {c.decision && (
                  <div className="mt-3 rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-sm text-[var(--success-subtle-foreground)]">
                    <b>Decision logged: {AUDIT_LABEL[c.decision] ?? c.decision}</b>{c.decisionAction ? ` — ${ACTION_SHORT[c.decisionAction] ?? c.decisionAction}` : ''} · written to Lakebase
                    {writeBack === 'ok' && ' and Delta (advisor_decisions) for the wealth-desk dashboard'}
                    {writeBack && writeBack !== 'ok' && <span className="text-[var(--destructive)]"> · Delta write-back failed: {writeBack}</span>}
                  </div>
                )}
              </Card>
                        </div>
          </div>
        )}
      </div>
    </div>
  );
}
