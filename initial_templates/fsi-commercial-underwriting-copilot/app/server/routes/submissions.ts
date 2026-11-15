import express, { type Application, type Request } from 'express';
import type { AppDb } from '../db/index.js';
import {
  commitDecision, getDocument, getSubmission, listQueue, loadFactors, loadRules, queueSummary, referralQueue, saveReview, setStatus, toEngine,
} from '../db/queries/index.js';
import { execSql, type DataConfig } from '../db/sync.js';
import type { UwReview } from '../db/schema.js';
import { reviewSubmission, type StepEvent } from '../services/underwrite.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { spAuthHeaders } from '../lib/auth.js';
import { resolvedBackends } from '../services/resources.js';

/**
 * Underwriting desk routes.
 *   GET  /api/queue/summary              queue KPIs (live Lakebase mirror)
 *   GET  /api/submissions                today's queue, highest priority first
 *   GET  /api/submissions/:id            application vs SOV vs loss run, scores, rules, latest review
 *   POST /api/submissions/:id/review     SSE — run the underwriting review (documents → risk → appetite + guideline documents → pricing → memo)
 *   POST /api/submissions/:id/issue      issue the decision (within authority) or refer it to the CUO
 *   POST /api/submissions/:id/approve    CUO approves → decision issued (Lakebase) + write-back (Delta uw_decisions)
 *   POST /api/submissions/:id/send-back  CUO returns the referral with a note
 *   GET  /api/referrals                  CUO referral queue + decided submissions
 *   GET  /api/documents/:docId/pdf       the original broker PDF from the submission_docs volume
 */
export type ReviewRunner = (req: Request, id: string, onStep: (e: StepEvent) => void) => Promise<UwReview | null>;

export function makeReviewRunner(deps: { db: AppDb; genieSpaceId: string; model: string }): ReviewRunner {
  return async (req, id, onStep) => {
    const s = await getSubmission(deps.db, id);
    if (!s) return null;
    const e = toEngine(s);
    const [factors, rules] = await Promise.all([loadFactors(deps.db), loadRules(deps.db)]);
    const review = await reviewSubmission(req, { ...e, factors, rules, draftedBy: getCurrentUserEmail(req), docCount: s.documents.length }, {
      genieSpaceId: deps.genieSpaceId || (await resolvedBackends()).genieSpaceId, model: deps.model, onStep,
    });
    await saveReview(deps.db, id, review, getCurrentUserEmail(req));
    return review;
  };
}

/** Delta write-back of an issued decision (uw_decisions). Best-effort — returns 'ok' or the error. */
export async function writeBackToDelta(data: DataConfig | undefined, s: { id: string; insuredName: string; segment: string; state: string }, r: UwReview, by: string, note: string | null): Promise<string> {
  const wh = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!data || !wh) return 'skipped (no warehouse / data config)';
  const q = (v: string | null | undefined) => (v == null ? 'NULL' : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
  const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'NULL' : String(Math.round(v * 10000) / 10000));
  const p = r.pricing;
  try {
    await execSql(wh, `INSERT INTO ${data.catalog}.${data.schema}.uw_decisions VALUES (${q(r.review_id)}, ${q(s.id)}, ${q(s.insuredName)}, ${q(s.segment)}, ${q(s.state)},
      ${q(r.decision)}, ${n(p.tiv_submitted)}, ${n(p.tiv_quoted)}, ${q(r.excluded_locations.join(','))}, ${n(p.property_premium)}, ${n(p.gl_premium)},
      ${n(p.total_premium)}, ${q(r.conditions.join(' | '))}, ${q(r.rationale)}, ${q(r.rules.filter((c) => c.status !== 'pass').map((c) => `${c.rule_id} (${c.doc_ref})`).join('; '))},
      ${n(r.risk.p_as_submitted)}, ${n(r.risk.p_verified)}, ${r.referral_required}, ${q(r.drafted_by)}, ${q(by)}, ${q(note)}, current_timestamp())`);
    return 'ok';
  } catch (e) {
    console.error('[issue] Delta write-back failed:', (e as Error).message);
    return (e as Error).message.slice(0, 300);
  }
}

export function registerSubmissionRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; runReview: ReviewRunner },
): void {
  const { db } = deps;

  app.get('/api/queue/summary', async (_req, res) => { res.json(await queueSummary(db)); });
  app.get('/api/submissions', async (_req, res) => { res.json(await listQueue(db)); });
  app.get('/api/referrals', async (_req, res) => { res.json(await referralQueue(db)); });

  app.get('/api/submissions/:id', async (req, res) => {
    const s = await getSubmission(db, req.params.id);
    if (!s) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }
    res.json(s);
  });

  app.get('/api/documents/:docId/pdf', async (req, res) => {
    const d = await getDocument(db, req.params.docId);
    if (!d) {
      res.status(404).json({ error: 'document not found' });
      return;
    }
    const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
    const r = await fetch(`${host}/api/2.0/fs/files${encodeURI(d.filePath)}`, { headers: await spAuthHeaders() });
    if (!r.ok) {
      res.status(r.status).json({ error: `Files API ${r.status}: ${(await r.text()).slice(0, 200)}` });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${d.submissionId}-${d.fileName}"`);
    res.send(Buffer.from(await r.arrayBuffer()));
  });

  app.post('/api/submissions/:id/review', async (req, res) => {
    const s = await getSubmission(db, req.params.id);
    if (!s) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }
    if (s.status === 'decided') {
      res.status(409).json({ error: 'decision already issued' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const review = await deps.runReview(req, req.params.id, (e) => send('step', e));
      send('result', { review });
    } catch (e) {
      console.error('[review] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  const issue = async (req: Request, id: string, note: string | null, approved: boolean) => {
    const by = getCurrentUserEmail(req);
    const s = await commitDecision(db, id, by, note, approved);
    if (!s?.review) return null;
    const deltaWriteBack = await writeBackToDelta(deps.data, s, s.review, by, note);
    return { submission: s, deltaWriteBack };
  };

  app.post('/api/submissions/:id/issue', express.json(), async (req, res) => {
    const s = await getSubmission(db, req.params.id);
    if (!s?.review) {
      res.status(400).json({ error: 'run the underwriting review first' });
      return;
    }
    if (s.status === 'decided') {
      res.status(409).json({ error: 'already issued' });
      return;
    }
    if (s.review.referral_required) {
      await setStatus(db, s.id, 'referred', getCurrentUserEmail(req), 'referred', (req.body?.note as string) || s.review.referral_reasons.join(' '));
      res.json({ status: 'referred', submission: await getSubmission(db, s.id) });
      return;
    }
    const out = await issue(req, s.id, 'Within senior underwriter authority', false);
    res.json({ status: 'decided', ...out });
  });

  app.post('/api/submissions/:id/approve', express.json(), async (req, res) => {
    const s = await getSubmission(db, req.params.id);
    if (!s || s.status !== 'referred') {
      res.status(409).json({ error: 'no referral awaiting approval' });
      return;
    }
    const out = await issue(req, s.id, (req.body?.note as string) || null, true);
    res.json({ status: 'decided', ...out });
  });

  app.post('/api/submissions/:id/send-back', express.json(), async (req, res) => {
    const s = await getSubmission(db, req.params.id);
    if (!s || s.status !== 'referred') {
      res.status(409).json({ error: 'no referral awaiting approval' });
      return;
    }
    await setStatus(db, s.id, 'review_drafted', getCurrentUserEmail(req), 'sent_back', (req.body?.note as string) || 'Sent back by the CUO');
    res.json({ status: 'review_drafted', submission: await getSubmission(db, s.id) });
  });
}
