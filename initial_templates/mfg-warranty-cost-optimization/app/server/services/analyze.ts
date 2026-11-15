/**
 * The root-cause case — the workbench's AI step, for one early-warning signal.
 *
 *   1. Claims evidence: every claim ai_classify put in this failure mode (Lakebase mirror of
 *      gold_claims) — and how the dealers had coded them.
 *   2. Isolate the cohort: which genealogy value (controller lot / brake lot / firmware)
 *      concentrates the claims — per 1,000 unit-years in service, straight from Delta.
 *   3. Test the alternatives (live SQL on the lakehouse): firmware, the other supplier's part
 *      built in the same weeks, wet vs dry regions.
 *   4. Telemetry early warning: connected bikes reporting the tell-tale fault code, and the
 *      bikes that report it today but have not failed yet.
 *   5. Ask the supplier-quality library (the Genie agent over the supplier documents): PCN / PPAP status
 *      and what the supplier quality agreement lets Brightwater recover.
 *   6. Project the remaining-warranty exposure and price the containment options —
 *      deterministic arithmetic, never left to an LLM.
 *   7. A Foundation Model writes the root-cause statement + the 8D / chargeback notice.
 *
 * Every step is reported through `onStep` so the UI can stream progress. The same
 * deterministic core (`buildEvidence`) backs the chat agent's `get_root_cause_evidence` tool.
 */
import type { Request } from 'express';
import type { ContainmentAction, Finding, SignalAnalysis } from '../db/schema.js';
import { execSql, fqn, type DataConfig } from '../db/sync.js';
import { askDocuments, chatJson } from '../lib/serving.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export type SignalRow = {
  id: string; failureMode: string; failureModeLabel: string; component: string | null; supplierId: string;
  supplierName: string; chargeable: boolean; claims90d: number; claimsBase: number; claimsTotal: number;
  costToDate: number | null; avgClaimCost: number | null; rate90d: number | null; baselineRate: number | null;
  rateRatio: number | null; dealerCodeAgreement: number | null;
  cohort: import('../db/schema.js').SignalCohort | null; exposure: import('../db/schema.js').ExposureRow[];
};

export type ClaimLite = {
  id: string; dealer_labor_code: string | null; water_exposure: boolean | null; fault_code: string | null;
  total_cost: number | null; region: string | null; claim_status: string | null;
};

const LABOR_RATE = 96;
const ADMIN_FEE = 35;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const n0 = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Per failure mode: the fault code that foreshadows it + the field fix and its economics. */
const PLAYBOOK: Record<string, { fault?: string; fix: string; fixCost: number; efficacy: number; replaceCost: number; ota?: boolean }> = {
  controller_water_ingress: { fault: 'E21', fix: 'controller seal kit (gasket G-48B, dielectric grease, edge potting)', fixCost: 22 + 0.3 * LABOR_RATE, efficacy: 0.85, replaceCost: 312 + 1.8 * LABOR_RATE },
  controller_electrical_other: { fault: 'E07', fix: 'controller replacement', fixCost: 312 + 1.8 * LABOR_RATE, efficacy: 0.95, replaceCost: 312 + 1.8 * LABOR_RATE },
  display_freeze_firmware: { fix: 'firmware 3.2.1 over the air (dealer reflash for bikes that are not connected)', fixCost: 0, efficacy: 0.95, replaceCost: 0.6 * LABOR_RATE, ota: true },
  brake_caliper_leak: { fix: 'rear caliper replacement + bleed', fixCost: 96 + 1.2 * LABOR_RATE, efficacy: 0.98, replaceCost: 96 + 1.2 * LABOR_RATE },
  battery_bms_fault: { fault: 'E12', fix: 'BMS firmware update + pack inspection', fixCost: 0.5 * LABOR_RATE, efficacy: 0.6, replaceCost: 640 + LABOR_RATE },
  battery_connector_wear: { fix: 'battery connector + rail replacement', fixCost: 42 + 0.8 * LABOR_RATE, efficacy: 0.95, replaceCost: 42 + 0.8 * LABOR_RATE },
};

