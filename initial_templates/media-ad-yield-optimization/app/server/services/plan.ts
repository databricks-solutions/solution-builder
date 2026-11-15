/**
 * The recovery plan — the workbench's AI step, for one under-delivering campaign.
 *
 *   1. Diagnose pacing: which line is short and why — the line's product avails, week by week, from Delta,
 *      and whether other live IOs on the same inventory are hit too.
 *   2. Forecast: ai_forecast avails for the failing product to flight end vs what is committed on it.
 *   3. Find spare inventory: products with forecast spare avails before flight end that reach the booked
 *      audience at least as well as the failing line, in an equal-or-better tier (make-good policy §3.1).
 *   4. Ask the ad-sales library (the Genie agent over the ad-sales documents): the IO's make-good terms + policy.
 *   5. Yield check: is any of that spare inventory mis-priced (floor group ≠ rate card)? → floor change.
 *   6. Allocate the shortfall (cheapest displaced revenue first) and price the plan — deterministic
 *      arithmetic, never left to an LLM.
 *   7. A Foundation Model writes the diagnosis + the agency notice + ad-ops instructions.
 *
 * Every step is reported through `onStep` so the UI can stream progress. The same deterministic core
 * (`buildEvidence`) backs the chat agent's `build_recovery_plan` tool.
 */
import type { Request } from 'express';
import type { campaigns } from '../db/schema.js';
import type { FloorRecommendation, Finding, Reallocation, RecoveryPlan, SpareOption } from '../db/schema.js';
import { execSql, fqn, type DataConfig } from '../db/sync.js';
import { askDocuments, chatJson } from '../lib/serving.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type CampaignRow = typeof campaigns.$inferSelect;
export type Evidence = Omit<RecoveryPlan, 'headline' | 'diagnosis' | 'summary' | 'contract_guidance' | 'ad_ops_instructions' | 'model' | 'generated_at'> & {
  contractQuestion: string; facts: string[]; flightEnd: string;
};

