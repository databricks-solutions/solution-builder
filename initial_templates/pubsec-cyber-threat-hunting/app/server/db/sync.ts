import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { leads } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the open UEBA lead queue.
 *
 * Delta (cybersecurity.threat_hunting_copilot) holds 90 days of telemetry and the
 * UEBA scores; the workbench mirrors the open leads (investigation_leads) into
 * Lakebase, where the analyst's investigations, dispositions and incident cases are
 * written. Idempotent: skips when app.leads has rows, unless `forceIfAnyEmpty`
 * (the "Reset demo" button). The investigation agent itself queries the Delta logs
 * live through the SQL warehouse (execSql below).
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: { leads: string };
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

export async function syncFromDelta(db: AppDb, cfg: DataConfig, opts: { forceIfAnyEmpty?: boolean } = {}): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.leads`);
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
    `SELECT lead_id, entity_type, entity_id, display_name, department, role, risk_score, priority,
            to_json(top_factors) AS top_factors, to_json(risk_trend) AS risk_trend, CAST(first_flagged AS STRING) AS first_flagged,
            linked_alerts, alerts_closed_fp
     FROM ${cfg.catalog}.${cfg.schema}.${cfg.tables.leads} WHERE status = 'open'`,
  );
  if (rows.length) {
    await db.insert(leads).values(rows.map((r) => ({
      id: String(r.lead_id),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      displayName: String(r.display_name),
      department: (r.department as string) ?? null,
      role: (r.role as string) ?? null,
      riskScore: num(r.risk_score) ?? 0,
      priority: String(r.priority),
      topFactors: arr<string>(r.top_factors),
      riskTrend: arr<number>(r.risk_trend).map(Number),
      firstFlagged: (r.first_flagged as string) ?? null,
      linkedAlerts: num(r.linked_alerts) ?? 0,
      alertsClosedFp: num(r.alerts_closed_fp) ?? 0,
    }))).onConflictDoNothing();
  }
  console.log(`[sync] mirrored ${rows.length} open leads in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.incident_cases RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.leads RESTART IDENTITY CASCADE`);
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

