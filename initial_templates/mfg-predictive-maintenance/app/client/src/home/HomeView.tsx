/**
 * Plant-floor HMI — the reliability engineer's control room.
 * Status strip (plant readouts) · production-line schematic (every asset is a machine tile on its line,
 * colored by ML 7-day failure risk) · priority-asset panel (RUL gauge + drivers) · event log.
 * Everything reads the Lakebase mirror and refreshes when the agent writes (dataMutated).
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Radio, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import {
  fetchActivity,
  fetchFleet,
  fetchFleetSummary,
  fmtDate,
  usd,
  type ActivityEvent,
  type FleetAsset,
  type FleetSummary,
  type RiskTier,
} from '@/lib/pdm';
import { AssetDrawer } from '@/fleet/AssetDrawer';

const PERSONA = 'Marcus Chen · Plant Reliability Engineer · TechRobotics Greenville, Plant 2';
const LINE_ORDER = ['Line 1 — Precision Machining', 'Line 2 — Robotic Assembly', 'Line 3 — Press & Test', 'Utilities'];

const TIER_COLOR: Record<RiskTier, string> = {
  Critical: 'var(--risk-critical)',
  High: 'var(--risk-high)',
  Watch: 'var(--risk-watch)',
  Healthy: 'var(--risk-ok)',
};

export function HomeView() {
  const { config } = useSession();
  const [fleet, setFleet] = useState<FleetAsset[] | null>(null);
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      Promise.all([fetchFleet(), fetchFleetSummary(), fetchActivity(12)])
        .then(([f, s, a]) => {
          setFleet(f);
          setSummary(s);
          setActivity(a);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    void load();
    return dataMutated.subscribe(() => void load());
  }, []);

  const byLine = useMemo(() => {
    const m = new Map<string, FleetAsset[]>();
    for (const a of fleet ?? []) m.set(a.line, [...(m.get(a.line) ?? []), a]);
    for (const v of m.values()) v.sort((x, y) => x.id.localeCompare(y.id));
    return m;
  }, [fleet]);

  // The priority asset is the highest-risk machine (fleet is sorted by risk server-side).
  const top = fleet?.[0];
  const script = config?.assistantScript ?? [];
  const askPrompt = script[0]?.prompt ?? 'Which machine should I worry about this week, and why?';

  if (error) {
    return (
      <div className="p-10 text-sm">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive">Couldn&apos;t load the fleet: {error}</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-5 space-y-3 max-w-[1600px] mx-auto">
      {/* ── status strip: plant readouts ───────────────────────────── */}
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-border/70">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground whitespace-nowrap">
            <Radio className="size-3 text-[var(--risk-ok)]" /> Live · plant 2 · hourly telemetry
          </div>
          <div className="text-xs text-muted-foreground truncate">{PERSONA}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 divide-x divide-border">
          <Readout label="Assets" value={summary?.assets} />
          <Readout label="Critical" value={summary?.critical} tone="critical" />
          <Readout label="High" value={summary?.high} tone="high" />
          <Readout label="Watch" value={summary?.watch} tone="watch" />
          <Readout label="Protected" value={summary?.protected_assets} tone="ok" />
          <Readout label="$ at risk · 7 d" value={summary ? usd(summary.cost_at_risk_usd) : undefined} tone="critical" />
          <Readout label="Cost avoided" value={summary ? usd(summary.cost_avoided_usd) : undefined} tone="ok" />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
        {/* ── production-line schematic: the hero ──────────────────── */}
        <section className="rounded-md border bg-card p-4 min-w-0">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Plant floor · P2 production lines</div>
              <div className="text-lg font-semibold">Machine status by line</div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
              {(['Critical', 'High', 'Watch', 'Healthy'] as const).map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: TIER_COLOR[t] }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {!fleet && ['a', 'b', 'c'].map((k) => <div key={k} className="h-20 rounded-md bg-muted animate-pulse" />)}
            {LINE_ORDER.filter((l) => byLine.has(l)).map((line) => (
              <div key={line} className="rounded-md border border-border/70 bg-background/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {line}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{byLine.get(line)!.length} units</div>
                </div>
                {/* conveyor rail: machines sit on the line, flow runs left to right */}
                <div className="relative">
                  <div className="absolute left-3 right-3 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-border" />
                  <div className="relative grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {byLine.get(line)!.map((a) => (
                      <MachineTile key={a.id} a={a} onOpen={() => setSelected(a.id)} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── priority asset: RUL gauge + drivers ──────────────────── */}
        <aside className="rounded-md border bg-card p-4 flex flex-col min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Priority asset · failure_risk_model@champion</div>
          {!top ? (
            <div className="mt-4 space-y-2"><div className="h-8 w-2/3 bg-muted rounded animate-pulse" /><div className="h-40 bg-muted rounded animate-pulse" /></div>
          ) : (
            <>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-mono text-3xl font-semibold tracking-tight">{top.id}</span>
                <span className="font-mono text-sm font-semibold" style={{ color: TIER_COLOR[top.risk_tier] }}>
                  {top.risk_tier.toUpperCase()} · {top.risk_score}%
                </span>
              </div>
              <div className="text-sm text-muted-foreground">{top.name} · {top.model} · {usd(top.downtime_cost_per_hour)}/h down</div>

              <RulGauge days={top.est_days_to_failure} tier={top.risk_tier} />

              <div className="mt-1 text-sm font-medium">{top.predicted_failure_mode ?? 'No failure mode predicted'}</div>
              <ul className="mt-2 space-y-1.5 text-sm font-mono text-[12px]">
                {[top.top_driver_1, top.top_driver_2].filter(Boolean).map((d) => (
                  <li key={d} className="flex gap-2 text-foreground/85"><span className="text-[var(--risk-critical)]">▲</span>{d}</li>
                ))}
                {top.last_pm_lubricant && (
                  <li className="flex gap-2 text-foreground/85"><span className="text-[var(--risk-high)]">■</span>PM {fmtDate(top.last_pm_at)} · {top.last_pm_vendor} · {top.last_pm_lubricant}</li>
                )}
              </ul>

              <div className="mt-auto pt-4 flex flex-wrap gap-2">
                {top.open_work_order_id ? (
                  <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--risk-ok)]/40 bg-[var(--risk-ok-bg)] px-3 py-1.5 text-sm font-medium text-[var(--risk-ok)]">
                    <CalendarCheck className="size-4" />{top.open_work_order_id} booked
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void dockController.newAndSend(askPrompt)}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:brightness-110"
                  >
                    <Sparkles className="size-4" /> Diagnose with Copilot
                  </button>
                )}
                <button type="button" onClick={() => setSelected(top.id)} className="rounded-sm border px-3 py-1.5 text-sm hover:bg-muted">
                  Open asset
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── event log ──────────────────────────────────────────────── */}
      <section className="rounded-md border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Work-order event log · Lakebase</div>
            <div className="text-sm text-muted-foreground">Work orders, part reservations and window bookings written by the copilot or the team.</div>
          </div>
        </div>
        {activity.length === 0 ? (
          <div className="mt-3 font-mono text-sm text-muted-foreground">-- no bookings yet · ask the copilot to plan the fix --</div>
        ) : (
          <ul className="mt-3 font-mono text-[12px] divide-y divide-border/70">
            {activity.map((e) => (
              <li key={`---`} className="py-1.5 grid grid-cols-[120px_110px_170px_1fr] gap-3 items-baseline">
                <span className="text-muted-foreground">{fmtDate(e.at, true)}</span>
                <span className="text-[var(--brand-5)]">{e.work_order_id}</span>
                <span className="uppercase tracking-wide">{e.action.replace(/_/g, ' ')}</span>
                <span className="text-foreground/80 truncate">{e.asset_id} — {e.notes}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AssetDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: number | string | undefined; tone?: 'critical' | 'high' | 'watch' | 'ok' }) {
  const color =
    tone === 'critical' ? 'text-[var(--risk-critical)]'
    : tone === 'high' ? 'text-[var(--risk-high)]'
    : tone === 'watch' ? 'text-[var(--risk-watch)]'
    : tone === 'ok' ? 'text-[var(--risk-ok)]'
    : 'text-foreground';
  return (
    <div className="px-4 py-2.5 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">{label}</div>
      <div className={`font-mono text-2xl font-semibold leading-tight mt-0.5 ${color}`}>{value ?? '—'}</div>
    </div>
  );
}

function MachineTile({ a, onOpen }: { a: FleetAsset; onOpen: () => void }) {
  const c = TIER_COLOR[a.risk_tier];
  const booked = a.status === 'work_order_booked';
  return (
    <button
      type="button"
      data-asset={a.id}
      onClick={onOpen}
      title={`${a.name} — ${a.risk_tier} ${a.risk_score}%`}
      className="group relative text-left rounded-sm bg-card border border-border hover:border-foreground/40 transition-colors overflow-hidden"
    >
      {/* status bar — the machine's risk colour, the one thing the eye should catch */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: c }} />
      <div className="pl-3 pr-2 py-2">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[13px] font-semibold">{a.id}</span>
          <span className="flex items-center gap-1">
            {a.is_bottleneck && <span className="font-mono text-[9px] font-bold text-[var(--brand-5)]">BN</span>}
            {booked && <CalendarCheck className="size-3 text-[var(--risk-ok)]" />}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{a.asset_type}</div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="font-mono text-lg font-semibold leading-none" style={{ color: c }}>{a.risk_score}%</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {a.vib_ratio != null ? `VIB ×${a.vib_ratio.toFixed(1)}` : a.risk_tier}
          </span>
        </div>
        {/* risk bar */}
        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, a.risk_score))}%`, background: c }} />
        </div>
      </div>
    </button>
  );
}

/** Remaining-useful-life gauge: a 0–14 day arc, filled from the failure end. */
function RulGauge({ days, tier }: { days: number | null; tier: RiskTier }) {
  const MAX = 14;
  const d = days == null ? null : Math.max(0, Math.min(MAX, days));
  const frac = d == null ? 0 : 1 - d / MAX; // more filled = sooner failure
  const R = 70;
  const C = Math.PI * R; // semicircle length
  const color = TIER_COLOR[tier];
  return (
    <div className="mt-3 flex flex-col items-center">
      <svg viewBox="0 0 180 104" className="w-[220px] h-auto">
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="var(--muted)" strokeWidth="12" strokeLinecap="butt" />
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${C * frac} ${C}`}
        />
        <text x="90" y="72" textAnchor="middle" className="font-mono" fill="currentColor" fontSize="26" fontWeight="600">
          {d == null ? '—' : d.toFixed(1)}
        </text>
        <text x="90" y="88" textAnchor="middle" fill="var(--muted-foreground)" fontSize="10" letterSpacing="1.5">
          DAYS TO FAILURE
        </text>
      </svg>
    </div>
  );
}
