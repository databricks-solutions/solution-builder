import { okOrThrow } from '@/lib/api';

export type Transformer = {
  transformer_id: string; substation_id: string; substation_name: string; nameplate_mva: number; age_years: number;
  health_index: number; health_tier: string; dga_status: string; ethylene_ppm: number; acetylene_ppm: number;
  load_now_mva: number; loading_now_pct: number; hot_spot_now_c: number; peak_loading_12m_pct: number;
  forecast_peak_mva: number; forecast_peak_pct: number; forecast_peak_at: string; forecast_peak_hot_spot_c: number;
  forecast_peak_aging_factor: number; forecast_hours_over_nameplate: number; failure_probability_48h: number;
  customers_served: number; critical_facilities: string; overload_risk: 'CRITICAL' | 'HIGH' | 'WATCH' | 'NORMAL';
  risk_drivers: string; replacement_cost_usd: number; replacement_lead_time_weeks: number; forecast_mape_60d_pct: number;
  latitude: number; longitude: number;
};
export type Kpi = {
  system_load_now_mva: number; as_of: string; system_peak_forecast_mva: number; system_capacity_mva: number;
  forecast_high_f: number; transformers_over_nameplate: number; customers_total: number; customers_at_risk: number;
  saidi_12m: number; saifi_12m: number;
};
export type Overview = { kpi: Kpi; transformers: Transformer[] };
export type CurvePoint = { ts: string; load_mva: number; loading_pct: number; hot_spot_c: number };
export type ForecastPoint = {
  ts: string; forecast_mva: number; forecast_mva_p10: number; forecast_mva_p90: number; forecast_loading_pct: number;
  forecast_hot_spot_c: number; forecast_temp_f: number; nameplate_mva: number; emergency_mva: number;
};
export type Curve = { actual: CurvePoint[]; forecast: ForecastPoint[] };
export type ReliefOption = {
  option_id: string; recommended_rank: number; option_type: string; option_name: string; description: string;
  relief_at_peak_mva: number; max_relief_mva: number; estimated_cost_usd: number; customers_affected: number;
  customer_impact: string; time_to_effect_minutes: number; n1_redundancy: string; execution_path: string;
  baseline_peak_pct: number; post_peak_mva: number; post_peak_pct: number; post_hot_spot_c: number;
  post_hours_over_nameplate: number; post_hours_hot_spot_over_110c: number; post_aging_factor: number;
  clears_overload: boolean; residual_thermal_risk: number; side_effect_transformer_id: string | null;
  side_effect_peak_pct: number | null; composite_risk_score: number;
};
export type Options = { options: ReliefOption[]; hourly: Array<{ option_id: string; ts: string; baseline_mva: number; post_action_mva: number; post_hot_spot_c: number }> };
export type Detail = {
  dga: Array<{ sample_date: string; ethylene_ppm: number; acetylene_ppm: number; tdcg_ppm: number; ieee_c57104_status: string }>;
  facilities: Array<{ facility_name: string; facility_type: string; feeder_id: string; peak_demand_mw: number; has_backup_generation: boolean }>;
  outages: Array<{ outage_id: string; started_at: string; feeder_id: string; cause: string; customers_interrupted: number; duration_minutes: number }>;
  feeders: Array<{ feeder_id: string; customers_total: number; peak_load_mw_12m: number }>;
};
export type Action = {
  action_id: string; logged_at: string; transformer_id: string; option_id: string; option_type: string; option_name: string;
  operator: string; rationale: string; expected_peak_pct: number; expected_hot_spot_c: number; estimated_cost_usd: number;
  customers_affected: number; status: string; source: string;
};

const get = async <T,>(url: string): Promise<T> => (await okOrThrow(await fetch(url), url)).json() as Promise<T>;
export const fetchOverview = () => get<Overview>('/api/grid/overview');
export const fetchCurve = (id: string) => get<Curve>(`/api/grid/transformers/${id}/curve`);
export const fetchOptions = (id: string) => get<Options>(`/api/grid/transformers/${id}/options`);
export const fetchDetail = (id: string) => get<Detail>(`/api/grid/transformers/${id}/detail`);
export const fetchActions = () => get<Action[]>('/api/grid/actions');
export async function approveOption(option_id: string, rationale: string): Promise<Action> {
  const r = await fetch('/api/grid/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option_id, rationale }),
  });
  return (await okOrThrow(r, 'approve')).json();
}

export const RISK_COLOR: Record<string, string> = {
  CRITICAL: 'var(--risk-critical)', HIGH: 'var(--risk-high)', WATCH: 'var(--risk-watch)', NORMAL: 'var(--risk-normal)',
};
export const fmtHour = (ts: string) => {
  const d = new Date(ts + ':00Z');
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', timeZone: 'UTC' });
};
export const usd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `$${n.toFixed(0)}`;
