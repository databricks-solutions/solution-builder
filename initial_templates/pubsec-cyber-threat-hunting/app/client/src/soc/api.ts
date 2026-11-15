/** SOC workbench API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type LeadRow = {
  id: string; entity_type: 'user' | 'host'; entity_id: string; display_name: string; department: string | null; role: string | null;
  risk_score: number; priority: string; top_factors: string[]; risk_trend: number[]; first_flagged: string | null;
  linked_alerts: number; alerts_closed_fp: number; status: string; case_id: string | null; disposition: string | null;
  ai_verdict: string | null; ai_severity: string | null;
};

export type Summary = { open: number; critical_open: number; investigated: number; escalated: number; closed_benign: number; cases_opened: number };

export type TimelineEvent = { ts: string; source: string; entity: string; event: string; technique_id?: string | null };
export type Technique = { id: string; name: string; tactic: string; evidence: string; coverage?: string | null; playbook_section?: string | null };
export type ContainmentAction = { code: string; action: string; target: string; rationale: string; status?: string };
export type Investigation = {
  verdict: 'confirmed_compromise' | 'suspicious' | 'benign'; severity: string; headline: string; summary: string;
  timeline: TimelineEvent[]; techniques: Technique[]; containment: ContainmentAction[]; notifications: string[];
  benign_evidence: string[]; records_at_risk: number | null; playbook_citations: string[]; model: string; tool_calls: number; generated_at: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type IncidentCase = {
  id: string; leadId: string; title: string; severity: string; status: string; summary: string | null; entities: string[];
  techniques: Technique[]; containment: ContainmentAction[]; timeline: TimelineEvent[]; notifications: string[];
  recordsAtRisk: number | null; analyst: string; notes: string | null; openedAt: string;
};
export type LeadDetail = {
  id: string; entityType: 'user' | 'host'; entityId: string; displayName: string; department: string | null; role: string | null;
  riskScore: number; priority: string; topFactors: string[]; riskTrend: number[]; firstFlagged: string | null;
  linkedAlerts: number; alertsClosedFp: number; status: string; investigation: Investigation | null; investigatedAt: string | null;
  caseId: string | null; disposition: string | null; dispositionNotes: string | null; decidedBy: string | null; decidedAt: string | null;
  auditTrail: AuditEntry[]; incidentCase: IncidentCase | null;
};
export type Evidence = { trend: Array<{ d: string; risk: number }>; events: Array<{ ts: string; src: string; detail: string }> };
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type ActivityRow = { lead_id: string; entity: string; entity_type: string; at: string; by: string; action: string; notes: string | null };

const j = async <T>(r: Response, label: string): Promise<T> => (await okOrThrow(r, label)).json() as Promise<T>;
export const fetchLeads = (status = 'all') => fetch(`/api/leads?status=${status}`).then((r) => j<LeadRow[]>(r, 'leads'));
export const fetchSummary = () => fetch('/api/leads/summary').then((r) => j<Summary>(r, 'summary'));
export const fetchLead = (id: string) => fetch(`/api/leads/${encodeURIComponent(id)}`).then((r) => j<LeadDetail>(r, 'lead'));
export const fetchEvidence = (id: string) => fetch(`/api/leads/${encodeURIComponent(id)}/evidence`).then((r) => j<Evidence>(r, 'evidence'));
export const fetchCases = () => fetch('/api/cases').then((r) => j<IncidentCase[]>(r, 'cases'));
export type AttackCell = { technique_id: string; technique_name: string; tactic: string; detection_coverage: 'full' | 'partial' | 'none'; alerts: number; true_positives: number };
export const fetchAttackMatrix = () => fetch('/api/charts/attack_matrix').then((r) => j<{ data: AttackCell[] }>(r, 'attack matrix')).then((b) => b.data);
export const fetchActivity = (limit = 10) => fetch(`/api/activity/recent?limit=${limit}`).then((r) => j<ActivityRow[]>(r, 'activity'));

export async function openCase(id: string, body: { severity: string; title: string; containment: ContainmentAction[]; notes?: string }): Promise<LeadDetail> {
  return j(await fetch(`/api/leads/${encodeURIComponent(id)}/case`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'case');
}
export async function closeBenign(id: string, notes: string): Promise<LeadDetail> {
  return j(await fetch(`/api/leads/${encodeURIComponent(id)}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) }), 'close');
}

/** POST /investigate and parse the SSE stream (event: step | result | error). */
export async function runInvestigation(
  id: string,
  on: { step: (e: StepEvent) => void; result: (inv: Investigation) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/leads/${encodeURIComponent(id)}/investigate`, { method: 'POST' });
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
      else if (ev === 'result') on.result(parsed.investigation);
      else if (ev === 'error') on.error(parsed.message);
    }
  }
}

export const HERO_LEAD = 'L-1042';
