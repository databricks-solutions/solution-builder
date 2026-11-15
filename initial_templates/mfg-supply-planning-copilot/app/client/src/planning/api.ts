/** Typed client for the supply-planning routes (server/routes/planning.ts). */

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${r.status}`);
  return body as T;
}
const post = <T,>(url: string, body: unknown) =>
  j<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type PlanStatus = { status: 'proposed' | 'booked'; planId: string; cost: number; revenueProtected: number } | null;

export type Exposure = {
  exposure_id: string; plant_id: string; plant_name: string; component_id: string; component_name: string;
  exposure_type: 'STOCKOUT' | 'BELOW_SAFETY_STOCK'; first_stockout_week: string | null; first_below_ss_week: string | null;
  days_to_stockout: number | null; weeks_short: number; weeks_below_ss: number; on_hand_units: number; safety_stock_units: number;
  days_of_supply_now: number | null; peak_units_short: number; peak_units_short_if_on_time: number; revenue_per_unit: number;
  revenue_at_risk: number; affected_skus: string[]; primary_supplier: string; delayed_po_count: number; max_delay_days: number | null;
  delayed_units: number | null; delay_reason: string | null; root_cause: string; as_of_date: string;
  plan?: PlanStatus;
};

export type Signal = {
  message_id: string; received_ts: string; sender_org: string; subject: string; event_type: string; supplier_name: string;
  component: string; po_numbers: string; added_delay_days: number | null; new_eta: string | null; offered_quantity: number | null;
  offered_unit_cost: number | null; severity: string; summary: string; summary_conf: number | null;
};

export type Health = {
  plant_id: string; plant_name: string; component_id: string; component_name: string; category: string; abc_class: string;
  on_hand_units: number; unit_cost: number; inventory_value: number; safety_stock_units: number; avg_weekly_requirement: number;
  weeks_of_cover: number | null; days_of_supply: number | null; days_since_last_issue: number; eo_category: string; eo_units: number; eo_value: number;
};

export type Overview = {
  as_of: string; fill_rate_4w: number; fill_rate_prior: number;
  fill_rate_by_plant: Array<{ plant: string; last_4w: number; prior: number }>;
  fill_trend: Array<Record<string, number | string | null>>;
  exposures: Exposure[]; revenue_at_risk: number; stockouts: number; eo_value: number; eo_items: Health[];
  delayed_pos: number; delayed_units: number; signals: Signal[];
};

export type ProjRow = {
  week_start: string; week_index: number; on_hand_units: number; safety_stock_units: number; required_units: number;
  receipts: number; receipt_pos: string | null; projected_balance: number; balance_if_on_time: number;
};
export type OpenPo = {
  po_number: string; supplier_name: string; quantity: number; po_value: number; order_date: string; promised_date: string;
  revised_eta: string; delay_days: number; is_delayed: boolean; delay_reason: string | null; status: string; ship_mode: string; lane: string; vessel: string | null;
};
export type CustomerOrder = { order_id: string; customer_name: string; customer_tier: string; sku: string; quantity: number; order_value: number; requested_ship_date: string };

export type SimWeek = { week_index: number; week_start: string; required: number; receipts: number; balance: number; baseline: number; safety_stock: number };
export type SimResult = {
  weeks: SimWeek[]; units_short: number; weeks_short: number; first_stockout_week: string | null; weeks_below_safety_stock: number;
  min_balance: number; revenue_at_risk: number; revenue_protected: number; plan_cost: number; annual_carrying_cost: number;
  eo_released: number; approver: string;
  actions: Array<{ option_id: string; type: string; title: string; qty: number; cost: number; arrival_date: string | null }>;
};
export type MitigationOption = {
  option_id: string; type: 'transfer' | 'expedite' | 'alternate' | 'safety_stock'; title: string; source: string; detail: string;
  lead_days: number; arrival_date: string | null; arrival_week: number | null; default_qty: number; max_qty: number; min_qty: number;
  unit_label: string; cost_formula: string; eo_note: string | null; policy_rank: number; alone: SimResult;
};
export type PlanAction = { optionId: string; type: string; title: string; qty: number; cost: number; arrivalDate: string | null; documentNumber?: string };
export type PlanTotals = {
  planCost: number; annualCarryingCost: number; unitsShortBefore: number; unitsShortAfter: number; revenueAtRiskBefore: number;
  revenueAtRiskAfter: number; revenueProtected: number; weeksBelowSafetyStock: number; eoReleased: number; approver: string;
};
export type Plan = {
  id: string; exposureId: string; status: 'proposed' | 'booked'; actions: PlanAction[]; totals: PlanTotals; rationale: string | null;
  proposedBy: string; bookedBy: string | null; deltaWritten: boolean; createdAt: string; bookedAt: string | null;
};
export type PlanEvent = { id?: string; exposure_id?: string; exposureId?: string; plan_id?: string | null; actor: string; kind: string; detail: string; at: string };

export type ExposureDetail = {
  exposure: Exposure; as_of: string; projection: ProjRow[]; inbound_pos: OpenPo[]; orders_at_risk: CustomerOrder[];
  orders_at_risk_value: number; signals: Signal[]; other_plants: Health[]; options: MitigationOption[]; baseline: SimResult;
  plans: { proposed: Plan | null; booked: Plan | null; events: PlanEvent[] };
};

export type DemandRow = { sku: string; plant_id: string; week_start: string; series: string; units: number; units_lower: number | null; units_upper: number | null };
export type Inventory = { as_of: string; health: Health[]; demand: DemandRow[]; plants: Record<string, string> };

export const fetchOverview = () => j<Overview>('/api/overview');
export const fetchExposure = (id: string) => j<ExposureDetail>(`/api/exposures/${encodeURIComponent(id)}`);
export const fetchInventory = () => j<Inventory>('/api/inventory');
export const fetchPlanEvents = (limit = 8) => j<PlanEvent[]>(`/api/plan-events?limit=${limit}`);
export type ActionInput = { option_id: string; qty: number | null };
export const simulatePlan = (id: string, actions: ActionInput[]) => post<SimResult>(`/api/exposures/${encodeURIComponent(id)}/simulate`, { actions });
export const bookPlan = (id: string, actions: ActionInput[], rationale: string | null) =>
  post<{ plan: Plan; deltaError: string | null }>(`/api/exposures/${encodeURIComponent(id)}/book`, { actions, rationale });

export const money = (v: number | null | undefined, compact = false) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (compact && Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (compact && Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3).toLocaleString('en-US')}K`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
};
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));
export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
