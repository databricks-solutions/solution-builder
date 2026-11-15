/**
 * Morning Book — the advisor's landing page, laid out like a private bank's daily call sheet: a serif greeting,
 * a money-in-motion ribbon by signal, the day's call list as numbered client cards with suitability guardrail
 * chips, and the desk's activity. Numbers come from the same endpoints the Book page uses.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ArrowRight, BookOpen, Brain, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { ACTION_SHORT, fetchActivity, fetchBook, fetchSummary, short, type ActivityRow, type BookRow, type Summary } from '@/book/api';
import { Pill, StatusPill, SuitPill, cn } from '@/book/ui';

const ACTION: Record<string, string> = { ai_prep: 'Meeting prepped', proposed: 'Proposal sent', meeting_booked: 'Meeting booked', not_now: 'Not now' };
const SEG_COLORS = ['#1F4D3A', '#B08A3E', '#8DB8A4', '#2F5E8C', '#9E3B30', '#D2BC8F', '#6F8F3A', '#7A4E8C', '#C47A3A', '#2A8C8C', '#5C5A9E'];

export function BookTable({ rows, compact }: { rows: BookRow[]; compact?: boolean }) {
  const nav = useNavigate();
  return (
    <table className="w-full text-sm">
      <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
        <tr>
          <th className="px-3 py-2 text-left w-10">#</th>
          <th className="px-3 py-2 text-left">Client</th>
          <th className="px-3 py-2 text-left">Why now</th>
          <th className="px-3 py-2 text-right">In motion</th>
          <th className="px-3 py-2 text-right">At risk</th>
          <th className="px-3 py-2 text-left">Model’s top pick</th>
          <th className="px-3 py-2 text-left">Best suitable action</th>
          {!compact && <th className="px-3 py-2 text-left">Status</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} onClick={() => nav(`/clients/${r.id}`)} className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/60', r.decision && 'opacity-60')}>
            <td className="px-3 py-2.5 tabular-nums text-[var(--muted-foreground)]">{r.book_rank}</td>
            <td className="px-3 py-2.5">
              <div className="font-medium">{r.primary_name}{r.primary_age ? <span className="text-[var(--muted-foreground)] font-normal">, {r.primary_age}</span> : null}</div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                {short(r.aum)} AUM · {r.risk_profile}
                {r.vulnerable && <Pill tone="warn">Vulnerable</Pill>}
              </div>
            </td>
            <td className="px-3 py-2.5 max-w-[320px]">
              <div className="truncate text-xs">{r.headline_signal}</div>
              <div className="truncate text-[11px] text-[var(--muted-foreground)]">{r.signals_label}{r.days_since_contact != null && r.days_since_contact > 60 ? ` · last contact ${r.days_since_contact}d ago` : ''}</div>
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums font-medium">{short(r.money_in_motion)}</td>
            <td className={cn('px-3 py-2.5 text-right tabular-nums', (r.aum_at_risk ?? 0) > 0 ? 'font-semibold text-[var(--brand-5)]' : 'text-[var(--muted-foreground)]')}>{(r.aum_at_risk ?? 0) > 0 ? short(r.aum_at_risk) : '—'}</td>
            <td className="px-3 py-2.5">
              <div className={cn('text-xs', r.model_top_blocked && 'line-through decoration-[var(--brand-5)]')}>{ACTION_SHORT[r.top_model_action ?? ''] ?? r.top_model_action}</div>
              {r.top_model_status && <SuitPill status={r.top_model_status} />}
            </td>
            <td className="px-3 py-2.5 text-xs font-medium text-[var(--primary)]">{ACTION_SHORT[r.best_suitable_action ?? ''] ?? r.best_suitable_action ?? '—'}</td>
            {!compact && <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [s, setS] = useState<Summary | null>(null);
  const [top, setTop] = useState<BookRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSummary().then(setS).catch(() => {});
    fetchBook({}).then((r) => setTop(r.slice(0, 6))).catch(() => {});
    fetchActivity(6).then(setActivity).catch(() => {});
  }, [tick]);
  const script = config?.assistantScript ?? [];
  const hero = top[0];
  const segs = (s?.by_signal ?? []).filter((b) => (b.amount ?? 0) > 0);
  const segTotal = segs.reduce((a, b) => a + (b.amount ?? 0), 0) || 1;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1320px] space-y-6 px-8 py-7">
        <header className="grid gap-6 border-b border-[var(--border)] pb-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">Calder Pine Private Wealth · Morning book · Monday 28 September 2026</div>
            <h1 className="mt-2 font-display text-[48px] font-semibold leading-[1] text-[var(--primary)]">Good morning, Elena.</h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--brand-ink)]/85">
              {s ? <>{short(s.money_in_motion)} of your clients’ money is in motion, and {short(s.aum_at_risk)} could walk. </> : null}
              Three rate cuts since June: CDs bought at 5% renew at 3.55%, sweep cash earns 0.25%, and 2023 mortgages sit a point above today’s rate.
              The model ranks who to call; the suitability engine decides what you may offer.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {hero && (
              <button onClick={() => nav(`/clients/${hero.id}`)} className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Start with #1: {hero.primary_name} <ArrowRight className="size-4" />
              </button>
            )}
            <button onClick={() => nav('/book')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium hover:border-[var(--brand-2)]">Open my book</button>
            <button onClick={() => nav('/dashboard')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium hover:border-[var(--brand-2)]">Wealth-desk dashboard</button>
          </div>
        </header>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="font-display text-[26px] font-semibold text-[var(--primary)]">
              Money in motion <span className="tabular-nums">{s ? short(s.money_in_motion) : '…'}</span>
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">by signal · {s?.households ?? '…'} households with a signal · live from Lakebase</div>
          </div>
          <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-[var(--muted)]">
            {segs.map((b, i) => (
              <div key={b.signal} title={`${b.signal} ${short(b.amount)}`} style={{ width: `${((b.amount ?? 0) / segTotal) * 100}%`, background: SEG_COLORS[i % SEG_COLORS.length] }} />
            ))}
          </div>
          <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
            {segs.map((b, i) => (
              <div key={b.signal} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />
                  <span className="truncate">{b.signal}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{short(b.amount)} · {b.households} hh</span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-[26px] font-semibold text-[var(--primary)]">Call list for today</h2>
              <button onClick={() => nav('/book')} className="text-xs font-medium text-[var(--primary-light)] hover:underline">Whole book →</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {top.map((r) => (
                <button key={r.id} onClick={() => nav(`/clients/${r.id}`)} className={cn('rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-left transition hover:border-[var(--brand-2)] hover:shadow-sm', r.decision && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <span className="font-display text-[44px] leading-none text-[var(--brand-4)]">{r.book_rank}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-snug">{r.primary_name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted-foreground)]">{r.primary_age ? `Age ${r.primary_age} · ` : ''}{short(r.aum)} AUM · {r.risk_profile}{r.vulnerable && <Pill tone="warn">Vulnerable</Pill>}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold tabular-nums">{short(r.money_in_motion)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">in motion</div>
                    </div>
                  </div>
                  <div className="mt-3 truncate text-sm">{r.headline_signal}</div>
                  {(r.aum_at_risk ?? 0) > 0 && <div className="mt-0.5 text-xs font-medium text-[var(--brand-5)]">{short(r.aum_at_risk)} could walk</div>}
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Model’s top pick</div>
                      <div className={cn(r.model_top_blocked && 'line-through decoration-[var(--brand-5)]')}>{ACTION_SHORT[r.top_model_action ?? ''] ?? r.top_model_action ?? '—'}</div>
                      {r.top_model_status && <div className="mt-1"><SuitPill status={r.top_model_status} /></div>}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Suitable instead</div>
                      <div className="font-medium text-[var(--primary)]">{ACTION_SHORT[r.best_suitable_action ?? ''] ?? r.best_suitable_action ?? '—'}</div>
                    </div>
                  </div>
                </button>
              ))}
              {top.length === 0 && [0, 1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-[var(--muted)]" />)}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-2 font-display text-xl font-semibold text-[var(--primary)]"><MessagesSquare className="size-4" />Ask the advisor copilot</div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Your book (Lakebase), firm analytics (Genie) and the policy library (Genie agent) in one chat.</p>
              <div className="mt-3 flex flex-col gap-2">
                {script.map((sc) => (
                  <button key={sc.prompt} onClick={() => dockController.openAndSend(sc.prompt)} className="flex items-start gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-left text-[13px] leading-snug hover:border-[var(--brand-2)]">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-4)]" />{sc.prompt}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[#E2CFA3] bg-[#FBF5E6] p-5">
              <div className="flex items-center gap-2 font-display text-xl font-semibold text-[#6B5220]"><AlertTriangle className="size-4" />Why the model never gets the last word</div>
              <p className="mt-2 text-sm leading-relaxed text-[#4A3B1A]">
                The propensity model learned from 18 months of what advisors sold, including buffered structured notes to clients who had just
                inherited money. Those offers converted, so the model ranks them high. But most complex-product complaints came from exactly those
                clients. Every action is checked against the Reg BI suitability rules before it is shown as an option.
              </p>
              <button onClick={() => dockController.openAndSend('How many complex-product complaints did we get in the last 18 months, and how many came from offers that would fail today’s suitability rules?')}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B5220] hover:underline"><BookOpen className="size-3.5" />Ask the copilot</button>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-2 font-display text-xl font-semibold text-[var(--primary)]"><Brain className="size-4" />Desk activity</div>
              {activity.length === 0 && <div className="mt-2 text-sm text-[var(--muted-foreground)]">Nothing logged yet today. Open a client and prep the meeting.</div>}
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {activity.map((a, i) => (
                  <li key={`${a.client_id}-${a.at}-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <button onClick={() => nav(`/clients/${a.client_id}`)} className="truncate text-left hover:underline">
                      <b>{ACTION[a.action] ?? a.action}</b> · {a.primary_name} <span className="text-[var(--muted-foreground)]">{a.notes ? `— ${a.notes.replace(/^Meeting prep: /, '')}` : ''}</span>
                    </button>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
