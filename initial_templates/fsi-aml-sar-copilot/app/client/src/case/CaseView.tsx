import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, CircleDashed, FileText, Gavel, Loader2, Network, ShieldCheck, XCircle } from 'lucide-react';
import { getJson, postJson, streamSse, usd, fmtDate, fmtDateTime, DECISION_LABEL, type Json } from '@/lib/api';
import { DecisionBadge, KycBadge, RiskBar } from '@/ops/Badges';
import { CashChart } from './CashChart';

const TOOL_LABEL: Record<string, string> = {
  get_case_overview: 'Read alert, KYC profile & case scope',
  get_cash_activity: 'Analysed cash deposits',
  get_fund_flows: 'Traced fund flows & wires',
  get_linked_parties: 'Resolved linked parties',
  get_alert_history: 'Checked prior alerts',
  search_aml_policy: 'Consulted AML policy (Genie agent · policy documents)',
  submit_sar_draft: 'Drafted SAR narrative',
};

export function CaseView() {
  const { alertId = '' } = useParams();
  const [c, setC] = useState<Json | null>(null);
  const [act, setAct] = useState<Json | null>(null);
  const [steps, setSteps] = useState<Json[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<Json | null>(null);
  const [narrative, setNarrative] = useState('');
  const [rationale, setRationale] = useState('');
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [decideErr, setDecideErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [result, setResult] = useState<Json | null>(null);
  const viewed = useRef(false);

  const load = useCallback(async () => {
    const [cc, aa] = await Promise.all([getJson(`/api/alerts/${alertId}`), getJson(`/api/alerts/${alertId}/activity`)]);
    setC(cc); setAct(aa);
    if (cc.draft) {
      setDraft((d) => d ?? { ...cc.draft, rationale: '' });
      setNarrative((n) => n || cc.draft.narrative);
    }
  }, [alertId]);

  useEffect(() => {
    setC(null); setDraft(null); setNarrative(''); setSteps([]); setResult(null);
    load().catch((e) => setErr(String(e.message ?? e)));
    if (!viewed.current) { viewed.current = true; postJson(`/api/alerts/${alertId}/viewed`, {}).catch(() => undefined); }
  }, [alertId, load]);

  async function runAgent() {
    setRunning(true); setErr(null); setSteps([]); setDraft(null); setNarrative('');
    try {
      await streamSse(`/api/alerts/${alertId}/draft`, (ev) => {
        if (ev.type === 'step') {
          setSteps((s) => {
            const i = s.findIndex((x) => x.tool === ev.tool && x.status === 'running' && JSON.stringify(x.args) === JSON.stringify(ev.args));
            if (ev.status === 'done' && i >= 0) { const n = [...s]; n[i] = ev; return n; }
            return [...s, ev];
          });
        } else if (ev.type === 'done') {
          setDraft(ev.draft); setNarrative(ev.draft.narrative); setRationale(ev.draft.rationale);
        } else if (ev.type === 'error') setErr(ev.message);
      });
      await load();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setRunning(false);
    }
  }

  async function decide(decision: string) {
    setSaving(decision); setDecideErr(null);
    try {
      const r = await postJson(`/api/alerts/${alertId}/decision`, { decision, rationale, narrative });
      setResult({ ...r, decision });
      await load();
    } catch (e) {
      setDecideErr(String((e as Error).message));
    } finally {
      setSaving(null);
    }
  }

  if (!c) return <div className="p-8 space-y-3">{err ? <div className="text-red-700">{err}</div> : [1, 2, 3].map((i) => <div key={i} className="h-6 rounded bg-muted animate-pulse" />)}</div>;
  const a = c.alert, cu = c.customer, net = c.network;
  const decided = c.decision;

  return (
    <div className="px-8 py-6 space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Alert queue</Link>
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[320px]">
          <div className="text-xs font-mono text-muted-foreground">{a.alert_id} · raised {fmtDate(a.alert_ts)} · {a.scenario}</div>
          <h1 className="font-display text-3xl">{cu.customer_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{cu.customer_type === 'business' ? 'Business' : 'Individual'} · {cu.occupation_or_industry}</span>
            <KycBadge rating={cu.kyc_risk_rating} />
            <span>customer since {fmtDate(cu.onboarding_date)}</span>
            <span>{cu.address}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border bg-card px-4 py-2"><div className="text-[10px] uppercase text-muted-foreground">ML risk</div><RiskBar score={a.ml_risk_score} /><div className="text-[10px] text-muted-foreground">queue #{a.ml_rank ?? '—'}</div></div>
          <div className="rounded-xl border bg-card px-4 py-2"><div className="text-[10px] uppercase text-muted-foreground">Rules score</div><div className="text-xl font-semibold">{Number(a.rule_score).toFixed(0)}</div><div className="text-[10px] text-muted-foreground">legacy rank #{a.rules_rank ?? '—'}</div></div>
          <div className="rounded-xl border bg-card px-4 py-2"><div className="text-[10px] uppercase text-muted-foreground">Status</div><div className="mt-1"><DecisionBadge decision={decided?.decision} /></div></div>
        </div>
      </header>

      <div className="grid grid-cols-5 gap-5">
        <section className="col-span-3 space-y-5">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="text-sm font-semibold mb-2">Why the model ranked this alert</h2>
            <div className="flex flex-wrap gap-2">
              {(a.reason_codes ?? []).map((r: string) => (
                <span key={r} className="rounded-full bg-[#D1495B]/10 px-3 py-1 text-xs text-[#9b2c3c]">{r}</span>
              ))}
              {!(a.reason_codes ?? []).length && <span className="text-sm text-muted-foreground">No strong risk indicators.</span>}
            </div>
          </div>

          {net && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Linked network — {net.cluster_size} parties, {c.network_alerts.length} open alerts handled as ONE case</h2>
                <Link to={`/network/${net.cluster_id}`} className="inline-flex items-center gap-1 text-sm text-[#3E7CB1] hover:underline"><Network className="h-4 w-4" /> Open network graph</Link>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
                <div><div className="text-[11px] text-muted-foreground">Cash in (60d)</div><div className="font-semibold">{usd(net.cash_in_60d)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Deposits $8K–$10K</div><div className="font-semibold">{net.sub_ctr_deposits_60d}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Branches used</div><div className="font-semibold">{net.cash_branches_60d}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Wired to high-risk (60d)</div><div className="font-semibold text-[#D1495B]">{usd(net.high_risk_wires_60d)}</div></div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{(net.member_names ?? []).join(' · ')}</div>
            </div>
          )}

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Cash deposited per day — last 60 days ({act?.scope === 'network' ? 'whole network' : 'subject'})</h2>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-[#D1495B]" /> day with a $8K–$10K deposit</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#0B2545]" /> wire out</span>
              </div>
            </div>
            {act ? <CashChart daily={act.daily} /> : <div className="h-48 rounded bg-muted animate-pulse" />}
          </div>

          <div className="rounded-xl border bg-card overflow-hidden">
            <h2 className="text-sm font-semibold px-4 pt-3">Recent cash, transfers & wires</h2>
            <table className="w-full text-xs mt-2">
              <thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">When</th><th className="px-3 py-1.5 text-left">Party</th><th className="px-3 py-1.5 text-left">Type</th><th className="px-3 py-1.5 text-right">Amount</th><th className="px-3 py-1.5 text-left">Branch / counterparty</th></tr></thead>
              <tbody>
                {(act?.txns ?? []).slice(0, 14).map((t: Json, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtDateTime(t.txn_ts)}</td>
                    <td className="px-3 py-1.5">{t.customer_name}</td>
                    <td className="px-3 py-1.5">{String(t.txn_type).replace('_', ' ')}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${t.cash_below_ctr ? 'text-[#D1495B] font-semibold' : ''}`}>{usd(t.amount)}</td>
                    <td className="px-3 py-1.5">{t.txn_type === 'cash_deposit' ? t.branch_id : `${t.counterparty_name ?? ''} ${t.counterparty_country && t.counterparty_country !== 'US' ? `(${t.counterparty_country})` : ''}`}{t.high_risk_country && <AlertTriangle className="inline h-3 w-3 ml-1 text-[#D1495B]" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="col-span-2 space-y-5">
          <div className="rounded-xl border-2 border-[#0B2545]/20 bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-[#0B2545]" />
              <h2 className="text-base font-semibold">Investigator Copilot</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Assembles the evidence across every linked party, checks bank policy and drafts a FinCEN SAR narrative. You review, edit and decide.</p>
            <div className="mt-1 text-[10px] text-muted-foreground">Foundation Model API · tools on Unity Catalog · Genie agent (policy docs)</div>
            <button onClick={runAgent} disabled={running} data-testid="run-agent"
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#0B2545] px-3 py-2 text-sm text-white disabled:opacity-60">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {running ? 'Copilot is investigating…' : draft ? 'Re-run evidence & draft' : 'Assemble evidence & draft SAR'}
            </button>
            {steps.length > 0 && (
              <ol className="mt-3 space-y-1.5" data-testid="agent-steps">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    {s.status === 'done' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <CircleDashed className="h-4 w-4 shrink-0 animate-spin text-[#3E7CB1]" />}
                    <div>
                      <div className="font-medium">{TOOL_LABEL[s.tool] ?? s.tool}{s.ms ? <span className="text-muted-foreground font-normal"> · {(s.ms / 1000).toFixed(1)}s</span> : null}</div>
                      {s.summary && <div className="text-muted-foreground">{s.summary}</div>}
                      {s.tool === 'search_aml_policy' && s.preview && <div className="mt-1 rounded bg-muted/70 p-2 text-[11px] leading-snug line-clamp-4">{s.preview}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {err && <div className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          </div>

          {draft && (
            <div className="rounded-xl border bg-card p-4 space-y-3" data-testid="sar-draft">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">SAR narrative draft</h2>
                <span className="ml-auto rounded-full bg-[#0B2545] px-2 py-0.5 text-[11px] text-white">Recommends: {DECISION_LABEL[draft.recommendation] ?? draft.recommendation}</span>
              </div>
              {(draft.red_flags ?? []).length > 0 && (
                <ul className="space-y-1">
                  {draft.red_flags.map((f: string) => <li key={f} className="flex gap-1.5 text-xs"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#D1495B]" />{f}</li>)}
                </ul>
              )}
              <div className="flex justify-end"><button className="text-xs text-[#3E7CB1] hover:underline" onClick={() => setEditing((e) => !e)}>{editing ? 'Preview' : 'Edit narrative'}</button></div>
              {editing ? (
                <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} className="w-full h-80 rounded-md border p-2 font-mono text-[11px]" />
              ) : (
                <div className="prose prose-sm max-w-none max-h-96 overflow-y-auto rounded-md bg-muted/40 p-3 text-[12px] leading-snug prose-p:my-1.5 prose-headings:my-2 prose-headings:text-[13px]"><ReactMarkdown>{narrative}</ReactMarkdown></div>
              )}
              <div className="text-[10px] text-muted-foreground">{draft.model} · {draft.tool_calls} tool calls · saved to sar_drafts</div>
            </div>
          )}

          <div className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2"><Gavel className="h-4 w-4" /><h2 className="text-base font-semibold">Decision</h2></div>
            {decided ? (
              <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="decision-result">
                <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> {DECISION_LABEL[decided.decision]} by {decided.decided_by}</div>
                <div className="text-xs mt-1">{fmtDateTime(decided.decided_ts)} · covers {(decided.related_alert_ids ?? []).length + 1} alert(s){decided.bsa_filing_ref ? ` · BSA ID ${decided.bsa_filing_ref}` : ''}</div>
                <div className="text-xs mt-1 italic">“{decided.rationale}”</div>
              </div>
            ) : (
              <>
                <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Decision rationale (required for the BSA audit trail)…"
                  className="w-full h-20 rounded-md border p-2 text-xs" data-testid="rationale" />
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => decide('file_sar')} disabled={!!saving} data-testid="decide-file_sar" className="inline-flex items-center justify-center gap-1 rounded-md bg-[#D1495B] px-2 py-2 text-xs text-white disabled:opacity-50">{saving === 'file_sar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} File SAR</button>
                  <button onClick={() => decide('escalate')} disabled={!!saving} data-testid="decide-escalate" className="inline-flex items-center justify-center gap-1 rounded-md bg-amber-500 px-2 py-2 text-xs text-white disabled:opacity-50">{saving === 'escalate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />} Escalate</button>
                  <button onClick={() => decide('close_no_sar')} disabled={!!saving} data-testid="decide-close_no_sar" className="inline-flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-xs disabled:opacity-50">{saving === 'close_no_sar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Close — no SAR</button>
                </div>
                {decideErr && <div className="rounded bg-red-50 p-2 text-xs text-red-700" data-testid="decide-error">{decideErr}</div>}
                {c.network_alerts.length > 1 && <div className="text-[11px] text-muted-foreground">Decision applies to all {c.network_alerts.length} open alerts in this network case.</div>}
              </>
            )}
            {result && !decided && <div className="text-xs text-emerald-700">Saved.</div>}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold text-sm mb-2">Audit trail <span className="font-normal text-muted-foreground">· case_audit_log (Delta)</span></h2>
            <ol className="space-y-2 max-h-72 overflow-y-auto" data-testid="audit-trail">
              {(c.audit_log ?? []).map((e: Json, i: number) => (
                <li key={i} className="border-l-2 border-[#3E7CB1]/40 pl-2 text-xs">
                  <div className="font-medium">{String(e.event_type).replaceAll('_', ' ')} <span className="font-normal text-muted-foreground">· {e.actor} · {fmtDateTime(e.event_ts)}</span></div>
                  <div className="text-muted-foreground line-clamp-3">{e.detail}</div>
                </li>
              ))}
              {!(c.audit_log ?? []).length && <li className="text-xs text-muted-foreground">No events yet.</li>}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
