/** Retention-desk API client + types (mirrors server/db/schema.ts retention_cases). */
import { okOrThrow } from './api';

export type Driver = 'network' | 'bill_shock' | 'competitor' | 'care' | 'account' | 'port_out_intent';
export type CaseStatus = 'open' | 'offer_ready' | 'accepted' | 'declined';

export type StagedOffer = {
  offerCode: string; offerName: string; cost: number; guardrailCap: number;
  expectedSaveRate: number; expectedRetainedRevenue: number; channel: 'sms' | 'email' | 'call';
  subject: string; message: string; rationale: string; stagedBy: string; stagedAt: string;
};
export type LastCall = {
  callId: string; callTs: string; sentiment: string; intent: string; cancelThreat: boolean;
  competitor: string | null; requestedRemedy: string | null; summary: string; transcript: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };

export type CaseSummary = {
  customerId: string; customerName: string; segment: string; plan: string; lines: number;
  region: string; market: string; cellSiteId: string; tenureMonths: number; contractType: string;
  monthlyBill: number; churnProbability: number; riskTier: 'Critical' | 'High' | 'Medium';
  topDriver: Driver; drivers: Record<string, number>; reasons: string[]; signals: Record<string, number>;
  annualRevenueAtRisk: number; status: CaseStatus; stagedOffer: StagedOffer | null;
  decidedAt: string | null; decidedBy: string | null;
  lastCallIntent: string | null; lastCallSentiment: string | null;
};
export type OfferEvaluation = {
  offer_code: string; offer_name: string; description: string; target_driver: string; cost: number;
  guardrail_cap: number; within_guardrail: boolean; eligible: boolean; eligibility_reason: string;
  expected_save_rate: number; expected_net_value: number; allowed: boolean;
};
export type CaseDetail = Omit<CaseSummary, 'lastCallIntent' | 'lastCallSentiment'> & {
  lastCall: LastCall | null; auditTrail: AuditEntry[]; offers: OfferEvaluation[];
};

export type Kpis = {
  desk: {
    critical: number; high: number; medium: number; revenue_at_risk: number; arpu_book_at_risk: number;
    offers_ready: number; accepted: number; declined: number; revenue_saved: number; offer_spend: number;
    drivers: Array<{ top_driver: Driver; n: number; at_risk: number }>;
  };
  lake: {
    trend?: Array<{ month: string; churn_rate_pct: string; churned: string }>;
    strategy?: Array<{ offer_strategy: string; offers: string; save_rate_pct: string; avg_cost: string }>;
    lakehouseDecisions?: number;
    error?: string;
  };
};

export type WhatIfSide = {
  accounts: number; contacted: number; expected_saves: number; retained_revenue: number;
  offer_spend: number; net_margin_impact: number; guardrail_breaches: number;
  offer_mix: Array<{ code: string; accounts: number }>;
};
export type WhatIf = { tiers: string[]; contactRate: number; matched: WhatIfSide; blanket: WhatIfSide };

const get = async <T,>(url: string): Promise<T> => (await okOrThrow(await fetch(url), url)).json() as Promise<T>;

export const fetchCases = (p: Record<string, string>) =>
  get<CaseSummary[]>(`/api/cases?${new URLSearchParams(p).toString()}`);
export const fetchCase = (id: string) => get<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`);
export const fetchKpis = () => get<Kpis>('/api/kpis');
export const fetchWhatIf = (tiers: string[], contactRate: number) =>
  get<WhatIf>(`/api/whatif?tiers=${tiers.join(',')}&contactRate=${contactRate}`);

export async function postDecision(id: string, decision: 'accepted' | 'declined') {
  const res = await okOrThrow(
    await fetch(`/api/cases/${encodeURIComponent(id)}/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
    }),
    'decision',
  );
  return res.json() as Promise<{ deltaWriteBack: string }>;
}

export const DRIVER_META: Record<string, { label: string; color: string; short: string }> = {
  network: { label: 'Network quality', short: 'Network', color: '#2563EB' },
  bill_shock: { label: 'Bill shock', short: 'Bill shock', color: '#E4572E' },
  competitor: { label: 'Competitor offer', short: 'Competitor', color: '#9333EA' },
  care: { label: 'Care experience', short: 'Care', color: '#D97706' },
  port_out_intent: { label: 'Port-out intent', short: 'Port-out', color: '#DB2777' },
  account: { label: 'Account profile', short: 'Account', color: '#64748B' },
};

export const usd = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
export const usdK = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : usd(n);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

const DRIVER_KEYWORDS: Record<string, RegExp> = {
  network: /Dropped-call/i, bill_shock: /Switch & Save/i, competitor: /Crest|port-out/i, care: /call/i,
};
/** Model reasons with the ones explaining the top driver first. */
export function orderedReasons(reasons: string[], topDriver: string): string[] {
  const re = DRIVER_KEYWORDS[topDriver];
  return re ? [...reasons.filter((r) => re.test(r)), ...reasons.filter((r) => !re.test(r))] : reasons;
}
