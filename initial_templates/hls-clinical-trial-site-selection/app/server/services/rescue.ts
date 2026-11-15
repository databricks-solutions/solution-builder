/**
 * The enrollment-rescue analysis — the workbench's AI step.
 *
 *   1. Enrollment vs plan (gold_trial_enrollment_monthly) → run rate, gap, months left.
 *   2. Screen failures by REAL criterion (AI Functions already read the coordinator notes)
 *      vs what sites coded → the killer criterion and its trend.
 *   3. EHR-network catchment of the active sites, current vs amended protocol.
 *   4. Competing trial overlap + zero-enrolling sites.
 *   5. the Genie agent over the protocol / SAP / SOP documents → is E4 amendable, what about E7, timelines.
 *   6. site_enrollment_model@champion scores (site_scores) → ranked rescue sites.
 *   7. Deterministic projection (shared/projection.ts) → LPI for status quo / amendment / amendment + sites.
 *   8. A Foundation Model drafts the amendment proposal + rescue-plan memo from those facts only.
 *
 * Numbers and dates are never produced by an LLM. Every step is streamed via `onStep`.
 */
import type { Request } from 'express';
import type { RescueAnalysis, RescueSite } from '../db/schema.js';
import { askDocuments, chatJson } from '../lib/serving.js';
import { project, type ProjectionParams } from '../../shared/projection.js';
import * as td from './trial-data.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const monthLabel = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'beyond 6 years');
export const DEFAULT_RESCUE_SITES = 15;

export type RescueFacts = Omit<RescueAnalysis, 'protocol_guidance' | 'summary' | 'model_used' | 'generated_at' | 'projection' | 'projection_params'> & {
  params: ProjectionParams;
};

