/**
 * Analytics chart data route.
 *
 * Why this exists instead of AppKit's built-in `analytics` query route: we want
 * the queries portable across workspaces, so they don't hardcode
 * `catalog.schema.table`. Instead each `.sql` references its tables via
 * `IDENTIFIER(:catalog || '.' || :schema || '.table')` and we bind `:catalog`
 * and `:schema` here from the demo's config (env → appConfig.data) using
 * AppKit's `sql.string()` markers. Same binding the type-generator samples at
 * build time via the `-- @param catalog/schema = …` annotations in the .sql.
 *
 * (We bind them as PARAMETERS rather than pass catalog/schema as statement
 * session context because the IDENTIFIER() form is what the type-generator can
 * resolve at DESCRIBE time — keeping runtime + typegen on the same mechanism,
 * so generated chart types stay accurate instead of degrading to `unknown`.)
 *
 * The client (AnalyticsView) fetches `/api/charts/<key>` and feeds the rows
 * to the chart components via their `data` prop.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Application, Request, Response } from 'express';
import { sql as sqlParam } from '@databricks/appkit';

// appkit.analytics.query returns the executeStatement `.result`, where the
// connector has already transformed the rows into objects keyed by column
// name (`data`). The column type manifest is a sibling of `.result` and is
// NOT returned, so we coerce numerics heuristically below.
//
// `parameters` are appkit SQL type markers (sql.string(...) etc.) — bound as
// named SQL params. We type the value as the marker shape so the call wired
// in server.ts (which forwards to appkit.analytics.query) typechecks.
type SqlMarker = ReturnType<typeof sqlParam.string>;
type AnalyticsQuery = (
  sql: string,
  parameters?: Record<string, SqlMarker>,
) => Promise<{
  data?: Record<string, unknown>[];
}>;

// The SQL statement API serializes every cell as a string, including
// numerics, and the analytics plugin's query() drops the column-type
// manifest — so coerce a value to a number only when it's a clean numeric
// string (optional sign, digits, optional decimal). This leaves dimension
// strings (product names, lot ids, regions) and ISO timestamps (which
// contain '-'/'T'/':') untouched, while turning SUM/COUNT/rate aggregates
// into the numbers the charts need for their yKey.
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
function coerce(value: unknown): unknown {
  if (typeof value === 'string' && NUMERIC_RE.test(value)) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return value;
}

interface ChartsDeps {
  /** appkit.analytics.query — runs SQL against the SQL warehouse. */
  query: AnalyticsQuery;
  /** Demo catalog + schema (from appConfig.data → env). */
  catalog: string;
  schema: string;
  /** Absolute path to the config/queries dir. */
  queriesDir: string;
}

// Query key → filename. Only these keys are runnable (closed allowlist —
// no arbitrary file reads from a user-supplied key).
const QUERY_FILES: Record<string, string> = {
  daily_refund_trend: 'daily_refund_trend.sql',
  returns_by_product: 'returns_by_product.sql',
  worst_lots: 'worst_lots.sql',
};

export function registerChartRoutes(app: Application, deps: ChartsDeps): void {
  const { query, catalog, schema, queriesDir } = deps;

  app.get('/api/charts/:key', async (req: Request, res: Response) => {
    const key = String(req.params.key);
    const file = QUERY_FILES[key];
    if (!file) {
      res.status(404).json({ error: `Unknown chart query: ${key}` });
      return;
    }

    let sql: string;
    try {
      sql = readFileSync(resolve(queriesDir, file), 'utf8');
    } catch (e) {
      res.status(500).json({ error: `Could not read query ${key}: ${(e as Error).message}` });
      return;
    }

    try {
      // Bind :catalog/:schema as named SQL parameters so the IDENTIFIER()
      // table references in the .sql resolve against the demo's tables. Values
      // must be wrapped as SQL type markers (sql.string), not raw strings.
      const result = await query(sql, {
        catalog: sqlParam.string(catalog),
        schema: sqlParam.string(schema),
      });
      // The connector already turned rows into objects; we just coerce
      // numeric-looking cells to numbers so the charts get real numbers
      // for their yKey (the SQL API serializes everything as strings).
      const rows = (result.data ?? []).map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, coerce(v)])),
      );
      res.json({ data: rows });
    } catch (e) {
      res.status(500).json({ error: `Query ${key} failed: ${(e as Error).message}` });
    }
  });
}
