/**
 * Meeting prep — the Morning Book's AI step.
 *
 *   1. Read the client file: signals (money in motion), accounts, mortgages, the last CRM notes with the
 *      AI Functions read-out (ai_classify / ai_extract / ai_analyze_sentiment, computed in Delta).
 *   2. Rank the next-best actions with the propensity model (nba_propensity_model@champion — scores are
 *      computed in batch and mirrored to Lakebase).
 *   3. Apply the suitability rules S1-S7 (deterministic, computed with the scores). The model's top pick is
 *      shown even when it is blocked — with the exact rules that block it.
 *   4. Build the agenda deterministically: suitable actions only (PASS, then REVIEW with its condition),
 *      relationship-first for vulnerable clients; REVIEW items are deferred for vulnerable clients.
 *   5. Ask the policy library (the Genie agent over the policy documents) the one question that matters for this client.
 *   6. A Foundation Model writes the brief, the call opener and a compliant outreach email (FINRA 2210 rules
 *      from the policy library) — it may only use the facts it is given.
 * Every step is streamed through `onStep`.
 */
import type { Request } from 'express';
import type { MeetingPrep, Recommendation } from '../db/schema.js';
import { askDocuments, chatJson } from '../lib/serving.js';

export type ClientFile = {
  id: string; householdName: string; primaryName: string; primaryAge: number | null; segment: string | null;
  aum: number; sweepCash: number | null; riskProfile: string | null; timeHorizonYears: number | null; liquidityNeed: string | null;
  investmentExperience: string | null; vulnerable: boolean; vulnerableReason: string | null; trustedContactOnFile: boolean | null;
  lastContactDate: string | null; daysSinceContact: number | null; advisorName: string | null; aumAtRisk: number | null;
  moneyInMotion: number | null;
  signals: Array<{ type: string; date: string | null; amount: number | null; detail: string | null; days_to_act: number | null }>;
  accounts: Array<{ type: string; balance: number; rate: number | null; maturity: string | null; custodian: string }>;
  liabilities: Array<{ type: string; lender: string; balance: number; rate: number }>;
  notes: Array<{ date: string; text: string; ai?: { category: string | null; other_institution: string | null; family_member: string | null; flight_risk: boolean } | null }>;
  recommendations: Recommendation[];
};

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export const DISCLOSURES: Record<string, string> = {
  'D-CRS': 'Form CRS (Client Relationship Summary) and fee disclosure.',
  'D-CD': 'Bank CDs: FDIC-insured to $250K per depositor, per bank, per ownership category; early-withdrawal penalties; 12-month renewal rate today 3.55%.',
  'D-TSY': 'Treasury ladder: backed by the U.S. government; prices move if sold before maturity; interest exempt from state tax.',
  'D-MMF': 'Government money market fund: not a bank deposit, not FDIC-insured, may lose value; 7-day yield ~3.60% vs 0.25% sweep.',
  'D-ADV': 'Advisory program brochure (Form ADV Part 2A).',
  'D-FEE': 'Advisory fee schedule (0.95% first $1M, 0.80% next $4M, 0.60% above $5M).',
  'D-SN': 'Structured notes: issuer credit risk, not FDIC-insured, limited liquidity, capped upside, embedded fees.',
  'D-PC': 'Private credit interval fund: redemptions limited to 5% per quarter; credit and valuation risk.',
  'D-DI': 'Direct indexing: tax benefits depend on the client; tracking error; wash-sale rules.',
  'D-ROLL': 'DOL PTE 2020-02 / Reg BI rollover comparison: plan vs IRA fees, services, investment options, withdrawal and creditor-protection rules — delivered before the client decides.',
  'D-REFI': 'Calder Pine Bank refinance: closing costs ~1.5-2.5%; quotes are estimates, subject to credit approval and appraisal; Equal Housing Lender.',
  'D-SBLOC': 'SBLOC: maintenance calls, pledged securities may be sold without notice, variable rate, proceeds may not buy securities; concentrated collateral gets a 50% advance rate.',
  'D-529': '529 plan offering statement; state tax benefits vary; non-qualified withdrawals taxed + 10% penalty on earnings.',
};

const money = (n: number | null | undefined) => `$${Math.round(n ?? 0).toLocaleString('en-US')}`;

