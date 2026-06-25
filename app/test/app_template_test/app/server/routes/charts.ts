/**
 * Analytics chart data route.
 *
 * Why this exists instead of AppKit's built-in `analytics` query plugin
 * (`useAnalyticsQuery` / `<LineChart queryKey=…>`): that plugin's HTTP route
 * runs config/queries/<key>.sql but gives no way to set the statement's
 * catalog/schema, so the queries would have to hardcode `catalog.schema.table`
 * (breaks on any other workspace).
 *
 * The fix is clean: the SQL files are written SCHEMA-RELATIVE (`FROM
 * silver_returns`, no qualifier), and we run them via AppKit's warehouse
 * `query()` passing the demo's catalog + schema as the statement's session
 * context (Databricks' executeStatement honors `catalog`/`schema` — the
 * equivalent of `USE CATALOG` / `USE SCHEMA` for that one statement). One
 * source of truth for catalog/schema: env → appConfig.data, same as every
 * other query in the app. No string templating, no per-workspace edits.
 *
 * The client (AnalyticsView) fetches `/api/charts/<key>` and feeds the rows
 * to the chart components via their `data` prop.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express, Request, Response } from 'express';

// appkit.analytics.query returns the executeStatement `.result`, where the
// connector has already transformed the rows into objects keyed by column
// name (`data`). The column type manifest is a sibling of `.result` and is
// NOT returned, so we coerce numerics heuristically below.
type AnalyticsQuery = (
  sql: string,
  parameters?: Record<string, unknown>,
  formatParameters?: Record<string, unknown>,
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

export function registerChartRoutes(app: Express, deps: ChartsDeps): void {
  const { query, catalog, schema, queriesDir } = deps;

  app.get('/api/charts/:key', async (req: Request, res: Response) => {
    const key = req.params.key;
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
      // Pass catalog + schema as the statement's session context so the
      // schema-relative SQL (FROM silver_returns) resolves against the demo's
      // tables. Databricks executeStatement honors these top-level fields.
      const result = await query(sql, undefined, { catalog, schema });
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
