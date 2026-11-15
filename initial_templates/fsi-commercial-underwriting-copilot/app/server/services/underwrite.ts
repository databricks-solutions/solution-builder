/**
 * The underwriting review — the copilot's AI step for ONE submission.
 *
 *   1. Documents: the application vs the AI-extracted statement of values and loss runs (ai_parse_document +
 *      ai_query at intake). Every discrepancy is listed; underwriting uses the documents (TSI-DOC-04 §3.2).
 *   2. Risk: submission_risk_model@champion — as the application states it vs as the documents verify it.
 *   3. Appetite: the machine-readable rules (appetite_rules) checked DETERMINISTICALLY per location, then the
 *      Genie agent is asked (from the guideline documents) the one question this account hinges on (cited answer).
 *   4. Pricing: the TSI-RATE-03 rating plan (rating_factors) applied per included location — money is never
 *      left to an LLM. Exclusions, deductibles, authority (CUO referral when needed).
 *   5. A Foundation Model writes the file rationale + the broker letter from those facts only.
 *
 * Every step is reported through `onStep` so the UI can stream progress.
 */
import type { Request } from 'express';
import type { LocationQuote, RuleCheck, UwDecision, UwReview } from '../db/schema.js';
import { askDocuments, chatJson } from '../lib/serving.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export type Sub = {
  id: string; insuredName: string; businessDescription: string | null; brokerName: string; brokerContact: string | null;
  segmentCode: string; segment: string; state: string; hailBelt: boolean; effectiveDate: string | null; receivedTs: string;
  annualRevenue: number | null; targetPremium: number | null; expiringPremium: number | null; remarks: string | null;
  app: { locations: number | null; tiv: number | null; construction: string | null; year_built: number | null; roof_year: number | null;
    sprinklered: boolean | null; protection_class: number | null; loss_count: number | null; loss_amount: number | null };
  sovTiv: number; lossRunValued: string | null; lossRunYears: number | null; lossRunCarrier: string | null;
  discrepancies: string[]; pAsSubmitted: number | null; pVerified: number | null; bandAsSubmitted: string | null;
  bandVerified: string | null; riskDrivers: string | null;
};
export type Loc = {
  locNo: number; buildingName: string; city: string | null; state: string | null; construction: string | null; yearBuilt: number | null;
  roofYear: number | null; roofAgeYears: number | null; sprinklered: boolean; protectionClass: number | null; tiv: number; coastalTier1: boolean;
};
export type Claim = { lossDate: string | null; line: string | null; locNo: number | null; cause: string | null; totalIncurred: number; status: string | null; windHail: boolean };
export type Factors = Map<string, number>; // "type:key" → value
export type Rules = Map<string, { docRef: string; title: string; threshold: number | null }>;

const TODAY = '2026-09-28';
const AUTHORITY_TIV = 25_000_000;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const musd = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
const roofBand = (age: number) => (age <= 10 ? '0-10' : age <= 15 ? '11-15' : age <= 20 ? '16-20' : '21+');
const consKey = (c: string | null) => {
  const x = (c ?? '').toLowerCase();
  if (x.includes('frame')) return 'Frame';
  if (x.includes('fire')) return 'Fire resistive';
  if (x.includes('non')) return 'Masonry non-combustible';
  return 'Joisted masonry';
};
const expKey = (n: number) => (n === 0 ? '0' : n === 1 ? '1' : n <= 3 ? '2-3' : '4+');
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

