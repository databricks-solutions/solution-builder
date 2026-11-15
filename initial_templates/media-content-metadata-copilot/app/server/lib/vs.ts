import type { Request } from 'express';
import { authedFetch } from './auth.js';

/**
 * Mosaic AI Vector Search (Delta-sync indexes with managed embeddings, built by the setup job):
 *   <catalog>.<schema>.title_profiles_index — one profile per title → "more like this"
 *   <catalog>.<schema>.scenes_index         — every scene description → clip search for repurposing
 * Called with the viewer's OBO token, falling back to the app SP (lib/auth.ts).
 */
function host(): string {
  return (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
}

export async function vectorQuery(
  req: Request,
  index: string,
  queryText: string,
  columns: string[],
  numResults: number,
  filters?: Record<string, unknown>,
): Promise<Array<Record<string, unknown> & { score: number }>> {
  const body: Record<string, unknown> = { query_text: queryText, columns, num_results: numResults };
  if (filters) body.filters_json = JSON.stringify(filters);
  const resp = await authedFetch(req, `${host()}/api/2.0/vector-search/indexes/${index}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Vector Search ${index} → HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const j = (await resp.json()) as { manifest?: { columns?: Array<{ name: string }> }; result?: { data_array?: unknown[][] } };
  const cols = (j.manifest?.columns ?? []).map((c) => c.name);
  return (j.result?.data_array ?? []).map((row) => {
    const o: Record<string, unknown> = {};
    cols.forEach((c, i) => { o[c] = row[i]; });
    return { ...o, score: Number(o.score ?? 0) };
  });
}
