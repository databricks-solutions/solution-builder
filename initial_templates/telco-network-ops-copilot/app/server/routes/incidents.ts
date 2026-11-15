import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { closeExplained, getIncident, incidentSummary, listIncidents, listTroubleTickets, openTroubleTicket, saveTriage } from '../db/queries/index.js';
import { execSql, type DataConfig } from '../db/sync.js';
import type { Dispatch, PlanAction } from '../db/schema.js';
import { ACTION_CATALOG, triageIncident } from '../services/triage.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * NOC workbench routes.
 *   GET  /api/incidents                 correlated incident queue (Lakebase)
 *   GET  /api/incidents/summary         KPI counts
 *   GET  /api/incidents/:id             incident + latest triage + trouble ticket
 *   GET  /api/incidents/:id/evidence    raw evidence from Delta (SQL warehouse): blast radius / KPI trend + alarms
 *   POST /api/incidents/:id/triage      SSE — run the triage agent (topology → root cause → impact → plan → dispatch)
 *   POST /api/incidents/:id/ticket      write-back: open the parent trouble ticket with the selected actions + dispatches
 *   POST /api/incidents/:id/close       write-back: close as explained with the engineer's note
 *   GET  /api/tickets                   trouble tickets opened from the workbench
 */
export function registerIncidentRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; genieSpaceId: () => Promise<string>; triageModel: string },
): void {
  const { db } = deps;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  app.get('/api/incidents', async (req, res) => {
    res.json(await listIncidents(db, { status: str(req.query.status) ?? 'all', q: str(req.query.q) }));
  });
  app.get('/api/incidents/summary', async (_req, res) => {
    res.json(await incidentSummary(db));
  });
  app.get('/api/tickets', async (_req, res) => {
    res.json(await listTroubleTickets(db));
  });
  app.get('/api/action-catalog', (_req, res) => {
    res.json(ACTION_CATALOG);
  });

  app.get('/api/incidents/:id', async (req, res) => {
    const l = await getIncident(db, req.params.id);
    if (!l) {
      res.status(404).json({ error: 'incident not found' });
      return;
    }
    res.json(l);
  });

  /** Every cell site with its coordinates + live state (read-only) — feeds the NOC wall map. */
  app.get('/api/network/sites', async (_req, res) => {
    if (!deps.data) {
      res.json([]);
      return;
    }
    const fq = (t: string) => `${deps.data!.catalog}.${deps.data!.schema}.${t}`;
    const rows = await execSql<Record<string, unknown>>(process.env.DATABRICKS_WAREHOUSE_ID ?? '', `SELECT g.site_id, g.site_name, s.city, s.market, s.latitude, s.longitude, s.agg_router_id, g.is_down, g.active_alarms, g.active_critical_alarms, g.subscribers_served
      FROM ${fq('gold_site_status')} g JOIN ${fq('cell_sites')} s ON s.site_id = g.site_id ORDER BY g.site_id`);
    res.json(rows.map((r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude), is_down: String(r.is_down) === 'true', active_alarms: Number(r.active_alarms), active_critical_alarms: Number(r.active_critical_alarms), subscribers_served: Number(r.subscribers_served) })));
  });

  app.get('/api/incidents/:id/evidence', async (req, res) => {
    const l = await getIncident(db, req.params.id);
    if (!l || !deps.data) {
      res.status(404).json({ error: 'incident not found' });
      return;
    }
    const fq = (t: string) => `${deps.data!.catalog}.${deps.data!.schema}.${t}`;
    const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
    const NOW = `(SELECT max(ts) FROM ${fq('silver_optics')})`;
    const alarmsSql = (where: string) => `SELECT CAST(raised_ts AS STRING) ts, CAST(cleared_ts AS STRING) cleared, node_id, coalesce(cell_id, interface, '') detail, alarm_name, severity
      FROM ${fq('silver_alarms')} WHERE ${where} AND raised_ts > ${NOW} - INTERVAL 24 HOURS AND severity IN ('critical','major','warning') ORDER BY raised_ts DESC LIMIT 80`;
    if (l.incidentType === 'alarm_storm') {
      const p = [{ name: 'r', value: l.suspectedNodeId, type: 'STRING' }];
      const linksSql = `WITH l AS (SELECT * FROM ${fq('transport_links')} WHERE a_node = :r OR z_node = :r)
        SELECT l.link_id, l.a_node, l.z_node, l.link_type, l.role, l.capacity_gbps, l.span_km, o.rx_power_dbm, o.oper_status, o.ts
        FROM l LEFT JOIN (SELECT link_id, max_by(rx_power_dbm, ts) AS rx_power_dbm, max_by(oper_status, ts) AS oper_status, CAST(max(ts) AS STRING) AS ts FROM ${fq('silver_optics')} GROUP BY link_id) o ON o.link_id = l.link_id
        ORDER BY l.role, l.link_id`;
      const [sites, links, alarms] = await Promise.all([
        execSql<Record<string, unknown>>(wh, `SELECT g.site_id, g.site_name, s.city, s.latitude, s.longitude, g.is_down, g.backhaul_type, g.subscribers_served, g.critical_facility, g.active_alarms, g.active_critical_alarms FROM ${fq('gold_site_status')} g JOIN ${fq('cell_sites')} s ON s.site_id = g.site_id WHERE g.agg_router_id = :r ORDER BY g.site_id`, p),
        execSql<Record<string, unknown>>(wh, linksSql, p),
        execSql<Record<string, unknown>>(wh, alarmsSql(`(agg_router_id = :r OR node_type = 'core_router')`), p),
      ]);
      res.json({
        kind: 'storm',
        sites: sites.map((s) => ({ ...s, latitude: Number(s.latitude), longitude: Number(s.longitude), is_down: String(s.is_down) === 'true', subscribers_served: Number(s.subscribers_served), active_alarms: Number(s.active_alarms), active_critical_alarms: Number(s.active_critical_alarms) })),
        links: links.map((k) => ({ ...k, capacity_gbps: Number(k.capacity_gbps), span_km: Number(k.span_km), rx_power_dbm: k.rx_power_dbm == null ? null : Number(k.rx_power_dbm) })),
        alarms,
        trend: [],
      });
      return;
    }
    const site = l.suspectedNodeId;
    const p = [{ name: 's', value: site, type: 'STRING' }];
    const [trend, alarms] = await Promise.all([
      execSql<Record<string, unknown>>(wh, `SELECT CAST(day AS STRING) d, sector, drop_call_rate_pct, max_vswr, rrc_setup_success_pct, ul_interference_dbm, peak_prb_utilization_pct, availability_pct
        FROM ${fq('gold_cell_kpi_daily')} WHERE site_id = :s AND day > (SELECT max(day) FROM ${fq('gold_cell_kpi_daily')}) - 21 ORDER BY day, sector`, p),
      execSql<Record<string, unknown>>(wh, alarmsSql(`site_id = :s`), p),
    ]);
    res.json({ kind: 'kpi', sites: [], alarms, trend: trend.map((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === 'd' || k === 'sector' ? v : v == null ? null : Number(v)]))) });
  });

  app.post('/api/incidents/:id/triage', async (req, res) => {
    const l = await getIncident(db, req.params.id);
    if (!l) {
      res.status(404).json({ error: 'incident not found' });
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
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    try {
      const tr = await triageIncident(req, {
        id: l.id, incidentType: l.incidentType, title: l.title, market: l.market, suspectedNodeId: l.suspectedNodeId, cellId: l.cellId,
        siteIds: l.siteIds, sitesAffected: l.sitesAffected, subscribersServed: l.subscribersServed, alarmCount: l.alarmCount, activeAlarms: l.activeAlarms,
        alarmTypes: l.alarmTypes, topFactors: l.topFactors, anomalyScore: l.anomalyScore, suggestedPriority: l.suggestedPriority, detectedTs: l.detectedTs,
      }, { data: deps.data, genieSpaceId: await deps.genieSpaceId(), model: deps.triageModel, onStep: (e) => send('step', e) });
      await saveTriage(db, l.id, tr, getCurrentUserEmail(req));
      send('result', { triage: tr });
    } catch (e) {
      console.error('[triage] failed', e);
      send('error', { message: (e as Error).message });
    } finally {
      clearInterval(ping);
    }
    res.end();
  });

  app.post('/api/incidents/:id/ticket', express.json(), async (req, res) => {
    const b = (req.body ?? {}) as { priority?: string; title?: string; actions?: PlanAction[]; dispatches?: Dispatch[]; notes?: string };
    if (!b.priority || !/^P[1-4]$/.test(b.priority) || !b.title) {
      res.status(400).json({ error: 'priority (P1..P4) and title are required' });
      return;
    }
    const actions = (b.actions ?? []).filter((c) => ACTION_CATALOG[c.code]);
    const out = await openTroubleTicket(db, {
      incidentId: req.params.id, priority: b.priority, title: b.title.slice(0, 200), actions, dispatches: (b.dispatches ?? []).slice(0, 8),
      notes: b.notes ?? null, userEmail: getCurrentUserEmail(req),
    });
    if (!out) {
      res.status(404).json({ error: 'incident not found' });
      return;
    }
    res.json(out);
  });

  app.post('/api/incidents/:id/close', express.json(), async (req, res) => {
    const b = (req.body ?? {}) as { notes?: string };
    const out = await closeExplained(db, { incidentId: req.params.id, notes: b.notes ?? null, userEmail: getCurrentUserEmail(req) });
    if (!out) {
      res.status(404).json({ error: 'incident not found' });
      return;
    }
    res.json(out);
  });
}