export function checkRules(s: Sub, locs: Loc[], rules: Rules): { checks: RuleCheck[]; excluded: Set<number> } {
  const ref = (id: string) => rules.get(id) ?? { docRef: id, title: id, threshold: null };
  const checks: RuleCheck[] = [];
  const excluded = new Set<number>();
  const hab = s.segmentCode === 'HAB';

  const coastal = locs.filter((l) => l.coastalTier1);
  checks.push({ rule_id: 'AP-FL-COASTAL', doc_ref: ref('AP-FL-COASTAL').docRef, title: ref('AP-FL-COASTAL').title,
    status: coastal.length ? 'fail' : 'pass', locations: coastal.map((l) => l.locNo),
    detail: coastal.length ? `${coastal.map((l) => `Loc ${l.locNo} ${l.buildingName} (${l.city})`).join(', ')} is in a Florida Tier-1 coastal wind county — outside catastrophe appetite; decline.` : 'No Tier-1 coastal wind locations.' });

  const roofLimit = ref('AP-HAB-HAIL-ROOF').threshold ?? 15;
  if (hab && s.hailBelt) {
    const old = locs.filter((l) => (l.roofAgeYears ?? 0) > roofLimit);
    old.forEach((l) => excluded.add(l.locNo));
    checks.push({ rule_id: 'AP-HAB-HAIL-ROOF', doc_ref: ref('AP-HAB-HAIL-ROOF').docRef, title: ref('AP-HAB-HAIL-ROOF').title,
      status: old.length ? 'fail' : 'pass', locations: old.map((l) => l.locNo),
      detail: old.length
        ? `${old.map((l) => `Loc ${l.locNo} ${l.buildingName}: roof ${l.roofYear} (${l.roofAgeYears} yrs)`).join('; ')} — over ${roofLimit} years in the hail belt. Excluded from the quote; reinstate only with roof-replacement evidence or a CUO exception (ACV roof + 5% wind/hail deductible).`
        : `All habitational roofs ${roofLimit} years or newer.` });
  } else if (hab) {
    checks.push({ rule_id: 'AP-HAB-HAIL-ROOF', doc_ref: ref('AP-HAB-HAIL-ROOF').docRef, title: ref('AP-HAB-HAIL-ROOF').title, status: 'pass', detail: 'Not in the hail belt.' });
  }

  if (hab) {
    const cutoff = ref('AP-HAB-FRAME-OLD').threshold ?? 1990;
    const f = locs.filter((l) => consKey(l.construction) === 'Frame' && (l.yearBuilt ?? 9999) < cutoff && !l.sprinklered);
    const open = f.filter((l) => !excluded.has(l.locNo));
    checks.push({ rule_id: 'AP-HAB-FRAME-OLD', doc_ref: ref('AP-HAB-FRAME-OLD').docRef, title: ref('AP-HAB-FRAME-OLD').title,
      status: !f.length ? 'pass' : open.length ? 'refer' : 'resolved', locations: f.map((l) => l.locNo),
      detail: !f.length ? 'No pre-1990 unsprinklered frame buildings.'
        : `${f.map((l) => `Loc ${l.locNo} ${l.buildingName} (frame, ${l.yearBuilt}, unsprinklered)`).join('; ')}${open.length ? ' — CUO referral required.' : ' — resolved: the location is excluded.'}` });
  }

  const pcLimit = ref('AP-PROTECTION').threshold ?? 9;
  const pc = locs.filter((l) => (l.protectionClass ?? 0) >= pcLimit);
  checks.push({ rule_id: 'AP-PROTECTION', doc_ref: ref('AP-PROTECTION').docRef, title: ref('AP-PROTECTION').title,
    status: pc.length ? 'refer' : 'pass', locations: pc.map((l) => l.locNo),
    detail: pc.length ? `${pc.map((l) => `Loc ${l.locNo} protection class ${l.protectionClass}`).join('; ')} — CUO referral required.` : 'All locations protection class 8 or better.' });

  const age = s.lossRunValued ? daysBetween(s.lossRunValued, TODAY) : 999;
  const staleLr = age > (ref('AP-DOCS-LOSSRUN').threshold ?? 90) || (s.lossRunYears ?? 0) < 5;
  checks.push({ rule_id: 'AP-DOCS-LOSSRUN', doc_ref: ref('AP-DOCS-LOSSRUN').docRef, title: ref('AP-DOCS-LOSSRUN').title,
    status: staleLr ? 'fail' : 'pass',
    detail: staleLr ? `Loss runs valued ${s.lossRunValued} (${age} days old), ${s.lossRunYears} years — request currently valued five-year loss runs before quoting.`
      : `Valued ${s.lossRunValued} (${age} days), ${s.lossRunYears} years.` });

  checks.push({ rule_id: 'AP-DOCS-MATCH', doc_ref: ref('AP-DOCS-MATCH').docRef, title: ref('AP-DOCS-MATCH').title,
    status: s.discrepancies.length ? 'info' : 'pass',
    detail: s.discrepancies.length ? `${s.discrepancies.length} discrepanc${s.discrepancies.length === 1 ? 'y' : 'ies'} between the application and the documents — rated on the SOV and loss runs.` : 'Application, SOV and loss runs agree.' });

  const quotedTiv = locs.filter((l) => !excluded.has(l.locNo)).reduce((a, l) => a + l.tiv, 0);
  checks.push({ rule_id: 'AUTH-TIV-SENIOR', doc_ref: ref('AUTH-TIV-SENIOR').docRef, title: ref('AUTH-TIV-SENIOR').title,
    status: quotedTiv > AUTHORITY_TIV ? 'refer' : 'pass',
    detail: quotedTiv > AUTHORITY_TIV ? `TIV quoted ${musd(quotedTiv)} exceeds the $25M senior underwriter authority — CUO approval required.` : `TIV quoted ${musd(quotedTiv)} is within the $25M senior underwriter authority.` });
  return { checks, excluded };
}

