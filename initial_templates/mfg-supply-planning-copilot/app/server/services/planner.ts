/**
 * Deterministic supply-planning engine.
 *
 *   loadPlanningData()  — reads the Delta gold tables once (cached) through the SQL warehouse
 *   buildOptions()      — the mitigation levers for one exposure, each priced and dated:
 *                           transfer   : re-allocate stock from another Corvane plant (surplus above
 *                                        its own safety stock for the whole horizon; E&O first)
 *                           expedite   : the primary supplier's air-freight offer (pulls units
 *                                        forward from the next un-shipped lot)
 *                           alternate  : order from the qualified alternate supplier (price premium
 *                                        + one-time setup)
 *                           safety_stock: raise safety stock one week (policy change, carrying cost)
 *   simulate()          — re-runs the 13-week projection with a set of actions → units short,
 *                         revenue at risk / protected, weeks below safety stock, cost, approver.
 *
 * Numbers and dates are never left to the LLM: the copilot calls these through tools and the
 * workbench renders the same results.
 */
import { execSql, type DataConfig } from '../db/sync.js';

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const nn = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export type Exposure = {
  exposure_id: string; plant_id: string; plant_name: string; component_id: string; component_name: string;
  exposure_type: 'STOCKOUT' | 'BELOW_SAFETY_STOCK'; first_stockout_week: string | null; first_below_ss_week: string | null;
  days_to_stockout: number | null; weeks_short: number; weeks_below_ss: number; on_hand_units: number; safety_stock_units: number;
  days_of_supply_now: number | null; peak_units_short: number; peak_units_short_if_on_time: number; revenue_per_unit: number;
  revenue_at_risk: number; affected_skus: string[]; primary_supplier: string; delayed_po_count: number; max_delay_days: number | null;
  delayed_units: number | null; delay_reason: string | null; root_cause: string; as_of_date: string;
};
export type ProjRow = {
  plant_id: string; component_id: string; week_start: string; week_index: number; on_hand_units: number;
  safety_stock_units: number; required_units: number; receipts: number; receipt_pos: string | null;
  projected_balance: number; balance_if_on_time: number;
};
export type OpenPo = {
  po_number: string; supplier_name: string; component_id: string; plant_id: string; quantity: number; po_value: number;
  order_date: string; promised_date: string; revised_eta: string; delay_days: number; is_delayed: boolean;
  delay_reason: string | null; status: string; ship_mode: string; lane: string; vessel: string | null;
};
type Sourcing = {
  supplier_id: string; supplier_name: string; component_id: string; plant_id: string; role: string; unit_price: number;
  contract_lead_time_days: number; ship_mode: string; lane: string; monthly_capacity_units: number; min_order_qty: number;
  air_expedite_cost_per_unit: number | null; air_expedite_lead_days: number | null; air_expedite_max_units: number | null;
  first_order_setup_cost: number; qualification: string;
};
type Lane = { from_plant_id: string; to_plant_id: string; ship_mode: string; transit_days: number; cost_per_shipment: number; units_per_shipment: number; handling_cost_per_unit: number };
export type CustomerOrder = { order_id: string; customer_name: string; customer_tier: string; plant_id: string; sku: string; quantity: number; order_value: number; requested_ship_date: string };
export type Signal = { message_id: string; received_ts: string; sender_org: string; subject: string; event_type: string; supplier_name: string; component: string; po_numbers: string; added_delay_days: number | null; new_eta: string | null; offered_quantity: number | null; offered_unit_cost: number | null; severity: string; summary: string; summary_conf: number | null };
export type Health = { plant_id: string; plant_name: string; component_id: string; component_name: string; category: string; abc_class: string; on_hand_units: number; unit_cost: number; inventory_value: number; safety_stock_units: number; avg_weekly_requirement: number; weeks_of_cover: number | null; days_of_supply: number | null; days_since_last_issue: number; eo_category: string; eo_units: number; eo_value: number };

