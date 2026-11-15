/** Live-ops console API client + types (mirrors server/db/schema.ts segments). */
import { okOrThrow } from './api';

export type Driver = 'difficulty' | 'matchmaking' | 'toxicity' | 'engagement';
export type SegmentStatus = 'open' | 'plan_ready' | 'scheduled' | 'rejected';

export type EvidenceTile = { label: string; value: string; bad?: boolean; hint?: string };
export type TopPlayer = {
  playerId: string; gamertag: string; spenderTier: string; platform: string; churnProbability: number;
  riskTier: string; predictedLtv: number; atRiskLtv: number; reasons: string[];
};
export type ChatLine = { messageId: string; sentAt: string; channel: string; text: string; label: string; harmful: boolean };
export type StagedPlan = {
  interventionCode: string; interventionName: string; scope: string; coveredSegments: string[];
  playersTargeted: number; cost: number; expectedLift: number; expectedPlayersRetained: number;
  expectedLtvRetained: number; roi: number; budgetRemainingAfter: number; startDate: string;
  playerMessage: string; rationale: string; stagedBy: string; stagedAt: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };

export type SegmentSummary = {
  segmentId: string; segmentName: string; churnDriver: Driver; region: string;
  playersAtRisk: number; criticalPlayers: number; highPlayers: number; avgChurnProbability: number;
  atRiskLtv: number; ltvBook: number; payersAtRisk: number; whalesAtRisk: number; newPlayersAtRisk: number;
  drivers: Record<string, number>; evidence: EvidenceTile[]; status: SegmentStatus; stagedPlan: StagedPlan | null;
  scheduledAt: string | null; scheduledBy: string | null; topPlayer: TopPlayer | null;
};
export type InterventionEvaluation = {
  intervention_code: string; intervention_name: string; description: string; target_driver: string; kind: string;
  scope: string; covered_segments: string[]; players_targeted: number; cost: number; expected_lift_pp: number;
  expected_players_retained: number; expected_ltv_retained: number; roi: number; lead_time_days: number;
  historical_runs: number; budget_remaining: number; within_budget: boolean; matches_driver: boolean;
  reason: string; allowed: boolean;
};
export type Budget = { month: string; description: string; budget: number; committed: number; remaining: number; plansScheduled: number };
export type SegmentDetail = Omit<SegmentSummary, 'topPlayer'> & {
  topPlayers: TopPlayer[]; chatSample: ChatLine[]; auditTrail: AuditEntry[];
  budget: Budget; interventions: InterventionEvaluation[];
};

export type Kpis = {
  live: {
    players_at_risk: number; critical_players: number; at_risk_ltv: number; whales_at_risk: number;
    plans_ready: number; segments_scheduled: number; at_risk_ltv_covered: number; ltv_retained_expected: number;
    drivers: Array<{ churn_driver: Driver; players: number; at_risk: number; whales: number; segments: number }>;
    budget: Budget;
  };
  lake: {
    d7Trend?: Array<{ week: string; d7_pct: string }>;
    retention?: Array<{ period: 'pre' | 'post'; d1: string; d7: string; d30: string }>;
    arpdau?: Array<{ period: 'pre' | 'post'; arpdau: string; dau: string }>;
    strategy?: Array<{ strategy: string; runs: string; avg_lift_pp: string; cost_per_retained: string }>;
    lakehouseScheduled?: number;
    error?: string;
  };
};

export type WhatIf = {
  budget: number; at_risk_ltv: number;
  copilot: { spend: number; ltv_retained: number; players_retained: number; roi: number; segments_covered: number;
    plan: Array<{ code: string; segments: string; cost: number; ltv: number }> };
  blanket: { spend: number; ltv_retained: number; players_retained: number; roi: number; affordable: boolean; segments_covered: number } | null;
};

const get = async <T,>(url: string): Promise<T> => (await okOrThrow(await fetch(url), url)).json() as Promise<T>;

export const fetchSegments = (p: Record<string, string>) =>
  get<SegmentSummary[]>(`/api/segments?${new URLSearchParams(p).toString()}`);
export const fetchSegment = (id: string) => get<SegmentDetail>(`/api/segments/${encodeURIComponent(id)}`);
export const fetchKpis = () => get<Kpis>('/api/kpis');
export const fetchWhatIf = (budget: number) => get<WhatIf>(`/api/whatif?budget=${budget}`);

export async function postDecision(id: string, decision: 'scheduled' | 'rejected') {
  const res = await okOrThrow(
    await fetch(`/api/segments/${encodeURIComponent(id)}/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
    }),
    'decision',
  );
  return res.json() as Promise<{ deltaWriteBack: string }>;
}

export const DRIVER_META: Record<string, { label: string; color: string; short: string }> = {
  difficulty: { label: 'Difficulty spike', short: 'Difficulty', color: '#B06BFF' },
  matchmaking: { label: 'Matchmaking wait', short: 'Matchmaking', color: '#00E5FF' },
  toxicity: { label: 'Toxic chat', short: 'Toxicity', color: '#FF4D5E' },
  engagement: { label: 'Engagement decay', short: 'Engagement', color: '#8D86A8' },
  spend: { label: 'Spend fatigue', short: 'Spend', color: '#FFC93C' },
  profile: { label: 'Player profile', short: 'Profile', color: '#6F6790' },
};

export const usd = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits });
export const usdK = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `$${(n / 1000).toFixed(0)}K` : n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : usd(n);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
