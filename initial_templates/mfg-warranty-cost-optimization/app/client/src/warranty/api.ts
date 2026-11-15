/** Warranty workbench API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type SignalRow = {
  id: string; failure_mode: string; failure_mode_label: string; component: string | null; supplier_id: string;
  supplier_name: string; chargeable: boolean; claims_90d: number; claims_base: number; claims_total: number;
  cost_to_date: number; cost_90d: number; rate_90d: number; baseline_rate: number; rate_ratio: number;
  first_recent_claim: string | null; status: string; quality_case_id: string | null; analyzed_at: string | null;
  dealer_code_agreement: number | null; cohort_dimension: string | null; cohort_values: string;
  projected_cost: number; affected_units: number;
};

export type Finding = { id: string; title: string; verdict: 'CONFIRMED' | 'RULED_OUT' | 'WATCH' | 'INFO'; detail: string; evidence?: string };
export type ContainmentAction = { key: string; label: string; detail: string; units: number | null; cost: number | null; recoverable: number | null; recommended: boolean };
export type ExposureRow = {
  region: string; wet_region: boolean; units: number; units_in_field: number; units_in_stock: number; connected_in_field: number;
  claims_to_date: number; cost_to_date: number; annual_hazard: number; avg_remaining_years: number; projected_claims: number;
  projected_cost: number; avg_claim_cost: number;
};
export type Cohort = {
  dimension: string; rest_rate: number;
  suspect: Array<{ value: string; units: number; units_sold: number; units_in_stock: number; claims: number; rate: number }>;
  all: Array<{ value: string; units: number; units_sold: number; claims: number; rate: number; suspect: boolean; in_scope?: boolean }>;
};
export type Analysis = {
  headline: string; root_cause: string; summary: string; findings: Finding[];
  lots: Array<{ lot: string; units: number; units_in_stock: number; claims: number; rate: number; e21_rate: number | null; coating: string | null; ppap: string | null }>;
  telemetry: { suspect_e21_per_1k: number | null; other_e21_per_1k: number | null; at_risk_bikes: number | null } | null;
  exposure: { affected_units: number; in_field: number; in_stock: number; claims_to_date: number; cost_to_date: number; projected_claims: number; projected_cost: number; wet_share: number } | null;
  options: ContainmentAction[];
  chargeback: { to_date: number; campaign: number; total: number; basis: string } | null;
  supplier_guidance: { question: string; answer: string; source: string } | null;
  model: string; generated_at: string;
};
export type Claim = {
  id: string; serial: string; modelName: string | null; dealerName: string | null; region: string | null; claimDate: string;
  daysInService: number | null; customerComplaint: string | null; dealerLaborCode: string | null; failureMode: string | null;
  failureModeLabel: string | null; faultCode: string | null; waterExposure: boolean | null; observedDamage: string | null;
  matchesDealerCode: boolean | null; partNumber: string | null; totalCost: number | null; claimStatus: string | null;
  technicianName: string | null; technicianNotes: string | null; firmware: string | null; controllerLot: string | null;
  brakeLot: string | null; supplierId: string | null; chargeable: boolean;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type QualityCase = {
  id: string; signalId: string; title: string; supplierId: string; supplierName: string; rootCause: string;
  affectedLots: string[]; affectedUnits: number | null; containmentActions: ContainmentAction[];
  projectedExposure: number | null; campaignCost: number | null; chargebackAmount: number | null;
  supplierNotice: string | null; severity: string; status: string; owner: string; notes: string | null;
  openedVia: string; createdAt: string;
};
export type SignalDetail = {
  id: string; failureMode: string; failureModeLabel: string; component: string | null; supplierId: string; supplierName: string;
  chargeable: boolean; exposedUnits: number | null; claims90d: number; claimsBase: number; claimsTotal: number;
  costToDate: number | null; cost90d: number | null; avgClaimCost: number | null; rate90d: number | null;
  baselineRate: number | null; rateRatio: number | null; firstRecentClaim: string | null; dealerCodeAgreement: number | null;
  cohort: Cohort | null; exposure: ExposureRow[]; status: string; analysis: Analysis | null; analyzedAt: string | null;
  supplierNoticeDraft: string | null; qualityCaseId: string | null; auditTrail: AuditEntry[];
  claims: Claim[]; weekly: Array<{ week: string; claims: number }>; qualityCase: QualityCase | null;
};
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type Summary = { signals: number; signals_new: number; quality_cases: number; chargebacks_filed: number; claims_90d: number; miscoded_90d: number };
export type ActivityRow = { signal_id: string; signal: string; supplier: string; at: string; by: string; action: string; notes: string | null };
export type ClaimsResponse = {
  claims: Array<Record<string, unknown>>;
  modes: Array<{ failure_mode: string; failure_mode_label: string; claims: number; claims_90d: number; cost: number; code_agreement: number }>;
};

const j = async <T,>(url: string, what: string): Promise<T> => (await okOrThrow(await fetch(url), what)).json();
export const fetchSignals = () => j<SignalRow[]>('/api/signals', 'signals');
export const fetchSummary = () => j<Summary>('/api/signals/summary', 'summary');
export const fetchSignal = (id: string) => j<SignalDetail>(`/api/signals/${encodeURIComponent(id)}`, 'signal');
export const fetchActivity = (limit = 10) => j<ActivityRow[]>(`/api/activity/recent?limit=${limit}`, 'activity');
export const fetchQualityCases = () => j<QualityCase[]>('/api/quality-cases', 'quality cases');
export const fetchClaims = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  return j<ClaimsResponse>(`/api/claims?${q}`, 'claims');
};
export async function openCase(id: string, body: { actions: string[]; notes?: string; noticeText?: string }): Promise<{ case: QualityCase; existing: boolean }> {
  return (await okOrThrow(await fetch(`/api/signals/${encodeURIComponent(id)}/case`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'open case')).json();
}

/** POST /analyze and parse the SSE stream (event: step | result | error). */
export async function runAnalysis(
  id: string,
  on: { step: (e: StepEvent) => void; result: (r: { analysis: Analysis; notice: string }) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/signals/${encodeURIComponent(id)}/analyze`, { method: 'POST' });
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
export const HERO_SIGNAL_MODE = 'controller_water_ingress';
