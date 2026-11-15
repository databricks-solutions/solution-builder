import { asc, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import {
  appetiteRules, documents, lossRunClaims, ratingFactors, sovLocations, submissions, type AuditEntry, type UwReview,
} from '../schema.js';
import type { Claim, Factors, Loc, Rules, Sub } from '../../services/underwrite.js';

/** Underwriting desk queries over the Lakebase mirror of today's queue. */

export async function listQueue(db: AppDb) {
  const r = await db.execute(sql`
    SELECT id, insured_name, broker_name, broker_tier, segment, segment_code, state, hail_belt, received_ts, effective_date,
           days_to_effective, sov_tiv, sov_locations, loss_run_claims, loss_run_incurred, jsonb_array_length(discrepancies) AS discrepancy_count,
           rules_hit, p_as_submitted, p_verified, band_as_submitted, band_verified, triage_lane, priority_score, premium_potential,
           status, decision, (review->'pricing'->>'total_premium')::float AS review_premium, (review->>'decision') AS review_decision,
           (review->>'referral_required')::boolean AS referral_required
    FROM app.submissions ORDER BY priority_score DESC, sov_tiv DESC`);
  return r.rows;
}

export async function queueSummary(db: AppDb) {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS submissions, COALESCE(SUM(sov_tiv), 0)::float AS tiv, COALESCE(SUM(premium_potential), 0)::float AS premium_potential,
           COUNT(*) FILTER (WHERE jsonb_array_length(discrepancies) > 0)::int AS documents_disagree,
           COUNT(*) FILTER (WHERE triage_lane = 'Fast track')::int AS fast_track,
           COUNT(*) FILTER (WHERE triage_lane LIKE 'Decline%')::int AS decline_lane,
           COUNT(*) FILTER (WHERE band_as_submitted = 'Low' AND band_verified = 'High')::int AS hidden_high_risk,
           COUNT(*) FILTER (WHERE status = 'review_drafted')::int AS drafted,
           COUNT(*) FILTER (WHERE status = 'referred')::int AS referred,
           COUNT(*) FILTER (WHERE status = 'decided')::int AS decided,
           COUNT(*) FILTER (WHERE days_to_effective <= 21)::int AS effective_3wks
    FROM app.submissions`);
  const lanes = await db.execute(sql`SELECT triage_lane, COUNT(*)::int AS n, SUM(sov_tiv)::float AS tiv FROM app.submissions GROUP BY triage_lane ORDER BY n DESC`);
  return { ...(r.rows[0] as Record<string, number>), lanes: lanes.rows };
}

export async function getSubmission(db: AppDb, id: string) {
  const [s] = await db.select().from(submissions).where(eq(submissions.id, id));
  if (!s) return null;
  const locs = await db.select().from(sovLocations).where(eq(sovLocations.submissionId, id)).orderBy(asc(sovLocations.locNo));
  const claims = await db.select().from(lossRunClaims).where(eq(lossRunClaims.submissionId, id)).orderBy(asc(lossRunClaims.lossDate));
  const docs = await db.select().from(documents).where(eq(documents.submissionId, id)).orderBy(asc(documents.docType));
  return { ...s, locations: locs, claims, documents: docs };
}

export async function findSubmission(db: AppDb, key: string) {
  const k = key.trim();
  const r = await db.execute(sql`
    SELECT id FROM app.submissions
    WHERE UPPER(id) = UPPER(${k}) OR id ILIKE ${'%' + k.replace(/^SUB-?/i, '') + '%'} OR insured_name ILIKE ${'%' + k + '%'}
    ORDER BY (UPPER(id) = UPPER(${k})) DESC LIMIT 1`);
  const id = (r.rows[0] as { id?: string } | undefined)?.id;
  return id ? getSubmission(db, id) : null;
}

export async function getDocument(db: AppDb, docId: string) {
  const [d] = await db.select().from(documents).where(eq(documents.id, docId));
  return d ?? null;
}

export async function loadFactors(db: AppDb): Promise<Factors> {
  const rows = await db.select().from(ratingFactors);
  return new Map(rows.map((r) => [`${r.factorType}:${r.factorKey}`, r.value]));
}

export async function loadRules(db: AppDb): Promise<Rules> {
  const rows = await db.select().from(appetiteRules);
  return new Map(rows.map((r) => [r.id, { docRef: r.docRef, title: r.title, threshold: r.threshold }]));
}

export function toEngine(s: NonNullable<Awaited<ReturnType<typeof getSubmission>>>): { sub: Sub; locs: Loc[]; claims: Claim[] } {
  return {
    sub: { ...s } as unknown as Sub,
    locs: s.locations.map((l) => ({ ...l })) as Loc[],
    claims: s.claims.map((c) => ({ ...c })) as Claim[],
  };
}

function audit(by: string, action: AuditEntry['action'], notes?: string): AuditEntry {
  return { at: new Date().toISOString(), by, action, notes };
}

export async function saveReview(db: AppDb, id: string, review: UwReview, by: string) {
  const e = audit('Underwriting Copilot', 'review_drafted',
    `${review.decision.replace(/_/g, ' ').toLowerCase()} · $${Math.round(review.pricing.total_premium).toLocaleString('en-US')}${review.referral_required ? ' · CUO referral' : ''} · requested by ${by}`);
  await db.update(submissions).set({
    review, reviewUpdatedAt: new Date(), status: 'review_drafted', cuoNote: null, updatedAt: new Date(),
    auditTrail: sql`${submissions.auditTrail} || ${JSON.stringify([e])}::jsonb`,
  }).where(eq(submissions.id, id));
}

export async function setStatus(db: AppDb, id: string, status: 'review_drafted' | 'referred', by: string, action: AuditEntry['action'], note?: string) {
  await db.update(submissions).set({
    status, cuoNote: note ?? null, updatedAt: new Date(),
    auditTrail: sql`${submissions.auditTrail} || ${JSON.stringify([audit(by, action, note)])}::jsonb`,
  }).where(eq(submissions.id, id));
}

/** Issue the decision: mark the submission decided (Lakebase). The caller writes it back to Delta. */
export async function commitDecision(db: AppDb, id: string, by: string, note: string | null, approved: boolean) {
  const [s] = await db.select().from(submissions).where(eq(submissions.id, id));
  if (!s?.review) return null;
  const now = new Date();
  const r = s.review;
  await db.update(submissions).set({
    status: 'decided', decision: r.decision, decidedBy: by, decidedAt: now, cuoNote: note, updatedAt: now,
    auditTrail: sql`${submissions.auditTrail} || ${JSON.stringify([
      ...(approved ? [audit(by, 'approved', note ?? undefined)] : []),
      audit(by, 'decided', `${r.decision.replace(/_/g, ' ').toLowerCase()} issued to ${s.brokerName}${r.decision.startsWith('QUOTE') ? ` · $${Math.round(r.pricing.total_premium).toLocaleString('en-US')}` : ''}`),
    ])}::jsonb`,
  }).where(eq(submissions.id, id));
  return getSubmission(db, id);
}

export async function referralQueue(db: AppDb) {
  const r = await db.execute(sql`
    SELECT id, insured_name, broker_name, segment, state, sov_tiv, status, review_updated_at, decided_by, decided_at, cuo_note, decision,
           review->'pricing' AS pricing, review->'referral_reasons' AS referral_reasons, review->>'rationale' AS rationale,
           review->>'decision' AS review_decision, review->'excluded_locations' AS excluded_locations, review->>'drafted_by' AS drafted_by,
           p_as_submitted, p_verified, band_as_submitted, band_verified
    FROM app.submissions WHERE status IN ('referred', 'decided') ORDER BY (status = 'decided'), review_updated_at DESC`);
  return r.rows;
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT s.id AS submission_id, s.insured_name, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.submissions s, jsonb_array_elements(s.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}
