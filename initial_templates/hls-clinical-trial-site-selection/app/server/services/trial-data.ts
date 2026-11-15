/**
 * Read side over the Delta gold tables (SQL warehouse, app service principal).
 *
 * Everything here is history — enrollment curves, screen failures (with the AI
 * Functions read of the coordinator notes), the EHR-network catchment, competing
 * trials, ML scores. It changes only when the setup job re-runs, so results are
 * cached in memory for 10 minutes. The write surface lives in Lakebase (db/).
 */
import { execSql, type DataConfig } from '../db/sync.js';

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();
let cfg: DataConfig | null = null;

export function configureTrialData(c: DataConfig | undefined) {
  cfg = c ?? null;
}
export function dataConfig(): DataConfig {
  if (!cfg) throw new Error('data config missing (DEMO_CATALOG / DEMO_SCHEMA)');
  return cfg;
}
const fq = (t: string) => `${dataConfig().catalog}.${dataConfig().schema}.${t}`;
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function q<T = Record<string, unknown>>(key: string, statement: string): Promise<T[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T[]>;
  const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
  const p = execSql<Record<string, unknown>>(wh, statement).then((rows) => rows.map(coerceRow) as T[]);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}
export function clearTrialDataCache() {
  cache.clear();
}

const NUMERIC_RE = /^-?\d+(\.\d+)?(E-?\d+)?$/i;
function coerceRow(r: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && NUMERIC_RE.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v]));
}

// ── Portfolio ────────────────────────────────────────────────────────────────
export type PortfolioRow = {
  trial_id: string; acronym: string; phase: string; therapeutic_area: string; indication: string; target_enrollment: number;
  planned_lpi_date: string; study_manager: string; randomized: number; planned_to_date: number; pct_of_plan: number;
  active_sites: number; screen_fail_rate: number; planned_screen_fail_rate: number;
};
export function portfolio(): Promise<PortfolioRow[]> {
  return q('portfolio', `
    WITH cur AS (
      SELECT trial_id, max_by(cum_randomized, month_start) AS randomized, max_by(planned_cum_randomized, month_start) AS planned_to_date,
             max_by(active_sites, month_start) AS active_sites
      FROM ${fq('gold_trial_enrollment_monthly')} GROUP BY trial_id),
    sf AS (
      SELECT trial_id, round(count_if(outcome IN ('screen_failed','withdrawn')) / count_if(outcome <> 'in_screening'), 3) AS screen_fail_rate
      FROM ${fq('screening_log')} GROUP BY trial_id)
    SELECT t.trial_id, t.acronym, t.phase, t.therapeutic_area, t.indication, t.target_enrollment, CAST(t.planned_lpi_date AS STRING) AS planned_lpi_date,
           t.study_manager, c.randomized, c.planned_to_date, round(c.randomized / c.planned_to_date, 3) AS pct_of_plan, c.active_sites,
           sf.screen_fail_rate, t.planned_screen_fail_rate
    FROM ${fq('trials')} t JOIN cur c USING (trial_id) JOIN sf USING (trial_id)
    ORDER BY pct_of_plan`);
}

// ── One trial ────────────────────────────────────────────────────────────────
export type CurvePoint = { month_start: string; month_number: number; randomized: number; cum_randomized: number; planned_cum_randomized: number; screened: number; screen_failed: number; active_sites: number; is_complete_month: boolean };
export function enrollmentCurve(trialId: string): Promise<CurvePoint[]> {
  return q(`curve:${trialId}`, `
    SELECT CAST(month_start AS STRING) AS month_start, month_number, randomized, cum_randomized, planned_cum_randomized, screened,
           screen_failed, active_sites, is_complete_month
    FROM ${fq('gold_trial_enrollment_monthly')} WHERE trial_id = ${lit(trialId)} ORDER BY month_start`);
}
export type PlanPoint = { month_start: string; month_number: number; planned_cum_randomized: number };
export function fullPlan(trialId: string): Promise<PlanPoint[]> {
  return q(`plan:${trialId}`, `SELECT CAST(month_start AS STRING) AS month_start, month_number, planned_cum_randomized FROM ${fq('enrollment_plan')} WHERE trial_id = ${lit(trialId)} ORDER BY month_start`);
}

export type Criterion = { criterion_id: string; criterion_type: string; short_name: string; criterion_text: string; feasibility_assumed_pass_rate: number | null; amendable: boolean; rationale: string | null };
export function criteria(trialId: string): Promise<Criterion[]> {
  return q(`crit:${trialId}`, `SELECT criterion_id, criterion_type, short_name, criterion_text, feasibility_assumed_pass_rate, amendable, rationale FROM ${fq('protocol_criteria')} WHERE trial_id = ${lit(trialId)} ORDER BY criterion_type DESC, criterion_id`);
}

