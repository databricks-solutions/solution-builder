/**
 * Home — the IROPS operations centre at Chicago O'Hare. Winter Storm Harlan has shut the field; the
 * departures board is the hero (every cancelled flight, split-flap, amber on black), the route map shows
 * where those passengers were bound, and the priority lanes show who AutoProtect left overnight. The
 * rebooking progress strip and the copilot sit underneath. Numbers come from the same endpoints as before.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchActivity, fetchFlights, fetchSummary, type ActivityRow, type EventSummary, type FlightRow } from '@/irops/api';
import { DepartureBoard } from '@/irops/DepartureBoard';
import { FlapText } from '@/irops/FlapText';
import { RouteMap } from '@/irops/RouteMap';
import { cn } from '@/irops/ui';

const ACTION: Record<string, string> = { plan_drafted: 'Plan drafted', submitted: 'Sent for approval', approved: 'Approved', sent_back: 'Sent back', committed: 'Committed' };

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [s, setS] = useState<EventSummary | null>(null);
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSummary().then(setS).catch(() => {});
    fetchFlights().then(setFlights).catch(() => {});
    fetchActivity(8).then(setActivity).catch(() => {});
  }, [tick]);
  const script = config?.assistantScript ?? [];
  const pctToday = s ? Math.round((100 * s.ap_same_day) / Math.max(1, s.pax)) : null;

  // Rebooking progress, by flight status (the board's own status column).
  const count = (st: FlightRow['status']) => flights.filter((f) => f.status === st).length;
  const progress = [
    { label: 'Rebooked', n: count('committed'), cls: 'bg-[var(--brand-2)]' },
    { label: 'Awaiting DM', n: count('awaiting_approval'), cls: 'bg-[var(--brand-4)]' },
    { label: 'Plan ready', n: count('plan_drafted'), cls: 'bg-[var(--brand-1)]' },
    { label: 'Cancelled', n: count('unplanned'), cls: 'bg-[var(--brand-5)]' },
  ];
  const total = Math.max(1, flights.length);

  // Passenger priority lanes — who AutoProtect left overnight, from the same summary.
  const lanes = s ? [
    { label: 'Special assistance (SSR)', total: s.special_assistance, left: s.ap_ssr_overnight, leftLabel: 'overnight, AutoProtect' },
    { label: 'Unaccompanied minors', total: s.umnr, left: s.ap_umnr_overnight, leftLabel: 'overnight, AutoProtect' },
    { label: 'Onward long-haul connectors', total: s.onward, left: s.ap_misconnects, leftLabel: 'missed the connection' },
    { label: 'Escalated to the desk', total: s.escalated, left: null, leftLabel: '' },
  ] : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            <span className="rounded bg-[var(--brand-5)] px-1.5 py-0.5 font-bold text-[#14100A]">Ground stop</span>
            Aeralis Airways · Operations Control · Chicago O&apos;Hare · Fri 13 Feb 2026 · 10:45 CT
          </div>
          <h1 className="max-w-6xl font-display text-[3rem] font-extrabold uppercase leading-[0.95] tracking-tight">
            Harlan cancelled {s?.flights_cancelled ?? 36} flights. AutoProtect got {pctToday ?? '…'}% home today — and left the ones who most needed help overnight.
          </h1>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_560px] xl:items-start">
            <div className="min-w-0">
              <p className="max-w-3xl leading-relaxed text-[var(--muted-foreground)]">
                The legacy auto-rebooker held seats first-booked, first-served, on Aeralis metal only, blind to unaccompanied minors,
                wheelchairs, onward long-haul connections and families. Marisol Vega’s desk re-plans it flight by flight with the IROPS Copilot.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#2A2E36] bg-[#2A2E36] md:grid-cols-4">
              {s ? (
                <>
                  <div className="bg-[var(--card)] px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Passengers disrupted</div>
                    <FlapText text={s.pax.toLocaleString('en-US')} className="mt-1.5 text-[20px]" />
                  </div>
                  <div className="bg-[var(--card)] px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Pushed to Sunday</div>
                    <FlapText text={s.ap_day_plus_2.toLocaleString('en-US')} tone="red" className="mt-1.5 text-[20px]" />
                  </div>
                  <div className="bg-[var(--card)] px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">SSR overnight</div>
                    <FlapText text={`${s.ap_ssr_overnight}/${s.special_assistance}`} tone="red" className="mt-1.5 text-[20px]" />
                  </div>
                  <div className="bg-[var(--card)] px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Minors overnight</div>
                    <FlapText text={`${s.ap_umnr_overnight}/${s.umnr}`} tone="red" className="mt-1.5 text-[20px]" />
                  </div>
                </>
              ) : [0, 1, 2, 3].map((i) => <div key={i} className="h-[76px] animate-pulse bg-[var(--card)]" />)}
            </div>
          </div>
        <div className="mt-1 flex flex-wrap gap-2">
              <button onClick={() => void nav('/flights/AE1418-0213')}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-[var(--primary)] px-3.5 py-2 text-sm font-bold text-[var(--primary-foreground)] hover:brightness-110">
                Open AE 1418 <ArrowRight className="size-4" />
              </button>
              <button onClick={() => void nav('/flights')} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[#2A2E36] px-3.5 py-2 text-sm font-medium hover:bg-[var(--muted)]">Disrupted flights</button>
              <button onClick={() => void nav('/dashboard')} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[#2A2E36] px-3.5 py-2 text-sm font-medium hover:bg-[var(--muted)]">Ops dashboard</button>
            </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
          <DepartureBoard rows={flights} onOpen={(id) => void nav(`/flights/${id}`)} />
          <div className="min-h-[460px]">
            <RouteMap rows={flights} onOpen={(id) => void nav(`/flights/${id}`)} />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-[#2A2E36] bg-[var(--card)] p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-display text-xl font-bold uppercase tracking-wide">Passenger priority lanes</div>
              <div className="font-mono text-[11px] text-[var(--muted-foreground)]">red = left overnight by AutoProtect</div>
            </div>
            <div className="mt-4 space-y-4">
              {lanes.map((l) => (
                <div key={l.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{l.label}</span>
                    <span className="font-mono text-xs tabular-nums text-[var(--muted-foreground)]">
                      {l.left != null ? <><b className="text-[var(--brand-5)]">{l.left}</b> {l.leftLabel} · </> : null}{l.total} total
                    </span>
                  </div>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-sm bg-[#1A1D23]">
                    {l.left != null && l.total > 0 && (
                      <div className="h-3 bg-[var(--brand-5)]" style={{ width: `${Math.min(100, (100 * l.left) / l.total)}%` }} />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              DESK ORDER · P1 special assistance → P2 onward long-haul → P3 urgent life event → P4 top tier → P5 away from home → P6 local
            </p>
            <div className="mt-5 font-display text-base font-bold uppercase tracking-wide">Recent desk activity</div>
            {activity.length > 0 && (
              <ul className="mt-5 space-y-1.5 border-t border-[#2A2E36] pt-3 font-mono text-[11px]">
                {activity.slice(0, 4).map((a) => (
                  <li key={`${a.flight_id}-${a.at}`} className="flex items-center justify-between gap-2">
                    <button onClick={() => void nav(`/flights/${a.flight_id}`)} className="truncate text-left hover:underline">
                      <b>{(ACTION[a.action] ?? a.action).toUpperCase()}</b> · {a.flight_number} → {a.destination}
                    </button>
                    <span className="shrink-0 text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-xl border border-[#2A2E36] bg-[var(--card)] p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-display text-xl font-bold uppercase tracking-wide">Rebooking progress</div>
                <div className="font-mono text-[11px] text-[var(--muted-foreground)]">{flights.length} flights</div>
              </div>
              <div className="mt-3 flex h-3 overflow-hidden rounded-sm bg-[#1A1D23]">
                {progress.map((p) => <div key={p.label} className={cn('h-3', p.cls)} style={{ width: `${(100 * p.n) / total}%` }} title={`${p.label}: ${p.n}`} />)}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--muted-foreground)]">
                {progress.map((p) => (
                  <span key={p.label} className="flex items-center gap-1.5"><i className={cn('inline-block size-2 rounded-sm', p.cls)} />{p.label} <b className="text-[var(--foreground)]">{p.n}</b></span>
                ))}
              </div>
              {s && (
                <div className="mt-3 font-mono text-xs text-[var(--muted-foreground)]">
                  Home today <b className="text-[var(--foreground)]">{s.current_same_day.toLocaleString('en-US')}</b> of {s.pax.toLocaleString('en-US')} · ORD hotel rooms <b className="text-[var(--brand-4)]">{s.rooms_remaining}/{s.rooms_total}</b> left
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#2A2E36] bg-[var(--card)] p-5">
              <div className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><MessagesSquare className="size-4 text-[var(--brand-1)]" />Ask the Copilot</div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Ops and policy questions go to the Genie agent (governed tables + policy documents); flights to the live desk.</p>
              <div className="mt-3 flex flex-col gap-2">
                {script.map((c) => (
                  <button key={c.prompt} onClick={() => void dockController.openAndSend(c.prompt)}
                    className="flex items-center gap-2 rounded-md border border-[#2A2E36] px-3 py-2 text-left text-sm hover:border-[var(--brand-1)]">
                    <Sparkles className="size-3.5 shrink-0 text-[var(--brand-1)]" />{c.prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
