/**
 * Home — a state caseworker system in the USWDS idiom. Keisha Jackson (State Surge
 * Team) is sent to clear Tamarack County's SNAP/Medicaid backlog. The page is the
 * surge team's working view: an official-status alert, the Tamarack case list with
 * each statutory clock, the county map coloured by days-to-determination, the SNAP
 * timeliness trend, the county scorecard, and the policy manual the copilot cites.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, BookOpen, FileText, Info } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchActivity, fetchCases, fetchSummary, fullName, type ActivityRow, type CaseRow, type Summary } from '@/cases/api';
import { cn, StatusPill } from '@/cases/ui';
import { CountyMap, type CountyScore } from './CountyMap';

type Trend = { month: string; tamarack_on_time_pct: number; rest_of_state_on_time_pct: number };

const CHAPTERS = [
  { ch: '01', title: 'Civil rights and performance' },
  { ch: '02', title: 'Application processing' },
  { ch: '03', title: 'Verification' },
  { ch: '04', title: 'Income and resources' },
  { ch: '05', title: 'Notices' },
  { ch: '07', title: 'Medicaid MAGI eligibility' },
];

const ACTION: Record<string, string> = { ai_check: 'AI check', approved: 'Approved', denied: 'Denied', rfi_sent: 'Documents requested', escalated: 'Escalated', notice_edited: 'Notice edited' };

/** Days left on the statutory clock (negative = past it). */
const remaining = (c: CaseRow) => c.standard_days - c.days_open;

function Clock({ days }: { days: number }) {
  const late = days < 0;
  const soon = !late && days <= 5;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-0.5 text-[12px] font-semibold',
        late && 'bg-[#B50909] text-white',
        soon && 'bg-[#FFBE2E] text-[#1B1B1B]',
        !late && !soon && 'bg-[#ECF3EC] text-[#1B4D1F]',
      )}
    >
      {late ? `${Math.abs(days)} days past` : `${days} days left`}
    </span>
  );
}

