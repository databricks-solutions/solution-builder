/**
 * Site network — every investigator site in Halcyra's feasibility network for CASCADE-CKD
 * (Lakebase mirror of Delta: gold_site_performance + site_scores), on a US map and in a
 * table. Active sites show performance; candidates show site_enrollment_model@champion
 * scores; the study manager's actions (activation requested / closure review) appear live.
 */
import { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchSites, n0, pct, type SiteRow } from '@/trials/api';
import { Pill, cn } from '@/trials/ui';
import { SiteLegend, SiteMap } from './SiteMap';

const TABS = [
  { key: 'active', label: 'Active in CASCADE-CKD' },
  { key: 'candidates', label: 'Rescue candidates (model-ranked)' },
  { key: 'actions', label: 'Study-manager actions' },
] as const;

const OPS: Record<string, { label: string; tone: 'good' | 'bad' | 'info' | 'neutral' }> = {
  activation_requested: { label: 'Activation requested', tone: 'good' },
  closure_review: { label: 'Closure review', tone: 'bad' },
};

export function SiteNetworkView() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('active');
  const [all, setAll] = useState<SiteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => { fetchSites('all').then(setAll).catch((e) => setErr((e as Error).message)); }, [tick]);

  const rows = useMemo(() => {
    const r = all ?? [];
    if (tab === 'active') return r.filter((s) => s.cascadeStatus !== 'candidate').sort((a, b) => (b.metrics.randomized ?? -1) - (a.metrics.randomized ?? -1));
    if (tab === 'candidates') return r.filter((s) => s.cascadeStatus === 'candidate' && s.metrics.rescue_eligible).sort((a, b) => (a.metrics.rescue_rank ?? 999) - (b.metrics.rescue_rank ?? 999));
    return r.filter((s) => s.opsStatus !== 'none');
  }, [all, tab]);
  const counts = {
    active: (all ?? []).filter((s) => s.cascadeStatus === 'active').length,
    zero: (all ?? []).filter((s) => s.metrics.is_zero_enroller).length,
    cand: (all ?? []).filter((s) => s.cascadeStatus === 'candidate' && s.metrics.rescue_eligible).length,
    actions: (all ?? []).filter((s) => s.opsStatus !== 'none').length,
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">CASCADE-CKD · feasibility network</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Site network</h1>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SiteLegend counts={{ active: counts.active, zero: counts.zero, rescue: counts.cand, activated: (all ?? []).filter((s) => s.opsStatus === 'activation_requested').length, closure: (all ?? []).filter((s) => s.opsStatus === 'closure_review').length }} />
            </div>
            <SiteMap sites={all ?? []} height={460} />
          </div>
          {err && <div className="text-sm text-[var(--destructive)]">Could not load sites: {err}</div>}
          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-relaxed">
              <div className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-[var(--primary-light)]" />Where the patients are — and where we are</div>
              <p className="mt-2 text-[var(--muted-foreground)]">
                The 2023 feasibility put ~60% of sites in the Southeast and South Central regions for disease prevalence. That is exactly where
                Nephrexa’s REDWOOD-CKD opened in January — and it allows stable SGLT2 inhibitors, which CASCADE-CKD excludes. The model’s rescue
                list favours central-IRB sites with deep amended-eligible pools and no competing DKD trial — half of the top 15 are in the Midwest and
                Mountain West, where the original plan barely looked.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Rescue candidates</div><div className="text-2xl font-semibold">{counts.cand}</div></div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"><div className="text-[11px] uppercase text-[var(--muted-foreground)]">Actions taken</div><div className="text-2xl font-semibold">{counts.actions}</div></div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('rounded-lg px-3 py-1.5 text-sm', tab === t.key ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] bg-[var(--card)]')}>{t.label}</button>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          {err && <div className="p-4 text-sm text-[var(--destructive)]">Could not load sites: {err}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              {tab === 'candidates'
                ? <tr>{['Rank', 'Site', 'IRB', 'Eligible today → amended', 'Track record', 'Predicted /mo (today → amended)', 'Active in', 'Exp. 12 mo', 'Status'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
                : <tr>{['Site', 'Status', 'IRB', 'Months active', 'Screened', 'Randomized', 'Per month', 'Screen-fail', 'Competing trial', 'Action'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>}
            </thead>
            <tbody>
              {!all && !err && <tr><td colSpan={10} className="p-4"><div className="h-24 animate-pulse rounded bg-[var(--muted)]" /></td></tr>}
              {all && rows.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-[var(--muted-foreground)]">No actions yet — approve a rescue plan in the CASCADE-CKD workbench.</td></tr>}
              {rows.map((s) => {
                const m = s.metrics;
                const ops = OPS[s.opsStatus];
                return tab === 'candidates' ? (
                  <tr key={s.siteId} className="border-t border-[var(--border)]" title={m.score_rationale ?? ''}>
                    <td className="px-4 py-2 tabular-nums">{m.rescue_rank}</td>
                    <td className="px-4 py-2"><div className="font-medium">{s.siteName}</div><div className="text-xs text-[var(--muted-foreground)]">{s.city}, {s.state} · {s.region}</div></td>
                    <td className="px-4 py-2"><Pill tone={s.irbType === 'central' ? 'info' : 'warn'}>{s.irbType}</Pill></td>
                    <td className="px-4 py-2 tabular-nums">{n0(m.eligible_current_protocol)} → <b>{n0(m.eligible_amended_e4)}</b></td>
                    <td className="px-4 py-2 tabular-nums">{m.hist_rate_per_month?.toFixed(2)}/mo</td>
                    <td className="px-4 py-2 tabular-nums">{m.predicted_rate_current?.toFixed(2)} → <b>{m.predicted_rate_amended?.toFixed(2)}</b></td>
                    <td className="px-4 py-2 tabular-nums">{m.est_activation_months} mo</td>
                    <td className="px-4 py-2 tabular-nums">{m.expected_randomized_12m}</td>
                    <td className="px-4 py-2">{ops ? <Pill tone={ops.tone}>{ops.label}</Pill> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                  </tr>
                ) : (
                  <tr key={s.siteId} className={cn('border-t border-[var(--border)]', m.is_zero_enroller && 'bg-[#FDF1EE]')}>
                    <td className="px-4 py-2"><div className="font-medium">{s.siteName}</div><div className="text-xs text-[var(--muted-foreground)]">{s.city}, {s.state} · {m.principal_investigator ?? ''}</div></td>
                    <td className="px-4 py-2"><Pill tone={s.cascadeStatus === 'active' ? (m.is_zero_enroller ? 'bad' : 'good') : s.cascadeStatus === 'candidate' ? 'info' : 'warn'}>{m.is_zero_enroller ? 'zero enroller' : s.cascadeStatus.replace('_', ' ')}</Pill></td>
                    <td className="px-4 py-2"><Pill tone={s.irbType === 'central' ? 'info' : 'warn'}>{s.irbType}</Pill></td>
                    <td className="px-4 py-2 tabular-nums">{m.months_active ?? (m.days_in_startup ? `start-up ${m.days_in_startup} d` : '—')}</td>
                    <td className="px-4 py-2 tabular-nums">{m.screened ?? '—'}</td>
                    <td className="px-4 py-2 tabular-nums font-semibold">{m.randomized ?? '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{m.randomized_per_month ?? '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{m.screen_fail_rate != null ? pct(m.screen_fail_rate) : '—'}</td>
                    <td className="px-4 py-2">{m.competing_trial ? <Pill tone="bad">{m.competing_trial}</Pill> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                    <td className="px-4 py-2">{ops ? <Pill tone={ops.tone}>{ops.label}</Pill> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
