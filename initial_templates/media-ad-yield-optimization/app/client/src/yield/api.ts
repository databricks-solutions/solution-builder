/** Yield-desk API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type CampaignLine = {
  line_id: string; product_id: string; product_name: string; platform: string; tier: string;
  booked: number; cpm: number; delivered: number; expected: number; pacing: number | null;
  run_rate: number; planned_daily: number; projected: number; avails_change: number | null;
};
export type Campaign = {
  id: string; ioNumber: string; name: string; advertiserName: string; advertiserCategory: string | null; agency: string | null;
  dealType: string | null; targetSegmentId: string; targetSegment: string; flightStart: string; flightEnd: string;
  deliveryStatus: string; salesOwner: string | null; makeGoodTerms: string | null; bookedImpressions: number; bookedRevenue: number;
  bookedCpm: number; flightDays: number | null; daysRemaining: number | null; delivered: number | null; expectedToDate: number | null;
  pacing: number | null; runRateDaily: number | null; projectedDelivery: number | null; projectedDeliveryPct: number | null;
  projectedShortfall: number | null; makeGoodLiability: number | null; atRisk: boolean; riskProductId: string | null;
  riskProductName: string | null; riskProductAvailsChange: number | null; lines: CampaignLine[]; status: string; planId: string | null;
  hasPlan?: boolean;
};
export type Finding = { id: string; title: string; verdict: 'CONFIRMED' | 'RULED_OUT' | 'INFO'; detail: string };
export type SpareOption = {
  product_id: string; product_name: string; platform: string; tier: string; eligible: boolean; reason: string;
  spare_avails: number; audience_share: number; in_target_spare: number; displaced_ecpm: number; programmatic_fill: number;
};
export type Reallocation = { product_id: string; product_name: string; tier: string; impressions: number; daily_cap: number; displaced_ecpm: number; displaced_revenue: number; audience_share: number };
export type FloorRecommendation = {
  product_id: string; product_name: string; from_group: string; to_group: string; from_floor: number; to_floor: number;
  release_from_deal: string | null; expected_uplift_window: number; expected_uplift_annualized: number; window_days: number; detail: string;
};
export type RecoveryPlan = {
  headline: string; diagnosis: string; summary: string; findings: Finding[];
  pacing: { booked: number; delivered: number; expected: number; pacing: number; projected: number; projected_pct: number; shortfall: number; liability: number; days_remaining: number; cpm: number };
  weekly_avails: Array<{ week: string; avails: number }>;
  spare: SpareOption[]; reallocations: Reallocation[]; floor_changes: FloorRecommendation[];
  impact: { impressions_moved: number; shortfall_covered: number; coverage_pct: number; liability_avoided: number; displaced_revenue: number; floor_uplift: number; net_impact: number };
  contract_guidance: { question: string; answer: string; source: string } | null;
  ad_ops_instructions: string; model: string; generated_at: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type YieldPlan = {
  id: string; campaignId: string; title: string; advertiserName: string; reallocations: Reallocation[]; floorChanges: FloorRecommendation[];
  impressionsMoved: number | null; shortfallCovered: number | null; liabilityAvoided: number | null; displacedRevenue: number | null;
  floorUplift: number | null; netImpact: number | null; agencyNotice: string | null; adOpsInstructions: string | null; status: string;
  approvedBy: string; approvedVia: string; notes: string | null; createdAt: string;
};
export type FloorChange = {
  id: string; productId: string; productName: string; fromGroup: string | null; toGroup: string | null; fromFloor: number | null; toFloor: number | null;
  releaseFromDeal: string | null; expectedUplift30d: number | null; expectedUpliftAnnualized: number | null; planId: string | null; rationale: string | null;
  status: string; requestedBy: string; requestedVia: string; createdAt: string;
};
export type CampaignDetail = Campaign & { analysis: RecoveryPlan | null; analyzedAt: string | null; agencyNoticeDraft: string | null; auditTrail: AuditEntry[]; approvedPlan: YieldPlan | null };
export type Opportunity = {
  productId: string; productName: string; platform: string | null; contentCategory: string | null; tier: string | null; rateCardCpm: number | null;
  rateCardGroup: string | null; rateCardGroupFloor: number | null; currentGroup: string | null; currentFloor: number | null; currentRuleId: string | null;
  currentRuleSince: string | null; currentRuleChangedBy: string | null; changeTicket: string | null; changeNote: string | null;
  sellThrough28d: number | null; guaranteedShare28d: number | null; pmpShare28d: number | null; openShare28d: number | null; ecpm28d: number | null;
  programmaticEcpm28d: number | null; pmpEcpm28d: number | null; openClearing28d: number | null; p50Bid28d: number | null; p90Bid28d: number | null;
  fillRetention: number | null; pmpImpressions28d: number | null; programmaticEcpmBeforeRule: number | null; groupMismatch: boolean;
  revenueGap28d: number | null; revenueGapAnnualized: number | null; revenueGapSinceRule: number | null; recommendedGroup: string | null;
  recommendedFloor: number | null; isLeak: boolean; floorChangeId: string | null;
  weekly: Array<{ week: string; programmatic_ecpm: number; open_clearing: number | null; pmp_share: number; group: string }>;
};
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type Summary = {
  live_campaigns: number; at_risk: number; make_good_liability: number; shortfall: number; booked_revenue_live: number; leaks: number;
  revenue_gap_28d: number; revenue_gap_annualized: number; plans: number; floor_changes: number;
};
export type ActivityRow = { campaign_id: string | null; subject: string; party: string; at: string; by: string; action: string; notes: string | null };

const j = async <T,>(url: string, what: string): Promise<T> => (await okOrThrow(await fetch(url), what)).json();
export const fetchSummary = () => j<Summary>('/api/yield/summary', 'summary');
export const fetchCampaigns = (riskOnly = false) => j<Campaign[]>(`/api/campaigns${riskOnly ? '?risk=1' : ''}`, 'campaigns');
export const fetchCampaign = (id: string) => j<CampaignDetail>(`/api/campaigns/${encodeURIComponent(id)}`, 'campaign');
export const fetchOpportunities = () => j<Opportunity[]>('/api/opportunities', 'yield board');
export const fetchPlans = () => j<YieldPlan[]>('/api/plans', 'yield plans');
export const fetchFloorChanges = () => j<FloorChange[]>('/api/floor-changes', 'floor changes');
export const fetchActivity = (limit = 10) => j<ActivityRow[]>(`/api/activity/recent?limit=${limit}`, 'activity');

export async function approvePlan(id: string, body: { notes?: string; noticeText?: string }): Promise<{ plan: YieldPlan; existing: boolean }> {
  return (await okOrThrow(await fetch(`/api/campaigns/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'approve plan')).json();
}
export async function restoreFloor(productId: string): Promise<{ change: FloorChange; existing: boolean }> {
  return (await okOrThrow(await fetch(`/api/opportunities/${encodeURIComponent(productId)}/floor`, { method: 'POST' }), 'floor change')).json();
}

/** POST /plan and parse the SSE stream (event: step | result | error). */
export async function runPlan(
  id: string,
  on: { step: (e: StepEvent) => void; result: (r: { plan: RecoveryPlan; notice: string }) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/campaigns/${encodeURIComponent(id)}/plan`, { method: 'POST' });
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

export const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const moneyK = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : Math.abs(n) >= 10_000 ? `$${Math.round(n / 1000)}K` : money(n);
export const cpm = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
export const imps = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n));
export const pct = (x: number | null | undefined, digits = 0) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);
export const HERO_CAMPAIGN = 'CMP-24017';
export const HERO_PRODUCT = 'STR-SPORTS-LIVE';

/** "first.last@corp.com" → "First Last" (keeps personal emails off screen). Emails inside a sentence too. */
export const who = (t: string | null | undefined) =>
  (t ?? '').replace(/([a-z0-9._-]+)@[a-z0-9.-]+\.[a-z]+/gi, (_m, u: string) =>
    u.split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '));

/** Sell-through by daypart x property over the last 28 days (read-only chart query). */
export type SellThroughCell = { daypart: string; platform: string; sell_through: number | null; avails: number | null };
export const fetchSellThrough = () => j<{ data: SellThroughCell[] }>('/api/charts/sell_through_heatmap', 'sell-through heatmap');