const TIER_RANK: Record<string, number> = { Premium: 3, Standard: 2, RON: 1 };
export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const mImps = (n: number) => `${(n / 1e6).toFixed(1)}M`;
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export async function buildEvidence(c: CampaignRow, cfg: DataConfig, onStep: (e: StepEvent) => void = () => {}): Promise<Evidence> {
  const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
  const t = (x: string) => fqn(cfg, x);
  const findings: Finding[] = [];
  const facts: string[] = [];
  const lines = c.lines ?? [];
  const riskLine = lines.slice().sort((a, b) => (b.booked - b.projected) - (a.booked - a.projected))[0];
  const cpm = c.bookedCpm;

  // ── 1. pacing diagnosis ────────────────────────────────────────────────────
  onStep({ id: 'pacing', label: `Reading delivery for ${lines.length} line items`, status: 'running' });
  const [weekly, peers] = await Promise.all([
    execSql<Record<string, unknown>>(wh, `
      SELECT CAST(week_start AS STRING) AS week, SUM(avails) AS avails
      FROM ${t('gold_inventory_daily')}
      WHERE product_id = '${riskLine?.product_id ?? ''}' AND week_start >= date_sub(DATE'${c.flightStart}', 35)
        AND week_start < date_trunc('WEEK', current_date())
      GROUP BY week_start ORDER BY week_start`),
    execSql<Record<string, unknown>>(wh, `
      SELECT cp.campaign_id, cp.campaign_name, cp.advertiser_name, cp.make_good_liability
      FROM ${t('gold_campaign_pacing')} cp
      WHERE cp.at_risk AND cp.campaign_id <> '${c.id}' AND cp.risk_product_id = '${riskLine?.product_id ?? ''}'
      ORDER BY cp.make_good_liability DESC`),
  ]);
  const weeklyAvails = weekly.map((w) => ({ week: String(w.week), avails: n(w.avails) }));
  if (riskLine) {
    const drop = riskLine.avails_change ?? 0;
    const others = lines.filter((l) => l.line_id !== riskLine.line_id);
    findings.push({
      id: 'avails', verdict: 'CONFIRMED', title: `${riskLine.product_name}: the audience is gone`,
      detail: `Avails on the line's inventory are ${pct(Math.abs(drop))} ${drop < 0 ? 'lower' : 'higher'} than in the flight's first week. The line (${mImps(riskLine.booked)} booked) delivers ${mImps(riskLine.run_rate)} a day against a ${mImps(riskLine.planned_daily)} plan — ${pct(riskLine.pacing)} pacing.`,
    });
    if (others.length) {
      findings.push({
        id: 'trafficking', verdict: 'RULED_OUT', title: 'Not a trafficking or targeting problem',
        detail: `The other ${others.length === 1 ? 'line runs' : `${others.length} lines run`} on plan: ${others.map((l) => `${l.product_name} ${pct(l.pacing)}`).join(', ')}.`,
      });
    }
    if (peers.length) {
      findings.push({
        id: 'peers', verdict: 'INFO', title: `${peers.length} other live IO${peers.length > 1 ? 's' : ''} hit by the same drop`,
        detail: `${peers.map((p) => `${p.advertiser_name} (${money(n(p.make_good_liability))})`).join(', ')} — ${money(peers.reduce((a, p) => a + n(p.make_good_liability), 0))} more make-good liability on ${riskLine.product_name}.`,
      });
    }
    facts.push(`${riskLine.product_name} avails ${pct(drop)} since flight start; line pacing ${pct(riskLine.pacing)}`);
  }
  onStep({ id: 'pacing', label: riskLine ? `${riskLine.product_name} is the problem line (${pct(riskLine.pacing)} pacing)` : 'Delivery read', status: 'done',
    detail: `IO pacing ${pct(c.pacing)} · ${mImps(c.delivered ?? 0)} of ${mImps(c.expectedToDate ?? 0)} expected to date` });

  // ── 2. ai_forecast on the failing inventory ─────────────────────────────────
  onStep({ id: 'forecast', label: 'Forecasting avails to flight end (ai_forecast)', status: 'running' });
  const fc = await execSql<Record<string, unknown>>(wh, `
    SELECT SUM(avails_forecast) AS forecast, SUM(committed_guaranteed) AS committed, COUNT(*) AS days
    FROM ${t('gold_spare_avails')}
    WHERE product_id = '${riskLine?.product_id ?? ''}' AND forecast_date BETWEEN current_date() AND DATE'${c.flightEnd}'`);
  const fcAvails = n(fc[0]?.forecast);
  const fcCommitted = n(fc[0]?.committed);
  const shortfall = c.projectedShortfall ?? 0;
  findings.push({
    id: 'forecast', verdict: 'CONFIRMED', title: 'The line cannot catch up before flight end',
    detail: `ai_forecast: ${riskLine?.product_name ?? 'the product'} carries ${mImps(fcAvails)} avails over the remaining ${c.daysRemaining} days vs ${mImps(fcCommitted)} already committed to live IOs. At today's run-rate the IO delivers ${pct(c.projectedDeliveryPct)} of its ${mImps(c.bookedImpressions)} guarantee: ${mImps(shortfall)} short, ${money(c.makeGoodLiability)} make-good liability at the $${cpm.toFixed(2)} average CPM.`,
  });
  onStep({ id: 'forecast', label: `Projected ${pct(c.projectedDeliveryPct)} delivery — ${mImps(shortfall)} short`, status: 'done',
    detail: `${mImps(fcAvails)} forecast avails vs ${mImps(fcCommitted)} committed on ${riskLine?.product_name ?? ''}` });

  // ── 3. spare inventory for the booked audience ─────────────────────────────
  onStep({ id: 'spare', label: `Searching spare avails for ${c.targetSegment} to flight end`, status: 'running' });
  const spareRows = await execSql<Record<string, unknown>>(wh, `
    SELECT s.product_id, MAX(s.product_name) AS product_name, MAX(s.platform) AS platform, MAX(s.tier) AS tier,
           MAX(p.content_category) AS content_category,
           SUM(s.spare_avails) AS spare_avails, MAX(m.audience_share) AS audience_share,
           MAX(COALESCE(s.programmatic_ecpm_28d, 0)) AS displaced_ecpm, MAX(COALESCE(s.programmatic_fill_28d, 0)) AS programmatic_fill
    FROM ${t('gold_spare_avails')} s
    JOIN ${t('product_audience_mix')} m ON m.product_id = s.product_id AND m.segment_id = '${c.targetSegmentId}'
    JOIN ${t('ad_products')} p ON p.product_id = s.product_id
    WHERE s.forecast_date BETWEEN current_date() AND DATE'${c.flightEnd}'
    GROUP BY s.product_id`);
  const riskShare = n(spareRows.find((r) => r.product_id === riskLine?.product_id)?.audience_share);
  const riskTier = TIER_RANK[riskLine?.tier ?? 'Standard'] ?? 2;
  const spare: SpareOption[] = spareRows.map((r) => {
    const tier = String(r.tier);
    const share = n(r.audience_share);
    const cat = String(r.content_category);
    let eligible = true;
    let reason = 'equal-or-better tier and audience';
    if (r.product_id === riskLine?.product_id) { eligible = false; reason = 'the under-delivering inventory itself'; }
    else if ((TIER_RANK[tier] ?? 0) < riskTier) { eligible = false; reason = `${tier} tier is below the line's ${riskLine?.tier}`; }
    else if (share < riskShare) { eligible = false; reason = `reaches ${pct(share)} ${c.targetSegment} vs ${pct(riskShare)} on the line`; }
    else if (['Run of Network', 'Late Night Comedy', 'Kids & Family', 'Daytime'].includes(cat)) { eligible = false; reason = `${cat} excluded by the IO`; }
    return {
      product_id: String(r.product_id), product_name: String(r.product_name), platform: String(r.platform), tier, eligible, reason,
      spare_avails: n(r.spare_avails), audience_share: share, in_target_spare: Math.round(n(r.spare_avails) * share),
      displaced_ecpm: String(r.platform) === 'Linear' ? 0 : n(r.displaced_ecpm), programmatic_fill: String(r.platform) === 'Linear' ? 0 : n(r.programmatic_fill),
    };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.in_target_spare - a.in_target_spare);
  const eligible = spare.filter((s) => s.eligible);
  onStep({ id: 'spare', label: `${eligible.length} eligible products · ${mImps(eligible.reduce((a, s) => a + s.in_target_spare, 0))} in-target spare avails`, status: 'done',
    detail: eligible.slice(0, 3).map((s) => `${s.product_name} ${mImps(s.in_target_spare)} (${pct(s.audience_share)} reach)`).join(' · ') });

  // ── 5. yield check on the candidate inventory ──────────────────────────────
  onStep({ id: 'yield', label: 'Checking how that inventory is priced today', status: 'running' });
  const oppRows = eligible.length ? await execSql<Record<string, unknown>>(wh, `
    SELECT product_id, product_name, current_inventory_group, rate_card_inventory_group, current_floor_cpm, recommended_floor_cpm,
           current_rule_id, CAST(current_rule_since AS STRING) AS since, current_rule_changed_by, pmp_impressions_28d, pmp_ecpm_28d,
           open_clearing_cpm_28d, fill_retention, programmatic_ecpm_28d, rate_card_cpm, group_mismatch, revenue_gap_since_rule
    FROM ${t('gold_yield_opportunities')} WHERE product_id IN (${eligible.map((e) => `'${e.product_id}'`).join(',')})`) : [];

  // ── 6. allocation (cheapest displaced revenue first) ───────────────────────
  const target = shortfall * 1.03;
  let left = target;
  const reallocations: Reallocation[] = [];
  const days = Math.max(1, c.daysRemaining ?? 1);
  for (const s of eligible.slice().sort((a, b) => a.displaced_ecpm * a.programmatic_fill - b.displaced_ecpm * b.programmatic_fill || b.audience_share - a.audience_share)) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(s.in_target_spare * 0.85));
    if (take < 250_000) continue;
    const imps = Math.round(take / 1000) * 1000;
    reallocations.push({
      product_id: s.product_id, product_name: s.product_name, tier: s.tier, impressions: imps, daily_cap: Math.round(imps / days / 1000) * 1000,
      displaced_ecpm: s.displaced_ecpm, displaced_revenue: Math.round((imps * s.displaced_ecpm * s.programmatic_fill) / 1000), audience_share: s.audience_share,
    });
    left -= imps;
  }
  const moved = reallocations.reduce((a, r) => a + r.impressions, 0);
  const covered = Math.min(moved, shortfall);
  const liabilityAvoided = Math.min(Math.round((covered * cpm) / 1000), Math.round(c.makeGoodLiability ?? Infinity));
  const displaced = reallocations.reduce((a, r) => a + r.displaced_revenue, 0);

  const floorChanges: FloorRecommendation[] = [];
  for (const o of oppRows.filter((x) => x.group_mismatch === true || x.group_mismatch === 'true')) {
    const pmpDay = n(o.pmp_impressions_28d) / 28;
    const gap = Math.max(0, n(o.open_clearing_cpm_28d) * n(o.fill_retention) - n(o.pmp_ecpm_28d));
    const movedHere = reallocations.find((r) => r.product_id === o.product_id)?.impressions ?? 0;
    const pmpFrac = n(o.pmp_impressions_28d) > 0 ? 0.85 : 0;
    const remainingPmp = Math.max(0, pmpDay * days - movedHere * pmpFrac);
    const upliftWindow = Math.round((remainingPmp * gap) / 1000);
    floorChanges.push({
      product_id: String(o.product_id), product_name: String(o.product_name), from_group: String(o.current_inventory_group), to_group: String(o.rate_card_inventory_group),
      from_floor: n(o.current_floor_cpm), to_floor: n(o.recommended_floor_cpm), release_from_deal: o.current_inventory_group === 'RON-DEFAULT' ? 'PMP-RON-STREAM' : null,
      expected_uplift_window: upliftWindow, expected_uplift_annualized: Math.round((pmpDay * 365 * gap) / 1000), window_days: days,
      detail: `${o.current_rule_id} (${o.current_rule_changed_by}, ${o.since}) moved it from ${o.rate_card_inventory_group} to ${o.current_inventory_group}: PMP-RON-STREAM buys ${mImps(n(o.pmp_impressions_28d))} impressions a month at $${n(o.pmp_ecpm_28d).toFixed(2)} while the open auction clears at $${n(o.open_clearing_cpm_28d).toFixed(2)} (rate card $${n(o.rate_card_cpm).toFixed(2)}). ${money(n(o.revenue_gap_since_rule))} left on the table since the change.`,
    });
    findings.push({
      id: `leak-${o.product_id}`, verdict: 'CONFIRMED', title: `${o.product_name} is priced as run-of-network`,
      detail: `Since ${o.since} (${o.current_rule_id}, ${o.current_rule_changed_by}) it sits in ${o.current_inventory_group} ($${n(o.current_floor_cpm).toFixed(2)} floor) instead of ${o.rate_card_inventory_group}. Programmatic eCPM ${'$'}${n(o.programmatic_ecpm_28d).toFixed(2)} vs $${n(o.rate_card_cpm).toFixed(2)} rate card and $${n(o.open_clearing_cpm_28d).toFixed(2)} open-auction clearing — ${money(n(o.revenue_gap_since_rule))} lost since. That is also why using it for the make-good costs so little.`,
    });
  }
  const floorUplift = floorChanges.reduce((a, f) => a + f.expected_uplift_window, 0);
  onStep({ id: 'yield', label: floorChanges.length ? `${floorChanges.length} mis-priced product: ${floorChanges.map((f) => f.product_name).join(', ')}` : 'Candidate inventory is priced correctly', status: 'done',
    detail: floorChanges.map((f) => `${f.from_group} $${f.from_floor} → ${f.to_group} $${f.to_floor}`).join(' · ') || undefined });

  const contractQuestion = `For insertion order ${c.ioNumber} (${c.advertiserName}, ${c.targetSegment}): where may make-good ADUs run, is Crest+ Live Sports equivalent-or-better inventory, must the ADUs run inside the flight, and what notice do we owe the agency? Also: may Crest+ Live Sports be sold in the RON-DEFAULT floor group?`;
  facts.push(`${mImps(moved)} moved covers ${pct(shortfall ? covered / shortfall : 0)} of the ${mImps(shortfall)} shortfall; avoids ${money(liabilityAvoided)}; displaces ${money(displaced)} of programmatic; floor fix +${money(floorUplift)} to flight end`);

  return {
    findings, facts, contractQuestion, flightEnd: c.flightEnd,
    pacing: {
      booked: c.bookedImpressions, delivered: c.delivered ?? 0, expected: c.expectedToDate ?? 0, pacing: c.pacing ?? 0,
      projected: c.projectedDelivery ?? 0, projected_pct: c.projectedDeliveryPct ?? 0, shortfall, liability: c.makeGoodLiability ?? 0,
      days_remaining: c.daysRemaining ?? 0, cpm,
    },
    weekly_avails: weeklyAvails,
    spare,
    reallocations,
    floor_changes: floorChanges,
    impact: {
      impressions_moved: moved, shortfall_covered: covered, coverage_pct: shortfall ? covered / shortfall : 0,
      liability_avoided: liabilityAvoided, displaced_revenue: displaced, floor_uplift: floorUplift,
      net_impact: liabilityAvoided - displaced + floorUplift,
    },
  };
}

