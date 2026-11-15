/**
 * The per-patient transition plan — the worklist's AI step.
 *
 *   1. The patient (Lakebase worklist mirror): readmission_risk_model@champion score, its top drivers
 *      and the what-if risk with a 7-day follow-up / home health.
 *   2. What AI Functions read in the discharge note: social risks, medication changes, the follow-up
 *      as written ("patient to call…"), pending labs.
 *   3. Unit context (Delta unit_events) — e.g. 4 West has no weekend discharge navigator.
 *   4. the Genie agent over Larkspur's care-transition pathway documents → what the pathway requires.
 *   5. A deterministic task list from the pathway rules (every task cites its pathway section).
 *   6. A Foundation Model writes the coordinator summary + the 48-hour call script from those facts only.
 *
 * Numbers, dates and tasks are never produced by an LLM. Every step is streamed via `onStep`.
 */
import type { Request } from 'express';
import type { PlanTask, TransitionPlan } from '../db/schema.js';
import type { worklist } from '../db/schema.js';
import { askDocuments, chatJson } from '../lib/serving.js';
import * as cd from './care-data.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
type Patient = typeof worklist.$inferSelect;

const pct = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)}%`;
const addDays = (d: string, n: number) => {
  const t = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
/** Next business day on or after `d` (Mon-Fri). */
const businessDay = (d: string) => {
  let x = d;
  for (let i = 0; i < 3; i++) {
    const w = new Date(`${x}T12:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6) return x;
    x = addDays(x, 1);
  }
  return x;
};
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const CLINIC: Record<string, string> = {
  HF: 'HF Transitions Clinic', AMI: 'Cardiology Clinic', CABG: 'Cardiothoracic Surgery Clinic', COPD: 'Pulmonary Clinic',
  PN: 'Primary care', THA_TKA: 'Orthopedic Clinic', OTHER: 'Primary care',
};

export function socialRisks(p: Patient): string[] {
  const d = p.data;
  const out: string[] = [];
  if (d.lives_alone) out.push('Lives alone');
  if (d.transportation_barrier) out.push('Transportation barrier (note)');
  if (d.medication_affordability) out.push('Medication cost concern (note)');
  if (d.language_barrier) out.push(`Preferred language ${d.primary_language ?? 'not English'}`);
  if (d.has_pcp === false) out.push('No primary care physician');
  if (d.dual_eligible) out.push('Dual eligible');
  return out;
}