export function price(s: Sub, locs: Loc[], claims: Claim[], f: Factors, excluded: Set<number>, declined: boolean) {
  const g = (k: string, d = 1) => f.get(k) ?? d;
  const exp = g(`experience:${expKey(claims.length)}`);
  const mlBand = s.bandVerified ?? s.bandAsSubmitted;
  const ml = mlBand ? g(`ml_band:${mlBand}`) : 1;
  const terr = s.hailBelt ? g('territory:HAIL_BELT', 1.25) : s.state === 'FL' ? g('territory:FL', 1.45) : g('territory:OTHER');
  const quotes: LocationQuote[] = locs.map((l) => {
    const age = l.roofAgeYears ?? 0;
    const factors: Record<string, number> = {
      base_rate: g(`base_rate:${consKey(l.construction)}`, 0.25), occupancy: g(`segment:${s.segmentCode}`), territory: terr,
      roof_age: g(`roof_age:${roofBand(age)}`), sprinkler: g(`sprinkler:${l.sprinklered ? 'Y' : 'N'}`), experience: exp, risk_model: ml,
      wind_hail_deductible: s.hailBelt ? g('deductible:WH_2PCT', 0.92) : 1,
    };
    const included = !declined && !excluded.has(l.locNo);
    const premium = included ? (l.tiv / 100) * Object.values(factors).reduce((a, v) => a * v, 1) : 0;
    return {
      loc_no: l.locNo, building_name: l.buildingName, city: l.city, construction: l.construction, roof_age: l.roofAgeYears,
      sprinklered: l.sprinklered, tiv: l.tiv, included, exclusion_reason: declined ? 'Account declined' : excluded.has(l.locNo) ? 'Out of appetite (TSI-UW-B-2026-07)' : null,
      factors, premium: Math.round(premium), wind_hail_deductible_pct: s.hailBelt ? 2 : 0,
    };
  });
  const quotedTiv = quotes.filter((q) => q.included).reduce((a, q) => a + q.tiv, 0);
  let property = quotes.reduce((a, q) => a + q.premium, 0);
  if (!declined && quotedTiv > 0) property = Math.max(property, g('minimum:PREMIUM', 7500));
  const gl = declined ? 0 : Math.max(2500, ((s.annualRevenue ?? 0) / 1000) * g('gl:RATE_PER_1K_REVENUE', 0.62) * (quotedTiv / Math.max(1, s.sovTiv)));
  return {
    locations: quotes,
    pricing: {
      tiv_submitted: s.sovTiv, tiv_quoted: quotedTiv, property_premium: Math.round(property), gl_premium: Math.round(gl),
      total_premium: Math.round(property + gl), rate_per_100: quotedTiv ? Math.round((property / (quotedTiv / 100)) * 1000) / 1000 : 0,
      target_premium: s.targetPremium, experience_mod: exp, ml_mod: ml, ml_band: mlBand,
    },
  };
}

