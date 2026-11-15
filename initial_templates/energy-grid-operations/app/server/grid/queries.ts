import { randomUUID } from 'node:crypto';
import { execSql, fq } from '../lib/sql.js';

/**
 * Domain queries over the Delta gold tables — shared by the REST routes
 * (routes/grid.ts) and the agent tools (agent/gridops.ts) so the screen and
 * the copilot always quote the same numbers.
 */

// Small TTL cache: the gold tables change only when the setup job re-runs.
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}
const TTL = 10 * 60_000;

export const gridOverview = () =>
  cached('overview', TTL, async () => {
    const [kpi] = await execSql(`
      SELECT
        (SELECT ROUND(SUM(load_mva), 1) FROM ${fq('transformer_telemetry_hourly')}
          WHERE reading_at = (SELECT MAX(reading_at) FROM ${fq('transformer_telemetry_hourly')})) AS system_load_now_mva,
        (SELECT MAX(reading_at) FROM ${fq('transformer_telemetry_hourly')}) AS as_of,
        (SELECT ROUND(MAX(s), 1) FROM (SELECT SUM(forecast_mva) s FROM ${fq('transformer_load_forecast')} GROUP BY forecast_for)) AS system_peak_forecast_mva,
        (SELECT ROUND(SUM(nameplate_mva), 1) FROM ${fq('transformers')}) AS system_capacity_mva,
        (SELECT MAX(temperature_f) FROM ${fq('weather_hourly')} WHERE is_forecast) AS forecast_high_f,
        (SELECT COUNT(*) FROM ${fq('transformer_health')} WHERE forecast_peak_pct > 100) AS transformers_over_nameplate,
        (SELECT SUM(customers_total) FROM ${fq('feeders')}) AS customers_total,
        (SELECT SUM(customers_served) FROM ${fq('transformer_health')} WHERE overload_risk IN ('CRITICAL','HIGH')) AS customers_at_risk,
        (SELECT ROUND(SUM(saidi_minutes), 1) FROM ${fq('reliability_monthly')}
          WHERE month_start >= add_months((SELECT MAX(month_start) FROM ${fq('reliability_monthly')}), -11)) AS saidi_12m,
        (SELECT ROUND(SUM(saifi), 3) FROM ${fq('reliability_monthly')}
          WHERE month_start >= add_months((SELECT MAX(month_start) FROM ${fq('reliability_monthly')}), -11)) AS saifi_12m`);
    const transformers = await execSql(`
      SELECT h.transformer_id, h.substation_id, h.substation_name, h.nameplate_mva, h.age_years, h.health_index,
             h.health_tier, h.dga_status, h.ethylene_ppm, h.acetylene_ppm, h.load_now_mva, h.loading_now_pct,
             h.hot_spot_now_c, h.peak_loading_12m_pct, h.forecast_peak_mva, h.forecast_peak_pct,
             date_format(h.forecast_peak_at, "yyyy-MM-dd'T'HH:mm") AS forecast_peak_at, h.forecast_peak_hot_spot_c,
             h.forecast_peak_aging_factor, h.forecast_hours_over_nameplate, h.failure_probability_48h,
             h.customers_served, h.critical_facilities, h.overload_risk, h.risk_drivers,
             h.replacement_cost_usd, h.replacement_lead_time_weeks, h.forecast_mape_60d_pct,
             s.latitude, s.longitude
      FROM ${fq('transformer_health')} h JOIN ${fq('substations')} s USING (substation_id)
      ORDER BY h.forecast_peak_pct DESC`);
    return { kpi, transformers };
  });

export const transformerCurve = (id: string) =>
  cached(`curve:${id}`, TTL, async () => {
    const actual = await execSql(`
      SELECT date_format(reading_at, "yyyy-MM-dd'T'HH:mm") AS ts, load_mva, loading_pct, hot_spot_c, ambient_c
      FROM ${fq('transformer_telemetry_hourly')}
      WHERE transformer_id = :id
        AND reading_at > (SELECT MAX(reading_at) FROM ${fq('transformer_telemetry_hourly')}) - INTERVAL 36 HOURS
      ORDER BY reading_at`, { id });
    const forecast = await execSql(`
      SELECT date_format(forecast_for, "yyyy-MM-dd'T'HH:mm") AS ts, forecast_mva, forecast_mva_p10, forecast_mva_p90,
             forecast_loading_pct, forecast_hot_spot_c, forecast_temp_f, nameplate_mva, emergency_mva
      FROM ${fq('transformer_load_forecast')} WHERE transformer_id = :id ORDER BY forecast_for`, { id });
    return { actual, forecast };
  });

