/**
 * Home — the warranty & field-quality workbench for Brightwater Cycle Works.
 * Hero: Pareto of failure codes (claims by AI failure mode, cumulative %). The emerging failure is
 * the orange bar. Below: early-warning signal cards with control-chart sparklines (weekly claims vs
 * mean and 3-sigma limit), and a claim triage table of claims whose dealer labor code disagrees with
 * the AI failure mode. Copilot entry points and recent quality activity sit at the foot.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  HERO_SIGNAL_MODE, fetchActivity, fetchClaims, fetchSignal, fetchSignals, fetchSummary, money, moneyK,
  type ActivityRow, type SignalRow, type Summary,
} from '@/warranty/api';
import { Pill, StatusPill, cn } from '@/warranty/ui';

type Mode = { failure_mode: string; failure_mode_label: string; claims: number; claims_90d: number; cost: number; code_agreement: number };
type TriageRow = {
  id: string; serial: string; model_name: string | null; dealer_name: string | null; claim_date: string;
  dealer_labor_code: string | null; failure_mode_label: string | null; failure_mode: string | null; total_cost: number | null;
  claim_status: string | null; technician_notes: string | null;
};
type Kpis = { claims_per_1k_3m: number; claims_per_1k_prior: number; warranty_cost_12m: number; cost_per_bike_12m: number; recovery_rate_pct: number; unrecovered_cost: number };
type Weekly = { week: string; claims: number }[];

const ACTION: Record<string, string> = { ai_analysis: 'Root-cause case assembled', case_opened: 'Quality case opened', notice_edited: 'Supplier notice edited', note: 'Note' };

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [signals, setSignals] = useState<SignalRow[] | null>(null);
  const [weekly, setWeekly] = useState<Record<string, Weekly>>({});
  const [modes, setModes] = useState<Mode[]>([]);
  const [triage, setTriage] = useState<TriageRow[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSignals().then(setSignals).catch(() => setSignals([]));
    fetchSummary().then(setSummary).catch(() => {});
    fetchActivity(8).then(setActivity).catch(() => {});
  }, [tick]);
  useEffect(() => {
    void fetchClaims({}).then((r) => setModes(r.modes as Mode[])).catch(() => {});
    void fetchClaims({ mismatch: '1' }).then((r) => setTriage((r.claims as unknown as TriageRow[]).slice(0, 9))).catch(() => {});
  }, [tick]);
  useEffect(() => {
    fetch('/api/charts/warranty_kpis').then((r) => r.json()).then((b: { data?: Kpis[] }) => setKpis(b.data?.[0] ?? null)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!signals) return;
    void Promise.all(signals.map((s) => fetchSignal(s.id).then((d) => [s.id, d.weekly as Weekly] as const).catch(() => [s.id, [] as Weekly] as const)))
      .then((pairs) => setWeekly(Object.fromEntries(pairs)));
  }, [signals]);

  const script = config?.assistantScript ?? [];
  const paretoModes = useMemo(() => [...modes].sort((a, b) => b.claims - a.claims), [modes]);
  const totalClaims = paretoModes.reduce((s, m) => s + m.claims, 0);
  const emerging = signals?.find((s) => s.failure_mode === HERO_SIGNAL_MODE) ?? signals?.[0];
  const up = kpis ? Math.round(((kpis.claims_per_1k_3m - kpis.claims_per_1k_prior) / kpis.claims_per_1k_prior) * 100) : null;
  const signalFor = (mode: string) => signals?.find((s) => s.failure_mode === mode);

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-[1500px] px-5 py-4 space-y-4">
        {/* ── workbench header + KPI strip ─────────────────────────── */}
        <section className="rounded-md border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Warranty &amp; field quality · Brightwater Cycle Works</div>
              <div className="text-sm font-semibold">Priya Raman · claims, 90-day window</div>
            </div>
            <div className="flex items-center gap-2">
              {emerging && (
                <button onClick={() => void nav(`/signals/${emerging.id}`)} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-5)] px-3 py-1.5 text-sm font-semibold text-white">
                  Investigate {emerging.supplier_name.split(' ')[0]} signal <ArrowRight className="size-3.5" />
                </button>
              )}
              <button onClick={() => void nav('/analytics')} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">Analytics</button>
              <button onClick={() => void nav('/dashboard')} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">Dashboard</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-[var(--border)]">
            <Stat label="Claims / 1k bikes / mo" value={kpis ? `${kpis.claims_per_1k_3m}` : '…'} sub={kpis && up != null ? `${up > 0 ? '+' : ''}${up}% vs prior 12 mo (${kpis.claims_per_1k_prior})` : undefined} tone="hot" />
            <Stat label="Warranty cost · 12 mo" value={kpis ? moneyK(kpis.warranty_cost_12m) : '…'} sub={kpis ? `${money(kpis.cost_per_bike_12m)} per bike` : undefined} />
            <Stat label="Supplier recovery" value={kpis ? `${kpis.recovery_rate_pct}%` : '…'} sub={kpis ? `${moneyK(kpis.unrecovered_cost)} unrecovered` : undefined} />
            <Stat label="Emerging signals" value={signals ? `${signals.length}` : '…'} sub={summary ? `${summary.miscoded_90d} claims miscoded · 90 d` : undefined} tone="hot" />
            <Stat label="Quality cases" value={summary ? `${summary.quality_cases}` : '…'} sub={summary ? `${moneyK(summary.chargebacks_filed)} chargebacks filed` : undefined} />
          </div>
        </section>

        {/* ── hero: Pareto of failure codes ────────────────────────── */}
        <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="font-semibold">Pareto · claims by failure code</div>
              <div className="text-xs text-[var(--muted-foreground)]">AI failure mode from the technician notes, not the dealer labor code. Bars = claims; Cum. % = cumulative share.</div>
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">{totalClaims ? `${totalClaims.toLocaleString()} claims` : ''}</div>
          </div>
          {paretoModes.length ? (
            <Pareto modes={paretoModes} emerging={HERO_SIGNAL_MODE} onPick={(m) => { const s = signalFor(m); if (s) void nav(`/signals/${s.id}`); }} />
          ) : (
            <div className="mt-4 h-56 rounded bg-[var(--muted)] animate-pulse" />
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          {/* ── early-warning cards with control charts ─────────────── */}
          <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">Early-warning signals · weekly claims vs control limit</div>
              <button onClick={() => void nav('/signals')} className="text-xs text-[var(--primary-light)] hover:underline">All failure modes →</button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {!signals && [0, 1].map((i) => <div key={i} className="h-40 rounded-md bg-[var(--muted)] animate-pulse" />)}
              {signals?.length === 0 && <div className="text-sm text-[var(--muted-foreground)]">No emerging signals — the board is quiet.</div>}
              {signals?.map((s) => {
                const hot = s.failure_mode === HERO_SIGNAL_MODE;
                return (
                  <button key={s.id} onClick={() => void nav(`/signals/${s.id}`)}
                    className={cn('rounded-md border p-3 text-left transition-colors hover:border-[var(--brand-5)]', hot ? 'border-[var(--brand-5)] bg-[#FFF6F1]' : 'border-[var(--border)]')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{s.failure_mode_label}</div>
                        <div className="truncate text-xs text-[var(--muted-foreground)]">{s.supplier_name} · {s.cohort_dimension?.replace('_', ' ')} {s.cohort_values}</div>
                      </div>
                      <StatusPill status={s.status} />
                    </div>
                    <ControlChart series={weekly[s.id] ?? []} hot={hot} />
                    <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span><b className="font-mono text-sm text-[var(--foreground)]">{s.rate_ratio}×</b><br />vs last year</span>
                      <span><b className="font-mono text-sm text-[var(--foreground)]">{s.claims_90d}</b><br />claims · 90 d</span>
                      <span><b className="font-mono text-sm text-[var(--foreground)]">{moneyK(s.projected_cost)}</b><br />projected</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.chargeable ? <Pill tone="info">chargeable to supplier</Pill> : <Pill tone="neutral">Brightwater firmware</Pill>}
                      <Pill tone="neutral">{s.affected_units.toLocaleString()} bikes in scope</Pill>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── claim triage ───────────────────────────────────────── */}
          <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="font-semibold">Claim triage · dealer code disagrees with AI</div>
            <div className="text-xs text-[var(--muted-foreground)]">Miscoded labor codes hide the real failure mode. Newest first.</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="py-1.5 pr-2 font-medium">Claim</th>
                    <th className="py-1.5 pr-2 font-medium">Dealer code</th>
                    <th className="py-1.5 pr-2 font-medium">AI failure mode</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Cost</th>
                    <th className="py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {triage.length === 0 && <tr><td colSpan={5} className="py-4 text-[var(--muted-foreground)]">No mismatched claims.</td></tr>}
                  {triage.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--border)]/70 align-top">
                      <td className="py-1.5 pr-2"><div className="font-mono font-semibold">{c.id}</div><div className="text-[10px] text-[var(--muted-foreground)]">{c.model_name} · {c.dealer_name}</div></td>
                      <td className="py-1.5 pr-2 font-mono text-[var(--muted-foreground)]">{c.dealer_labor_code ?? '—'}</td>
                      <td className="py-1.5 pr-2 font-medium">{c.failure_mode_label ?? c.failure_mode}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{money(c.total_cost)}</td>
                      <td className="py-1.5 text-[11px] text-[var(--muted-foreground)]">{c.claim_status ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* ── copilot + recent activity ────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2 font-semibold"><MessagesSquare className="size-4 text-[var(--brand-5)]" />Ask the Copilot</div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">VP-Quality questions go to Genie over the governed tables; root-cause questions to the lakehouse evidence tool; contract questions to the supplier-quality library.</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {script.map((s) => (
                <button key={s.prompt} onClick={() => void dockController.openAndSend(s.prompt)}
                  className="flex items-start gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:border-[var(--brand-5)]">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-5)]" />{s.prompt}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="font-semibold">Recent quality activity</div>
            {activity.length === 0 && <div className="mt-2 text-sm text-[var(--muted-foreground)]">Nothing yet — open a signal and assemble the root-cause case.</div>}
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {activity.map((a) => (
                <li key={`${a.signal_id}-${a.at}-${a.action}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <button onClick={() => void nav(`/signals/${a.signal_id}`)} className="truncate text-left hover:underline">
                    <b>{ACTION[a.action] ?? a.action}</b> · {a.signal} <span className="text-[var(--muted-foreground)]">({a.supplier})</span>
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'hot' }) {
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-foreground)] whitespace-nowrap">{label}</div>
      <div className={cn('font-mono text-xl font-semibold tabular-nums leading-tight', tone === 'hot' && 'text-[var(--brand-5)]')}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

/** Pareto as a horizontal ranked table: label column (never overlaps), bar, claim count, cumulative share. */
function Pareto({ modes, emerging, onPick }: { modes: Mode[]; emerging: string; onPick: (mode: string) => void }) {
  const total = modes.reduce((s, m) => s + m.claims, 0) || 1;
  const maxC = Math.max(...modes.map((m) => m.claims), 1);
  const cum = modes.reduce<number[]>((acc, m) => [...acc, (acc[acc.length - 1] ?? 0) + m.claims / total], []);
  return (
    <div className="mt-3">
      <div className="grid grid-cols-[minmax(0,280px)_minmax(0,1fr)_64px_64px] gap-3 border-b border-[var(--border)] pb-1.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
        <span>Failure code (AI)</span>
        <span>Claims</span>
        <span className="text-right">Claims</span>
        <span className="text-right">Cum. %</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {modes.map((m, i) => {
          const hot = m.failure_mode === emerging;
          return (
            <button
              key={m.failure_mode}
              type="button"
              onClick={() => onPick(m.failure_mode)}
              title={`${m.failure_mode_label}: ${m.claims} claims · ${moneyK(m.cost)}`}
              className="grid w-full grid-cols-[minmax(0,280px)_minmax(0,1fr)_64px_64px] items-center gap-3 py-1.5 text-left hover:bg-[var(--muted)]/50"
            >
              <span className={cn('truncate text-[12.5px]', hot && 'font-semibold text-[var(--brand-5)]')}>{m.failure_mode_label}</span>
              <span className="h-3.5 overflow-hidden rounded-sm bg-[var(--muted)]">
                <span className="block h-full rounded-sm" style={{ width: `${(m.claims / maxC) * 100}%`, background: hot ? 'var(--brand-5)' : '#5A6270' }} />
              </span>
              <span className="text-right font-mono text-[12px] tabular-nums">{m.claims}</span>
              <span className="text-right font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">{Math.round(cum[i] * 100)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Control chart: weekly claims, mean and 3-sigma (Poisson) upper limit; points above UCL in red. */
function ControlChart({ series, hot }: { series: Weekly; hot: boolean }) {
  const W = 300, H = 58;
  if (!series.length) return <div className="mt-2 h-[58px] rounded bg-[var(--muted)] animate-pulse" />;
  const vals = series.map((p) => p.claims);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const ucl = mean + 3 * Math.sqrt(Math.max(mean, 0.01));
  const max = Math.max(ucl, ...vals, 1) * 1.1;
  const x = (i: number) => (i * W) / Math.max(1, vals.length - 1);
  const y = (v: number) => H - 4 - (v / max) * (H - 8);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full h-[58px]" preserveAspectRatio="none">
      <line x1="0" x2={W} y1={y(ucl)} y2={y(ucl)} stroke="#B42330" strokeDasharray="4 3" strokeWidth="1" />
      <line x1="0" x2={W} y1={y(mean)} y2={y(mean)} stroke="var(--muted-foreground)" strokeDasharray="2 3" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={hot ? 'var(--brand-5)' : '#2E3440'} strokeWidth="1.75" strokeLinejoin="round" />
      {series.map((p, i) => p.claims > ucl && <circle key={p.week} cx={x(i)} cy={y(p.claims)} r="2.5" fill="#B42330" />)}
    </svg>
  );
}

