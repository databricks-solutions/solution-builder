import express, { type Application } from 'express';
import type { AppDb } from '../db/index.js';
import { closeLeadBenign, getLead, leadSummary, listIncidentCases, listLeads, openIncidentCase, saveInvestigation } from '../db/queries/index.js';
import { execSql, type DataConfig } from '../db/sync.js';
import type { ContainmentAction } from '../db/schema.js';
import { CONTAINMENT_CATALOG, investigateLead } from '../services/investigate.js';
import { resolvedBackends } from '../services/resources.js';
import { getCurrentUserEmail } from '../lib/user.js';

/**
 * SOC analyst workbench routes.
 *   GET  /api/leads                 open UEBA lead queue (Lakebase)
 *   GET  /api/leads/summary         KPI counts
 *   GET  /api/leads/:id             lead + latest investigation + incident case
 *   GET  /api/leads/:id/evidence    raw evidence for the entity (Delta, via the SQL warehouse): UEBA 14-day trend + recent events
 *   POST /api/leads/:id/investigate SSE — run the investigation agent (pivots → playbook → timeline / ATT&CK / containment)
 *   POST /api/leads/:id/case        write-back: open the incident case with the selected containment actions
 *   POST /api/leads/:id/close       write-back: close as benign with the analyst's note
 *   GET  /api/cases                 incident cases opened from the workbench
 */
export function registerLeadRoutes(
  app: Application,
  deps: { db: AppDb; data: DataConfig | undefined; genieSpaceId: string; investigationModel: string },
): void {
  const { db } = deps;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  app.get('/api/leads', async (req, res) => {
    res.json(await listLeads(db, { status: str(req.query.status) ?? 'all', q: str(req.query.q) }));
  });
  app.get('/api/leads/summary', async (_req, res) => {
    res.json(await leadSummary(db));
  });
  app.get('/api/cases', async (_req, res) => {
    res.json(await listIncidentCases(db));
  });
  app.get('/api/containment-catalog', (_req, res) => {
    res.json(CONTAINMENT_CATALOG);
  });

  app.get('/api/leads/:id', async (req, res) => {
    const l = await getLead(db, req.params.id);
    if (!l) {
      res.status(404).json({ error: 'lead not found' });
      return;
    }
    res.json(l);
  });

  app.get('/api/leads/:id/evidence', async (req, res) => {
    const l = await getLead(db, req.params.id);
    if (!l || !deps.data) {
      res.status(404).json({ error: 'lead not found' });
      return;
    }
    const fq = (t: string) => `${deps.data!.catalog}.${deps.data!.schema}.${t}`;
    const wh = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
    const p = [{ name: 'e', value: l.entityId, type: 'STRING' }];
    const isUser = l.entityType === 'user';
    const [trend, events] = await Promise.all([
      execSql<Record<string, unknown>>(wh, `SELECT CAST(score_date AS STRING) d, risk_score FROM ${fq(isUser ? 'ueba_user_daily' : 'ueba_host_daily')}
        WHERE ${isUser ? 'user_id' : 'host_id'} = :e AND score_date > (SELECT date_sub(max(score_date), 21) FROM ${fq(isUser ? 'ueba_user_daily' : 'ueba_host_daily')}) ORDER BY score_date`, p),
      isUser
        ? execSql<Record<string, unknown>>(wh, `SELECT * FROM (
            SELECT CAST(event_ts AS STRING) ts, 'auth' src, concat(application, ' · ', result, coalesce(concat(' (', failure_reason, ')'), ''), ' · ', src_ip, ' ', asn_org, ', ', geo_country) detail
              FROM ${fq('auth_logs')} WHERE user_id = :e
            UNION ALL SELECT CAST(session_start AS STRING), 'vpn', concat('VPN ', src_ip, ' ', asn_org, ' · device ', device_id, IF(device_managed, ' (managed)', ' (UNMANAGED)'))
              FROM ${fq('vpn_sessions')} WHERE user_id = :e
            UNION ALL SELECT CAST(event_ts AS STRING), 'endpoint', concat(event_type, ' on ', host_id, coalesce(concat(' · ', command_line), ''), coalesce(concat(' · ', file_count, ' files'), ''), IF(logon_type = 10, ' · RDP', ''))
              FROM ${fq('endpoint_events')} WHERE user_id = :e AND (event_type <> 'process_start' OR command_line IS NOT NULL)
          ) ORDER BY ts DESC LIMIT 60`, p)
        : execSql<Record<string, unknown>>(wh, `SELECT * FROM (
            SELECT CAST(event_ts AS STRING) ts, 'dns' src, concat(query_type, ' ', query) detail FROM ${fq('dns_logs')} WHERE host_id = :e AND label_entropy > 3.5
            UNION ALL SELECT CAST(event_ts AS STRING), 'endpoint', concat(event_type, ' by ', coalesce(user_id, '?'), coalesce(concat(' · ', command_line), ''), coalesce(concat(' · ', file_path), ''), IF(logon_type = 10, concat(' · RDP from ', coalesce(src_ip, src_host)), ''))
              FROM ${fq('endpoint_events')} WHERE host_id = :e AND (event_type <> 'process_start' OR command_line IS NOT NULL)
          ) ORDER BY ts DESC LIMIT 60`, p),
    ]);
    res.json({ trend: trend.map((t) => ({ d: t.d, risk: Number(t.risk_score) })), events });
  });

  app.post('/api/leads/:id/investigate', async (req, res) => {
    const l = await getLead(db, req.params.id);
    if (!l) {
      res.status(404).json({ error: 'lead not found' });
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
      const inv = await investigateLead(req, { id: l.id, entityType: l.entityType, entityId: l.entityId, displayName: l.displayName, riskScore: l.riskScore, topFactors: l.topFactors }, {
        data: deps.data, genieSpaceId: deps.genieSpaceId || (await resolvedBackends()).genieSpaceId, model: deps.investigationModel, onStep: (e) => send('step', e),
      });
      await saveInvestigation(db, l.id, inv, getCurrentUserEmail(req));
      send('result', { investigation: inv });
    } catch (e) {
      console.error('[investigate] failed', e);
      send('error', { message: (e as Error).message });
    } finally {
      clearInterval(ping);
    }
    res.end();
  });

  app.post('/api/leads/:id/case', express.json(), async (req, res) => {
    const b = (req.body ?? {}) as { severity?: string; title?: string; containment?: ContainmentAction[]; notes?: string };
    if (!b.severity || !/^SEV-[1-4]$/.test(b.severity) || !b.title) {
      res.status(400).json({ error: 'severity (SEV-1..4) and title are required' });
      return;
    }
    const containment = (b.containment ?? []).filter((c) => CONTAINMENT_CATALOG[c.code]);
    const out = await openIncidentCase(db, { leadId: req.params.id, severity: b.severity, title: b.title.slice(0, 200), containment, notes: b.notes ?? null, userEmail: getCurrentUserEmail(req) });
    if (!out) {
      res.status(404).json({ error: 'lead not found' });
      return;
    }
    res.json(out);
  });

  app.post('/api/leads/:id/close', express.json(), async (req, res) => {
    const b = (req.body ?? {}) as { notes?: string };
    const out = await closeLeadBenign(db, { leadId: req.params.id, notes: b.notes ?? null, userEmail: getCurrentUserEmail(req) });
    if (!out) {
      res.status(404).json({ error: 'lead not found' });
      return;
    }
    res.json(out);
  });
}
