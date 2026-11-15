/**
 * Enrollment projection — pure and deterministic, shared by the server's rescue
 * analysis and the workbench UI (so ticking a rescue site re-projects instantly).
 * No LLM ever produces a date or a patient count.
 *
 *   status quo            existing sites keep the last-3-complete-month run rate
 *   + amendment           from month `amendmentLagMonths` the existing sites' rate is
 *                         multiplied by `amendmentUplift` (screen-log evidence: stable-
 *                         SGLT2i screen failures × the pass rate of the other criteria),
 *                         plus a one-off re-screen of prior stable-SGLT2i screen failures
 *                         (SOP CLINOPS-014 §4.4) spread over 3 months
 *   + rescue sites        each selected site adds its model-predicted amended rate from
 *                         its estimated activation month (never before the amendment)
 */
export type ProjectionParams = {
  target: number;
  randomizedToDate: number;
  startMonth: string; // YYYY-MM-01, first projected month (next month)
  runRate: number; // randomized / month, last 3 complete months
  amendmentUplift: number; // multiplier on existing sites' rate
  amendmentLagMonths: number; // months from approval to effective at sites
  rescreenBolus: number; // patients recovered by re-screening prior E4 failures
  plannedLpi: string; // YYYY-MM-DD
};
export type ProjectionSite = { predicted_rate_amended: number; est_activation_months: number };
export type Curve = Array<{ month: string; cum: number }>;
export type Scenario = { key: 'status_quo' | 'amendment' | 'amendment_plus_sites'; label: string; monthly_rate_end: number; lpi_date: string | null; months_late: number | null; curve: Curve };

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.slice(0, 7).split('-').map(Number);
  const [yb, mb] = b.slice(0, 7).split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

function run(p: ProjectionParams, opt: { amend: boolean; sites: ProjectionSite[] }, key: Scenario['key'], label: string): Scenario {
  const curve: Curve = [];
  let cum = p.randomizedToDate;
  let lpi: string | null = null;
  let rate = p.runRate;
  for (let i = 0; i < 72 && cum < p.target; i++) {
    const month = addMonths(p.startMonth, i);
    rate = p.runRate;
    if (opt.amend && i >= p.amendmentLagMonths) rate = p.runRate * p.amendmentUplift;
    let add = rate;
    if (opt.amend && i >= p.amendmentLagMonths && i < p.amendmentLagMonths + 3) add += p.rescreenBolus / 3;
    for (const s of opt.sites) {
      const startAt = Math.max(Math.ceil(s.est_activation_months), p.amendmentLagMonths);
      if (i >= startAt) {
        // a newly activated site ramps over its first 3 months (50% → 75% → 100%)
        const k = i - startAt;
        const ramp = k === 0 ? 0.5 : k === 1 ? 0.75 : 1;
        add += s.predicted_rate_amended * ramp;
        if (k >= 2) rate += s.predicted_rate_amended;
      }
    }
    cum = Math.min(p.target, cum + add);
    curve.push({ month, cum: Math.round(cum) });
    if (cum >= p.target) lpi = month;
  }
  return {
    key, label, monthly_rate_end: Math.round(rate * 10) / 10, lpi_date: lpi,
    months_late: lpi ? Math.max(0, monthsBetween(p.plannedLpi, lpi)) : null, curve,
  };
}

export function project(p: ProjectionParams, selected: ProjectionSite[]): Scenario[] {
  return [
    run(p, { amend: false, sites: [] }, 'status_quo', 'Status quo'),
    run(p, { amend: true, sites: [] }, 'amendment', 'Amend E4 only'),
    run(p, { amend: true, sites: selected }, 'amendment_plus_sites', `Amend E4 + ${selected.length} rescue sites`),
  ];
}
