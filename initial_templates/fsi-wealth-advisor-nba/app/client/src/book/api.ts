/** Morning Book API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type BookRow = {
  id: string; household_name: string; primary_name: string; primary_age: number | null; segment: string | null; aum: number;
  sweep_cash: number | null; risk_profile: string | null; vulnerable: boolean; vulnerable_reason: string | null; book_rank: number;
  money_in_motion: number | null; lending_opportunity: number | null; aum_at_risk: number | null; signals_label: string | null;
  headline_signal: string | null; days_to_act: number | null; days_since_contact: number | null; top_model_action: string | null;
  top_model_status: string | null; best_suitable_action: string | null; best_expected_revenue: number | null;
  model_top_blocked: boolean; status: string; decision: string | null; decision_action: string | null; decided_at: string | null;
};

export type Summary = {
  households: number; advisor_name: string | null; book_aum: number; money_in_motion: number; aum_at_risk: number;
  lending_opportunity: number; act_this_week: number; at_risk_households: number; model_top_blocked: number; vulnerable: number;
  prepped: number; decided: number; meetings_booked: number; expected_revenue: number;
  by_signal: Array<{ signal: string; households: number; amount: number | null }>;
};

export type Signal = { type: string; date: string | null; amount: number | null; detail: string | null; days_to_act: number | null };
export type Account = { id: string; type: string; custodian: string; balance: number; rate: number | null; maturity: string | null };
export type Liability = { id: string; type: string; lender: string; balance: number; rate: number; originated: string | null; payment: number | null; property_value: number | null };
export type Note = {
  id: string; date: string; channel: string | null; text: string;
  ai?: { category: string | null; amount: string | null; timeframe: string | null; family_member: string | null; other_institution: string | null; sentiment: string | null; flight_risk: boolean } | null;
};
export type RuleResult = { rule_id: string; rule: string; result: 'PASS' | 'FAIL' | 'REVIEW'; finding: string; citation: string };
export type Recommendation = {
  action_code: string; action_name: string; category: string; complexity: string; trigger: string; signal: string;
  propensity: number; assets_in_scope: number; expected_revenue: number; model_rank: number;
  status: 'PASS' | 'REVIEW' | 'FAIL'; suitable_rank: number | null; failed_rules: string; rules: RuleResult[]; disclosures: string;
};
export type MeetingPrep = {
  headline: string; why_now: string[];
  model_pick: { action_code: string; action_name: string; propensity: number; status: string; blocked_because: string[] } | null;
  agenda: Array<{ action_code: string; action_name: string; status: string; assets: number; talking_point: string }>;
  deferred: Array<{ action_code: string; reason: string }>;
  disclosures: Array<{ code: string; text: string }>;
  policy_guidance: { question: string; answer: string; sources: string } | null;
  outreach: { channel: string; subject: string; body: string }; call_opener: string; model: string; generated_at: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };

export type ClientDetail = {
  id: string; advisorId: string; advisorName: string | null; householdName: string; primaryName: string; primaryAge: number | null;
  segment: string | null; aum: number; sweepCash: number | null; netWorth: number | null; riskProfile: string | null; riskScore: number | null;
  timeHorizonYears: number | null; liquidityNeed: string | null; investmentExperience: string | null; maritalStatus: string | null;
  vulnerable: boolean; vulnerableReason: string | null; trustedContactOnFile: boolean | null; tenureYears: number | null;
  lastContactDate: string | null; bookRank: number; moneyInMotion: number | null; lendingOpportunity: number | null; aumAtRisk: number | null;
  signalsLabel: string | null; headlineSignal: string | null; daysToAct: number | null; daysSinceContact: number | null;
  topModelAction: string | null; topModelStatus: string | null; bestSuitableAction: string | null; modelTopBlocked: boolean;
  signals: Signal[]; accounts: Account[]; liabilities: Liability[]; notes: Note[]; recommendations: Recommendation[];
  status: string; meetingPrep: MeetingPrep | null; preppedAt: string | null; outreachDraft: string | null; decision: string | null;
  decisionAction: string | null; decisionNotes: string | null; decidedBy: string | null; decidedAt: string | null; auditTrail: AuditEntry[];
};

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export async function fetchBook(params: Record<string, string | undefined>): Promise<BookRow[]> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return (await okOrThrow(await fetch(`/api/book?${q}`), 'book')).json();
}
export async function fetchSummary(): Promise<Summary> {
  return (await okOrThrow(await fetch('/api/book/summary'), 'summary')).json();
}
export async function fetchClient(id: string): Promise<ClientDetail> {
  return (await okOrThrow(await fetch(`/api/clients/${encodeURIComponent(id)}`), 'client')).json();
}
export async function decide(id: string, body: { decision: string; action?: string; notes?: string; outreach?: string }): Promise<{ client: ClientDetail; deltaWriteBack: string }> {
  return (await okOrThrow(await fetch(`/api/clients/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'decision')).json();
}
export type ActivityRow = { client_id: string; household_name: string; primary_name: string; at: string; by: string; action: string; notes: string | null };
export async function fetchActivity(limit = 12): Promise<ActivityRow[]> {
  return (await okOrThrow(await fetch(`/api/activity/recent?limit=${limit}`), 'activity')).json();
}

/** POST /prep and parse the SSE stream (event: step | result | error). */
export async function runPrep(
  id: string,
  on: { step: (e: StepEvent) => void; result: (r: { prep: MeetingPrep }) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/clients/${encodeURIComponent(id)}/prep`, { method: 'POST' });
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
export const short = (n: number | null | undefined) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};
export const ACTION_SHORT: Record<string, string> = {
  'CD-LADDER': 'CD / Treasury ladder', 'CASH-MMF': 'Govt money market', 'MANAGED-PORTFOLIO': 'Managed portfolio',
  'STRUCTURED-NOTE': 'Structured note', 'PRIVATE-CREDIT': 'Private credit fund', 'DIRECT-INDEX': 'Direct indexing',
  'IRA-ROLLOVER': '401(k) → IRA rollover', 'MORTGAGE-REFI': 'Mortgage refinance', SBLOC: 'Securities-based credit line',
  'ESTATE-REVIEW': 'Estate & beneficiary review', 'EDU-529': '529 plan', 'ANNUAL-REVIEW': 'Annual review',
};