/** Steps 1-4 + 6-7 — pure data, no LLM. Exported for the chat agent's tools too. */
export async function gatherFacts(trialId: string): Promise<RescueFacts> {
  const [port, curve, sf, coded, fun, comp, cands, perf, model, crit] = await Promise.all([
    td.portfolio(), td.enrollmentCurve(trialId), td.screenFails(trialId), td.codedReasons(trialId), td.funnel(trialId),
    td.competition(trialId), td.candidates({ limit: 40 }), td.sitePerformance(trialId), td.modelMultiplier(), td.criteria(trialId),
  ]);
  const trial = port.find((p) => p.trial_id === trialId);
  if (!trial) throw new Error(`unknown trial ${trialId}`);
  const complete = curve.filter((c) => c.is_complete_month);
  const last3 = complete.slice(-3);
  const last6 = complete.slice(-6);
  const runRate = last3.reduce((a, c) => a + c.randomized, 0) / Math.max(1, last3.length);
  const cur = curve[curve.length - 1];
  const totalFails = sf.reduce((a, r) => a + r.n, 0);
  const e4 = sf.find((r) => r.criterion_id === 'E4');
  const e4Coded = coded.find((r) => r.coded_reason === 'E4')?.n ?? 0;
  const first6Total = sf.reduce((a, r) => a + r.n_first6, 0);
  const last6Total = sf.reduce((a, r) => a + r.n_last6, 0);

  // Amendment effect from the screening log (last 6 complete months): patients who failed ONLY on a
  // stable SGLT2i would now be screened in; they still face the other criteria, at the pass rate the
  // rest of the screened population shows.
  const screened6 = last6.reduce((a, c) => a + c.screened, 0);
  const rand6 = last6.reduce((a, c) => a + c.randomized, 0);
  const e4Last6 = e4?.n_last6 ?? 0;
  const stableShare = e4 && e4.n ? e4.stable_sglt2i / e4.n : 0;
  const passRest = rand6 / Math.max(1, screened6 - e4Last6);
  const uplift = 1 + (e4Last6 * stableShare * passRest) / Math.max(1, rand6);
  const rescreenBolus = Math.round((e4?.stable_sglt2i ?? 0) * passRest);

  const rescue: RescueSite[] = cands.map((c, i) => ({
    site_id: c.site_id, site_name: c.site_name, city: c.city, state: c.state, irb_type: c.irb_type,
    eligible_current: c.eligible_current_protocol, eligible_amended: c.eligible_amended_e4,
    predicted_rate_amended: c.predicted_rate_amended, est_activation_months: c.est_activation_months,
    expected_randomized_12m: c.expected_randomized_12m, hist_rate: c.hist_rate_per_month, rationale: c.score_rationale,
    selected: i < DEFAULT_RESCUE_SITES,
  }));
  const zero = perf.filter((p) => p.is_zero_enroller).map((p) => ({
    site_id: p.site_id, site_name: p.site_name, city: p.city, months_active: Number(p.months_active ?? 0), screened: p.screened,
    competing_trial: p.has_competing_trial ? comp?.acronym ?? 'REDWOOD-CKD' : null,
  }));
  const e7 = crit.find((c) => c.criterion_id === 'E7');
  const e4c = crit.find((c) => c.criterion_id === 'E4');
  const params: ProjectionParams = {
    target: trial.target_enrollment, randomizedToDate: cur.cum_randomized, startMonth: addMonths(cur.month_start, 1),
    runRate: Math.round(runRate * 10) / 10, amendmentUplift: Math.round(uplift * 1000) / 1000, amendmentLagMonths: 2,
    rescreenBolus, plannedLpi: trial.planned_lpi_date,
  };
  return {
    trial_id: trialId,
    as_of: new Date().toISOString().slice(0, 10),
    enrollment: {
      randomized: cur.cum_randomized, planned_to_date: cur.planned_cum_randomized, target: trial.target_enrollment,
      pct_of_plan: trial.pct_of_plan, run_rate_3m: params.runRate, planned_lpi: trial.planned_lpi_date,
      months_left: Math.max(0, Math.round((new Date(trial.planned_lpi_date).getTime() - Date.now()) / (30.4 * 86_400_000))),
      active_sites: cur.active_sites, screen_fail_rate: trial.screen_fail_rate, planned_screen_fail_rate: trial.planned_screen_fail_rate,
    },
    screen_fails: {
      total: totalFails,
      by_criterion: sf.map((r) => ({ criterion_id: r.criterion_id, name: r.criterion_name, n: r.n, coded: r.coded, share: Math.round((r.n / totalFails) * 1000) / 1000 })),
      e4_share_first6: e4 ? Math.round((e4.n_first6 / Math.max(1, first6Total)) * 1000) / 1000 : 0,
      e4_share_last6: e4 ? Math.round((e4.n_last6 / Math.max(1, last6Total)) * 1000) / 1000 : 0,
      e4_coded_share: Math.round((e4Coded / Math.max(1, totalFails)) * 1000) / 1000,
      e4_stable_share: Math.round(stableShare * 1000) / 1000,
      ai_recovered: sf.reduce((a, r) => a + r.ai, 0),
    },
    pool: {
      current: fun.eligible_current, amended: fun.eligible_amended,
      multiplier: Math.round((fun.eligible_amended / Math.max(1, fun.eligible_current)) * 100) / 100,
      pct_on_sglt2i: fun.pct_on_sglt2i, feasibility_assumed_pct: e4c?.feasibility_assumed_pass_rate != null ? Math.round((1 - e4c.feasibility_assumed_pass_rate) * 100) / 100 : 0.15,
    },
    model: { name: 'site_enrollment_model@champion', version: String(model.model_version), rate_multiplier: model.rate_multiplier },
    competition: { acronym: comp?.acronym ?? 'REDWOOD-CKD', sites: comp?.sites ?? 0, rate_before: comp?.rate_before ?? 0, rate_since: comp?.rate_since ?? 0 },
    zero_enrollers: zero,
    recommendation: {
      amend: [{
        criterion_id: 'E4', from: e4c?.criterion_text ?? 'SGLT2 inhibitor within 12 weeks prior to screening',
        to: 'Allow a stable dose of an SGLT2 inhibitor for ≥ 12 weeks before screening (no dose change planned); add baseline SGLT2i use (yes/no) as a third randomization stratification factor.',
        why: `${pct(e4 ? e4.n / totalFails : 0)} of screen failures; ${pct(stableShare)} of them were on a stable dose.`,
      }],
      do_not_amend: e7 ? [{ criterion_id: 'E7', why: 'Safety criterion (hyperkalemia with MR antagonism); per protocol §5.4 the DSMB may relax it only after the first unblinded safety review.' }] : [],
    },
    rescue_sites: rescue,
    params,
  };
}

