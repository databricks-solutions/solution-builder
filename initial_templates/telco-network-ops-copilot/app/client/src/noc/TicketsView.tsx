/** Trouble tickets opened from the workbench (the write-back, in Lakebase) with their field dispatches. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Truck, Wrench } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchTickets, fmtN, type TroubleTicket } from './api';
import { Pill, PriorityPill } from './ui';

export function TicketsView() {
  const [rows, setRows] = useState<TroubleTicket[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchTickets().then(setRows).catch(() => setRows([])); }, [tick]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Written back to Lakebase</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Trouble tickets &amp; dispatch</h1>
        </div>
        {rows === null && <div className="h-24 rounded-2xl bg-[var(--muted)] animate-pulse" />}
        {rows?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center text-sm text-[var(--muted-foreground)]">
            No trouble tickets yet. Open an incident, run the triage and click <b>Open trouble ticket &amp; dispatch</b>.
          </div>
        )}
        {rows?.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className="size-5 text-[var(--brand-5)]" />
              <span className="font-mono text-sm font-semibold">{c.id}</span>
              <PriorityPill p={c.priority} />
              <Pill tone="info">{c.status.replace(/_/g, ' ')}</Pill>
              {c.childAlarmsSuppressed > 0 && <Pill tone="neutral">{fmtN(c.childAlarmsSuppressed)} child alarms suppressed</Pill>}
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">opened {new Date(c.openedAt).toLocaleString()} by {c.engineer} · from <Link className="underline" to={`/incidents/${c.incidentId}`}>{c.incidentId}</Link></span>
            </div>
            <div className="mt-2 font-semibold">{c.title}</div>
            {c.rootCause && <div className="mt-1 text-sm"><span className="text-[var(--muted-foreground)]">Root cause:</span> <span className="font-mono">{c.rootNode}</span> — {c.rootCause}</div>}
            <div className="mt-1 text-xs text-[var(--muted-foreground)]">{c.sitesAffected} site(s) · {fmtN(c.subscribersImpacted)} subscribers</div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Actions requested</div>
                <ul className="mt-1 space-y-1 text-sm">{c.actions.map((a) => <li key={a.code + a.target}><span className="font-mono text-xs">{a.code}</span> {a.action} — <b>{a.target}</b></li>)}</ul>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Field dispatch</div>
                {c.dispatches.length === 0 && <div className="mt-1 text-sm text-[var(--muted-foreground)]">none</div>}
                <ul className="mt-1 space-y-1 text-sm">{c.dispatches.map((d) => <li key={d.tech_id} className="flex gap-2"><Truck className="mt-0.5 size-4 shrink-0 text-[var(--primary-light)]" /><span><b>{d.name}</b> ({d.tech_id}, {d.skill}) → {d.destination}{d.eta_min != null ? ` · ETA ${d.eta_min} min` : ''} <Pill tone="warn">{d.status ?? 'dispatched'}</Pill></span></li>)}</ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