export type PrepPlan = {
  modelPick: Recommendation | null;
  agenda: Recommendation[];
  deferred: Array<{ rec: Recommendation; reason: string }>;
  disclosureCodes: string[];
  policyQuestion: string;
};

/** Pure, deterministic agenda selection — unit-testable, no I/O. */
export function planMeeting(c: ClientFile): PrepPlan {
  const recs = [...c.recommendations].sort((a, b) => a.model_rank - b.model_rank);
  const modelPick = recs[0] ?? null;
  const lifeEvent = c.signals.some((s) => ['Death of spouse', 'Inheritance received', 'New grandchild', 'Business sale'].includes(s.type));
  const suitable = recs.filter((r) => r.status !== 'FAIL' && r.action_code !== 'ANNUAL-REVIEW');
  const deferred: PrepPlan['deferred'] = [];
  let agenda: Recommendation[] = [];
  for (const r of suitable.sort((a, b) => (a.status === b.status ? b.expected_revenue - a.expected_revenue : a.status === 'PASS' ? -1 : 1))) {
    if (c.vulnerable && r.status === 'REVIEW') {
      deferred.push({ rec: r, reason: 'Vulnerable client (S5): only after a documented planning meeting + supervisor pre-approval.' });
    } else agenda.push(r);
  }
  const estate = agenda.find((r) => r.action_code === 'ESTATE-REVIEW');
  if (estate && (c.vulnerable || lifeEvent)) agenda = [estate, ...agenda.filter((r) => r !== estate)];
  const extra = agenda.slice(3);
  agenda = agenda.slice(0, 3);
  for (const r of extra) deferred.push({ rec: r, reason: 'Lower priority — keep for the follow-up meeting.' });
  for (const r of recs.filter((x) => x.status === 'FAIL')) {
    deferred.push({ rec: r, reason: `Blocked by suitability: ${r.rules.filter((x) => x.result === 'FAIL').map((x) => `${x.rule_id} ${x.rule}`).join(', ')}` });
  }
  if (!agenda.length) {
    const generic = recs.find((r) => r.action_code === 'ANNUAL-REVIEW');
    if (generic) agenda.push(generic);
  }
  const codes = new Set<string>(['D-CRS']);
  for (const r of agenda) for (const d of r.disclosures.split(',').map((x) => x.trim()).filter(Boolean)) codes.add(d);

  const blocked = modelPick && modelPick.status === 'FAIL' ? modelPick : null;
  const bereaved = c.signals.some((s) => s.type === 'Death of spouse') || /bereavement/i.test(c.vulnerableReason ?? '');
  const has = (code: string) => agenda.some((r) => r.action_code === code);
  let policyQuestion: string;
  if (blocked && bereaved) {
    policyQuestion = `A ${c.primaryAge}-year-old client lost her spouse ${bereaved ? 'this year' : ''} and inherited assets; her risk profile is ${c.riskProfile} with ${c.investmentExperience} experience and a ${c.liquidityNeed} liquidity need. Can we recommend a ${blocked.action_name.toLowerCase()}? What should the first meeting after a bereavement cover, and what must the outreach look like?`;
  } else if (blocked) {
    policyQuestion = `Our model's top-ranked action for a ${c.riskProfile} client with ${c.investmentExperience} experience is a ${blocked.action_name.toLowerCase()}. Which suitability rules does that breach, and what are suitable alternatives?`;
  } else if (has('SBLOC') || has('MORTGAGE-REFI')) {
    policyQuestion = `A client with a 7.25% mortgage wants to buy a second home and does not want to sell a concentrated employer stock position. How does the refinance window work, what are the SBLOC rules for concentrated collateral, and which disclosures are required?`;
  } else if (has('IRA-ROLLOVER')) {
    policyQuestion = `A client just retired and has a 401(k) with his former employer. What must we deliver before recommending a rollover to an IRA, and what alternatives must we describe?`;
  } else if (has('CD-LADDER')) {
    policyQuestion = `A client's 12-month CD bought at over 5% is maturing and would renew at 3.55%. What options should the advisor present and which disclosures apply?`;
  } else {
    policyQuestion = `What must a Calder Pine advisor document when making a recommendation under Reg BI?`;
  }
  return { modelPick, agenda, deferred, disclosureCodes: [...codes], policyQuestion };
}

