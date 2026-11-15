/**
 * Signal workbench — one emerging failure, end to end:
 *   left  : weekly claims, the cohort chart (claims per 1,000 bike-years per lot / firmware),
 *           the claims themselves — dealer labor code vs what ai_classify read in the notes
 *   right : "Assemble root-cause case" (streamed steps → root cause, findings confirmed / ruled
 *           out, lot table with coating + PPAP, telemetry, exposure, supplier-quality library
 *           answer, priced containment options) → supplier 8D / chargeback notice →
 *           "Open quality case" (write-back to Lakebase + audit trail).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, CircleAlert, CloudRain, FileSearch, FolderCheck, Loader2, Radar,
  ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  fetchSignal, money, moneyK, openCase, runAnalysis,
  type Analysis, type Claim, type SignalDetail, type StepEvent,
} from '@/warranty/api';
import { Kpi, Pill, Sparkline, StatusPill, VERDICT_LABEL, VERDICT_TONE, cn } from '@/warranty/ui';

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

function CohortChart({ sig }: { sig: SignalDetail }) {
  const all = sig.cohort?.all ?? [];
  if (!all.length) return null;
  const max = Math.max(1, ...all.map((v) => v.rate));
  const dim = sig.cohort?.dimension === 'firmware_version' ? 'firmware' : sig.cohort?.dimension.replace('_', ' ');
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold">Claims per 1,000 bike-years, by {dim}</div>
        <div className="text-[11px] text-[var(--muted-foreground)]">rest of population: {sig.cohort?.rest_rate}</div>
      </div>
      <div className="mt-3 flex h-36 items-end gap-1">
        {all.map((v) => (
          <div key={v.value} className="group flex h-full flex-1 flex-col items-center justify-end" title={`${v.value}: ${v.claims} claims · ${v.units.toLocaleString()} bikes · ${v.rate} per 1K bike-years`}>
            <div className="text-[9px] tabular-nums text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100">{Math.round(v.rate)}</div>
            <div className="w-full rounded-t" style={{ height: `${Math.max(2, (v.rate / max) * 100)}%`, background: v.suspect ? 'var(--brand-5)' : v.in_scope ? 'var(--brand-4)' : 'var(--primary-light)' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {all.map((v, i) => (
          <div key={v.value} className={cn('flex-1 text-center text-[9px] tabular-nums', v.suspect ? 'font-semibold text-[var(--brand-5)]' : 'text-[var(--muted-foreground)]')}>
            {all.length <= 8 || i % 2 === 0 || v.suspect ? v.value.replace(/^HX-/, '') : ''}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted-foreground)]">
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-[var(--brand-5)]" />suspect</span>
        {all.some((v) => v.in_scope && !v.suspect) && <span><span className="mr-1 inline-block size-2 rounded-sm bg-[var(--brand-4)]" />same PCN, too young to fail yet</span>}
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-[var(--primary-light)]" />other</span>
      </div>
    </div>
  );
}

function ClaimCard({ c }: { c: Claim }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left">
        <FileSearch className="mt-0.5 size-4 shrink-0 text-[var(--primary-light)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <b className="text-sm">{c.id}</b>
            <span className="text-[var(--muted-foreground)]">{c.claimDate} · {c.modelName} · {c.dealerName}</span>
          </div>
          <div className={cn('mt-0.5 text-xs leading-relaxed text-[var(--foreground)]/85', !open && 'line-clamp-2')}>{c.technicianNotes}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Pill tone={c.matchesDealerCode ? 'neutral' : 'warn'}>dealer code {c.dealerLaborCode}</Pill>
            <Pill tone="info"><Sparkles className="size-3" />{c.failureModeLabel}</Pill>
            {c.faultCode && <Pill tone="bad">{c.faultCode}</Pill>}
            {c.waterExposure && <Pill tone="info"><CloudRain className="size-3" />water</Pill>}
            {c.controllerLot && <Pill tone="neutral">lot {c.controllerLot}</Pill>}
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums">{money(c.totalCost)}</span>
      </button>
      {open && c.observedDamage && (
        <div className="border-t border-[var(--border)] px-4 py-2 text-xs"><span className="text-[var(--muted-foreground)]">ai_extract · observed damage:</span> {c.observedDamage}</div>
      )}
    </div>
  );
}

const VERDICT_ICON = { CONFIRMED: AlertTriangle, RULED_OUT: XCircle, WATCH: Radar, INFO: FileSearch } as const;

function AnalysisView({ a, sig, selected, toggle }: { a: Analysis; sig: SignalDetail; selected: string[]; toggle: (k: string) => void }) {
  const scope = new Set(sig.cohort?.all.filter((v) => v.in_scope || v.suspect).map((v) => v.value) ?? []);
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#FFF1EB] px-4 py-3 text-[#7A2410]">
        <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-5" />{a.headline}</div>
        <p className="mt-1 text-sm leading-relaxed"><b>Root cause:</b> {a.root_cause}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[#7A2410]/85">{a.summary}</p>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Evidence — live SQL on the lakehouse</div>
        {a.findings.map((f) => {
          const Icon = VERDICT_ICON[f.verdict] ?? FileSearch;
          return (
            <div key={f.id} className="grid grid-cols-[96px_1fr] gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0" data-finding={f.id}>
              <div><Pill tone={VERDICT_TONE[f.verdict]}><Icon className="size-3" />{VERDICT_LABEL[f.verdict]}</Pill></div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{f.title}</div>
                <div className="text-xs leading-relaxed text-[var(--foreground)]/80">{f.detail}</div>
              </div>
            </div>
          );
        })}
      </div>

      {a.lots.length > 0 && sig.cohort?.dimension === 'controller_lot' && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Controller lots — genealogy, coating, PPAP</div>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-[var(--muted-foreground)]"><tr>{['Lot', 'Coating', 'PPAP', 'Bikes', 'Claims', '/1K bike-yrs', 'E21 /1K conn.'].map((h) => <th key={h} className="px-3 py-1.5 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {a.lots.filter((l) => l.lot >= 'HX-2601' || scope.has(l.lot)).map((l) => (
                <tr key={l.lot} className={cn('border-t border-[var(--border)]', scope.has(l.lot) && 'bg-[#FFF5F1]')}>
                  <td className={cn('px-3 py-1.5 font-medium', scope.has(l.lot) && 'text-[var(--brand-5)]')}>{l.lot}</td>
                  <td className="px-3 py-1.5">{l.coating}</td>
                  <td className={cn('px-3 py-1.5', l.ppap?.includes('NOT') && 'font-semibold text-[var(--brand-5)]')}>{l.ppap}</td>
                  <td className="px-3 py-1.5 tabular-nums">{l.units.toLocaleString()}</td>
                  <td className="px-3 py-1.5 tabular-nums">{l.claims}</td>
                  <td className="px-3 py-1.5 tabular-nums">{Math.round(l.rate)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{l.e21_rate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.exposure && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Kpi label="Bikes in scope" value={a.exposure.affected_units.toLocaleString()} sub={`${a.exposure.in_field.toLocaleString()} in the field · ${a.exposure.in_stock.toLocaleString()} in dealer stock`} />
          <Kpi label="Claims to date" value={a.exposure.claims_to_date} sub={`${money(a.exposure.cost_to_date)} paid / pending`} />
          <Kpi label="Projected claims" value={a.exposure.projected_claims.toLocaleString()} tone="warn" sub="rest of the 24-month warranty" />
          <Kpi label="Projected cost" value={moneyK(a.exposure.projected_cost)} tone="bad" sub={`${Math.round(a.exposure.wet_share * 100)}% in wet regions`} />
        </div>
      )}

      {a.supplier_guidance && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--info-subtle)]/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"><BookOpen className="size-4" />Supplier-quality library (Genie agent)</div>
          <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">“{a.supplier_guidance.question}”</div>
          <div className="mt-1.5 text-sm leading-relaxed space-y-1.5 [&_strong]:font-semibold"><ReactMarkdown>{a.supplier_guidance.answer}</ReactMarkdown></div>
          {a.supplier_guidance.source && <div className="mt-1 text-[11px] text-[var(--primary-light)]">Sources: {a.supplier_guidance.source}</div>}
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Containment options — priced (select what goes into the quality case)</div>
        {a.options.map((o) => (
          <label key={o.key} className="flex cursor-pointer gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0" data-option={o.key}>
            <input type="checkbox" className="mt-1" checked={selected.includes(o.key)} onChange={() => toggle(o.key)} disabled={!!sig.qualityCaseId} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{o.label}{o.recommended && <Pill tone="good">recommended</Pill>}</div>
              <div className="text-xs leading-relaxed text-[var(--foreground)]/80">{o.detail}</div>
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums">
              {o.cost != null && <div>cost <b>{moneyK(o.cost)}</b></div>}
              {o.recoverable != null && o.recoverable > 0 && <div className="text-[var(--success)]">recoverable {moneyK(o.recoverable)}</div>}
            </div>
          </label>
        ))}
        {a.chargeback && (
          <div className="border-t border-[var(--border)] bg-[var(--success-subtle)] px-4 py-2 text-xs text-[var(--success-subtle-foreground)]">
            <b>Chargeback to {sig.supplierName}: {money(a.chargeback.total)}</b> = {money(a.chargeback.to_date)} claims to date + {money(a.chargeback.campaign)} campaign · {a.chargeback.basis}
          </div>
        )}
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { ai_analysis: 'Root-cause case assembled', case_opened: 'Quality case opened', notice_edited: 'Supplier notice edited', note: 'Note' };

export function SignalWorkbench() {
  const { id = '' } = useParams();
  const [s, setS] = useState<SignalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(() => {
    fetchSignal(id).then((d) => {
      setS(d); setNotice(d.qualityCase?.supplierNotice ?? d.supplierNoticeDraft ?? ''); setError(null);
      setSelected(d.qualityCase ? d.qualityCase.containmentActions.map((o) => o.key) : (d.analysis?.options ?? []).filter((o) => o.recommended).map((o) => o.key));
    }).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { setSteps([]); load(); }, [load]);

  const run = async () => {
    setRunning(true);
    setSteps([]);
    await runAnalysis(id, {
      step: (e) => setSteps((prev) => { const i = prev.findIndex((p) => p.id === e.id); return i >= 0 ? prev.map((p, j) => (j === i ? e : p)) : [...prev, e]; }),
      result: (r) => {
        setS((prev) => prev && { ...prev, analysis: r.analysis, supplierNoticeDraft: r.notice });
        setNotice(r.notice);
        setSelected(r.analysis.options.filter((o) => o.recommended).map((o) => o.key));
      },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Root-cause analysis failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
    dataMutated.emit();
  };

  const submit = async () => {
    setSaving(true);
    try {
      await openCase(id, { actions: selected, notes: notes || undefined, noticeText: notice });
      load();
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const claims = useMemo(() => {
    const list = [...(s?.claims ?? [])];
    // the technician note that says it best goes first (the longest, most specific ones)
    list.sort((a, b) => (b.technicianNotes?.length ?? 0) - (a.technicianNotes?.length ?? 0));
    return list.slice(0, 3).concat((s?.claims ?? []).filter((c) => !list.slice(0, 3).includes(c)).slice(0, 9));
  }, [s]);

  if (error && !s) return <div className="p-8 text-[var(--destructive)]">Could not load signal {id}: {error}</div>;
  if (!s) return <div className="p-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-[var(--muted)] animate-pulse" />)}</div>;

  const a = s.analysis;
  const projected = s.exposure.reduce((x, r) => x + r.projected_cost, 0);
  const inScope = s.exposure.reduce((x, r) => x + r.units, 0);
  const qc = s.qualityCase;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/signals" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft className="size-3" />Early-warning board</Link>
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-[var(--primary)] px-6 py-4 text-white">
          <div>
            <div className="text-xs text-white/70">{s.id} · {s.component} · first claim of the surge {s.firstRecentClaim}</div>
            <h1 className="font-display text-2xl font-semibold">{s.failureModeLabel}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="neutral" className="bg-white/15 text-white">{s.supplierName}</Pill>
              <Pill tone="neutral" className="bg-white/15 text-white">{s.cohort?.dimension.replace('_', ' ')}: {s.cohort?.suspect.map((x) => x.value).join(', ')}</Pill>
              {s.chargeable ? <Pill tone="info">chargeable to supplier</Pill> : <Pill tone="neutral" className="bg-white/15 text-white">Brightwater firmware — not chargeable</Pill>}
              <StatusPill status={s.status} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 text-right">
            <div><div className="text-[10px] uppercase text-white/60">Claims 90 d</div><div className="text-2xl font-semibold tabular-nums">{s.claims90d}</div></div>
            <div><div className="text-[10px] uppercase text-white/60">vs last year</div><div className="text-2xl font-semibold tabular-nums text-[#FFC2AE]">{s.rateRatio}×</div></div>
            <div><div className="text-[10px] uppercase text-white/60">Bikes in scope</div><div className="text-2xl font-semibold tabular-nums">{inScope.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-white/60">Projected</div><div className="text-2xl font-semibold tabular-nums text-[#FFC2AE]">{moneyK(projected)}</div></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold">Claims per week, last 26 weeks</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">{s.claimsTotal} claims total · {moneyK(s.costToDate)}</div>
              </div>
              <div className="mt-2"><Sparkline values={s.weekly.map((w) => w.claims)} w={520} h={64} /></div>
            </div>
            <CohortChart sig={s} />
            <div className="flex items-center justify-between px-1">
              <div className="text-sm font-semibold">Dealer claims ({s.claims.length})</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">dealer labor code vs what ai_classify read in the notes</div>
            </div>
            {claims.map((c) => <ClaimCard key={c.id} c={c} />)}
            <Link to={`/claims?mode=${s.failureMode}`} className="block text-center text-xs text-[var(--primary-light)] hover:underline">All {s.claims.length} claims in the claims explorer →</Link>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-sm font-semibold">Audit trail</div>
              {s.auditTrail.length === 0 && <div className="mt-1 text-xs text-[var(--muted-foreground)]">No actions yet.</div>}
              <ol className="mt-2 space-y-1.5">
                {[...s.auditTrail].reverse().map((e, i) => (
                  <li key={i} className="text-xs"><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span> · {e.by} · <span className="text-[var(--muted-foreground)]">{new Date(e.at).toLocaleString()}</span>{e.notes && <div className="text-[var(--muted-foreground)]">{e.notes}</div>}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />Root-cause case</div>
                  <div className="text-xs text-[var(--muted-foreground)]">Isolates the cohort, tests alternatives on the lakehouse, reads telemetry, asks the supplier-quality library, prices containment. You decide.</div>
                </div>
                <button onClick={run} disabled={running} data-testid="run-analysis"
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {a ? 'Re-run analysis' : 'Assemble root-cause case'}
                </button>
              </div>
              {steps.length > 0 && <div className="mt-4 rounded-xl bg-[var(--muted)]/60 p-3"><Steps steps={steps} /></div>}
              {a && !running && <div className="mt-4"><AnalysisView a={a} sig={s} selected={selected} toggle={(k) => setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} /></div>}
              {!a && steps.length === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                  Not analyzed yet. It takes about 30 seconds.
                </div>
              )}
            </div>

            {a && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{s.chargeable ? `Notice to ${s.supplierName} — 8D request + chargeback` : 'Field-action brief'}</div>
                  <Pill tone="info">AI draft — review before sending</Pill>
                </div>
                <textarea value={notice} onChange={(e) => setNotice(e.target.value)} disabled={!!qc} data-testid="notice"
                  className="h-72 w-full resize-y rounded-lg border border-[var(--border)] bg-[#FDFDFB] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary-light)]" />
                {qc ? (
                  <div className="rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-sm text-[var(--success-subtle-foreground)]" data-testid="case-opened">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FolderCheck className="size-4" />Quality case <b>{qc.id}</b> opened by {qc.owner} · {new Date(qc.createdAt).toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs">
                      {qc.containmentActions.map((o) => o.label).join(' · ')}
                      {qc.chargebackAmount != null && <> · chargeback <b>{money(qc.chargebackAmount)}</b></>}
                      {qc.affectedLots.length > 0 && <> · lots {qc.affectedLots.join(', ')}</>}
                    </div>
                    <Link to="/cases" className="mt-1 inline-block text-xs underline">Open quality cases →</Link>
                  </div>
                ) : (
                  <>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Engineer note (optional)"
                      className="h-9 w-full rounded-lg border border-[var(--border)] px-3 text-sm outline-none" />
                    <button onClick={submit} disabled={saving || selected.length === 0} data-testid="open-case"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                      Open quality case{s.chargeable ? ' & send to supplier' : ''} ({selected.length} actions)
                    </button>
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