export type ScreenFailRow = { criterion_id: string; criterion_name: string; n: number; coded: number; ai: number; stable_sglt2i: number; n_first6: number; n_last6: number };
/** Screen failures by REAL criterion (site-coded or AI-read) vs what the sites coded, whole study + first/last 6 months. */
export function screenFails(trialId: string): Promise<ScreenFailRow[]> {
  return q(`sf:${trialId}`, `
    WITH b AS (SELECT min(screen_month) AS m0, max(screen_month) AS m1 FROM ${fq('screen_fail_reasons')} WHERE trial_id = ${lit(trialId)})
    SELECT r.criterion_id, coalesce(max(r.criterion_name), r.criterion_id) AS criterion_name, count(*) AS n,
           count_if(r.criterion_source = 'site_coded') AS coded, count_if(r.criterion_source = 'ai_classify') AS ai,
           count_if(r.sglt2i_stable_12wk) AS stable_sglt2i,
           count_if(r.screen_month < add_months(b.m0, 6)) AS n_first6,
           count_if(r.screen_month > add_months(b.m1, -6)) AS n_last6
    FROM ${fq('screen_fail_reasons')} r CROSS JOIN b WHERE r.trial_id = ${lit(trialId)}
    GROUP BY r.criterion_id ORDER BY n DESC`);
}
export type CodedRow = { coded_reason: string; n: number };
export function codedReasons(trialId: string): Promise<CodedRow[]> {
  return q(`coded:${trialId}`, `SELECT coded_reason, count(*) AS n FROM ${fq('screen_fail_reasons')} WHERE trial_id = ${lit(trialId)} GROUP BY 1 ORDER BY n DESC`);
}
export type E4Trend = { quarter: string; e4_share: number; failures: number };
export function e4Trend(trialId: string): Promise<E4Trend[]> {
  return q(`e4t:${trialId}`, `
    SELECT concat(year(screen_month), '-Q', quarter(screen_month)) AS quarter, round(count_if(criterion_id = 'E4') / count(*), 3) AS e4_share, count(*) AS failures
    FROM ${fq('screen_fail_reasons')} WHERE trial_id = ${lit(trialId)} GROUP BY 1 ORDER BY 1`);
}

export type Funnel = { t2d_ckd: number; egfr: number; uacr: number; hba1c: number; on_sglt2i: number; stable_sglt2i: number; eligible_current: number; eligible_amended: number; pct_on_sglt2i: number; sites: number };
/** EHR-network catchment of the ACTIVE sites, criterion by criterion. */
export async function funnel(trialId: string): Promise<Funnel> {
  const [r] = await q<Funnel>(`funnel:${trialId}`, `
    SELECT sum(c.t2d_ckd_patients) AS t2d_ckd, sum(c.meets_egfr) AS egfr, sum(c.meets_uacr) AS uacr, sum(c.meets_hba1c) AS hba1c,
           sum(c.on_sglt2i) AS on_sglt2i, sum(c.sglt2i_stable_12wk) AS stable_sglt2i, sum(c.eligible_current_protocol) AS eligible_current,
           sum(c.eligible_amended_e4) AS eligible_amended, round(sum(c.on_sglt2i) / sum(c.meets_hba1c), 3) AS pct_on_sglt2i, count(*) AS sites
    FROM ${fq('site_catchment')} c JOIN ${fq('trial_sites')} ts ON ts.site_id = c.site_id AND ts.trial_id = ${lit(trialId)} AND ts.status = 'active'`);
  return r;
}
export type SglTrend = { quarter: string; pct_on_sglt2i: number };
export function sglt2Trend(): Promise<SglTrend[]> {
  return q('sgl', `SELECT quarter, round(sum(pct_on_sglt2i * t2d_ckd_patients) / sum(t2d_ckd_patients), 3) AS pct_on_sglt2i FROM ${fq('population_trends')} GROUP BY quarter ORDER BY quarter`);
}

export type Competition = { acronym: string; sponsor: string; start_date: string; sites: number; rate_before: number; rate_since: number; rate_others_since: number; overlap_note: string };
export async function competition(trialId: string): Promise<Competition | null> {
  const [r] = await q<Competition>(`comp:${trialId}`, `
    WITH ours AS (SELECT * FROM ${fq('gold_site_performance')} WHERE trial_id = ${lit(trialId)} AND status = 'active')
    SELECT ct.acronym, ct.sponsor, CAST(ct.start_date AS STRING) AS start_date,
           (SELECT count(*) FROM ours WHERE has_competing_trial) AS sites,
           (SELECT round(avg(rand_per_month_before_competitor), 2) FROM ours WHERE has_competing_trial) AS rate_before,
           (SELECT round(avg(rand_per_month_since_competitor), 2) FROM ours WHERE has_competing_trial) AS rate_since,
           (SELECT round(sum(l.n) / count(DISTINCT o.site_id) / greatest(months_between(current_date(), ct.start_date), 1), 2)
              FROM ours o LEFT JOIN (SELECT site_id, count(*) n FROM ${fq('screening_log')} WHERE trial_id = ${lit(trialId)} AND outcome = 'randomized' AND screen_date >= (SELECT start_date FROM ${fq('competing_trials')} WHERE acronym = 'REDWOOD-CKD') GROUP BY 1) l USING (site_id)
              WHERE NOT o.has_competing_trial) AS rate_others_since,
           ct.overlap_note
    FROM ${fq('competing_trials')} ct WHERE ct.acronym = 'REDWOOD-CKD'`);
  return r ?? null;
}