function guidelineQuestion(s: Sub, locs: Loc[], claims: Claim[], checks: RuleCheck[], quotedTiv: number): string {
  const failed = checks.filter((c) => c.status === 'fail' || c.status === 'refer');
  const where = `${s.segment} account in ${s.state}${s.hailBelt ? ' (hail belt)' : ''}, TIV ${musd(s.sovTiv)}`;
  if (checks.find((c) => c.rule_id === 'AP-FL-COASTAL')?.status === 'fail') {
    const l = locs.find((x) => x.coastalTier1)!;
    return `${where}: ${l.buildingName} in ${l.city}, Florida — a beachfront location. Is it within Tidewell's catastrophe appetite, and what should the underwriter do?`;
  }
  const roof = checks.find((c) => c.rule_id === 'AP-HAB-HAIL-ROOF' && c.status === 'fail');
  if (roof) {
    const bad = locs.filter((l) => roof.locations?.includes(l.locNo));
    const wh = claims.filter((c) => c.windHail && bad.some((b) => b.locNo === c.locNo));
    return `${where}. ${bad.map((l) => `Location ${l.locNo} ${l.buildingName} (${l.city}): ${l.construction?.toLowerCase()}, built ${l.yearBuilt}, ${l.sprinklered ? 'sprinklered' : 'not sprinklered'}, roof replaced ${l.roofYear} (${l.roofAgeYears} years old)`).join('; ')}${wh.length ? `, with ${wh.length} wind/hail claim(s) on the loss run` : ''}. The application stated roofs ${s.app.roof_year}. Is that location in appetite, what are the underwriter's options, and who must approve the account at ${musd(quotedTiv)} TIV after excluding it?`;
  }
  if (checks.find((c) => c.rule_id === 'AP-DOCS-LOSSRUN')?.status === 'fail') {
    return `${where}: the loss runs are valued ${s.lossRunValued} and cover ${s.lossRunYears} years. Can the underwriter quote on them, and what is required?`;
  }
  if (failed.length) {
    return `${where}: ${failed.map((c) => c.detail).join(' ')} What do the guidelines require, and who must approve?`;
  }
  return `${where}, ${locs[0]?.construction?.toLowerCase()} construction, roofs up to ${Math.max(...locs.map((l) => l.roofAgeYears ?? 0))} years, ${claims.length} loss(es) in five years. Any appetite restrictions or required deductibles, and is the account within senior underwriter authority?`;
}