/** Pathway rules → concrete tasks with owners and due dates (CTP-HF-03, CTP-PULM-02, CT-201, CT-305). */
export function planTasks(p: Patient): PlanTask[] {
  const d = p.data;
  const dd = p.dischargeDate.slice(0, 10);
  const cond = p.hrrpCondition;
  const weekend = !!d.weekend_discharge;
  const planned = p.status === 'planned';
  const hfOrCopd = cond === 'HF' || cond === 'COPD' || cond === 'AMI';
  const tasks: PlanTask[] = [];
  // Never propose a due date in the past (a patient already discharged gets "as soon as possible").
  const today = businessDay(new Date().toISOString().slice(0, 10));
  const add = (t: Omit<PlanTask, 'selected'>) => tasks.push({ ...t, due_date: t.due_date < today ? today : t.due_date, selected: true });
  if (!p.followupBooked) {
    const window = hfOrCopd ? 7 : 14;
    add({
      task_type: 'book_followup',
      title: `Book ${CLINIC[cond] ?? 'follow-up'} visit by ${dayLabel(addDays(dd, window))}`,
      detail: weekend
        ? `Weekend discharge with no appointment ("${d.note_followup_status === 'patient_to_call' ? 'patient to call' : 'not arranged'}"). Use a reserved weekend-discharge slot, or a telehealth visit within 72 h, then in-person within ${window} days.`
        : `No appointment booked. Book within ${window} days of discharge before the patient leaves — "patient to call" does not meet the standard.`,
      due_date: planned ? dd : businessDay(addDays(dd, 1)), owner: 'Discharge navigator',
      source: weekend ? 'Policy CT-201 §3.2 · CTP-HF-03 §2.1' : 'Policy CT-201 §1 · CTP-HF-03 §2.1',
    });
  }
  if (p.riskTier !== 'Low') {
    add({
      task_type: 'call_48h', title: '48-hour post-discharge call',
      detail: 'Confirm prescriptions filled, understanding of medication changes, appointment date and transport, red-flag symptoms (weight gain > 2 lb/day or 5 lb/week for HF).',
      due_date: businessDay(addDays(dd, 2)), owner: 'RN navigator', source: 'Policy CT-201 §4 · CTP-HF-03 §3',
    });
  }
  if (d.high_risk_med_change) {
    add({
      task_type: 'med_rec_call', title: 'Pharmacist medication reconciliation call (72 h)',
      detail: `High-risk medication change: ${d.med_changes.slice(0, 3).join('; ') || 'see discharge note'}.`,
      due_date: businessDay(addDays(dd, 3)), owner: 'Transitions pharmacist', source: 'CTP-HF-03 §2.2 / §3',
    });
  }
  if (cond === 'HF' && d.high_risk_med_change) {
    add({
      task_type: 'lab_order', title: `BMP (potassium, creatinine) by ${dayLabel(addDays(dd, 5))}`,
      detail: `${d.pending_labs ?? 'Diuretic / RAAS change'} — place the order before discharge with a draw location the patient can reach${d.transportation_barrier ? ' (home-health draw — transportation barrier)' : ''}.`,
      due_date: addDays(dd, 4), owner: 'Discharging physician', source: 'CTP-HF-03 §2.3',
    });
  }
  const hhHf = cond === 'HF' && ((d.lives_alone && d.high_risk_med_change) || (d.ed_visits_6m ?? 0) >= 2);
  const hhCopd = cond === 'COPD' && (d.med_changes.some((m) => /oxygen/i.test(m)) || (d.prior_admits_12m ?? 0) >= 2);
  if ((hhHf || hhCopd) && d.discharge_disposition !== 'Home with home health' && d.discharge_disposition !== 'Skilled nursing facility') {
    add({
      task_type: 'home_health', title: 'Home health referral — first visit within 48 h',
      detail: hhHf ? `Meets HF home-health criteria (${[d.lives_alone && 'lives alone with a high-risk medication change', (d.ed_visits_6m ?? 0) >= 2 && `${d.ed_visits_6m} ED visits in 6 months`].filter(Boolean).join('; ')}). Skilled nursing + remote weight monitoring; home health can draw the BMP.`
        : 'Meets pulmonary home-health criteria (new home oxygen / repeat admissions).',
      due_date: planned ? dd : businessDay(addDays(dd, 1)), owner: 'Care-transitions coordinator', source: cond === 'HF' ? 'CTP-HF-03 §5' : 'CTP-PULM-02 home health',
    });
  }
  if (d.transportation_barrier) {
    add({
      task_type: 'ride_assist', title: 'Book Larkspur Ride Assist for the follow-up visit and lab draw',
      detail: 'Note: patient cannot reliably get to appointments. Up to 6 free round trips in the 30 days after discharge.',
      due_date: planned ? dd : businessDay(addDays(dd, 1)), owner: 'Care-transitions coordinator', source: 'CT-305 Ride Assist · CTP-HF-03 §4',
    });
  }
  if (d.medication_affordability) {
    add({
      task_type: 'financial_counseling', title: 'Financial counseling / meds-to-beds before discharge',
      detail: 'Note mentions cost concerns with medications — screen for copay assistance, fill at bedside.',
      due_date: dd, owner: 'Outpatient pharmacy', source: 'CT-305 meds-to-beds · CTP-HF-03 §4',
    });
  }
  if (d.language_barrier) {
    add({
      task_type: 'interpreter_teach_back', title: `Interpreter-supported teach-back (${d.primary_language ?? 'preferred language'})`,
      detail: 'Teach-back on medications and red flags with a certified interpreter; written materials in the preferred language.',
      due_date: dd, owner: 'Discharge nurse', source: 'CTP-PULM-02 · CTP-HF-03 §2.4',
    });
  }
  return tasks;
}

