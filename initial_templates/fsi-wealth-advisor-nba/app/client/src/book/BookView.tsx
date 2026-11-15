/** My book — every household with an active signal, ranked, with quick filters. */
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { BookTable } from '@/home/HomeView';
import { fetchBook, fetchSummary, short, type BookRow, type Summary } from './api';
import { Kpi, cn } from './ui';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'this_week', label: 'Act within 14 days' },
  { key: 'at_risk', label: 'AUM at risk' },
  { key: 'lending', label: 'Lending' },
  { key: 'blocked', label: 'Model pick blocked' },
  { key: 'decided', label: 'Decided' },
];

export function BookView() {
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<BookRow[] | null>(null);
  const [s, setS] = useState<Summary | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchSummary().then(setS).catch(() => {}); }, [tick]);
  useEffect(() => {
    const t = setTimeout(() => fetchBook({ filter, q }).then(setRows).catch(() => setRows([])), 150);
    return () => clearTimeout(t);
  }, [filter, q, tick]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">{s?.advisor_name ?? 'Elena Marsh'} · Senior Wealth Advisor, Denver</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">My book</h1>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Households with a signal" value={s?.households ?? '…'} sub={s ? `${short(s.book_aum)} AUM` : undefined} />
          <Kpi label="Money in motion" value={s ? short(s.money_in_motion) : '…'} sub="next 60 days + recent events" />
          <Kpi label="AUM at risk" value={s ? short(s.aum_at_risk) : '…'} tone="bad" sub={s ? `${s.at_risk_households} households` : undefined} />
          <Kpi label="Lending opportunity" value={s ? short(s.lending_opportunity) : '…'} sub="mortgages in the refi window" />
          <Kpi label="Logged today" value={s ? `${s.decided}` : '…'} sub={s ? `${s.meetings_booked} meetings booked · ${s.prepped} prepped` : undefined} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === f.key ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary-light)]')}>
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="size-3.5 text-[var(--muted-foreground)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or HH-…" className="w-48 bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          {rows === null && <div className="p-5"><div className="h-64 rounded-xl bg-[var(--muted)] animate-pulse" /></div>}
          {rows && rows.length === 0 && <div className="p-6 text-sm text-[var(--muted-foreground)]">No households match this filter.</div>}
          {rows && rows.length > 0 && <BookTable rows={rows} />}
        </div>
      </div>
    </div>
  );
}