export async function reviewSubmission(
  req: Request,
  ctx: { sub: Sub; locs: Loc[]; claims: Claim[]; factors: Factors; rules: Rules; draftedBy: string; docCount: number },
  cfg: { genieSpaceId: string; model: string; onStep: (e: StepEvent) => void },
): Promise<UwReview> {
  const { sub: s, locs, claims } = ctx;
  const { onStep } = cfg;

  onStep({ id: 'documents', label: `Reading the ${ctx.docCount} documents in the ${s.insuredName} packet`, status: 'running' });
  const lrTotal = claims.reduce((a, c) => a + c.totalIncurred, 0);
  onStep({ id: 'documents', label: `Application, SOV (${locs.length} location${locs.length === 1 ? '' : 's'}, ${musd(s.sovTiv)}) and loss run (${claims.length} claim${claims.length === 1 ? '' : 's'}, ${money(lrTotal)}) — ai_parse_document`,
    status: 'done', detail: s.discrepancies.length ? `${s.discrepancies.length} discrepancies vs the application: ${s.discrepancies.map((d) => d.split(':')[0]).join(', ')}` : 'The documents agree with the application.' });

  onStep({ id: 'risk', label: 'Scoring with submission_risk_model@champion', status: 'running' });
  onStep({ id: 'risk', label: `Risk ${s.bandAsSubmitted} (${s.pAsSubmitted?.toFixed(2)}) as submitted → ${s.bandVerified} (${s.pVerified?.toFixed(2)}) on the documents`, status: 'done',
    detail: s.riskDrivers ?? undefined });

  onStep({ id: 'appetite', label: 'Checking appetite, documentation and authority rules', status: 'running' });
  const { checks, excluded } = checkRules(s, locs, ctx.rules);
  const declined = checks.some((c) => c.rule_id === 'AP-FL-COASTAL' && c.status === 'fail');
  const quotedTivPre = locs.filter((l) => !excluded.has(l.locNo)).reduce((a, l) => a + l.tiv, 0);
  const question = guidelineQuestion(s, locs, claims, checks, quotedTivPre);
  let guidance: UwReview['guidance'] = null;
  const hits = checks.filter((c) => c.status === 'fail' || c.status === 'refer');
  onStep({ id: 'appetite', label: `${hits.length ? `${hits.length} rule${hits.length === 1 ? '' : 's'} hit: ${hits.map((c) => c.rule_id).join(', ')}` : 'In appetite on every rule'} — asking the guidelines assistant`, status: 'running', detail: question });
  if (cfg.genieSpaceId) {
    try {
      const doc = await askDocuments(req, cfg.genieSpaceId, `Answer from the Tidewell underwriting guideline documents only, citing the document ID and section: ${question}`);
      guidance = { question, answer: doc.answer, sources: doc.sources };
      onStep({ id: 'appetite', label: `${hits.length ? `${hits.length} rule${hits.length === 1 ? '' : 's'} hit: ${hits.map((c) => c.rule_id).join(', ')}` : 'In appetite on every rule'} · guideline answer retrieved`, status: 'done', detail: doc.sources.join(', ') || 'Tidewell underwriting guidelines' });
    } catch (e) {
      onStep({ id: 'appetite', label: 'Guidelines assistant unavailable — deterministic rules only', status: 'error', detail: (e as Error).message.slice(0, 160) });
    }
  } else onStep({ id: 'appetite', label: 'Guidelines assistant not configured — deterministic rules only', status: 'error' });

  onStep({ id: 'pricing', label: 'Rating every location on the TSI-RATE-03 plan', status: 'running' });
  const { locations, pricing } = price(s, locs, claims, ctx.factors, excluded, declined);
  const staleLr = checks.some((c) => c.rule_id === 'AP-DOCS-LOSSRUN' && c.status === 'fail');
  const decision: UwDecision = declined ? 'DECLINE' : staleLr ? 'REQUEST_INFO' : excluded.size ? 'QUOTE_WITH_CONDITIONS' : 'QUOTE';
  const conditions: string[] = [];
  if (!declined && !staleLr) {
    if (excluded.size) conditions.push(`Location${excluded.size > 1 ? 's' : ''} ${[...excluded].join(', ')} excluded from the property schedule (TSI-UW-B-2026-07 §2.2a); reinstatement subject to evidence of full roof replacement.`);
    if (s.hailBelt) conditions.push('2% wind/hail deductible per location (TSI-CAT-05 §2.1).');
    conditions.push(`All-other-perils deductible ${pricing.tiv_quoted > 10e6 ? '$25,000' : '$10,000'} per occurrence (TSI-RATE-03 §4.2).`);
    if (s.discrepancies.length) conditions.push('Quote based on the statement of values and loss runs, not the application (TSI-DOC-04 §3.2); signed corrected application required before binding.');
  }
  const referral = checks.filter((c) => c.status === 'refer' && !(declined || staleLr));
  const referralReasons = referral.map((c) => `${c.detail} (${c.doc_ref})`);
  onStep({ id: 'pricing', label: declined ? 'Declined — no terms rated' : staleLr ? 'Indication withheld until current loss runs arrive'
    : `${money(pricing.total_premium)} (${money(pricing.property_premium)} property + ${money(pricing.gl_premium)} GL) on ${musd(pricing.tiv_quoted)}${excluded.size ? ` — ${excluded.size} location excluded` : ''}`,
    status: 'done', detail: declined || staleLr ? undefined : `${locations.filter((l) => l.included).map((l) => `Loc ${l.loc_no} ${money(l.premium)}`).join(' · ')} · experience ×${pricing.experience_mod} · risk model ×${pricing.ml_mod}${pricing.target_premium ? ` · broker target ${money(pricing.target_premium)}` : ''}${referralReasons.length ? ' · CUO referral required' : ''}` });

  onStep({ id: 'memo', label: 'Drafting the file rationale and the broker letter', status: 'running' });
  const system = `You write for a senior commercial property underwriter at Tidewell Specialty Insurance (a fictional US carrier).
Produce JSON: {"rationale": string, "broker_letter": string}.
- rationale: 4-6 sentences for the underwriting file and, if referred, the Chief Underwriting Officer. State the decision, what the documents showed versus the application (name the location and the numbers), the risk-model change, which guideline references drove it, the premium, and why a referral is or is not needed. Use ONLY the facts given; never invent numbers.
- broker_letter: a professional note to the broker contact (by first name), max 170 words, signed "Dana Whitfield, Senior Underwriter, Tidewell Specialty Insurance". For a quote: the premium, the locations quoted and excluded and why, the key conditions, and that the quote is subject to CUO approval when referral_required is true. For a decline: the reason with the guideline reference and a constructive alternative. For a request for information: exactly what is needed. Mention material discrepancies politely.
Plain text (no markdown). Return ONLY the JSON object.`;
  const user = JSON.stringify({
    submission: { id: s.id, insured: s.insuredName, broker: s.brokerName, broker_contact: s.brokerContact, segment: s.segment, state: s.state,
      effective_date: s.effectiveDate, broker_remarks: s.remarks, business: s.businessDescription },
    application_says: s.app, documents_show: {
      locations: locs.map((l) => ({ loc: l.locNo, name: l.buildingName, city: l.city, construction: l.construction, year_built: l.yearBuilt, roof_year: l.roofYear, sprinklered: l.sprinklered, tiv: l.tiv })),
      loss_run: { carrier: s.lossRunCarrier, valued: s.lossRunValued, claims: claims.map((c) => ({ date: c.lossDate, loc: c.locNo, cause: c.cause, incurred: c.totalIncurred, status: c.status })) },
    },
    discrepancies: s.discrepancies,
    risk_model: { as_submitted: `${s.bandAsSubmitted} ${s.pAsSubmitted}`, verified: `${s.bandVerified} ${s.pVerified}`, drivers: s.riskDrivers },
    rules: checks.filter((c) => c.status !== 'pass').map((c) => `${c.rule_id} [${c.status}] ${c.doc_ref}: ${c.detail}`),
    guideline_answer: guidance?.answer?.slice(0, 1500) ?? null,
    decision, conditions, excluded_locations: [...excluded], referral_required: referralReasons.length > 0, referral_reasons: referralReasons,
    pricing,
  });
  let rationale = '';
  let letter = '';
  try {
    const out = await chatJson<{ rationale: string; broker_letter: string }>(req, cfg.model, system, user, 2500);
    rationale = out.rationale;
    letter = out.broker_letter;
    onStep({ id: 'memo', label: 'Rationale and broker letter drafted', status: 'done', detail: cfg.model });
  } catch (e) {
    rationale = `${decision.replace(/_/g, ' ')} — ${s.discrepancies.join(' ')} Premium ${money(pricing.total_premium)}.`;
    onStep({ id: 'memo', label: 'Memo drafting failed — facts-only rationale used', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  return {
    review_id: `UWR-${s.id}-${Date.now().toString(36).toUpperCase()}`, submission_id: s.id, generated_at: new Date().toISOString(),
    drafted_by: ctx.draftedBy, discrepancies: s.discrepancies,
    risk: { p_as_submitted: s.pAsSubmitted, p_verified: s.pVerified, band_as_submitted: s.bandAsSubmitted, band_verified: s.bandVerified, drivers: s.riskDrivers },
    rules: checks, guidance, locations, pricing, decision, conditions, excluded_locations: [...excluded],
    referral_required: referralReasons.length > 0, referral_reasons: referralReasons, rationale, broker_letter: letter, model: cfg.model,
  };
}
