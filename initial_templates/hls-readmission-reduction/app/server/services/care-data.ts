/**
 * Read side over the Delta gold tables (SQL warehouse, app service principal).
 *
 * Everything here is history — readmission rates by unit / weekday / follow-up, the CMS HRRP
 * estimate, operational events. It changes only when the setup job re-runs, so results are cached
 * in memory for 10 minutes. The write surface (worklist progress, plans, outreach tasks) lives in
 * Lakebase (db/).
 */
import { execSql, type DataConfig } from '../db/sync.js';
import type { HrrpWhatIfInputs } from '../../shared/hrrp.js';

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();
let cfg: DataConfig | null = null;

export function configureCareData(c: DataConfig | undefined) {
  cfg = c ?? null;
}
export function dataConfig(): DataConfig {
  if (!cfg) throw new Error('data config missing (DEMO_CATALOG / DEMO_SCHEMA)');
  return cfg;
}
const fq = (t: string) => `${dataConfig().catalog}.${dataConfig().schema}.${t}`;
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const CLOSED = `outcome_window_closed AND status = 'discharged'`;
const AS_OF = () => `(SELECT max(data_as_of) FROM ${fq('hospitals')})`;
export const SIGNAL_UNIT = 'LRMC-4W';

async function q<T = Record<string, unknown>>(key: string, statement: string): Promise<T[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T[]>;
  const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
  const p = execSql<Record<string, unknown>>(wh, statement).then((rows) => rows.map(coerceRow) as T[]);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}
export function clearCareDataCache() {
  cache.clear();
}

const NUMERIC_RE = /^-?\d+(\.\d+)?(E-?\d+)?$/i;
function coerceRow(r: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && NUMERIC_RE.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v]));
}

// ── Headline KPIs ────────────────────────────────────────────────────────────
export type Kpis = {
  as_of: string; discharges_12m: number; readmission_rate_12m: number; hf_rate_12m: number; hrrp_followup_rate_12m: number;
  signal_hf_rate_before: number; signal_hf_rate_last26: number; signal_hf_n_last26: number; rest_hf_rate_before: number; rest_hf_rate_last26: number;
  signal_weekend_followup_last26: number; signal_weekday_followup_last26: number;
};
export async function kpis(): Promise<Kpis> {
  const [r] = await q<Kpis>('kpis', `
    WITH g AS (SELECT * FROM ${fq('gold_discharges')} WHERE ${CLOSED})
    SELECT CAST(${AS_OF()} AS STRING) AS as_of,
      count_if(in_hrrp_window) AS discharges_12m,
      round(count_if(in_hrrp_window AND readmitted_30d) / count_if(in_hrrp_window), 4) AS readmission_rate_12m,
      round(count_if(in_hrrp_window AND hrrp_condition = 'HF' AND readmitted_30d) / count_if(in_hrrp_window AND hrrp_condition = 'HF'), 4) AS hf_rate_12m,
      round(count_if(in_hrrp_window AND is_hrrp_condition AND followup_7d_scheduled) / count_if(in_hrrp_window AND is_hrrp_condition), 4) AS hrrp_followup_rate_12m,
      round(count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND NOT last_26_weeks AND readmitted_30d) / count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND NOT last_26_weeks), 4) AS signal_hf_rate_before,
      round(count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks AND readmitted_30d) / count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks), 4) AS signal_hf_rate_last26,
      count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks) AS signal_hf_n_last26,
      round(count_if(unit_id <> '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND NOT last_26_weeks AND readmitted_30d) / count_if(unit_id <> '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND NOT last_26_weeks), 4) AS rest_hf_rate_before,
      round(count_if(unit_id <> '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks AND readmitted_30d) / count_if(unit_id <> '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks), 4) AS rest_hf_rate_last26,
      round(count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks AND weekend_discharge AND followup_7d_scheduled) / count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks AND weekend_discharge), 4) AS signal_weekend_followup_last26,
      round(count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks AND NOT weekend_discharge AND followup_7d_scheduled) / count_if(unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND last_26_weeks AND NOT weekend_discharge), 4) AS signal_weekday_followup_last26
    FROM g`);
  return r;
}

// ── Where: HF readmission change by unit ────────────────────────────────────
export type UnitRow = { unit_id: string; unit_name: string; hospital_id: string; n_before: number; rate_before: number; n_last26: number; rate_last26: number; change_pts: number; followup_last26: number };
export function unitHf(condition = 'HF'): Promise<UnitRow[]> {
  return q(`units:${condition}`, `
    SELECT unit_id, unit_name, hospital_id, count_if(NOT last_26_weeks) AS n_before,
           round(count_if(readmitted_30d AND NOT last_26_weeks) / count_if(NOT last_26_weeks), 4) AS rate_before,
           count_if(last_26_weeks) AS n_last26, round(count_if(readmitted_30d AND last_26_weeks) / count_if(last_26_weeks), 4) AS rate_last26,
           round(100 * (count_if(readmitted_30d AND last_26_weeks) / count_if(last_26_weeks) - count_if(readmitted_30d AND NOT last_26_weeks) / count_if(NOT last_26_weeks)), 1) AS change_pts,
           round(count_if(followup_7d_scheduled AND last_26_weeks) / count_if(last_26_weeks), 4) AS followup_last26
    FROM ${fq('gold_discharges')} WHERE ${CLOSED} AND hrrp_condition = ${lit(condition)}
    GROUP BY ALL HAVING count_if(last_26_weeks) >= 20 ORDER BY change_pts DESC`);
}

