import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { incidents } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the open NOC incident queue.
 *
 * Delta (<catalog>.<schema>) holds the telemetry (SDP pipeline), the KPI anomaly scores and the
 * correlated incident queue (noc_incidents); the workbench mirrors the queue into Lakebase, where
 * the AI triage, the engineer's decisions and the trouble tickets are written. Idempotent: skips
 * when app.incidents has rows, unless `forceIfAnyEmpty` (the "Reset demo" button). The triage agent
 * itself queries the Delta telemetry live through the SQL warehouse (execSql below).
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: { incidents: string };
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const arr = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string' && v.startsWith('[')) {
    try {
      return JSON.parse(v) as T[];
    } catch {
      return [];
    }
  }
  return [];
};
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function syncFromDelta(db: AppDb, cfg: DataConfig, opts: { forceIfAnyEmpty?: boolean } = {}): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.incidents`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  const t0 = Date.now();
  const rows = await execSql<Record<string, unknown>>(
    warehouseId,
    `SELECT incident_id, incident_type, title, market, suspected_node_id, suspected_node_type, cell_id,
            CAST(detected_ts AS STRING) detected_ts, CAST(first_alarm_ts AS STRING) first_alarm_ts, CAST(last_alarm_ts AS STRING) last_alarm_ts,
            CAST(first_flagged_day AS STRING) first_flagged_day, sites_affected, to_json(site_ids) site_ids, subscribers_served,
            to_json(enterprise_accounts) enterprise_accounts, to_json(critical_facilities) critical_facilities,
            alarm_count, critical_alarms, active_alarms, transport_alarms, to_json(alarm_types) alarm_types, to_json(alarm_ids) alarm_ids,
            anomaly_score, to_json(top_factors) top_factors, suggested_priority
     FROM ${cfg.catalog}.${cfg.schema}.${cfg.tables.incidents} WHERE status = 'open'`,
  );
  if (rows.length) {
    await db.insert(incidents).values(rows.map((r) => ({
      id: String(r.incident_id),
      incidentType: String(r.incident_type),
      title: String(r.title),
      market: s(r.market),
      suspectedNodeId: String(r.suspected_node_id),
      suspectedNodeType: String(r.suspected_node_type),
      cellId: s(r.cell_id),
      detectedTs: s(r.detected_ts),
      firstAlarmTs: s(r.first_alarm_ts),
      lastAlarmTs: s(r.last_alarm_ts),
      firstFlaggedDay: s(r.first_flagged_day),
      sitesAffected: num(r.sites_affected) ?? 0,
      siteIds: arr<string>(r.site_ids),
      subscribersServed: num(r.subscribers_served) ?? 0,
      enterpriseAccounts: arr<string>(r.enterprise_accounts),
      criticalFacilities: arr<string>(r.critical_facilities),
      alarmCount: num(r.alarm_count) ?? 0,
      criticalAlarms: num(r.critical_alarms) ?? 0,
      activeAlarms: num(r.active_alarms) ?? 0,
      transportAlarms: num(r.transport_alarms) ?? 0,
      alarmTypes: arr<string>(r.alarm_types),
      alarmIds: arr<string>(r.alarm_ids),
      anomalyScore: num(r.anomaly_score),
      topFactors: arr<string>(r.top_factors),
      suggestedPriority: String(r.suggested_priority),
    }))).onConflictDoNothing();
  }
  console.log(`[sync] mirrored ${rows.length} open incidents in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.trouble_tickets RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.incidents RESTART IDENTITY CASCADE`);
  });
}

export type SqlParam = { name: string; value: string; type?: string };

export async function execSql<T>(
  warehouseId: string,
  statement: string,
  parameters: SqlParam[] = [],
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      ...(parameters.length ? { parameters } : {}),
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  // Cap total polling at 10 minutes. The warehouse can take a couple of
  // minutes to spin from idle + scan, but a state stuck in RUNNING beyond
  // 10 min is broken — fail loud instead of silently blocking boot forever.
  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

