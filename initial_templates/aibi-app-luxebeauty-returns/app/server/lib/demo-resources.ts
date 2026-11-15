/**
 * Boot-time resolution of the resources the setup job creates.
 *
 * The bundle can't know the Genie Agent id at deploy time (the setup job creates it), so the job's last task writes them to <DEMO_CATALOG>.<DEMO_SCHEMA>.demo_resources (key, value).
 * Before config/app.json is loaded, this reads that table and fills the matching env vars — so the `${VAR}`
 * placeholders in config/app.json resolve with no hand-copied ids. An env value that is already set always wins
 * (local dev `.env`, or an explicit bundle `config.env` entry). Best-effort: on failure the app boots degraded
 * (no ask_data tool, inert platform tiles) and logs why.
 */
import { WorkspaceClient } from '@databricks/sdk-experimental';

// demo_resources key → env var read by config/app.json.
const KEY_TO_ENV: Record<string, string> = {
  genie_space_id: 'GENIE_SPACE_ID',
  app_url: 'APP_URL',
  lakebase_project_id: 'LAKEBASE_PROJECT_ID',
};

type StmtResp = {
  statement_id: string;
  status: { state: string; error?: { message: string } };
  result?: { data_array?: Array<[string, string]> };
};

export async function loadDemoResources(): Promise<void> {
  const missing = Object.values(KEY_TO_ENV).filter((e) => !process.env[e]);
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  const catalog = process.env.DEMO_CATALOG;
  const schema = process.env.DEMO_SCHEMA;
  if (missing.length === 0 || !warehouseId || !catalog || !schema) return;

  const client = new WorkspaceClient({});
  const req = (method: 'GET' | 'POST', path: string, payload?: unknown) =>
    client.apiClient.request({ method, path, payload, headers: new Headers(), raw: false, query: {} }) as Promise<StmtResp>;

  const deadline = Date.now() + 4 * 60 * 1000; // a cold serverless warehouse starts in well under this
  for (let attempt = 1; ; attempt++) {
    try {
      let r = await req('POST', '/api/2.0/sql/statements', {
        statement: `SELECT key, value FROM \`${catalog}\`.\`${schema}\`.demo_resources`,
        warehouse_id: warehouseId,
        wait_timeout: '50s',
        on_wait_timeout: 'CONTINUE',
        disposition: 'INLINE',
        format: 'JSON_ARRAY',
      });
      while ((r.status.state === 'PENDING' || r.status.state === 'RUNNING') && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 2000));
        r = await req('GET', `/api/2.0/sql/statements/${r.statement_id}`);
      }
      if (r.status.state !== 'SUCCEEDED') throw new Error(r.status.error?.message ?? `state ${r.status.state}`);
      const kv = Object.fromEntries(r.result?.data_array ?? []);
      for (const [key, env] of Object.entries(KEY_TO_ENV)) {
        if (!process.env[env] && kv[key]) process.env[env] = kv[key];
      }
      console.log(
        `[resources] from ${schema}.demo_resources: genie=${process.env.GENIE_SPACE_ID || '-'}`,
      );
      return;
    } catch (e) {
      if (Date.now() >= deadline || attempt >= 4) {
        console.warn(`[resources] demo_resources lookup failed — booting without the Genie Agent id: ${(e as Error).message}`);
        return;
      }
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}
