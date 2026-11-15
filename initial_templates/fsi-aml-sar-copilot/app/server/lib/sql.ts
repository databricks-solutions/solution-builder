/**
 * Minimal SQL-warehouse client over the Statement Execution REST API.
 * Runs as the app's identity (service principal in Databricks Apps, the CLI
 * profile locally) — reads the demo tables and writes the investigator
 * decisions / audit trail back to Delta. Named parameters only (:name) —
 * never string-concatenate user input into SQL.
 */
import { getExecutionContext } from '@databricks/appkit';

export type Row = Record<string, unknown>;
export type Param = { name: string; value: string | number | null; type?: string };

export const CATALOG = process.env.DEMO_CATALOG || 'financial_services';
export const SCHEMA = process.env.DEMO_SCHEMA || 'aml_sar_copilot';
export const T = (name: string) => `\`${CATALOG}\`.\`${SCHEMA}\`.\`${name}\``;

export async function appHeaders(): Promise<Headers> {
  const h = new Headers();
  const { client } = getExecutionContext();
  await client.config.authenticate(h);
  return h;
}

export function host(): string {
  return (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '');
}

const NUM = new Set(['INT', 'LONG', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'SHORT', 'BYTE']);

export async function query(statement: string, params: Param[] = []): Promise<Row[]> {
  const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouse) throw new Error('DATABRICKS_WAREHOUSE_ID is not set');
  const headers = await appHeaders();
  headers.set('Content-Type', 'application/json');
  const body = {
    statement,
    warehouse_id: warehouse,
    wait_timeout: '50s',
    on_wait_timeout: 'CONTINUE',
    format: 'JSON_ARRAY',
    disposition: 'INLINE',
    parameters: params.map((p) => ({
      name: p.name,
      value: p.value === null ? null : String(p.value),
      type: p.type ?? (typeof p.value === 'number' ? 'DOUBLE' : 'STRING'),
    })),
  };
  let res = await fetch(`${host()}/api/2.0/sql/statements`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = (await res.json()) as any;
  while (json?.status?.state === 'PENDING' || json?.status?.state === 'RUNNING') {
    await new Promise((r) => setTimeout(r, 700));
    res = await fetch(`${host()}/api/2.0/sql/statements/${json.statement_id}`, { headers });
    json = await res.json();
  }
  if (json?.status?.state !== 'SUCCEEDED') {
    throw new Error(`SQL failed: ${json?.status?.error?.message ?? json?.message ?? res.status}`);
  }
  const cols: { name: string; type_name: string }[] = json.manifest?.schema?.columns ?? [];
  const data: (string | null)[][] = json.result?.data_array ?? [];
  return data.map((r) => {
    const o: Row = {};
    cols.forEach((c, i) => {
      const v = r[i];
      if (v === null || v === undefined) o[c.name] = null;
      else if (NUM.has(c.type_name)) o[c.name] = Number(v);
      else if (c.type_name === 'BOOLEAN') o[c.name] = v === 'true';
      else if (c.type_name === 'ARRAY' || c.type_name === 'STRUCT' || c.type_name === 'MAP') {
        try { o[c.name] = JSON.parse(v); } catch { o[c.name] = v; }
      } else o[c.name] = v;
    });
    return o;
  });
}
