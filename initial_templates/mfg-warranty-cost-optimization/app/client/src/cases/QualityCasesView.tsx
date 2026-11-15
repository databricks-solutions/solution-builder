/**
 * Quality cases — what the engineer (or the copilot, on request) opened from a signal:
 * root cause, lots, containment actions, projected exposure, campaign cost, supplier
 * chargeback. The app's write-back table (Lakebase app.quality_cases).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FolderCheck } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchQualityCases, money, moneyK, type QualityCase } from '@/warranty/api';
import { Pill } from '@/warranty/ui';

export function QualityCasesView() {
  const [cases, setCases] = useState<QualityCase[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchQualityCases().then(setCases).catch(() => setCases([])); }, [tick]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Written back to Lakebase</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Quality cases</h1>
        </div>
        {!cases && <div className="h-24 rounded-xl bg-[var(--muted)] animate-pulse" />}
        {cases?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
            No quality cases yet. Open a signal on the <Link to="/signals" className="underline">early-warning board</Link>, assemble the root-cause case, then open the quality case.
          </div>
        )}
        {cases?.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><FolderCheck className="size-4 text-[var(--success)]" />{c.id} · opened {new Date(c.createdAt).toLocaleString()} by {c.owner} · via {c.openedVia}</div>
                <div className="mt-1 text-lg font-semibold">{c.title}</div>
                <div className="text-sm text-[var(--muted-foreground)]">{c.supplierName} · lots {c.affectedLots.join(', ')}</div>
              </div>
              <div className="flex gap-2"><Pill tone={c.severity === 'high' ? 'bad' : 'warn'}>{c.severity}</Pill><Pill tone="info">{c.status}</Pill></div>
            </div>
            <p className="mt-2 text-sm leading-relaxed"><b>Root cause:</b> {c.rootCause}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
              <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Bikes in scope</div><div className="font-semibold tabular-nums">{c.affectedUnits?.toLocaleString() ?? '—'}</div></div>
              <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Projected exposure</div><div className="font-semibold tabular-nums">{moneyK(c.projectedExposure)}</div></div>
              <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Campaign cost</div><div className="font-semibold tabular-nums">{moneyK(c.campaignCost)}</div></div>
              <div><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Chargeback</div><div className="font-semibold tabular-nums text-[var(--success)]">{money(c.chargebackAmount)}</div></div>
            </div>
            <ul className="mt-3 space-y-1 text-xs">
              {c.containmentActions.map((o) => <li key={o.key}><b>{o.label}</b> — {o.detail}</li>)}
            </ul>
            {c.notes && <div className="mt-2 text-xs text-[var(--muted-foreground)]">Note: {c.notes}</div>}
            <div className="mt-3 flex gap-3 text-xs">
              <Link to={`/signals/${c.signalId}`} className="text-[var(--primary-light)] hover:underline">Open the signal →</Link>
              {c.supplierNotice && <button onClick={() => setOpen(open === c.id ? null : c.id)} className="text-[var(--primary-light)] hover:underline">{open === c.id ? 'Hide' : 'Show'} supplier notice</button>}
            </div>
            {open === c.id && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--muted)] p-3 text-xs leading-relaxed">{c.supplierNotice}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
