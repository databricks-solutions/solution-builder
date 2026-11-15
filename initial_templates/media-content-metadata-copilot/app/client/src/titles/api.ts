/** Metadata workbench API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type TitleRow = {
  id: string; title: string; source: string; content_type: string; release_year: number | null; primary_genre: string | null;
  maturity_rating: string | null; status: string; decision: string | null; hidden_gem: boolean; safety_risk: boolean;
  impressions_4w: number; peer_impressions_4w: number | null; completion_rate_4w: number | null; peer_completion_rate_4w: number | null;
  retag_priority: number | null; completeness: number; ai_completeness: number | null; genres: string[];
  brand_safety_tier: string; ai_brand_safety_tier: string | null; missing_warnings: number; in_kids_row: boolean;
};

export type SourceStats = {
  source: string; titles: number; avg_completeness: number; impressions_4w: number; impressions_per_title: number;
  completion_pct: number; poor: number; hidden_gems: number; safety_risk: number;
};

export type Summary = {
  titles: number; impressions_4w: number; hidden_gems_open: number; safety_open: number; kids_row_risk: number;
  approved: number; proposals_ready: number; poor: number; by_source: SourceStats[];
};

export type TitleMetadata = {
  genres: string[]; moods: string[]; themes: string[]; content_warnings: string[]; warnings_reviewed: boolean; talent: string[];
  keywords: string[]; synopsis: string; collections: string[]; brand_safety_tier: string; completeness_score: number;
  tagged_by: string; last_tagged_date: string | null;
};

export type WarningEvidence = { warning: string; scene_no: number; evidence: string };

export type AiProposal = {
  genres: string[]; moods: string[]; themes: string[]; content_warnings: string[]; warning_evidence: WarningEvidence[];
  keywords: string[]; synopsis: string; setting: string; talent: string[]; brand_safety_tier: string; completeness_score: number;
  confidence: number | null; promo_clip_scene_no: number | null; promo_clip_reason: string | null; model: string;
};

export type FieldChange = { field: string; label: string; before: string[] | string; after: string[] | string; added: string[]; removed: string[] };

export type RetagProposal = {
  proposed: TitleMetadata; changes: FieldChange[];
  checks: Array<{ id: string; label: string; result: 'PASS' | 'FIX' | 'FLAG'; finding: string; rule: string }>;
  rows_gained: string[]; rows_lost: string[]; rating_before: string | null; rating_after: string | null;
  projected_impressions_4w: number; pilot_multiplier: number;
  similar: Array<{ title_id: string; title: string; source: string; primary_genre: string | null; impressions_4w: number; completeness: number; score: number }>;
  standards: { question: string; answer: string; source: string } | null;
  summary: string; why_underperforming: string; ad_ops_note: string | null; model: string; generated_at: string;
};

export type AuditEntry = { at: string; by: string; action: string; notes?: string; tool?: string };
export type Scene = { id: string; titleId: string; sceneNo: number; startTc: string | null; endTc: string | null; episode: string | null; description: string };

export type TitleDetail = {
  id: string; title: string; contentType: string; releaseYear: number | null; runtimeMin: number | null; source: string;
  studio: string | null; maturityRating: string | null; acquiredDate: string | null; licenseCostUsd: number | null;
  primaryGenre: string | null; meta: TitleMetadata; ai: AiProposal | null; impressions4w: number; playStarts4w: number;
  completionRate4w: number | null; peerImpressions4w: number | null; peerCompletionRate4w: number | null; hiddenGem: boolean;
  safetyRisk: boolean; retagPriority: number | null; status: string; proposal: RetagProposal | null; proposedAt: string | null;
  originalMeta: TitleMetadata | null; decision: string | null; decisionNotes: string | null; decidedBy: string | null;
  decidedAt: string | null; auditTrail: AuditEntry[]; scenes: Scene[];
};

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type Clip = { scene_id: string; title_id: string; title: string; source?: string; scene_no: number; start_tc: string; end_tc: string; description: string; score: number };
export type Similar = { id: string; title: string; source: string; primary_genre: string | null; impressions_4w: number; completeness: number; score: number };
export type Edits = Partial<Pick<TitleMetadata, 'genres' | 'moods' | 'themes' | 'content_warnings' | 'talent' | 'keywords' | 'synopsis'>>;

export async function fetchTitles(params: Record<string, string | undefined>): Promise<TitleRow[]> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return (await okOrThrow(await fetch(`/api/titles?${q}`), 'titles')).json();
}
export async function fetchSummary(): Promise<Summary> {
  return (await okOrThrow(await fetch('/api/titles/summary'), 'summary')).json();
}
export async function fetchTitle(id: string): Promise<TitleDetail> {
  return (await okOrThrow(await fetch(`/api/titles/${encodeURIComponent(id)}`), 'title')).json();
}
export async function fetchSimilar(id: string): Promise<Similar[]> {
  return (await okOrThrow(await fetch(`/api/titles/${encodeURIComponent(id)}/similar`), 'similar')).json();
}
export async function fetchClips(q: string, exclude?: string): Promise<Clip[]> {
  const p = new URLSearchParams({ q, ...(exclude ? { exclude } : {}) });
  return (await okOrThrow(await fetch(`/api/clips?${p}`), 'clips')).json();
}
export async function decide(id: string, body: { decision: 'APPROVED' | 'REJECTED'; notes?: string; edits?: Edits }): Promise<TitleDetail> {
  return (await okOrThrow(await fetch(`/api/titles/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'decision')).json();
}
export type ActivityRow = { title_id: string; title: string; source: string; at: string; by: string; action: string; notes: string | null };
export async function fetchActivity(limit = 12): Promise<ActivityRow[]> {
  return (await okOrThrow(await fetch(`/api/activity/recent?limit=${limit}`), 'activity')).json();
}

/** POST /retag and parse the SSE stream (event: step | result | error). */
export async function runRetag(
  id: string,
  on: { step: (e: StepEvent) => void; result: (r: { proposal: RetagProposal }) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/titles/${encodeURIComponent(id)}/retag`, { method: 'POST' });
  if (!resp.ok || !resp.body) {
    on.error(`HTTP ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      const parsed = JSON.parse(data);
      if (ev === 'step') on.step(parsed);
      else if (ev === 'result') on.result(parsed);
      else if (ev === 'error') on.error(parsed.message);
    }
  }
}

export const SOURCE_SHORT: Record<string, string> = { 'Orbitline Original': 'Original', 'Studio Licensed': 'Licensed', 'Harborlight Library': 'Harborlight' };
