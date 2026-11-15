/** Work orders + MRO parts + planned windows — the write-back surface (Lakebase, live). */
import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Package, PlayCircle, Truck, Wrench, XCircle } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  fetchParts,
  fetchWindows,
  fetchWorkOrders,
  fmtDate,
  setWorkOrderStatus,
  usd,
  type MaintWindow,
  type Part,
  type WorkOrder,
} from '@/lib/pdm';

const STATUS_STYLE: Record<WorkOrder['status'], string> = {
  scheduled: 'bg-[var(--risk-watch-bg)] text-[var(--risk-watch)]',
  in_progress: 'bg-[var(--risk-high-bg)] text-[var(--risk-high)]',
  completed: 'bg-[var(--risk-ok-bg)] text-[var(--risk-ok)]',
  cancelled: 'bg-muted text-muted-foreground',
};

export function WorkOrdersView() {
  const [wos, setWos] = useState<WorkOrder[] | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [windows, setWindows] = useState<MaintWindow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([fetchWorkOrders(), fetchParts(), fetchWindows()])
      .then(([w, p, win]) => {
        setWos(w);
        setParts(p);
        setWindows(win);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    return dataMutated.subscribe(() => void load());
  }, []);

  const act = async (id: string, s: WorkOrder['status']) => {
    try {
      await setWorkOrderStatus(id, s);
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const live = (wos ?? []).filter((w) => w.status !== 'cancelled');
  const avoided = live.reduce((s, w) => s + Number(w.unplanned_cost_avoided_usd), 0);
  const net = live.reduce((s, w) => s + Number(w.net_savings_usd), 0);
  const reserved = parts.filter((p) => p.reserved_qty > 0 || /Vigo RE0|reducer/i.test(p.description));

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Work orders</h1>
          <div className="text-sm text-muted-foreground">Planned interventions booked from the control room — parts reserved, windows held, cost avoided tracked.</div>
        </div>
        <div className="flex gap-3">
          <Pill label="Open work orders" value={String(live.length)} />
          <Pill label="Unplanned cost avoided" value={usd(avoided)} tone="ok" />
          <Pill label="Net savings" value={usd(net)} tone="ok" />
        </div>
      </div>
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      {!wos && <div className="h-40 rounded-xl bg-muted animate-pulse" />}
      {wos && wos.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No work orders yet. Ask PdM Copilot to <b>plan the fix</b> — it drafts the plan, you approve, it books.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(wos ?? []).map((w) => (
          <article key={w.id} data-wo={w.id} className="rounded-2xl border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-muted-foreground">{w.id} · {w.priority} · {w.source === 'agent' ? 'booked by PdM Copilot' : 'manual'} for {w.created_by}</div>
                <div className="font-display text-xl">{w.asset_id} — {w.title}</div>
                <div className="text-xs text-muted-foreground">{w.asset_name} · {w.line}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[w.status]}`}>{w.status.replace('_', ' ')}</span>
            </div>
            {w.root_cause && <div className="text-sm"><span className="font-medium">Root cause: </span>{w.root_cause}</div>}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Mini icon={CalendarClock} label="Window" value={`${fmtDate(w.scheduled_start, true)}`} sub={`${w.duration_hours} crew-h · ${w.window_id}`} />
              <Mini icon={Wrench} label="Crew" value={w.technicians ?? '—'} />
              <Mini icon={CheckCircle2} label="Cost avoided" value={usd(w.unplanned_cost_avoided_usd)} sub={`net ${usd(w.net_savings_usd)} · risk ${w.risk_score_at_booking ?? '—'} at booking`} />
            </div>
            {w.tasks.length > 0 && (
              <ol className="text-sm list-decimal ml-5 space-y-0.5 text-foreground/85">{w.tasks.map((t) => <li key={t}>{t}</li>)}</ol>
            )}
            <div className="rounded-lg bg-muted/60 p-3">
              <div className="text-xs font-medium mb-1 flex items-center gap-1.5"><Package className="size-3.5" />Parts reserved · {usd(w.parts_cost_usd, false)}</div>
              <ul className="text-xs space-y-0.5">
                {w.parts.map((p) => (
                  <li key={p.part_number} className="flex justify-between gap-2">
                    <span>{p.qty} × <span className="font-mono">{p.part_number}</span> {p.description}</span>
                    <span className="shrink-0 inline-flex items-center gap-1">{p.source === 'regional_dc_transfer' ? <><Truck className="size-3" />Charlotte DC</> : 'Plant crib'}</span>
                  </li>
                ))}
              </ul>
            </div>
            {w.status !== 'cancelled' && w.status !== 'completed' && (
              <div className="flex gap-2">
                {w.status === 'scheduled' && <Btn onClick={() => void act(w.id, 'in_progress')} icon={PlayCircle} label="Start" />}
                <Btn onClick={() => void act(w.id, 'completed')} icon={CheckCircle2} label="Complete" />
                <Btn onClick={() => void act(w.id, 'cancelled')} icon={XCircle} label="Cancel (release parts)" />
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="rounded-2xl border bg-card p-5">
          <div className="font-display text-xl">Planned maintenance windows</div>
          <div className="text-xs text-muted-foreground mb-3">Line scheduled down — zero production impact (MPS-004). Capacity in crew-hours.</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground text-left"><tr><th className="py-1">Window</th><th>Line</th><th>Start</th><th className="text-right">Booked / capacity</th></tr></thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.id} className="border-t">
                  <td className="py-1.5 font-mono text-xs">{w.id}</td>
                  <td>{w.line.split(' — ')[0]}</td>
                  <td>{fmtDate(w.start_at, true)}</td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-24 h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (w.booked_hours / w.capacity_hours) * 100)}%` }} /></div>
                      {w.booked_hours}/{w.capacity_hours} h
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rounded-2xl border bg-card p-5">
          <div className="font-display text-xl">MRO parts — reducer & lubrication</div>
          <div className="text-xs text-muted-foreground mb-3">Live inventory; reservations from booked work orders reduce what's available.</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground text-left"><tr><th className="py-1">Part</th><th>Description</th><th className="text-right">Crib avail.</th><th className="text-right">Reserved</th><th className="text-right">Charlotte DC</th></tr></thead>
            <tbody>
              {reserved.map((p) => (
                <tr key={p.part_number} className="border-t">
                  <td className="py-1.5 font-mono text-xs">{p.part_number}</td>
                  <td className="text-xs">{p.description}</td>
                  <td className={`text-right ${p.available_at_plant <= 0 ? 'text-[var(--risk-critical)] font-semibold' : ''}`}>{p.available_at_plant}</td>
                  <td className="text-right">{p.reserved_qty}</td>
                  <td className="text-right">{p.regional_dc_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-display text-2xl ${tone === 'ok' ? 'text-[var(--risk-ok)]' : ''}`}>{value}</div>
    </div>
  );
}
function Mini({ icon: Icon, label, value, sub }: { icon: typeof Wrench; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Icon className="size-3" />{label}</div>
      <div className="text-sm font-medium leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
function Btn({ onClick, icon: Icon, label }: { onClick: () => void; icon: typeof Wrench; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-muted">
      <Icon className="size-3.5" />{label}
    </button>
  );
}
