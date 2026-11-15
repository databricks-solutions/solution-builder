/** Prior-auth workbench types — mirror server/db/schema.ts (pa_cases etc.). */
export type CaseStatus = 'open' | 'approved' | 'auto_approved' | 'pended' | 'referred_md';
export type Clock = 'breached' | 'at_risk' | 'ok';
export type Lane = 'Auto-approval lane' | 'Nurse fast-track' | 'Request information' | 'Physician review';

export type AuditEntry = {
  at: string;
  by: string;
  action: 'approved' | 'auto_approved' | 'pended' | 'referred_md' | 'ai_review' | 'note';
  notes?: string;
  tool?: string;
};

export type CaseRow = {
  requestId: string;
  memberId: string;
  memberName: string | null;
  memberAge: number | null;
  memberSex: string | null;
  lineOfBusiness: string | null;
  planName: string | null;
  providerName: string | null;
  npi: string | null;
  practiceGroup: string | null;
  specialty: string | null;
  policyId: string;
  policyTitle: string | null;
  serviceCode: string | null;
  serviceDescription: string | null;
  serviceCategory: string | null;
  icd10Code: string | null;
  diagnosis: string | null;
  urgency: 'Expedited' | 'Standard';
  channel: string | null;
  receivedAt: string;
  dueAt: string;
  slaHours: number;
  intakeStatus: string | null;
  estCostUsd: number | null;
  requestedUnits: number | null;
  placeOfService: string | null;
  autoApprovalEligible: boolean;
  aiRecommendation: 'APPROVE' | 'PEND' | 'REFER_MD' | null;
  aiConfidence: number | null;
  aiRationale: string | null;
  missingInformation: string | null;
  aiLane: Lane | null;
  nMet: number | null;
  nCriteria: number | null;
  aiModel: string | null;
  aiReviewedAt: string | null;
  status: CaseStatus;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  providerLetter: string | null;
  auditTrail: AuditEntry[];
  hoursRemaining: number;
  clock: Clock;
};

export type Criterion = {
  requestId: string;
  criterionId: string;
  criterionNumber: number | null;
  label: string | null;
  criterionText: string | null;
  status: 'Met' | 'Not Met' | 'Not Documented' | string | null;
  evidenceQuote: string | null;
  sourceNoteId: string | null;
};

export type Note = {
  noteId: string;
  requestId: string;
  noteType: string | null;
  author: string | null;
  noteDate: string | null;
  noteText: string;
};

export type CaseDetail = CaseRow & { autoApprovable: boolean; criteria: Criterion[]; notes: Note[] };

export type Summary = {
  asOf: string;
  total: number;
  open: number;
  expeditedOpen: number;
  breached: number;
  atRisk: number;
  faxAwaitingIndexing: number;
  lanes: Record<string, number>;
  autoApprovable: number;
  decided: { total: number; approved: number; autoApproved: number; pended: number; referredMd: number };
};

export type ActivityEvent = AuditEntry & { requestId: string; memberName: string | null; policyTitle: string | null };
