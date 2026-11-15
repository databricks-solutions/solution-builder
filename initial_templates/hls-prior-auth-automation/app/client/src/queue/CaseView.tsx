import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, BookOpen, Bot, CheckCircle2, FileText, RefreshCw, Send, Stethoscope, UserRound } from 'lucide-react';
import { askPolicy, decideCase, fetchCase, fmtDate, rerunReview } from '@/lib/pa';
import { dataMutated } from '@/lib/events';
import type { CaseDetail, Criterion, Note } from '@/shared/types';
import { ClockBadge, CriterionIcon, LaneBadge, StatusBadge, UrgencyBadge } from '@/shared/badges';

const REC: Record<string, { label: string; cls: string; sub: string }> = {
  APPROVE: { label: 'Approve', cls: 'text-[var(--success)]', sub: 'Every policy criterion is documented' },
  PEND: { label: 'Pend · request information', cls: 'text-[var(--severity-warning)]', sub: 'A criterion is not documented' },
  REFER_MD: { label: 'Refer to Medical Director', cls: 'text-destructive', sub: 'A criterion is not met — only a physician may deny' },
};

export function CaseView() {
  const { id = '' } = useParams();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(() => {
    fetchCase(id).then(setC).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function rerun() {
    setReviewing(true);
    try {
      setC(await rerunReview(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  if (error) return <div className="p-6 text-destructive text-sm">{error}</div>;
  if (!c) return <div className="p-6 text-muted-foreground text-sm">Loading case…</div>;
  const rec = REC[c.aiRecommendation ?? ''] ?? { label: 'Not reviewed', cls: '', sub: '' };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1500px] mx-auto px-6 py-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/queue" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="size-4" /> Queue
          </Link>
          <span className="font-mono text-sm text-muted-foreground">{c.requestId}</span>
          <UrgencyBadge urgency={c.urgency} />
          {c.status === 'open' ? <ClockBadge hours={c.hoursRemaining} clock={c.clock} /> : <StatusBadge status={c.status} />}
          <LaneBadge lane={c.aiLane} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{c.policyTitle} <span className="text-muted-foreground font-normal text-lg">· {c.serviceCode}</span></h1>
          <div className="text-sm text-muted-foreground">
            {c.memberName} ({c.memberAge}{c.memberSex}, {c.planName}) · requested by {c.providerName}, {c.practiceGroup}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_440px] gap-4 items-start">
          {/* Left: request facts */}
          <div className="space-y-4">
            <Panel title="Request" icon={<FileText className="size-4" />}>
              <Facts
                rows={[
                  ['Diagnosis', `${c.diagnosis} (${c.icd10Code})`],
                  ['Service', `${c.serviceDescription} × ${c.requestedUnits}`],
                  ['Medical policy', c.policyId],
                  ['Place of service', c.placeOfService],
                  ['Est. allowed cost', c.estCostUsd ? `$${Math.round(c.estCostUsd).toLocaleString()}` : '—'],
                  ['Intake channel', c.channel],
                  ['Received', fmtDate(c.receivedAt)],
                  ['Decision due', fmtDate(c.dueAt)],
                ]}
              />
            </Panel>
            <Panel title="Member & provider" icon={<UserRound className="size-4" />}>
              <Facts
                rows={[
                  ['Member', `${c.memberName} · ${c.memberId}`],
                  ['Line of business', c.lineOfBusiness],
                  ['Provider', c.providerName],
                  ['NPI (synthetic)', c.npi],
                  ['Practice group', c.practiceGroup],
                  ['Specialty', c.specialty],
                ]}
              />
            </Panel>
            <Panel title="Audit trail" icon={<CheckCircle2 className="size-4" />}>
              {c.auditTrail.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  AI pre-review by <code>{c.aiModel}</code> (ai_query batch). No decisions yet.
                </div>
              ) : (
                <ul className="space-y-2 text-xs">
                  {[...c.auditTrail].reverse().map((e, i) => (
                    <li key={i}>
                      <div className="font-medium">{e.action.replace('_', ' ')} · {e.by}</div>
                      <div className="text-muted-foreground">{new Date(e.at).toLocaleString()}{e.notes ? ` — ${e.notes}` : ''}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Middle: clinical documentation with highlighted evidence */}
          <Panel title={`Clinical documentation · ${c.notes.length} document${c.notes.length > 1 ? 's' : ''}`} icon={<Stethoscope className="size-4" />}>
            <div className="space-y-4">
              {c.notes.map((n) => (
                <NoteCard key={n.noteId} note={n} criteria={c.criteria} hover={hover} />
              ))}
            </div>
          </Panel>

          {/* Right: AI recommendation + criteria + decision */}
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm" data-testid="ai-recommendation">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Bot className="size-4" /> AI recommendation</div>
                <button onClick={rerun} disabled={reviewing} className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-muted disabled:opacity-50" data-testid="rerun-review">
                  <RefreshCw className={`size-3 ${reviewing ? 'animate-spin' : ''}`} /> {reviewing ? 'Reviewing…' : 'Re-run live review'}
                </button>
              </div>
              <div className={`text-xl font-semibold mt-2 ${rec.cls}`}>{rec.label}</div>
              <div className="text-xs text-muted-foreground">{rec.sub}</div>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--primary)]" style={{ width: `${Math.round((c.aiConfidence ?? 0) * 100)}%` }} />
                </div>
                <span className="text-xs font-mono">{Math.round((c.aiConfidence ?? 0) * 100)}% conf.</span>
              </div>
              <p className="text-sm mt-3">{c.aiRationale}</p>
              <div className="text-[11px] text-muted-foreground mt-2">
                {c.aiModel} · {c.aiReviewedAt ? new Date(c.aiReviewedAt).toLocaleString() : ''} · {c.autoApprovalEligible ? 'policy is auto-approval eligible' : 'policy requires nurse sign-off'}
              </div>
            </div>

            <Panel title={`Policy criteria · ${c.nMet}/${c.nCriteria} met`} icon={<BookOpen className="size-4" />}>
              <ul className="space-y-3">
                {c.criteria.map((k) => (
                  <li
                    key={k.criterionId}
                    onMouseEnter={() => setHover(k.criterionNumber)}
                    onMouseLeave={() => setHover(null)}
                    className="flex gap-2.5 rounded-lg p-2 -m-2 hover:bg-muted/50"
                    data-testid="criterion"
                  >
                    <CriterionIcon status={k.status} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        <span className="font-mono text-xs text-muted-foreground mr-1">C{k.criterionNumber}</span>
                        {k.label}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{k.status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{k.criterionText}</div>
                      {k.evidenceQuote ? (
                        <blockquote className="mt-1.5 text-xs border-l-2 border-[var(--primary)] pl-2 italic">
                          “{k.evidenceQuote}” <span className="not-italic text-muted-foreground">— {k.sourceNoteId}</span>
                        </blockquote>
                      ) : (
                        <div className="mt-1 text-xs text-[var(--severity-warning)]">No supporting evidence found in the documentation.</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <DecisionPanel c={c} onDecided={(n) => { setC(n); dataMutated.emit(); }} />
            <PolicyAsk policyId={c.policyId} policyTitle={c.policyTitle} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteCard({ note, criteria, hover }: { note: Note; criteria: Criterion[]; hover: number | null }) {
  const segments = useMemo(() => {
    const marks = criteria
      .filter((k) => k.evidenceQuote && (k.sourceNoteId === note.noteId || !k.sourceNoteId))
      .map((k) => {
        const q = k.evidenceQuote!.replace(/\.$/, '');
        const i = note.noteText.indexOf(q);
        return i >= 0 ? { start: i, end: i + q.length, n: k.criterionNumber ?? 0 } : null;
      })
      .filter((m): m is { start: number; end: number; n: number } => m !== null)
      .sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; n?: number }> = [];
    let pos = 0;
    for (const m of marks) {
      if (m.start < pos) continue;
      out.push({ text: note.noteText.slice(pos, m.start) });
      out.push({ text: note.noteText.slice(m.start, m.end), n: m.n });
      pos = m.end;
    }
    out.push({ text: note.noteText.slice(pos) });
    return out;
  }, [note, criteria]);

  return (
    <div className="rounded-lg border">
      <div className="flex justify-between items-center px-3 py-2 bg-muted/50 text-xs">
        <span className="font-medium">{note.noteType}</span>
        <span className="text-muted-foreground font-mono">{note.noteId} · {note.noteDate}</span>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed p-3">
        {segments.map((s, i) =>
          s.n ? (
            <mark
              key={i}
              className={`rounded px-0.5 transition-colors ${hover === s.n ? 'bg-[var(--brand-4)]' : 'bg-[var(--success-subtle)]'}`}
            >
              <sup className="font-mono text-[10px] text-[var(--primary)] mr-0.5">C{s.n}</sup>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </pre>
    </div>
  );
}

function DecisionPanel({ c, onDecided }: { c: CaseDetail; onDecided: (c: CaseDetail) => void }) {
  const [mode, setMode] = useState<null | 'pend'>(null);
  const [note, setNote] = useState('');
  const [letter, setLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const missing = c.criteria.filter((k) => k.status !== 'Met').map((k) => `• ${k.criterionId} – ${k.label}`).join('\n');
    setLetter(
      `Re: Prior authorization ${c.requestId} — ${c.policyTitle} (${c.serviceCode}) for ${c.memberName}\n\n` +
        `Dear ${c.providerName},\n\nTo complete our review under MedVault medical policy ${c.policyId}, please submit documentation for:\n${missing || '• (none)'}\n\n` +
        `${c.missingInformation ?? ''}\n\nPlease respond via the provider portal or ePA. Thank you,\nMedVault Utilization Management`,
    );
  }, [c]);

  if (c.status !== 'open') {
    return (
      <div className="rounded-xl border bg-card p-4" data-testid="decision-done">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Decision recorded</div>
        <div className="mt-2"><StatusBadge status={c.status} /></div>
        <div className="text-xs text-muted-foreground mt-2">
          {c.decidedBy} · {c.decidedAt ? new Date(c.decidedAt).toLocaleString() : ''} — written to Lakebase + Delta <code>um_decisions</code>
        </div>
        {c.decisionNote && <div className="text-sm mt-2">{c.decisionNote}</div>}
      </div>
    );
  }

  async function go(decision: 'approve' | 'pend' | 'refer_md') {
    setBusy(true);
    setErr(null);
    try {
      onDecided(await decideCase(c.requestId, decision, note || undefined, decision === 'pend' ? letter : undefined));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3" data-testid="decision-panel">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Nurse decision</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reviewer note (optional)" className="w-full text-sm border rounded-md p-2 h-16 bg-background" />
      {mode === 'pend' && (
        <div>
          <div className="text-xs font-medium mb-1">Request to provider (drafted from the AI gaps)</div>
          <textarea value={letter} onChange={(e) => setLetter(e.target.value)} className="w-full text-xs font-mono border rounded-md p-2 h-48 bg-background" data-testid="pend-letter" />
        </div>
      )}
      {err && <div className="text-xs text-destructive">{err}</div>}
      <div className="grid grid-cols-3 gap-2">
        <button disabled={busy} onClick={() => go('approve')} className="px-2 py-2 rounded-md text-sm font-medium bg-[var(--success)] text-white disabled:opacity-50" data-testid="btn-approve">Approve</button>
        <button
          disabled={busy}
          onClick={() => (mode === 'pend' ? go('pend') : setMode('pend'))}
          className="px-2 py-2 rounded-md text-sm font-medium bg-[var(--warning)] text-[var(--warning-foreground)] disabled:opacity-50 flex items-center justify-center gap-1"
          data-testid="btn-pend"
        >
          {mode === 'pend' ? <><Send className="size-3.5" /> Send request</> : 'Pend'}
        </button>
        <button disabled={busy} onClick={() => go('refer_md')} className="px-2 py-2 rounded-md text-sm font-medium border border-destructive text-destructive disabled:opacity-50" data-testid="btn-refer">Refer to MD</button>
      </div>
      <div className="text-[11px] text-muted-foreground">Nurses approve or pend; adverse determinations are made only by a Medical Director (MV-UM-000).</div>
    </div>
  );
}

function PolicyAsk({ policyId, policyTitle }: { policyId: string; policyTitle: string | null }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = [`What documentation does ${policyId} require?`, 'Who is allowed to deny a prior authorization at MedVault?'];
  async function ask(question: string) {
    setQ(question);
    setBusy(true);
    setA(null);
    try {
      setA((await askPolicy(question)).answer);
    } catch (e) {
      setA(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2" data-testid="policy-ask">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><BookOpen className="size-4" /> Ask the medical policy</div>
      <div className="text-xs text-muted-foreground">The Genie agent over MedVault policy documents ({policyTitle}).</div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button key={s} onClick={() => ask(s)} className="text-xs px-2 py-1 rounded-full border hover:bg-muted text-left">{s}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q.trim()); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about coverage criteria…" className="flex-1 text-sm border rounded-md px-2 py-1.5 bg-background" />
        <button className="px-3 rounded-md bg-[var(--primary)] text-white text-sm">Ask</button>
      </form>
      {busy && <div className="text-xs text-muted-foreground">Searching the policy library…</div>}
      {a && (
        <div className="prose prose-sm max-w-none text-sm border-t pt-2" data-testid="policy-answer">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{a}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">{icon}{title}</div>
      {children}
    </div>
  );
}

function Facts({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return (
    <dl className="text-sm space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] text-muted-foreground">{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
