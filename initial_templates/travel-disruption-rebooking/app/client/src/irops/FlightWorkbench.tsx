/**
 * Flight workbench — one cancelled flight, end to end:
 *   left  : the manifest in priority order (SSR, onward connections, tier, the AI-Functions reading of each
 *           passenger's message, ML detractor risk) next to what AutoProtect held and what the plan does;
 *           the protected seats + hotel rooms.
 *   right : the re-accommodation plan (streamed steps → plan vs AutoProtect → guardrails → Duty Manager
 *           summary → policy guidance (Genie agent) → passenger notifications) and the submit / commit actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BedDouble, BookOpen, Check, CheckCircle2, ChevronDown, CircleAlert, Hotel, Loader2, MessageSquareWarning,
  Plane, PlaneTakeoff, RefreshCw, Send, ShieldCheck, Sparkles, Users, XCircle,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  clock, fetchFlight, money, pct, runPlan, submitPlan, type Assignment, type FlightDetail, type Passenger, type Plan, type PlanMetrics, type StepEvent,
} from './api';
import { FlightStatusPill, Pill, SsrChips, TierBadge, cn } from './ui';

const NEEDS = /UMNR|WCHR|WCHS|WCHC|BLND|DEAF|MEDA|INFT/;
const needsProtecting = (p: Passenger) => NEEDS.test(p.ssr) || p.onwardLongHaul || p.escalated || p.tier === 'Diamond' || p.tier === 'Platinum';
const apWhen = (p: { apSameDay: boolean; apNights: number }) => (p.apSameDay ? 'today' : p.apNights === 1 ? 'tomorrow' : 'Sunday');

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

const ROWS: Array<{ k: keyof PlanMetrics; label: string; fmt: (v: number | null, m: PlanMetrics) => string; better: 'up' | 'down' }> = [
  { k: 'same_day', label: 'Re-accommodated today', fmt: (v, m) => `${v} / ${m.pax}`, better: 'up' },
  { k: 'day_plus_2', label: 'Pushed to Sunday (day+2)', fmt: (v) => String(v), better: 'down' },
  { k: 'priority_same_day', label: 'Priority passengers today (P1-P3)', fmt: (v, m) => `${v} / ${m.priority_pax}`, better: 'up' },
  { k: 'special_assistance_overnight', label: 'Special assistance left overnight', fmt: (v) => String(v), better: 'down' },
  { k: 'umnr_overnight', label: 'Unaccompanied minors overnight', fmt: (v) => String(v), better: 'down' },
  { k: 'misconnects', label: 'Missed long-haul connections', fmt: (v, m) => `${v} / ${m.onward_pax}`, better: 'down' },
  { k: 'split_parties', label: 'Bookings split across flights', fmt: (v) => String(v), better: 'down' },
  { k: 'partner_spend', label: 'Lumen Air partner spend', fmt: (v) => money(v), better: 'down' },
  { k: 'hotel_rooms', label: 'Hotel rooms owed', fmt: (v) => String(v), better: 'down' },
  { k: 'total_cost', label: 'Total recovery cost', fmt: (v) => money(v), better: 'down' },
  { k: 'cost_per_pax', label: 'Cost per disrupted passenger', fmt: (v) => money(v), better: 'down' },
  { k: 'predicted_detractor_rate', label: 'Predicted detractors (NPS 0-6)', fmt: (v) => pct(v), better: 'down' },
];

function Compare({ plan }: { plan: Plan }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
        <tr><th className="py-1 text-left font-medium" /><th className="py-1 text-right font-medium">AutoProtect</th><th className="py-1 text-right font-medium text-[var(--primary)]">Copilot plan</th></tr>
      </thead>
      <tbody>
        {ROWS.map((r) => {
          const a = Number(plan.autoprotect[r.k] ?? 0), b = Number(plan.metrics[r.k] ?? 0);
          const good = r.better === 'up' ? b > a : b < a;
          const bad = r.better === 'up' ? b < a : b > a;
          return (
            <tr key={r.k} className="border-t border-[var(--border)]">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--muted-foreground)]">{r.fmt(plan.autoprotect[r.k] as number, plan.autoprotect)}</td>
              <td className={cn('py-1.5 text-right tabular-nums font-semibold', good && 'text-[var(--success)]', bad && 'text-[var(--brand-5)]')}>{r.fmt(plan.metrics[r.k] as number, plan.metrics)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const G_TONE = { ok: 'good', approval: 'warn', exempt: 'info', exception: 'bad' } as const;

function PaxRow({ p, a, open, onToggle }: { p: Passenger; a?: Assignment; open: boolean; onToggle: () => void }) {
  const changed = a && a.label !== p.apLabel;
  return (
    <div className={cn('border-t border-[var(--border)] px-4 py-2', open && 'bg-[var(--muted)]/40')}>
      <button onClick={onToggle} className="grid w-full grid-cols-[1.35fr_1fr_1fr] items-center gap-3 text-left text-sm">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium truncate">{p.firstName} {p.lastName}</span>
            {p.age != null && p.age < 16 && <span className="text-xs text-[var(--muted-foreground)]">age {p.age}</span>}
            <TierBadge tier={p.tier} />
            <SsrChips ssr={p.ssr} />
            {p.escalated && <MessageSquareWarning className="size-3.5 text-[var(--brand-5)]" aria-label="escalated message" />}
          </div>
          <div className="text-[11px] text-[var(--muted-foreground)] truncate">
            {p.pnr}{p.partySize > 1 ? ` · party of ${p.partySize}` : ''} · {p.originType === 'LOCAL' ? 'lives here' : p.originType === 'CONNECTING' ? 'connecting' : `going home to ${p.homeCity}`}
            {p.onwardFlight ? ` · ➜ ${p.onwardFlight} ${p.onwardDep?.slice(11)}` : ''}{p.language && p.language !== 'English' ? ` · ${p.language}` : ''}
          </div>
        </div>
        <div className="text-xs">
          <div className={cn('tabular-nums', !p.apSameDay && 'text-[var(--brand-5)]')}>{p.apLabel?.split(' ').slice(0, 2).join(' ')} · {apWhen(p)}</div>
          {p.apMisconnect && <div className="text-[11px] font-semibold text-[var(--brand-5)]">misses connection</div>}
          {p.apSplit && <div className="text-[11px] text-[var(--brand-5)]">party split</div>}
        </div>
        <div className="text-xs">
          {a ? (
            <>
              <div className={cn('tabular-nums font-medium', a.same_day ? 'text-[var(--success)]' : '')}>
                {a.label.split(' ').slice(0, 2).join(' ')}{a.arrival_airport !== p.finalDestination && a.arrival_airport !== 'ORD' && !p.onwardLongHaul ? ` (${a.arrival_airport})` : ''} · {clock(a.depart)}
                {changed && <span className="ml-1 rounded bg-[var(--info-subtle)] px-1 text-[10px] text-[var(--info-subtle-foreground)]">changed</span>}
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">{a.priority} · {a.hotel_name ? `🛏 ${a.hotel_name}` : a.is_partner ? 'Lumen Air' : a.same_day ? 'own metal' : 'next day'}</div>
            </>
          ) : <span className="text-[var(--muted-foreground)]">—</span>}
        </div>
      </button>
      {open && (
        <div className="mt-2 grid gap-2 pl-1 text-xs md:grid-cols-2">
          <div className="space-y-1">
            <div><span className="text-[var(--muted-foreground)]">Fare:</span> {p.cabin} · {p.fareBrand} · {p.tier}</div>
            <div><span className="text-[var(--muted-foreground)]">AutoProtect:</span> {p.apLabel} → arrives {clock(p.apArrive)}</div>
            {a && <div><span className="text-[var(--muted-foreground)]">Plan:</span> {a.label} {clock(a.depart)} → {clock(a.arrive)} at {a.arrival_airport} · <b>{a.priority_reason}</b></div>}
            {a?.note && <div className="text-[var(--brand-5)]">{a.note}</div>}
            {p.pSameDay != null && <div><span className="text-[var(--muted-foreground)]">Detractor risk (ML):</span> {pct(p.pSameDay)} if today · {pct(p.pNextDay)} if tomorrow · {pct(p.pAutoprotect)} as AutoProtect left them</div>}
          </div>
          {p.message && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
              <div className="mb-1 flex flex-wrap gap-1">
                <Pill tone="info">{p.messageIntent?.replace(/_/g, ' ')}</Pill>
                {p.messageUrgency && p.messageUrgency !== 'routine' && <Pill tone="bad">{p.messageUrgency.replace(/_/g, ' ')}</Pill>}
                {p.messageSentiment && <Pill tone={p.messageSentiment === 'negative' ? 'warn' : 'neutral'}>{p.messageSentiment}</Pill>}
                <span className="text-[10px] text-[var(--muted-foreground)]">AI Functions</span>
              </div>
              <div className="italic">“{p.message}”</div>
              {p.messageEnglish && p.messageEnglish !== p.message && <div className="mt-1 text-[var(--muted-foreground)]">EN: {p.messageEnglish}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FlightWorkbench() {
  const { id = '' } = useParams();
  const [f, setF] = useState<FlightDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<'priority' | 'all' | 'escalated'>('priority');
  const [tab, setTab] = useState<'manifest' | 'inventory'>('manifest');
  const [openPax, setOpenPax] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(() => fetchFlight(id).then(setF).catch((e) => setErr((e as Error).message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => dataMutated.subscribe(() => { load(); }), [load]);

  const plan = f?.plan ?? null;
  const byPax = useMemo(() => new Map((plan?.assignments ?? []).map((a) => [a.pax_id, a])), [plan]);
  const order = useMemo(() => new Map((plan?.assignments ?? []).map((a, i) => [a.pax_id, i])), [plan]);
  const pax = useMemo(() => {
    const list = [...(f?.passengers ?? [])];
    const score = (p: Passenger) => (NEEDS.test(p.ssr) ? 0 : p.onwardLongHaul ? 1 : p.escalated ? 2 : p.tier === 'Diamond' || p.tier === 'Platinum' ? 3 : 4);
    list.sort((a, b) => plan ? (order.get(a.id) ?? 9e9) - (order.get(b.id) ?? 9e9) : score(a) - score(b) || a.pnr.localeCompare(b.pnr));
    if (filter === 'priority') return list.filter(needsProtecting);
    if (filter === 'escalated') return list.filter((p) => p.escalated);
    return list;
  }, [f, filter, plan, order]);

  async function run() {
    setRunning(true);
    setSteps([]);
    setResult(null);
    await runPlan(id, {
      step: (e) => setSteps((s) => [...s.filter((x) => x.id !== e.id), e]),
      result: () => { load(); dataMutated.emit(); },
      error: (m) => setSteps((s) => [...s, { id: 'err', label: 'Plan failed', status: 'error', detail: m }]),
    });
    setRunning(false);
  }

  async function submit() {
    setActing(true);
    try {
      const r = await submitPlan(id);
      setResult(r.status === 'committed' ? `Committed — ${plan?.assignments.length} rebookings ticketed · Delta write-back: ${r.deltaWriteBack}` : 'Sent to the IROPS Duty Manager for approval.');
      await load();
      dataMutated.emit();
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  if (err) return <div className="p-8 text-[var(--destructive)]">{err}</div>;
  if (!f) return <div className="p-8"><div className="h-40 animate-pulse rounded-2xl bg-[var(--muted)]" /></div>;
  const ap = {
    same: f.passengers.filter((p) => p.apSameDay).length, d2: f.passengers.filter((p) => p.apNights >= 2).length,
    ssr: f.passengers.filter((p) => !p.apSameDay && NEEDS.test(p.ssr)).length, umnr: f.passengers.filter((p) => !p.apSameDay && p.ssr.includes('UMNR')).length,
    mis: f.passengers.filter((p) => p.apMisconnect).length, onward: f.passengers.filter((p) => p.onwardLongHaul).length,
  };
  const bookings = new Set(f.passengers.map((p) => p.pnr)).size;
  const personal = (plan?.notifications ?? []).filter((n) => n.personalized);
  const standard = (plan?.notifications ?? []).filter((n) => !n.personalized);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/flights" className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"><ArrowLeft className="size-4" />Disrupted flights</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <XCircle className="size-3.5 text-[var(--brand-5)]" />Cancelled · {f.cancelReason}
            </div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">
              {f.flightNumber} <span className="text-[var(--muted-foreground)] font-normal">{f.origin} → {f.destination}</span> {f.destinationCity}
            </h1>
            <div className="text-sm text-[var(--muted-foreground)]">Scheduled {clock(f.schedDep)} → {clock(f.schedArr)} · {f.aircraft} · <b className="text-[var(--foreground)]">{f.passengers.length} passengers</b> on {bookings} bookings</div>
          </div>
          <div className="flex items-center gap-2">
            {f.euUk261 && <Pill tone="info">{f.euUk261} flight</Pill>}
            <FlightStatusPill status={f.status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['AutoProtect: home today', `${ap.same} / ${f.passengers.length}`, false],
            ['Pushed to Sunday', ap.d2, ap.d2 > 0],
            ['Special assistance overnight', ap.ssr, ap.ssr > 0],
            ['UMNR overnight', ap.umnr, ap.umnr > 0],
            ['Missed long-haul connections', `${ap.mis} / ${ap.onward}`, ap.mis > 0],
          ].map(([l, v, bad]) => (
            <div key={String(l)} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{l}</div>
              <div className={cn('text-xl font-semibold tabular-nums', bad && 'text-[var(--brand-5)]')}>{v}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <div className="self-start rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex gap-1 rounded-lg bg-[var(--muted)] p-0.5 text-sm">
                {(['manifest', 'inventory'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1', tab === t && 'bg-[var(--card)] shadow-sm font-medium')}>
                    {t === 'manifest' ? <><Users className="mr-1 inline size-3.5" />Manifest{plan ? ' · plan order' : ''}</> : <><PlaneTakeoff className="mr-1 inline size-3.5" />Seats &amp; hotels</>}
                  </button>
                ))}
              </div>
              {tab === 'manifest' && (
                <div className="flex gap-1 text-xs">
                  {([['priority', `Needs protecting (${f.passengers.filter(needsProtecting).length})`], ['escalated', `Escalated messages (${f.passengers.filter((p) => p.escalated).length})`], ['all', `All ${f.passengers.length}`]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setFilter(k)} className={cn('rounded-full border px-2.5 py-1', filter === k ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)]')}>{l}</button>
                  ))}
                </div>
              )}
            </div>
            {tab === 'manifest' ? (
              <>
                <div className="grid grid-cols-[1.35fr_1fr_1fr] gap-3 bg-[var(--muted)] px-4 py-1.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <span>Passenger</span><span>AutoProtect hold</span><span>Copilot plan</span>
                </div>
                <div className="max-h-[640px] overflow-y-auto">
                  {pax.map((p) => <PaxRow key={p.id} p={p} a={byPax.get(p.id)} open={openPax === p.id} onToggle={() => setOpenPax(openPax === p.id ? null : p.id)} />)}
                </div>
              </>
            ) : (
              <div className="space-y-4 px-4 pb-4">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="py-1 text-left">Option</th><th className="text-left">Departs</th><th className="text-left">Arrives</th><th className="text-right">Seats left</th><th className="text-right">Cost / seat</th></tr></thead>
                  <tbody>
                    {f.options.map((o) => (
                      <tr key={o.id} className="border-t border-[var(--border)]">
                        <td className="py-1.5"><div className="font-medium">{o.label}</div><div className="text-[11px] text-[var(--muted-foreground)]">{o.optionType.replace(/_/g, ' ').toLowerCase()}{o.isPartner ? ' · Lumen Air' : ''}{o.nearbyAirport ? ` · lands ${o.arrivalAirport}` : ''}{!o.acceptsUmnr ? ' · no UMNR' : ''}</div></td>
                        <td className="tabular-nums">{clock(o.depart)}</td><td className="tabular-nums">{clock(o.arrive)}</td>
                        <td className="text-right tabular-nums">{o.seatsProtected >= 999 ? 'open' : `${o.seatsRemaining} / ${o.seatsProtected}`}</td>
                        <td className="text-right tabular-nums">{o.isPartner ? money(o.costPerSeat) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Hotel className="size-4" />Distressed-passenger hotel blocks at {f.origin}</div>
                  {f.hotels.map((h) => (
                    <div key={h.id} className="flex items-center justify-between border-t border-[var(--border)] py-1.5 text-sm">
                      <span>{h.name} <span className="text-xs text-[var(--muted-foreground)]">· {h.accessibleRooms} accessible · {h.shuttleMinutes} min shuttle</span></span>
                      <span className="tabular-nums">{h.roomsRemaining} / {h.roomsTotal} rooms · {money(h.rate)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />Re-accommodation plan</div>
                {plan && f.status !== 'committed' && !running && (
                  <button onClick={run} className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline"><RefreshCw className="size-3" />Re-run</button>
                )}
              </div>
              {!plan && !running && (
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Re-plans every booking on this flight in the Aeralis priority order — special assistance, onward connections, urgent
                    messages, tier — keeping parties together, using own-metal and Lumen Air seats within the cost guardrails, and
                    checking the policy documents with the Genie agent. Nothing is ticketed until it is committed.
                  </p>
                  <button onClick={run} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]">
                    <Plane className="size-4" />Re-accommodate {f.flightNumber}
                  </button>
                </div>
              )}
              {(running || (steps.length > 0 && !plan)) && <div className="mt-3"><Steps steps={steps} /></div>}
              {plan && !running && (
                <div className="mt-3 space-y-4">
                  <div className="rounded-xl bg-[var(--card)] border border-[var(--primary)] px-4 py-3 text-[var(--foreground)]">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">Copilot plan · {new Date(plan.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-2xl font-semibold"><span className="tabular-nums">{plan.metrics.same_day}</span> of {plan.metrics.pax} home today <span className="text-base font-normal text-[var(--muted-foreground)]">(AutoProtect: {plan.autoprotect.same_day})</span></div>
                    <div className="text-sm text-[var(--muted-foreground)]">{plan.metrics.priority_same_day}/{plan.metrics.priority_pax} priority passengers today · {plan.metrics.misconnects} misconnects (was {plan.autoprotect.misconnects}) · {money(plan.metrics.cost_per_pax)} vs {money(plan.autoprotect.cost_per_pax)} per passenger</div>
                  </div>
                  <Compare plan={plan} />
                  {plan.summary && <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-sm leading-relaxed"><div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">For the Duty Manager</div>{plan.summary}</div>}
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="size-4 text-[var(--primary-light)]" />Guardrails</div>
                    <ul className="space-y-1">
                      {plan.guardrails.map((g) => (
                        <li key={g.rule_id} className="flex items-start gap-2 text-sm">
                          <Pill tone={G_TONE[g.status]}>{g.rule_id}</Pill>
                          <span><b>{g.name}</b> — <span className="text-[var(--muted-foreground)]">{g.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {plan?.policy_guidance && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-[var(--primary-light)]" />Policy &amp; passenger rights <span className="text-xs font-normal text-[var(--muted-foreground)]">· Genie agent (documents)</span></div>
                <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">{plan.policy_guidance.question}</div>
                <div className="prose prose-sm prose-invert mt-2 max-w-none text-sm leading-relaxed"><ReactMarkdown>{plan.policy_guidance.answer}</ReactMarkdown></div>
                {plan.policy_guidance.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{plan.policy_guidance.sources.map((s) => <Pill key={s} tone="neutral">{s}</Pill>)}</div>}
              </div>
            )}

            {plan && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex items-center gap-2 font-semibold"><Send className="size-4 text-[var(--primary-light)]" />Passenger notifications <span className="text-xs font-normal text-[var(--muted-foreground)]">· {personal.length} personalised, {standard.length} standard · sent on commit</span></div>
                <div className="mt-2 max-h-[360px] space-y-2 overflow-y-auto">
                  {[...personal, ...standard.slice(0, 3)].map((n) => (
                    <div key={n.pnr} className="rounded-lg border border-[var(--border)] p-2 text-sm">
                      <button onClick={() => setOpenNote(openNote === n.pnr ? null : n.pnr)} className="flex w-full items-center justify-between gap-2 text-left">
                        <span className="truncate"><b>{n.names}</b> <span className="text-xs text-[var(--muted-foreground)]">· {n.pnr} · {n.channel}</span></span>
                        <span className="flex shrink-0 items-center gap-1">{n.language !== 'English' && <Pill tone="info">{n.language}</Pill>}{n.personalized ? <Pill tone="brand">AI</Pill> : <Pill>template</Pill>}<ChevronDown className="size-3.5" /></span>
                      </button>
                      {(openNote === n.pnr || (openNote === null && n === personal[0])) && <div className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-[var(--muted-foreground)]">{n.text}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {plan && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-3">
                {f.status === 'committed' ? (
                  <div className="flex items-start gap-2 text-sm text-[var(--success)]">
                    <Check className="mt-0.5 size-4" />
                    <div><b>Committed</b> by {f.approvedBy} at {f.committedAt ? new Date(f.committedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''} — {plan.assignments.length} rebookings ticketed, {plan.metrics.hotel_rooms} hotel rooms booked, notifications queued. Written to Lakebase and back to Delta (rebooking_decisions).</div>
                  </div>
                ) : f.status === 'awaiting_approval' ? (
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 text-[var(--severity-warning)]" />
                    <div><b>Awaiting the IROPS Duty Manager.</b> {plan.approval_reasons.join(' ')} <Link to="/approvals" className="text-[var(--primary-light)] underline">Open approvals</Link></div>
                  </div>
                ) : (
                  <>
                    {plan.requires_approval ? (
                      <div className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 text-[var(--severity-warning)]" /><div><b>Needs Duty Manager approval:</b> {plan.approval_reasons.join(' ')}</div></div>
                    ) : (
                      <div className="flex items-start gap-2 text-sm"><BedDouble className="mt-0.5 size-4 text-[var(--success)]" /><div>Within every guardrail — the desk can commit it directly.</div></div>
                    )}
                    <button disabled={acting} onClick={submit} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
                      {acting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{plan.requires_approval ? 'Submit to Duty Manager' : 'Commit plan'}
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
