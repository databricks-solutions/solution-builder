import { randomUUID } from 'node:crypto';
import { execSql } from '../db/sync.js';

/**
 * Best-effort write-back of workbench decisions to the Delta table
 * `<catalog>.<schema>.um_decisions` (created by src/deploy/build_metric_view.sql),
 * so the AI/BI dashboard and Genie see what the nurses + auto-approval rule did.
 * Runs as the app service principal (needs MODIFY on um_decisions). Never throws —
 * Lakebase is the system of record for the UI; Delta is the analytics copy.
 */
export type DecisionRecord = {
  requestId: string;
  decision: string;
  decidedBy: string;
  aiRecommendation: string | null;
  agreedWithAi: boolean | null;
  note: string | null;
};

const esc = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);

export function writeDecisionsToDelta(catalog: string, schema: string, rows: DecisionRecord[]): void {
  const wh = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!wh || !catalog || !schema || rows.length === 0) return;
  const values = rows
    .map(
      (r) =>
        `(${esc(randomUUID())}, ${esc(r.requestId)}, ${esc(r.decision)}, ${esc(r.decidedBy)}, TIMESTAMP ${esc(new Date().toISOString())}, ${esc(r.aiRecommendation)}, ${r.agreedWithAi === null ? 'NULL' : r.agreedWithAi}, ${esc(r.note)})`,
    )
    .join(',\n');
  const stmt = `INSERT INTO ${catalog}.${schema}.um_decisions (decision_id, request_id, decision, decided_by, decided_at, ai_recommendation, agreed_with_ai, note) VALUES ${values}`;
  execSql(wh, stmt)
    .then(() => console.log(`[writeback] ${rows.length} decision(s) → ${catalog}.${schema}.um_decisions`))
    .catch((e) => console.error('[writeback] Delta insert failed (UI unaffected):', (e as Error).message));
}

export function clearDeltaDecisions(catalog: string, schema: string): Promise<unknown> {
  const wh = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!wh || !catalog || !schema) return Promise.resolve();
  return execSql(wh, `DELETE FROM ${catalog}.${schema}.um_decisions`).catch((e) =>
    console.error('[writeback] clear failed:', (e as Error).message),
  );
}