export async function buildRecoveryPlan(
  req: Request,
  c: CampaignRow,
  cfg: DataConfig,
  opts: { genieSpaceId: string; noticeModel: string; onStep: (e: StepEvent) => void },
): Promise<{ plan: RecoveryPlan; notice: string }> {
  const { onStep } = opts;
  const ev = await buildEvidence(c, cfg, onStep);

  // ── 4. ad-sales library (Genie agent) ───────────────────────────────────────────────
  onStep({ id: 'library', label: 'Checking the IO terms + make-good policy (Genie agent)', status: 'running', detail: ev.contractQuestion });
  let guidance: RecoveryPlan['contract_guidance'] = null;
  if (opts.genieSpaceId) {
    try {
      const doc = await askDocuments(req, opts.genieSpaceId, `Answer from the ad-sales documents only (IO terms, make-good policy, floor governance, rate card), citing the document and section: ${ev.contractQuestion}`);
      guidance = { question: ev.contractQuestion, answer: doc.answer, source: doc.sources.join(', ') };
      onStep({ id: 'library', label: 'IO + policy guidance retrieved', status: 'done', detail: doc.sources.join(', ') || 'ad-sales documents' });
    } catch (e) {
      onStep({ id: 'library', label: 'Ad-sales library unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
    }
  }

  onStep({ id: 'plan', label: 'Allocating the shortfall + pricing the plan', status: 'running' });
  onStep({
    id: 'plan', label: `Plan: ${mImps(ev.impact.impressions_moved)} moved, ${money(ev.impact.liability_avoided)} liability avoided`, status: 'done',
    detail: `${ev.reallocations.map((r) => `${mImps(r.impressions)} → ${r.product_name}`).join(' · ')} · displaced ${money(ev.impact.displaced_revenue)} · floor fix +${money(ev.impact.floor_uplift)}`,
  });

  // ── 7. LLM write-up ────────────────────────────────────────────────────────
  onStep({ id: 'writeup', label: 'Writing the diagnosis, the agency notice and the ad-ops instructions', status: 'running' });
  const system = `You are the Director of Yield & Pricing at Aurora Crest Media (ACN broadcast network, Crest+ ad-supported streaming, FAST channels).
You write (1) a headline of at most 14 words, (2) a diagnosis of at most 60 words (why the IO under-delivers and what is wrong with pricing — keep numbers for the summary), (3) a summary for the SVP Ad Revenue of at most 70 words (the 3-4 numbers that matter, the plan, the money), (4) a formal notice to the advertiser's agency (${c.agency ?? 'the agency'}, buyer on ${c.advertiserName}) that delivery is behind and how the remaining impressions will be delivered (which inventory, how many, by when, the audience guarantee stays whole), and (5) short ad-ops trafficking instructions (the ADU line items with daily caps, the floor-group change, ticket-ready).
Use ONLY the facts provided — never invent numbers, dates or clauses. Quote numbers exactly as given. Never mention internal pricing problems, floor prices or displaced revenue in the agency notice. Write the notice and the instructions as PLAIN TEXT: no markdown, no asterisks or # headings (CAPITALIZED section titles and "-" bullets). Sign the notice "Maya Chen, Director of Yield & Pricing, Aurora Crest Media".
Return ONLY a JSON object: {"headline": string, "diagnosis": string, "summary": string, "notice_text": string, "ad_ops_instructions": string}.`;
  const user = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    campaign: { id: c.id, io: c.ioNumber, name: c.name, advertiser: c.advertiserName, agency: c.agency, audience: c.targetSegment, flight_end: c.flightEnd, days_remaining: c.daysRemaining, make_good_terms: c.makeGoodTerms },
    pacing: ev.pacing, findings: ev.findings.map((f) => ({ title: f.title, verdict: f.verdict, detail: f.detail })),
    reallocations: ev.reallocations, floor_changes: ev.floor_changes.map(({ expected_uplift_annualized: _a, ...f }) => { void _a; return f; }), impact: ev.impact,
    contract_library: guidance?.answer ?? null,
  });
  let headline = `${c.advertiserName}: ${mImps(ev.pacing.shortfall)} short — rebalance onto spare premium inventory`;
  let diagnosis = ev.findings[0]?.detail ?? '';
  let summary = ev.facts.join('. ');
  let notice = '';
  let adOps = ev.reallocations.map((r) => `- ADU line on ${r.product_name}: ${r.impressions.toLocaleString()} impressions, cap ${r.daily_cap.toLocaleString()}/day`).join('\n');
  try {
    const out = await chatJson<{ headline: string; diagnosis: string; summary: string; notice_text: string; ad_ops_instructions: string }>(req, opts.noticeModel, system, user);
    headline = out.headline || headline;
    diagnosis = out.diagnosis || diagnosis;
    summary = out.summary || summary;
    notice = out.notice_text || '';
    adOps = out.ad_ops_instructions || adOps;
    onStep({ id: 'writeup', label: 'Agency notice + ad-ops instructions drafted', status: 'done', detail: `${notice.split(/\s+/).length} words · ${opts.noticeModel}` });
  } catch (e) {
    onStep({ id: 'writeup', label: 'Write-up failed', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  const { contractQuestion: _q, facts: _f, flightEnd: _e, ...rest } = ev;
  void _q; void _f; void _e;
  return {
    plan: { ...rest, headline, diagnosis, summary, contract_guidance: guidance, ad_ops_instructions: adOps, model: opts.noticeModel, generated_at: new Date().toISOString() },
    notice,
  };
}
