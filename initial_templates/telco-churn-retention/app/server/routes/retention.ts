/**
 * Retention desk REST API.
 *
 *   GET  /api/cases                 worklist (filters: tier, driver, region, status)
 *   GET  /api/cases/:id             one case (+ guardrail evaluation of every offer)
 *   POST /api/cases/:id/decision    accept / decline  → Lakebase (live) + Delta write-back
 *   GET  /api/kpis                  desk KPIs (Lakebase) + churn trend / strategy save rates (warehouse, cached)
 *   GET  /api/whatif                retained-revenue what-if
 */
import type { Application } from 'express';
import type { AppDb } from '../db/index.js';
import {
  deskKpis,
  evaluateOffers,
  getCase,
  listCases,
  listOffers,
  recordDecision,
  whatIf,
} from '../db/queries/index.js';
import { execWarehouseSql } from '../db/sync.js';
import { getCurrentUserInfo } from '../lib/user.js';

type Deps = { db: AppDb; catalog: string; schema: string };

export function registerRetentionRoutes(app: Application, deps: Deps): void {
  const { db } = deps;
  const fq = (t: string) => `\`${deps.catalog}\`.\`${deps.schema}\`.${t}`;
  const q = (v: unknown) => (typeof v === 'string' && v ? v : null);

  app.get('/api/cases', async (req, res) => {
    const rows = await listCases(db, {
      tier: q(req.query.tier),
      driver: q(req.query.driver),
      region: q(req.query.region),
      status: q(req.query.status),
      limit: Math.min(Number(req.query.limit ?? 200), 500),
    });
    res.json(rows.map(({ lastCall, auditTrail: _a, ...r }) => ({
      ...r,
      lastCallIntent: lastCall?.intent ?? null,
      lastCallSentiment: lastCall?.sentiment ?? null,
    })));
  });

  app.get('/api/cases/:id', async (req, res) => {
    const c = await getCase(db, req.params.id);
    if (!c) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ ...c, offers: evaluateOffers(c, await listOffers(db)) });
  });

  app.post('/api/cases/:id/decision', async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'accepted' && decision !== 'declined') {
      res.status(400).json({ error: 'decision must be accepted | declined' });
      return;
    }
    const info = getCurrentUserInfo(req);
    const user = info.userEmail ?? info.userName ?? 'retention.specialist';
    const c = await recordDecision(db, {
      customerId: req.params.id,
      decision,
      userEmail: user,
      note: typeof req.body?.note === 'string' ? req.body.note : null,
    });
    // Write-back to the lakehouse so the CMO dashboard + Genie see the save.
    let deltaWriteBack: 'ok' | string = 'ok';
    try {
      const o = c.stagedOffer!;
      await execWarehouseSql(
        `INSERT INTO ${fq('retention_decisions')} SELECT uuid(), :cid, current_timestamp(), :code, :cost, :decision,
           :prob, :driver, :bill, :saved, :by, :channel, :msg`,
        [
          { name: 'cid', value: c.customerId },
          { name: 'code', value: o.offerCode },
          { name: 'cost', value: String(o.cost), type: 'DOUBLE' },
          { name: 'decision', value: decision },
          { name: 'prob', value: String(c.churnProbability), type: 'DOUBLE' },
          { name: 'driver', value: c.topDriver },
          { name: 'bill', value: String(c.monthlyBill), type: 'DOUBLE' },
          { name: 'saved', value: String(decision === 'accepted' ? Math.round(c.monthlyBill * 1200) / 100 : 0), type: 'DOUBLE' },
          { name: 'by', value: user },
          { name: 'channel', value: o.channel },
          { name: 'msg', value: o.message },
        ],
      );
    } catch (e) {
      deltaWriteBack = (e as Error).message;
      console.error('[decision] Delta write-back failed:', deltaWriteBack);
    }
    res.json({ case: c, deltaWriteBack });
  });

  // Warehouse-backed context (static between data refreshes) — cached 10 min.
  let lakeCache: { at: number; data: unknown } | null = null;
  async function lakehouseContext() {
    if (lakeCache && Date.now() - lakeCache.at < 600_000) return lakeCache.data;
    const [trend, strategy, decisions] = await Promise.all([
      execWarehouseSql<{ month: string; churn_rate_pct: string; churned: string }>(
        `SELECT cast(month AS STRING) AS month, round(100 * sum(churned) / sum(active_start), 2) AS churn_rate_pct,
                sum(churned) AS churned FROM ${fq('gold_churn_monthly')} GROUP BY month ORDER BY month`,
      ),
      execWarehouseSql<{ offer_strategy: string; offers: string; save_rate_pct: string; avg_cost: string }>(
        `SELECT offer_strategy, count(*) AS offers, round(100 * avg(CAST(saved AS INT)), 1) AS save_rate_pct,
                round(avg(offer_cost), 0) AS avg_cost
         FROM ${fq('retention_offer_history')} WHERE offer_date >= '2026-08-01' GROUP BY 1 ORDER BY 3 DESC`,
      ),
      execWarehouseSql<{ n: string }>(`SELECT count(*) AS n FROM ${fq('retention_decisions')}`),
    ]);
    lakeCache = { at: Date.now(), data: { trend, strategy, lakehouseDecisions: Number(decisions[0]?.n ?? 0) } };
    return lakeCache.data;
  }

  app.get('/api/kpis', async (_req, res) => {
    const [desk, lake] = await Promise.all([
      deskKpis(db),
      lakehouseContext().catch((e: Error) => ({ error: e.message })),
    ]);
    res.json({ desk, lake });
  });

  app.get('/api/whatif', async (req, res) => {
    const tiers = (q(req.query.tiers) ?? 'Critical,High').split(',');
    const contactRate = Math.max(0, Math.min(1, Number(req.query.contactRate ?? 0.6)));
    const [matched, blanket] = await Promise.all([
      whatIf(db, { tiers, contactRate, strategy: 'matched' }),
      whatIf(db, { tiers, contactRate, strategy: 'blanket' }),
    ]);
    res.json({ tiers, contactRate, matched, blanket });
  });
}
