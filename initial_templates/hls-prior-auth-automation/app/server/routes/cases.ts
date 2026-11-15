import type { Application } from 'express';
import express from 'express';
import type { AppDb } from '../db/index.js';
import {
  autoApprovalCandidates,
  autoApproveBatch,
  caseSummary,
  decideCase,
  getCase,
  listCases,
  queueBreakdown,
  saveAiReview,
  type Decision,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { askPolicy, reviewCaseLive } from '../lib/pa-ai.js';
import { writeDecisionsToDelta } from '../lib/writeback.js';

/**
 * Prior-auth workbench REST API.
 *   GET  /api/cases                 queue (filters: lane, urgency, status, q)
 *   GET  /api/cases/summary         KPI tiles
 *   GET  /api/cases/breakdown       open queue by policy / practice group / channel
 *   GET  /api/cases/auto-approvable the auto-approval lane
 *   POST /api/cases/auto-approve    release the lane (rule re-checked in SQL)
 *   GET  /api/cases/:id             case + criteria evidence + notes
 *   POST /api/cases/:id/decide      nurse decision write-back
 *   POST /api/cases/:id/review      live AI re-review (Foundation Model API)
 *   POST /api/policy/ask            the Genie agent over the medical policy documents
 */
export function registerCaseRoutes(
  app: Application,
  deps: { db: AppDb; catalog: string; schema: string; getGenieSpaceId: () => Promise<string> },
): void {
  const { db } = deps;
  const json = express.json({ limit: '1mb' });

  app.get('/api/cases', async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listCases(db, { lane: q.lane, urgency: q.urgency, status: q.status ?? 'open', q: q.q }));
  });
  app.get('/api/cases/summary', async (_req, res) => res.json(await caseSummary(db)));
  app.get('/api/cases/breakdown', async (_req, res) => res.json(await queueBreakdown(db)));
  app.get('/api/cases/auto-approvable', async (_req, res) => res.json(await autoApprovalCandidates(db)));

  app.post('/api/cases/auto-approve', json, async (req, res) => {
    const by = getCurrentUserEmail(req);
    const ids = Array.isArray(req.body?.requestIds) ? (req.body.requestIds as string[]) : null;
    const rows = await autoApproveBatch(db, { by, requestIds: ids });
    writeDecisionsToDelta(
      deps.catalog,
      deps.schema,
      rows.map((r) => ({
        requestId: r.requestId,
        decision: 'Auto-approved',
        decidedBy: 'AUTO-RULE-v1',
        aiRecommendation: r.aiRecommendation,
        agreedWithAi: true,
        note: `Released by ${by}`,
      })),
    );
    res.json({ approved: rows.length, requestIds: rows.map((r) => r.requestId) });
  });

  app.get('/api/cases/:id', async (req, res) => {
    const c = await getCase(db, req.params.id);
    if (!c) return void res.status(404).json({ error: 'Case not found' });
    res.json(c);
  });

  app.post('/api/cases/:id/decide', json, async (req, res) => {
    const decision = req.body?.decision as Decision;
    if (!['approve', 'pend', 'refer_md'].includes(decision)) {
      return void res.status(400).json({ error: 'decision must be approve | pend | refer_md' });
    }
    const by = getCurrentUserEmail(req);
    const row = await decideCase(db, {
      requestId: req.params.id,
      decision,
      userEmail: by,
      note: req.body?.note ?? null,
      providerLetter: req.body?.providerLetter ?? null,
    });
    if (!row) return void res.status(409).json({ error: 'Case is not open (already decided?)' });
    const aiFor: Record<Decision, string> = { approve: 'APPROVE', pend: 'PEND', refer_md: 'REFER_MD' };
    writeDecisionsToDelta(deps.catalog, deps.schema, [
      {
        requestId: row.requestId,
        decision: { approve: 'Approved', pend: 'Pended - Info Requested', refer_md: 'Referred to Medical Director' }[decision],
        decidedBy: by,
        aiRecommendation: row.aiRecommendation,
        agreedWithAi: row.aiRecommendation ? row.aiRecommendation === aiFor[decision] : null,
        note: req.body?.note ?? null,
      },
    ]);
    res.json(await getCase(db, row.requestId));
  });

  app.post('/api/cases/:id/review', async (req, res) => {
    const c = await getCase(db, req.params.id);
    if (!c) return void res.status(404).json({ error: 'Case not found' });
    const review = await reviewCaseLive(req, {
      policyId: c.policyId,
      policyTitle: c.policyTitle,
      criteria: c.criteria.map((k) => ({ criterionId: k.criterionId, label: k.label, criterionText: k.criterionText })),
      notes: c.notes,
    });
    res.json(await saveAiReview(db, c.requestId, review, getCurrentUserEmail(req)));
  });

  app.post('/api/policy/ask', json, async (req, res) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) return void res.status(400).json({ error: 'question is required' });
    const out = await askPolicy(req, await deps.getGenieSpaceId(), question);
    res.json(out);
  });
}
