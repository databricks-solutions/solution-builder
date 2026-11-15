/** Care-transitions API client + shared types (mirrors server shapes). */
import { okOrThrow } from '@/lib/api';
import type { HrrpWhatIfInputs } from '../../../shared/hrrp';

export type Kpis = {
  as_of: string; discharges_12m: number; readmission_rate_12m: number; hf_rate_12m: number; hrrp_followup_rate_12m: number;
  signal_hf_rate_before: number; signal_hf_rate_last26: number; signal_hf_n_last26: number; rest_hf_rate_before: number; rest_hf_rate_last26: number;
  signal_weekend_followup_last26: number; signal_weekday_followup_last26: number;
};
export type UnitRow = { unit_id: string; unit_name: string; hospital_id: string; n_before: number; rate_before: number; n_last26: number; rate_last26: number; change_pts: number; followup_last26: number };
export type DowRow = { discharge_dow: string; n_before: number; fu_before: number; rate_before: number; n_last26: number; fu_last26: number; rate_last26: number };
export type FollowupRow = { hrrp_condition: string; condition_label: string; with_fu_rate: number; with_fu_n: number; without_fu_rate: number; without_fu_n: number };
export type TrendRow = { discharge_month: string; group_name: string; discharges: number; rate: number };
export type EventRow = { event_date: string; unit_id: string; unit_name: string; event_type: string; description: string };
export type NoteSignal = { risk: string; with_n: number; with_rate: number; without_n: number; without_rate: number; prevalence: number };
export type PenaltyRow = { hospital_id: string; hospital_name: string; medicare_base_drg_payments: number; penalty_pct: number; penalty_usd: number; penalty_pct_hf_run_rate: number; penalty_usd_hf_run_rate: number; hf_err_estimate: number; hf_err_last_6m: number; top_condition: string; top_condition_usd: number; excess_readmissions: number };
export type HrrpRow = { hospital_id: string; hospital_name: string; hrrp_condition: string; condition_label: string; discharges: number; readmissions: number; observed_rate: number; national_readmission_rate: number; err_estimate: number; err_last_6m: number; payment_share: number; penalty_contribution: number; penalty_usd: number; excess_readmissions: number };
export type WorklistSummary = { patients: number; high_risk: number; high_risk_no_followup: number; planned: number; plans_approved: number; tasks: number; open_tasks: number };
export type CommandCenter = { kpis: Kpis; units: UnitRow[]; weekday: DowRow[]; followup: FollowupRow[]; trend: TrendRow[]; events: EventRow[]; notes: NoteSignal[]; penalty: PenaltyRow[]; summary: WorklistSummary };

