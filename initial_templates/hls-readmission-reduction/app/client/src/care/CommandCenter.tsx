/**
 * Care-transitions board (home). A hospital discharge whiteboard, not a marketing hero: a unit census
 * strip (heart-failure readmissions per unit, last 26 weeks vs before), then the discharge board itself
 * (one row per patient: LACE inputs, risk tier, follow-up status, and a 30-day post-discharge timeline).
 * The story is the same as before: 4 West heart-failure readmissions rose while the rest of Larkspur
 * stayed flat, because weekend discharges leave without a 7-day follow-up.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchActivity, fetchCommandCenter, fetchWorklist, n0, pct, usd, dayLabel, CONDITION, type ActivityRow, type CommandCenter as CC, type WorklistRow } from './api';
import { TrendChart, WeekdayChart } from './charts';
import { cn } from './ui';

const ACTION: Record<string, string> = { ai_plan: 'Transition plan drafted', approved: 'Plan approved', tasks_created: 'Outreach tasks created', discarded: 'Plan discarded' };
const FILTERS = [
  { key: 'high', label: 'High risk' },
  { key: 'nofu', label: 'No 7-day follow-up' },
  { key: 'all', label: 'All discharges' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];
const ROW_LIMIT = 14;
const DAY = 86_400_000;
const utc = (s: string) => Date.parse(`${s.slice(0, 10)}T12:00:00Z`);

/** Days 0–30 after discharge: the 7-day follow-up window, the booked visit (or a missing one), and the as-of day. */
function Timeline30({ discharge, followup, asOf }: { discharge: string; followup: string | null; asOf: string | null }) {
  const W = 220, H = 36;
  const x = (day: number) => (Math.max(0, Math.min(30, day)) / 30) * W;
  const d0 = utc(discharge);
  const fu = followup ? Math.round((utc(followup) - d0) / DAY) : null;
  const today = asOf ? Math.round((utc(asOf) - d0) / DAY) : null;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="30-day post-discharge timeline">
      <rect x={0} y={6} width={x(7)} height={9} rx={2} fill="#9CC3EA" />
      <rect x={x(7)} y={6} width={W - x(7)} height={9} rx={2} fill="#E6ECF2" />
      <line x1={x(7)} x2={x(7)} y1={4} y2={H - 4} stroke="#5E6E80" strokeDasharray="2 2" />
      <circle cx={0} cy={10.5} r={3.5} fill="#17263A"><title>Discharge</title></circle>
      {fu != null && fu >= 0 && fu <= 30 ? (
        <circle cx={x(fu)} cy={10.5} r={4.5} fill={fu <= 7 ? '#2E7D5B' : '#C2410C'}><title>Follow-up visit, day {fu}</title></circle>
      ) : (
        <text x={x(7) + 3} y={H - 4} fontSize="9.5" fill="#B42318" fontWeight={600}><title>No follow-up booked</title>no visit</text>
      )}
      {today != null && today >= 0 && today <= 30 && <line x1={x(today)} x2={x(today)} y1={2} y2={H - 2} stroke="#B42318" strokeWidth={1.5}><title>As of today</title></line>}
    </svg>
  );
}

function RiskPill({ tier, score }: { tier: string; score: number }) {
  const cls = tier === 'High' ? 'bg-[#FDE7D6] text-[#9A3412] border-[#F3B98C]' : tier === 'Medium' ? 'bg-[#FEF6E0] text-[#7A5A00] border-[#E9D08A]' : 'bg-[#EEF2F6] text-[#3B4B5E] border-[#D3DCE6]';
  return <span className={cn('inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold', cls)}>{tier} <span className="font-normal">{pct(score)}</span></span>;
}

