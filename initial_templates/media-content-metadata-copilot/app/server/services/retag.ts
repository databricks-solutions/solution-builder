/**
 * The AI re-tag — the workbench's AI step.
 *
 *   1. Read the title dossier: every scene description (timecoded) + the live vendor metadata.
 *   2. Take the AI Functions proposal the setup job computed in Delta (`ai_query` with a JSON schema over the
 *      dossier, then mapped onto the Orbitline+ taxonomy): genres, moods, themes, content warnings WITH the
 *      scene that evidences each one, keywords, synopsis, setting, talent from credits.
 *   3. Apply the Standards Guide deterministically (lib/metadata.ts): completeness score, brand-safety tier,
 *      maturity-rating floor, which home rows the title gains or must leave. Numbers are never left to an LLM.
 *   4. Ask the Genie agent (over the Standards Guide documents) the one standards question that
 *      matters most for this title → cited guidance.
 *   5. Vector Search "more like this" → well-tagged peers and what they earn (why this one under-performs).
 *   6. A Foundation Model writes the editor summary, the "why it under-performs" explanation and the Ad Ops note.
 *
 * Every step is reported through `onStep` so the UI can stream progress.
 */
import type { Request } from 'express';
import type { AiProposal, RetagProposal, TitleMetadata } from '../db/schema.js';
import type { LibraryRules } from '../db/sync.js';
import { askDocuments, chatJson } from '../lib/serving.js';
import { adjustedRating, brandTier, collectionsFor, completeness, diffMetadata, ratingFloor } from '../lib/metadata.js';
import { vectorQuery } from '../lib/vs.js';

export type TitleFile = {
  id: string;
  title: string;
  contentType: string;
  releaseYear: number | null;
  runtimeMin: number | null;
  source: string;
  maturityRating: string | null;
  primaryGenre: string | null;
  meta: TitleMetadata;
  ai: AiProposal | null;
  impressions4w: number;
  completionRate4w: number | null;
  peerImpressions4w: number | null;
  peerCompletionRate4w: number | null;
  hiddenGem: boolean;
  scenes: Array<{ sceneNo: number; startTc: string | null; description: string }>;
};

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type PeerLookup = (ids: string[]) => Promise<Array<{ id: string; title: string; source: string; primary_genre: string | null; impressions_4w: number; completeness: number }>>;