export async function buildTransitionPlan(
  req: Request,
  p: Patient,
  opts: { genieSpaceId: string; memoModel: string; onStep: (e: StepEvent) => void },
): Promise<TransitionPlan> {
  const { onStep } = opts;
  const d = p.data;
  onStep({ id: 'risk', label: `${p.patientName}: ${pct(p.riskScore)} predicted 30-day readmission risk (${p.riskTier})`, status: 'done',
    detail: `readmission_risk_model@champion v${d.model_version ?? '?'} · drivers: ${d.top_drivers.join(' · ') || 'none above baseline'}` });
  const risks = socialRisks(p);
  onStep({ id: 'note', label: `Discharge note read by AI Functions: ${risks.length ? risks.join(', ') : 'no social risks found'}`, status: 'done',
    detail: [d.med_changes.length ? `medication changes: ${d.med_changes.join('; ')}` : null, `follow-up as written: ${d.note_followup_status ?? 'n/a'}`, d.pending_labs ? `pending: ${d.pending_labs}` : null].filter(Boolean).join(' · ') });
  let unitContext: string | null = null;
  try {
    const ev = await cd.unitEvents(p.unitId);
    unitContext = ev.map((e) => `${e.event_date}: ${e.description}`).join(' ');
    if (ev.length) onStep({ id: 'unit', label: `${p.unitName ?? p.unitId}: ${ev.length} operational change(s) on record`, status: 'done', detail: unitContext });
  } catch {
    /* unit context is optional */
  }

  const question = `Transition plan for a ${d.age}-year-old patient with ${d.condition_label ?? p.hrrpCondition} (${d.principal_dx ?? ''}) being discharged ${d.discharge_dow ?? ''} ${p.dischargeDate} to ${d.discharge_disposition ?? 'home'}. `
    + `Predicted 30-day readmission risk ${pct(p.riskScore)} (${p.riskTier}). ${p.followupBooked ? 'A 7-day follow-up is booked.' : 'No follow-up appointment is booked.'} `
    + `Social: ${risks.join(', ') || 'none'}. Medication changes: ${d.med_changes.join('; ') || 'none'}. `
    + `What does the Larkspur pathway require before discharge and in the first 7 days (follow-up timing, calls, labs, home health, transportation, weekend-discharge rules)? Cite the sections.`;
  onStep({ id: 'pathway', label: 'Asking the care-transition pathways (Genie agent)', status: 'running', detail: question });
  let guidance: TransitionPlan['guidance'] = null;
  try {
    const doc = await askDocuments(req, opts.genieSpaceId, `Answer from the Larkspur care-transition pathway and policy documents only, citing the sections: ${question}`);
    guidance = { question, answer: doc.answer, sources: doc.sources };
    onStep({ id: 'pathway', label: 'Pathway guidance retrieved', status: 'done', detail: doc.sources.join(', ') || 'Larkspur care-transition pathways' });
  } catch (err) {
    onStep({ id: 'pathway', label: 'Pathway assistant unavailable — using the built-in pathway rules', status: 'error', detail: (err as Error).message.slice(0, 160) });
  }

  const tasks = planTasks(p);
  onStep({ id: 'tasks', label: `${tasks.length} outreach tasks from the pathway rules`, status: 'done', detail: tasks.map((t) => `${t.title} (${t.source})`).join(' · ') });
  onStep({ id: 'whatif', label: `Risk with a 7-day follow-up booked: ${pct(p.riskScore)} → ${pct(d.risk_if_followup)}${d.risk_if_followup_hh != null ? ` (→ ${pct(d.risk_if_followup_hh)} with home health)` : ''}`, status: 'done',
    detail: 'Same model, same patient, follow-up flag set — the lever the care team controls.' });

  onStep({ id: 'summary', label: 'Writing the coordinator summary and the 48-hour call script', status: 'running' });
  const system = `You are a senior RN care-transitions coordinator at Larkspur Health. From the facts only, write:
(1) "summary": 2-3 plain sentences for the coordinator — why this patient is at risk (name the specific drivers and social risks) and what the plan does about it, with the risk numbers;
(2) "call_script": a short 48-hour post-discharge phone script (5-7 lines, "- " bullets, plain text, no markdown headings) that addresses THIS patient's medication changes, follow-up and barriers, and names the red flags.
Use ONLY the facts provided; do not invent appointments, doses or dates that are not in the facts. Return ONLY a JSON object {"summary": string, "call_script": string}.`;
  const user = JSON.stringify({
    patient: { name: p.patientName, age: d.age, sex: d.sex, language: d.primary_language, condition: d.condition_label, diagnosis: d.principal_dx, unit: p.unitName, discharge: `${d.discharge_dow} ${p.dischargeDate}`, status: p.status, disposition: d.discharge_disposition },
    risk: { now: p.riskScore, tier: p.riskTier, with_7day_followup: d.risk_if_followup, with_followup_and_home_health: d.risk_if_followup_hh, drivers: d.top_drivers },
    followup_booked: p.followupBooked, followup_as_written_in_note: d.note_followup_status, social_risks: risks, medication_changes: d.med_changes, pending_labs: d.pending_labs,
    unit_context: unitContext, pathway_guidance: guidance?.answer ?? null, tasks: tasks.map((t) => `${t.title} — due ${t.due_date} — ${t.owner}`),
  });
  let summary = '';
  let callScript = '';
  try {
    const out = await chatJson<{ summary: string; call_script: string }>(req, opts.memoModel, system, user);
    summary = out.summary;
    callScript = out.call_script;
    onStep({ id: 'summary', label: 'Summary and call script drafted', status: 'done', detail: opts.memoModel });
  } catch (err) {
    summary = `${p.patientName} has a ${pct(p.riskScore)} predicted readmission risk; the plan books follow-up and addresses ${risks.join(', ') || 'the clinical drivers'}.`;
    onStep({ id: 'summary', label: 'Summary drafting failed — plan kept without it', status: 'error', detail: (err as Error).message.slice(0, 160) });
  }
  return {
    encounter_id: p.encounterId, patient_name: p.patientName, as_of: new Date().toISOString().slice(0, 10),
    facts: {
      unit: p.unitName ?? p.unitId, condition: d.condition_label ?? p.hrrpCondition, discharge_date: p.dischargeDate, discharge_dow: d.discharge_dow ?? '',
      status: p.status, weekend_discharge: !!d.weekend_discharge, risk_score: p.riskScore, risk_tier: p.riskTier,
      risk_if_followup: d.risk_if_followup ?? p.riskScore, risk_if_followup_hh: d.risk_if_followup_hh ?? p.riskScore, top_drivers: d.top_drivers,
      followup_booked: p.followupBooked, note_followup_status: d.note_followup_status, social_risks: risks, med_changes: d.med_changes,
      high_risk_med_change: !!d.high_risk_med_change, pending_labs: d.pending_labs, unit_context: unitContext,
    },
    guidance, tasks, summary, call_script: callScript, model_used: opts.memoModel, generated_at: new Date().toISOString(),
  };
}