export async function prepMeeting(
  req: Request,
  c: ClientFile,
  opts: { genieSpaceId: string; model: string; onStep: (e: StepEvent) => void },
): Promise<MeetingPrep> {
  const { onStep } = opts;
  const aiNotes = c.notes.filter((n) => n.ai);
  onStep({ id: 'read', label: 'Reading the client file', status: 'running' });
  const flight = aiNotes.find((n) => n.ai?.flight_risk);
  onStep({
    id: 'read', label: `Read ${c.signals.length} signals, ${c.accounts.length} accounts, ${c.notes.length} CRM notes`, status: 'done',
    detail: `${c.signals.map((s) => s.type).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}${aiNotes.length ? ` — AI Functions read ${aiNotes.length} recent notes${flight ? `; flight-risk mention: ${flight.ai?.other_institution ?? 'another firm'}` : ''}` : ''}`,
  });

  onStep({ id: 'rank', label: 'Ranking next-best actions (nba_propensity_model@champion)', status: 'running' });
  const plan = planMeeting(c);
  const top3 = [...c.recommendations].sort((a, b) => a.model_rank - b.model_rank).slice(0, 3);
  onStep({ id: 'rank', label: `Scored ${c.recommendations.length} candidate actions`, status: 'done',
    detail: top3.map((r) => `${r.model_rank}. ${r.action_code} (p=${r.propensity.toFixed(2)}, ${money(r.expected_revenue)}/yr)`).join(' · ') });

  onStep({ id: 'suit', label: 'Checking suitability rules S1-S7 (Reg BI care obligation)', status: 'running' });
  const n = (s: string) => c.recommendations.filter((r) => r.status === s).length;
  onStep({ id: 'suit', label: `Suitability: ${n('PASS')} pass · ${n('REVIEW')} review · ${n('FAIL')} blocked`, status: 'done',
    detail: plan.modelPick?.status === 'FAIL'
      ? `Model's #1 pick ${plan.modelPick.action_code} is BLOCKED (${plan.modelPick.failed_rules})`
      : `Model's #1 pick ${plan.modelPick?.action_code ?? '—'} is ${plan.modelPick?.status ?? '—'}` });

  onStep({ id: 'policy', label: 'Consulting the policy library (Genie agent)', status: 'running', detail: plan.policyQuestion });
  let guidance: MeetingPrep['policy_guidance'] = null;
  try {
    const doc = await askDocuments(req, opts.genieSpaceId, `Answer from the Calder Pine policy documents only, citing the policy and section: ${plan.policyQuestion}`);
    guidance = { question: plan.policyQuestion, answer: doc.answer, sources: doc.sources.join(', ') };
    onStep({ id: 'policy', label: 'Policy guidance retrieved', status: 'done', detail: doc.sources.join(', ') || 'Calder Pine policy library' });
  } catch (e) {
    onStep({ id: 'policy', label: 'Policy library unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  onStep({ id: 'draft', label: 'Drafting the meeting brief + outreach', status: 'running' });
  const first = c.primaryName.split(' ')[0];
  const system = `You prepare client meetings for ${c.advisorName ?? 'a wealth advisor'} at Calder Pine Private Wealth.
Use ONLY the facts provided (numbers, dates, actions, policy guidance). The agenda and the blocked actions are already decided by the suitability engine — do not add, remove or reorder actions and never recommend a blocked action.
Write:
- headline: one sentence (<= 25 words) for the ADVISOR, about the client in the third person (e.g. "Margaret: …") — what is moving and what to do.
- why_now: 3-4 short bullets for the advisor (third person, not "you") with the specific numbers and dates.
- talking_points: one sentence per agenda action (same order), client-benefit first, plain English.
- call_opener: 2-3 sentences the advisor can say on the phone.
- outreach: an email (subject + body, <= 150 words, signed by the advisor) following the Calder Pine communications standards: name the client's situation, not the product; no product names, rates or performance promises${c.vulnerable ? '; this client is vulnerable (recent bereavement or 80+): be warm and invitational, no urgency beyond factual dates, suggest a call or meeting' : ''}; end with the required footer exactly: "Calder Pine Private Wealth is the marketing name for Calder Pine Securities LLC (member FINRA/SIPC) and Calder Pine Advisors LLC, an SEC-registered investment adviser. Investment products are not FDIC-insured, not bank-guaranteed and may lose value. Bank deposits and loans are offered by Calder Pine Bank, Member FDIC, Equal Housing Lender."
Plain text only in the email (no markdown). Return ONLY a JSON object: {"headline": string, "why_now": string[], "talking_points": string[], "call_opener": string, "outreach": {"subject": string, "body": string}}.`;
  const user = JSON.stringify({
    today: '2026-09-28',
    client: { name: c.primaryName, first_name: first, age: c.primaryAge, segment: c.segment, aum: c.aum, sweep_cash: c.sweepCash,
      risk_profile: c.riskProfile, horizon_years: c.timeHorizonYears, liquidity_need: c.liquidityNeed, experience: c.investmentExperience,
      vulnerable: c.vulnerable ? c.vulnerableReason : false, last_contact: c.lastContactDate, days_since_contact: c.daysSinceContact,
      money_in_motion: c.moneyInMotion, aum_at_risk: c.aumAtRisk },
    signals: c.signals.map((s) => ({ type: s.type, date: s.date, amount: s.amount, detail: s.detail })),
    accounts: c.accounts.map((a) => ({ type: a.type, balance: a.balance, rate: a.rate, maturity: a.maturity, custodian: a.custodian })),
    mortgages: c.liabilities,
    recent_notes: c.notes.slice(0, 4).map((x) => ({ date: x.date, text: x.text })),
    model_top_pick: plan.modelPick && { action: plan.modelPick.action_name, propensity: plan.modelPick.propensity, status: plan.modelPick.status },
    agenda: plan.agenda.map((r) => ({ action: r.action_name, status: r.status, assets_in_scope: r.assets_in_scope, review_condition: r.rules.filter((x) => x.result === 'REVIEW').map((x) => x.finding) })),
    blocked_or_deferred: plan.deferred.map((d) => ({ action: d.rec.action_name, reason: d.reason })),
    policy_guidance: guidance?.answer ?? null,
  });
  let out: { headline: string; why_now: string[]; talking_points: string[]; call_opener: string; outreach: { subject: string; body: string } };
  try {
    out = await chatJson(req, opts.model, system, user);
    onStep({ id: 'draft', label: 'Meeting brief + outreach drafted', status: 'done', detail: `${out.outreach.body.split(/\s+/).length}-word email · ${opts.model}` });
  } catch (e) {
    onStep({ id: 'draft', label: 'Drafting failed', status: 'error', detail: (e as Error).message.slice(0, 160) });
    out = { headline: `${c.primaryName}: ${plan.agenda.map((r) => r.action_name).join(', ')}`, why_now: c.signals.slice(0, 3).map((s) => s.detail ?? s.type),
      talking_points: plan.agenda.map((r) => r.action_name), call_opener: '', outreach: { subject: '', body: '' } };
  }
  const blockedBecause = plan.modelPick && plan.modelPick.status === 'FAIL'
    ? plan.modelPick.rules.filter((r) => r.result === 'FAIL').map((r) => `${r.rule_id} ${r.rule}: ${r.finding}`) : [];
  return {
    headline: out.headline,
    why_now: out.why_now ?? [],
    model_pick: plan.modelPick && { action_code: plan.modelPick.action_code, action_name: plan.modelPick.action_name, propensity: plan.modelPick.propensity, status: plan.modelPick.status, blocked_because: blockedBecause },
    agenda: plan.agenda.map((r, i) => ({ action_code: r.action_code, action_name: r.action_name, status: r.status, assets: r.assets_in_scope, talking_point: out.talking_points?.[i] ?? '' })),
    deferred: plan.deferred.map((d) => ({ action_code: d.rec.action_code, reason: d.reason })),
    disclosures: plan.disclosureCodes.map((code) => ({ code, text: DISCLOSURES[code] ?? code })),
    policy_guidance: guidance,
    outreach: { channel: c.vulnerable ? 'Personal call, then email' : 'Email', subject: out.outreach?.subject ?? '', body: out.outreach?.body ?? '' },
    call_opener: out.call_opener ?? '',
    model: opts.model,
    generated_at: new Date().toISOString(),
  };
}
