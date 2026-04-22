import type { Application } from 'express';
import express from 'express';
import {
  decideReturn,
  facilitySummary,
  getReturn,
  listCustomerOrders,
  listReturns,
  lotsByFacility,
  lotSummary,
  returnsSummary,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { AppDb } from '../db/index.js';

/**
 * OLTP business routes — returns queue, lot rollup, customer orders, and
 * the operator decision endpoint. Drives the Operations page.
 */

type Deps = { db: AppDb };

export function registerReturnsRoutes(app: Application, deps: Deps): void {
  const { db } = deps;

  // --- GET /api/returns (list) -------------------------------------------
  app.get('/api/returns', async (req, res) => {
    const status = (req.query.status as string | undefined) ?? undefined;
    const lot = (req.query.lot as string | undefined) ?? undefined;
    const valid = ['pending', 'approved', 'rejected', 'escalated'] as const;
    type S = (typeof valid)[number];
    const isValid = (v: string): v is S =>
      (valid as readonly string[]).includes(v);
    const statusArg = status && isValid(status) ? status : undefined;
    const rows = await listReturns(db, { status: statusArg, lot });
    res.json(rows);
  });

  // --- GET /api/returns/summary ------------------------------------------
  app.get('/api/returns/summary', async (_req, res) => {
    const rows = await returnsSummary(db);
    res.json(rows);
  });

  // --- GET /api/returns/:id (detail — includes emails[] + ai_audit_trail[]) -
  app.get('/api/returns/:id', async (req, res) => {
    const row = await getReturn(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(row);
  });

  // --- POST /api/returns/:id/decide --------------------------------------
  app.post('/api/returns/:id/decide', express.json(), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const decision = req.body?.decision as string | undefined;
    const notes = req.body?.notes as string | undefined;
    const valid = ['approved', 'rejected', 'escalated'] as const;
    type D = (typeof valid)[number];
    const isValid = (v: string): v is D =>
      (valid as readonly string[]).includes(v);
    if (!decision || !isValid(decision)) {
      res
        .status(400)
        .json({ error: 'decision must be one of approved|rejected|escalated' });
      return;
    }
    const result = await decideReturn(db, {
      id: req.params.id,
      userEmail,
      decision,
      notes,
    });
    res.json(result);
  });

  // --- GET /api/lots/summary (legacy, still used elsewhere) --------------
  app.get('/api/lots/summary', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await lotSummary(db, limit);
    res.json(rows);
  });

  // --- GET /api/facilities/summary ---------------------------------------
  app.get('/api/facilities/summary', async (_req, res) => {
    const rows = await facilitySummary(db);
    res.json(rows);
  });

  // --- GET /api/facilities/:name/lots ------------------------------------
  app.get('/api/facilities/:name/lots', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 5), 50);
    const rows = await lotsByFacility(db, req.params.name, limit);
    res.json(rows);
  });

  // --- GET /api/customers/:id/orders -------------------------------------
  app.get('/api/customers/:id/orders', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await listCustomerOrders(db, req.params.id, limit);
    res.json(rows);
  });
}