export type WorklistData = {
  age: number | null; sex: string | null; primary_language: string | null; payer: string | null; dual_eligible: boolean | null;
  hospital_name: string | null; condition_label: string | null; principal_dx: string | null; principal_dx_code: string | null;
  admit_date: string | null; discharge_dow: string | null; weekend_discharge: boolean | null; los_days: number | null;
  charlson_index: number | null; ed_visits_6m: number | null; prior_admits_12m: number | null; discharge_med_count: number | null;
  discharge_disposition: string | null; lives_alone: boolean | null; has_pcp: boolean | null; followup_date: string | null;
  followup_clinic: string | null; attending: string | null; medicare_ffs_65: boolean | null;
  risk_if_followup: number | null; risk_if_followup_hh: number | null; top_drivers: string[]; model_version: string | null;
  transportation_barrier: boolean | null; medication_affordability: boolean | null; caregiver_support: boolean | null;
  language_barrier: boolean | null; high_risk_med_change: boolean | null; med_changes: string[]; note_followup_status: string | null;
  pending_labs: string | null; sdoh_summary: string | null; note_text: string | null;
};
export type WorklistRow = {
  encounterId: string; patientId: string; patientName: string; unitId: string; unitName: string | null; hospitalId: string; hrrpCondition: string;
  dischargeDate: string; status: string; riskScore: number; riskTier: string; followupBooked: boolean; data: WorklistData;
  planStatus: string; planId: string | null; updatedBy: string | null; updatedAt: string | null;
};
export type PlanTask = { task_type: string; title: string; detail: string; due_date: string; owner: string; source: string; selected: boolean };
export type TransitionPlan = {
  encounter_id: string; patient_name: string; as_of: string;
  facts: { unit: string; condition: string; discharge_date: string; discharge_dow: string; status: string; weekend_discharge: boolean; risk_score: number; risk_tier: string; risk_if_followup: number; risk_if_followup_hh: number; top_drivers: string[]; followup_booked: boolean; note_followup_status: string | null; social_risks: string[]; med_changes: string[]; high_risk_med_change: boolean; pending_labs: string | null; unit_context: string | null };
  guidance: { question: string; answer: string; sources: string[] } | null; tasks: PlanTask[]; summary: string; call_script: string; model_used: string; generated_at: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type PlanRow = { id: string; encounterId: string; patientName: string; createdBy: string; createdAt: string; plan: TransitionPlan; status: 'draft' | 'approved' | 'discarded'; decidedBy: string | null; decidedAt: string | null; auditTrail: AuditEntry[] };
export type TaskRow = { id: string; encounterId: string; patientName: string; unitId: string | null; planId: string | null; taskType: string; title: string; detail: string | null; dueDate: string | null; owner: string; status: 'open' | 'done'; createdVia: string; createdBy: string; createdAt: string; completedAt: string | null; completedBy: string | null };
export type HistoryRow = { encounter_id: string; discharge_date: string; unit_name: string; condition_label: string; los_days: number; followup_7d_scheduled: boolean; readmitted_30d: boolean; days_to_readmit: number | null; readmit_reason: string | null };
export type PatientDetail = { patient: WorklistRow; history: HistoryRow[]; plan: PlanRow | null; tasks: TaskRow[] };
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type ActivityRow = { plan_id: string; patient_name: string; status: string; at: string; by: string; action: string; notes: string | null };

const get = async <T,>(url: string, label: string): Promise<T> => (await okOrThrow(await fetch(url), label)).json();
export const fetchCommandCenter = () => get<CommandCenter>('/api/command-center', 'command center');
export const fetchHrrp = () => get<{ performance: HrrpRow[]; penalty: PenaltyRow[]; whatIf: HrrpWhatIfInputs }>('/api/hrrp', 'HRRP');
export const fetchWorklist = (q: { unit?: string; condition?: string; tier?: string; hrrp?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (q.unit) p.set('unit', q.unit);
  if (q.condition) p.set('condition', q.condition);
  if (q.tier) p.set('tier', q.tier);
  if (q.hrrp) p.set('hrrp', '1');
  return get<WorklistRow[]>(`/api/worklist?${p}`, 'worklist');
};
export const fetchPatient = (id: string) => get<PatientDetail>(`/api/worklist/${encodeURIComponent(id)}`, 'patient');
export const fetchTasks = (status?: 'open' | 'done') => get<TaskRow[]>(`/api/tasks${status ? `?status=${status}` : ''}`, 'tasks');
export const fetchActivity = (limit = 10) => get<ActivityRow[]>(`/api/activity/recent?limit=${limit}`, 'activity');

export async function approvePlan(planId: string, tasks: PlanTask[]): Promise<PlanRow> {
  return (await okOrThrow(await fetch(`/api/plans/${encodeURIComponent(planId)}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks }),
  }), 'approve plan')).json();
}
export async function completeTasks(ids: string[]): Promise<TaskRow[]> {
  return (await okOrThrow(await fetch('/api/tasks/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  }), 'complete tasks')).json();
}

/** POST /plan and parse the SSE stream (event: step | result | error). */
export async function runPlan(
  id: string,
  on: { step: (e: StepEvent) => void; result: (p: PlanRow) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/worklist/${encodeURIComponent(id)}/plan`, { method: 'POST' });
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

export const pct = (x: number | null | undefined, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
export const n0 = (x: number | null | undefined) => (x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 }));
export const usd = (x: number | null | undefined) => (x == null ? '—' : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${Math.round(x / 1000).toLocaleString('en-US')}K`);
export const dayLabel = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
export const monthShort = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const CONDITION: Record<string, string> = { HF: 'Heart failure', AMI: 'AMI', PN: 'Pneumonia', COPD: 'COPD', CABG: 'CABG', THA_TKA: 'Hip / knee', OTHER: 'Other' };
