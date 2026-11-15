/**
 * Deterministic HRRP what-if (no LLM) — shared by the server (agent tool) and the client (the HRRP
 * page slider): "had 4 West booked a 7-day follow-up for X% of its weekend heart-failure discharges over
 * the HRRP window (trailing 12 months), how many readmissions would Larkspur Regional have avoided, and
 * what would its HF excess readmission ratio and HRRP penalty be?"
 *
 * Method: readmissions avoided = 4 West weekend HF Medicare FFS 65+ discharges in the window × (target −
 * current follow-up share) × (HF weekend readmission rate without − with a 7-day follow-up). The HF ERR
 * uses the same credibility-weighted estimate as the gold table (hrrp_performance.err_estimate):
 * (R + K·national) / ((D + K)·national). The other conditions keep their contribution; cap 3%.
 */
export type HrrpWhatIfInputs = {
  hf_discharges: number;             // Larkspur Regional HF Medicare FFS 65+ discharges, trailing 12 months
  hf_readmissions: number;
  national_rate: number;             // HF national 30-day readmission rate
  credibility_k: number;             // pseudo-discharges at the national rate (150)
  hf_payment_share: number;          // HF Medicare payments / base-operating DRG payments
  other_contribution: number;        // Σ penalty_contribution of the other conditions
  base_payments: number;             // Medicare base-operating DRG payments (annual)
  weekend_discharges: number;        // 4 West weekend HF Medicare FFS 65+ discharges in the same window
  weekend_followup_share: number;    // share of them that left with a 7-day follow-up booked
  rate_with_followup: number;        // HF weekend discharges, readmission rate WITH a 7-day follow-up
  rate_without_followup: number;     // … WITHOUT
};

export type HrrpWhatIf = {
  target_followup_share: number;
  readmissions_avoided: number;
  hf_err_now: number;
  hf_err_new: number;
  penalty_now: number;
  penalty_new: number;
  penalty_saved: number;
};

const err = (i: HrrpWhatIfInputs, r: number) =>
  (r + i.credibility_k * i.national_rate) / ((i.hf_discharges + i.credibility_k) * i.national_rate);
const penalty = (i: HrrpWhatIfInputs, e: number) =>
  Math.min(0.03, i.other_contribution + i.hf_payment_share * Math.max(0, e - 1)) * i.base_payments;

export function hrrpWhatIf(i: HrrpWhatIfInputs, target: number): HrrpWhatIf {
  const t = Math.max(0, Math.min(1, target));
  const avoided = Math.max(0, i.weekend_discharges * (t - i.weekend_followup_share) * (i.rate_without_followup - i.rate_with_followup));
  const errNow = err(i, i.hf_readmissions);
  const errNew = err(i, Math.max(0, i.hf_readmissions - avoided));
  const pNow = penalty(i, errNow);
  const pNew = penalty(i, errNew);
  return {
    target_followup_share: t,
    readmissions_avoided: Math.round(avoided),
    hf_err_now: Math.round(errNow * 1000) / 1000,
    hf_err_new: Math.round(errNew * 1000) / 1000,
    penalty_now: Math.round(pNow),
    penalty_new: Math.round(pNew),
    penalty_saved: Math.round(pNow - pNew),
  };
}
