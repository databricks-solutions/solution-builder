import { getExecutionContext } from '@databricks/appkit';

/**
 * Databricks SQL Statement Execution helper (SQL warehouse, app identity).
 * Reads the Delta gold tables and INSERTs the operator write-back row into
 * `operator_actions`. Values are passed as NAMED PARAMETERS (:name) — never
 * string-interpolated. Numeric/boolean columns are converted from the
 * JSON_ARRAY string encoding using the result manifest's type_name.
 */
type Param = { name: string; value: string | null; type?: string };
type StmtResp = {
  statement_id: string;
  status: { state: string; error?: { message: string } };
  manifest?: { schema: { columns: Array<{ name: string; type_name: string }> } };
  result?: { data_array?: Array<Array<string | null>>; next_chunk_index?: number };
};

const NUMERIC = new Set(['INT', 'LONG', 'BIGINT', 'SHORT', 'BYTE', 'DOUBLE', 'FLOAT', 'DECIMAL']);

export function fq(table: string): string {
  const c = process.env.DEMO_CATALOG || 'energy_utilities';
  const s = process.env.DEMO_SCHEMA || 'grid_operations_copilot';
  return `\`${c}\`.\`${s}\`.\`${table}\``;
}

export async function execSql<T = Record<string, unknown>>(
  statement: string,
  params: Record<string, string | number | boolean | null> = {},
): Promise<T[]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) throw new Error('DATABRICKS_WAREHOUSE_ID not set');
  const { client } = getExecutionContext();
  const parameters: Param[] = Object.entries(params).map(([name, v]) => ({
    name,
    value: v === null ? null : String(v),
    type: typeof v === 'number' ? (Number.isInteger(v) ? 'INT' : 'DOUBLE') : undefined,
  }));
  const req = (method: 'GET' | 'POST', path: string, payload?: unknown) =>
    client.apiClient.request({ method, path, payload, headers: new Headers(), raw: false, query: {} }) as Promise<StmtResp>;

  let cur = await req('POST', '/api/2.0/sql/statements', {
    statement, warehouse_id: warehouseId, parameters, wait_timeout: '30s',
    on_wait_timeout: 'CONTINUE', disposition: 'INLINE', format: 'JSON_ARRAY',
  });
  const t0 = Date.now();
  while (!['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED'].includes(cur.status.state)) {
    if (Date.now() - t0 > 180_000) throw new Error(`SQL timed out (${cur.statement_id})`);
    await new Promise((r) => setTimeout(r, 800));
    cur = await req('GET', `/api/2.0/sql/statements/${cur.statement_id}`);
  }
  if (cur.status.state !== 'SUCCEEDED') throw new Error(`SQL failed: ${cur.status.error?.message ?? cur.status.state}`);
  const cols = cur.manifest?.schema.columns ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const r of chunk.data_array ?? []) {
      const o: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        const v = r[i];
        o[c.name] = v === null || v === undefined ? null
          : NUMERIC.has(c.type_name) ? Number(v)
          : c.type_name === 'BOOLEAN' ? v === 'true'
          : v;
      });
      rows.push(o as T);
    }
    if (chunk.next_chunk_index == null) break;
    chunk = (await req('GET', `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`)) as StmtResp['result'];
  }
  return rows;
}