function TrendChart({ rows }: { rows: Trend[] }) {
  if (rows.length === 0) return <div className="h-56 animate-pulse rounded bg-[#F0F0F0]" />;
  const W = 640, H = 230, L = 40, B = 26, T = 12;
  const x = (i: number) => L + (i * (W - L - 16)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const line = (k: 'tamarack_on_time_pct' | 'rest_of_state_on_time_pct') =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(r[k])).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="SNAP on-time percentage by month, Tamarack vs rest of state">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 16} y1={y(v)} y2={y(v)} stroke="#DFE1E2" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#565C65">{v}%</text>
        </g>
      ))}
      <path d={line('rest_of_state_on_time_pct')} fill="none" stroke="#005EA2" strokeWidth="2.5" />
      <path d={line('tamarack_on_time_pct')} fill="none" stroke="#B50909" strokeWidth="2.5" strokeDasharray="6 4" />
      {rows.map((r, i) => (
        <g key={r.month}>
          <circle cx={x(i)} cy={y(Number(r.rest_of_state_on_time_pct))} r="3.5" fill="#005EA2"><title>{r.month}: rest of state {r.rest_of_state_on_time_pct}%</title></circle>
          <circle cx={x(i)} cy={y(Number(r.tamarack_on_time_pct))} r="3.5" fill="#B50909"><title>{r.month}: Tamarack {r.tamarack_on_time_pct}%</title></circle>
          {i % 2 === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#565C65">{String(r.month).slice(0, 7)}</text>}
        </g>
      ))}
    </svg>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [tam, setTam] = useState<Summary | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [scorecard, setScorecard] = useState<CountyScore[]>([]);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSummary('Tamarack').then(setTam).catch(() => {});
    fetchCases({ county: 'Tamarack', status: 'open' }).then(setCases).catch(() => setCases([]));
    fetchActivity(6).then(setActivity).catch(() => {});
  }, [tick]);
  useEffect(() => {
    fetch('/api/charts/county_scorecard')
      .then((r) => r.json() as Promise<{ data?: CountyScore[] }>)
      .then((b) => setScorecard(b.data ?? []))
      .catch(() => {});
    fetch('/api/charts/county_timeliness_trend')
      .then((r) => r.json() as Promise<{ data?: Trend[] }>)
      .then((b) => setTrend(b.data ?? []))
      .catch(() => {});
  }, []);

  const script = config?.assistantScript ?? [];
  // Most urgent first: past-deadline cases at the top, then by days left.
  const clock = useMemo(() => [...(cases ?? [])].sort((a, b) => remaining(a) - remaining(b)).slice(0, 8), [cases]);
  const pastDeadline = tam?.overdue ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] space-y-5 px-6 py-6">
        {/* page heading */}
        <section className="rounded border border-[#DFE1E2] bg-white p-6">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-[#565C65]">Westbrook Department of Human Services · Economic Assistance</div>
          <h1 className="mt-1 max-w-4xl text-[30px] font-bold leading-tight text-[#1B1B1B]">
            Tamarack’s families wait 38 days for food assistance the law says they should get in 30.
          </h1>
          <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-[#1B1B1B]">
            The paper mill closed, applications jumped 60%, and the county office lost 3 of its 7 caseworkers. Keisha Jackson from the State
            Surge Team has been sent in. The Eligibility Copilot reads each application’s documents and checks every rule against the policy
            manual, so she decides the cases rather than re-reading them.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => go(nav, '/cases/APP-240117')} className="inline-flex items-center gap-2 rounded bg-[#005EA2] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#1A4480]">
              Start with Dana Whitfield’s case <ArrowRight className="size-4" />
            </button>
            <button onClick={() => go(nav, '/cases')} className="rounded border-2 border-[#005EA2] px-5 py-2 text-[15px] font-semibold text-[#005EA2] hover:bg-[#E7F2FA]">Open my caseload</button>
            <button onClick={() => go(nav, '/dashboard')} className="rounded border-2 border-[#005EA2] px-5 py-2 text-[15px] font-semibold text-[#005EA2] hover:bg-[#E7F2FA]">Director dashboard</button>
          </div>
        </section>

        {/* USWDS alert: status of the county against the federal clock */}
        <section role="status" className="flex gap-3 rounded-r border-l-[6px] border-[#B50909] bg-[#F4E3DB] p-4 text-[15px]">
          <Info className="mt-0.5 size-5 shrink-0 text-[#B50909]" />
          <div>
            <div className="font-semibold">Tamarack is past the federal 30-day deadline on {pastDeadline} of {tam?.open ?? '…'} open cases.</div>
            <div className="text-[#3D4551]">
              {tam ? `${tam.expedited_late} expedited cases are past 7 days. Average age of an open case is ${tam.avg_days_open} days.` : 'Loading the county caseload…'}
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* case list with statutory clocks */}
          <section className="rounded border border-[#DFE1E2] bg-white">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#DFE1E2] px-5 py-3">
              <h2 className="text-[18px] font-bold">Tamarack open cases, most urgent first</h2>
              <span className="text-[13px] text-[#565C65]">{tam?.open ?? '…'} open · clock = days left on the statutory standard</span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-[#F0F0F0] text-left text-[13px] text-[#1B1B1B]">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Case</th>
                    <th className="px-4 py-2 font-semibold">Applicant</th>
                    <th className="px-4 py-2 font-semibold">Program</th>
                    <th className="px-4 py-2 font-semibold">Clock</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cases === null && [0, 1, 2].map((i) => (
                    <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#F0F0F0]" /></td></tr>
                  ))}
                  {clock.map((c) => (
                    <tr key={c.id} onClick={() => go(nav, `/cases/${c.id}`)} className="cursor-pointer border-t border-[#DFE1E2] hover:bg-[#F0F6FB]">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px] text-[#005EA2] underline underline-offset-2">{c.id}</td>
                      <td className="px-4 py-2.5">{fullName(c)}<div className="text-[12px] text-[#565C65]">{c.household_size}-person household · {c.preferred_language ?? 'English'}</div></td>
                      <td className="px-4 py-2.5">{c.program}{c.expedited_screening && <div className="text-[12px] font-semibold text-[#B50909]">Expedited</div>}</td>
                      <td className="px-4 py-2.5"><Clock days={remaining(c)} /><div className="mt-1 text-[12px] text-[#565C65]">day {c.days_open} of {c.standard_days}</div></td>
                      <td className="px-4 py-2.5"><StatusPill status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#DFE1E2] px-5 py-3 text-[14px]">
              <button onClick={() => go(nav, '/cases?scope=tamarack')} className="inline-flex items-center gap-1 font-semibold text-[#005EA2] underline underline-offset-2">View all Tamarack cases <ArrowRight className="size-3.5" /></button>
            </div>
          </section>

          {/* county map */}
          <section className="rounded border border-[#DFE1E2] bg-white p-5">
            <h2 className="text-[18px] font-bold">Days to a SNAP determination, by county</h2>
            <p className="mt-1 text-[13px] text-[#565C65]">Median days to determination, last three months. Circle size is the open caseload. Tamarack is outlined.</p>
            <div className="mt-3">
              {scorecard.length === 0 ? <div className="h-[340px] animate-pulse rounded bg-[#F0F0F0]" /> : <CountyMap rows={scorecard} />}
            </div>
            <p className="mt-2 text-[12px] text-[#565C65]">County office locations are illustrative placements for the fictional counties.</p>
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
          <section className="rounded border border-[#DFE1E2] bg-white p-5">
            <h2 className="text-[18px] font-bold">SNAP applications decided on time</h2>
            <p className="mt-1 text-[13px] text-[#565C65]">Share of determinations inside 30 days, by month: Tamarack (dashed red) against the rest of the state.</p>
            <div className="mt-3"><TrendChart rows={trend} /></div>
            <div className="mt-2 flex gap-5 text-[13px]">
              <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-6 bg-[#B50909]" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#B50909 0 6px,transparent 6px 10px)' }} />Tamarack</span>
              <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-6 bg-[#005EA2]" />Rest of state</span>
            </div>
          </section>

          <section className="rounded border border-[#DFE1E2] bg-white">
            <header className="border-b border-[#DFE1E2] px-5 py-3">
              <h2 className="text-[18px] font-bold">County scorecard</h2>
              <p className="text-[13px] text-[#565C65]">Last three months. Open cases per caseworker shows the backlog load.</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-[#F0F0F0] text-left text-[13px]">
                  <tr>
                    <th className="px-4 py-2 font-semibold">County</th>
                    <th className="px-4 py-2 text-right font-semibold">On time</th>
                    <th className="px-4 py-2 text-right font-semibold">Median days</th>
                    <th className="px-4 py-2 text-right font-semibold">Open / worker</th>
                    <th className="px-4 py-2 text-right font-semibold">Past deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scorecard].sort((a, b) => a.snap_on_time_pct - b.snap_on_time_pct).map((r) => (
                    <tr key={r.county} className={cn('border-t border-[#DFE1E2]', r.county === 'Tamarack' && 'bg-[#FBEAE7] font-semibold')}>
                      <td className="px-4 py-2">{r.county}<span className="ml-2 text-[12px] font-normal text-[#565C65]">{r.region_type}</span></td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.snap_on_time_pct}%</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.median_days}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.open_per_worker}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.overdue_cases}</td>
                    </tr>
                  ))}
                  {scorecard.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-[#565C65]">Loading the scorecard…</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="rounded border border-[#DFE1E2] bg-white p-5">
            <h2 className="flex items-center gap-2 text-[18px] font-bold"><BookOpen className="size-5 text-[#005EA2]" />Policy manual</h2>
            <p className="mt-1 text-[13px] text-[#565C65]">The copilot cites these chapters for every rule it checks.</p>
            <ul className="mt-3 divide-y divide-[#DFE1E2] border-y border-[#DFE1E2] text-[14px]">
              {CHAPTERS.map((c) => (
                <li key={c.ch} className="flex items-center gap-3 py-2">
                  <FileText className="size-4 shrink-0 text-[#565C65]" />
                  <span className="font-mono text-[12px] text-[#565C65]">Ch. {c.ch}</span>
                  <span>{c.title}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2">
              <div className="text-[13px] font-semibold">Ask the Copilot</div>
              {script.map((s) => (
                <button key={s.prompt} onClick={() => void dockController.openAndSend(s.prompt)} className="block w-full rounded border border-[#A9AEB1] px-3 py-2 text-left text-[14px] hover:border-[#005EA2] hover:bg-[#F0F6FB]">
                  {s.prompt}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded border border-[#DFE1E2] bg-white p-5">
            <h2 className="text-[18px] font-bold">Recent decisions and checks</h2>
            {activity.length === 0 && <p className="mt-2 text-[14px] text-[#565C65]">No decisions yet. Open a case and run the eligibility check.</p>}
            <ul className="mt-2 divide-y divide-[#DFE1E2] text-[14px]">
              {activity.map((a) => (
                <li key={`${a.at}-${a.case_id}-${a.action}`} className="flex items-center justify-between gap-3 py-2">
                  <button onClick={() => go(nav, `/cases/${a.case_id}`)} className="min-w-0 truncate text-left text-[#005EA2] underline underline-offset-2">
                    {ACTION[a.action] ?? a.action}: {a.applicant} <span className="text-[#565C65] no-underline">({a.program}, {a.county})</span>
                  </button>
                  <span className="shrink-0 text-[13px] text-[#565C65]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Navigate without leaving a floating promise in an event handler. */
function go(nav: ReturnType<typeof useNavigate>, to: string) {
  void nav(to);
}
