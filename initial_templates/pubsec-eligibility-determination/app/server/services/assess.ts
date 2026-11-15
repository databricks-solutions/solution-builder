/**
 * The eligibility check — the workbench's AI step.
 *
 *   1. Read the case file: the household + every verification document with the
 *      fields `ai_extract` already pulled out of it (computed in Delta by the setup job).
 *   2. Check every program rule (program_rules table) against those facts,
 *      deterministically — the math and dates are never left to an LLM. Each rule
 *      returns PASS / FAIL / NEEDS_INFO / FLAG with the evidence documents and the
 *      federal regulation + WDHS manual section to cite.
 *   3. Ask the Genie agent (over the WDHS policy manual documents) the one
 *      policy question that matters most for this case → cited guidance.
 *   4. Have a Foundation Model write the caseworker summary and a plain-language resident
 *      notice (approval / denial / request for verification) in the household's language.
 *
 * Every step is reported through `onStep` so the UI can stream progress.
 */
import type { Request } from 'express';
import type { CaseAssessment, ExtractedFields, RuleResult } from '../db/schema.js';
import type { Rulebook } from '../db/sync.js';
import { askDocuments, chatJson } from '../lib/serving.js';

export type CaseFile = {
  id: string;
  program: string;
  county: string;
  channel: string | null;
  submittedDate: string;
  expeditedScreening: boolean;
  reportedMonthlyIncome: number | null;
  reportedLiquidResources: number | null;
  citizenshipVerifiedElectronically: boolean | null;
  headFirstName: string;
  headLastName: string;
  householdSize: number;
  elderlyOrDisabled: boolean;
  preferredLanguage: string | null;
  city: string | null;
  caseworkerName: string | null;
  documents: Array<{ id: string; docType: string; extracted: ExtractedFields | null; extractionConfidence: number | null }>;
};

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

const DAY = 86_400_000;
const FREQ: Record<string, number> = { weekly: 4.3, biweekly: 2.15, semimonthly: 2, monthly: 1 };
const STD_DEDUCTION = (size: number) => (size <= 3 ? 209 : size === 4 ? 223 : size === 5 ? 261 : 299);
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const d = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : null);
const fmt = (x: Date) => x.toISOString().slice(0, 10);
const IN_STATE = new Set(['WB', 'WESTBROOK']);

export type Evaluation = Omit<CaseAssessment, 'policy_guidance' | 'summary' | 'model' | 'generated_at'> & {
  facts: string[];
  policyQuestion: string;
};

