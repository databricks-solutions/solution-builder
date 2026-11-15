/**
 * Deterministic metadata rules — the Orbitline+ Standards Guide as code.
 * Numbers, tiers, ratings and row eligibility are never left to an LLM.
 *
 *   completeness()     §1.2 completeness score (same formula as Delta gold + the data generator)
 *   brandTier()        §4.1 brand-safety tier from content warnings
 *   ratingFloor()      §3.4 minimum maturity rating implied by the warnings
 *   collectionsFor()   §3.5 + the tag-driven collection rules → which home rows a title qualifies for
 *   diffMetadata()     field-by-field change list for the approval screen
 */
import type { FieldChange, TitleMetadata } from '../db/schema.js';
import type { CollectionRule } from '../db/sync.js';

export const GENERIC_GENRES = ['Feature Film', 'General Entertainment', 'TV Series'];
export const RESTRICTED = ['Graphic Violence', 'Sexual Content', 'Nudity', 'Drug Use', 'Self-Harm', 'Suicide'];
export const STANDARD = ['Violence', 'Strong Language', 'Alcohol Use', 'Smoking', 'Frightening Scenes', 'Death of a Parent', 'Animal Harm', 'Flashing Lights'];
export const RATING_ORDER = ['TV-Y', 'TV-Y7', 'G', 'TV-G', 'PG', 'TV-PG', 'PG-13', 'TV-14', 'R', 'TV-MA'];

export function completeness(m: Pick<TitleMetadata, 'genres' | 'moods' | 'themes' | 'warnings_reviewed' | 'talent' | 'keywords' | 'synopsis'>): number {
  const specific = m.genres.filter((g) => !GENERIC_GENRES.includes(g));
  let s = 0;
  s += specific.length >= 2 || (specific.length > 0 && !(specific.length === 1 && specific[0] === 'Drama')) ? 15 : specific.length ? 7 : 0;
  s += m.moods.length >= 2 ? 15 : m.moods.length ? 7 : 0;
  s += m.themes.length >= 2 ? 15 : m.themes.length ? 7 : 0;
  s += m.warnings_reviewed ? 20 : 0;
  s += m.talent.length >= 3 ? 15 : m.talent.length ? 7 : 0;
  s += m.keywords.length >= 5 ? 10 : m.keywords.length ? 5 : 0;
  s += (m.synopsis ?? '').length >= 120 ? 10 : m.synopsis ? 4 : 0;
  return s;
}

export function brandTier(warnings: string[]): 'Restricted' | 'Standard' | 'Family-Safe' {
  if (warnings.some((w) => RESTRICTED.includes(w))) return 'Restricted';
  if (warnings.some((w) => STANDARD.includes(w))) return 'Standard';
  return 'Family-Safe';
}

const LEVEL: Record<string, number> = { 'TV-Y': 0, 'TV-Y7': 1, G: 2, 'TV-G': 2, PG: 3, 'TV-PG': 3, 'PG-13': 4, 'TV-14': 4, R: 5, 'TV-MA': 5 };
/** Comparable maturity level (TV and film ratings share a scale: TV-PG ≈ PG, TV-14 ≈ PG-13, TV-MA ≈ R). */
const rank = (r: string | null | undefined) => (r && r in LEVEL ? LEVEL[r] : -1);
const isTv = (r: string | null | undefined) => (r ?? '').startsWith('TV-');

/** §3.4 minimum rating for the warnings, in the title's own rating system (TV vs film). */
export function ratingFloor(warnings: string[], current: string | null): string | null {
  const tv = isTv(current) || !current;
  let floor: string | null = null;
  const bump = (tvR: string, filmR: string) => {
    const r = tv ? tvR : filmR;
    if (rank(r) > rank(floor)) floor = r;
  };
  if (warnings.some((w) => ['Frightening Scenes', 'Death of a Parent', 'Violence', 'Strong Language', 'Alcohol Use', 'Smoking'].includes(w))) bump('TV-PG', 'PG');
  if (warnings.some((w) => RESTRICTED.includes(w))) bump('TV-14', 'PG-13');
  if (warnings.some((w) => ['Sexual Content', 'Nudity', 'Graphic Violence'].includes(w))) bump('TV-MA', 'R');
  return floor;
}

export function adjustedRating(current: string | null, warnings: string[]): string | null {
  const floor = ratingFloor(warnings, current);
  if (!floor) return current;
  return rank(floor) > rank(current) ? floor : current;
}

export function collectionsFor(m: Pick<TitleMetadata, 'genres' | 'moods' | 'themes' | 'content_warnings'>, rating: string | null, rules: CollectionRule[]): string[] {
  const out: string[] = [];
  for (const c of rules) {
    const pool = c.rule_facet === 'genre' ? m.genres : c.rule_facet === 'mood' ? m.moods : m.themes;
    if (!pool.some((t) => c.rule_terms.includes(t))) continue;
    if (c.max_rating && rank(rating) > rank(c.max_rating)) continue;
    if (c.requires_no_warnings && m.content_warnings.length > 0) continue;
    out.push(c.collection_name);
  }
  return out;
}

const LABELS: Record<string, string> = {
  genres: 'Genres', moods: 'Moods', themes: 'Themes', content_warnings: 'Content warnings', talent: 'Talent',
  keywords: 'Keywords', synopsis: 'Synopsis', brand_safety_tier: 'Brand-safety tier', collections: 'Home rows',
};

export function diffMetadata(before: TitleMetadata, after: TitleMetadata): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of ['genres', 'moods', 'themes', 'content_warnings', 'talent', 'keywords', 'collections'] as const) {
    const b = before[f], a = after[f];
    const added = a.filter((x) => !b.includes(x));
    const removed = b.filter((x) => !a.includes(x));
    if (added.length || removed.length) out.push({ field: f, label: LABELS[f], before: b, after: a, added, removed });
  }
  for (const f of ['synopsis', 'brand_safety_tier'] as const) {
    if ((before[f] ?? '') !== (after[f] ?? '')) out.push({ field: f, label: LABELS[f], before: before[f] ?? '', after: after[f] ?? '', added: [], removed: [] });
  }
  return out;
}