const pct = (x: number | null | undefined) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const n = (c: number, w: string) => `${c} ${w}${c === 1 ? '' : 's'}`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export async function retagTitle(
  req: Request,
  t: TitleFile,
  rules: LibraryRules,
  opts: { genieSpaceId: string; writerModel: string; profilesIndex: string; lookupPeers: PeerLookup; onStep: (e: StepEvent) => void },
): Promise<RetagProposal> {
  const { onStep } = opts;
  if (!t.ai) throw new Error('No AI proposal for this title — run the setup job (enrich_titles) first.');
  const ai = t.ai;

  onStep({ id: 'read', label: `Reading ${t.scenes.length} scene descriptions`, status: 'running' });
  onStep({
    id: 'read', label: `Read ${t.scenes.length} scenes + the live metadata`, status: 'done',
    detail: `${t.contentType}${t.runtimeMin ? ` · ${t.runtimeMin} min` : ''} · live completeness ${t.meta.completeness_score}/100 · tagged by ${t.meta.tagged_by.replace('_', ' ')}`,
  });

  onStep({ id: 'ai', label: 'AI Functions tags (ai_query over the dossier)', status: 'running' });
  onStep({
    id: 'ai', label: 'AI Functions proposal loaded', status: 'done',
    detail: `${ai.genres.length} genres · ${ai.moods.length} moods · ${ai.themes.length} themes · ${ai.content_warnings.length} content warnings (each cites a scene) · ${ai.talent.length} talent from credits${ai.confidence != null ? ` · confidence ${pct(ai.confidence)}` : ''}`,
  });

  onStep({ id: 'rules', label: 'Applying the Standards Guide (taxonomy, tier, rating, rows)', status: 'running' });
  const proposed: TitleMetadata = {
    genres: ai.genres, moods: ai.moods, themes: ai.themes, content_warnings: ai.content_warnings, warnings_reviewed: true,
    talent: ai.talent.length ? ai.talent : t.meta.talent, keywords: ai.keywords, synopsis: ai.synopsis || t.meta.synopsis,
    collections: [], brand_safety_tier: brandTier(ai.content_warnings), completeness_score: 0,
    tagged_by: 'editor (AI-assisted)', last_tagged_date: null,
  };
  const ratingAfter = adjustedRating(t.maturityRating, proposed.content_warnings);
  proposed.collections = collectionsFor(proposed, ratingAfter, rules.collections);
  proposed.completeness_score = completeness(proposed);
  const changes = diffMetadata(t.meta, proposed);
  const rowsGained = proposed.collections.filter((c) => !t.meta.collections.includes(c));
  const rowsLost = t.meta.collections.filter((c) => !proposed.collections.includes(c));
  const missing = ai.content_warnings.filter((w) => !t.meta.content_warnings.includes(w));
  const floor = ratingFloor(proposed.content_warnings, t.maturityRating);
  const checks: RetagProposal['checks'] = [];
  const generic = t.meta.genres.filter((g) => ['Feature Film', 'General Entertainment', 'TV Series'].includes(g));
  checks.push(generic.length || (t.meta.genres.length === 1 && t.meta.genres[0] === 'Drama')
    ? { id: 'genre', label: 'Genre specificity', result: 'FIX', finding: `Live genre "${t.meta.genres.join(', ') || 'none'}" is ${generic.length ? 'a vendor placeholder' : 'under-specified'} → ${ai.genres.join(', ')}.`, rule: 'Standards Guide §2.2' }
    : { id: 'genre', label: 'Genre specificity', result: 'PASS', finding: `Live genres ${t.meta.genres.join(', ')} are specific.`, rule: 'Standards Guide §2.2' });
  checks.push(t.meta.moods.length < 2 || t.meta.themes.length < 2
    ? { id: 'mood', label: 'Moods & themes', result: 'FIX', finding: `Live: ${n(t.meta.moods.length, 'mood')}, ${n(t.meta.themes.length, 'theme')} → proposed ${n(ai.moods.length, 'mood')} (${ai.moods.join(', ')}), ${n(ai.themes.length, 'theme')} (${ai.themes.join(', ')}).`, rule: 'Standards Guide §2.3-2.4' }
    : { id: 'mood', label: 'Moods & themes', result: 'PASS', finding: `${n(t.meta.moods.length, 'mood')} and ${n(t.meta.themes.length, 'theme')} on file.`, rule: 'Standards Guide §2.3-2.4' });
  checks.push(missing.length
    ? { id: 'warnings', label: 'Content warnings', result: 'FLAG', finding: `${missing.length} warning${missing.length > 1 ? 's' : ''} missing from the live title: ${missing.map((w) => { const ev = ai.warning_evidence.find((e) => e.warning === w); return ev ? `${w} (scene ${ev.scene_no})` : w; }).join(', ')}.`, rule: 'Standards Guide §3.1-3.3' }
    : { id: 'warnings', label: 'Content warnings', result: 'PASS', finding: t.meta.warnings_reviewed ? 'Live warnings match what the scenes show.' : 'No warnings found in the scenes — mark as reviewed.', rule: 'Standards Guide §3.1-3.3' });
  if (proposed.brand_safety_tier !== t.meta.brand_safety_tier) {
    checks.push({ id: 'tier', label: 'Brand-safety tier', result: 'FLAG', finding: `Sold as ${t.meta.brand_safety_tier}; the scenes make it ${proposed.brand_safety_tier}. Ad Ops must pull it from ${t.meta.brand_safety_tier} campaigns.`, rule: 'Standards Guide §4.1, §4.4' });
  } else {
    checks.push({ id: 'tier', label: 'Brand-safety tier', result: 'PASS', finding: `${proposed.brand_safety_tier} — unchanged.`, rule: 'Standards Guide §4.1' });
  }
  if (floor && ratingAfter !== t.maturityRating) {
    checks.push({ id: 'rating', label: 'Maturity rating', result: 'FLAG', finding: `Rated ${t.maturityRating}; ${proposed.content_warnings.filter((w) => ['Frightening Scenes', 'Death of a Parent', 'Violence', 'Strong Language', 'Alcohol Use', 'Smoking'].includes(w)).join(' + ') || 'its warnings'} require at least ${floor} → ${ratingAfter}.`, rule: 'Standards Guide §3.4' });
  } else {
    checks.push({ id: 'rating', label: 'Maturity rating', result: 'PASS', finding: `${t.maturityRating ?? 'n/a'} meets the floor for its warnings.`, rule: 'Standards Guide §3.4' });
  }
  checks.push(rowsLost.length
    ? { id: 'rows', label: 'Home rows', result: 'FLAG', finding: `Must leave ${rowsLost.join(', ')}${rowsGained.length ? `; joins ${rowsGained.join(', ')}` : ''}.`, rule: 'Standards Guide §3.5' }
    : rowsGained.length
      ? { id: 'rows', label: 'Home rows', result: 'FIX', finding: `Qualifies for ${rowsGained.length} more row${rowsGained.length > 1 ? 's' : ''}: ${rowsGained.join(', ')}.`, rule: 'Standards Guide §1.1' }
      : { id: 'rows', label: 'Home rows', result: 'PASS', finding: 'No row changes.', rule: 'Standards Guide §1.1' });
  const fixes = checks.filter((c) => c.result !== 'PASS').length;
  onStep({ id: 'rules', label: `Checked ${checks.length} standards`, status: 'done', detail: `${fixes} to fix · completeness ${t.meta.completeness_score} → ${proposed.completeness_score} · ${rowsGained.length} rows gained${rowsLost.length ? ` · ${rowsLost.length} lost` : ''}` });

  // The single standards question that matters most for this title.
  const kidsRow = rowsLost.find((r) => /Little Ones|Family Movie/.test(r));
  let standardsQuestion: string;
  if (kidsRow) standardsQuestion = `Can a title rated ${t.maturityRating} with ${missing.join(' and ')} stay in the "${kidsRow}" row, and what maturity rating does it need?`;
  else if (proposed.brand_safety_tier !== t.meta.brand_safety_tier) standardsQuestion = `A title sold as ${t.meta.brand_safety_tier} ad inventory contains ${missing.join(', ')}. What brand-safety tier should it have and what must happen with Ad Operations?`;
  else if (t.hiddenGem) standardsQuestion = `How should we prioritise re-tagging a title that viewers finish but that is rarely shown, and what completeness score must it reach?`;
  else standardsQuestion = `What must a complete title record include to score at least 80 on metadata completeness?`;
  onStep({ id: 'standards', label: 'Consulting the Standards Guide (Genie agent)', status: 'running', detail: standardsQuestion });
  let standards: RetagProposal['standards'] = null;
  try {
    const ask = async (q: string) => {
      const doc = (x: string) => askDocuments(req, opts.genieSpaceId, `Answer from the Orbitline+ Metadata & Content Standards Guide only, citing the section: ${x}`);
      try { return await doc(q); } catch (e) {
        console.warn('[retag] Genie agent call failed, retrying once:', (e as Error).message.slice(0, 200));
        return doc(q);
      }
    };
    let ans = await ask(standardsQuestion);
    // Retrieval occasionally misses on a long compound question — retry once with the core rule question.
    if (/don.t have access|cannot answer|not contain|provide the (relevant|guide)/i.test(ans.answer)) {
      standardsQuestion = missing.length
        ? `What does the Standards Guide require for a title with ${missing.join(' and ')}?`
        : `What must a complete title record include to score at least 80 on metadata completeness?`;
      ans = await ask(standardsQuestion);
    }
    standards = { question: standardsQuestion, answer: ans.answer, source: ans.sources.join(', ') };
    onStep({ id: 'standards', label: 'Standards guidance retrieved', status: 'done', detail: ans.sources.join(', ') || 'Standards Guide' });
  } catch (e) {
    console.error('[retag] Genie agent (Standards Guide) failed', e);
    onStep({ id: 'standards', label: 'Standards Guide unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  onStep({ id: 'similar', label: 'Finding well-tagged look-alikes (Vector Search)', status: 'running' });
  let similar: RetagProposal['similar'] = [];
  try {
    const profile = `${proposed.synopsis} Genres: ${proposed.genres.join(', ')}. Moods: ${proposed.moods.join(', ')}. Themes: ${proposed.themes.join(', ')}. Setting: ${ai.setting}.`;
    const hits = await vectorQuery(req, opts.profilesIndex, profile, ['title_id', 'title', 'source', 'primary_genre'], 12);
    const ids = hits.map((h) => String(h.title_id)).filter((id) => id !== t.id);
    const peers = await opts.lookupPeers(ids);
    similar = ids
      .map((id) => {
        const p = peers.find((x) => x.id === id);
        const h = hits.find((x) => String(x.title_id) === id)!;
        return p ? { title_id: id, title: p.title, source: p.source, primary_genre: p.primary_genre, impressions_4w: p.impressions_4w, completeness: p.completeness, score: h.score } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.completeness >= 80)
      .slice(0, 5);
    const med = similar.length ? similar.map((s) => s.impressions_4w).sort((a, b) => a - b)[Math.floor(similar.length / 2)] : 0;
    onStep({ id: 'similar', label: `Found ${similar.length} well-tagged look-alikes`, status: 'done', detail: similar.length ? `median ${k(med)} impressions / 4 weeks vs ${k(t.impressions4w)} for this title` : 'no well-tagged peers found' });
  } catch (e) {
    onStep({ id: 'similar', label: 'Vector Search unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  const projected = Math.round(Math.min(t.impressions4w * rules.pilotImpressionsMultiplier, Math.max(t.peerImpressions4w ?? 0, t.impressions4w)));
  onStep({ id: 'write', label: 'Writing the editor brief', status: 'running' });
  const system = `You are the Metadata Copilot for Orbitline+, a streaming service. You brief a metadata editor on one title.
Return ONLY a JSON object: {"summary": string, "why_underperforming": string, "ad_ops_note": string|null}.
- summary: 2 sentences, what the AI proposes and the most important fix (lead with any safety issue).
- why_underperforming: 2-3 sentences explaining, with the numbers given, why the title is under-exposed (home rows and search are tag-driven; cite rows it is missing from and how look-alikes perform). If it is not under-performing say so.
- ad_ops_note: one sentence for Ad Operations if the brand-safety tier changes, else null.
Use only the facts given. Plain text, no markdown.`;
  const user = JSON.stringify({
    title: t.title, source: t.source, type: t.contentType, rating_before: t.maturityRating, rating_after: ratingAfter,
    live_metadata: { genres: t.meta.genres, moods: t.meta.moods, themes: t.meta.themes, warnings: t.meta.content_warnings, talent_count: t.meta.talent.length, synopsis: t.meta.synopsis, completeness: t.meta.completeness_score, brand_safety_tier: t.meta.brand_safety_tier, rows: t.meta.collections },
    proposed: { genres: proposed.genres, moods: proposed.moods, themes: proposed.themes, warnings: proposed.content_warnings, completeness: proposed.completeness_score, brand_safety_tier: proposed.brand_safety_tier, rows: proposed.collections },
    rows_gained: rowsGained, rows_lost: rowsLost, missing_warnings: missing,
    engagement_last_4_weeks: { impressions: t.impressions4w, completion_rate: t.completionRate4w, well_tagged_same_genre_median_impressions: t.peerImpressions4w, well_tagged_same_genre_median_completion: t.peerCompletionRate4w },
    look_alikes: similar.map((s) => ({ title: s.title, impressions_4w: s.impressions_4w })),
    july_pilot_impressions_multiplier: rules.pilotImpressionsMultiplier, projected_impressions_4w_after_retag: projected,
    standards_guidance: standards?.answer ?? null,
  });
  let summary = '';
  let why = '';
  let adOps: string | null = null;
  try {
    const out = await chatJson<{ summary: string; why_underperforming: string; ad_ops_note: string | null }>(req, opts.writerModel, system, user);
    summary = out.summary; why = out.why_underperforming; adOps = out.ad_ops_note || null;
    onStep({ id: 'write', label: 'Editor brief written', status: 'done', detail: opts.writerModel });
  } catch (e) {
    summary = `AI proposes ${changes.length} field changes; completeness ${t.meta.completeness_score} → ${proposed.completeness_score}.`;
    why = '';
    onStep({ id: 'write', label: 'Brief writing failed', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }

  return {
    proposed, changes, checks, rows_gained: rowsGained, rows_lost: rowsLost, rating_before: t.maturityRating, rating_after: ratingAfter,
    projected_impressions_4w: projected, pilot_multiplier: rules.pilotImpressionsMultiplier, similar, standards,
    summary, why_underperforming: why, ad_ops_note: adOps, model: opts.writerModel, generated_at: new Date().toISOString(),
  };
}
