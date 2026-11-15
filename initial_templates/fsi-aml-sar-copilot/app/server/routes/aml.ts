/**
 * AML investigator REST API — queue, case file, network graph, SAR agent (SSE),
 * decisions + audit trail written back to Delta.
 */
import express, { type Application, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { query, T, CATALOG, SCHEMA, host, type Row } from '../lib/sql.js';
import { runSarAgent, getCaseContext } from '../agent/sar-agent.js';
import { ensureResources } from '../lib/resources.js';

export function userOf(req: Request): string {
  return (
    (req.header('x-forwarded-email') as string | undefined) ||
    process.env.LOCAL_USER_EMAIL ||
    'investigator@northwind-federal.demo'
  );
}

export async function audit(alertId: string, eventType: string, actor: string, detail: string): Promise<void> {
  await query(
    `INSERT INTO ${T('case_audit_log')} VALUES (:id, :alert, :type, :actor, :detail, current_timestamp())`,
    [
      { name: 'id', value: randomUUID() },
      { name: 'alert', value: alertId },
      { name: 'type', value: eventType },
      { name: 'actor', value: actor },
      { name: 'detail', value: detail.slice(0, 4000) },
    ],
  );
}

// latest decision per alert (a decision on a network case covers every related alert)
const DECIDED = () => `
  SELECT alert_id, decision, decided_ts, decided_by FROM (
    SELECT explode(array_union(array(alert_id), coalesce(related_alert_ids, array()))) AS alert_id,
           decision, decided_ts, decided_by,
           row_number() OVER (PARTITION BY decision_id ORDER BY decided_ts) AS _r
    FROM ${T('case_decisions')}
  ) QUALIFY row_number() OVER (PARTITION BY alert_id ORDER BY decided_ts DESC) = 1`;

export function registerAmlRoutes(app: Application): void {
  app.use('/api', express.json({ limit: '256kb' }));

  app.get('/api/config', async (req: Request, res: Response) => {
    await ensureResources();
    res.json({
      catalog: CATALOG,
      schema: SCHEMA,
      host: host(),
      dashboardId: process.env.DASHBOARD_ID ?? '',
      genieSpaceId: process.env.GENIE_SPACE_ID ?? '',
      agentModel: process.env.AGENT_MODEL ?? '',
      modelName: `${CATALOG}.${SCHEMA}.aml_alert_risk_model`,
      user: userOf(req),
    });
  });

  app.get('/api/queue', async (_req: Request, res: Response) => {
    const rows = await query(`
      WITH d AS (${DECIDED()})
      SELECT q.alert_id, q.customer_id, q.customer_name, q.customer_type, q.occupation_or_industry, q.kyc_risk_rating,
             q.scenario, q.alert_ts, q.status, q.rule_score, q.ml_risk_score, q.ml_rank, q.rules_rank, q.ml_risk_band,
             q.triggered_amount, q.cluster_id, q.cluster_size, q.age_days, q.reason_codes,
             d.decision, d.decided_by, d.decided_ts
      FROM ${T('gold_alert_queue')} q LEFT JOIN d USING (alert_id)
      ORDER BY q.ml_rank`);
    res.json({ alerts: rows });
  });

  app.get('/api/kpis', async (_req: Request, res: Response) => {
    const [k] = await query(`
      WITH d AS (${DECIDED()})
      SELECT count(*) AS open_alerts,
             sum(CASE WHEN q.ml_risk_score >= 70 AND d.decision IS NULL THEN 1 ELSE 0 END) AS critical_open,
             count(DISTINCT CASE WHEN q.cluster_size >= 3 AND q.ml_risk_score >= 70 THEN q.cluster_id END) AS critical_networks,
             sum(CASE WHEN d.decision IS NOT NULL THEN 1 ELSE 0 END) AS decided,
             sum(CASE WHEN q.age_days > 10 AND d.decision IS NULL THEN 1 ELSE 0 END) AS past_triage_sla,
             (SELECT round(avg(CASE WHEN status = 'closed_no_sar' THEN 1.0 ELSE 0 END), 3) FROM ${T('alerts')}
               WHERE status IN ('closed_no_sar', 'sar_filed')) AS fp_rate
      FROM ${T('gold_alert_queue')} q LEFT JOIN d USING (alert_id)`);
    res.json(k);
  });

  app.get('/api/alerts/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const ctx = await getCaseContext(id);
    if (!ctx) {
      res.status(404).json({ error: 'alert not found' });
      return;
    }
    const [audit_log, drafts, decisions] = await Promise.all([
      query(`SELECT event_type, actor, detail, event_ts FROM ${T('case_audit_log')} WHERE alert_id = :a ORDER BY event_ts DESC LIMIT 50`, [{ name: 'a', value: id }]),
      query(`SELECT draft_id, narrative, recommendation, red_flags, model, tool_calls, created_by, created_ts FROM ${T('sar_drafts')} WHERE alert_id = :a ORDER BY created_ts DESC LIMIT 1`, [{ name: 'a', value: id }]),
      query(`WITH d AS (${DECIDED()}) SELECT c.* FROM ${T('case_decisions')} c JOIN d ON d.decided_ts = c.decided_ts AND d.alert_id = :a ORDER BY c.decided_ts DESC LIMIT 1`, [{ name: 'a', value: id }]),
    ]);
    res.json({ ...ctx, audit_log, draft: drafts[0] ?? null, decision: decisions[0] ?? null });
  });

  app.get('/api/alerts/:id/activity', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [a] = await query(`SELECT customer_id, cluster_id, cluster_size FROM ${T('gold_alert_queue')} WHERE alert_id = :a
                             UNION ALL SELECT a.customer_id, n.cluster_id, n.cluster_size FROM ${T('alerts')} a JOIN ${T('gold_customer_network')} n USING (customer_id) WHERE a.alert_id = :a LIMIT 1`, [{ name: 'a', value: id }]);
    if (!a) {
      res.status(404).json({ error: 'alert not found' });
      return;
    }
    const scope = Number(a.cluster_size) >= 3
      ? `customer_id IN (SELECT customer_id FROM ${T('gold_customer_network')} WHERE cluster_id = :c)`
      : `customer_id = :cust`;
    const params = [{ name: 'c', value: String(a.cluster_id) }, { name: 'cust', value: String(a.customer_id) }];
    const [daily, txns] = await Promise.all([
      query(`SELECT date(txn_ts) AS day,
                    round(sum(CASE WHEN txn_type = 'cash_deposit' THEN amount ELSE 0 END), 2) AS cash_in,
                    sum(CASE WHEN cash_below_ctr THEN 1 ELSE 0 END) AS sub_ctr,
                    round(sum(CASE WHEN txn_type = 'wire_out' THEN amount ELSE 0 END), 2) AS wires_out
             FROM ${T('transactions')} WHERE ${scope} AND txn_ts >= (SELECT max(txn_ts) FROM ${T('transactions')}) - INTERVAL 60 DAYS
             GROUP BY 1 ORDER BY 1`, params),
      query(`SELECT t.txn_ts, t.customer_id, c.customer_name, t.txn_type, t.amount, t.branch_id, t.counterparty_name, t.counterparty_country, t.cash_below_ctr, t.high_risk_country
             FROM ${T('transactions')} t JOIN ${T('customers')} c USING (customer_id)
             WHERE t.${scope.replace('customer_id', 'customer_id')} AND t.txn_type IN ('cash_deposit','wire_out','internal_out','wire_in')
               AND t.txn_ts >= (SELECT max(txn_ts) FROM ${T('transactions')}) - INTERVAL 60 DAYS
             ORDER BY t.txn_ts DESC LIMIT 60`, params),
    ]);
    res.json({ daily, txns, scope: Number(a.cluster_size) >= 3 ? 'network' : 'customer' });
  });

  app.get('/api/network/:clusterId', async (req: Request, res: Response) => {
    const c = String(req.params.clusterId);
    const p = [{ name: 'c', value: c }];
    const [members, edges, beneficiaries, summary] = await Promise.all([
      query(`SELECT n.customer_id, cu.customer_name, cu.customer_type, cu.occupation_or_industry, cu.kyc_risk_rating, cu.onboarding_date, cu.address,
                    n.degree,
                    coalesce(sum(CASE WHEN t.txn_type = 'cash_deposit' THEN t.amount END), 0) AS cash_in_60d,
                    sum(CASE WHEN t.cash_below_ctr THEN 1 ELSE 0 END) AS sub_ctr_60d,
                    (SELECT count(*) FROM ${T('gold_alert_queue')} q WHERE q.customer_id = n.customer_id) AS open_alerts,
                    (SELECT max(ml_risk_score) FROM ${T('gold_alert_queue')} q WHERE q.customer_id = n.customer_id) AS max_ml_score,
                    (SELECT min(alert_id) FROM ${T('gold_alert_queue')} q WHERE q.customer_id = n.customer_id AND q.ml_rank = (SELECT min(ml_rank) FROM ${T('gold_alert_queue')} q2 WHERE q2.customer_id = n.customer_id)) AS top_alert_id
             FROM ${T('gold_customer_network')} n JOIN ${T('customers')} cu USING (customer_id)
             LEFT JOIN ${T('transactions')} t ON t.customer_id = n.customer_id AND t.txn_ts >= (SELECT max(txn_ts) FROM ${T('transactions')}) - INTERVAL 60 DAYS
             WHERE n.cluster_id = :c
             GROUP BY ALL`, p),
      query(`SELECT e.src, e.dst, e.edge_type, e.detail, e.amount, e.txn_count FROM ${T('gold_network_edges')} e
             WHERE e.src IN (SELECT customer_id FROM ${T('gold_customer_network')} WHERE cluster_id = :c)`, p),
      query(`SELECT t.customer_id AS src, t.counterparty_name AS name, t.counterparty_country AS country, count(*) AS wires, round(sum(t.amount), 2) AS amount
             FROM ${T('transactions')} t WHERE t.txn_type = 'wire_out' AND t.high_risk_country
               AND t.customer_id IN (SELECT customer_id FROM ${T('gold_customer_network')} WHERE cluster_id = :c)
             GROUP BY ALL`, p),
      query(`SELECT * FROM ${T('gold_network_clusters')} WHERE cluster_id = :c`, p),
    ]);
    res.json({ cluster_id: c, members, edges, beneficiaries, summary: summary[0] ?? null });
  });

  app.get('/api/networks', async (_req: Request, res: Response) => {
    res.json({ networks: await query(`SELECT * FROM ${T('gold_network_clusters')} WHERE open_alerts > 0 ORDER BY high_risk_wires_60d DESC, open_alerts DESC`) });
  });

  app.post('/api/alerts/:id/viewed', async (req: Request, res: Response) => {
    await audit(String(req.params.id), 'case_opened', userOf(req), 'Investigator opened the case file');
    res.json({ ok: true });
  });

  // SAR-drafting agent — Server-Sent Events stream of tool steps + final draft
  app.post('/api/alerts/:id/draft', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const user = userOf(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (ev: Record<string, unknown>) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 10000);
    try {
      await audit(id, 'agent_started', user, `SAR copilot started (${process.env.AGENT_MODEL})`);
      const draft = await runSarAgent(id, send);
      const draftId = randomUUID();
      await query(
        `INSERT INTO ${T('sar_drafts')} SELECT :id, :alert, :narr, :rec, from_json(:flags, 'array<string>'), :model, CAST(:calls AS INT), :user, current_timestamp()`,
        [
          { name: 'id', value: draftId },
          { name: 'alert', value: id },
          { name: 'narr', value: draft.narrative },
          { name: 'rec', value: draft.recommendation },
          { name: 'flags', value: JSON.stringify(draft.red_flags) },
          { name: 'model', value: draft.model },
          { name: 'calls', value: String(draft.tool_calls) },
          { name: 'user', value: user },
        ],
      );
      await audit(id, 'sar_drafted', `agent:${draft.model}`, `Draft ${draftId.slice(0, 8)} — ${draft.tool_calls} tool calls — recommendation: ${draft.recommendation}`);
      send({ type: 'done', draft: { ...draft, draft_id: draftId } });
    } catch (e) {
      console.error('[agent] failed', (e as Error).message);
      send({ type: 'error', message: (e as Error).message });
    } finally {
      clearInterval(ping);
      res.end();
    }
  });

  app.post('/api/alerts/:id/decision', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const user = userOf(req);
    const { decision, rationale, narrative } = req.body as { decision: string; rationale: string; narrative?: string };
    if (!['file_sar', 'close_no_sar', 'escalate'].includes(decision)) {
      res.status(400).json({ error: 'decision must be file_sar | close_no_sar | escalate' });
      return;
    }
    if (!rationale || rationale.trim().length < 10) {
      res.status(400).json({ error: 'a rationale of at least 10 characters is required (BSA audit trail)' });
      return;
    }
    const ctx = await getCaseContext(id);
    if (!ctx) {
      res.status(404).json({ error: 'alert not found' });
      return;
    }
    const alert = ctx.alert as Row;
    const related = ((ctx.network_alerts as Row[]) ?? []).map((r) => String(r.alert_id)).filter((a) => a !== id);
    const decisionId = `DEC-${Date.now().toString(36).toUpperCase()}`;
    const ref = decision === 'file_sar' ? `31000${Math.floor(1e9 + Math.random() * 9e9)}` : null;
    const amount = Number((ctx.network as Row | null)?.cash_in_60d ?? alert.triggered_amount ?? 0);
    await query(
      `INSERT INTO ${T('case_decisions')}
       SELECT :id, :alert, :cust, :cluster, from_json(:related, 'array<string>'), :decision, :rationale, :narr,
              CAST(:amount AS DOUBLE), :ref, :user, current_timestamp(), CAST(:det AS TIMESTAMP),
              datediff(current_timestamp(), CAST(:det AS TIMESTAMP))`,
      [
        { name: 'id', value: decisionId },
        { name: 'alert', value: id },
        { name: 'cust', value: String(alert.customer_id) },
        { name: 'cluster', value: String(alert.cluster_id ?? '') },
        { name: 'related', value: JSON.stringify(related) },
        { name: 'decision', value: decision },
        { name: 'rationale', value: rationale.slice(0, 4000) },
        { name: 'narr', value: (narrative ?? '').slice(0, 20000) },
        { name: 'amount', value: String(amount) },
        { name: 'ref', value: ref },
        { name: 'user', value: user },
        { name: 'det', value: String(alert.alert_ts) },
      ],
    );
    const label = { file_sar: 'SAR filed with FinCEN', close_no_sar: 'Closed — no SAR', escalate: 'Escalated to BSA Officer' }[decision];
    await audit(id, `decision_${decision}`, user, `${label}${ref ? ` (BSA ID ${ref})` : ''}; covers ${related.length + 1} alert(s). Rationale: ${rationale}`);
    res.json({ ok: true, decision_id: decisionId, bsa_filing_ref: ref, alerts_covered: related.length + 1 });
  });

  // Reset the demo: wipe the app's write-back tables (decisions, audit trail, SAR drafts). The queue is
  // derived from gold + case_decisions, so every alert is open again afterwards.
  app.post('/api/admin/reset', async (_req: Request, res: Response) => {
    for (const t of ['case_decisions', 'case_audit_log', 'sar_drafts']) await query(`DELETE FROM ${T(t)}`);
    res.json({ ok: true });
  });

  app.get('/api/decisions', async (_req: Request, res: Response) => {
    res.json({
      decisions: await query(`SELECT decision_id, alert_id, customer_id, cluster_id, size(related_alert_ids) + 1 AS alerts_covered, decision,
                                     rationale, bsa_filing_ref, decided_by, decided_ts, amount_involved
                              FROM ${T('case_decisions')} ORDER BY decided_ts DESC LIMIT 50`),
    });
  });
}