export type ActivationRow = { irb_type: string; site_type: string; sites: number; median_days: number; avg_days: number };
export function activationCycle(trialId: string): Promise<ActivationRow[]> {
  return q(`act:${trialId}`, `
    SELECT irb_type, site_type, count(*) AS sites, cast(percentile(cycle_time_days, 0.5) AS INT) AS median_days, cast(avg(cycle_time_days) AS INT) AS avg_days
    FROM ${fq('gold_site_performance')} WHERE trial_id = ${lit(trialId)} AND cycle_time_days IS NOT NULL GROUP BY ALL ORDER BY median_days DESC`);
}

export type ModelInfo = { model_version: string; rate_multiplier: number; active_scored: number };
/** How much the model says the E4 amendment lifts the ACTIVE sites' randomization rate. */
export async function modelMultiplier(): Promise<ModelInfo> {
  const [r] = await q<ModelInfo>('mult', `
    SELECT max(model_version) AS model_version, round(sum(predicted_rate_amended) / sum(predicted_rate_current), 3) AS rate_multiplier, count(*) AS active_scored
    FROM ${fq('site_scores')} WHERE cascade_status = 'active'`);
  return r;
}

export type CandidateRow = { site_id: string; site_name: string; city: string; state: string; region: string; irb_type: string; site_type: string; eligible_current_protocol: number; eligible_amended_e4: number; amendment_pool_multiplier: number; hist_rate_per_month: number; predicted_rate_current: number; predicted_rate_amended: number; est_activation_months: number; expected_randomized_12m: number; rescue_rank: number | null; rescue_eligible: boolean; has_dkd_competitor: boolean; competing_trial_names: string | null; prior_halcyra_trials: number; score_rationale: string };
export function candidates(opts: { region?: string | null; includeCompetitors?: boolean; limit?: number } = {}): Promise<CandidateRow[]> {
  const where = [`cascade_status = 'candidate'`];
  if (opts.region) where.push(`region = ${lit(opts.region)}`);
  if (!opts.includeCompetitors) where.push('rescue_eligible');
  return q(`cand:${opts.region ?? ''}:${opts.includeCompetitors ?? false}:${opts.limit ?? 25}`, `
    SELECT site_id, site_name, city, state, region, irb_type, site_type, eligible_current_protocol, eligible_amended_e4, amendment_pool_multiplier,
           round(hist_rate_per_month, 2) AS hist_rate_per_month, predicted_rate_current, predicted_rate_amended, est_activation_months,
           expected_randomized_12m, rescue_rank, rescue_eligible, has_dkd_competitor, competing_trial_names, prior_halcyra_trials, score_rationale
    FROM ${fq('site_scores')} WHERE ${where.join(' AND ')}
    ORDER BY expected_randomized_12m DESC LIMIT ${Math.max(1, Math.min(60, opts.limit ?? 25))}`);
}

export type SitePerf = { site_id: string; site_name: string; city: string; state: string; region: string; irb_type: string; status: string; activation_date: string | null; months_active: number | null; screened: number; randomized: number; randomized_per_month: number | null; screen_fail_rate: number | null; is_zero_enroller: boolean; has_competing_trial: boolean; rand_per_month_before_competitor: number | null; rand_per_month_since_competitor: number | null; cycle_time_days: number | null; days_in_startup: number | null };
export function sitePerformance(trialId: string): Promise<SitePerf[]> {
  return q(`perf:${trialId}`, `
    SELECT site_id, site_name, city, state, region, irb_type, status, CAST(activation_date AS STRING) AS activation_date, months_active, screened, randomized,
           randomized_per_month, screen_fail_rate, coalesce(is_zero_enroller, false) AS is_zero_enroller, has_competing_trial,
           rand_per_month_before_competitor, rand_per_month_since_competitor, cycle_time_days, days_in_startup
    FROM ${fq('gold_site_performance')} WHERE trial_id = ${lit(trialId)} ORDER BY randomized DESC`);
}
