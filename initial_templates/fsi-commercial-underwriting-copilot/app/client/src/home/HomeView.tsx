/**
 * Home — the underwriting desk's morning board. Built like the carrier's own workbench, not a landing page:
 * a KPI ribbon, the hero submission's dossier (property & peril schedule + a map of its hail-belt locations), the
 * authority ladder that decides who signs, a rate-adequacy gauge for the old-roof habitational cell, the queue as a
 * dense log, and the desk's activity. Every number comes from the same endpoints the rest of the app uses.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { ArrowRight, FileWarning, Gauge, MapPin, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchActivity, fetchQueue, fetchSubmission, fetchSummary, money, musd, pct, shortDate, type ActivityRow, type QueueRow, type QueueSummary, type SubmissionDetail } from '@/uw/api';
import { BandPill, LanePill, StatusPill, cn } from '@/uw/ui';

const ACTION: Record<string, string> = { review_drafted: 'Review drafted', referred: 'Referred to CUO', approved: 'CUO approved', sent_back: 'Sent back', decided: 'Decision issued' };
const HERO = 'SUB-26-0417';
// Static lookup for the named hail-belt cities in the SOV (the data carries city + state, not coordinates).
const CITY_LATLNG: Record<string, [number, number]> = {
  'Plano, TX': [33.0198, -96.6989],
  'Frisco, TX': [33.1507, -96.8236],
  'Arlington, TX': [32.7357, -97.1081],
  'Fort Worth, TX': [32.7555, -97.3308],
};
const ROOF_OLD_YRS = 15;
const DFW_BOUNDS: [[number, number], [number, number]] = [[32.68, -97.42], [33.22, -96.62]];

type Trend = { quarter: string; portfolio_cell: string; loss_ratio: number };

function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const ts = [100, 400, 1000].map((ms) => window.setTimeout(() => { map.invalidateSize(); }, ms));
    return () => ts.forEach((t) => window.clearTimeout(t));
  }, [map]);
  return null;
}

/** Semi-circular gauge: the current old-roof loss ratio on a 0–180% scale, with the rest-of-book average as the tick. */
function Gauge180({ value, benchmark }: { value: number; benchmark: number }) {
  const max = 1.8;
  const ang = (v: number) => Math.PI * (1 - Math.min(v, max) / max);
  const pt = (v: number, r: number) => [60 + r * Math.cos(ang(v)), 62 - r * Math.sin(ang(v))];
  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = pt(from, r);
    const [x2, y2] = pt(to, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const [nx, ny] = pt(value, 44);
  const [bx1, by1] = pt(benchmark, 50);
  const [bx2, by2] = pt(benchmark, 36);
  return (
    <svg viewBox="0 0 120 74" className="w-full max-w-[230px]" role="img" aria-label={`Loss ratio ${Math.round(value * 100)} percent against a ${Math.round(benchmark * 100)} percent book benchmark`}>
      <path d={arc(0, max, 52)} fill="none" stroke="var(--muted)" strokeWidth="9" />
      <path d={arc(0, benchmark, 52)} fill="none" stroke="var(--brand-3)" strokeWidth="9" />
      <path d={arc(benchmark, max, 52)} fill="none" stroke="var(--brand-5)" strokeWidth="9" opacity="0.85" />
      <line x1={bx1} y1={by1} x2={bx2} y2={by2} stroke="var(--brand-1)" strokeWidth="2" />
      <line x1={60} y1={62} x2={nx} y2={ny} stroke="var(--brand-1)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={60} cy={62} r="4" fill="var(--brand-1)" />
    </svg>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [s, setS] = useState<QueueSummary | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [hero, setHero] = useState<SubmissionDetail | null>(null);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSummary().then(setS).catch(() => {});
    fetchQueue().then(setQueue).catch(() => {});
    fetchActivity(6).then(setActivity).catch(() => {});
    fetchSubmission(HERO).then(setHero).catch(() => {});
  }, [tick]);
  useEffect(() => {
    fetch('/api/charts/hail_belt_roof_split').then((r) => (r.ok ? r.json() : { data: [] })).then((j: { data?: Trend[] }) => setTrend(j.data ?? [])).catch(() => {});
  }, []);

  const script = config?.assistantScript ?? [];
  const heroRow = queue.find((q) => q.id === HERO);
  const old = trend.filter((t) => t.portfolio_cell === 'Roof > 15 yrs');
  const book = trend.filter((t) => t.portfolio_cell === 'Rest of book');
  const lastOld = old.at(-1)?.loss_ratio;
  const bookAvg = book.length ? book.reduce((a, t) => a + Number(t.loss_ratio), 0) / book.length : null;
  const mapPoints = useMemo(() => (hero?.locations ?? []).map((l) => ({ l, ll: CITY_LATLNG[`${l.city}, ${l.state}`] })).filter((p) => p.ll), [hero]);
  const lanesOrdered = [...(s?.lanes ?? [])].sort((a, b) => b.tiv - a.tiv);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* Masthead + KPI ribbon */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Tidewell Specialty Insurance · Underwriting desk · Mon 28 Sep 2026</div>
            <h1 className="mt-1 max-w-4xl font-display text-[28px] font-semibold leading-tight text-[var(--primary)]">
              Hail-belt apartments with old roofs now run a {lastOld != null ? `${Math.round(lastOld * 100)}%` : '…'} loss ratio. {s?.submissions ?? 24} submissions are waiting, and the applications don’t show which are old roofs.
            </h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => nav('/queue')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium hover:border-[var(--primary-light)]">Submission queue</button>
            <button onClick={() => nav('/dashboard')} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium hover:border-[var(--primary-light)]">Portfolio dashboard</button>
          </div>
        </header>

        <section className="grid grid-cols-2 divide-x divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] md:grid-cols-3 xl:grid-cols-6">
          {s ? (
            <>
              <Cell label="In the queue" value={s.submissions} sub={`${musd(s.tiv)} TIV`} />
              <Cell label="Documents disagree" value={s.documents_disagree} sub="with the application" tone="bad" />
              <Cell label="Low on paper, high verified" value={s.hidden_high_risk} sub="risk model" tone="bad" />
              <Cell label="Fast track" value={s.fast_track} sub="clean, within authority" />
              <Cell label="Effective in 3 weeks" value={s.effective_3wks} sub="need a decision now" />
              <Cell label="With the CUO" value={s.referred} sub={`${s.drafted} reviews drafted`} tone={s.referred ? 'warn' : undefined} />
            </>
          ) : (
            [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[78px] animate-pulse bg-[var(--muted)]/50" />)
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          {/* Dossier: the hero account's property & peril schedule */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Dossier · {HERO} · Habitational · TX</div>
                <div className="font-display text-xl font-semibold text-[var(--primary)]">{heroRow?.insured_name ?? 'Lone Star Residential Partners LP'}</div>
                <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {heroRow?.broker_name ?? 'Broker'} · effective {shortDate(heroRow?.effective_date)}{heroRow?.days_to_effective != null ? ` (${heroRow.days_to_effective} days)` : ''} · TIV {musd(heroRow?.sov_tiv)}
                </div>
              </div>
              <div className="flex gap-2">
                <RiskTile label="Risk as submitted" p={heroRow?.p_as_submitted} band={heroRow?.band_as_submitted} />
                <RiskTile label="Verified on the documents" p={heroRow?.p_verified} band={heroRow?.band_verified} alert />
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Property &amp; peril schedule · from the SOV</div>
                <span className="text-xs text-[var(--muted-foreground)]">roof &gt; {ROOF_OLD_YRS} yrs is out of appetite in the hail belt</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr className="border-b border-[var(--border)]">
                    {['Loc', 'City', 'Construction', 'Roof', 'Sprinklered', 'PC', 'TIV'].map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(hero?.locations ?? []).map((l) => {
                    const old = (l.roofAgeYears ?? 0) > ROOF_OLD_YRS;
                    return (
                      <tr key={l.id} className="border-b border-[var(--border)]/70 last:border-0">
                        <td className="px-2 py-2 tabular-nums text-[var(--muted-foreground)]">{String(l.locNo).padStart(2, '0')}</td>
                        <td className="px-2 py-2"><div className="font-medium">{l.city}, {l.state}</div><div className="text-[11px] text-[var(--muted-foreground)]">{l.buildingName}</div></td>
                        <td className="px-2 py-2 text-xs">{l.construction}{l.stories ? ` · ${l.stories} st.` : ''}</td>
                        <td className="px-2 py-2">
                          <span className={cn("whitespace-nowrap tabular-nums font-semibold", old ? "text-[var(--brand-5)]" : "")}>{l.roofAgeYears ?? '—'} yrs</span>
                          {old && <span className="mt-1 block w-fit whitespace-nowrap rounded bg-[#F6E4DE] px-1 py-px text-[10px] font-semibold text-[var(--brand-5)]">out of appetite</span>}
                        </td>
                        <td className="px-2 py-2 text-xs">{l.sprinklered ? 'Yes' : <span className="font-semibold text-[var(--brand-5)]">No</span>}</td>
                        <td className="px-2 py-2 tabular-nums text-xs">{l.protectionClass ?? '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{musd(l.tiv)}</td>
                      </tr>
                    );
                  })}
                  {!hero && <tr><td colSpan={7} className="px-2 py-6 text-center text-xs text-[var(--muted-foreground)]">Loading the schedule…</td></tr>}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <FileWarning className="size-3.5 text-[var(--brand-5)]" />
                  {heroRow?.discrepancy_count ?? '…'} discrepancies between the application, the SOV and the loss runs
                </div>
                <button onClick={() => nav(`/submissions/${HERO}`)} className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                  Open the workbench <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          </section>

          {/* Map of the hero's locations, plus the authority ladder */}
          <div className="grid gap-4">
            <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <div className="relative z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold"><MapPin className="size-4 text-[var(--primary-light)]" />DFW hail-belt locations</div>
                <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="inline-block size-2.5 rounded-full bg-[var(--brand-5)]" />roof &gt; 15 yrs</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="inline-block size-2.5 rounded-full bg-[var(--primary)]" />newer roof</span>
                </div>
              </div>
              <div className="h-[300px]">
                {(
                  <MapContainer bounds={DFW_BOUNDS} boundsOptions={{ padding: [40, 40], maxZoom: 10, animate: false }} scrollWheelZoom={false} className="h-full w-full" attributionControl>
                    <InvalidateOnMount />
                    <TileLayer
                      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      maxZoom={19}
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                    {mapPoints.map(({ l, ll }) => {
                      const old = (l.roofAgeYears ?? 0) > ROOF_OLD_YRS;
                      return (
                        <CircleMarker key={l.id} center={ll} radius={old ? 9 : 7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: old ? '#A4432F' : '#15305A', fillOpacity: 0.95 }}>
                          <Tooltip permanent direction="top" offset={[0, -8]}>{String(l.locNo).padStart(2, "0")}</Tooltip>
                        </CircleMarker>
                      );
                    })}
                  </MapContainer>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-sm font-semibold">Who signs</div>
              <div className="mt-2 space-y-0">
                {[
                  { who: 'Chief Underwriting Officer', name: 'Marcus Oyelaran', rule: 'Above $25M TIV after exclusions, or any appetite referral', tone: 'top' },
                  { who: 'Senior underwriter', name: 'Dana Whitfield', rule: 'Up to $25M TIV, inside the appetite bulletin', tone: 'mid' },
                  { who: 'Underwriting copilot', name: 'Reads, scores, prices, drafts', rule: 'Every packet read from the documents first', tone: 'base' },
                ].map((r, i) => (
                  <div key={r.who} className="grid grid-cols-[14px_1fr_auto] items-start gap-3 border-l-2 py-2 pl-3" style={{ borderColor: i === 0 ? 'var(--brand-4)' : i === 1 ? 'var(--primary-light)' : 'var(--border)' }}>
                    <span className="-ml-[21px] mt-1 size-2.5 rounded-full" style={{ background: i === 0 ? 'var(--brand-4)' : i === 1 ? 'var(--primary-light)' : 'var(--muted-foreground)' }} />
                    <div>
                      <div className="text-xs text-[var(--muted-foreground)]">{r.who}</div>
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">{r.rule}</div>
                    </div>
                    {r.tone === 'top' && heroRow && <span className="rounded bg-[#F6EBD2] px-1.5 py-0.5 text-[10px] font-semibold text-[#6E5014]">{musd(heroRow.sov_tiv)} submitted</span>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
          {/* Rate adequacy */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-[var(--primary-light)]" />Rate adequacy · roofs over 15 years</div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]">Hail-belt habitational loss ratio, latest accident quarter, against the rest-of-book average.</div>
            <div className="mt-2 flex items-end gap-4">
              <div className="flex-1"><Gauge180 value={Number(lastOld ?? 0)} benchmark={bookAvg ?? 0.58} /></div>
              <div className="pb-1 text-right">
                <div className="font-display text-3xl font-semibold tabular-nums text-[var(--brand-5)]">{lastOld != null ? pct(lastOld) : '…'}</div>
                <div className="text-xs text-[var(--muted-foreground)]">book average {bookAvg != null ? pct(bookAvg) : '…'}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-8 items-end gap-1" style={{ height: 46 }}>
              {old.map((t) => (
                <div key={t.quarter} title={`${t.quarter} ${pct(t.loss_ratio)}`} className="rounded-sm" style={{ height: `${Math.min(1, Number(t.loss_ratio) / 1.8) * 100}%`, background: Number(t.loss_ratio) > (bookAvg ?? 0.58) ? 'var(--brand-5)' : 'var(--brand-3)' }} />
              ))}
            </div>
            <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">eight quarters, oldest left</div>
          </section>

          {/* Ask */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><MessagesSquare className="size-4 text-[var(--primary-light)]" />Ask the desk</div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Portfolio and guideline questions go to the Genie agent (governed tables + guideline documents). Submissions go to the live queue.</p>
            <div className="mt-3 flex flex-col gap-2">
              {script.map((c) => (
                <button key={c.prompt} onClick={() => dockController.openAndSend(c.prompt)} className="flex items-start gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-left text-[13px] leading-snug hover:border-[var(--primary-light)]">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-4)]" />{c.prompt}
                </button>
              ))}
            </div>
          </section>

          {/* Desk activity */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-4">
            <div className="text-sm font-semibold">Desk activity</div>
            {activity.length === 0 && <div className="mt-2 text-xs text-[var(--muted-foreground)]">Nothing reviewed yet. Open Lone Star Residential Partners and run the underwriting review.</div>}
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {activity.map((a) => (
                <li key={`${a.submission_id}-${a.at}`} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <button onClick={() => nav(`/submissions/${a.submission_id}`)} className="truncate text-left hover:underline">
                    <b className="font-semibold">{ACTION[a.action] ?? a.action}</b> <span className="text-[var(--muted-foreground)]">· {a.insured_name}</span>
                  </button>
                  <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Submission log */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <div className="text-sm font-semibold">Submission log · top of the queue</div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              {lanesOrdered.map((l) => <span key={l.triage_lane} className="rounded border border-[var(--border)] px-1.5 py-0.5">{l.triage_lane.replace(' - ', ' · ')} <b className="text-[var(--foreground)]">{l.n}</b> · {musd(l.tiv)}</span>)}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr className="border-b border-[var(--border)]">
                {['Pri', 'Insured', 'Segment', 'TIV', 'Risk as submitted', 'Risk verified', 'Lane', 'Desk'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {queue.slice(0, 8).map((q) => (
                <tr key={q.id} onClick={() => nav(`/submissions/${q.id}`)} className="cursor-pointer border-b border-[var(--border)]/70 last:border-0 hover:bg-[var(--muted)]/60">
                  <td className="px-3 py-2 tabular-nums text-xs text-[var(--muted-foreground)]">{Math.round(q.priority_score)}</td>
                  <td className="px-3 py-2"><div className="font-semibold">{q.insured_name}</div><div className="text-[11px] text-[var(--muted-foreground)]">{q.id} · {q.state}</div></td>
                  <td className="px-3 py-2 text-xs">{q.segment}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{musd(q.sov_tiv)}</td>
                  <td className="px-3 py-2"><BandPill band={q.band_as_submitted} p={q.p_as_submitted} /></td>
                  <td className="px-3 py-2"><BandPill band={q.band_verified} p={q.p_verified} /></td>
                  <td className="px-3 py-2"><LanePill lane={q.triage_lane} /></td>
                  <td className="px-3 py-2"><StatusPill status={q.status} />{q.review_premium != null && q.status !== 'new' && <div className="text-[11px] text-[var(--muted-foreground)]">{money(q.review_premium)}</div>}</td>
                </tr>
              ))}
              {queue.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">Loading the queue…</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-0.5 font-display text-[26px] font-semibold leading-none tabular-nums', tone === 'bad' && 'text-[var(--brand-5)]', tone === 'warn' && 'text-[var(--severity-warning)]')}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

function RiskTile({ label, p, band, alert }: { label: string; p?: number | null; band?: string | null; alert?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2 text-right">
      <div className="text-[10.5px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('font-display text-xl font-semibold tabular-nums', alert && 'text-[var(--brand-5)]')}>{p != null ? pct(p, 1) : '…'}</div>
      <div className="mt-0.5"><BandPill band={band ?? null} /></div>
    </div>
  );
}
