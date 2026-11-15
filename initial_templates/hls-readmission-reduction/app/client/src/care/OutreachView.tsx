/**
 * Outreach queue — the tasks the care team works, written to Lakebase when a coordinator approves a
 * transition plan (workbench) or when the copilot creates one (chat write-back).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { completeTasks, dayLabel, fetchTasks, type TaskRow } from './api';
import { Pill, cn } from './ui';

const TYPE_LABEL: Record<string, string> = {
  book_followup: 'Book follow-up', call_48h: '48-h call', med_rec_call: 'Med rec', lab_order: 'Lab', home_health: 'Home health',
  ride_assist: 'Ride Assist', financial_counseling: 'Financial', interpreter_teach_back: 'Interpreter', other: 'Other',
};

export function OutreachView() {
  const nav = useNavigate();
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchTasks(status).then(setRows).catch(() => setRows([])); }, [status, tick]);
  const done = async (id: string) => {
    setBusy(id);
    await completeTasks([id]).catch(() => {});
    setBusy(null);
    dataMutated.emit();
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Navigators · pharmacists · coordinators</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Outreach queue</h1>
            <div className="text-sm text-[var(--muted-foreground)]">Written to Lakebase from approved transition plans and from the copilot.</div>
          </div>
          <div className="flex gap-1.5">
            {(['open', 'done'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={cn('rounded-full border px-3 py-1 text-xs capitalize', status === s ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)]')}>{s}</button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          {!rows && <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-[var(--muted)]" />)}</div>}
          {rows && rows.length === 0 && (
            <div className="p-6 text-sm text-[var(--muted-foreground)]">{status === 'open' ? 'No open outreach tasks. Approve a transition plan on the worklist, or ask the copilot to create one.' : 'Nothing completed yet.'}</div>
          )}
          {rows && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>{['Due', 'Patient', 'Task', 'Owner', 'Source', ''].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--border)] align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{dayLabel(t.dueDate)}</td>
                    <td className="px-4 py-2.5"><button onClick={() => nav(`/worklist/${t.encounterId}`)} className="font-medium hover:underline">{t.patientName}</button><div className="text-xs text-[var(--muted-foreground)]">{t.unitId}</div></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Pill tone="info">{TYPE_LABEL[t.taskType] ?? t.taskType}</Pill><span className="font-medium">{t.title}</span></div>{t.detail && <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{t.detail}</div>}</td>
                    <td className="px-4 py-2.5 text-xs">{t.owner}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">{t.createdVia === 'copilot' ? 'Copilot' : 'Approved plan'}<div>{t.createdBy}</div></td>
                    <td className="px-4 py-2.5 text-right">
                      {t.status === 'open' ? (
                        <button onClick={() => done(t.id)} disabled={busy === t.id} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--success)]">
                          {busy === t.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}Done
                        </button>
                      ) : <span className="text-xs text-[var(--success)]">done {t.completedAt ? new Date(t.completedAt).toLocaleDateString() : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