export function CommandCenter() {
  const nav = useNavigate();
  const { config } = useSession();
  const [d, setD] = useState<CC | null>(null);
  const [rows, setRows] = useState<WorklistRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('high');
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchCommandCenter().then(setD).catch((e) => setErr((e as Error).message));
    fetchWorklist().then(setRows).catch(() => {});
    fetchActivity(6).then(setActivity).catch(() => {});
  }, [tick]);

  const script = config?.assistantScript ?? [];
  const k = d?.kpis;
  const lrmc = d?.penalty.find((p) => p.hospital_id === 'LRMC');
  const marker = d?.events[0]?.event_date?.slice(0, 7);

  const counts = useMemo(() => ({
    high: (rows ?? []).filter((r) => r.riskTier === 'High').length,
    nofu: (rows ?? []).filter((r) => !r.followupBooked).length,
    all: (rows ?? []).length,
  }), [rows]);
  const board = useMemo(() => {
    const r = rows ?? [];
    const pick = filter === 'high' ? r.filter((x) => x.riskTier === 'High') : filter === 'nofu' ? r.filter((x) => !x.followupBooked) : r;
    return [...pick].sort((a, b) => b.riskScore - a.riskScore);
  }, [rows, filter]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Larkspur Health · Care transitions board{k ? ` · as of ${dayLabel(k.as_of)}` : ''}</div>
            <h1 className="text-xl font-semibold text-[var(--foreground)]">
              Heart-failure readmissions on 4 West went from {k ? pct(k.signal_hf_rate_before) : '…'} to {k ? pct(k.signal_hf_rate_last26) : '…'} in six months.
            </h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => nav('/worklist')} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-white">Open discharge worklist <ArrowRight className="size-4" /></button>
            <button onClick={() => nav('/hrrp')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium">HRRP exposure</button>
            <button onClick={() => nav('/dashboard')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium">Readmissions dashboard</button>
          </div>
        </div>
        <p className="max-w-4xl text-sm text-[var(--muted-foreground)]">
          The rest of Larkspur is flat. The patients coming back were discharged Friday to Sunday with “call the clinic Monday” instead of a booked visit.
          The Readmission Copilot finds them before they leave and drafts each transition plan; the coordinators approve them.
        </p>

        {/* Census bar — the numbers, in one hairline-ruled strip */}
        {k && lrmc && d ? (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] md:grid-cols-3 xl:grid-cols-6">
            {[
              { label: 'Discharges · 12 mo', value: n0(k.discharges_12m), sub: `HF readmit ${pct(k.hf_rate_12m, 1)}` },
              { label: '4 West HF readmit · 26 wk', value: pct(k.signal_hf_rate_last26, 1), sub: `${pct(k.signal_hf_rate_before, 1)} before`, tone: '#B42318' },
              { label: 'Weekend HF, 7-day visit', value: pct(k.signal_weekend_followup_last26, 0), sub: `weekday ${pct(k.signal_weekday_followup_last26, 0)}` },
              { label: 'HRRP penalty · LRMC', value: usd(lrmc.penalty_usd), sub: `${pct(lrmc.penalty_pct, 1)} of base payments` },
              { label: 'High risk, no follow-up', value: String(d.summary.high_risk_no_followup), sub: `of ${n0(d.summary.high_risk)} high risk`, tone: '#C2410C' },
              { label: 'Open outreach tasks', value: String(d.summary.open_tasks), sub: `${d.summary.plans_approved} plans approved` },
            ].map((c) => (
              <div key={c.label} className="bg-[var(--card)] px-3 py-2.5">
                <div className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{c.label}</div>
                <div className="font-mono text-xl font-semibold tabular-nums" style={{ color: c.tone }}>{c.value}</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">{c.sub}</div>
              </div>
            ))}
          </div>
        ) : err ? <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm text-[#B42318]">{err}</div>
          : <div className="h-16 animate-pulse rounded-md bg-[var(--muted)]" />}

        {/* Unit census — heart-failure readmissions by unit */}
        {d && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-baseline justify-between border-b border-[var(--border)] px-3 py-2">
              <div className="text-sm font-semibold">Unit census · heart-failure 30-day readmissions</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">last 26 weeks vs before · change in points</div>
            </div>
            <div className="grid gap-px bg-[var(--border)]" style={{ gridTemplateColumns: `repeat(${d.units.length}, minmax(0, 1fr))` }}>
              {d.units.map((u) => {
                const hot = u.change_pts > 0 && u.unit_id === 'LRMC-4W';
                return (
                  <div key={u.unit_id} className={cn('bg-[var(--card)] px-3 py-2', hot && 'bg-[#FDF3EE]')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{u.unit_id.replace('LRMC-', 'LRMC · ')}</span>
                      <span className={cn('font-mono text-[11px] font-semibold', u.change_pts > 0 ? 'text-[#B42318]' : 'text-[#2E7D5B]')}>{u.change_pts > 0 ? '+' : ''}{u.change_pts} pts</span>
                    </div>
                    <div className="truncate text-[11px] text-[var(--muted-foreground)]" title={u.unit_name}>{u.unit_name}</div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="font-mono text-base font-semibold tabular-nums">{pct(u.rate_last26, 1)}</span>
                      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">n={n0(u.n_last26)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* The discharge whiteboard */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <div className="flex items-center gap-1">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={cn('rounded px-2.5 py-1 text-xs font-medium', filter === f.key ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]')}>
                  {f.label} <span className="font-mono opacity-80">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)]">LACE inputs: <span className="font-mono">L</span> length of stay · <span className="font-mono">C</span> Charlson · <span className="font-mono">E</span> ED visits, 6 mo</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-[13px]">
              <thead className="bg-[#F3F6F9] text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  {["Unit", "Patient", "Condition", "LACE inputs", "Discharge", 'Risk', 'Follow-up', '30-day window', 'Plan'].map((h) => <th key={h} className="px-3 py-1.5 text-left font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows === null && <tr><td colSpan={9} className="p-3"><div className="h-24 animate-pulse rounded bg-[var(--muted)]" /></td></tr>}
                {rows !== null && board.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--muted-foreground)]">No discharges in this view.</td></tr>}
                {board.slice(0, ROW_LIMIT).map((r) => {
                  const w = r.data;
                  const unitShort = r.unitId.includes('-') ? r.unitId.split('-')[1] : r.unitId;
                  const booked = r.followupBooked;
                  return (
                    <tr key={r.encounterId} onClick={() => nav(`/worklist/${r.encounterId}`)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[#F3F7FB]">
                      <td className="px-3 py-1.5"><span className="font-mono font-semibold">{unitShort}</span></td>
                      <td className="whitespace-nowrap px-3 py-1.5"><div className="font-medium">{r.patientName}</div><div className="font-mono text-[11px] text-[var(--muted-foreground)]">{w.age ?? '—'}{w.sex ? ` ${w.sex}` : ''} · {r.encounterId}</div></td>
                      <td className="px-3 py-1.5">{w.condition_label ?? CONDITION[r.hrrpCondition] ?? r.hrrpCondition}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums"><span title="length of stay, days">L{w.los_days ?? '—'}</span> · <span title="Charlson index">C{w.charlson_index ?? '—'}</span> · <span title="ED visits, past 6 months">E{w.ed_visits_6m ?? '—'}</span></td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.status === "planned" ? <span className="rounded bg-[#FEF6E0] px-1 font-mono text-[11px] font-semibold text-[#7A5A00]" title="not yet discharged: planned discharge date">Planned · {dayLabel(r.dischargeDate)}</span> : dayLabel(r.dischargeDate)}{w.weekend_discharge && <span className="ml-1.5 rounded bg-[#FDE7D6] px-1 font-mono text-[10px] font-semibold text-[#9A3412]">WKND</span>}</td>
                      <td className="px-3 py-1.5"><RiskPill tier={r.riskTier} score={r.riskScore} /></td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{booked ? <span className="font-medium text-[#2E7D5B]">{w.followup_date ? dayLabel(w.followup_date) : 'booked'}</span> : <span className="font-semibold text-[#B42318]">none booked</span>}</td>
                      <td className="px-3 py-1.5"><Timeline30 discharge={r.dischargeDate} followup={booked ? w.followup_date : null} asOf={d?.kpis.as_of ?? null} /></td>
                      <td className="px-3 py-1.5 text-xs capitalize text-[var(--muted-foreground)]">{r.planStatus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {board.length > ROW_LIMIT && (
            <div className="border-t border-[var(--border)] px-3 py-2 text-right text-xs">
              <button onClick={() => nav('/worklist')} className="font-medium text-[var(--primary)] hover:underline">{board.length - ROW_LIMIT} more on the worklist →</button>
            </div>
          )}
        </div>

        {/* Trend, weekday and follow-up evidence */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold">HF 30-day readmission rate <span className="text-xs font-normal text-[var(--muted-foreground)]">· rolling 3 months</span></div>
              <div className="flex gap-3 text-xs"><span className="font-semibold text-[var(--brand-5)]">● 4 West</span><span className="font-semibold text-[var(--primary-light)]">● Rest of Larkspur</span></div>
            </div>
            {d ? <TrendChart rows={d.trend} markerMonth={marker} /> : <div className="mt-3 h-52 animate-pulse rounded bg-[var(--muted)]" />}
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-sm font-semibold">4 West HF by discharge weekday</div>
            <div className="mb-2 text-[11px] text-[var(--muted-foreground)]">7-day follow-up booked, before vs last 26 wk</div>
            {d ? <WeekdayChart rows={d.weekday} /> : <div className="mt-3 h-52 animate-pulse rounded bg-[var(--muted)]" />}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-sm font-semibold">Readmission with vs without a 7-day visit</div>
            <div className="mb-2 text-[11px] text-[var(--muted-foreground)]">trailing 12 months · all Larkspur hospitals</div>
            <table className="w-full text-[13px]">
              <thead className="text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr><th className="py-1 text-left font-semibold">Condition</th><th className="py-1 text-right font-semibold">With visit</th><th className="py-1 text-right font-semibold">Without</th></tr>
              </thead>
              <tbody>
                {(d?.followup ?? []).map((f) => (
                  <tr key={f.hrrp_condition} className={cn('border-t border-[var(--border)]', f.hrrp_condition === 'HF' && 'bg-[#FDF3EE]')}>
                    <td className={cn('py-1.5', f.hrrp_condition === 'HF' && 'font-semibold')}>{f.condition_label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-[#2E7D5B]">{pct(f.with_fu_rate, 1)}<div className="text-[10px] text-[var(--muted-foreground)]">n={n0(f.with_fu_n)}</div></td>
                    <td className="py-1.5 text-right font-mono font-semibold tabular-nums text-[#B42318]">{pct(f.without_fu_rate, 1)}<div className="text-[10px] font-normal text-[var(--muted-foreground)]">n={n0(f.without_fu_n)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Only in the discharge notes · read by AI Functions</div>
            <div className="mt-2 space-y-1.5">
              {(d?.notes ?? []).map((n) => (
                <div key={n.risk} className="flex items-center justify-between gap-2 text-[13px]">
                  <span>{n.risk} <span className="text-xs text-[var(--muted-foreground)]">· {pct(n.prevalence)} of notes</span></span>
                  <span className={cn('rounded px-1.5 py-0.5 font-mono text-[11px]', n.with_rate > n.without_rate * 1.3 ? 'bg-[#FDE7D6] text-[#9A3412]' : 'bg-[#EEF2F6] text-[#3B4B5E]')}>{pct(n.with_rate, 1)} vs {pct(n.without_rate, 1)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><MessagesSquare className="size-4 text-[var(--primary)]" />Ask the Copilot</div>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">Analytics go to Genie over the governed tables, pathway questions to the care-pathways assistant, patients to the risk model and the worklist.</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {script.map((s) => (
                <button key={s.prompt} onClick={() => dockController.openAndSend(s.prompt)}
                  className="flex items-center gap-2 rounded border border-[var(--border)] bg-white px-3 py-2 text-left text-[13px] hover:border-[var(--primary-light)]">
                  <Sparkles className="size-3.5 shrink-0 text-[var(--brand-4)]" />{s.prompt}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Care-team activity</div>
              {d && <span className="rounded bg-[#DCE8F7] px-1.5 py-0.5 font-mono text-[11px] text-[#1F4E8C]">{d.summary.open_tasks} open tasks</span>}
            </div>
            {activity.length === 0 && <div className="mt-2 text-[13px] text-[var(--muted-foreground)]">No transition plan yet. Open the worklist, pick the top 4 West patient and build a plan.</div>}
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                  <button onClick={() => nav('/outreach')} className="truncate text-left hover:underline">
                    <b>{ACTION[a.action] ?? a.action}</b> · {a.patient_name} <span className="text-[var(--muted-foreground)]">{a.notes ? `— ${a.notes}` : ''}</span>
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-sm font-semibold">What changed on 4 West</div>
            <ul className="mt-2 space-y-2">
              {(d?.events ?? []).map((e) => (
                <li key={e.event_date + e.event_type} className="rounded border border-[var(--border)] px-2.5 py-2 text-[13px]">
                  <div className="font-mono text-[11px] text-[var(--muted-foreground)]">{e.event_date} · {e.event_type.replace('_', ' ')}</div>
                  <div className="mt-0.5">{e.description}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
