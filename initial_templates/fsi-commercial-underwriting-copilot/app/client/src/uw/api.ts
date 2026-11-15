/** Underwriting desk API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type SubStatus = 'new' | 'review_drafted' | 'referred' | 'decided';
export type Decision = 'QUOTE' | 'QUOTE_WITH_CONDITIONS' | 'DECLINE' | 'REQUEST_INFO';

export type QueueRow = {
  id: string; insured_name: string; broker_name: string; broker_tier: string | null; segment: string; segment_code: string; state: string;
  hail_belt: boolean; received_ts: string; effective_date: string | null; days_to_effective: number | null; sov_tiv: number; sov_locations: number;
  loss_run_claims: number; loss_run_incurred: number; discrepancy_count: number; rules_hit: string[]; p_as_submitted: number | null;
  p_verified: number | null; band_as_submitted: string | null; band_verified: string | null; triage_lane: string; priority_score: number;
  premium_potential: number | null; status: SubStatus; decision: Decision | null; review_premium: number | null; review_decision: Decision | null;
  referral_required: boolean | null;
};
export type QueueSummary = {
  submissions: number; tiv: number; premium_potential: number; documents_disagree: number; fast_track: number; decline_lane: number;
  hidden_high_risk: number; drafted: number; referred: number; decided: number; effective_3wks: number;
  lanes: Array<{ triage_lane: string; n: number; tiv: number }>;
};
export type AppStated = {
  locations: number | null; tiv: number | null; construction: string | null; year_built: number | null; roof_year: number | null;
  sprinklered: boolean | null; protection_class: number | null; loss_count: number | null; loss_amount: number | null;
};
export type SovLoc = {
  id: string; locNo: number; buildingName: string; address: string | null; city: string | null; state: string | null; construction: string | null;
  yearBuilt: number | null; roofYear: number | null; roofAgeYears: number | null; stories: number | null; units: number | null; sprinklered: boolean;
  protectionClass: number | null; tiv: number; coastalTier1: boolean;
};
export type LrClaim = {
  id: string; claimNumber: string | null; lossDate: string | null; line: string | null; locNo: number | null; cause: string | null; paid: number;
  reserve: number; totalIncurred: number; status: string | null; windHail: boolean;
};
export type Doc = { id: string; docType: string; fileName: string; filePath: string; elements: number | null };
export type RuleCheck = { rule_id: string; doc_ref: string; title: string; status: 'pass' | 'fail' | 'refer' | 'info' | 'resolved'; detail: string; locations?: number[] };
export type LocationQuote = {
  loc_no: number; building_name: string; city: string | null; construction: string | null; roof_age: number | null; sprinklered: boolean; tiv: number;
  included: boolean; exclusion_reason: string | null; factors: Record<string, number>; premium: number; wind_hail_deductible_pct: number;
};
export type Review = {
  review_id: string; submission_id: string; generated_at: string; drafted_by: string; discrepancies: string[];
  risk: { p_as_submitted: number | null; p_verified: number | null; band_as_submitted: string | null; band_verified: string | null; drivers: string | null };
  rules: RuleCheck[]; guidance: { question: string; answer: string; sources: string[] } | null; locations: LocationQuote[];
  pricing: { tiv_submitted: number; tiv_quoted: number; property_premium: number; gl_premium: number; total_premium: number; rate_per_100: number;
    target_premium: number | null; experience_mod: number; ml_mod: number; ml_band: string | null };
  decision: Decision; conditions: string[]; excluded_locations: number[]; referral_required: boolean; referral_reasons: string[];
  rationale: string; broker_letter: string; model: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string };
export type SubmissionDetail = {
  id: string; insuredName: string; businessDescription: string | null; brokerName: string; brokerTier: string | null; brokerContact: string | null;
  segmentCode: string; segment: string; state: string; hailBelt: boolean; receivedTs: string; effectiveDate: string | null; daysToEffective: number | null;
  remarks: string | null; annualRevenue: number | null; targetPremium: number | null; expiringPremium: number | null; priorCarrier: string | null;
  app: AppStated; sovTiv: number; sovLocations: number; lossRunClaims: number; lossRunIncurred: number; lossRunValued: string | null;
  lossRunYears: number | null; lossRunCarrier: string | null; discrepancies: string[]; rulesHit: string[]; pAsSubmitted: number | null;
  pVerified: number | null; bandAsSubmitted: string | null; bandVerified: string | null; riskDrivers: string | null; triageLane: string;
  priorityScore: number; premiumPotential: number | null; status: SubStatus; review: Review | null; reviewUpdatedAt: string | null;
  decision: Decision | null; decidedBy: string | null; decidedAt: string | null; cuoNote: string | null; auditTrail: AuditEntry[];
  locations: SovLoc[]; claims: LrClaim[]; documents: Doc[];
};
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type ReferralRow = {
  id: string; insured_name: string; broker_name: string; segment: string; state: string; sov_tiv: number; status: SubStatus;
  review_updated_at: string; decided_by: string | null; decided_at: string | null; cuo_note: string | null; decision: Decision | null;
  pricing: Review['pricing']; referral_reasons: string[]; rationale: string; review_decision: Decision; excluded_locations: number[];
  drafted_by: string; p_as_submitted: number | null; p_verified: number | null; band_as_submitted: string | null; band_verified: string | null;
};
export type ActivityRow = { submission_id: string; insured_name: string; at: string; by: string; action: string; notes: string | null };

const get = async <T,>(url: string, label: string): Promise<T> => (await okOrThrow(await fetch(url), label)).json();
const post = async <T,>(url: string, body: unknown, label: string): Promise<T> =>
  (await okOrThrow(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }), label)).json();

export const fetchQueue = () => get<QueueRow[]>('/api/submissions', 'queue');
export const fetchSummary = () => get<QueueSummary>('/api/queue/summary', 'summary');
export const fetchSubmission = (id: string) => get<SubmissionDetail>(`/api/submissions/${encodeURIComponent(id)}`, 'submission');
export const fetchReferrals = () => get<ReferralRow[]>('/api/referrals', 'referrals');
export const fetchActivity = (limit = 10) => get<ActivityRow[]>(`/api/activity/recent?limit=${limit}`, 'activity');
export const pdfUrl = (docId: string) => `/api/documents/${encodeURIComponent(docId)}/pdf`;
export const issueDecision = (id: string, note?: string) =>
  post<{ status: SubStatus; deltaWriteBack?: string }>(`/api/submissions/${encodeURIComponent(id)}/issue`, { note }, 'issue');
export const approveReferral = (id: string, note?: string) =>
  post<{ status: SubStatus; deltaWriteBack?: string }>(`/api/submissions/${encodeURIComponent(id)}/approve`, { note }, 'approve');
export const sendBackReferral = (id: string, note?: string) =>
  post<{ status: SubStatus }>(`/api/submissions/${encodeURIComponent(id)}/send-back`, { note }, 'send-back');

/** POST /review and parse the SSE stream (event: step | result | error). */
export async function runReview(
  id: string,
  on: { step: (e: StepEvent) => void; result: (r: Review) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/submissions/${encodeURIComponent(id)}/review`, { method: 'POST' });
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
      else if (ev === 'result') on.result(parsed.review);
      else if (ev === 'error') on.error(parsed.message);
    }
  }
}

export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
export const musd = (n: number | null | undefined) => (n == null ? '—' : `$${(Number(n) / 1e6).toFixed(1)}M`);
export const kusd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(Number(n) / 1000).toLocaleString('en-US')}K`);
export const pct = (n: number | null | undefined, d = 0) => (n == null ? '—' : `${(Number(n) * 100).toFixed(d)}%`);
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
export const STATUS_LABEL: Record<SubStatus, string> = { new: 'New', review_drafted: 'Review drafted', referred: 'With the CUO', decided: 'Decision issued' };
export const DECISION_LABEL: Record<Decision, string> = {
  QUOTE: 'Quote', QUOTE_WITH_CONDITIONS: 'Quote with conditions', DECLINE: 'Decline', REQUEST_INFO: 'Request information',
};
