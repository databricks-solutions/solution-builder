/** Trial workbench API client + shared types (mirrors server shapes). */
import { okOrThrow } from '@/lib/api';
import type { ProjectionParams, Scenario } from '../../../shared/projection';

export type PortfolioRow = {
  trial_id: string; acronym: string; phase: string; therapeutic_area: string; indication: string; target_enrollment: number;
  planned_lpi_date: string; study_manager: string; randomized: number; planned_to_date: number; pct_of_plan: number;
  active_sites: number; screen_fail_rate: number; planned_screen_fail_rate: number;
};
export type CurvePoint = { month_start: string; month_number: number; randomized: number; cum_randomized: number; planned_cum_randomized: number; screened: number; screen_failed: number; active_sites: number; is_complete_month: boolean };
export type ScreenFailRow = { criterion_id: string; criterion_name: string; n: number; coded: number; ai: number; stable_sglt2i: number; n_first6: number; n_last6: number };
export type Funnel = { t2d_ckd: number; egfr: number; uacr: number; hba1c: number; on_sglt2i: number; stable_sglt2i: number; eligible_current: number; eligible_amended: number; pct_on_sglt2i: number; sites: number };
export type Criterion = { criterion_id: string; criterion_type: string; short_name: string; criterion_text: string; feasibility_assumed_pass_rate: number | null; amendable: boolean; rationale: string | null };
export type Overview = {
  trial: PortfolioRow; curve: CurvePoint[]; plan: Array<{ month_start: string; month_number: number; planned_cum_randomized: number }>;
  screenFails: ScreenFailRow[]; coded: Array<{ coded_reason: string; n: number }>; e4Trend: Array<{ quarter: string; e4_share: number; failures: number }>;
  funnel: Funnel; sglt2Trend: Array<{ quarter: string; pct_on_sglt2i: number }>;
  competition: { acronym: string; sponsor: string; start_date: string; sites: number; rate_before: number; rate_since: number; rate_others_since: number; overlap_note: string } | null;
  activation: Array<{ irb_type: string; site_type: string; sites: number; median_days: number; avg_days: number }>; criteria: Criterion[];
};
export type RescueSite = {
  site_id: string; site_name: string; city: string | null; state: string | null; irb_type: string | null; eligible_current: number;
  eligible_amended: number; predicted_rate_amended: number; est_activation_months: number; expected_randomized_12m: number; hist_rate: number;
  rationale: string; selected: boolean;
};
export type Analysis = {
  trial_id: string; as_of: string;
  enrollment: { randomized: number; planned_to_date: number; target: number; pct_of_plan: number; run_rate_3m: number; planned_lpi: string; months_left: number; active_sites: number; screen_fail_rate: number; planned_screen_fail_rate: number };
  screen_fails: { total: number; by_criterion: Array<{ criterion_id: string; name: string; n: number; coded: number; share: number }>; e4_share_first6: number; e4_share_last6: number; e4_coded_share: number; e4_stable_share: number; ai_recovered: number };
  pool: { current: number; amended: number; multiplier: number; pct_on_sglt2i: number; feasibility_assumed_pct: number };
  model: { name: string; version: string; rate_multiplier: number };
  competition: { acronym: string; sites: number; rate_before: number; rate_since: number };
  zero_enrollers: Array<{ site_id: string; site_name: string; city: string | null; months_active: number; screened: number; competing_trial: string | null }>;
  protocol_guidance: { question: string; answer: string; source: string } | null;
  recommendation: { amend: Array<{ criterion_id: string; from: string; to: string; why: string }>; do_not_amend: Array<{ criterion_id: string; why: string }> };
  rescue_sites: RescueSite[]; projection: Scenario[]; projection_params: ProjectionParams; summary: string; model_used: string; generated_at: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type Plan = {
  id: string; trialId: string; createdBy: string; createdAt: string; analysis: Analysis; memo: string | null; status: 'draft' | 'approved' | 'rejected';
  selectedSiteIds: string[]; closureSiteIds: string[]; decidedBy: string | null; decidedAt: string | null; decisionNotes: string | null; auditTrail: AuditEntry[];
};
export type SiteMetrics = Record<string, number | string | boolean | null | undefined> & {
  randomized?: number | null; screened?: number | null; months_active?: number | null; randomized_per_month?: number | null; is_zero_enroller?: boolean | null;
  competing_trial?: string | null; predicted_rate_current?: number | null; predicted_rate_amended?: number | null; expected_randomized_12m?: number | null;
  rescue_rank?: number | null; rescue_eligible?: boolean | null; eligible_current_protocol?: number | null; eligible_amended_e4?: number | null;
  est_activation_months?: number | null; hist_rate_per_month?: number | null; score_rationale?: string | null; principal_investigator?: string | null;
  cycle_time_days?: number | null; screen_fail_rate?: number | null; has_dkd_competitor?: boolean | null; days_in_startup?: number | null;
};
export type SiteRow = {
  siteId: string; trialId: string; siteName: string; city: string | null; state: string | null; region: string | null; siteType: string | null;
  irbType: string | null; latitude: number | null; longitude: number | null; cascadeStatus: string; metrics: SiteMetrics; opsStatus: string;
  opsNote: string | null; planId: string | null; updatedBy: string | null; updatedAt: string | null;
};
export type OpsSummary = { active_sites: number; zero_enrollers: number; rescue_candidates: number; activation_requested: number; closure_review: number; plans: number; approved: number; last_decided_at: string | null };
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type ActivityRow = { plan_id: string; trial_id: string; status: string; at: string; by: string; action: string; notes: string | null };

const get = async <T,>(url: string, label: string): Promise<T> => (await okOrThrow(await fetch(url), label)).json();
export const fetchPortfolio = () => get<PortfolioRow[]>('/api/portfolio', 'portfolio');
export const fetchOverview = (id: string) => get<Overview>(`/api/trials/${encodeURIComponent(id)}/overview`, 'trial overview');
export const fetchLatestPlan = (id: string) => get<Plan | null>(`/api/trials/${encodeURIComponent(id)}/rescue/latest`, 'rescue plan');
export const fetchSites = (view: string) => get<SiteRow[]>(`/api/sites?view=${view}`, 'sites');
export const fetchOpsSummary = () => get<OpsSummary>('/api/ops/summary', 'ops summary');
export const fetchActivity = (limit = 10) => get<ActivityRow[]>(`/api/activity/recent?limit=${limit}`, 'activity');

export async function decidePlan(planId: string, body: { decision: 'APPROVED' | 'REJECTED'; notes?: string; memo?: string; selectedSiteIds: string[]; closureSiteIds: string[] }): Promise<Plan> {
  return (await okOrThrow(await fetch(`/api/rescue/${encodeURIComponent(planId)}/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'decision')).json();
}

/** POST /rescue and parse the SSE stream (event: step | result | error). */
export async function runRescue(
  id: string,
  on: { step: (e: StepEvent) => void; result: (p: Plan) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/trials/${encodeURIComponent(id)}/rescue`, { method: 'POST' });
  if (!resp.ok || !resp.body) {
    on.error(`HTTP ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      const parsed = JSON.parse(data);
      if (ev === 'step') on.step(parsed);
      else if (ev === 'result') on.result(parsed);
      else if (ev === 'error') on.error(parsed.message);
    }
  }
}

export const pct = (x: number | null | undefined, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
export const n0 = (x: number | null | undefined) => (x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 }));
export const monthLabel = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'after 2032';
