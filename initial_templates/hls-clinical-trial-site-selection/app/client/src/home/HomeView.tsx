/**
 * Home — a feasibility console for CASCADE-CKD, Halcyra's Phase III study that has randomized
 * ~55% of its planned patients. Layout is the study manager's working view: the site map is the
 * signature visual, the enrollment curve sits against plan, and the protocol criteria are chips
 * with their assumed pass rates. Numbers come from the same Delta/Lakebase endpoints as the rest of the app.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchActivity, fetchOpsSummary, fetchOverview, fetchPortfolio, fetchSites, monthLabel, n0, pct, type ActivityRow, type Criterion, type OpsSummary, type Overview, type PortfolioRow, type SiteRow } from '@/trials/api';
import { EnrollmentChart } from '@/trials/charts';
import { Pill, cn } from '@/trials/ui';
import { SiteLegend, SiteMap, SITE_COLORS, siteColor } from '@/sites/SiteMap';

const TRIAL = 'CASCADE-CKD';
const ACTION: Record<string, string> = {
  ai_analysis: 'AI rescue analysis', approved: 'Rescue plan approved', rejected: 'Rescue plan rejected', memo_edited: 'Memo edited',
  activation_requested: 'Rescue sites sent to start-up', closure_review: 'Closure review opened',
};

function Cell({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-0.5 font-mono text-2xl font-semibold tabular-nums', tone === 'bad' && 'text-[var(--brand-5)]', tone === 'warn' && 'text-[var(--severity-warning)]')}>{value}</div>
      {sub && <div className="text-xs text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

function CriterionChip({ c }: { c: Criterion }) {
  const pass = c.feasibility_assumed_pass_rate;
  return (
    <span
      title={c.criterion_text}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
        c.criterion_type === 'exclusion' ? 'border-[#C7CFDE] bg-white text-[var(--foreground)]' : 'border-[#C7D2FE] bg-[#EEF2FF] text-[#312E81]',
        c.amendable && 'border-dashed border-[var(--brand-4)]',
      )}
    >
      <span className="font-mono font-semibold">{c.criterion_id}</span>
      <span>{c.short_name}</span>
      {pass != null && <span className="font-mono tabular-nums text-[var(--muted-foreground)]">{pct(pass)}</span>}
    </span>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [port, setPort] = useState<PortfolioRow[] | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchPortfolio().then(setPort).catch(() => {});
    fetchOverview(TRIAL).then(setOv).catch(() => {});
    fetchSites('all').then(setSites).catch(() => {});
    fetchOpsSummary().then(setOps).catch(() => {});
    fetchActivity(6).then(setActivity).catch(() => {});
  }, [tick]);

  const script = config?.assistantScript ?? [];
  const cascade = port?.find((p) => p.trial_id === TRIAL);
  const counts = useMemo(() => {
    const c: Partial<Record<keyof typeof SITE_COLORS, number>> = { active: 0, zero: 0, rescue: 0, candidate: 0, activated: 0, closure: 0 };
    for (const s of sites ?? []) {
      const k = siteColor(s);
      const key = (Object.keys(SITE_COLORS) as Array<keyof typeof SITE_COLORS>).find((x) => SITE_COLORS[x] === k);
      if (key) c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [sites]);
  const criteria = (ov?.criteria ?? []).filter((c) => c.criterion_type !== 'other');
  const inclusion = criteria.filter((c) => c.criterion_type === 'inclusion');
  const exclusion = criteria.filter((c) => c.criterion_type === 'exclusion');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* Study header — identity + the one-sentence situation, no hero block */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="rounded bg-[var(--primary)] px-1.5 py-0.5 font-mono font-semibold text-white">{TRIAL}</span>
              <span>Phase III · Nephrology · Diabetic kidney disease (T2D + CKD)</span>
              <span className="font-mono">HAL-301 v3.0</span>
            </div>
            <h1 className="mt-2 text-xl font-semibold leading-snug text-[var(--foreground)]">
              {cascade && ov ? `${n0(cascade.randomized)} of the ${n0(cascade.planned_to_date)} patients planned by now are randomized.` : 'Loading the study…'}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
              The sites say the patients are hard; the EDC says “other”. The Trial Site Copilot reads the coordinator notes, asks the protocol,
              scores every candidate site and drafts the rescue plan. Dr. Elena Marsh approves it.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {cascade && <Pill tone={cascade.pct_of_plan < 0.8 ? 'bad' : 'good'}>{pct(cascade.pct_of_plan)} of plan</Pill>}
            <button onClick={() => nav(`/trials/${TRIAL}`)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90">
              Open the workbench <ArrowRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Metric strip — one bordered bar, tabular numerals */}
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
          <Cell label="Randomized" value={cascade ? n0(cascade.randomized) : '…'} sub={cascade ? `of ${n0(cascade.planned_to_date)} planned to date` : undefined} />
          <Cell label="Target" value={cascade ? n0(cascade.target_enrollment) : '…'} sub={cascade ? `last patient in planned ${monthLabel(cascade.planned_lpi_date)}` : undefined} />
          <Cell label="Screen-fail rate" value={cascade ? pct(cascade.screen_fail_rate) : '…'} tone="bad" sub={cascade ? `${pct(cascade.planned_screen_fail_rate)} assumed` : undefined} />
          <Cell label="Active sites" value={cascade?.active_sites ?? '…'} sub={`${ops?.zero_enrollers ?? '…'} with zero randomized`} tone={ops && ops.zero_enrollers > 0 ? 'warn' : undefined} />
          <Cell label="Rescue candidates" value={ops?.rescue_candidates ?? '…'} sub="model-ranked, no competing trial" />
          <Cell label="Plans approved" value={ops?.approved ?? '…'} sub={`${ops?.activation_requested ?? 0} sites sent to start-up`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
          {/* Signature visual: the feasibility map */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-semibold">Site feasibility · {sites ? n0(sites.length) : '…'} sites in the network</div>
              <button onClick={() => nav('/sites')} className="text-xs font-medium text-[var(--primary)] hover:underline">Open the site network →</button>
            </div>
            {sites ? <SiteMap sites={sites} height={440} /> : <div className="h-[440px] animate-pulse rounded-xl bg-[var(--muted)]" />}
            <div className="mt-3 flex flex-col gap-2">
              <SiteLegend counts={counts} />
              <p className="text-[11px] text-[var(--muted-foreground)]">Marker size = expected enrollment (predicted rate for candidates, observed rate for active sites).</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-baseline justify-between">
                <div className="font-semibold">Protocol criteria</div>
                <div className="text-xs text-[var(--muted-foreground)]">chip = assumed pass rate</div>
              </div>
              {ov ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Inclusion</div>
                    <div className="flex flex-wrap gap-1.5">{inclusion.map((c) => <CriterionChip key={c.criterion_id} c={c} />)}</div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Exclusion</div>
                    <div className="flex flex-wrap gap-1.5">{exclusion.map((c) => <CriterionChip key={c.criterion_id} c={c} />)}</div>
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)]">Dashed amber = flagged amendable in the protocol model. Each change is weighed in the workbench.</p>
                </div>
              ) : <div className="mt-3 h-24 animate-pulse rounded-lg bg-[var(--muted)]" />}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">Cumulative randomized vs plan</div>
              <div className="text-xs text-[var(--muted-foreground)]">dashed = plan · dotted = target</div>
            </div>
            {ov && cascade ? (
              <div className="mt-2">
                <EnrollmentChart curve={ov.curve} plan={ov.plan} target={cascade.target_enrollment} plannedLpi={cascade.planned_lpi_date} height={260} />
              </div>
            ) : <div className="mt-2 h-[260px] animate-pulse rounded-lg bg-[var(--muted)]" />}
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="font-semibold">Portfolio — randomized vs plan</div>
            <div className="mt-3 space-y-2.5">
              {(port ?? []).map((p) => (
                <button key={p.trial_id} onClick={() => p.trial_id === TRIAL && nav(`/trials/${TRIAL}`)}
                  className={cn('grid w-full grid-cols-[120px_1fr_96px] items-center gap-3 text-left text-sm', p.trial_id === TRIAL ? 'hover:opacity-80' : 'cursor-default')}>
                  <span className="min-w-0">
                    <span className={cn('block truncate', p.pct_of_plan < 0.8 ? 'font-semibold text-[var(--brand-5)]' : 'font-medium')}>{p.acronym}</span>
                    <span className="block truncate text-[11px] text-[var(--muted-foreground)]">{p.phase}</span>
                  </span>
                  <div className="relative h-2 rounded-full bg-[var(--muted)]">
                    <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (p.pct_of_plan * 100) / 1.1)}%`, background: p.pct_of_plan < 0.8 ? 'var(--brand-5)' : 'var(--primary-light)' }} />
                    <div className="absolute -inset-y-1 w-px bg-[var(--foreground)]" style={{ left: `${100 / 1.1}%` }} title="plan" />
                  </div>
                  <span className="text-right font-mono text-xs tabular-nums text-[var(--muted-foreground)]"><b className="text-[var(--foreground)]">{pct(p.pct_of_plan)}</b></span>
                </button>
              ))}
              {!port && [0, 1, 2, 3, 4].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-[var(--muted)]" />)}
            </div>
          </div>

        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2 font-semibold"><MessagesSquare className="size-4 text-[var(--primary-light)]" />Ask the Copilot</div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Portfolio questions go to Genie over the governed tables; protocol questions to the protocol assistant; site questions to the model scores.</p>
            <div className="mt-3 flex flex-col gap-2">
              {script.map((s) => (
                <button key={s.prompt} onClick={() => dockController.openAndSend(s.prompt)}
                  className="flex items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm hover:border-[var(--primary-light)]">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-4)]" />{s.prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="font-semibold">Workbench activity</div>
            {activity.length === 0 && <div className="mt-2 text-sm text-[var(--muted-foreground)]">No rescue plan yet — open the workbench and run the analysis.</div>}
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <button onClick={() => nav(`/trials/${a.trial_id}`)} className="min-w-0 truncate text-left hover:underline">
                    <b className="font-medium">{ACTION[a.action] ?? a.action}</b> <span className="text-[var(--muted-foreground)]">{a.trial_id}{a.notes ? ` · ${a.notes}` : ''}</span>
                  </button>
                  <span className="shrink-0 font-mono text-xs text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
