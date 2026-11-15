import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { caseSummary, decideCase, getCase, listCases, saveAssessment, type Decision } from '../db/queries/index.js';
import { loadRulebook, type DataConfig } from '../db/sync.js';
import { assessCase, type CaseFile } from '../services/assess.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { resolvedBackends } from '../services/resources.js';

/**
 * Caseworker workbench routes.
 *   GET  /api/cases                 open caseload (filters: county, status, caseworker, q)
 *   GET  /api/cases/summary         KPI counts (+ by county)
 *   GET  /api/cases/:id             case file: household + documents (with ai_extract fields) + last assessment
 *   POST /api/cases/:id/assess      SSE — run the AI eligibility check (rules → policy documents (Genie agent) → notice)
 *   POST /api/cases/:id/decision    caseworker decision write-back (approve / deny / RFI / escalate)
 */
export function registerCaseRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; noticeModel: string },
): void {
  const { db } = deps;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  app.get('/api/cases', async (req, res) => {
    res.json(await listCases(db, {
      county: str(req.query.county), status: str(req.query.status) ?? 'open',
      caseworker: str(req.query.caseworker), q: str(req.query.q),
    }));
  });

  app.get('/api/cases/summary', async (req, res) => {
    res.json(await caseSummary(db, str(req.query.county)));
  });

  app.get('/api/cases/:id', async (req, res) => {
    const c = await getCase(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'case not found' });
      return;
    }
    res.json(c);
  });

  app.post('/api/cases/:id/assess', async (req, res) => {
    const c = await getCase(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'case not found' });
      return;
    }
    if (!deps.data) {
      res.status(503).json({ error: 'data config missing (DEMO_CATALOG / DEMO_SCHEMA)' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const book = await loadRulebook(deps.data);
      // The Genie agent id comes from env or <schema>.demo_resources (written by the setup job).
      const { genieSpaceId } = await resolvedBackends();
      const file: CaseFile = {
        ...c,
        documents: c.documents.map((d) => ({ id: d.id, docType: d.docType, extracted: d.extracted ?? null, extractionConfidence: d.extractionConfidence })),
      };
      const out = await assessCase(req, file, book, {
        genieSpaceId, noticeModel: deps.noticeModel, onStep: (e) => send('step', e),
      });
      await saveAssessment(db, c.id, out.assessment, out.notice, getCurrentUserEmail(req));
      send('result', { assessment: out.assessment, notice: out.notice });
    } catch (e) {
      console.error('[assess] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/cases/:id/decision', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { decision?: string; notes?: string; noticeText?: string };
    const allowed: Decision[] = ['APPROVED', 'DENIED', 'RFI_SENT', 'ESCALATED'];
    if (!allowed.includes(body.decision as Decision)) {
      res.status(400).json({ error: `decision must be one of ${allowed.join(', ')}` });
      return;
    }
    const updated = await decideCase(db, {
      id: req.params.id, decision: body.decision as Decision, notes: body.notes ?? null,
      noticeText: body.noticeText ?? null, userEmail: getCurrentUserEmail(req),
    });
    if (!updated) {
      res.status(404).json({ error: 'case not found' });
      return;
    }
    res.json(updated);
  });
}