/** Pure, deterministic rule evaluation — unit-testable, no I/O. */
export function evaluateCase(c: CaseFile, book: Rulebook, today = new Date()): Evaluation {
  const S = d(c.submittedDate)!;
  const docs = c.documents;
  const of = (t: string) => docs.filter((x) => x.docType === t);
  const ids = of('photo_id');
  const residency = [...of('lease'), ...of('utility_bill')];
  const stubs = of('paystub').filter((x) => x.extracted?.gross_pay != null);
  const layoff = of('employer_letter').find((x) => x.extracted?.employment_end_date);
  const noIncome = of('self_declaration').find((x) => x.extracted?.declares_no_income !== false);
  const bank = of('bank_statement')[0];
  const limits = book.limits.find((l) => l.household_size === Math.min(c.householdSize, 8)) ?? book.limits[0];
  const isSnap = c.program === 'SNAP';
  const facts: string[] = [];
  const missing: CaseAssessment['missing_documents'] = [];

  // ── income ────────────────────────────────────────────────────────────
  const layoffEnd = layoff ? d(layoff.extracted!.employment_end_date) : null;
  const terminated = !!(layoffEnd && layoffEnd <= S);
  const layoffIssuer = (layoff?.extracted?.issuer ?? '').toLowerCase();
  const fresh = stubs.filter((x) => {
    const pd = d(x.extracted!.document_date);
    return pd && S.getTime() - pd.getTime() <= 30 * DAY && pd <= new Date(S.getTime() + 3 * DAY);
  });
  const stale = stubs.filter((x) => !fresh.includes(x));
  const countedStubs = fresh.filter((x) => !(terminated && (x.extracted?.issuer ?? '').toLowerCase() === layoffIssuer));
  const stubMonthly = (list: typeof stubs) =>
    list.length
      ? list.reduce((a, x) => a + (x.extracted!.gross_pay ?? 0) * (FREQ[x.extracted!.pay_frequency ?? 'biweekly'] ?? 2.15), 0) / list.length
      : 0;
  let income: number;
  let incomeVerified: boolean;
  let incomeFinding: string;
  const incomeEvidence: string[] = [];
  if (terminated) {
    income = stubMonthly(countedStubs);
    incomeVerified = true;
    incomeEvidence.push(layoff!.id, ...stubs.map((x) => x.id));
    incomeFinding = `Layoff notice from ${layoff!.extracted!.issuer ?? 'employer'} shows employment ended ${fmt(layoffEnd!)} — before the ${fmt(S)} filing date. ` +
      `The pre-layoff pay stub${stubs.length > 1 ? 's' : ''} (${money(stubMonthly(stubs.filter((x) => (x.extracted?.issuer ?? '').toLowerCase() === layoffIssuer)))}/mo) ${stubs.length > 1 ? 'show' : 'shows'} past income only — not anticipated income.`;
  } else if (fresh.length) {
    income = stubMonthly(fresh);
    incomeVerified = true;
    incomeEvidence.push(...fresh.map((x) => x.id));
    incomeFinding = `${fresh.length} pay stub${fresh.length > 1 ? 's' : ''} dated within 30 days of filing: ${money(fresh[0].extracted!.gross_pay ?? 0)} ${fresh[0].extracted!.pay_frequency} gross → ${money(income)}/month.`;
  } else if (stale.length) {
    income = stubMonthly(stale);
    incomeVerified = false;
    incomeEvidence.push(...stale.map((x) => x.id));
    const pd = d(stale[0].extracted!.document_date)!;
    incomeFinding = `Only pay stub is dated ${fmt(pd)} — ${Math.round((S.getTime() - pd.getTime()) / DAY)} days before filing (stale; must be within 30 days). Estimated ${money(income)}/month, unverified.`;
    missing.push({ item: 'Current proof of income', why: `The pay stub we have is from ${fmt(pd)}, more than 30 days before you applied.`, acceptable: 'Pay stubs for the last 30 days, or a signed letter from your employer (form DHS-1152).' });
  } else if (noIncome) {
    income = 0;
    incomeVerified = true;
    incomeEvidence.push(noIncome.id);
    incomeFinding = 'Signed Statement of No Income (DHS-2107) on file.';
  } else {
    income = c.reportedMonthlyIncome ?? 0;
    incomeVerified = false;
    incomeFinding = `No income document on file. Application reports ${money(income)}/month.`;
    missing.push(income > 0
      ? { item: 'Proof of income', why: 'We need to confirm how much your household earns.', acceptable: 'Pay stubs for the last 30 days, or a signed letter from your employer.' }
      : { item: 'Statement of no income', why: 'Your application says no one in your household has income.', acceptable: 'Sign and return form DHS-2107 (Statement of No Income).' });
  }
  income = Math.round(income * 100) / 100;
  facts.push(incomeFinding);

  const limit = isSnap ? limits.snap_gross_monthly_limit : limits.medicaid_monthly_limit;
  const resourceLimit = c.elderlyOrDisabled ? limits.snap_resource_limit_elderly_disabled : limits.snap_resource_limit;
  const resources = bank?.extracted?.account_balance ?? c.reportedLiquidResources ?? 0;
  const rulesById = Object.fromEntries(book.rules.filter((r) => r.program === c.program).map((r) => [r.rule_id, r]));
  const rules: RuleResult[] = [];
  const push = (id: string, result: RuleResult['result'], finding: string, evidence: string[] = []) => {
    const r = rulesById[id];
    if (!r) return;
    rules.push({ rule_id: id, rule_name: r.rule_name, category: r.category, result, finding, evidence, cfr_citation: r.cfr_citation, manual_section: r.manual_section });
  };
  const P = isSnap ? 'SNAP' : 'MA';

  // ── identity ──────────────────────────────────────────────────────────
  const id0 = ids[0];
  if (!id0) {
    push(`${P}-ID`, 'NEEDS_INFO', 'No identity document on file.');
    missing.push({ item: 'Proof of identity', why: 'We must confirm who is applying.', acceptable: 'A current driver license or state ID, passport, tribal ID, or work/school photo ID.' });
  } else {
    const exp = d(id0.extracted?.expiration_date);
    const nameOk = (id0.extracted?.person_name ?? '').toLowerCase().includes(c.headLastName.toLowerCase());
    if (exp && exp < S) {
      push(`${P}-ID`, 'NEEDS_INFO', `Westbrook ID expired ${fmt(exp)} — before the filing date. An expired ID is not acceptable alone.`, [id0.id]);
      missing.push({ item: 'Current proof of identity', why: `The ID you sent expired on ${fmt(exp)}.`, acceptable: 'A current (unexpired) ID, passport, or tribal ID — or a person who knows you can confirm your identity.' });
    } else if (!nameOk) {
      push(`${P}-ID`, 'FLAG', `ID name "${id0.extracted?.person_name}" does not match the applicant — review.`, [id0.id]);
    } else {
      push(`${P}-ID`, 'PASS', `Westbrook ID for ${id0.extracted?.person_name}${exp ? `, valid until ${fmt(exp)}` : ''}.`, [id0.id]);
    }
  }

  // ── residency ─────────────────────────────────────────────────────────
  const res0 = residency[0];
  if (!res0) {
    push(`${P}-RES`, 'NEEDS_INFO', 'No lease, rent receipt or utility bill on file.');
    missing.push({ item: 'Proof of where you live', why: 'We must confirm you live in Westbrook.', acceptable: 'A lease or rental agreement, rent receipt, or a utility bill from the last 60 days with your address.' });
  } else {
    const st = (res0.extracted?.state ?? '').toUpperCase().trim();
    const addr = [res0.extracted?.street_address, res0.extracted?.city, st].filter(Boolean).join(', ');
    if (st && !IN_STATE.has(st)) {
      push(`${P}-RES`, 'NEEDS_INFO', `${res0.docType === 'lease' ? 'Lease' : 'Utility bill'} is for ${addr} — outside Westbrook.`, [res0.id]);
      missing.push({ item: 'Proof of Westbrook address', why: `The ${res0.docType === 'lease' ? 'lease' : 'bill'} you sent is for an address in another state (${addr}).`, acceptable: 'A current lease, rent receipt, or utility bill for your Westbrook home.' });
    } else {
      push(`${P}-RES`, 'PASS', `${res0.docType === 'lease' ? 'Lease' : 'Utility bill'} shows ${addr}.`, [res0.id]);
    }
  }

  if (isSnap) {
    push('SNAP-INC-VER', incomeVerified ? 'PASS' : 'NEEDS_INFO', incomeFinding, incomeEvidence);
    if (income <= limit) {
      push('SNAP-GROSS', 'PASS', `Countable gross income ${money(income)}/mo ≤ ${money(limit)} limit for a household of ${c.householdSize}${incomeVerified ? '' : ' (pending verification)'}.`, incomeEvidence);
    } else {
      push('SNAP-GROSS', incomeVerified ? 'FAIL' : 'NEEDS_INFO', `Countable gross income ${money(income)}/mo is above the ${money(limit)} limit for a household of ${c.householdSize}.`, incomeEvidence);
    }
    push('SNAP-RESOURCES', resources <= resourceLimit ? 'PASS' : 'FAIL',
      `${bank ? `Bank statement ending balance ${money(resources)}` : `Self-attested resources ${money(resources)} (accepted unless questionable)`} vs ${money(resourceLimit)} limit.`,
      bank ? [bank.id] : []);
    const expedited = income < 150 && resources <= 100;
    const deadline = new Date(S.getTime() + 7 * DAY);
    const daysOpen = Math.floor((today.getTime() - S.getTime()) / DAY);
    if (expedited) {
      push('SNAP-EXPEDITE', 'FLAG', daysOpen > 7
        ? `Entitled to EXPEDITED service (income ${money(income)} < $150, resources ${money(resources)} ≤ $100). The 7-day deadline was ${fmt(deadline)} — ${daysOpen - 7} days ago. Issue benefits today.`
        : `Entitled to EXPEDITED service — benefits due by ${fmt(deadline)}. Only identity must be verified first.`);
    } else {
      push('SNAP-EXPEDITE', 'PASS', 'Not eligible for expedited service — standard 30-day processing applies.');
    }
  } else {
    push('MA-CIT', c.citizenshipVerifiedElectronically ? 'PASS' : 'NEEDS_INFO',
      c.citizenshipVerifiedElectronically ? 'Citizenship verified electronically through the federal data hub (SSA match).' : 'Electronic SSA match failed — documentary evidence needed (90-day reasonable opportunity).');
    push('MA-INC-VER', incomeVerified ? 'PASS' : 'NEEDS_INFO', incomeFinding, incomeEvidence);
    push('MA-MAGI', income <= limit ? 'PASS' : incomeVerified ? 'FAIL' : 'NEEDS_INFO',
      `Monthly income ${money(income)} ${income <= limit ? '≤' : '>'} ${money(limit)} (138% FPL, household of ${c.householdSize})${incomeVerified ? '' : ' — pending verification'}.`, incomeEvidence);
  }

  const hasFail = rules.some((r) => r.result === 'FAIL');
  const hasNeed = rules.some((r) => r.result === 'NEEDS_INFO');
  const recommendation: CaseAssessment['recommendation'] = hasFail ? 'DENY' : hasNeed ? 'REQUEST_VERIFICATION' : 'APPROVE';
  const expeditedNow = isSnap && income < 150 && resources <= 100;
  const standard = expeditedNow || c.expeditedScreening ? 7 : isSnap ? 30 : 45;
  const daysOpen = Math.floor((today.getTime() - S.getTime()) / DAY);
  let benefit: number | null = null;
  if (isSnap && recommendation !== 'DENY') {
    const net = Math.max(0, income * 0.8 - STD_DEDUCTION(c.householdSize));
    benefit = Math.max(c.householdSize <= 2 ? 24 : 0, Math.round(limits.snap_max_allotment - 0.3 * net));
  }

  // The single policy question that matters most for this case.
  let policyQuestion: string;
  if (terminated) policyQuestion = `An applicant was laid off before she applied; her last pay stub shows wages above the SNAP gross income limit but her final paycheck arrived before the filing date. Is that income counted, and does a household with no current income and under $100 in the bank qualify for expedited service? What is the deadline?`;
  else if (stale.length && !fresh.length) policyQuestion = `Can a pay stub dated more than 30 days before the filing date be used to verify income, and what should the caseworker request instead?`;
  else if (rules.some((r) => r.finding.includes('expired'))) policyQuestion = `Is an expired ID acceptable proof of identity for ${c.program}? What alternatives can the caseworker accept?`;
  else if (rules.some((r) => r.finding.includes('outside Westbrook'))) policyQuestion = `The applicant's lease shows an address in another state. How must residency be verified?`;
  else if (hasNeed) policyQuestion = `What must a request for verification include, and how many days must the household be given to respond?`;
  else if (hasFail) policyQuestion = `What must a ${c.program} denial notice for income over the limit include, and how long does the household have to request a fair hearing?`;
  else policyQuestion = `What must a ${c.program} approval notice include?`;

  return {
    recommendation,
    countable_monthly_income: income,
    income_limit: limit,
    estimated_monthly_benefit: benefit,
    timeliness: { standard_days: standard, days_open: daysOpen, days_remaining: standard - daysOpen, overdue: daysOpen > standard, expedited: expeditedNow || c.expeditedScreening },
    rules,
    missing_documents: missing,
    facts,
    policyQuestion,
  };
}

