/**
 * Live-ops console REST API.
 *
 *   GET  /api/segments                  at-risk segments (filters: driver, region, status)
 *   GET  /api/segments/:id              one segment + the plan engine over every intervention
 *   POST /api/segments/:id/decision     schedule / send back → Lakebase (live) + Delta write-back (liveops_schedule)
 *   GET  /api/kpis                      console KPIs (Lakebase) + retention / ARPDAU / history context (warehouse, cached)
 *   GET  /api/whatif?budget=            budget what-if (copilot plan vs blanket gem sale)
 */
import type { Application } from 'express';
import type { AppDb } from '../db/index.js';
import {
  consoleKpis,
  decidePlan,
  evaluateSegment,
  listSegments,
  whatIf,
} from '../db/queries/index.js';
import { execWarehouseSql } from '../db/sync.js';
import { getCurrentUserInfo } from '../lib/user.js';

type Deps = { db: AppDb; catalog: string; schema: string };

export function registerLiveOpsRoutes(app: Application, deps: Deps): void {
  const { db } = deps;
  const fq = (t: string) => `\`${deps.catalog}\`.\`${deps.schema}\`.${t}`;
  const q = (v: unknown) => (typeof v === 'string' && v ? v : null);

  app.get('/api/segments', async (req, res) => {
    const rows = await listSegments(db, {
      driver: q(req.query.driver),
      region: q(req.query.region),
      status: q(req.query.status),
      limit: Math.min(Number(req.query.limit ?? 100), 500),
    });
    res.json(rows.map(({ auditTrail: _a, chatSample: _c, topPlayers, ...r }) => ({ ...r, topPlayer: topPlayers[0] ?? null })));
  });

  app.get('/api/segments/:id', async (req, res) => {
    const ev = await evaluateSegment(db, req.params.id);
    if (!ev) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ ...ev.segment, budget: ev.budget, interventions: ev.interventions });
  });

  app.post('/api/segments/:id/decision', async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'scheduled' && decision !== 'rejected') {
      res.status(400).json({ error: 'decision must be scheduled | rejected' });
      return;
    }
    const info = getCurrentUserInfo(req);
    const user = info.userEmail ?? info.userName ?? 'live-ops.lead';
    let result;
    try {
      result = await decidePlan(db, { segmentId: req.params.id, decision, userEmail: user });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
      return;
    }
    const { segment: s, plan } = result;
    // Write-back to the lakehouse so the live-ops dashboard + Genie see the scheduled intervention.
    let deltaWriteBack: 'ok' | 'skipped' | string = 'skipped';
    if (decision === 'scheduled') {
      try {
        await execWarehouseSql(
          `INSERT INTO ${fq('liveops_schedule')} SELECT uuid(), current_timestamp(), :sid, :driver, :region, :code, :name,
             CAST(:start AS DATE), CAST(:players AS INT), :cost, CAST(:retained AS INT), :ltv, :msg, :why, :by`,
          [
            { name: 'sid', value: plan.coveredSegments.join(',') },
            { name: 'driver', value: s.churnDriver },
            { name: 'region', value: plan.coveredSegments.length > 1 ? 'ALL' : s.region },
            { name: 'code', value: plan.interventionCode },
            { name: 'name', value: plan.interventionName },
            { name: 'start', value: plan.startDate },
            { name: 'players', value: String(plan.playersTargeted) },
            { name: 'cost', value: String(plan.cost), type: 'DOUBLE' },
            { name: 'retained', value: String(plan.expectedPlayersRetained) },
            { name: 'ltv', value: String(plan.expectedLtvRetained), type: 'DOUBLE' },
            { name: 'msg', value: plan.playerMessage },
            { name: 'why', value: plan.rationale },
            { name: 'by', value: user },
          ],
        );
        deltaWriteBack = 'ok';
        lakeCache = null;
      } catch (e) {
        deltaWriteBack = (e as Error).message;
        console.error('[decision] Delta write-back failed:', deltaWriteBack);
      }
    }
    res.json({ segment: s, deltaWriteBack });
  });

  // Warehouse-backed context (static between data refreshes) — cached 10 min.
  let lakeCache: { at: number; data: unknown } | null = null;
  async function lakehouseContext() {
    if (lakeCache && Date.now() - lakeCache.at < 600_000) return lakeCache.data;
    const [d7Trend, retention, arpdau, strategy, scheduled] = await Promise.all([
      execWarehouseSql<{ week: string; d7_pct: string }>(
        `SELECT cast(date_trunc('WEEK', install_date) AS STRING) AS week, round(100 * sum(d7_retained) / sum(installs), 1) AS d7_pct
         FROM ${fq('gold_retention_cohorts')} WHERE d7_retained IS NOT NULL AND install_date >= DATE'2026-05-04'
         GROUP BY 1 ORDER BY 1`,
      ),
      execWarehouseSql<{ period: string; d1: string; d7: string; d30: string }>(
        `SELECT CASE WHEN install_season = 'Season 7' THEN 'post' ELSE 'pre' END AS period,
                round(100 * sum(d1_retained) / sum(CASE WHEN d1_retained IS NOT NULL THEN installs END), 1) AS d1,
                round(100 * sum(d7_retained) / sum(CASE WHEN d7_retained IS NOT NULL THEN installs END), 1) AS d7,
                round(100 * sum(d30_retained) / sum(CASE WHEN d30_retained IS NOT NULL THEN installs END), 1) AS d30
         FROM ${fq('gold_retention_cohorts')} WHERE install_date >= DATE'2026-06-09' GROUP BY 1`,
      ),
      execWarehouseSql<{ period: string; arpdau: string; dau: string }>(
        `SELECT CASE WHEN activity_date >= DATE'2026-08-25' THEN 'post' ELSE 'pre' END AS period,
                round(sum(revenue_usd) / sum(dau), 3) AS arpdau, round(sum(dau) / count(DISTINCT activity_date), 0) AS dau
         FROM ${fq('gold_daily_kpis')}
         WHERE activity_date BETWEEN DATE'2026-07-14' AND DATE'2026-08-10' OR activity_date BETWEEN DATE'2026-08-25' AND DATE'2026-09-27'
         GROUP BY 1`,
      ),
      execWarehouseSql<{ strategy: string; runs: string; avg_lift_pp: string; cost_per_retained: string }>(
        `SELECT strategy, count(*) AS runs, round(avg(lift_pp), 1) AS avg_lift_pp,
                round(sum(cost_usd) / sum(players_retained_incremental), 2) AS cost_per_retained
         FROM ${fq('liveops_history')} GROUP BY 1 ORDER BY 3 DESC`,
      ),
      execWarehouseSql<{ n: string }>(`SELECT count(*) AS n FROM ${fq('liveops_schedule')}`),
    ]);
    lakeCache = { at: Date.now(), data: { d7Trend, retention, arpdau, strategy, lakehouseScheduled: Number(scheduled[0]?.n ?? 0) } };
    return lakeCache.data;
  }

  app.get('/api/kpis', async (_req, res) => {
    const [live, lake] = await Promise.all([
      consoleKpis(db),
      lakehouseContext().catch((e: Error) => ({ error: e.message })),
    ]);
    res.json({ live, lake });
  });

  app.get('/api/whatif', async (req, res) => {
    const b = Math.max(0, Math.min(200_000, Number(req.query.budget ?? 12000)));
    res.json(await whatIf(db, { budget: b }));
  });
}
