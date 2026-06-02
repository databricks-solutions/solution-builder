import type { Application } from 'express';
import express from 'express';
import {
  decideReturn,
  facilitySummary,
  getReturn,
  listCustomerOrders,
  listReturns,
  lotCityBreakdown,
  lotCountryBreakdown,
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

const VALID_STATUS = ['pending', 'approved', 'rejected', 'escalated'] as const;
type StatusValue = (typeof VALID_STATUS)[number];

/** Pull a single-string query param out of `req.query`. Express can return
 *  an array if the same key is repeated (?country=US&country=FR); we coerce
 *  to undefined in that case so it can't leak into a SQL bind. */
function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Parse a positive-int limit query param. `?limit=abc` → fallback;
 *  `?limit=99999` → max. Anything else → fallback. Stops a stray NaN
 *  from reaching the SQL `LIMIT $1` bind and exploding cryptically. */
function intParam(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseStatus(v: unknown): StatusValue | undefined {
  const s = strParam(v);
  return s && (VALID_STATUS as readonly string[]).includes(s)
    ? (s as StatusValue)
    : undefined;
}

type Deps = { db: AppDb };

export function registerReturnsRoutes(app: Application, deps: Deps): void {
  const { db } = deps;

  // --- GET /api/returns (list) -------------------------------------------
  app.get('/api/returns', async (req, res) => {
    const tier = strParam(req.query.tier);
    const sort = strParam(req.query.sort);
    const rows = await listReturns(db, {
      status: parseStatus(req.query.status),
      lot: strParam(req.query.lot),
      tier: tier === 'premium' || tier === 'standard' ? tier : undefined,
      country: strParam(req.query.country),
      sort:
        sort === 'anger' || sort === 'value' || sort === 'recent'
          ? sort
          : undefined,
    });
    res.json(rows);
  });

  // --- GET /api/returns/summary ------------------------------------------
  app.get('/api/returns/summary', async (_req, res) => {
    const rows = await returnsSummary(db);
    res.json(rows);
  });

  // --- GET /api/returns/by-country (geographic breakdown for the panel) ---
  // Scoped to the same status/lot filter the queue uses, so the panel
  // updates with the queue. Returns per-country totals + premium split.
  app.get('/api/returns/by-country', async (req, res) => {
    const rows = await lotCountryBreakdown(db, {
      status: parseStatus(req.query.status),
      lot: strParam(req.query.lot),
    });
    res.json(rows);
  });

  // --- GET /api/returns/by-city (bubble map: per-city points + size) ------
  // Same status/lot scope as the queue. Returns per-city totals (with
  // averaged lat/lng) so the map can plot one bubble per city, sized by
  // `total`. Skips customers without coords (legacy synth runs).
  app.get('/api/returns/by-city', async (req, res) => {
    const rows = await lotCityBreakdown(db, {
      status: parseStatus(req.query.status),
      lot: strParam(req.query.lot),
    });
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
  app.post('/api/returns/:id/decide', express.json({ limit: '32kb' }), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const decision = strParam(req.body?.decision);
    // Cap notes at 4KB — they go into a jsonb array and have no upstream
    // limit otherwise. Anything non-string is dropped (silently — the
    // field is optional).
    const rawNotes = req.body?.notes;
    const notes =
      typeof rawNotes === 'string' && rawNotes.length > 0
        ? rawNotes.slice(0, 4000)
        : undefined;
    const validDecisions = ['approved', 'rejected', 'escalated'] as const;
    type D = (typeof validDecisions)[number];
    const isValid = (v: string): v is D =>
      (validDecisions as readonly string[]).includes(v);
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
    const rows = await lotSummary(db, intParam(req.query.limit, 10, 50));
    res.json(rows);
  });

  // --- GET /api/facilities/summary ---------------------------------------
  app.get('/api/facilities/summary', async (_req, res) => {
    const rows = await facilitySummary(db);
    res.json(rows);
  });

  // --- GET /api/facilities/:name/lots ------------------------------------
  app.get('/api/facilities/:name/lots', async (req, res) => {
    const rows = await lotsByFacility(
      db,
      req.params.name,
      intParam(req.query.limit, 5, 50),
    );
    res.json(rows);
  });

  // --- GET /api/customers/:id/orders -------------------------------------
  app.get('/api/customers/:id/orders', async (req, res) => {
    const rows = await listCustomerOrders(
      db,
      req.params.id,
      intParam(req.query.limit, 10, 50),
    );
    res.json(rows);
  });
}
