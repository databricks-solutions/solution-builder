/** Fetch helpers + types for the TechRobotics control room (Lakebase-backed /api routes). */
import { okOrThrow } from './api';

export type RiskTier = 'Critical' | 'High' | 'Watch' | 'Healthy';

export type FleetAsset = {
  id: string;
  name: string;
  asset_type: string;
  manufacturer: string | null;
  model: string | null;
  line: string;
  cell: string | null;
  criticality: string | null;
  is_bottleneck: boolean;
  downtime_cost_per_hour: number;
  risk_score: number;
  risk_tier: RiskTier;
  failure_prob_7d: number | null;
  predicted_failure_mode: string | null;
  est_days_to_failure: number | null;
  downtime_cost_at_risk_usd: number | null;
  unplanned_failure_cost_usd?: number | null;
  top_driver_1: string | null;
  top_driver_2: string | null;
  top_driver_3?: string | null;
  vib_ratio: number | null;
  temp_delta_c: number | null;
  pressure_ratio: number | null;
  last_pm_at: string | null;
  last_pm_vendor: string | null;
  last_pm_lubricant: string | null;
  last_pm_work_order?: string | null;
  vibration_24h: number | null;
  temperature_24h: number | null;
  pressure_24h: number | null;
  status: 'monitoring' | 'work_order_booked';
  open_work_order_id: string | null;
};

export type FleetSummary = {
  assets: number;
  critical: number;
  high: number;
  watch: number;
  healthy: number;
  cost_at_risk_usd: number;
  protected_assets: number;
  work_orders: number;
  cost_avoided_usd: number;
  net_savings_usd: number;
  by_line: Array<{ line: string; assets: number; max_risk: number; at_risk: number }>;
};

export type TrendPoint = {
  day: string;
  vibration: number | null;
  vibration_baseline: number | null;
  temperature: number | null;
  temperature_baseline: number | null;
  pressure: number | null;
};

export type HistoryRow = {
  id: string;
  work_type: string;
  scheduled_at: string | null;
  vendor: string | null;
  technician: string | null;
  description: string | null;
  lubricant_used: string | null;
  parts_used: string | null;
  notes: string | null;
  failure_id: string | null;
};

export type FailureRow = {
  id: string;
  failure_at: string | null;
  failure_mode: string | null;
  component: string | null;
  downtime_hours: number | null;
  total_cost_usd: number | null;
  root_cause: string | null;
};

export type WorkOrderPart = { part_number: string; description: string; qty: number; unit_cost_usd: number; source: string };
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };

export type WorkOrder = {
  id: string;
  asset_id: string;
  asset_name?: string;
  line?: string;
  priority: string;
  title: string;
  tasks: string[];
  window_id: string | null;
  scheduled_start: string | null;
  duration_hours: number;
  technicians: string | null;
  parts: WorkOrderPart[];
  parts_cost_usd: number;
  labor_cost_usd: number;
  unplanned_cost_avoided_usd: number;
  net_savings_usd: number;
  risk_score_at_booking: number | null;
  root_cause: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  created_by: string;
  source: 'agent' | 'manual';
  ai_audit_trail: AuditEntry[];
  created_at: string;
};

export type AssetDetail = {
  asset: FleetAsset;
  trend: TrendPoint[];
  history: HistoryRow[];
  failures: FailureRow[];
  work_orders: WorkOrder[];
};

export type Part = {
  part_number: string;
  description: string;
  compatible_models: string | null;
  plant_on_hand: number;
  reserved_qty: number;
  available_at_plant: number;
  regional_dc_qty: number;
  unit_cost_usd: number;
  lead_time_days: number | null;
  part_class: string | null;
};

export type MaintWindow = {
  id: string;
  line: string;
  start_at: string;
  end_at: string;
  capacity_hours: number;
  booked_hours: number;
  free_hours: number;
};

export type ActivityEvent = {
  kind: 'audit';
  work_order_id: string;
  asset_id: string;
  at: string;
  by: string;
  action: string;
  notes: string | null;
  tool: string | null;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await okOrThrow(await fetch(path), path);
  return (await res.json()) as T;
}

export const fetchFleet = () => getJson<FleetAsset[]>('/api/fleet');
export const fetchFleetSummary = () => getJson<FleetSummary>('/api/fleet/summary');
export const fetchAsset = (id: string) => getJson<AssetDetail>(`/api/assets/${encodeURIComponent(id)}`);
export const fetchWorkOrders = () => getJson<WorkOrder[]>('/api/work-orders');
export const fetchParts = () => getJson<Part[]>('/api/parts');
export const fetchWindows = () => getJson<MaintWindow[]>('/api/windows');
export const fetchActivity = (limit = 20) => getJson<ActivityEvent[]>(`/api/activity/recent?limit=${limit}`);

export async function setWorkOrderStatus(id: string, status: WorkOrder['status']) {
  const res = await okOrThrow(
    await fetch(`/api/work-orders/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    'set work-order status',
  );
  return res.json();
}

// ── formatting ────────────────────────────────────────────────────────────
export const usd = (n: number | null | undefined, compact = true) =>
  n === null || n === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(Number(n));

/** Postgres text timestamps ("2026-09-12 07:00:00+00") → Date. */
export const toDate = (s: string) => new Date(/^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(' ', 'T').replace(/\+00(:00)?$/, 'Z') : s);

export const fmtDate = (s: string | null | undefined, withTime = false) =>
  s ? toDate(s).toLocaleString('en-US', withTime ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const TIER_STYLE: Record<RiskTier, { bg: string; ring: string; text: string; dot: string }> = {
  Critical: { bg: 'bg-[var(--risk-critical-bg)]', ring: 'ring-[var(--risk-critical)]', text: 'text-[var(--risk-critical)]', dot: 'bg-[var(--risk-critical)]' },
  High: { bg: 'bg-[var(--risk-high-bg)]', ring: 'ring-[var(--risk-high)]', text: 'text-[var(--risk-high)]', dot: 'bg-[var(--risk-high)]' },
  Watch: { bg: 'bg-[var(--risk-watch-bg)]', ring: 'ring-[var(--risk-watch)]', text: 'text-[var(--risk-watch)]', dot: 'bg-[var(--risk-watch)]' },
  Healthy: { bg: 'bg-[var(--risk-ok-bg)]', ring: 'ring-[var(--risk-ok)]', text: 'text-[var(--risk-ok)]', dot: 'bg-[var(--risk-ok)]' },
};
