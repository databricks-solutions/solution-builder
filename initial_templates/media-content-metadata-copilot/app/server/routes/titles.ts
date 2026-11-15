import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { decideTitle, getTitle, librarySummary, listTitles, saveProposal, titlesByIds, type Edits, type Scope } from '../db/queries/index.js';
import { loadLibraryRules, type DataConfig } from '../db/sync.js';
import { retagTitle } from '../services/retag.js';
import { resolvedBackends } from '../services/resources.js';
import { vectorQuery } from '../lib/vs.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * Metadata workbench routes.
 *   GET  /api/titles                 the queue (scope: gems | safety | harborlight | reviewed | all; q)
 *   GET  /api/titles/summary         library KPIs (+ by source)
 *   GET  /api/titles/:id             title record: live metadata, AI proposal, scenes, last re-tag run, audit trail
 *   POST /api/titles/:id/retag       SSE — run the AI re-tag (AI Functions proposal → standards → Standards Guide via the Genie agent → Vector Search → brief)
 *   POST /api/titles/:id/decision    editor write-back (APPROVED publishes the edited proposal / REJECTED)
 *   GET  /api/titles/:id/similar     "more like this" (Vector Search over title profiles)
 *   GET  /api/clips?q=…              clip search for repurposing (Vector Search over scene descriptions)
 */
export function registerTitleRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; genieSpaceId: string; writerModel: string },
): void {
  const { db } = deps;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const index = (name: string) => (deps.data ? `${deps.data.catalog}.${deps.data.schema}.${name}` : '');
  const SCOPES: Scope[] = ['gems', 'safety', 'harborlight', 'reviewed', 'all'];

  app.get('/api/titles', async (req, res) => {
    const scope = (SCOPES.includes(req.query.scope as Scope) ? req.query.scope : 'gems') as Scope;
    res.json(await listTitles(db, { scope, q: str(req.query.q) }));
  });

  app.get('/api/titles/summary', async (_req, res) => {
    res.json(await librarySummary(db));
  });

  app.get('/api/titles/:id', async (req, res) => {
    const t = await getTitle(db, req.params.id);
    if (!t) {
      res.status(404).json({ error: 'title not found' });
      return;
    }
    res.json(t);
  });

  app.get('/api/titles/:id/similar', async (req, res) => {
    const t = await getTitle(db, req.params.id);
    if (!t || !deps.data) {
      res.status(404).json({ error: 'title not found' });
      return;
    }
    const m = t.ai ?? { synopsis: t.meta.synopsis, genres: t.meta.genres, moods: t.meta.moods, themes: t.meta.themes, setting: '' };
    const hits = await vectorQuery(req, index('title_profiles_index'),
      `${m.synopsis} Genres: ${m.genres.join(', ')}. Moods: ${m.moods.join(', ')}. Themes: ${m.themes.join(', ')}. Setting: ${m.setting}.`,
      ['title_id', 'title', 'source', 'primary_genre'], 9);
    const ids = hits.map((h) => String(h.title_id)).filter((id) => id !== t.id).slice(0, 6);
    const peers = await titlesByIds(db, ids);
    res.json(ids.map((id) => ({ ...peers.find((p) => p.id === id), score: hits.find((h) => String(h.title_id) === id)?.score })).filter((x) => x.id));
  });

  app.get('/api/clips', async (req, res) => {
    const q = str(req.query.q);
    if (!q || !deps.data) {
      res.status(400).json({ error: 'q required' });
      return;
    }
    const exclude = str(req.query.exclude);
    const hits = await vectorQuery(req, index('scenes_index'), q, ['scene_id', 'title_id', 'scene_no', 'start_tc', 'end_tc', 'description'], 12);
    const rows = hits.filter((h) => String(h.title_id) !== exclude);
    const peers = await titlesByIds(db, [...new Set(rows.map((h) => String(h.title_id)))]);
    res.json(rows.slice(0, 8).map((h) => ({ ...h, title: peers.find((p) => p.id === String(h.title_id))?.title ?? h.title_id, source: peers.find((p) => p.id === String(h.title_id))?.source })));
  });

  app.post('/api/titles/:id/retag', async (req, res) => {
    const t = await getTitle(db, req.params.id);
    if (!t) {
      res.status(404).json({ error: 'title not found' });
      return;
    }
    if (!deps.data) {
      res.status(503).json({ error: 'data config missing (DEMO_CATALOG / DEMO_SCHEMA)' });
      return;
    }
    if (t.decision) {
      res.status(409).json({ error: `already ${t.decision.toLowerCase()} by ${t.decidedBy} — reset the demo to re-tag it again` });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const rules = await loadLibraryRules(deps.data);
      const proposal = await retagTitle(req, t, rules, {
        genieSpaceId: deps.genieSpaceId || (await resolvedBackends()).genieSpaceId, writerModel: deps.writerModel, profilesIndex: index('title_profiles_index'),
        lookupPeers: (ids) => titlesByIds(db, ids), onStep: (e) => send('step', e),
      });
      await saveProposal(db, t.id, proposal, getCurrentUserEmail(req));
      send('result', { proposal });
    } catch (e) {
      console.error('[retag] failed', e);
      send('error', { message: (e as Error).message });
    }
    res.end();
  });

  app.post('/api/titles/:id/decision', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { decision?: string; notes?: string; edits?: Edits };
    if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') {
      res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
      return;
    }
    if (!deps.data) {
      res.status(503).json({ error: 'data config missing' });
      return;
    }
    try {
      const rules = await loadLibraryRules(deps.data);
      const updated = await decideTitle(db, {
        id: req.params.id, decision: body.decision, edits: body.edits, notes: body.notes ?? null,
        userEmail: getCurrentUserEmail(req), rules: rules.collections,
      });
      if (!updated) {
        res.status(404).json({ error: 'title not found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });
}