export const reliefOptions = (id: string) =>
  cached(`options:${id}`, TTL, async () => {
    const options = await execSql(`
      SELECT option_id, recommended_rank, option_type, option_name, description, relief_at_peak_mva, max_relief_mva,
             estimated_cost_usd, customers_affected, customer_impact, time_to_effect_minutes, n1_redundancy,
             execution_path, baseline_peak_pct, post_peak_mva, post_peak_pct, post_hot_spot_c,
             post_hours_over_nameplate, post_hours_hot_spot_over_110c, post_aging_factor, clears_overload,
             residual_thermal_risk, side_effect_transformer_id, side_effect_peak_pct, composite_risk_score
      FROM ${fq('relief_options')} WHERE transformer_id = :id ORDER BY recommended_rank`, { id });
    const hourly = await execSql(`
      SELECT option_id, date_format(forecast_for, "yyyy-MM-dd'T'HH:mm") AS ts, baseline_mva, post_action_mva, post_hot_spot_c
      FROM ${fq('relief_option_hourly')} WHERE transformer_id = :id ORDER BY option_id, forecast_for`, { id });
    return { options, hourly };
  });

export const assetDetail = (id: string) =>
  cached(`asset:${id}`, TTL, async () => {
    const dga = await execSql(`
      SELECT CAST(sample_date AS STRING) AS sample_date, ethylene_ppm, acetylene_ppm, tdcg_ppm, moisture_ppm, ieee_c57104_status
      FROM ${fq('dga_readings')} WHERE transformer_id = :id AND sample_date >= '2025-07-01' ORDER BY sample_date`, { id });
    const facilities = await execSql(`
      SELECT facility_name, facility_type, feeder_id, peak_demand_mw, has_backup_generation
      FROM ${fq('critical_facilities')} WHERE transformer_id = :id ORDER BY peak_demand_mw DESC`, { id });
    const outages = await execSql(`
      SELECT outage_id, date_format(started_at, "yyyy-MM-dd HH:mm") AS started_at, feeder_id, cause,
             customers_interrupted, duration_minutes
      FROM ${fq('outage_events')} WHERE transformer_id = :id ORDER BY customer_minutes_interrupted DESC LIMIT 5`, { id });
    const feeders = await execSql(`
      SELECT feeder_id, customers_total, peak_load_mw_12m FROM ${fq('feeders')} WHERE transformer_id = :id ORDER BY feeder_id`, { id });
    return { dga, facilities, outages, feeders };
  });

export async function listActions(limit = 20) {
  return execSql(`
    SELECT action_id, date_format(logged_at, "yyyy-MM-dd HH:mm:ss") AS logged_at, transformer_id, option_id,
           option_type, option_name, operator, rationale, expected_peak_pct, expected_hot_spot_c,
           estimated_cost_usd, customers_affected, status, source
    FROM ${fq('operator_actions')} ORDER BY logged_at DESC LIMIT ${Math.max(1, Math.min(100, limit))}`);
}

/** Write-back: log an approved relief action to the Delta table `operator_actions`. */
export async function logAction(a: {
  option_id: string; operator: string; rationale: string; source: 'app' | 'copilot';
}) {
  const [opt] = await execSql<Record<string, unknown>>(`
    SELECT option_id, transformer_id, option_type, option_name, post_peak_pct, post_hot_spot_c,
           estimated_cost_usd, customers_affected
    FROM ${fq('relief_options')} WHERE option_id = :id`, { id: a.option_id });
  if (!opt) throw new Error(`Unknown relief option ${a.option_id}`);
  const actionId = `ACT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
  await execSql(`
    INSERT INTO ${fq('operator_actions')}
    SELECT :action_id, current_timestamp(), transformer_id, option_id, option_type, option_name, :operator,
           :rationale, post_peak_pct, post_hot_spot_c, estimated_cost_usd, CAST(customers_affected AS INT),
           'DISPATCHED', :source
    FROM ${fq('relief_options')} WHERE option_id = :option_id`,
    { action_id: actionId, operator: a.operator, rationale: a.rationale.slice(0, 2000), source: a.source, option_id: a.option_id });
  return { action_id: actionId, status: 'DISPATCHED', ...opt };
}

/** Demo reset: empty the write-back log (keeps the table). */
export async function resetActions() {
  await execSql(`DELETE FROM ${fq('operator_actions')}`);
}
