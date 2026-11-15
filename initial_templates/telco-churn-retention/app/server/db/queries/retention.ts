/**
 * Retention-desk domain queries + the margin-guardrail engine.
 *
 * The guardrail is deterministic code, NOT a prompt: the agent proposes, this
 * file disposes. An offer is allowed only if (1) the account is eligible for it
 * and (2) its total cost <= guardrail_pct x 12-month gross margin of the account
 * (default 30% x 58% margin — both live in offer_catalog, mirrored to app.offers).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { offers, retentionCases, type AuditEntry, type StagedOffer } from '../schema.js';

export type CaseRow = typeof retentionCases.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;

export async function listCases(
  db: AppDb,
  f: { tier?: string | null; driver?: string | null; region?: string | null; status?: string | null; limit?: number },
): Promise<CaseRow[]> {
  const conds = [];
  if (f.tier) conds.push(inArray(retentionCases.riskTier, f.tier.split(',')));
  if (f.driver) conds.push(eq(retentionCases.topDriver, f.driver));
  if (f.region) conds.push(eq(retentionCases.region, f.region));
  if (f.status) conds.push(inArray(retentionCases.status, f.status.split(',') as CaseRow['status'][]));
  return db
    .select()
    .from(retentionCases)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(retentionCases.annualRevenueAtRisk))
    .limit(f.limit ?? 200);
}

export async function getCase(db: AppDb, id: string): Promise<CaseRow | null> {
  const rows = await db.select().from(retentionCases).where(eq(retentionCases.customerId, id)).limit(1);
  return rows[0] ?? null;
}

export async function listOffers(db: AppDb): Promise<OfferRow[]> {
  return db.select().from(offers);
}

// ---------------------------------------------------------------------------
// Guardrail engine
// ---------------------------------------------------------------------------
export type OfferEvaluation = {
  offer_code: string;
  offer_name: string;
  description: string;
  target_driver: string;
  cost: number;
  guardrail_cap: number;
  within_guardrail: boolean;
  eligible: boolean;
  eligibility_reason: string;
  expected_save_rate: number;
  expected_net_value: number;
  allowed: boolean;
};

export function offerCost(o: OfferRow, c: Pick<CaseRow, 'monthlyBill' | 'lines'>): number {
  if (o.costType === 'fixed') return o.costValue;
  if (o.costType === 'per_line_month') return o.costValue * c.lines * o.durationMonths;
  return o.costValue * c.monthlyBill * o.durationMonths; // pct_bill_month
}

function eligibility(o: OfferRow, c: CaseRow): [boolean, string] {
  const s = c.signals;
  switch (o.offerCode) {
    case 'NET-CARE':
      return s.dropped_call_rate_3m > 2
        ? [true, `dropped-call rate ${s.dropped_call_rate_3m}% > 2%`]
        : [false, `dropped-call rate ${s.dropped_call_rate_3m}% is not degraded`];
    case 'WIFI-CALL':
      return s.dropped_call_rate_3m > 1.5 || c.lastCall?.intent === 'network_complaint'
        ? [true, 'network complaint / elevated dropped calls']
        : [false, 'no network issue on this account'];
    case 'RATE-LOCK':
      return s.promo_expired_90d || s.promo_expiring_60d
        ? [true, 'Switch & Save promo expired or expiring']
        : [false, 'no Switch & Save roll-off on this account'];
    case 'CREST-MATCH':
      return s.competitor_promo_in_market
        ? [true, `Crest Wireless promo active in ${c.market}`]
        : [false, `no competitor promo in ${c.market}`];
    case 'UPGRADE-200':
      return c.contractType.startsWith('Device')
        ? [true, 'device installment account']
        : [false, 'bring-your-own-device account'];
    case 'HOTSPOT-6':
      return /Unlimited/.test(c.plan) ? [true, 'Unlimited plan'] : [false, 'not an Unlimited plan'];
    default:
      return [true, 'any account'];
  }
}

export function evaluateOffers(c: CaseRow, catalog: OfferRow[]): OfferEvaluation[] {
  const driver = c.topDriver === 'account' || c.topDriver === 'port_out_intent' ? 'care' : c.topDriver;
  const evals = catalog.map((o) => {
    const cost = Math.round(offerCost(o, c) * 100) / 100;
    const cap = Math.round(12 * c.monthlyBill * o.grossMarginPct * o.guardrailPct * 100) / 100;
    const [eligible, reason] = eligibility(o, c);
    const rate = o.saveRates[driver]?.rate ?? 0.2;
    const net = rate * 12 * c.monthlyBill * o.grossMarginPct - rate * cost;
    return {
      offer_code: o.offerCode,
      offer_name: o.offerName,
      description: o.description,
      target_driver: o.targetDriver,
      cost,
      guardrail_cap: cap,
      within_guardrail: cost <= cap,
      eligible,
      eligibility_reason: reason,
      expected_save_rate: rate,
      expected_net_value: Math.round(net * 100) / 100,
      allowed: eligible && cost <= cap,
    };
  });
  return evals.sort((a, b) => Number(b.allowed) - Number(a.allowed) || b.expected_net_value - a.expected_net_value);
}

export async function stageOffer(
  db: AppDb,
  args: {
    customerId: string;
    offerCode: string;
    channel: StagedOffer['channel'];
    subject: string;
    message: string;
    rationale: string;
    userEmail: string;
  },
): Promise<{ ok: true; staged: StagedOffer } | { ok: false; error: string }> {
  const c = await getCase(db, args.customerId);
  if (!c) return { ok: false, error: `No retention case for ${args.customerId}` };
  if (c.status === 'accepted' || c.status === 'declined')
    return { ok: false, error: `Case already closed (${c.status})` };
  const catalog = await listOffers(db);
  const ev = evaluateOffers(c, catalog).find((e) => e.offer_code === args.offerCode);
  if (!ev) return { ok: false, error: `Unknown offer ${args.offerCode}` };
  if (!ev.eligible) return { ok: false, error: `GUARDRAIL: not eligible — ${ev.eligibility_reason}` };
  if (!ev.within_guardrail)
    return { ok: false, error: `GUARDRAIL: cost $${ev.cost} exceeds the margin cap $${ev.guardrail_cap} (30% of 12-month gross margin)` };
  const staged: StagedOffer = {
    offerCode: ev.offer_code,
    offerName: ev.offer_name,
    cost: ev.cost,
    guardrailCap: ev.guardrail_cap,
    expectedSaveRate: ev.expected_save_rate,
    expectedRetainedRevenue: Math.round(c.monthlyBill * 12 * 100) / 100,
    channel: args.channel,
    subject: args.subject,
    message: args.message,
    rationale: args.rationale,
    stagedBy: 'Retention agent',
    stagedAt: new Date().toISOString(),
  };
  const audit: AuditEntry = {
    at: staged.stagedAt,
    by: `agent (for ${args.userEmail})`,
    action: 'offer_staged',
    tool: 'stage_offer',
    notes: `${ev.offer_code} · cost $${ev.cost} ≤ cap $${ev.guardrail_cap} · expected save rate ${(ev.expected_save_rate * 100).toFixed(0)}%`,
  };
  await db
    .update(retentionCases)
    .set({
      status: 'offer_ready',
      stagedOffer: staged,
      auditTrail: sql`${retentionCases.auditTrail} || ${JSON.stringify([audit])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(retentionCases.customerId, args.customerId));
  return { ok: true, staged };
}

export async function recordDecision(
  db: AppDb,
  args: { customerId: string; decision: 'accepted' | 'declined'; userEmail: string; note?: string | null },
): Promise<CaseRow> {
  const c = await getCase(db, args.customerId);
  if (!c) throw new Error(`No retention case for ${args.customerId}`);
  if (!c.stagedOffer) throw new Error('No offer staged on this case yet — ask the agent for the next-best offer first.');
  const audit: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: args.decision,
    notes: `${c.stagedOffer.offerCode} ${args.decision} by customer${args.note ? ` — ${args.note}` : ''}`,
  };
  const rows = await db
    .update(retentionCases)
    .set({
      status: args.decision,
      decidedAt: new Date(),
      decidedBy: args.userEmail,
      auditTrail: sql`${retentionCases.auditTrail} || ${JSON.stringify([audit])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(retentionCases.customerId, args.customerId))
    .returning();
  return rows[0];
}

/** Desk KPIs from the Lakebase mirror (live: reflects every decision). */
export async function deskKpis(db: AppDb) {
  const r = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE risk_tier = 'Critical')::int                          AS critical,
      count(*) FILTER (WHERE risk_tier = 'High')::int                              AS high,
      count(*) FILTER (WHERE risk_tier = 'Medium')::int                            AS medium,
      coalesce(sum(annual_revenue_at_risk) FILTER (WHERE risk_tier IN ('Critical','High')), 0)::float AS revenue_at_risk,
      coalesce(sum(monthly_bill * 12) FILTER (WHERE risk_tier IN ('Critical','High')), 0)::float AS arpu_book_at_risk,
      count(*) FILTER (WHERE status = 'offer_ready')::int                          AS offers_ready,
      count(*) FILTER (WHERE status = 'accepted')::int                             AS accepted,
      count(*) FILTER (WHERE status = 'declined')::int                             AS declined,
      coalesce(sum(monthly_bill * 12) FILTER (WHERE status = 'accepted'), 0)::float AS revenue_saved,
      coalesce(sum((staged_offer->>'cost')::float) FILTER (WHERE status = 'accepted'), 0)::float AS offer_spend
    FROM app.retention_cases`);
  const d = await db.execute(sql`
    SELECT top_driver, count(*)::int AS n, sum(annual_revenue_at_risk)::float AS at_risk
    FROM app.retention_cases WHERE risk_tier IN ('Critical','High') GROUP BY 1 ORDER BY 3 DESC`);
  return { ...(r.rows[0] as Record<string, number>), drivers: d.rows };
}

/** Retained-revenue what-if over the worked cohort. */
export async function whatIf(
  db: AppDb,
  p: { tiers: string[]; contactRate: number; strategy: 'matched' | 'blanket' },
) {
  const catalog = await listOffers(db);
  const disc = catalog.find((o) => o.offerCode === 'DISC-20');
  const cases = await db.select().from(retentionCases).where(inArray(retentionCases.riskTier, p.tiers));
  let retained = 0, spend = 0, saves = 0, breaches = 0;
  const byOffer: Record<string, number> = {};
  for (const c of cases) {
    const p90 = 1 - Math.pow(1 - c.churnProbability, 3);
    const driver = c.topDriver === 'account' || c.topDriver === 'port_out_intent' ? 'care' : c.topDriver;
    let rate: number, cost: number, code: string;
    if (p.strategy === 'blanket' && disc) {
      rate = disc.saveRates[driver]?.rate ?? 0.3;
      cost = offerCost(disc, c);
      code = 'DISC-20';
      if (cost > 12 * c.monthlyBill * disc.grossMarginPct * disc.guardrailPct) breaches++;
    } else {
      const best = evaluateOffers(c, catalog).find((e) => e.allowed);
      if (!best) continue;
      rate = best.expected_save_rate;
      cost = best.cost;
      code = best.offer_code;
    }
    const expSaves = p.contactRate * p90 * rate;
    saves += expSaves;
    retained += expSaves * c.monthlyBill * 12;
    spend += p.contactRate * rate * cost;
    byOffer[code] = (byOffer[code] ?? 0) + p.contactRate;
  }
  return {
    accounts: cases.length,
    contacted: Math.round(cases.length * p.contactRate),
    expected_saves: Math.round(saves),
    retained_revenue: Math.round(retained),
    offer_spend: Math.round(spend),
    net_margin_impact: Math.round(retained * 0.58 - spend),
    guardrail_breaches: Math.round(breaches * p.contactRate),
    offer_mix: Object.entries(byOffer).map(([code, n]) => ({ code, accounts: Math.round(n) })).sort((a, b) => b.accounts - a.accounts),
  };
}