export async function analyzeRescue(
  req: Request,
  trialId: string,
  opts: { genieSpaceId: string; memoModel: string; onStep: (e: StepEvent) => void },
): Promise<{ analysis: RescueAnalysis; memo: string }> {
  const { onStep } = opts;
  onStep({ id: 'data', label: 'Reading enrollment, screening log, catchment and site scores', status: 'running' });
  const f = await gatherFacts(trialId);
  const e = f.enrollment;
  onStep({ id: 'data', label: `Enrollment: ${e.randomized} of ${e.planned_to_date} planned randomized (${pct(e.pct_of_plan)})`, status: 'done',
    detail: `run rate ${e.run_rate_3m}/month over the last 3 complete months · ${e.active_sites} active sites · screen-fail ${pct(e.screen_fail_rate)} vs ${pct(e.planned_screen_fail_rate)} assumed` });
  const top = f.screen_fails.by_criterion[0];
  onStep({ id: 'screen', label: `Read ${f.screen_fails.total} screen failures — #1 reason: ${top.criterion_id} ${top.name} (${pct(top.share)})`, status: 'done',
    detail: `AI Functions recovered ${f.screen_fails.ai_recovered} failures the sites coded as OTHER · E4 share ${pct(f.screen_fails.e4_share_first6)} (first 6 months) → ${pct(f.screen_fails.e4_share_last6)} (last 6) · coded E4 alone shows only ${pct(f.screen_fails.e4_coded_share)}` });
  onStep({ id: 'pool', label: `Eligible pool around active sites: ${f.pool.current.toLocaleString()} → ${f.pool.amended.toLocaleString()} with the E4 amendment (${f.pool.multiplier}x)`, status: 'done',
    detail: `${pct(f.pool.pct_on_sglt2i)} of the T2D+CKD catchment is on an SGLT2i today vs ${pct(f.pool.feasibility_assumed_pct)} assumed in the 2023 feasibility` });
  onStep({ id: 'sites', label: `${f.zero_enrollers.length} active sites have randomized nobody after ≥ 6 months; ${f.competition.sites} share ${f.competition.acronym}`, status: 'done',
    detail: `${f.competition.acronym} sites: ${f.competition.rate_before} → ${f.competition.rate_since} randomized/site/month since it opened` });

  const protocolQuestion = 'For CASCADE-CKD: is exclusion E4 (SGLT2 inhibitor within 12 weeks) a safety or an efficacy-design criterion, can an amendment allow patients on a stable SGLT2 inhibitor, and what does the SAP say about power, sample size and stratification if we do? Can exclusion E7 (potassium > 4.8) be relaxed now? How long until an eligibility amendment is effective at central-IRB and local-IRB sites, and can prior screen failures be re-screened?';
  onStep({ id: 'protocol', label: 'Asking the protocol, SAP and amendment SOP (Genie agent)', status: 'running', detail: protocolQuestion });
  let guidance: RescueAnalysis['protocol_guidance'] = null;
  try {
    const doc = await askDocuments(req, opts.genieSpaceId, `Answer from the CASCADE-CKD protocol, SAP, feasibility and amendment SOP documents only, citing document and section: ${protocolQuestion}`);
    guidance = { question: protocolQuestion, answer: doc.answer, source: doc.sources.join(', ') };
    onStep({ id: 'protocol', label: 'Protocol guidance retrieved', status: 'done', detail: doc.sources.join(', ') || 'CASCADE-CKD protocol assistant' });
  } catch (err) {
    onStep({ id: 'protocol', label: 'Protocol assistant unavailable', status: 'error', detail: (err as Error).message.slice(0, 160) });
  }

  const selected = f.rescue_sites.filter((s) => s.selected);
  onStep({ id: 'model', label: `Ranked ${f.rescue_sites.length} candidate sites with ${f.model.name} (v${f.model.version})`, status: 'done',
    detail: `top ${selected.length} add ${selected.reduce((a, s) => a + s.predicted_rate_amended, 0).toFixed(1)} randomized/month once active (no competing DKD trial, ≥ 300 amended-eligible patients)` });
  const projection = project(f.params, selected);
  const [sq, am, all] = projection;
  onStep({ id: 'project', label: `Projected last patient in: ${monthLabel(sq.lpi_date)} → ${monthLabel(all.lpi_date)}`, status: 'done',
    detail: `planned ${monthLabel(e.planned_lpi)} · status quo +${sq.months_late ?? '72+'} mo · amend E4 only +${am.months_late ?? '72+'} mo · amend + ${selected.length} sites +${all.months_late ?? '72+'} mo` });

  onStep({ id: 'memo', label: 'Drafting the amendment proposal and rescue-plan memo', status: 'running' });
  const system = `You are a senior clinical operations lead at Halcyra Therapeutics writing for the CASCADE-CKD study team.
Write (1) "summary": 2-3 plain sentences for the study manager — the root cause and the recommendation with the key numbers — and
(2) "memo": an enrollment rescue plan memo that follows SOP CLINOPS-014 §2, as PLAIN TEXT (no markdown, no asterisks or # — use CAPITALIZED
section titles and "-" bullets). Sections: ROOT CAUSE, PROPOSED AMENDMENT (protocol v4.0), WHAT WE ARE NOT CHANGING, RESCUE SITES,
SITES TO REVIEW FOR CLOSURE, REVISED PROJECTION, RISKS, APPROVALS NEEDED. Use ONLY the facts provided — every number and date must come from
them; cite protocol/SAP/SOP sections only as they appear in protocol_guidance. Keep the memo under 380 words. Do not invent qualifiers (e.g. 'with complete data') that are not in the facts. Return ONLY a JSON object:
{"summary": string, "memo": string}.`;
  const user = JSON.stringify({
    trial: 'CASCADE-CKD (HAL-301), Phase III velmeraptan in T2D + CKD', today: f.as_of, enrollment: f.enrollment,
    screen_failures: {
      total_screen_failures: f.screen_fails.total,
      top_reasons_real_criterion: f.screen_fails.by_criterion.slice(0, 6).map((r) => ({ criterion: `${r.criterion_id} ${r.name}`, failures: r.n, share_of_all_failures: r.share, of_which_coded_to_it_by_sites: r.coded })),
      e4_share_of_failures_first_6_months: f.screen_fails.e4_share_first6, e4_share_of_failures_last_6_months: f.screen_fails.e4_share_last6,
      e4_share_if_you_only_read_site_coding: f.screen_fails.e4_coded_share,
      share_of_all_e4_failures_on_stable_sglt2i_12wk: f.screen_fails.e4_stable_share,
      failures_sites_coded_OTHER_that_ai_functions_reclassified: f.screen_fails.ai_recovered,
    },
    eligible_pool: f.pool, competition: f.competition,
    zero_enrollers: f.zero_enrollers.map((z) => `${z.site_name} (${z.city}) — ${z.months_active} months, ${z.screened} screened${z.competing_trial ? `, shares ${z.competing_trial}` : ''}`),
    recommendation: f.recommendation, protocol_guidance: guidance?.answer ?? null,
    rescue_sites: selected.map((s) => `${s.site_name}, ${s.city} ${s.state} — ${s.predicted_rate_amended}/mo predicted, active in ~${s.est_activation_months} mo, ${s.eligible_amended} amended-eligible patients`),
    projection: projection.map((p) => ({ scenario: p.label, last_patient_in: monthLabel(p.lpi_date), months_late: p.months_late })),
    amendment_effect: { existing_site_rate_multiplier: f.params.amendmentUplift, rescreen_recoverable_patients: f.params.rescreenBolus, effective_after_months: f.params.amendmentLagMonths },
  });
  let summary = '';
  let memo = '';
  try {
    const out = await chatJson<{ summary: string; memo: string }>(req, opts.memoModel, system, user);
    summary = out.summary;
    memo = out.memo;
    onStep({ id: 'memo', label: 'Rescue-plan memo drafted', status: 'done', detail: `${memo.split(/\s+/).length} words · ${opts.memoModel}` });
  } catch (err) {
    summary = `E4 (SGLT2 inhibitor use) drives ${pct(top.share)} of screen failures; amend it and add ${selected.length} rescue sites.`;
    onStep({ id: 'memo', label: 'Memo drafting failed', status: 'error', detail: (err as Error).message.slice(0, 160) });
  }
  const { params, ...rest } = f;
  return {
    analysis: { ...rest, projection, projection_params: params, protocol_guidance: guidance, summary, model_used: opts.memoModel, generated_at: new Date().toISOString() },
    memo,
  };
}
