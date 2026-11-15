/** Workbench API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type CaseRow = {
  id: string; program: string; county: string; channel: string | null; submitted_date: string; status: string;
  expedited_screening: boolean; head_first_name: string; head_last_name: string; household_size: number;
  preferred_language: string | null; caseworker_id: string | null; caseworker_name: string | null;
  decision: string | null; rfi_count: number; ai_recommendation: string | null; days_open: number;
  standard_days: number; doc_count: number; has_id: boolean; has_residency: boolean; has_income: boolean;
};

export type Summary = {
  open: number; overdue: number; expedited_open: number; expedited_late: number; awaiting_verification: number;
  decided: number; ai_checked: number; avg_days_open: number;
  by_county: Array<{ county: string; open: number; overdue: number }>;
};

export type Extracted = Partial<Record<
  'person_name' | 'issuer' | 'document_date' | 'expiration_date' | 'employment_end_date' | 'pay_frequency' |
  'street_address' | 'city' | 'state', string | null>> & {
  gross_pay?: number | null; monthly_rent?: number | null; account_balance?: number | null; declares_no_income?: boolean | null;
};

export type CaseDocument = {
  id: string; docType: string; receivedDate: string | null; fileName: string | null; pageCount: number | null;
  documentText: string | null; extracted: Extracted | null; extractionConfidence: number | null;
};

export type RuleResult = {
  rule_id: string; rule_name: string; category: string; result: 'PASS' | 'FAIL' | 'NEEDS_INFO' | 'FLAG';
  finding: string; evidence: string[]; cfr_citation: string; manual_section: string;
};

export type Assessment = {
  recommendation: 'APPROVE' | 'DENY' | 'REQUEST_VERIFICATION'; summary: string; countable_monthly_income: number;
  income_limit: number; estimated_monthly_benefit: number | null;
  timeliness: { standard_days: number; days_open: number; days_remaining: number; overdue: boolean; expedited: boolean };
  rules: RuleResult[]; missing_documents: Array<{ item: string; why: string; acceptable: string }>;
  policy_guidance: { question: string; answer: string; source: string } | null; model: string; generated_at: string;
};

export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };

export type CaseDetail = {
  id: string; householdId: string; program: string; county: string; regionType: string | null; channel: string | null;
  submittedDate: string; expeditedScreening: boolean; reportedMonthlyIncome: number | null;
  reportedLiquidResources: number | null; citizenshipVerifiedElectronically: boolean | null; status: string;
  rfiCount: number; caseworkerId: string | null; caseworkerName: string | null; caseworkerUnit: string | null;
  headFirstName: string; headLastName: string; headAge: number | null; householdSize: number;
  childrenUnder18: number | null; elderlyOrDisabled: boolean; preferredLanguage: string | null;
  streetAddress: string | null; city: string | null; zipCode: string | null; phone: string | null;
  assessment: Assessment | null; assessedAt: string | null; noticeDraft: string | null; noticeType: string | null;
  noticeLanguage: string | null; decision: string | null; decisionNotes: string | null; decidedBy: string | null;
  decidedAt: string | null; monthlyBenefitAmount: number | null; auditTrail: AuditEntry[]; daysOpen: number;
  documents: CaseDocument[];
};

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export async function fetchCases(params: Record<string, string | undefined>): Promise<CaseRow[]> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return (await okOrThrow(await fetch(`/api/cases?${q}`), 'cases')).json();
}
export async function fetchSummary(county?: string): Promise<Summary> {
  return (await okOrThrow(await fetch(`/api/cases/summary${county ? `?county=${encodeURIComponent(county)}` : ''}`), 'summary')).json();
}
export async function fetchCase(id: string): Promise<CaseDetail> {
  return (await okOrThrow(await fetch(`/api/cases/${encodeURIComponent(id)}`), 'case')).json();
}
export async function decide(id: string, body: { decision: string; notes?: string; noticeText?: string }): Promise<CaseDetail> {
  return (await okOrThrow(await fetch(`/api/cases/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'decision')).json();
}
export type ActivityRow = { case_id: string; applicant: string; program: string; county: string; at: string; by: string; action: string; notes: string | null };
export async function fetchActivity(limit = 12): Promise<ActivityRow[]> {
  return (await okOrThrow(await fetch(`/api/activity/recent?limit=${limit}`), 'activity')).json();
}

/** POST /assess and parse the SSE stream (event: step | result | error). */
export async function runAssessment(
  id: string,
  on: { step: (e: StepEvent) => void; result: (r: { assessment: Assessment; notice: { type: string; language: string; text: string } }) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/cases/${encodeURIComponent(id)}/assess`, { method: 'POST' });
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

export const DOC_LABEL: Record<string, string> = {
  photo_id: 'Photo ID', lease: 'Lease', utility_bill: 'Utility bill', paystub: 'Pay stub', bank_statement: 'Bank statement',
  employer_letter: 'Employer letter', self_declaration: 'No-income statement',
};
export const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const fullName = (c: { head_first_name?: string; head_last_name?: string; headFirstName?: string; headLastName?: string }) =>
  `${c.head_first_name ?? c.headFirstName ?? ''} ${c.head_last_name ?? c.headLastName ?? ''}`.trim();
