import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { titleScenes, titles, type AiProposal, type TitleMetadata, type WarningEvidence } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the title library.
 *
 * Delta (media_advertising.content_metadata_copilot) holds the library, the AI
 * proposal computed by the setup job (ai_query → ai_title_enrichment) and the
 * engagement scorecard (gold_title_scorecard). The workbench needs every title
 * + its scene descriptions. Idempotent: skips when app.titles has rows, unless
 * `forceIfAnyEmpty` (the "Reset demo" button).
 *
 * Also exposes `loadLibraryRules()` — the tag-driven collection rules and the
 * July re-tag pilot multiplier, read once from Delta and cached; the re-tag
 * workflow (services/retag.ts) uses them.
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    scorecard: string;
    scenes: string;
    collections: string;
    retagPilot: string;
  };
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('[')) {
    try { return (JSON.parse(v) as unknown[]).map(String); } catch { return []; }
  }
  return [];
};

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.titles`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync of the title library…');
  const t0 = Date.now();
  const fq = (name: keyof DataConfig['tables']) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
  const j = (c: string) => `to_json(coalesce(${c}, array())) AS ${c}`;

  const [rows, sceneRows] = await Promise.all([
    execSql<Record<string, unknown>>(
      warehouseId,
      `SELECT title_id, title, content_type, release_year, runtime_min, source, studio, maturity_rating,
              CAST(acquired_date AS STRING) AS acquired_date, license_cost_usd, primary_genre,
              ${j('genres')}, ${j('moods')}, ${j('themes')}, ${j('content_warnings')}, warnings_reviewed, ${j('talent')},
              ${j('keywords')}, synopsis, ${j('collections')}, brand_safety_tier, completeness_score, tagged_by,
              CAST(last_tagged_date AS STRING) AS last_tagged_date,
              ${j('ai_genres')}, ${j('ai_moods')}, ${j('ai_themes')}, ${j('ai_content_warnings')},
              to_json(coalesce(ai_warning_evidence, array())) AS ai_warning_evidence, ${j('ai_keywords')}, ai_synopsis,
              ai_setting, ${j('ai_talent')}, ai_brand_safety_tier, ai_completeness_score, ai_confidence,
              promo_clip_scene_no, promo_clip_reason,
              impressions_4w, play_starts_4w, completion_rate_4w, peer_impressions_4w, peer_completion_rate_4w,
              hidden_gem, safety_risk, retag_priority_score
       FROM ${fq('scorecard')}`,
    ),
    execSql<Record<string, unknown>>(
      warehouseId,
      `SELECT scene_id, title_id, scene_no, start_tc, end_tc, episode, description FROM ${fq('scenes')}`,
    ),
  ]);
  console.log(`[sync] fetched ${rows.length} titles, ${sceneRows.length} scenes in ${Date.now() - t0}ms`);

  await chunkInsert(rows, 500, (chunk) =>
    db.insert(titles).values(chunk.map((r) => {
      const meta: TitleMetadata = {
        genres: arr(r.genres), moods: arr(r.moods), themes: arr(r.themes), content_warnings: arr(r.content_warnings),
        warnings_reviewed: bool(r.warnings_reviewed), talent: arr(r.talent), keywords: arr(r.keywords),
        synopsis: String(r.synopsis ?? ''), collections: arr(r.collections), brand_safety_tier: String(r.brand_safety_tier ?? 'Family-Safe'),
        completeness_score: num(r.completeness_score) ?? 0, tagged_by: String(r.tagged_by ?? ''),
        last_tagged_date: (r.last_tagged_date as string) ?? null,
      };
      let evidence: WarningEvidence[] = [];
      try {
        evidence = (JSON.parse(String(r.ai_warning_evidence ?? '[]')) as WarningEvidence[]).map((e) => ({ ...e, scene_no: Number(e.scene_no) }));
      } catch { /* keep [] */ }
      const ai: AiProposal | null = r.ai_synopsis == null ? null : {
        genres: arr(r.ai_genres), moods: arr(r.ai_moods), themes: arr(r.ai_themes), content_warnings: arr(r.ai_content_warnings),
        warning_evidence: evidence, keywords: arr(r.ai_keywords), synopsis: String(r.ai_synopsis ?? ''), setting: String(r.ai_setting ?? ''),
        talent: arr(r.ai_talent), brand_safety_tier: String(r.ai_brand_safety_tier ?? ''), completeness_score: num(r.ai_completeness_score) ?? 0,
        confidence: num(r.ai_confidence), promo_clip_scene_no: num(r.promo_clip_scene_no), promo_clip_reason: (r.promo_clip_reason as string) ?? null,
        model: 'ai_query · databricks-gpt-5-4-mini',
      };
      return {
        id: String(r.title_id), title: String(r.title), contentType: String(r.content_type), releaseYear: num(r.release_year),
        runtimeMin: num(r.runtime_min), source: String(r.source), studio: (r.studio as string) ?? null,
        maturityRating: (r.maturity_rating as string) ?? null, acquiredDate: (r.acquired_date as string) ?? null,
        licenseCostUsd: num(r.license_cost_usd), primaryGenre: (r.primary_genre as string) ?? null, meta, ai,
        impressions4w: num(r.impressions_4w) ?? 0, playStarts4w: num(r.play_starts_4w) ?? 0,
        completionRate4w: num(r.completion_rate_4w), peerImpressions4w: num(r.peer_impressions_4w),
        peerCompletionRate4w: num(r.peer_completion_rate_4w), hiddenGem: bool(r.hidden_gem), safetyRisk: bool(r.safety_risk),
        retagPriority: num(r.retag_priority_score),
      };
    })).onConflictDoNothing(),
  );
  await chunkInsert(sceneRows, 2000, (chunk) =>
    db.insert(titleScenes).values(chunk.map((r) => ({
      id: String(r.scene_id), titleId: String(r.title_id), sceneNo: num(r.scene_no) ?? 0,
      startTc: (r.start_tc as string) ?? null, endTc: (r.end_tc as string) ?? null,
      episode: (r.episode as string) ?? null, description: String(r.description ?? ''),
    }))).onConflictDoNothing(),
  );
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.title_scenes RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.titles RESTART IDENTITY CASCADE`);
  });
}