export async function assessCase(
  req: Request,
  c: CaseFile,
  book: Rulebook,
  opts: { genieSpaceId: string; noticeModel: string; onStep: (e: StepEvent) => void },
): Promise<{ assessment: CaseAssessment; notice: { type: string; language: string; text: string } }> {
  const { onStep } = opts;
  const withConf = c.documents.filter((x) => x.extractionConfidence != null);
  const avgConf = withConf.length ? withConf.reduce((a, x) => a + (x.extractionConfidence ?? 0), 0) / withConf.length : null;
  onStep({ id: 'read', label: `Reading ${c.documents.length} documents`, status: 'running' });
  onStep({
    id: 'read', label: `Read ${c.documents.length} documents`, status: 'done',
    detail: `${[...new Set(c.documents.map((x) => x.docType.replace('_', ' ')))].join(', ') || 'no documents'} — fields extracted by ai_extract${avgConf != null ? `, avg confidence ${(avgConf * 100).toFixed(0)}%` : ''}`,
  });

  onStep({ id: 'rules', label: `Checking ${c.program} program rules`, status: 'running' });
  const ev = evaluateCase(c, book);
  const counts = (k: RuleResult['result']) => ev.rules.filter((r) => r.result === k).length;
  onStep({ id: 'rules', label: `Checked ${ev.rules.length} ${c.program} rules`, status: 'done', detail: `${counts('PASS')} pass · ${counts('FAIL')} fail · ${counts('NEEDS_INFO')} need info · ${counts('FLAG')} flagged` });

  onStep({ id: 'policy', label: 'Consulting the WDHS policy manual (Genie agent)', status: 'running', detail: ev.policyQuestion });
  let guidance: CaseAssessment['policy_guidance'] = null;
  try {
    const doc = await askDocuments(req, opts.genieSpaceId, `Answer from the WDHS policy manual documents only, citing the section: ${ev.policyQuestion}`);
    guidance = { question: ev.policyQuestion, answer: doc.answer, source: doc.sources.join(', ') };
    onStep({ id: 'policy', label: 'Policy guidance retrieved', status: 'done', detail: doc.sources.join(', ') });
  } catch (e) {
    onStep({ id: 'policy', label: 'Policy manual unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  const spanish = (c.preferredLanguage ?? '').toLowerCase().startsWith('span');
  const noticeType = ev.recommendation === 'APPROVE' ? 'approval' : ev.recommendation === 'DENY' ? 'denial' : 'request_for_verification';
  onStep({ id: 'notice', label: `Drafting ${noticeType.replace(/_/g, ' ')} notice${spanish ? ' in Spanish' : ''}`, status: 'running' });
  const system = `You write for the Westbrook Department of Human Services (WDHS). You produce (1) a 2-3 sentence summary for the caseworker and (2) a resident notice.
Notice rules (WDHS Manual ch.5): plain language at or below an 8th-grade reading level, short sentences, most important information first, address the resident by first and last name, no unexplained acronyms.
- approval: program, approved, monthly amount, EBT card arrives within 5 business days, report changes within 10 days, right to a fair hearing.
- denial: the specific reason with the rule citation and the numbers, right to a fair hearing within 90 days, free legal aid, can reapply anytime.
- request_for_verification: list EVERY missing item with examples of acceptable documents, due date exactly 10 days from today, ways to submit (upload at benefits.westbrook.gov, mail, fax, or drop off at the ${c.county} County office), offer of help from the caseworker, application stays open.
Write the notice as PLAIN TEXT: no markdown, no asterisks or # headings (use CAPITALIZED section titles and "-" bullets). Sign as "${c.caseworkerName ?? 'Your caseworker'}, Westbrook DHS". Use only the facts given. Return ONLY a JSON object: {"summary": string, "notice_text": string}.`;
  const user = JSON.stringify({
    today: fmt(new Date()),
    notice_type: noticeType,
    notice_language: spanish ? 'Spanish' : 'English',
    applicant: `${c.headFirstName} ${c.headLastName}`,
    program: c.program,
    household_size: c.householdSize,
    county: c.county,
    filed: c.submittedDate,
    recommendation: ev.recommendation,
    countable_monthly_income: ev.countable_monthly_income,
    income_limit: ev.income_limit,
    estimated_monthly_benefit: ev.estimated_monthly_benefit,
    timeliness: ev.timeliness,
    rule_results: ev.rules.map((r) => ({ rule: r.rule_name, result: r.result, finding: r.finding, citation: `${r.cfr_citation}; ${r.manual_section}` })),
    missing_documents: ev.missing_documents,
    policy_guidance: guidance?.answer ?? null,
  });
  let summary = '';
  let noticeText = '';
  try {
    const out = await chatJson<{ summary: string; notice_text: string }>(req, opts.noticeModel, system, user);
    summary = out.summary;
    noticeText = out.notice_text;
    onStep({ id: 'notice', label: `${spanish ? 'Spanish ' : ''}${noticeType.replace(/_/g, ' ')} notice drafted`, status: 'done', detail: `${noticeText.split(/\s+/).length} words · ${opts.noticeModel}` });
  } catch (e) {
    summary = `${ev.recommendation.replace('_', ' ')} — ${ev.facts[0] ?? ''}`;
    noticeText = '';
    onStep({ id: 'notice', label: 'Notice drafting failed', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  const { facts: _f, policyQuestion: _q, ...rest } = ev;
  void _f; void _q;
  return {
    assessment: { ...rest, summary, policy_guidance: guidance, model: opts.noticeModel, generated_at: new Date().toISOString() },
    notice: { type: noticeType, language: spanish ? 'Spanish' : 'English', text: noticeText },
  };
}
