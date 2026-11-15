import { okOrThrow } from '@/lib/api';

/** Client types + fetchers for the Trade Promo Copilot REST surface (server/routes/promo.ts). */

export type PlanEvent = {
  id: string; retailerId: string; retailerName: string; sku: string; productName: string; brand: string | null;
  startWeek: string; endWeek: string | null; planWeek: number; weeks: number; plannerNote: string | null;
  scenarioKey: string; tactic: string; discountDepth: number | null; fundingMethod: string | null;
  featureAd: boolean | null; inStoreDisplay: boolean | null; promoPrice: number | null; regularShelfPrice: number | null;
  baselineUnits: number | null; forecastUnits: number | null; netIncrementalUnits: number | null; volumeKept: number | null;
  tradeSpend: number | null; incrementalGp: number | null; netProfit: number | null; roi: number | null; forecastFlag: string;
  originalTactic: string; originalNetProfit: number | null; originalRoi: number | null; originalFlag: string;
  recommendedScenarioKey: string | null; status: 'draft' | 'replanned' | 'approved'; decisionId: string | null;
};

export type PlanScenario = {
  planEventId: string; scenarioKey: string; label: string; tactic: string; isAsPlanned: boolean;
  discountDepth: number | null; fundingMethod: string | null; featureAd: boolean | null; inStoreDisplay: boolean | null;
  promoPrice: number | null; baselineUnits: number | null; forecastUnits: number | null; grossIncrementalUnits: number | null;
  dipUnits: number | null; cannibalizedUnits: number | null; forwardBuyUnits: number | null; netIncrementalUnits: number | null;
  volumeKept: number | null; tradeSpend: number | null; incrementalGp: number | null; netProfit: number | null; roi: number | null;
  policyCompliant: boolean; policyNotes: string | null; recommended: boolean; analogEvents: number | null;
};

export type PlanDecision = {
  id: string; planEventId: string; retailerName: string; productName: string; startWeek: string | null;
  fromLabel: string; toLabel: string; toScenarioKey: string; fromNetProfit: number | null; toNetProfit: number | null;
  fromRoi: number | null; toRoi: number | null; fromTradeSpend: number | null; toTradeSpend: number | null;
  fromVolume: number | null; toVolume: number | null; rationale: string | null; approvedBy: string; via: string;
  retailerNotice: string | null; createdAt: string;
};

export type PlanEventDetail = PlanEvent & { scenarios: PlanScenario[]; decisions: PlanDecision[] };

export type CurvePoint = {
  rel_week: number; phase: 'pre' | 'event' | 'post'; week_start: string; actual: number; baseline: number;
  sister_actual: number; sister_baseline: number; shipped: number; on_deal: number;
};

export type PromoEvent = {
  id: string; eventName: string; retailerId: string; retailerName: string; channel: string | null; sku: string; productName: string;
  brand: string | null; tactic: string; discountDepth: number | null; featureAd: boolean | null; inStoreDisplay: boolean | null;
  fundingMethod: string | null; startWeek: string; endWeek: string | null; weeks: number | null; quarter: string | null; last52: boolean | null;
  baselineUnits: number | null; actualUnits: number | null; grossIncrementalUnits: number | null; volumeLiftPct: number | null;
  dipUnits: number | null; cannibalizedUnits: number | null; forwardBuyUnits: number | null; netIncrementalUnits: number | null;
  allowancePerUnit: number | null; tradeSpend: number | null; fixedFees: number | null; subsidisedBaseline: number | null;
  forwardBuyCost: number | null; incrementalGp: number | null; netProfit: number | null; roi: number | null; verdict: string | null;
  curve?: CurvePoint[];
};

export type TacticSummary = {
  retailer_name: string; tactic: string; funding_method: string; events: number; volume_lift_pct: number;
  pantry_loading_pct_of_lift: number; cannibalization_pct_of_lift: number; forward_buy_pct_of_event_volume: number;
  trade_spend_usd: number; net_profit_usd: number; roi_pct: number; events_lost_money: number;
};

const get = async <T,>(url: string): Promise<T> => (await okOrThrow(await fetch(url), url)).json() as Promise<T>;

export const fetchPlan = () => get<PlanEvent[]>('/api/plan');
export const fetchPlanEvent = (id: string) => get<PlanEventDetail>(`/api/plan/${id}`);
export const fetchEvents = (q: { retailer?: string; tactic?: string } = {}) =>
  get<PromoEvent[]>(`/api/events?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`);
export const fetchEvent = (id: string) => get<PromoEvent>(`/api/events/${id}`);
export const fetchSummary = () => get<TacticSummary[]>('/api/events-summary');
export const fetchDecisions = () => get<PlanDecision[]>('/api/decisions');

export async function replanEvent(id: string, scenarioKey: string, rationale: string) {
  const res = await okOrThrow(await fetch(`/api/plan/${id}/replan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioKey, rationale }),
  }), 'replan');
  return res.json();
}
export async function revertPlanEvent(id: string) {
  return (await okOrThrow(await fetch(`/api/plan/${id}/revert`, { method: 'POST' }), 'revert')).json();
}

// ── formatting ───────────────────────────────────────────────────────────────
export const moneyK = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
};
export const signedK = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${moneyK(n)}` : moneyK(n));
export const pct = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? '—' : `${n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(digits)}%`;
export const signedPct = (n: number | null | undefined, digits = 0) => (n == null ? '—' : n > 0 ? `+${pct(n, digits)}` : pct(n, digits));
export const units = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
export const unitsK = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n)}`;
export const weekLabel = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

export const TACTIC_SHORT: Record<string, string> = {
  BOGO: 'BOGO', 'Feature + Display': 'Feature + Display', TPR: 'Shelf TPR', 'Multi-buy': 'Multi-buy',
};

export const flagTone = (flag: string): 'bad' | 'warn' | 'good' =>
  flag === 'Money-losing' ? 'bad' : flag === 'Below target' ? 'warn' : 'good';
