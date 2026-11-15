/**
 * Home — the S&OP planning grid for Corvane Motion Systems.
 * Spreadsheet-dense 13-week projected-inventory grid (every exposure × week; stock-out cells in red),
 * a supply/demand waterfall and supplier-lane timeline for the top exposure, then the copilot entry,
 * supply signals (ai_extract) and plans booked in this app (Lakebase). All numbers come from the same
 * planning endpoints as before.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Mail, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  fetchExposure,
  fetchInventory,
  fetchOverview,
  fetchPlanEvents,
  money,
  num,
  pct,
  shortDate,
  type DemandRow,
  type Exposure,
  type ExposureDetail,
  type Overview,
  type PlanEvent,
  type ProjRow,
} from '@/planning/api';
import { Pill, cn } from '@/planning/ui';

type Grid = Record<string, ExposureDetail | null>;

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demand, setDemand] = useState<DemandRow[]>([]);
  const [events, setEvents] = useState<PlanEvent[]>([]);
  const [grid, setGrid] = useState<Grid>({});
  const [tick, setTick] = useState(0);

  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchOverview().then((x) => { setO(x); setErr(null); }).catch((e) => setErr((e as Error).message));
    fetchPlanEvents(8).then(setEvents).catch(() => {});
  }, [tick]);
  useEffect(() => {
    fetchInventory().then((inv) => setDemand(inv.demand.filter((r) => r.sku === 'SG-400' && r.plant_id === 'DAY'))).catch(() => {});
  }, []);
  // One projection per exposure feeds the grid (the detail endpoint already computes it).
  useEffect(() => {
    if (!o) return;
    void Promise.all(o.exposures.map((e) => fetchExposure(e.exposure_id).then((d) => [e.exposure_id, d] as const).catch(() => [e.exposure_id, null] as const)))
      .then((pairs) => setGrid(Object.fromEntries(pairs)));
  }, [o, tick]);

  const script = config?.assistantScript ?? [];
  const top: Exposure | undefined = o?.exposures.find((e) => e.exposure_type === 'STOCKOUT') ?? o?.exposures[0];
  const topDetail = top ? grid[top.exposure_id] : undefined;
  const weeks = useMemo(() => {
    const first = Object.values(grid).find((d) => d && d.projection.length)?.projection ?? [];
    return first.map((r) => r.week_start);
  }, [grid]);
  const act = demand.filter((r) => r.series === 'Actual');
  const early = act.slice(0, 6), late = act.slice(-6);
  const avg = (a: DemandRow[]) => (a.length ? a.reduce((s, r) => s + r.units, 0) / a.length : 0);
  const growth = avg(early) ? avg(late) / avg(early) - 1 : 0;
  const dayFill = o?.fill_rate_by_plant.find((p) => p.plant === 'Dayton');

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-[1500px] px-5 py-4 space-y-4">
        {/* ── ribbon: the planning-session header ───────────────────── */}
        <section className="rounded-md border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">S&amp;OP supply review · Corvane Motion Systems</div>
              <div className="text-sm font-semibold">Week of {shortDate(o?.as_of)} · base plan · 13-week horizon</div>
            </div>
            <div className="flex items-center gap-2">
              {top && (
                <button onClick={() => void nav(`/exposures/${top.exposure_id}`)} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)]">
                  Open {top.component_id} <ArrowRight className="size-3.5" />
                </button>
              )}
              <button onClick={() => void nav('/inventory')} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">Inventory</button>
              <button onClick={() => void nav('/dashboard')} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">Dashboard</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--border)]">
            <Ribbon label="Revenue at risk" value={o ? money(o.revenue_at_risk, true) : '…'} tone="bad" />
            <Ribbon label="Stock-out exposures" value={o ? `${o.stockouts}` : '…'} sub={o ? `of ${o.exposures.length} exposures` : undefined} tone="bad" />
            <Ribbon label="Fill rate · 4 wk" value={o ? pct(o.fill_rate_4w) : '…'} sub={`Dayton ${pct(dayFill?.last_4w)} · target 97%`} tone={o && o.fill_rate_4w < 0.97 ? 'warn' : 'good'} />
            <Ribbon label="Excess &amp; obsolete" value={o ? money(o.eo_value, true) : '…'} sub={o ? `${o.delayed_pos} inbound POs delayed` : undefined} />
          </div>
        </section>
        {err && <div className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-4 py-3 text-sm text-[var(--destructive)]">{err}</div>}

        {/* ── the grid: projected inventory, every exposure × week ──── */}
        <section className="rounded-md border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
            <div>
              <span className="font-semibold">Projected inventory · units on hand at week end</span>
              <span className="ml-2 text-xs text-[var(--muted-foreground)]">AI_FORECAST demand × BOM vs on-hand + open POs at revised ETA</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
              <Legend swatch="bg-[#F9D5D9]" label="stock-out (balance < 0)" />
              <Legend swatch="bg-[#FDF0D5]" label="below safety stock" />
              <Legend swatch="bg-white border border-[var(--border)]" label="covered" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse font-mono text-[12px] tabular-nums">
              <thead>
                <tr className="bg-[var(--muted)] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="sticky left-0 z-10 bg-[var(--muted)] px-3 py-2 text-left font-medium border-r border-[var(--border)] min-w-[230px]">Component · plant</th>
                  <th className="px-2 py-2 text-right font-medium">Safety</th>
                  {weeks.map((w) => <th key={w} className="px-2 py-2 text-right font-medium whitespace-nowrap">{shortDate(w)}</th>)}
                  <th className="px-3 py-2 text-right font-medium">Rev. at risk</th>
                </tr>
              </thead>
              <tbody>
                {!o && <tr><td colSpan={16} className="px-4 py-6"><div className="h-6 rounded bg-[var(--muted)] animate-pulse" /></td></tr>}
                {o?.exposures.map((e) => {
                  const d = grid[e.exposure_id];
                  const rows: ProjRow[] = d?.projection ?? [];
                  return (
                    <tr key={e.exposure_id} onClick={() => void nav(`/exposures/${e.exposure_id}`)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/50">
                      <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2 font-sans border-r border-[var(--border)]">
                        <div className="font-semibold leading-tight">{e.component_id} <span className="font-normal text-[var(--muted-foreground)]">{e.component_name.startsWith(e.component_id) ? e.component_name.slice(e.component_id.length).trim() : e.component_name}</span></div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">{e.plant_name} · {e.primary_supplier}{e.max_delay_days ? ` · +${e.max_delay_days} d` : ''}</div>
                      </td>
                      <td className="px-2 py-2 text-right text-[var(--muted-foreground)]">{num(e.safety_stock_units)}</td>
                      {rows.length === 0 && weeks.map((w) => <td key={w} className="px-2 py-2 text-right text-[var(--muted-foreground)]">…</td>)}
                      {rows.map((r) => {
                        const short = r.projected_balance < 0;
                        const below = !short && r.projected_balance < r.safety_stock_units;
                        return (
                          <td key={r.week_start} className={cn('px-2 py-2 text-right', short && 'bg-[#F9D5D9] font-bold text-[#9B1C2E]', below && 'bg-[#FDF0D5] text-[#7A4B00]')}>
                            {num(r.projected_balance)}
                          </td>
                        );
                      })}
                      <td className={cn('px-3 py-2 text-right font-sans font-semibold', e.revenue_at_risk > 0 ? 'text-[var(--brand-5)]' : 'text-[var(--muted-foreground)]')}>
                        {e.revenue_at_risk ? money(e.revenue_at_risk, true) : '—'}
                        <div className="font-normal text-[11px]">
                          {e.plan ? <Pill tone={e.plan.status === 'booked' ? 'good' : 'info'}>{e.plan.status === 'booked' ? 'booked' : 'proposed'}</Pill> : <span>no plan</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── the top exposure: waterfall + supplier lanes ─────────── */}
        <section className="grid items-start gap-4 lg:grid-cols-[1fr_1.35fr]">
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold">Supply / demand bridge · {top?.component_id ?? '…'} at {top?.plant_name ?? '…'}</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">13 weeks, units</div>
            </div>
            {topDetail ? <Waterfall rows={topDetail.projection} /> : <div className="mt-3 h-44 rounded bg-[var(--muted)] animate-pulse" />}
            {top && (
              <div className="mt-3 grid grid-cols-3 divide-x divide-[var(--border)] border-t border-[var(--border)] pt-3 text-center">
                <div><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">First stock-out</div><div className="font-mono text-sm font-semibold">{top.first_stockout_week ? shortDate(top.first_stockout_week) : '—'}</div></div>
                <div><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Peak units short</div><div className="font-mono text-sm font-semibold">{num(top.peak_units_short)}</div></div>
                <div><div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Revenue at risk</div><div className="font-mono text-sm font-semibold text-[var(--brand-5)]">{money(top.revenue_at_risk, true)}</div></div>
              </div>
            )}
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold">Supplier lanes · inbound POs for {top?.component_id ?? '…'}</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                <span className="text-[var(--success)]">● on time</span> · <span className="text-[var(--destructive)]">◆ revised ETA</span>
              </div>
            </div>
            {topDetail ? <Lanes pos={topDetail.inbound_pos} /> : <div className="mt-3 h-44 rounded bg-[var(--muted)] animate-pulse" />}
          </div>
        </section>

        {/* ── copilot, signals, plans ─────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2 font-semibold"><Mail className="size-4 text-[var(--primary-light)]" />Supply signals <span className="text-xs font-normal text-[var(--muted-foreground)]">· supplier &amp; forwarder emails read by ai_extract</span></div>
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {(o?.signals ?? []).map((s) => (
                <li key={s.message_id} className="flex gap-3 py-2 text-sm">
                  <Pill tone={s.event_type === 'shipment_delay' || s.event_type === 'supplier_allocation' ? 'bad' : s.event_type.includes('offer') ? 'good' : 'neutral'} className="mt-0.5 shrink-0">{s.event_type.replace('_', ' ')}</Pill>
                  <div><div className="leading-snug">{s.summary}</div><div className="text-[11px] text-[var(--muted-foreground)]">{s.sender_org} · {shortDate(s.received_ts)}</div></div>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center gap-2 font-semibold"><MessagesSquare className="size-4 text-[var(--primary-light)]" />Ask the Copilot</div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">History, KPIs and the supply-policy rules go to the Genie agent; the forward view to the planning engine.</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {script.map((s) => (
                  <button key={s.prompt} onClick={() => void dockController.openAndSend(s.prompt)}
                    className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:border-[var(--primary-light)]">
                    <Sparkles className="size-3.5 shrink-0 text-[var(--brand-5)]" />{s.prompt}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="font-semibold">Plans booked this week</div>
              {events.length === 0 && <div className="mt-2 text-sm text-[var(--muted-foreground)]">No plans yet — open an exposure and ask the copilot to build one.</div>}
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {events.map((a) => (
                  <li key={`-`} className="py-2 text-sm">
                    <button onClick={() => void nav(`/exposures/${a.exposure_id ?? a.exposureId}`)} className="text-left hover:underline"><Pill tone={a.kind === 'booked' ? 'good' : 'info'} className="mr-1.5">{a.kind}</Pill>{a.detail}</button>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{a.actor} · {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* demand context kept from the earlier home: SG-400 growth at Dayton */}
        {demand.length > 0 && (
          <div className="text-xs text-[var(--muted-foreground)]">
            SG-400 demand at Dayton, last 6 weeks vs 26 weeks ago: <b className="text-[var(--brand-5)]">{growth >= 0 ? '+' : ''}{Math.round(growth * 100)}%</b> — warehouse-automation wins (Atlas Warehouse Robotics, Northgate Packaging).
          </div>
        )}
      </div>
    </div>
  );
}

function Ribbon({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' | 'good' }) {
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-foreground)] whitespace-nowrap" dangerouslySetInnerHTML={{ __html: label }} />
      <div className={cn('font-mono text-xl font-semibold tabular-nums leading-tight', tone === 'bad' && 'text-[#B42330]', tone === 'warn' && 'text-[#9A6400]', tone === 'good' && 'text-[#1E7A3C]')}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn('size-3 rounded-sm', swatch)} />{label}</span>;
}

/** Opening stock → + receipts → − demand → closing stock, over the 13-week horizon. */
function Waterfall({ rows }: { rows: ProjRow[] }) {
  if (!rows.length) return <div className="mt-3 text-sm text-[var(--muted-foreground)]">No projection rows.</div>;
  const receipts = rows.reduce((s, r) => s + r.receipts, 0);
  const demand = rows.reduce((s, r) => s + r.required_units, 0);
  const closing = rows[rows.length - 1].projected_balance;
  const opening = closing - receipts + demand; // residual: closes the bridge exactly
  const steps: Array<{ label: string; from: number; to: number; tone: 'total' | 'up' | 'down' }> = [
    { label: 'Opening', from: 0, to: opening, tone: 'total' },
    { label: 'Receipts', from: opening, to: opening + receipts, tone: 'up' },
    { label: 'Demand', from: opening + receipts, to: opening + receipts - demand, tone: 'down' },
    { label: 'Closing', from: 0, to: closing, tone: 'total' },
  ];
  const lo = Math.min(0, closing, opening + receipts - demand);
  const hi = Math.max(opening, opening + receipts, closing, 1);
  const W = 460, H = 200, L = 46, T = 14, B = 26;
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const bw = (W - L) / steps.length - 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border)" />
      {[0, 0.5, 1].map((f) => {
        const v = lo + (hi - lo) * f;
        return <text key={f} x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">{Math.round(v)}</text>;
      })}
      {steps.map((s, i) => {
        const x = L + i * ((W - L) / steps.length) + 10;
        const top = y(Math.max(s.from, s.to));
        const h = Math.max(2, Math.abs(y(s.from) - y(s.to)));
        const fill = s.tone === 'total' ? 'var(--primary)' : s.tone === 'up' ? '#1E7A3C' : '#B42330';
        const val = s.tone === 'down' ? -(s.from - s.to) : s.to - s.from;
        return (
          <g key={s.label}>
            <rect x={x} y={top} width={bw} height={h} fill={fill} rx="1" />
            <text x={x + bw / 2} y={top - 4} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--foreground)">
              {s.tone === 'total' ? num(s.to) : `${val >= 0 ? '+' : ''}${num(val)}`}
            </text>
            <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Supplier lanes: each PO is a row; grey bar = order → promised; tick = promised; marker = revised ETA. */
function Lanes({ pos }: { pos: ExposureDetail['inbound_pos'] }) {
  if (!pos.length) return <div className="mt-3 text-sm text-[var(--muted-foreground)]">No open inbound POs.</div>;
  const starts = pos.map((p) => Date.parse(p.order_date.slice(0, 10)));
  const ends = pos.map((p) => Date.parse((p.revised_eta || p.promised_date).slice(0, 10)));
  const t0 = Math.min(...starts), t1 = Math.max(...ends, ...pos.map((p) => Date.parse(p.promised_date.slice(0, 10))));
  const pctOf = (iso: string) => ((Date.parse(iso.slice(0, 10)) - t0) / Math.max(1, t1 - t0)) * 100;
  return (
    <div className="mt-3 font-mono text-[11px]">
      {pos.slice(0, 8).map((p) => {
        const onTime = !p.is_delayed;
        return (
          <div key={p.po_number} className="grid grid-cols-[200px_1fr] items-center gap-2 border-t border-[var(--border)] py-1.5">
            <div className="truncate font-sans text-[12px]">
              <span className="font-semibold">{p.supplier_name}</span>
              <span className="ml-1 text-[var(--muted-foreground)]">{p.lane}</span>
            </div>
            <div className="relative h-5">
              <div className="absolute top-1/2 h-px w-full bg-[var(--border)]" />
              <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-[var(--muted)]"
                style={{ left: `${pctOf(p.order_date)}%`, width: `${Math.max(1, pctOf(p.promised_date) - pctOf(p.order_date))}%` }} />
              <div className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-[var(--foreground)]" style={{ left: `${pctOf(p.promised_date)}%` }} title={`promised ${p.promised_date.slice(0, 10)}`} />
              <div
                className={cn('absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full', onTime ? 'bg-[#1E7A3C]' : 'rotate-45 rounded-[2px] bg-[#B42330]')}
                style={{ left: `${pctOf(p.revised_eta || p.promised_date)}%` }}
                title={`revised ETA ${(p.revised_eta || p.promised_date).slice(0, 10)}`}
              />
            </div>
            <div className="col-start-2 -mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]">
              <span>{p.po_number} · {num(p.quantity)} u</span>
              <span className={cn(p.is_delayed && 'text-[#B42330]')}>{p.is_delayed ? `+${p.delay_days} d · ${p.delay_reason ?? 'delayed'}` : 'on time'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