// ── When: 4 West HF by discharge weekday ────────────────────────────────────
export type DowRow = { discharge_dow: string; n_before: number; fu_before: number; rate_before: number; n_last26: number; fu_last26: number; rate_last26: number };
export function signalByWeekday(): Promise<DowRow[]> {
  return q('dow', `
    SELECT discharge_dow,
           count_if(NOT last_26_weeks) AS n_before, round(avg(CASE WHEN NOT last_26_weeks THEN CAST(followup_7d_scheduled AS INT) END), 4) AS fu_before,
           round(avg(CASE WHEN NOT last_26_weeks THEN CAST(readmitted_30d AS INT) END), 4) AS rate_before,
           count_if(last_26_weeks) AS n_last26, round(avg(CASE WHEN last_26_weeks THEN CAST(followup_7d_scheduled AS INT) END), 4) AS fu_last26,
           round(avg(CASE WHEN last_26_weeks THEN CAST(readmitted_30d AS INT) END), 4) AS rate_last26
    FROM ${fq('gold_discharges')} WHERE ${CLOSED} AND unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF'
    GROUP BY discharge_dow
    ORDER BY CASE discharge_dow WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2 WHEN 'Wed' THEN 3 WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5 WHEN 'Sat' THEN 6 ELSE 7 END`);
}

// ── Why: follow-up effect ───────────────────────────────────────────────────
export type FollowupRow = { hrrp_condition: string; condition_label: string; with_fu_rate: number; with_fu_n: number; without_fu_rate: number; without_fu_n: number };
export function followupEffect(): Promise<FollowupRow[]> {
  return q('fu', `
    SELECT hrrp_condition, max(condition_label) AS condition_label,
           round(sum(CASE WHEN followup_7d_scheduled THEN readmissions END) / sum(CASE WHEN followup_7d_scheduled THEN discharges END), 4) AS with_fu_rate,
           sum(CASE WHEN followup_7d_scheduled THEN discharges END) AS with_fu_n,
           round(sum(CASE WHEN NOT followup_7d_scheduled THEN readmissions END) / sum(CASE WHEN NOT followup_7d_scheduled THEN discharges END), 4) AS without_fu_rate,
           sum(CASE WHEN NOT followup_7d_scheduled THEN discharges END) AS without_fu_n
    FROM ${fq('gold_followup_effect')} WHERE hrrp_condition <> 'OTHER' GROUP BY hrrp_condition
    ORDER BY CASE hrrp_condition WHEN 'HF' THEN 0 ELSE 1 END, without_fu_rate DESC`);
}

export type TrendRow = { discharge_month: string; group_name: string; discharges: number; rate: number };
/** HF readmission rate by month, as a rolling 3-month rate (monthly unit volumes are small), 4 West vs the rest. */
export function hfTrend(): Promise<TrendRow[]> {
  return q('trend', `
    WITH m AS (
      SELECT discharge_month, CASE WHEN unit_id = '${SIGNAL_UNIT}' THEN '4 West' ELSE 'Rest of Larkspur' END AS group_name,
             sum(discharges) AS discharges, sum(readmissions) AS readmissions
      FROM ${fq('gold_readmission_monthly')} WHERE hrrp_condition = 'HF' GROUP BY ALL),
    r AS (
      SELECT discharge_month, group_name, discharges,
             sum(readmissions) OVER (PARTITION BY group_name ORDER BY discharge_month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS r3,
             sum(discharges) OVER (PARTITION BY group_name ORDER BY discharge_month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS d3,
             row_number() OVER (PARTITION BY group_name ORDER BY discharge_month) AS rn
      FROM m)
    SELECT CAST(discharge_month AS STRING) AS discharge_month, group_name, discharges, round(r3 / d3, 4) AS rate
    FROM r WHERE rn >= 3 ORDER BY 1, 2`);
}

export type EventRow = { event_date: string; unit_id: string; unit_name: string; event_type: string; description: string };
export function unitEvents(unitId?: string | null): Promise<EventRow[]> {
  return q(`events:${unitId ?? ''}`, `
    SELECT CAST(e.event_date AS STRING) AS event_date, e.unit_id, u.unit_name, e.event_type, e.description
    FROM ${fq('unit_events')} e JOIN ${fq('units')} u USING (unit_id) ${unitId ? `WHERE e.unit_id = ${lit(unitId)}` : ''} ORDER BY e.event_date`);
}