// ── Library rules (collection rules + pilot multiplier), cached ─────────────

export type CollectionRule = {
  collection_id: string; collection_name: string; rule_facet: 'genre' | 'mood' | 'theme'; rule_terms: string[];
  max_rating: string | null; requires_no_warnings: boolean; avg_daily_impressions: number; home_rank: number;
};
export type LibraryRules = { collections: CollectionRule[]; pilotImpressionsMultiplier: number; pilotPlaysMultiplier: number };

let rulesCache: Promise<LibraryRules> | null = null;
export function loadLibraryRules(cfg: DataConfig): Promise<LibraryRules> {
  if (!rulesCache) {
    const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID ?? '';
    const fq = (name: keyof DataConfig['tables']) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
    rulesCache = Promise.all([
      execSql<Record<string, unknown>>(warehouseId,
        `SELECT collection_id, collection_name, rule_facet, to_json(rule_terms) AS rule_terms, max_rating, requires_no_warnings,
                avg_daily_impressions, home_rank FROM ${fq('collections')} ORDER BY home_rank`),
      execSql<Record<string, unknown>>(warehouseId,
        `SELECT round(sum(impressions_4w_after) / sum(impressions_4w_before), 2) AS imps_x,
                round(sum(play_starts_4w_after) / sum(play_starts_4w_before), 2) AS plays_x
         FROM ${fq('retagPilot')} WHERE pilot_group = 'Pilot (re-tagged)'`),
    ]).then(([c, p]) => ({
      collections: c.map((x) => ({
        collection_id: String(x.collection_id), collection_name: String(x.collection_name),
        rule_facet: String(x.rule_facet) as CollectionRule['rule_facet'], rule_terms: arr(x.rule_terms),
        max_rating: (x.max_rating as string) ?? null, requires_no_warnings: bool(x.requires_no_warnings),
        avg_daily_impressions: Number(x.avg_daily_impressions), home_rank: Number(x.home_rank),
      })),
      pilotImpressionsMultiplier: Number(p[0]?.imps_x ?? 1),
      pilotPlaysMultiplier: Number(p[0]?.plays_x ?? 1),
    }));
    rulesCache.catch(() => { rulesCache = null; });
  }
  return rulesCache;
}

export async function execSql<T>(
  warehouseId: string,
  statement: string,
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

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}
