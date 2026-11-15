/**
 * Exposure workbench — the planner's main screen for one supply exposure.
 *   left : 13-week projected inventory (baseline vs your plan), inbound POs with their delays,
 *          customer orders that fall in the stock-out weeks, the supply signals ai_extract read
 *   right: mitigation plan builder — priced levers from the deterministic engine, live re-projection,
 *          "Ask the copilot" (agent evaluates + stages a plan), "Book plan" (Lakebase + Delta write-back)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Boxes, CheckCircle2, ClipboardCheck, Database, Factory, Mail, Plane, ShieldPlus, Sparkles, Truck } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { bookPlan, fetchExposure, money, num, shortDate, simulatePlan, type ActionInput, type ExposureDetail, type MitigationOption, type SimResult } from './api';
import { ProjectionChart, ChartLegend } from './ProjectionChart';
import { Kpi, Pill, cn } from './ui';

const TYPE_ICON = { transfer: Truck, alternate: Factory, expedite: Plane, safety_stock: ShieldPlus } as const;
const TYPE_LABEL = { transfer: 'Re-allocate', alternate: 'Alternate supplier', expedite: 'Premium freight', safety_stock: 'Policy' } as const;

export function ExposureWorkbench() {
  const { id = '' } = useParams();
  const [d, setD] = useState<ExposureDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState<string | null>(null);
  const appliedProposal = useRef<string | null>(null);
  const userTouched = useRef(false);

  const load = useCallback(() => {
    fetchExposure(id).then((x) => { setD(x); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(() => { appliedProposal.current = null; userTouched.current = false; setSel({}); setSim(null); load(); }, [load]);
  useEffect(() => dataMutated.subscribe(load), [load]);

  // A booked plan wins; otherwise a (new) copilot proposal pre-selects its actions.
  useEffect(() => {
    if (!d) return;
    const p = d.plans.booked ?? d.plans.proposed;
    if (p && appliedProposal.current !== p.id && (!userTouched.current || d.plans.booked || p.proposedBy.startsWith('copilot'))) {
      appliedProposal.current = p.id;
      setSel(Object.fromEntries(p.actions.map((a) => [a.optionId, a.qty])));
    }
  }, [d]);

  const actions: ActionInput[] = useMemo(() => Object.entries(sel).map(([option_id, qty]) => ({ option_id, qty })), [sel]);
  useEffect(() => {
    if (!d) return;
    if (!actions.length) { setSim(null); return; }
    const t = setTimeout(() => {
      simulatePlan(d.exposure.exposure_id, actions).then((r) => { setSim(r); setSimErr(null); }).catch((e) => setSimErr((e as Error).message));
    }, 150);
    return () => clearTimeout(t);
  }, [actions, d]);

  if (err) return <div className="p-8 text-sm text-[var(--destructive)]">{err}</div>;
  if (!d) return <div className="p-8"><div className="h-8 w-80 rounded bg-[var(--muted)] animate-pulse" /><div className="mt-4 h-72 rounded-2xl bg-[var(--muted)] animate-pulse" /></div>;

  const e = d.exposure;
  const booked = d.plans.booked;
  const proposed = d.plans.proposed;
  const toggle = (o: MitigationOption) => {
    if (booked) return;
    userTouched.current = true;
    setSel((s) => { const n = { ...s }; if (o.option_id in n) delete n[o.option_id]; else n[o.option_id] = o.default_qty; return n; });
  };
  const setQty = (o: MitigationOption, q: number) => { userTouched.current = true; setSel((s) => ({ ...s, [o.option_id]: q })); };
  const result = sim ?? null;
  const book = async () => {
    setBooking(true); setBookMsg(null);
    try {
      const r = await bookPlan(e.exposure_id, actions, proposed?.rationale ?? null);
      setBookMsg(r.deltaError ? `Booked in Lakebase — Delta write-back failed: ${r.deltaError}` : null);
      dataMutated.emit();
      load();
    } catch (x) { setBookMsg((x as Error).message); }
    setBooking(false);
  };
  const askCopilot = () => dockController.newAndSend(
    `Propose the cheapest mitigation plan for exposure ${e.exposure_id} (${e.component_id} at ${e.plant_name}) that leaves no units short and keeps us above safety stock, and stage it for me.`,
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to="/" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline"><ArrowLeft className="size-3" />Supply exposures</Link>
            <h1 className="mt-1 font-display text-3xl font-semibold text-[var(--primary)]">{e.component_name} <span className="text-[var(--muted-foreground)] font-normal">· {e.plant_name}</span></h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <Pill tone={e.exposure_type === 'STOCKOUT' ? 'bad' : 'warn'}>{e.exposure_type === 'STOCKOUT' ? `Stock-out in ${e.days_to_stockout} days` : 'Below safety stock'}</Pill>
              <Pill tone="info">{e.root_cause}</Pill>
              <span className="text-[var(--muted-foreground)]">{e.exposure_id} · primary supplier {e.primary_supplier} · used by {e.affected_skus.join(', ')} · plan as of {shortDate(d.as_of)}</span>
            </div>
          </div>
          {booked ? <Pill tone="good" className="text-xs px-3 py-1"><CheckCircle2 className="size-3.5" />Plan booked · {booked.id}</Pill>
            : proposed ? <Pill tone="info" className="text-xs px-3 py-1"><Sparkles className="size-3.5" />Plan proposed by {proposed.proposedBy.startsWith('copilot') ? 'the copilot' : proposed.proposedBy}</Pill>
            : <Pill tone="warn" className="text-xs px-3 py-1">No plan yet</Pill>}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="First stock-out week" value={shortDate(e.first_stockout_week)} tone={e.first_stockout_week ? 'bad' : undefined} sub={e.first_stockout_week ? `${e.weeks_short} weeks short` : `${e.weeks_below_ss} weeks below safety stock`} />
          <Kpi label="Peak units short" value={num(e.peak_units_short)} tone={e.peak_units_short ? 'bad' : undefined} sub={`${num(e.peak_units_short_if_on_time)} if POs were on time`} />
          <Kpi label="Revenue at risk" value={money(e.revenue_at_risk, true)} tone={e.revenue_at_risk ? 'bad' : undefined} sub={`${money(e.revenue_per_unit)} of servo revenue per unit`} />
          <Kpi label="Days of supply today" value={e.days_of_supply_now ?? '—'} sub={`${num(e.on_hand_units)} on hand · SS ${num(e.safety_stock_units)}`} />
          <Kpi label="Delayed inbound POs" value={e.delayed_po_count} tone={e.delayed_po_count ? 'warn' : undefined} sub={e.max_delay_days ? `up to +${e.max_delay_days} days` : 'none'} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <div className="space-y-4 min-w-0">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold">13-week projected inventory — {e.component_id} at {e.plant_name}</div>
                {result && <div className="text-xs"><b className={result.units_short ? 'text-[var(--brand-5)]' : 'text-[var(--success)]'}>{result.units_short ? `${num(result.units_short)} units still short` : 'No stock-out with this plan'}</b><span className="text-[var(--muted-foreground)]"> · {result.weeks_below_safety_stock} weeks below safety stock</span></div>}
              </div>
              <ProjectionChart rows={d.projection} plan={result?.weeks ?? null} />
              <ChartLegend withPlan={!!result} />
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="px-5 py-3 font-semibold flex items-center gap-2"><Boxes className="size-4 text-[var(--primary-light)]" />Inbound purchase orders</div>
              <table className="w-full text-sm">
                <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>{['PO', 'Qty', 'Status', 'Promised', 'Revised ETA', 'Delay', 'Reason / vessel'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {d.inbound_pos.map((p) => (
                    <tr key={p.po_number} className={cn('border-t border-[var(--border)]', p.is_delayed && 'bg-[#FFF4EF]')}>
                      <td className="px-4 py-2 font-mono text-xs">{p.po_number}<div className="font-sans text-[11px] text-[var(--muted-foreground)]">{p.supplier_name}</div></td>
                      <td className="px-4 py-2 tabular-nums">{num(p.quantity)}</td>
                      <td className="px-4 py-2"><Pill tone={p.status === 'IN_TRANSIT' ? 'info' : 'neutral'}>{p.status === 'IN_TRANSIT' ? 'In transit' : 'Open'}</Pill></td>
                      <td className="px-4 py-2 tabular-nums">{shortDate(p.promised_date)}</td>
                      <td className={cn('px-4 py-2 tabular-nums', p.is_delayed && 'font-semibold text-[var(--brand-5)]')}>{shortDate(p.revised_eta)}</td>
                      <td className="px-4 py-2 tabular-nums">{p.delay_days > 0 ? <span className="font-semibold text-[var(--brand-5)]">+{p.delay_days} d</span> : 'on time'}</td>
                      <td className="px-4 py-2 text-xs text-[var(--muted-foreground)] max-w-[280px]">{p.delay_reason ?? p.lane}{p.vessel ? ` · ${p.vessel}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex items-center gap-2 font-semibold"><Mail className="size-4 text-[var(--primary-light)]" />What the AI read <span className="text-xs font-normal text-[var(--muted-foreground)]">· ai_extract over supplier &amp; forwarder emails</span></div>
                <ul className="mt-3 space-y-3">
                  {d.signals.length === 0 && <li className="text-sm text-[var(--muted-foreground)]">No supplier messages about {e.component_id}.</li>}
                  {d.signals.map((s) => (
                    <li key={s.message_id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={s.event_type === 'shipment_delay' || s.event_type === 'supplier_allocation' ? 'bad' : s.event_type.includes('offer') ? 'good' : 'neutral'}>{s.event_type.replace('_', ' ')}</Pill>
                        <span className="text-xs text-[var(--muted-foreground)]">{s.sender_org} · {shortDate(s.received_ts)}</span>
                      </div>
                      <div className="mt-1 leading-snug">{s.summary}</div>
                      {s.po_numbers && s.po_numbers !== '[]' && s.po_numbers !== 'null' && <div className="mt-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">{(JSON.parse(s.po_numbers) as string[]).join(' · ')}{s.added_delay_days ? ` · +${s.added_delay_days} days` : ''}</div>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex items-center justify-between font-semibold"><span className="flex items-center gap-2"><AlertTriangle className="size-4 text-[var(--brand-5)]" />Customer orders in the stock-out weeks</span><span className="text-xs font-normal text-[var(--muted-foreground)]">{d.orders_at_risk.length} orders · {money(d.orders_at_risk_value, true)}</span></div>
                {d.orders_at_risk.length === 0 && <div className="mt-2 text-sm text-[var(--muted-foreground)]">No firm orders fall in a stock-out week.</div>}
                <ul className="mt-2 divide-y divide-[var(--border)] max-h-[260px] overflow-y-auto">
                  {d.orders_at_risk.map((o) => (
                    <li key={o.order_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate"><Pill tone={o.customer_tier === 'A' ? 'brand' : 'neutral'} className="mr-1.5">Tier {o.customer_tier}</Pill>{o.customer_name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{o.quantity}× {o.sku} · {shortDate(o.requested_ship_date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border-2 border-[var(--primary)]/15 bg-[var(--card)] p-5">
              <div className="flex items-center justify-between">
                <div className="font-semibold flex items-center gap-2"><ClipboardCheck className="size-4 text-[var(--primary)]" />Mitigation plan</div>
                <span className="text-[11px] text-[var(--muted-foreground)]">policy order CSP-03 §3.1</span>
              </div>
              {!booked && (
                <button onClick={askCopilot} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95">
                  <Sparkles className="size-4" />Ask the copilot to build the plan
                </button>
              )}
              {proposed && !booked && proposed.rationale && (
                <div className="mt-3 rounded-lg bg-[var(--info-subtle)] px-3 py-2 text-xs leading-relaxed text-[var(--info-subtle-foreground)]"><b>Copilot rationale:</b> {proposed.rationale}</div>
              )}
              <div className="mt-3 space-y-2">
                {d.options.map((o) => {
                  const on = o.option_id in sel;
                  const Icon = TYPE_ICON[o.type];
                  return (
                    <div key={o.option_id} className={cn('rounded-xl border p-3 transition-colors', on ? 'border-[var(--primary)] bg-[var(--info-subtle)]/40' : 'border-[var(--border)]', booked && 'opacity-90')}>
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input type="checkbox" checked={on} disabled={!!booked} onChange={() => toggle(o)} className="mt-1 size-4 accent-[var(--primary)]" aria-label={o.title} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><Icon className="size-3.5" />{o.policy_rank}. {TYPE_LABEL[o.type]}</div>
                          <div className="text-sm font-semibold leading-snug">{o.title}</div>
                          <div className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">{o.detail}</div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                            {o.arrival_date && <Pill tone={o.alone.units_short === 0 ? 'good' : 'warn'}>arrives {shortDate(o.arrival_date)}</Pill>}
                            <Pill tone="neutral">alone: {o.type === 'safety_stock' ? `${money(o.alone.annual_carrying_cost)}/yr` : money(o.alone.plan_cost)}</Pill>
                            {o.type !== 'safety_stock' && <Pill tone={o.alone.units_short === 0 ? 'good' : 'bad'}>{o.alone.units_short === 0 ? 'closes the gap' : `${num(o.alone.units_short)} still short`}</Pill>}
                            {o.eo_note && <Pill tone="info">releases E&amp;O</Pill>}
                          </div>
                        </div>
                      </label>
                      {on && o.type !== 'safety_stock' && (
                        <div className="mt-2 flex items-center gap-2 pl-6 text-xs">
                          <span className="text-[var(--muted-foreground)]">Quantity</span>
                          <input type="number" min={o.min_qty} max={o.max_qty} step={o.type === 'transfer' ? 100 : 50} value={sel[o.option_id]} disabled={!!booked}
                            onChange={(ev) => setQty(o, Number(ev.target.value))} className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 tabular-nums" />
                          <span className="text-[var(--muted-foreground)]">max {num(o.max_qty)} · {o.cost_formula}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl bg-[var(--muted)] p-4">
                {!result && <div className="text-sm text-[var(--muted-foreground)]">Select one or more levers — the projection re-runs instantly. Without a plan: <b className="text-[var(--brand-5)]">{num(d.baseline.units_short)} units short, {money(d.baseline.revenue_at_risk, true)} at risk</b>.</div>}
                {simErr && <div className="text-sm text-[var(--destructive)]">{simErr}</div>}
                {result && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Plan cost</div><div className="text-xl font-semibold tabular-nums">{money(result.plan_cost)}</div>{result.annual_carrying_cost > 0 && <div className="text-[11px] text-[var(--muted-foreground)]">+ {money(result.annual_carrying_cost)}/yr carrying</div>}</div>
                    <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Revenue protected</div><div className="text-xl font-semibold tabular-nums text-[var(--success)]">{money(result.revenue_protected, true)}</div><div className="text-[11px] text-[var(--muted-foreground)]">of {money(d.baseline.revenue_at_risk, true)} at risk</div></div>
                    <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Units short after</div><div className={cn('text-xl font-semibold tabular-nums', result.units_short ? 'text-[var(--brand-5)]' : 'text-[var(--success)]')}>{num(result.units_short)}</div><div className="text-[11px] text-[var(--muted-foreground)]">{result.weeks_below_safety_stock} wk below safety stock</div></div>
                    <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Approver (CSP-01 §1.4)</div><div className="text-sm font-semibold">{result.approver}</div>{result.eo_released > 0 && <div className="text-[11px] text-[var(--success)]">{money(result.eo_released, true)} of E&amp;O put back to work</div>}</div>
                  </div>
                )}
              </div>

              {booked ? (
                <div className="mt-4 rounded-xl border border-[var(--success)]/40 bg-[var(--success-subtle)] p-4 text-sm text-[var(--success-subtle-foreground)]">
                  <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" />Plan {booked.id} booked by {booked.bookedBy}</div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {booked.actions.map((a) => <li key={a.optionId}><span className="font-mono">{a.documentNumber}</span> · {a.title} · {num(a.qty)} {a.type === 'safety_stock' ? 'week' : 'units'} · {money(a.cost)}{a.arrivalDate ? ` · arrives ${shortDate(a.arrivalDate)}` : ''}</li>)}
                  </ul>
                  <div className="mt-2 flex items-center gap-1.5 text-xs"><Database className="size-3.5" />{booked.deltaWritten ? 'Saved in Lakebase and written back to Delta (sop_plan_decisions) — the dashboard and Genie see it.' : 'Saved in Lakebase (Delta write-back pending).'}</div>
                </div>
              ) : (
                <button onClick={book} disabled={!actions.length || booking}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-5)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                  <ClipboardCheck className="size-4" />{booking ? 'Booking…' : 'Book plan'}
                </button>
              )}
              {bookMsg && <div className="mt-2 text-xs text-[var(--destructive)]">{bookMsg}</div>}
            </div>

            {d.other_plants.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="font-semibold">{e.component_id} at the other plants</div>
                <ul className="mt-2 space-y-2 text-sm">
                  {d.other_plants.map((h) => (
                    <li key={h.plant_id} className="flex items-center justify-between gap-2">
                      <span>{h.plant_name} <span className="text-xs text-[var(--muted-foreground)]">· {num(h.on_hand_units)} on hand · {h.avg_weekly_requirement ? `${num(h.avg_weekly_requirement)}/wk needed` : 'no forward demand'}</span></span>
                      <Pill tone={h.eo_category === 'Obsolete' ? 'bad' : h.eo_category === 'Excess' ? 'warn' : 'good'}>{h.eo_category}{h.eo_value ? ` · ${money(h.eo_value, true)}` : ''}</Pill>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="font-semibold">Audit trail</div>
              {d.plans.events.length === 0 && <div className="mt-1 text-sm text-[var(--muted-foreground)]">Nothing recorded yet.</div>}
              <ul className="mt-2 space-y-2 text-xs">
                {d.plans.events.map((ev, i) => (
                  <li key={i}><Pill tone={ev.kind === 'booked' ? 'good' : 'info'} className="mr-1">{ev.kind}</Pill><span className="text-[var(--muted-foreground)]">{new Date(ev.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {ev.actor}</span><div className="mt-0.5">{ev.detail}</div></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