export type Evidence = Omit<SignalAnalysis, 'headline' | 'root_cause' | 'summary' | 'supplier_guidance' | 'model' | 'generated_at'> & {
  facts: string[];
  libraryQuestion: string;
  claimStats: { n: number; codes: Array<{ code: string; share: number }>; water_share: number; top_fault: string | null };
  scopeLots: string[];
  plantStock: number;
};

/** Deterministic evidence: live SQL on Delta + the mirrored claims. No LLM. */
export async function buildEvidence(sig: SignalRow, claims: ClaimLite[], cfg: DataConfig, onStep?: (e: StepEvent) => void): Promise<Evidence> {
  const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
  const step = onStep ?? (() => {});
  const facts: string[] = [];
  const findings: Finding[] = [];
  const pb = PLAYBOOK[sig.failureMode] ?? { fix: 'targeted field fix', fixCost: 60, efficacy: 0.8, replaceCost: sig.avgClaimCost ?? 300 };

  // ── 1. claims evidence ────────────────────────────────────────────────
  step({ id: 'claims', label: `Reading ${claims.length} claims classified as “${sig.failureModeLabel}”`, status: 'running' });
  const valid = claims.filter((c) => c.claim_status !== 'rejected');
  const codeCounts = new Map<string, number>();
  for (const c of valid) codeCounts.set(c.dealer_labor_code ?? '—', (codeCounts.get(c.dealer_labor_code ?? '—') ?? 0) + 1);
  const codes = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([code, k]) => ({ code, share: k / Math.max(1, valid.length) }));
  const water = valid.filter((c) => c.water_exposure).length / Math.max(1, valid.length);
  const faults = new Map<string, number>();
  for (const c of valid) if (c.fault_code) faults.set(c.fault_code, (faults.get(c.fault_code) ?? 0) + 1);
  const topFault = [...faults.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const codeTxt = codes.slice(0, 3).map((c) => `${c.code} ${pct(c.share)}`).join(', ');
  findings.push({
    id: 'coding', title: 'Hidden in generic dealer labor codes', verdict: 'INFO',
    detail: `${valid.length} claims (${sig.claims90d} in the last 90 days, ${sig.rateRatio ?? '?'}× the prior-year rate). Dealers coded them ${codeTxt} — ai_classify over the technician notes is what groups them into one failure mode.${water > 0.5 ? ` ${pct(water)} of the notes mention rain, washing or moisture.` : ''}`,
  });
  facts.push(findings[0].detail);
  step({ id: 'claims', label: `Read ${valid.length} claims`, status: 'done', detail: `dealer codes ${codeTxt}${topFault ? ` · most-cited fault ${topFault}` : ''}` });

  // ── 2. cohort isolation ───────────────────────────────────────────────
  const dim = sig.cohort?.dimension ?? 'controller_lot';
  step({ id: 'cohort', label: `Isolating the cohort by ${dim.replace('_', ' ')}`, status: 'running' });
  const suspect = sig.cohort?.suspect ?? [];
  const allVals = sig.cohort?.all ?? [];
  let lots: Evidence['lots'] = [];
  let scopeLots: string[] = suspect.map((s) => s.value);
  let plantStock = 0;
  if (dim === 'controller_lot' && allVals.length) {
    const rows = await execSql<Record<string, unknown>>(wh, `
      SELECT l.controller_lot, l.units_built, l.units_sold, l.units_in_stock, l.water_ingress_claims, l.controller_claims,
             l.water_claims_per_1k_unit_years, l.e21_bikes_per_1k_connected, l.conformal_coating, l.pcn_reference, l.ppap_status,
             k.claims, k.claims_per_1k_unit_years, k.in_scope, s.quantity
      FROM ${fqn(cfg, 'gold_lot_quality')} l
      LEFT JOIN ${fqn(cfg, 'gold_signal_cohorts')} k ON k.signal_id = ${lit(sig.id)} AND k.cohort_value = l.controller_lot
      LEFT JOIN ${fqn(cfg, 'supplier_lots')} s ON s.lot_id = l.controller_lot
      WHERE l.supplier_id = ${lit(sig.supplierId)} ORDER BY l.controller_lot`);
    lots = rows.map((r) => ({
      lot: String(r.controller_lot), units: n0(r.units_built), units_in_stock: n0(r.units_in_stock), claims: n0(r.claims),
      rate: n0(r.claims_per_1k_unit_years), e21_rate: r.e21_bikes_per_1k_connected == null ? null : n0(r.e21_bikes_per_1k_connected),
      coating: (r.conformal_coating as string) ?? null, ppap: (r.ppap_status as string) ?? null,
    }));
    scopeLots = rows.filter((r) => r.in_scope === true || r.in_scope === 'true').map((r) => String(r.controller_lot));
    plantStock = rows.filter((r) => scopeLots.includes(String(r.controller_lot)))
      .reduce((a, r) => a + Math.max(0, n0(r.quantity) - n0(r.units_built)), 0);
  } else {
    lots = allVals.map((v) => ({ lot: v.value, units: v.units, units_in_stock: v.units - v.units_sold, claims: v.claims, rate: v.rate, e21_rate: null, coating: null, ppap: null }));
  }
  const susClaims = suspect.reduce((a, s) => a + s.claims, 0);
  const susUnits = suspect.reduce((a, s) => a + s.units, 0);
  const restRate = sig.cohort?.rest_rate ?? 0;
  const susVals = allVals.filter((v) => v.suspect);
  const susUy = susVals.reduce((a, v) => a + (v.unit_years ?? 0), 0);
  const susRate = susUy > 0 ? (1000 * susVals.reduce((a, v) => a + v.claims, 0)) / susUy : 0;
  if (suspect.length) {
    const label = dim === 'controller_lot' ? `Lots ${suspect.map((s) => s.value).join(', ')}` : dim === 'firmware_version' ? `Firmware ${suspect.map((s) => s.value).join(', ')}` : suspect.map((s) => s.value).join(', ');
    const pcnLots = lots.filter((l) => scopeLots.includes(l.lot) && !suspect.some((s) => s.value === l.lot));
    findings.push({
      id: 'cohort', title: `Concentrated in ${dim === 'firmware_version' ? 'one firmware version' : `${suspect.length} ${sig.supplierName.split(' ')[0]} lots`}`, verdict: 'CONFIRMED',
      detail: `${label}: ${susClaims} of ${valid.length} claims from ${susUnits.toLocaleString()} bikes — ~${Math.round(susRate)} claims per 1,000 bike-years vs ~${Math.round(restRate * 10) / 10} for every other ${dim === 'firmware_version' ? 'version' : 'lot'} (${restRate > 0 ? Math.round(susRate / restRate) : '∞'}×).` +
        (pcnLots.length ? ` ${pcnLots.map((l) => l.lot).join(' and ')} ${pcnLots.length > 1 ? 'have' : 'has'} barely any claims yet (the bikes are only weeks old) but ${pcnLots.length > 1 ? 'were' : 'was'} built under the same ${lots.find((l) => l.lot === pcnLots[0].lot)?.coating?.match(/PCN-\d+/)?.[0] ?? 'supplier change'} — in scope for containment.` : ''),
      evidence: suspect.map((s) => s.value).join(','),
    });
    facts.push(findings[findings.length - 1].detail);
  }
  step({ id: 'cohort', label: suspect.length ? `Cohort isolated: ${scopeLots.join(', ')}` : 'No single cohort concentrates the claims', status: 'done', detail: suspect.length ? `${Math.round(susRate)} vs ${Math.round(restRate * 10) / 10} claims per 1,000 bike-years` : undefined });

  // ── 3. alternatives ───────────────────────────────────────────────────
  step({ id: 'alternatives', label: 'Testing alternative explanations on the lakehouse', status: 'running', detail: 'firmware · other supplier · climate' });
  const inList = (vals: string[]) => (vals.length ? vals.map(lit).join(', ') : "''");
  const allList = inList(allVals.map((v) => v.value));
  const susList = inList(scopeLots);
  const claimJoin = `LEFT JOIN ${fqn(cfg, 'gold_claims')} c ON c.serial = u.serial AND c.failure_mode = ${lit(sig.failureMode)} AND c.claim_status <> 'rejected'`;
  const uy = `sum(CASE WHEN u.sold THEN datediff(current_date(), u.sale_date) / 365.0 ELSE 0 END)`;
  try {
    if (dim !== 'firmware_version') {
      // (a) firmware inside vs outside the suspect cohort
      const fw = await execSql<Record<string, unknown>>(wh, `
        SELECT u.firmware_version AS fw, u.${dim} IN (${susList}) AS suspect, count(DISTINCT u.serial) AS units,
               ${uy} AS uy, count(c.claim_id) AS claims
        FROM ${fqn(cfg, 'units')} u ${claimJoin}
        WHERE u.sold AND u.${dim} IN (${allList}) GROUP BY 1, 2`);
      const rate = (f: string, s: boolean) => {
        const r = fw.find((x) => x.fw === f && (x.suspect === s || x.suspect === String(s)));
        return r && n0(r.uy) > 0 ? (1000 * n0(r.claims)) / n0(r.uy) : null;
      };
      const a = rate('3.2.0', false), b = rate('3.1.4', false), c2 = rate('3.2.0', true);
      if (a != null && b != null) {
        const similar = Math.abs(a - b) < Math.max(2, 0.6 * Math.max(a, b));
        findings.push({
          id: 'firmware', title: 'Firmware 3.2.0 OTA update', verdict: similar ? 'RULED_OUT' : 'WATCH',
          detail: `Outside the suspect lots, bikes on 3.2.0 fail at ${a.toFixed(1)} per 1,000 bike-years vs ${b.toFixed(1)} on 3.1.4 — ${similar ? 'no firmware effect' : 'a firmware effect worth checking'}. Inside the suspect lots: ${c2 != null ? c2.toFixed(0) : '?'}. Dealers who blame the update are looking at timing, not cause.`,
        });
      }
      // (b) the other supplier's part, built in the same weeks
      if (dim === 'controller_lot' && suspect.length) {
        const other = await execSql<Record<string, unknown>>(wh, `
          WITH win AS (SELECT min(build_date) AS a, max(build_date) AS b FROM ${fqn(cfg, 'units')} WHERE controller_lot IN (${susList}))
          SELECT u.controller_supplier_id AS sup, count(DISTINCT u.serial) AS units, ${uy} AS uy, count(c.claim_id) AS claims
          FROM ${fqn(cfg, 'units')} u CROSS JOIN win ${claimJoin}
          WHERE u.sold AND u.build_date BETWEEN win.a AND win.b GROUP BY 1`);
        const mine = other.find((r) => r.sup === sig.supplierId);
        const theirs = other.find((r) => r.sup !== sig.supplierId);
        if (mine && theirs) {
          const rm = (1000 * n0(mine.claims)) / Math.max(0.1, n0(mine.uy));
          const rt = (1000 * n0(theirs.claims)) / Math.max(0.1, n0(theirs.uy));
          findings.push({
            id: 'assembly', title: 'Reno assembly / build weeks', verdict: 'RULED_OUT',
            detail: `Trail T5 bikes (Kessler MC-60 controller, fully potted) built on the same line in the same weeks: ${n0(theirs.claims)} claim${n0(theirs.claims) === 1 ? "" : "s"} from ${n0(theirs.units).toLocaleString()} bikes (${rt.toFixed(1)} per 1,000 bike-years) vs ${rm.toFixed(0)} for the ${sig.supplierName.split(' ')[0]} controller. Same plant, same weeks, same weather — it's the part, not the assembly.`,
          });
        }
      }
      // (c) climate
      const cl = await execSql<Record<string, unknown>>(wh, `
        SELECT u.region IN ('Pacific Northwest','Northeast','Southeast') AS wet, count(DISTINCT u.serial) AS units, ${uy} AS uy, count(c.claim_id) AS claims
        FROM ${fqn(cfg, 'units')} u ${claimJoin}
        WHERE u.sold AND u.${dim} IN (${susList}) GROUP BY 1`);
      const w = cl.find((r) => r.wet === true || r.wet === 'true');
      const d = cl.find((r) => r.wet === false || r.wet === 'false');
      if (w && d) {
        const rw = (1000 * n0(w.claims)) / Math.max(0.1, n0(w.uy));
        const rd = (1000 * n0(d.claims)) / Math.max(0.1, n0(d.uy));
        findings.push({
          id: 'climate', title: 'Wet climate', verdict: rw > 1.8 * rd ? 'CONFIRMED' : 'INFO',
          detail: `Inside the suspect cohort, bikes sold in the Pacific Northwest, Northeast and Southeast fail at ${rw.toFixed(0)} per 1,000 bike-years vs ${rd.toFixed(0)} in dry regions (${(rw / Math.max(0.1, rd)).toFixed(1)}×) — a moisture mechanism.`,
        });
      }
    }
  } catch (e) {
    findings.push({ id: 'alt_error', title: 'Alternative checks unavailable', verdict: 'INFO', detail: (e as Error).message.slice(0, 200) });
  }
  step({ id: 'alternatives', label: 'Alternatives tested', status: 'done', detail: findings.filter((f) => ['firmware', 'assembly', 'climate'].includes(f.id)).map((f) => `${f.title}: ${f.verdict.replace('_', ' ').toLowerCase()}`).join(' · ') || 'n/a' });

  // ── 4. telemetry ──────────────────────────────────────────────────────
  let telemetry: Evidence['telemetry'] = null;
  if (pb.fault && dim !== 'firmware_version') {
    step({ id: 'telemetry', label: `Checking connected-bike telemetry for fault ${pb.fault}`, status: 'running' });
    try {
      const t = await execSql<Record<string, unknown>>(wh, `
        WITH e AS (
          SELECT serial, count_if(event_date >= date_sub(current_date(), 30)) AS n30 FROM ${fqn(cfg, 'telemetry_fault_events')} WHERE fault_code = ${lit(pb.fault)} GROUP BY serial
        ), cl AS (
          SELECT DISTINCT serial FROM ${fqn(cfg, 'gold_claims')} WHERE failure_mode = ${lit(sig.failureMode)} AND claim_status <> 'rejected'
        )
        SELECT u.${dim} IN (${susList}) AS suspect, count(*) AS connected, count(e.serial) AS with_fault,
               count_if(e.n30 >= 2 AND cl.serial IS NULL) AS at_risk
        FROM ${fqn(cfg, 'units')} u LEFT JOIN e ON e.serial = u.serial LEFT JOIN cl ON cl.serial = u.serial
        WHERE u.sold AND u.connected AND u.${dim} IN (${allList}) GROUP BY 1`);
      const s = t.find((r) => r.suspect === true || r.suspect === 'true');
      const o = t.find((r) => r.suspect === false || r.suspect === 'false');
      telemetry = {
        suspect_e21_per_1k: s ? Math.round((1000 * n0(s.with_fault)) / Math.max(1, n0(s.connected))) : null,
        other_e21_per_1k: o ? Math.round((1000 * n0(o.with_fault)) / Math.max(1, n0(o.connected))) : null,
        at_risk_bikes: s ? n0(s.at_risk) : null,
      };
      findings.push({
        id: 'telemetry', title: `Early warning in telemetry (${pb.fault})`, verdict: 'CONFIRMED',
        detail: `${telemetry.suspect_e21_per_1k} of every 1,000 connected bikes in the suspect lots have reported ${pb.fault} (controller moisture / Hall-signal loss) vs ${telemetry.other_e21_per_1k} elsewhere. ${telemetry.at_risk_bikes} bikes reported it at least twice in the last 30 days and have not failed yet — wave 1 of the campaign.`,
      });
      facts.push(findings[findings.length - 1].detail);
      step({ id: 'telemetry', label: `${telemetry.at_risk_bikes} bikes are signalling ${pb.fault} now`, status: 'done', detail: `${telemetry.suspect_e21_per_1k} vs ${telemetry.other_e21_per_1k} per 1,000 connected bikes` });
    } catch (e) {
      step({ id: 'telemetry', label: 'Telemetry unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
    }
  }

  // ── 6. exposure + containment options (deterministic) ──────────────────
  const ex = sig.exposure;
  const affected = ex.reduce((a, r) => a + r.units, 0);
  const inField = ex.reduce((a, r) => a + r.units_in_field, 0);
  const inStock = ex.reduce((a, r) => a + r.units_in_stock, 0);
  const claimsToDate = ex.reduce((a, r) => a + r.claims_to_date, 0);
  const costToDate = ex.reduce((a, r) => a + r.cost_to_date, 0);
  const projClaims = ex.reduce((a, r) => a + r.projected_claims, 0);
  const projCost = ex.reduce((a, r) => a + r.projected_cost, 0);
  const wetProj = ex.filter((r) => r.wet_region).reduce((a, r) => a + r.projected_cost, 0);
  const wetUnits = ex.filter((r) => r.wet_region).reduce((a, r) => a + r.units - r.claims_to_date, 0);
  const exposure = affected ? { affected_units: affected, in_field: inField, in_stock: inStock, claims_to_date: claimsToDate, cost_to_date: Math.round(costToDate), projected_claims: projClaims, projected_cost: Math.round(projCost), wet_share: projCost ? wetProj / projCost : 0 } : null;
  const recoverable = sig.chargeable;
  const toFix = Math.max(0, affected - claimsToDate);
  const fullCampaign = Math.round(toFix * pb.fixCost + (pb.ota ? 0.25 * toFix * 0.6 * LABOR_RATE : 0));
  const wetCampaign = Math.round(wetUnits * pb.fixCost);
  const options: ContainmentAction[] = [];
  if (dim === 'controller_lot' || dim === 'brake_lot' || dim === 'battery_lot') {
    options.push({
      key: 'stop_ship', label: 'Stop-ship + quarantine', recommended: true, units: inStock + plantStock, cost: null, recoverable: null,
      detail: `Hold ${plantStock.toLocaleString()} ${sig.supplierName.split(' ')[0]} parts from ${scopeLots.join(', ')} at the Reno plant and ${inStock.toLocaleString()} unsold bikes in dealer stock; supplier 24 h containment + 8D (SQA §6).`,
    });
  }
  options.push({
    key: 'do_nothing', label: 'Pay claims as they come', recommended: false, units: toFix, cost: Math.round(projCost), recoverable: recoverable ? Math.round(projCost + projClaims * ADMIN_FEE) : 0,
    detail: `~${projClaims.toLocaleString()} more failures over the remaining warranty (${money(projCost)} at ${money(sig.avgClaimCost ?? 0)} a claim) — and a rider stranded in the rain each time.`,
  });
  if (!pb.ota && wetUnits > 0 && wetUnits < toFix) {
    options.push({
      key: 'campaign_wet', label: `Targeted campaign — wet regions${telemetry?.at_risk_bikes ? ` + ${pb.fault} bikes` : ''}`, recommended: false, units: wetUnits, cost: wetCampaign,
      recoverable: recoverable ? wetCampaign : 0,
      detail: `${pb.fix} on ${wetUnits.toLocaleString()} bikes in the Pacific Northwest, Northeast and Southeast (${pct(exposure?.wet_share ?? 0)} of the projected cost) at ${money(pb.fixCost)} a bike.`,
    });
  }
  options.push({
    key: 'campaign_full', label: pb.ota ? 'OTA fix + dealer reflash' : 'Full service campaign (wave 1 = wet regions + E21 bikes)', recommended: true, units: toFix, cost: fullCampaign,
    recoverable: recoverable ? fullCampaign : 0,
    detail: pb.ota
      ? `Push ${pb.fix}. ~25% of affected bikes are not connected and need a 0.6 h dealer reflash (${money(fullCampaign)}). Prevents ~${pct(pb.efficacy)} of the ${projClaims.toLocaleString()} projected failures.`
      : `${pb.fix} on all ${toFix.toLocaleString()} in-scope bikes (field + dealer stock) at ${money(pb.fixCost)} a bike. Validated to prevent ~${pct(pb.efficacy)} of failures → avoids ~${money(projCost * pb.efficacy)} of the ${money(projCost)} projected.`,
  });
  if (recoverable) {
    const toDate = Math.round(costToDate + claimsToDate * ADMIN_FEE);
    options.push({
      key: 'chargeback', label: `Supplier chargeback — ${sig.supplierName}`, recommended: true, units: claimsToDate, cost: null, recoverable: toDate + fullCampaign,
      detail: `Recover ${money(costToDate)} of claims to date (paid + pending) + ${money(claimsToDate * ADMIN_FEE)} admin fees (${claimsToDate} × $${ADMIN_FEE}, SQA §8.1) + the ${money(fullCampaign)} campaign (SQA §8.2 — failures from an unapproved change).`,
    });
  }
  const chargeback = recoverable ? {
    to_date: Math.round(costToDate + claimsToDate * ADMIN_FEE), campaign: fullCampaign,
    total: Math.round(costToDate + claimsToDate * ADMIN_FEE) + fullCampaign,
    basis: 'SQA §8.1 (parts + labor at $96/h + $35 admin fee per claim) and §8.2 (100% of field-campaign cost for failures caused by an unapproved change)',
  } : null;

  // the single question the case hinges on
  let libraryQuestion: string;
  if (sig.failureMode === 'controller_water_ingress') libraryQuestion = `Hanlin changed the MC-48 conformal coating under PCN-0419 (lots HX-2605 onward). Was that change approved per the PPAP and the supplier quality agreement, and what can Brightwater recover from Hanlin — for warranty claims already paid and for a field service campaign?`;
  else if (!sig.chargeable) libraryQuestion = `What does procedure QP-12 require for a field action on a ${sig.failureModeLabel.toLowerCase()} issue, and is a safety assessment needed?`;
  else libraryQuestion = `What can Brightwater recover from ${sig.supplierName} for ${sig.failureModeLabel.toLowerCase()} warranty claims under the supplier quality agreement?`;

  return {
    findings, lots, telemetry, exposure, options, chargeback, facts, libraryQuestion,
    claimStats: { n: valid.length, codes, water_share: water, top_fault: topFault }, scopeLots, plantStock,
  };
}

export async function analyzeSignal(
  req: Request,
  sig: SignalRow,
  claims: ClaimLite[],
  cfg: DataConfig,
  opts: { genieSpaceId: string; noticeModel: string; onStep: (e: StepEvent) => void },
): Promise<{ analysis: SignalAnalysis; notice: string }> {
  const { onStep } = opts;
  const ev = await buildEvidence(sig, claims, cfg, onStep);

  // ── 5. supplier-quality library (Genie agent) ───────────────────────────────────
  onStep({ id: 'library', label: 'Consulting the supplier-quality library (Genie agent)', status: 'running', detail: ev.libraryQuestion });
  let guidance: SignalAnalysis['supplier_guidance'] = null;
  if (opts.genieSpaceId) {
    try {
      const doc = await askDocuments(req, opts.genieSpaceId, `Answer from the supplier-quality documents only (PPAPs, PCNs, the supplier quality agreement, warranty policy, QP-12), citing the document and section: ${ev.libraryQuestion}`);
      guidance = { question: ev.libraryQuestion, answer: doc.answer, source: doc.sources.join(', ') };
      onStep({ id: 'library', label: 'PPAP / PCN / SQA guidance retrieved', status: 'done', detail: doc.sources.join(', ') || 'supplier quality documents' });
    } catch (e) {
      onStep({ id: 'library', label: 'Supplier-quality library unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
    }
  }

  onStep({ id: 'exposure', label: 'Projecting remaining-warranty exposure + pricing containment', status: 'running' });
  onStep({
    id: 'exposure', label: ev.exposure ? `Exposure: ${money(ev.exposure.projected_cost)} over the remaining warranty` : 'Exposure computed', status: 'done',
    detail: ev.exposure ? `${ev.exposure.affected_units.toLocaleString()} bikes in scope · ${ev.exposure.projected_claims.toLocaleString()} projected claims · ${ev.options.length} options priced` : undefined,
  });

  // ── 7. LLM write-up ────────────────────────────────────────────────────
  onStep({ id: 'writeup', label: sig.chargeable ? 'Writing the root-cause statement + 8D / chargeback notice' : 'Writing the root-cause statement + field-action brief', status: 'running' });
  const system = `You are a senior warranty & supplier-quality engineer at Brightwater Cycle Works (e-bike maker, Reno NV plant).
You write (1) a headline of at most 14 words, (2) a precise root-cause statement (at most 60 words: the physical mechanism + where it entered the supply chain — keep the evidence numbers for the summary), (3) a summary for the VP Quality of at most 70 words (the 3-4 numbers that matter, what to do, who pays), and (4) a ${sig.chargeable ? `formal notice to the supplier (${sig.supplierName}) requesting 24-hour containment, an 8D report (D4 root cause within 10 business days), and submitting the warranty chargeback with the amounts and the SQA clauses` : 'short internal field-action brief to the firmware + service teams'}.
Use ONLY the facts provided — never invent numbers, dates or clauses. Quote dollar amounts exactly as given. Write the notice as PLAIN TEXT: no markdown, no asterisks or # headings (use CAPITALIZED section titles and "-" bullets). Sign it "Priya Raman, Warranty & Field Quality Engineering, Brightwater Cycle Works".
Return ONLY a JSON object: {"headline": string, "root_cause": string, "summary": string, "notice_text": string}.`;
  const user = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    signal: { id: sig.id, failure_mode: sig.failureModeLabel, component: sig.component, supplier: sig.supplierName, claims_90d: sig.claims90d, rate_ratio_vs_prior_year: sig.rateRatio },
    findings: ev.findings.map((f) => ({ title: f.title, verdict: f.verdict, detail: f.detail })),
    scope: ev.scopeLots, lots: ev.lots.filter((l) => ev.scopeLots.includes(l.lot)), telemetry: ev.telemetry, exposure: ev.exposure,
    containment_options: ev.options.map((o) => ({ option: o.label, recommended: o.recommended, units: o.units, cost: o.cost, recoverable_from_supplier: o.recoverable, detail: o.detail })),
    chargeback: ev.chargeback, supplier_quality_library: guidance?.answer ?? null,
  });
  let headline = sig.failureModeLabel;
  let rootCause = ev.findings.find((f) => f.id === 'cohort')?.detail ?? '';
  let summary = ev.facts[0] ?? '';
  let notice = '';
  try {
    const out = await chatJson<{ headline: string; root_cause: string; summary: string; notice_text: string }>(req, opts.noticeModel, system, user);
    headline = out.headline || headline;
    rootCause = out.root_cause || rootCause;
    summary = out.summary || summary;
    notice = out.notice_text || '';
    onStep({ id: 'writeup', label: sig.chargeable ? '8D request + chargeback notice drafted' : 'Field-action brief drafted', status: 'done', detail: `${notice.split(/\s+/).length} words · ${opts.noticeModel}` });
  } catch (e) {
    onStep({ id: 'writeup', label: 'Write-up failed', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  const { facts: _f, libraryQuestion: _q, claimStats: _c, scopeLots: _s, plantStock: _p, ...rest } = ev;
  void _f; void _q; void _c; void _s; void _p;
  return {
    analysis: { ...rest, headline, root_cause: rootCause, summary, supplier_guidance: guidance, model: opts.noticeModel, generated_at: new Date().toISOString() },
    notice,
  };
}
