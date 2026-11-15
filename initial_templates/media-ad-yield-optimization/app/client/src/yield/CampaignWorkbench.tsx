/**
 * Campaign workbench — one under-delivering IO, end to end:
 *   left  : pacing header, line items (booked / delivered / run-rate / projected), the problem
 *           inventory's avails week by week, audit trail
 *   right : "Build recovery plan" (streamed steps → diagnosis, findings confirmed / ruled out,
 *           spare avails for the booked audience, the priced reallocation, the floor fix, the IO
 *           terms from the Genie agent over the ad-sales documents) → agency notice + ad-ops instructions →
 *           "Approve & send to ad ops" (write-back to Lakebase + audit trail).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, CircleAlert, FileSearch, FolderCheck, Info, Loader2, Repeat2, Send, Sparkles, Tags, XCircle,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  approvePlan, cpm, fetchCampaign, who, imps, money, moneyK, pct, runPlan,
  type CampaignDetail, type RecoveryPlan, type StepEvent,
} from '@/yield/api';
import { Kpi, Pill, StatusPill, VERDICT_LABEL, VERDICT_TONE, cn } from '@/yield/ui';

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

function AvailsChart({ rows, flightStart, label }: { rows: Array<{ week: string; avails: number }>; flightStart: string; label: string }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.avails));
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold">Weekly avails — {label}</div>
        <div className="text-[11px] text-[var(--muted-foreground)]">flight starts {flightStart}</div>
      </div>
      <div className="mt-3 flex h-32 items-end gap-1">
        {rows.map((r) => (
          <div key={r.week} className="group flex h-full flex-1 flex-col items-center justify-end" title={`week of ${r.week}: ${imps(r.avails)} avails`}>
            <div className="text-[9px] tabular-nums text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100">{imps(r.avails)}</div>
            <div className="w-full rounded-t" style={{ height: `${Math.max(2, (r.avails / max) * 100)}%`, background: r.week >= flightStart ? 'var(--primary-light)' : 'var(--muted-foreground)', opacity: r.week >= flightStart ? 1 : 0.35 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {rows.map((r, i) => <div key={r.week} className="flex-1 text-center text-[9px] text-[var(--muted-foreground)]">{i % 2 === 0 ? new Date(`${r.week.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}</div>)}
      </div>
    </div>
  );
}

const VERDICT_ICON = { CONFIRMED: AlertTriangle, RULED_OUT: XCircle, INFO: Info } as const;

function PlanView({ a }: { a: RecoveryPlan }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgb(255_77_94/0.35)] bg-[rgb(255_77_94/0.09)] px-4 py-3 text-[var(--brand-ink)]">
        <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-5" />{a.headline}</div>
        <p className="mt-1 text-sm leading-relaxed"><b>Diagnosis:</b> {a.diagnosis}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">{a.summary}</p>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Evidence — live SQL on the lakehouse + ai_forecast</div>
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

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Spare avails to flight end that reach the booked audience (forecast − committed)</div>
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-[var(--muted-foreground)]"><tr>{['Product', 'Tier', 'Audience reach', 'In-target spare', 'Displaced eCPM', 'Make-good eligible'].map((h) => <th key={h} className="px-3 py-1.5 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {a.spare.filter((s) => s.eligible || s.in_target_spare > 1_000_000).slice(0, 9).map((s) => (
              <tr key={s.product_id} className={cn('border-t border-[var(--border)]', a.reallocations.some((r) => r.product_id === s.product_id) && 'bg-[var(--success-subtle)]/60')}>
                <td className="px-3 py-1.5 font-medium">{s.product_name}</td>
                <td className="px-3 py-1.5">{s.tier}</td>
                <td className="px-3 py-1.5 tabular-nums">{pct(s.audience_share)}</td>
                <td className="px-3 py-1.5 tabular-nums">{imps(s.in_target_spare)}</td>
                <td className="px-3 py-1.5 tabular-nums">{s.platform === 'Linear' ? 'unsold linear' : cpm(s.displaced_ecpm)}</td>
                <td className="px-3 py-1.5">{s.eligible ? <Pill tone="good">eligible</Pill> : <span className="text-[var(--muted-foreground)]">{s.reason}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">The plan — priced</div>
        {a.reallocations.map((r) => (
          <div key={r.product_id} className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0" data-realloc={r.product_id}>
            <Repeat2 className="size-4 shrink-0 text-[var(--primary-light)]" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{imps(r.impressions)} make-good impressions → {r.product_name}</div>
              <div className="text-xs text-[var(--muted-foreground)]">cap {imps(r.daily_cap)}/day to flight end · {pct(r.audience_share)} audience reach · displaces {r.displaced_ecpm ? `programmatic at ${cpm(r.displaced_ecpm)}` : 'unsold linear avails'}</div>
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums">cost {moneyK(r.displaced_revenue)}</div>
          </div>
        ))}
        {a.floor_changes.map((f) => (
          <div key={f.product_id} className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2.5" data-floor={f.product_id}>
            <Tags className="size-4 shrink-0 text-[var(--brand-5)]" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Restore {f.product_name}: {f.from_group} {cpm(f.from_floor)} → {f.to_group} {cpm(f.to_floor)}{f.release_from_deal ? ` · release from ${f.release_from_deal}` : ''}</div>
              <div className="text-xs leading-relaxed text-[var(--muted-foreground)]">{f.detail}</div>
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums text-[var(--success)]">+{moneyK(f.expected_uplift_window)}<div className="text-[10px] text-[var(--muted-foreground)]">to flight end</div></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Shortfall covered" value={pct(a.impact.coverage_pct)} sub={`${imps(a.impact.impressions_moved)} moved for ${imps(a.pacing.shortfall)} short`} />
        <Kpi label="Liability avoided" value={moneyK(a.impact.liability_avoided)} sub={`at the ${cpm(a.pacing.cpm)} IO CPM`} />
        <Kpi label="Programmatic displaced" value={moneyK(a.impact.displaced_revenue)} tone="warn" sub="revenue those impressions earn today" />
        <Kpi label="Net impact" value={moneyK(a.impact.net_impact)} sub={`incl. floor fix +${moneyK(a.impact.floor_uplift)}`} />
      </div>

      {a.contract_guidance && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--info-subtle)]/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"><BookOpen className="size-4" />IO terms + policy (Genie agent over the documents)</div>
          <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">“{a.contract_guidance.question}”</div>
          <div className="mt-1.5 text-sm leading-relaxed space-y-1.5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"><ReactMarkdown>{a.contract_guidance.answer}</ReactMarkdown></div>
          {a.contract_guidance.source && <div className="mt-1 text-[11px] text-[var(--primary-light)]">Sources: {a.contract_guidance.source}</div>}
        </div>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { ai_analysis: 'Recovery plan built', plan_approved: 'Plan approved & sent to ad ops', notice_edited: 'Agency notice edited', note: 'Note' };

export function CampaignWorkbench() {
  const { id = '' } = useParams();
  const [c, setC] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchCampaign(id).then((d) => { setC(d); setNotice(d.approvedPlan?.agencyNotice ?? d.agencyNoticeDraft ?? ''); setError(null); })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { setSteps([]); load(); }, [load]);

  const run = async () => {
    setRunning(true);
    setSteps([]);
    await runPlan(id, {
      step: (e) => setSteps((prev) => { const i = prev.findIndex((p) => p.id === e.id); return i >= 0 ? prev.map((p, j) => (j === i ? e : p)) : [...prev, e]; }),
      result: (r) => { setC((prev) => prev && { ...prev, analysis: r.plan, agencyNoticeDraft: r.notice }); setNotice(r.notice); },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'Recovery plan failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
    dataMutated.emit();
  };

  const submit = async () => {
    setSaving(true);
    try {
      await approvePlan(id, { notes: notes || undefined, noticeText: notice });
      load();
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !c) return <div className="p-8 text-[var(--destructive)]">Could not load campaign {id}: {error}</div>;
  if (!c) return <div className="p-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-[var(--muted)] animate-pulse" />)}</div>;

  const a = c.analysis;
  const ap = c.approvedPlan;
  const riskLine = [...c.lines].sort((x, y) => (y.booked - y.projected) - (x.booked - x.projected))[0];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/campaigns" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft className="size-3" />Campaigns at risk</Link>
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-none border border-[var(--border)] border-l-4 border-l-[var(--brand-5)] bg-[var(--card)] px-6 py-4 text-white">
          <div>
            <div className="text-xs text-white/70">{c.ioNumber} · {c.id} · {c.dealType} · flight {c.flightStart} → {c.flightEnd}</div>
            <h1 className="font-display text-2xl font-semibold">{c.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="neutral" className="bg-white/15 text-white">{c.advertiserName} · {c.agency}</Pill>
              <Pill tone="neutral" className="bg-white/15 text-white">{c.targetSegment}</Pill>
              <Pill tone="neutral" className="bg-white/15 text-white">{imps(c.bookedImpressions)} guaranteed · {money(c.bookedRevenue)}</Pill>
              <StatusPill status={c.status} atRisk={c.atRisk} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 text-right">
            <div><div className="text-[10px] uppercase text-white/60">Pacing</div><div className="text-2xl font-semibold tabular-nums">{pct(c.pacing)}</div></div>
            <div><div className="text-[10px] uppercase text-white/60">Projected</div><div className="text-2xl font-semibold tabular-nums text-[var(--brand-5)]">{pct(c.projectedDeliveryPct)}</div></div>
            <div><div className="text-[10px] uppercase text-white/60">Shortfall</div><div className="text-2xl font-semibold tabular-nums">{imps(c.projectedShortfall)}</div></div>
            <div><div className="text-[10px] uppercase text-white/60">Liability</div><div className="text-2xl font-semibold tabular-nums text-[var(--brand-5)]">{moneyK(c.makeGoodLiability)}</div></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="flex items-baseline justify-between px-4 py-2.5">
                <div className="text-sm font-semibold">Line items</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">{c.daysRemaining} days left · {imps(c.delivered)} of {imps(c.expectedToDate)} expected to date</div>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-[var(--muted)] text-[10px] uppercase text-[var(--muted-foreground)]"><tr>{['Inventory', 'Booked', 'Delivered', 'Plan / day', 'Run-rate', 'Projected'].map((h) => <th key={h} className="px-3 py-1.5 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {c.lines.map((l) => (
                    <tr key={l.line_id} className={cn('border-t border-[var(--border)]', l.line_id === riskLine?.line_id && c.atRisk && 'bg-[rgb(255_77_94/0.09)]')} data-line={l.line_id}>
                      <td className="px-3 py-1.5"><div className="font-medium">{l.product_name}</div><div className="text-[10px] text-[var(--muted-foreground)]">{l.line_id} · {cpm(l.cpm)} CPM</div></td>
                      <td className="px-3 py-1.5 tabular-nums">{imps(l.booked)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{imps(l.delivered)}<div className="text-[10px] text-[var(--muted-foreground)]">{pct(l.pacing)} pacing</div></td>
                      <td className="px-3 py-1.5 tabular-nums">{imps(l.planned_daily)}</td>
                      <td className={cn('px-3 py-1.5 tabular-nums', l.run_rate < 0.9 * l.planned_daily && 'font-semibold text-[var(--brand-5)]')}>{imps(l.run_rate)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{pct(l.projected / l.booked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {a?.weekly_avails && riskLine && <AvailsChart rows={a.weekly_avails} flightStart={c.flightStart} label={riskLine.product_name} />}
            {c.makeGoodTerms && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-xs">
                <div className="text-sm font-semibold">Make-good terms</div>
                <div className="mt-1 text-[var(--foreground)]/80">{c.makeGoodTerms}</div>
              </div>
            )}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-sm font-semibold">Audit trail</div>
              {c.auditTrail.length === 0 && <div className="mt-1 text-xs text-[var(--muted-foreground)]">No actions yet.</div>}
              <ol className="mt-2 space-y-1.5">
                {[...c.auditTrail].reverse().map((e, i) => (
                  <li key={i} className="text-xs"><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span> · {who(e.by)} · <span className="text-[var(--muted-foreground)]">{new Date(e.at).toLocaleString()}</span>{e.notes && <div className="text-[var(--muted-foreground)]">{who(e.notes)}</div>}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />Recovery plan</div>
                  <div className="text-xs text-[var(--muted-foreground)]">Diagnoses the line, forecasts avails, finds spare equal-or-better inventory, checks the IO terms and the pricing, and prices the rebalance. You approve.</div>
                </div>
                <button onClick={run} disabled={running} data-testid="build-plan"
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60">
                  {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {a ? 'Rebuild plan' : 'Build recovery plan'}
                </button>
              </div>
              {steps.length > 0 && <div className="mt-4 rounded-xl bg-[var(--muted)]/60 p-3"><Steps steps={steps} /></div>}
              {a && !running && <div className="mt-4"><PlanView a={a} /></div>}
              {!a && steps.length === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                  No plan yet. It takes about 30 seconds.
                </div>
              )}
            </div>

            {a && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Notice to {c.agency} — delivery recovery plan</div>
                  <Pill tone="info">AI draft — review before sending</Pill>
                </div>
                <textarea value={notice} onChange={(e) => setNotice(e.target.value)} disabled={!!ap} data-testid="notice"
                  className="h-64 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary-light)]" />
                <details className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium">Ad-ops trafficking instructions</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-[var(--foreground)]/85">{a.ad_ops_instructions}</pre>
                </details>
                {ap ? (
                  <div className="rounded-lg bg-[var(--success-subtle)] px-3 py-2 text-sm text-[var(--success-subtle-foreground)]" data-testid="plan-approved">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FolderCheck className="size-4" />Plan <b>{ap.id}</b> approved by {who(ap.approvedBy)} and sent to ad ops · {new Date(ap.createdAt).toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs">
                      {ap.reallocations.map((r) => `${imps(r.impressions)} → ${r.product_name}`).join(' · ')}
                      {ap.floorChanges.length > 0 && <> · floor {ap.floorChanges.map((f) => `${f.product_name} → ${f.to_group}`).join(', ')}</>}
                      {ap.liabilityAvoided != null && <> · liability avoided <b>{money(ap.liabilityAvoided)}</b></>}
                    </div>
                    <Link to="/plans" className="mt-1 inline-block text-xs underline">Open yield actions →</Link>
                  </div>
                ) : (
                  <>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for ad ops (optional)"
                      className="h-9 w-full rounded-lg border border-[var(--border)] px-3 text-sm outline-none" />
                    <button onClick={submit} disabled={saving} data-testid="approve-plan"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-medium text-[var(--success-foreground)] disabled:opacity-50">
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      Approve plan &amp; send to ad ops
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
