import type { Application } from 'express';
import express from 'express';
import {
  bookWorkOrder,
  findParts,
  fleetSummary,
  getAsset,
  listFleet,
  listWindows,
  listWorkOrders,
  setWorkOrderStatus,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { AppDb } from '../db/index.js';

/** Control-room REST routes: fleet, asset detail, parts, windows, work orders (+ write-back). */
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

export function registerPdmRoutes(app: Application, deps: { db: AppDb }): void {
  const { db } = deps;
  app.get('/api/fleet', async (req, res) => {
    res.json(await listFleet(db, { line: str(req.query.line), tier: str(req.query.tier) }));
  });
  app.get('/api/fleet/summary', async (_req, res) => {
    res.json(await fleetSummary(db));
  });
  app.get('/api/assets/:id', async (req, res) => {
    const a = await getAsset(db, req.params.id);
    if (!a) return res.status(404).json({ error: `asset ${req.params.id} not found` });
    return res.json(a);
  });
  app.get('/api/parts', async (req, res) => {
    res.json(await findParts(db, { model: str(req.query.model) ?? null, query: str(req.query.q) ?? null }));
  });
  app.get('/api/windows', async (req, res) => {
    res.json(await listWindows(db, str(req.query.line) ?? null));
  });
  app.get('/api/work-orders', async (_req, res) => {
    res.json(await listWorkOrders(db));
  });
  app.post('/api/work-orders', express.json(), async (req, res) => {
    const b = req.body as Record<string, unknown>;
    try {
      const out = await bookWorkOrder(db, {
        asset_id: String(b.asset_id),
        priority: String(b.priority ?? 'P2'),
        title: String(b.title ?? 'Planned intervention'),
        root_cause: String(b.root_cause ?? ''),
        tasks: Array.isArray(b.tasks) ? (b.tasks as string[]) : [],
        window_id: String(b.window_id),
        duration_hours: Number(b.duration_hours ?? 3),
        technicians: String(b.technicians ?? ''),
        technician_count: Number(b.technician_count ?? 1),
        parts: Array.isArray(b.parts) ? (b.parts as Array<{ part_number: string; qty: number }>) : [],
        userEmail: getCurrentUserEmail(req),
        source: 'manual',
      });
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post('/api/work-orders/:id/status', express.json(), async (req, res) => {
    const s = String((req.body as Record<string, unknown>).status);
    if (!['in_progress', 'completed', 'cancelled'].includes(s)) return res.status(400).json({ error: 'bad status' });
    try {
      return res.json(await setWorkOrderStatus(db, req.params.id, s as 'in_progress', getCurrentUserEmail(req)));
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  });
}
