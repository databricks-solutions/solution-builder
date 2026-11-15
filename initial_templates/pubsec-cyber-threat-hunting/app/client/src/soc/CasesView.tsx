/** Incident cases opened from the workbench (the write-back, in Lakebase). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchCases, type IncidentCase } from './api';
import { Pill } from './ui';

export function CasesView() {
  const [rows, setRows] = useState<IncidentCase[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchCases().then(setRows).catch(() => setRows([])); }, [tick]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Written back to Lakebase</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Incident cases</h1>
        </div>
        {rows === null && <div className="h-24 rounded-2xl bg-[var(--muted)] animate-pulse" />}
        {rows?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center text-sm text-[var(--muted-foreground)]">
            No incident cases yet. Open a lead, run the investigation and click <b>Open incident case</b>.
          </div>
        )}
        {rows?.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldAlert className="size-5 text-[var(--brand-5)]" />
              <span className="font-mono text-sm font-semibold">{c.id}</span>
              <Pill tone={c.severity === 'SEV-1' ? 'bad' : 'warn'}>{c.severity}</Pill>
              <Pill tone="info">{c.status.replace(/_/g, ' ')}</Pill>
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">opened {new Date(c.openedAt).toLocaleString()} by {c.analyst} · from <Link className="underline" to={`/leads/${c.leadId}`}>{c.leadId}</Link></span>
            </div>
            <div className="mt-2 font-semibold">{c.title}</div>
            {c.summary && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{c.summary}</p>}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Containment requested</div>
                <ul className="mt-1 space-y-1 text-sm">{c.containment.map((a) => <li key={a.code + a.target}><span className="font-mono text-xs">{a.code}</span> {a.action} — <b>{a.target}</b></li>)}</ul>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">ATT&amp;CK techniques</div>
                <div className="mt-1 flex flex-wrap gap-1">{c.techniques.map((t) => <Pill key={t.id} tone="neutral">{t.id} {t.name}</Pill>)}</div>
                {c.recordsAtRisk != null && <div className="mt-2 text-sm">Records at risk: <b>{c.recordsAtRisk.toLocaleString()}</b></div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
