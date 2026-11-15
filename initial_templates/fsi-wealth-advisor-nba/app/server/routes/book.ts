import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { bookSummary, decideClient, getClient, listBook, savePrep, type Decision } from '../db/queries/index.js';
import { execWarehouseSql, type DataConfig } from '../db/sync.js';
import { prepMeeting, type ClientFile } from '../services/prep.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { resolvedBackends } from '../services/resources.js';

/**
 * Morning Book routes.
 *   GET  /api/book                   ranked households (filters: filter=this_week|at_risk|lending|blocked|decided, q)
 *   GET  /api/book/summary           KPIs for the header strip
 *   GET  /api/clients/:id            client file: profile, signals, accounts, notes (+AI), scored actions + suitability, prep
 *   POST /api/clients/:id/prep       SSE — AI meeting prep (model ranking → suitability → policy documents (Genie agent) → brief + outreach)
 *   POST /api/clients/:id/decision   advisor decision → Lakebase (live) + Delta advisor_decisions (lakehouse)
 */
export function registerBookRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; genieSpaceId: string; draftModel: string },
): void {
  const { db } = deps;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  app.get('/api/book', async (req, res) => {
    res.json(await listBook(db, { filter: str(req.query.filter), q: str(req.query.q) }));
  });
  app.get('/api/book/summary', async (_req, res) => {
    res.json(await bookSummary(db));
  });
  app.get('/api/clients/:id', async (req, res) => {
    const c = await getClient(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'client not found' });
      return;
    }
    res.json(c);
  });

  app.post('/api/clients/:id/prep', async (req, res) => {
    const c = await getClient(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'client not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const prep = await prepMeeting(req, c as unknown as ClientFile, {
        genieSpaceId: (await resolvedBackends()).genieSpaceId || deps.genieSpaceId, model: deps.draftModel, onStep: (e) => send('step', e),
      });
      await savePrep(db, c.id, prep, getCurrentUserEmail(req));
      send('result', { prep });
    } catch (e) {
      console.error('[prep] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/clients/:id/decision', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { decision?: string; action?: string; notes?: string; outreach?: string };
    const allowed: Decision[] = ['proposed', 'meeting_booked', 'not_now'];
    if (!allowed.includes(body.decision as Decision)) {
      res.status(400).json({ error: `decision must be one of ${allowed.join(', ')}` });
      return;
    }
    const by = getCurrentUserEmail(req);
    const c = await decideClient(db, {
      id: req.params.id, decision: body.decision as Decision, action: body.action ?? null, notes: body.notes ?? null,
      outreach: body.outreach ?? null, by,
    });
    if (!c) {
      res.status(404).json({ error: 'client not found' });
      return;
    }
    // Write-back to the lakehouse so the wealth-desk dashboard + Genie see the decision.
    let deltaWriteBack = 'ok';
    if (deps.data) {
      const rec = c.recommendations.find((r) => r.action_code === body.action);
      const disclosures = c.meetingPrep?.disclosures.map((d) => d.code).join(',') ?? rec?.disclosures ?? '';
      try {
        await execWarehouseSql(
          `INSERT INTO ${deps.data.catalog}.${deps.data.schema}.advisor_decisions
           SELECT uuid(), :hid, :adv, current_timestamp(), :action, :decision, :assets, :prop, :status, :disc, :channel, :msg, :by`,
          [
            { name: 'hid', value: c.id },
            { name: 'adv', value: c.advisorId },
            { name: 'action', value: body.action ?? null },
            { name: 'decision', value: body.decision as string },
            { name: 'assets', value: String(rec?.assets_in_scope ?? 0), type: 'DOUBLE' },
            { name: 'prop', value: String(rec?.propensity ?? 0), type: 'DOUBLE' },
            { name: 'status', value: rec?.status ?? null },
            { name: 'disc', value: disclosures },
            { name: 'channel', value: c.meetingPrep?.outreach.channel ?? 'Email' },
            { name: 'msg', value: (body.outreach ?? c.outreachDraft ?? '').slice(0, 4000) },
            { name: 'by', value: by },
          ],
        );
      } catch (e) {
        deltaWriteBack = (e as Error).message;
        console.error('[decision] Delta write-back failed:', deltaWriteBack);
      }
    }
    res.json({ client: c, deltaWriteBack });
  });
}