export type PlanningData = {
  loadedAt: number; asOf: string;
  exposures: Exposure[]; projection: ProjRow[]; openPos: OpenPo[]; sourcing: Sourcing[]; lanes: Lane[];
  orders: CustomerOrder[]; signals: Signal[]; health: Health[];
  plants: Record<string, string>;
  fill: Array<{ plant_name: string; week_start: string; fill_rate: number; units_ordered: number; units_shipped: number }>;
  demand: Array<{ sku: string; plant_id: string; week_start: string; series: string; units: number; units_lower: number | null; units_upper: number | null }>;
  otd: Array<{ supplier_name: string; month: string; pos_received: number; on_time_pct: number; avg_days_late: number }>;
};

let cache: Promise<PlanningData> | null = null;
let cfgRef: DataConfig | null = null;
const TTL_MS = 15 * 60 * 1000;

export function configurePlanner(cfg: DataConfig | undefined) {
  if (cfg) cfgRef = cfg;
}

export function loadPlanningData(cfg?: DataConfig, force = false): Promise<PlanningData> {
  if (cfg) cfgRef = cfg;
  if (!cfgRef) return Promise.reject(new Error('data config missing (DEMO_CATALOG / DEMO_SCHEMA)'));
  const c = cfgRef;
  if (cache && !force) {
    return cache.then((d) => (Date.now() - d.loadedAt > TTL_MS ? loadPlanningData(c, true) : d));
  }
  const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
  const t = (name: string) => `${c.catalog}.${c.schema}.${name}`;
  const q = (stmt: string) => execSql<Row>(wh, stmt);
  cache = Promise.all([
    q(`SELECT *, CAST(first_stockout_week AS STRING) fsw, CAST(first_below_ss_week AS STRING) fbw, CAST(as_of_date AS STRING) aod, to_json(affected_skus) skus FROM ${t('stockout_exposures')} ORDER BY revenue_at_risk DESC, weeks_below_ss DESC`),
    q(`SELECT plant_id, component_id, CAST(week_start AS STRING) week_start, week_index, on_hand_units, safety_stock_units, required_units, receipts, receipt_pos, projected_balance, balance_if_on_time FROM ${t('inventory_projection')} ORDER BY plant_id, component_id, week_index`),
    q(`SELECT po_number, supplier_name, component_id, plant_id, quantity, po_value, CAST(order_date AS STRING) order_date, CAST(promised_date AS STRING) promised_date, CAST(revised_eta AS STRING) revised_eta, delay_days, is_delayed, delay_reason, status, ship_mode, lane, vessel FROM ${t('gold_open_purchase_orders')} ORDER BY revised_eta`),
    q(`SELECT sr.*, su.supplier_name FROM ${t('sourcing')} sr JOIN ${t('suppliers')} su USING (supplier_id)`),
    q(`SELECT * FROM ${t('transfer_lanes')}`),
    q(`SELECT order_id, customer_name, customer_tier, plant_id, sku, quantity, order_value, CAST(requested_ship_date AS STRING) requested_ship_date FROM ${t('customer_orders')} WHERE status = 'OPEN' ORDER BY requested_ship_date`),
    q(`SELECT message_id, CAST(received_ts AS STRING) received_ts, sender_org, subject, event_type, supplier_name, component, to_json(po_numbers) po_numbers, added_delay_days, CAST(new_eta AS STRING) new_eta, offered_quantity, offered_unit_cost, severity, summary, summary_conf FROM ${t('supplier_signals')} ORDER BY received_ts DESC`),
    q(`SELECT * FROM ${t('gold_inventory_health')}`),
    q(`SELECT plant_id, plant_name FROM ${t('plants')}`),
    q(`SELECT plant_name, CAST(week_start AS STRING) week_start, sum(units_shipped) / sum(units_ordered) fill_rate, sum(units_ordered) units_ordered, sum(units_shipped) units_shipped FROM ${t('gold_fill_rate_weekly')} WHERE week_start >= date_sub((SELECT max(week_start) FROM ${t('gold_fill_rate_weekly')}), 7 * 25) GROUP BY ALL ORDER BY week_start`),
    q(`SELECT sku, plant_id, CAST(week_start AS STRING) week_start, series, units, units_lower, units_upper FROM ${t('gold_demand_weekly')} ORDER BY week_start`),
    q(`SELECT supplier_name, CAST(month AS STRING) month, pos_received, on_time_pct, avg_days_late FROM ${t('gold_supplier_performance_monthly')} ORDER BY month`),
  ]).then(([ex, pr, po, so, la, co, sg, he, pl, fi, de, ot]) => {
    const exposures: Exposure[] = ex.map((r) => ({
      exposure_id: s(r.exposure_id), plant_id: s(r.plant_id), plant_name: s(r.plant_name), component_id: s(r.component_id),
      component_name: s(r.component_name), exposure_type: s(r.exposure_type) as Exposure['exposure_type'],
      first_stockout_week: (r.fsw as string) ?? null, first_below_ss_week: (r.fbw as string) ?? null,
      days_to_stockout: nn(r.days_to_stockout), weeks_short: n(r.weeks_short), weeks_below_ss: n(r.weeks_below_ss),
      on_hand_units: n(r.on_hand_units), safety_stock_units: n(r.safety_stock_units), days_of_supply_now: nn(r.days_of_supply_now),
      peak_units_short: n(r.peak_units_short), peak_units_short_if_on_time: n(r.peak_units_short_if_on_time),
      revenue_per_unit: n(r.revenue_per_unit), revenue_at_risk: n(r.revenue_at_risk),
      affected_skus: JSON.parse(s(r.skus) || '[]') as string[], primary_supplier: s(r.primary_supplier),
      delayed_po_count: n(r.delayed_po_count), max_delay_days: nn(r.max_delay_days), delayed_units: nn(r.delayed_units),
      delay_reason: (r.delay_reason as string) ?? null, root_cause: s(r.root_cause), as_of_date: s(r.aod),
    }));
    const projection: ProjRow[] = pr.map((r) => ({
      plant_id: s(r.plant_id), component_id: s(r.component_id), week_start: s(r.week_start), week_index: n(r.week_index),
      on_hand_units: n(r.on_hand_units), safety_stock_units: n(r.safety_stock_units), required_units: n(r.required_units),
      receipts: n(r.receipts), receipt_pos: (r.receipt_pos as string) ?? null, projected_balance: n(r.projected_balance),
      balance_if_on_time: n(r.balance_if_on_time),
    }));
    const openPos: OpenPo[] = po.map((r) => ({
      po_number: s(r.po_number), supplier_name: s(r.supplier_name), component_id: s(r.component_id), plant_id: s(r.plant_id),
      quantity: n(r.quantity), po_value: n(r.po_value), order_date: s(r.order_date), promised_date: s(r.promised_date),
      revised_eta: s(r.revised_eta), delay_days: n(r.delay_days), is_delayed: r.is_delayed === true || r.is_delayed === 'true',
      delay_reason: (r.delay_reason as string) ?? null, status: s(r.status), ship_mode: s(r.ship_mode), lane: s(r.lane), vessel: (r.vessel as string) ?? null,
    }));
    const sourcing: Sourcing[] = so.map((r) => ({
      supplier_id: s(r.supplier_id), supplier_name: s(r.supplier_name), component_id: s(r.component_id), plant_id: s(r.plant_id),
      role: s(r.role), unit_price: n(r.unit_price), contract_lead_time_days: n(r.contract_lead_time_days), ship_mode: s(r.ship_mode),
      lane: s(r.lane), monthly_capacity_units: n(r.monthly_capacity_units), min_order_qty: n(r.min_order_qty),
      air_expedite_cost_per_unit: nn(r.air_expedite_cost_per_unit), air_expedite_lead_days: nn(r.air_expedite_lead_days),
      air_expedite_max_units: nn(r.air_expedite_max_units), first_order_setup_cost: n(r.first_order_setup_cost), qualification: s(r.qualification),
    }));
    const lanes: Lane[] = la.map((r) => ({
      from_plant_id: s(r.from_plant_id), to_plant_id: s(r.to_plant_id), ship_mode: s(r.ship_mode), transit_days: n(r.transit_days),
      cost_per_shipment: n(r.cost_per_shipment), units_per_shipment: n(r.units_per_shipment), handling_cost_per_unit: n(r.handling_cost_per_unit),
    }));
    const orders: CustomerOrder[] = co.map((r) => ({
      order_id: s(r.order_id), customer_name: s(r.customer_name), customer_tier: s(r.customer_tier), plant_id: s(r.plant_id), sku: s(r.sku),
      quantity: n(r.quantity), order_value: n(r.order_value), requested_ship_date: s(r.requested_ship_date),
    }));
    const signals: Signal[] = sg.map((r) => ({
      message_id: s(r.message_id), received_ts: s(r.received_ts), sender_org: s(r.sender_org), subject: s(r.subject),
      event_type: s(r.event_type), supplier_name: s(r.supplier_name), component: s(r.component), po_numbers: s(r.po_numbers),
      added_delay_days: nn(r.added_delay_days), new_eta: (r.new_eta as string) || null, offered_quantity: nn(r.offered_quantity),
      offered_unit_cost: nn(r.offered_unit_cost), severity: s(r.severity), summary: s(r.summary), summary_conf: nn(r.summary_conf),
    }));
    const health: Health[] = he.map((r) => ({
      plant_id: s(r.plant_id), plant_name: s(r.plant_name), component_id: s(r.component_id), component_name: s(r.component_name),
      category: s(r.category), abc_class: s(r.abc_class), on_hand_units: n(r.on_hand_units), unit_cost: n(r.unit_cost),
      inventory_value: n(r.inventory_value), safety_stock_units: n(r.safety_stock_units), avg_weekly_requirement: n(r.avg_weekly_requirement),
      weeks_of_cover: nn(r.weeks_of_cover), days_of_supply: nn(r.days_of_supply), days_since_last_issue: n(r.days_since_last_issue),
      eo_category: s(r.eo_category), eo_units: n(r.eo_units), eo_value: n(r.eo_value),
    }));
    return {
      loadedAt: Date.now(), asOf: exposures[0]?.as_of_date ?? projection[0]?.week_start ?? '',
      exposures, projection, openPos, sourcing, lanes, orders, signals, health,
      plants: Object.fromEntries(pl.map((r) => [s(r.plant_id), s(r.plant_name)])),
      fill: fi.map((r) => ({ plant_name: s(r.plant_name), week_start: s(r.week_start), fill_rate: n(r.fill_rate), units_ordered: n(r.units_ordered), units_shipped: n(r.units_shipped) })),
      otd: ot.map((r) => ({ supplier_name: s(r.supplier_name), month: s(r.month), pos_received: n(r.pos_received), on_time_pct: n(r.on_time_pct), avg_days_late: n(r.avg_days_late) })),
      demand: de.map((r) => ({ sku: s(r.sku), plant_id: s(r.plant_id), week_start: s(r.week_start), series: s(r.series), units: n(r.units), units_lower: nn(r.units_lower), units_upper: nn(r.units_upper) })),
    };
  });
  cache.catch(() => { cache = null; });
  return cache;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekIndexOf = (asOf: string, iso: string) =>
  Math.floor((new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / (7 * 86400000));
const roundUp = (x: number, step: number) => Math.ceil(x / step) * step;
export const approverFor = (cost: number) =>
  cost <= 25000 ? 'Plant supply planner' : cost <= 50000 ? 'Plant manager' : 'VP Supply Chain';

export function rowsFor(d: PlanningData, component: string, plant: string): ProjRow[] {
  return d.projection.filter((r) => r.component_id === component && r.plant_id === plant).sort((a, b) => a.week_index - b.week_index);
}

/** Units needed from week `fromWeek` on to keep the balance ≥ safety stock. */
function unitsNeeded(rows: ProjRow[], fromWeek: number): number {
  let need = 0;
  for (const r of rows) if (r.week_index >= fromWeek) need = Math.max(need, r.safety_stock_units - r.projected_balance);
  return Math.max(0, need);
}

export type MitigationOption = {
  option_id: string;
  type: 'transfer' | 'expedite' | 'alternate' | 'safety_stock';
  title: string;
  source: string;
  detail: string;
  lead_days: number;
  arrival_date: string | null;
  arrival_week: number | null;
  default_qty: number;
  max_qty: number;
  min_qty: number;
  unit_label: string;
  cost_formula: string;
  eo_note: string | null;
  policy_rank: number; // CSP-03 §3.1 order of preference
  // evaluation of THIS option alone at its default qty
  alone: SimResult;
};

export type ActionInput = { option_id: string; qty?: number | null };

export type SimWeek = { week_index: number; week_start: string; required: number; receipts: number; balance: number; baseline: number; safety_stock: number };
export type SimResult = {
  weeks: SimWeek[];
  units_short: number; weeks_short: number; first_stockout_week: string | null;
  weeks_below_safety_stock: number; min_balance: number;
  revenue_at_risk: number; revenue_protected: number;
  plan_cost: number; annual_carrying_cost: number; eo_released: number; approver: string;
  actions: Array<{ option_id: string; type: MitigationOption['type']; title: string; qty: number; cost: number; arrival_date: string | null }>;
};

export function getExposure(d: PlanningData, id: string): Exposure | undefined {
  return d.exposures.find((e) => e.exposure_id.toLowerCase() === id.toLowerCase());
}

type OptionSpec = Omit<MitigationOption, 'alone'> & {
  apply: (qty: number, ctx: { receipts: number[]; ssExtra: { units: number } }) => void;
  cost: (qty: number) => number;
  carrying: (qty: number) => number;
  eo: (qty: number) => number;
};

function optionSpecs(d: PlanningData, e: Exposure): OptionSpec[] {
  const rows = rowsFor(d, e.component_id, e.plant_id);
  const asOf = d.asOf;
  const specs: OptionSpec[] = [];
  const avgReq = rows.length ? rows.reduce((a, r) => a + r.required_units, 0) / rows.length : 0;
  const unitCost = d.health.find((h) => h.component_id === e.component_id && h.plant_id === e.plant_id)?.unit_cost ?? 0;
  const at = (lead: number) => {
    const date = addDays(asOf, lead);
    return { date, week: Math.max(0, weekIndexOf(asOf, date)) };
  };

  // 1. inter-plant transfers (E&O first)
  for (const lane of d.lanes.filter((l) => l.to_plant_id === e.plant_id)) {
    const src = rowsFor(d, e.component_id, lane.from_plant_id);
    if (!src.length) continue;
    const surplus = Math.floor(Math.max(0, Math.min(...src.map((r) => r.projected_balance - r.safety_stock_units))) / 10) * 10;
    if (surplus <= 0) continue;
    const h = d.health.find((x) => x.component_id === e.component_id && x.plant_id === lane.from_plant_id);
    const eoUnits = h && h.eo_category !== 'Healthy' && h.eo_category !== 'Below safety stock' ? h.eo_units : 0;
    const { date, week } = at(lane.transit_days);
    const need = unitsNeeded(rows, week);
    const qty = Math.min(surplus, Math.max(100, roundUp(need, 100)));
    const fromName = d.plants[lane.from_plant_id] ?? lane.from_plant_id;
    specs.push({
      option_id: `TRANSFER-${lane.from_plant_id}`, type: 'transfer', policy_rank: 1,
      title: `Transfer ${e.component_id} from ${fromName}`,
      source: `${fromName} (${lane.from_plant_id})`,
      detail: `${lane.ship_mode}, ${lane.transit_days} days door to door. ${fromName} can spare ${surplus.toLocaleString()} units above its own safety stock for all 13 weeks${eoUnits ? ` — ${eoUnits.toLocaleString()} of them are ${h?.eo_category.toLowerCase()} stock (${h?.days_since_last_issue} days without an issue)` : ''}.`,
      lead_days: lane.transit_days, arrival_date: date, arrival_week: week, default_qty: qty, max_qty: surplus, min_qty: 10,
      unit_label: 'units',
      cost_formula: `$${lane.cost_per_shipment.toLocaleString()} per shipment (${lane.units_per_shipment} units) + $${lane.handling_cost_per_unit.toFixed(2)}/unit handling & customs`,
      eo_note: eoUnits ? `Releases the ${h?.eo_category.toLowerCase()} reserve on the units moved (${fromName} has $${Math.round(h!.eo_value).toLocaleString()} of ${e.component_id} in E&O).` : null,
      apply: (q, c) => { c.receipts[week] += q; },
      cost: (q) => Math.ceil(q / lane.units_per_shipment) * lane.cost_per_shipment + q * lane.handling_cost_per_unit,
      carrying: () => 0,
      eo: (q) => Math.min(q, eoUnits) * (h?.unit_cost ?? 0),
    });
  }

  const primary = d.sourcing.find((x) => x.component_id === e.component_id && x.plant_id === e.plant_id && x.role === 'primary');

  // 2. qualified alternate supplier
  for (const alt of d.sourcing.filter((x) => x.component_id === e.component_id && x.plant_id === e.plant_id && x.role === 'alternate')) {
    const { date, week } = at(alt.contract_lead_time_days);
    const need = unitsNeeded(rows, week);
    const qty = Math.min(alt.monthly_capacity_units, Math.max(alt.min_order_qty, roundUp(need, 100)));
    const premium = alt.unit_price - (primary?.unit_price ?? alt.unit_price);
    specs.push({
      option_id: `ALTERNATE-${alt.supplier_id}`, type: 'alternate', policy_rank: 2,
      title: `Order from ${alt.supplier_name} (qualified alternate)`,
      source: alt.supplier_name,
      detail: `${alt.qualification}. $${alt.unit_price.toFixed(2)}/unit vs $${(primary?.unit_price ?? 0).toFixed(2)} primary, ${alt.contract_lead_time_days}-day lead time (${alt.ship_mode}), capacity ${alt.monthly_capacity_units.toLocaleString()}/month, MOQ ${alt.min_order_qty}.`,
      lead_days: alt.contract_lead_time_days, arrival_date: date, arrival_week: week, default_qty: qty,
      max_qty: alt.monthly_capacity_units, min_qty: alt.min_order_qty, unit_label: 'units',
      cost_formula: `$${premium.toFixed(2)}/unit premium over the primary price + $${alt.first_order_setup_cost.toLocaleString()} one-time setup`,
      eo_note: null,
      apply: (q, c) => { c.receipts[week] += q; },
      cost: (q) => q * premium + alt.first_order_setup_cost,
      carrying: () => 0, eo: () => 0,
    });
  }

  // 3. air-expedite from the primary supplier (pulls units from the next un-shipped lot)
  if (primary && primary.air_expedite_cost_per_unit && primary.air_expedite_lead_days && primary.air_expedite_max_units) {
    const nextLot = d.openPos
      .filter((p) => p.component_id === e.component_id && p.plant_id === e.plant_id && p.status === 'OPEN')
      .sort((a, b) => a.revised_eta.localeCompare(b.revised_eta))[0];
    const { date, week } = at(primary.air_expedite_lead_days);
    const lotWeek = nextLot ? weekIndexOf(asOf, nextLot.revised_eta) : null;
    const maxQ = Math.min(primary.air_expedite_max_units, nextLot?.quantity ?? primary.air_expedite_max_units);
    const need = unitsNeeded(rows, week);
    const qty = Math.min(maxQ, Math.max(100, roundUp(need, 100)));
    const unitAir = primary.air_expedite_cost_per_unit;
    specs.push({
      option_id: `EXPEDITE-${primary.supplier_id}`, type: 'expedite', policy_rank: 3,
      title: `Air-expedite from ${primary.supplier_name}`,
      source: primary.supplier_name,
      detail: `Supplier offer: up to ${maxQ.toLocaleString()} units by air in ${primary.air_expedite_lead_days} days at +$${unitAir.toFixed(2)}/unit.${nextLot ? ` Units come out of the next lot ${nextLot.po_number} (due ${nextLot.revised_eta}), so that receipt shrinks by the same amount.` : ''}`,
      lead_days: primary.air_expedite_lead_days, arrival_date: date, arrival_week: week, default_qty: qty,
      max_qty: maxQ, min_qty: 50, unit_label: 'units', cost_formula: `$${unitAir.toFixed(2)}/unit air-freight premium`,
      eo_note: null,
      apply: (q, c) => {
        c.receipts[week] += q;
        if (lotWeek !== null && lotWeek >= 0 && lotWeek < c.receipts.length) c.receipts[lotWeek] -= q;
      },
      cost: (q) => q * unitAir, carrying: () => 0, eo: () => 0,
    });
  }

  // 4. safety stock +1 week (policy change)
  const ssWeeks = e.safety_stock_units && avgReq ? Math.round((e.safety_stock_units / avgReq) * 2) / 2 : 2;
  specs.push({
    option_id: 'SAFETY-STOCK+1', type: 'safety_stock', policy_rank: 4,
    title: `Raise ${e.component_id} safety stock at ${e.plant_name} by 1 week`,
    source: 'Policy change (CSP-02 §2.2)',
    detail: `From ~${ssWeeks} to ~${ssWeeks + 1} weeks of cover (+${Math.round(avgReq).toLocaleString()} units) while the lane is disrupted. Protects future weeks; does not add supply by itself.`,
    lead_days: 0, arrival_date: null, arrival_week: null, default_qty: 1, max_qty: 2, min_qty: 1, unit_label: 'weeks',
    cost_formula: `annual carrying cost = 25% x standard cost ($${unitCost.toFixed(2)}) x extra units`,
    eo_note: null,
    apply: (q, c) => { c.ssExtra.units += Math.round(avgReq * q); },
    cost: () => 0, carrying: (q) => Math.round(avgReq * q) * unitCost * 0.25, eo: () => 0,
  });
  return specs;
}

function runSim(d: PlanningData, e: Exposure, specs: OptionSpec[], actions: ActionInput[]): SimResult {
  const rows = rowsFor(d, e.component_id, e.plant_id);
  const receipts = rows.map((r) => r.receipts);
  const ctx = { receipts, ssExtra: { units: 0 } };
  const applied: SimResult['actions'] = [];
  let cost = 0, carrying = 0, eo = 0;
  for (const a of actions) {
    const sp = specs.find((x) => x.option_id.toLowerCase() === a.option_id.toLowerCase());
    if (!sp) throw new Error(`unknown option_id ${a.option_id} for ${e.exposure_id} (valid: ${specs.map((x) => x.option_id).join(', ')})`);
    const qty = Math.max(sp.min_qty, Math.min(sp.max_qty, Math.round(a.qty ?? sp.default_qty)));
    sp.apply(qty, ctx);
    const c = sp.cost(qty);
    cost += c; carrying += sp.carrying(qty); eo += sp.eo(qty);
    applied.push({ option_id: sp.option_id, type: sp.type, title: sp.title, qty, cost: Math.round(c), arrival_date: sp.arrival_date });
  }
  const onHand = rows[0]?.on_hand_units ?? 0;
  let bal = onHand, minBal = Infinity, weeksShort = 0, belowSs = 0;
  let first: string | null = null;
  const weeks: SimWeek[] = rows.map((r, i) => {
    bal += receipts[i] - r.required_units;
    const ss = r.safety_stock_units + ctx.ssExtra.units;
    minBal = Math.min(minBal, bal);
    if (bal < 0) { weeksShort++; first ??= r.week_start; }
    if (bal < ss) belowSs++;
    return { week_index: r.week_index, week_start: r.week_start, required: r.required_units, receipts: receipts[i], balance: bal, baseline: r.projected_balance, safety_stock: ss };
  });
  const short = Math.max(0, -Math.min(0, minBal === Infinity ? 0 : minBal));
  const risk = short === e.peak_units_short ? Math.round(e.revenue_at_risk) : Math.round(short * e.revenue_per_unit);
  return {
    weeks, units_short: short, weeks_short: weeksShort, first_stockout_week: first, weeks_below_safety_stock: belowSs,
    min_balance: minBal === Infinity ? onHand : minBal, revenue_at_risk: risk,
    revenue_protected: Math.max(0, Math.round(e.revenue_at_risk) - risk), plan_cost: Math.round(cost),
    annual_carrying_cost: Math.round(carrying), eo_released: Math.round(eo), approver: approverFor(cost), actions: applied,
  };
}

export function buildOptions(d: PlanningData, e: Exposure): MitigationOption[] {
  const specs = optionSpecs(d, e);
  return specs
    .map(({ apply: _a, cost: _c, carrying: _k, eo: _e, ...o }) => ({ ...o, alone: runSim(d, e, specs, [{ option_id: o.option_id }]) }))
    .sort((a, b) => a.policy_rank - b.policy_rank);
}

export function simulate(d: PlanningData, e: Exposure, actions: ActionInput[]): SimResult {
  return runSim(d, e, optionSpecs(d, e), actions);
}

/** Everything the workbench shows for one exposure. */
export function exposureDetail(d: PlanningData, e: Exposure) {
  const rows = rowsFor(d, e.component_id, e.plant_id);
  const shortWeeks = rows.filter((r) => r.projected_balance < 0).map((r) => r.week_start);
  const lastShort = shortWeeks.length ? addDays(shortWeeks[shortWeeks.length - 1], 6) : null;
  const ordersAtRisk = shortWeeks.length
    ? d.orders.filter((o) => o.plant_id === e.plant_id && e.affected_skus.includes(o.sku) && o.requested_ship_date >= shortWeeks[0] && o.requested_ship_date <= (lastShort ?? ''))
    : [];
  const signals = d.signals.filter((sg) => (sg.component ?? '').toUpperCase().includes(e.component_id.toUpperCase()));
  return {
    exposure: e,
    as_of: d.asOf,
    projection: rows,
    inbound_pos: d.openPos.filter((p) => p.component_id === e.component_id && p.plant_id === e.plant_id),
    orders_at_risk: ordersAtRisk.sort((a, b) => (a.customer_tier + a.requested_ship_date).localeCompare(b.customer_tier + b.requested_ship_date)),
    orders_at_risk_value: Math.round(ordersAtRisk.reduce((a, o) => a + o.order_value, 0)),
    signals,
    other_plants: d.health.filter((h) => h.component_id === e.component_id && h.plant_id !== e.plant_id),
    supplier_otd: d.otd.filter((o) => o.supplier_name === e.primary_supplier).slice(-6),
    options: buildOptions(d, e),
    baseline: simulate(d, e, []),
  };
}

export function overview(d: PlanningData) {
  const byPlant = new Map<string, { w: string; fr: number }[]>();
  for (const f of d.fill) {
    if (!byPlant.has(f.plant_name)) byPlant.set(f.plant_name, []);
    byPlant.get(f.plant_name)!.push({ w: f.week_start, fr: f.fill_rate });
  }
  const weeks = [...new Set(d.fill.map((f) => f.week_start))].sort();
  const last4 = weeks.slice(-4), prior = weeks.slice(-17, -13);
  const agg = (ws: string[], plant?: string) => {
    const rows = d.fill.filter((f) => ws.includes(f.week_start) && (!plant || f.plant_name === plant));
    const o = rows.reduce((a, r) => a + r.units_ordered, 0), sh = rows.reduce((a, r) => a + r.units_shipped, 0);
    return o ? sh / o : 0;
  };
  const eo = d.health.filter((h) => h.eo_value > 0);
  const delayed = d.openPos.filter((p) => p.is_delayed);
  return {
    as_of: d.asOf,
    fill_rate_4w: agg(last4), fill_rate_prior: agg(prior),
    fill_rate_by_plant: Object.values(d.plants).map((p) => ({ plant: p, last_4w: agg(last4, p), prior: agg(prior, p) })),
    fill_trend: weeks.map((w) => ({ week_start: w, ...Object.fromEntries([...byPlant.entries()].map(([p, arr]) => [p, arr.find((x) => x.w === w)?.fr ?? null])) })),
    exposures: d.exposures,
    revenue_at_risk: Math.round(d.exposures.reduce((a, e) => a + e.revenue_at_risk, 0)),
    stockouts: d.exposures.filter((e) => e.exposure_type === 'STOCKOUT').length,
    eo_value: Math.round(eo.reduce((a, h) => a + h.eo_value, 0)),
    eo_items: eo.sort((a, b) => b.eo_value - a.eo_value),
    delayed_pos: delayed.length, delayed_units: delayed.reduce((a, p) => a + p.quantity, 0),
    signals: d.signals.filter((sg) => sg.severity === 'high' || sg.event_type === 'shipment_delay' || sg.event_type === 'supplier_allocation' || sg.event_type === 'capacity_offer' || sg.event_type === 'expedite_offer').slice(0, 6),
  };
}