/** Social risks that ONLY the notes carry (AI Functions) vs the readmission outcome (closed windows, all HRRP conditions). */
export type NoteSignal = { risk: string; with_n: number; with_rate: number; without_n: number; without_rate: number; prevalence: number };
export function noteSignals(): Promise<NoteSignal[]> {
  const one = (col: string, label: string) => `
    SELECT '${label}' AS risk, count_if(${col}) AS with_n, round(avg(CASE WHEN ${col} THEN CAST(readmitted_30d AS INT) END), 4) AS with_rate,
           count_if(NOT ${col}) AS without_n, round(avg(CASE WHEN NOT ${col} THEN CAST(readmitted_30d AS INT) END), 4) AS without_rate,
           round(avg(CAST(${col} AS INT)), 4) AS prevalence
    FROM ${fq('gold_discharges')} WHERE ${CLOSED} AND is_hrrp_condition AND ${col} IS NOT NULL`;
  return q('notes', [one('note_transportation_barrier', 'Transportation barrier'), one('note_medication_affordability', 'Medication cost concern'),
    one('note_high_risk_med_change', 'High-risk medication change')].join(' UNION ALL '));
}

// ── HRRP ────────────────────────────────────────────────────────────────────
export type PenaltyRow = { hospital_id: string; hospital_name: string; medicare_base_drg_payments: number; penalty_pct: number; penalty_usd: number; penalty_pct_hf_run_rate: number; penalty_usd_hf_run_rate: number; hf_err_estimate: number; hf_err_last_6m: number; top_condition: string; top_condition_usd: number; excess_readmissions: number };
export function hrrpPenalty(): Promise<PenaltyRow[]> {
  return q('penalty', `SELECT * FROM ${fq('hrrp_penalty_estimate')} ORDER BY penalty_usd_hf_run_rate DESC`);
}
export type HrrpRow = { hospital_id: string; hospital_name: string; hrrp_condition: string; condition_label: string; discharges: number; readmissions: number; observed_rate: number; national_readmission_rate: number; err_estimate: number; err_last_6m: number; payment_share: number; penalty_contribution: number; penalty_usd: number; excess_readmissions: number };
export function hrrpPerformance(): Promise<HrrpRow[]> {
  return q('hrrp', `
    SELECT hospital_id, hospital_name, hrrp_condition, condition_label, discharges, readmissions, observed_rate, national_readmission_rate, err_estimate,
           err_last_6m, payment_share, penalty_contribution, round(penalty_contribution * medicare_base_drg_payments) AS penalty_usd, excess_readmissions
    FROM ${fq('hrrp_performance')} ORDER BY hospital_id, penalty_usd DESC`);
}

export async function whatIfInputs(): Promise<HrrpWhatIfInputs> {
  const [r] = await q<HrrpWhatIfInputs>('whatif', `
    WITH hf AS (SELECT * FROM ${fq('hrrp_performance')} WHERE hospital_id = 'LRMC' AND hrrp_condition = 'HF'),
         other AS (SELECT coalesce(sum(penalty_contribution), 0) AS c FROM ${fq('hrrp_performance')} WHERE hospital_id = 'LRMC' AND hrrp_condition <> 'HF'),
         wk AS (SELECT count(*) AS n, avg(CAST(followup_7d_scheduled AS INT)) AS fu FROM ${fq('gold_discharges')}
                WHERE in_hrrp_window AND status = 'discharged' AND unit_id = '${SIGNAL_UNIT}' AND hrrp_condition = 'HF' AND weekend_discharge AND medicare_ffs_65),
         fe AS (SELECT sum(CASE WHEN followup_7d_scheduled THEN readmissions END) / sum(CASE WHEN followup_7d_scheduled THEN discharges END) AS r_fu,
                       sum(CASE WHEN NOT followup_7d_scheduled THEN readmissions END) / sum(CASE WHEN NOT followup_7d_scheduled THEN discharges END) AS r_nofu
                FROM ${fq('gold_followup_effect')} WHERE hrrp_condition = 'HF' AND weekend_discharge)
    SELECT hf.discharges AS hf_discharges, hf.readmissions AS hf_readmissions, hf.national_readmission_rate AS national_rate, 150 AS credibility_k,
           hf.payment_share AS hf_payment_share, other.c AS other_contribution, hf.medicare_base_drg_payments AS base_payments,
           wk.n AS weekend_discharges, round(wk.fu, 4) AS weekend_followup_share, round(fe.r_fu, 4) AS rate_with_followup, round(fe.r_nofu, 4) AS rate_without_followup
    FROM hf CROSS JOIN other CROSS JOIN wk CROSS JOIN fe`);
  return r;
}

export type HistoryRow = { encounter_id: string; discharge_date: string; unit_name: string; condition_label: string; los_days: number; followup_7d_scheduled: boolean; readmitted_30d: boolean; days_to_readmit: number | null; readmit_reason: string | null };
export function patientHistory(patientId: string): Promise<HistoryRow[]> {
  return q(`hist:${patientId}`, `
    SELECT encounter_id, CAST(discharge_date AS STRING) AS discharge_date, unit_name, condition_label, los_days, followup_7d_scheduled,
           readmitted_30d, days_to_readmit, readmit_reason
    FROM ${fq('gold_discharges')} WHERE patient_id = ${lit(patientId)} AND status = 'discharged' ORDER BY discharge_date DESC LIMIT 8`);
}
