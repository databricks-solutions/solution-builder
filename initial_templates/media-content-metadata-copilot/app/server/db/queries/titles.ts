import { eq, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { titleScenes, titles, type AuditEntry, type RetagProposal, type TitleMetadata } from '../schema.js';
import { adjustedRating, brandTier, collectionsFor, completeness } from '../../lib/metadata.js';
import type { CollectionRule } from '../sync.js';

/**
 * Library queries over the Lakebase mirror (app.titles / app.title_scenes).
 * Scopes:
 *   gems        hidden gems — viewers finish them, the service barely shows them (re-tag priority order)
 *   safety      live metadata is missing AI-detected content warnings on a Family-Safe / kids-row title
 *   harborlight the 420-title Harborlight library
 *   reviewed    titles an editor approved or rejected
 *   all         everything
 */
export type Scope = 'gems' | 'safety' | 'harborlight' | 'reviewed' | 'all';

const MISSING_WARNINGS = sql`(SELECT COUNT(*) FROM jsonb_array_elements_text(COALESCE(titles.ai->'content_warnings','[]'::jsonb)) w
                             WHERE NOT (titles.meta->'content_warnings') ? w)::int`;
const KIDS_ROW = sql`((titles.meta->'collections') ? 'Little Ones (under 7)' OR (titles.meta->'collections') ? 'Family Movie Night')`;

export async function listTitles(db: AppDb, f: { scope?: Scope; q?: string; limit?: number }) {
  const where: ReturnType<typeof sql>[] = [sql`TRUE`];
  const scope = f.scope ?? 'gems';
  if (scope === 'gems') where.push(sql`titles.hidden_gem AND titles.decision IS NULL`);
  if (scope === 'safety') where.push(sql`titles.safety_risk AND titles.decision IS NULL`);
  if (scope === 'harborlight') where.push(sql`titles.source = 'Harborlight Library'`);
  if (scope === 'reviewed') where.push(sql`titles.decision IS NOT NULL`);
  if (f.q) where.push(sql`(titles.title ILIKE ${'%' + f.q + '%'} OR titles.id ILIKE ${'%' + f.q + '%'})`);
  const order =
    scope === 'safety' ? sql`${KIDS_ROW} DESC, titles.impressions_4w DESC`
    : scope === 'reviewed' ? sql`titles.decided_at DESC`
    : sql`titles.decision IS NOT NULL, titles.retag_priority DESC NULLS LAST`;
  const rows = await db.execute(sql`
    SELECT titles.id, titles.title, titles.source, titles.content_type, titles.release_year, titles.primary_genre,
           titles.maturity_rating, titles.status, titles.decision, titles.hidden_gem, titles.safety_risk,
           titles.impressions_4w, titles.peer_impressions_4w, titles.completion_rate_4w, titles.peer_completion_rate_4w,
           titles.retag_priority, (titles.meta->>'completeness_score')::int AS completeness,
           (titles.ai->>'completeness_score')::int AS ai_completeness,
           titles.meta->'genres' AS genres, titles.meta->>'brand_safety_tier' AS brand_safety_tier,
           titles.ai->>'brand_safety_tier' AS ai_brand_safety_tier,
           ${MISSING_WARNINGS} AS missing_warnings, ${KIDS_ROW} AS in_kids_row
    FROM app.titles WHERE ${sql.join(where, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${f.limit ?? 500}`);
  return rows.rows;
}

export async function librarySummary(db: AppDb) {
  const bySource = await db.execute(sql`
    SELECT source, COUNT(*)::int AS titles,
           ROUND(AVG((meta->>'completeness_score')::int), 1)::float AS avg_completeness,
           SUM(impressions_4w)::float8 AS impressions_4w,
           ROUND(SUM(impressions_4w)::numeric / COUNT(*), 0)::int AS impressions_per_title,
           ROUND(100 * SUM(completion_rate_4w * play_starts_4w)::numeric / NULLIF(SUM(play_starts_4w), 0), 1)::float AS completion_pct,
           COUNT(*) FILTER (WHERE (meta->>'completeness_score')::int < 40)::int AS poor,
           COUNT(*) FILTER (WHERE hidden_gem)::int AS hidden_gems,
           COUNT(*) FILTER (WHERE safety_risk)::int AS safety_risk
    FROM app.titles GROUP BY source ORDER BY impressions_per_title`);
  const tot = await db.execute(sql`
    SELECT COUNT(*)::int AS titles, SUM(impressions_4w)::float8 AS impressions_4w,
           COUNT(*) FILTER (WHERE hidden_gem AND decision IS NULL)::int AS hidden_gems_open,
           COUNT(*) FILTER (WHERE safety_risk AND decision IS NULL)::int AS safety_open,
           COUNT(*) FILTER (WHERE safety_risk AND decision IS NULL AND ${KIDS_ROW})::int AS kids_row_risk,
           COUNT(*) FILTER (WHERE decision = 'APPROVED')::int AS approved,
           COUNT(*) FILTER (WHERE status = 'proposal_ready')::int AS proposals_ready,
           COUNT(*) FILTER (WHERE (meta->>'completeness_score')::int < 40)::int AS poor
    FROM app.titles`);
  return { ...(tot.rows[0] as Record<string, number>), by_source: bySource.rows };
}

export async function getTitle(db: AppDb, id: string) {
  const [t] = await db.select().from(titles).where(eq(titles.id, id));
  if (!t) return null;
  const scenes = await db.select().from(titleScenes).where(eq(titleScenes.titleId, id)).orderBy(titleScenes.sceneNo);
  return { ...t, scenes };
}

export async function titlesByIds(db: AppDb, ids: string[]) {
  if (!ids.length) return [];
  const r = await db.execute(sql`
    SELECT id, title, source, primary_genre, impressions_4w, (meta->>'completeness_score')::int AS completeness
    FROM app.titles WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return r.rows as Array<{ id: string; title: string; source: string; primary_genre: string | null; impressions_4w: number; completeness: number }>;
}

export async function saveProposal(db: AppDb, id: string, p: RetagProposal, by: string) {
  const entry: AuditEntry = {
    at: new Date().toISOString(), by: 'Metadata Copilot', action: 'ai_retag', tool: 'ai_retag',
    notes: `${p.changes.length} field changes proposed · completeness ${p.proposed.completeness_score}/100 · requested by ${by}`,
  };
  await db.update(titles).set({
    proposal: p, proposedAt: new Date(), status: 'proposal_ready', updatedAt: new Date(),
    auditTrail: sql`${titles.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
  }).where(eq(titles.id, id));
}

export type Edits = Partial<Pick<TitleMetadata, 'genres' | 'moods' | 'themes' | 'content_warnings' | 'talent' | 'keywords' | 'synopsis'>>;

/** Editor decision write-back. APPROVED publishes the (optionally edited) proposal as the LIVE metadata. */
export async function decideTitle(
  db: AppDb,
  p: { id: string; decision: 'APPROVED' | 'REJECTED'; edits?: Edits; notes?: string | null; userEmail: string; rules: CollectionRule[] },
) {
  const [cur] = await db.select().from(titles).where(eq(titles.id, p.id));
  if (!cur) return null;
  if (!cur.proposal) throw new Error('Run the AI re-tag first — there is no proposal to decide on.');
  const now = new Date().toISOString();
  if (p.decision === 'REJECTED') {
    const entry: AuditEntry = { at: now, by: p.userEmail, action: 'rejected', notes: p.notes ?? undefined };
    await db.update(titles).set({
      status: 'rejected', decision: 'REJECTED', decisionNotes: p.notes ?? null, decidedBy: p.userEmail, decidedAt: new Date(),
      updatedAt: new Date(), auditTrail: sql`${titles.auditTrail} || ${JSON.stringify([entry])}::jsonb`,
    }).where(eq(titles.id, p.id));
    return getTitle(db, p.id);
  }
  const base = cur.proposal.proposed;
  const e = p.edits ?? {};
  const edited = Object.keys(e).some((k) => JSON.stringify((e as Record<string, unknown>)[k]) !== JSON.stringify((base as Record<string, unknown>)[k]));
  const merged: TitleMetadata = { ...base, ...e, warnings_reviewed: true, tagged_by: 'editor (AI-assisted)', last_tagged_date: now.slice(0, 10) };
  const rating = adjustedRating(cur.maturityRating, merged.content_warnings);
  merged.brand_safety_tier = brandTier(merged.content_warnings);
  merged.collections = collectionsFor(merged, rating, p.rules);
  merged.completeness_score = completeness(merged);
  const entries: AuditEntry[] = [];
  if (edited) entries.push({ at: now, by: p.userEmail, action: 'edited', notes: 'Editor adjusted the AI proposal before publishing.' });
  entries.push({
    at: now, by: p.userEmail, action: 'approved',
    notes: `Published to the live catalogue · completeness ${cur.meta.completeness_score} → ${merged.completeness_score} · tier ${cur.meta.brand_safety_tier} → ${merged.brand_safety_tier}${rating !== cur.maturityRating ? ` · rating ${cur.maturityRating} → ${rating}` : ''}${p.notes ? ` · ${p.notes}` : ''}`,
    before: cur.meta, after: merged,
  });
  await db.update(titles).set({
    meta: merged, originalMeta: cur.originalMeta ?? cur.meta, maturityRating: rating, status: 'approved', decision: 'APPROVED',
    decisionNotes: p.notes ?? null, decidedBy: p.userEmail, decidedAt: new Date(), updatedAt: new Date(),
    auditTrail: sql`${titles.auditTrail} || ${JSON.stringify(entries)}::jsonb`,
  }).where(eq(titles.id, p.id));
  return getTitle(db, p.id);
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT t.id AS title_id, t.title, t.source, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.titles t, jsonb_array_elements(t.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

export async function findTitlesForAgent(db: AppDb, p: { scope: Scope; q: string | null; limit: number }) {
  const rows = await listTitles(db, { scope: p.scope, q: p.q ?? undefined, limit: p.limit });
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      title_id: x.id, title: x.title, source: x.source, primary_genre: x.primary_genre, status: x.status,
      completeness: x.completeness, ai_completeness: x.ai_completeness, impressions_4w: x.impressions_4w,
      peer_impressions_4w: x.peer_impressions_4w, completion_rate_4w: x.completion_rate_4w,
      peer_completion_rate_4w: x.peer_completion_rate_4w, missing_warnings: x.missing_warnings,
      brand_safety_tier: x.brand_safety_tier, ai_brand_safety_tier: x.ai_brand_safety_tier, in_kids_row: x.in_kids_row,
    };
  });
}
