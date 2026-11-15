/**
 * Title workbench — one title, end to end:
 *   header : key art, facts, exposure vs well-tagged peers, completion vs peers, completeness
 *   left   : the LIVE metadata (what drives rows/search today), every scene description (the AI's
 *            evidence — hovering a warning highlights its scene), audit trail
 *   right  : the AI re-tag (streamed steps → editor brief → proposed changes, editable → standards
 *            checks with citations → Standards Guide answer → look-alikes + projected lift → clips to
 *            repurpose) and the editor decision that publishes to Lakebase with an audit trail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, CheckCircle2, CircleAlert, Clapperboard, Film, Flag, Gem, Loader2,
  Megaphone, Rocket, ShieldAlert, Sparkles, TrendingUp, Wrench, X, XCircle,
} from 'lucide-react';
import { dataMutated } from '@/lib/events';
import {
  decide, fetchClips, fetchTitle, runRetag, SOURCE_SHORT,
  type Clip, type Edits, type RetagProposal, type StepEvent, type TitleDetail, type TitleMetadata,
} from './api';
import { Chips, CompletenessBar, KeyArt, Pill, RESULT_LABEL, RESULT_TONE, StatusPill, cn, fmtK, pct } from './ui';

const STEP_ICON = { running: Loader2, done: CheckCircle2, error: CircleAlert };

function Steps({ steps }: { steps: StepEvent[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const Icon = STEP_ICON[s.status];
        return (
          <li key={s.id} className="flex gap-2.5 text-sm">
            <Icon className={cn('mt-0.5 size-4 shrink-0', s.status === 'running' && 'animate-spin text-[var(--primary-light)]', s.status === 'done' && 'text-[var(--success)]', s.status === 'error' && 'text-[var(--destructive)]')} />
            <div className="min-w-0">
              <div className="font-medium">{s.label}</div>
              {s.detail && <div className="text-xs text-[var(--muted-foreground)]">{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const FACETS: Array<{ key: keyof TitleMetadata; label: string }> = [
  { key: 'genres', label: 'Genres' }, { key: 'moods', label: 'Moods' }, { key: 'themes', label: 'Themes' },
  { key: 'content_warnings', label: 'Content warnings' }, { key: 'talent', label: 'Talent' }, { key: 'keywords', label: 'Keywords' },
  { key: 'collections', label: 'Home rows' },
];

function LiveMetadata({ t }: { t: TitleDetail }) {
  const m = t.meta;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Live metadata <span className="font-normal text-xs text-[var(--muted-foreground)]">· what home rows & search see today</span></div>
        <Pill tone={t.decision === 'APPROVED' ? 'good' : 'neutral'}>{m.tagged_by.replace('_', ' ')}</Pill>
      </div>
      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
        {FACETS.map((f) => (
          <div key={f.key} className="contents">
            <dt className="pt-0.5 text-[var(--muted-foreground)]">{f.label}</dt>
            <dd><Chips items={m[f.key] as string[]} tone={f.key === 'content_warnings' ? 'warn' : 'neutral'} empty={f.key === 'content_warnings' && !m.warnings_reviewed ? 'not reviewed' : 'none'} /></dd>
          </div>
        ))}
        <dt className="text-[var(--muted-foreground)]">Synopsis</dt>
        <dd className={cn('leading-relaxed', (m.synopsis ?? '').length < 120 && 'italic text-[var(--brand-5)]')}>{m.synopsis || 'none'}</dd>
        <dt className="text-[var(--muted-foreground)]">Brand safety</dt>
        <dd><Pill tone={m.brand_safety_tier === 'Family-Safe' ? 'good' : m.brand_safety_tier === 'Standard' ? 'warn' : 'bad'}>{m.brand_safety_tier}</Pill>{!m.warnings_reviewed && <span className="ml-1.5 text-[var(--muted-foreground)]">(default — warnings never reviewed)</span>}</dd>
      </dl>
    </div>
  );
}

function EditableChips({ items, removed, added, onToggle }: { items: string[]; removed: string[]; added: string[]; onToggle: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => {
        const off = removed.includes(t);
        return (
          <button key={t} onClick={() => onToggle(t)} title={off ? 'Put back' : 'Remove from the proposal'}
            className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
              off ? 'bg-[var(--muted)] text-[var(--muted-foreground)] line-through' : added.includes(t) ? 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]' : 'bg-[var(--muted)] text-[var(--foreground)]')}>
            {t}{off ? null : <X className="size-3 opacity-60" />}
          </button>
        );
      })}
    </div>
  );
}

function ProposalView({ t, p, drop, setDrop, synopsis, setSynopsis, editable, onHover }: {
  t: TitleDetail; p: RetagProposal; drop: Record<string, string[]>; setDrop: (d: Record<string, string[]>) => void;
  synopsis: string; setSynopsis: (s: string) => void; editable: boolean; onHover: (scenes: number[]) => void;
}) {
  const ai = t.ai!;
  const safety = p.checks.some((c) => c.result === 'FLAG');
  const toggle = (field: string, v: string) => {
    const cur = drop[field] ?? [];
    setDrop({ ...drop, [field]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const arrays = p.changes.filter((c) => Array.isArray(c.after) && !['collections'].includes(c.field));
  return (
    <div className="space-y-4">
      <div className={cn('rounded-xl px-4 py-3', safety ? 'bg-[rgb(255_107_87/0.14)] text-[#FFB0A3]' : 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]')}>
        <div className="flex items-center gap-2 font-semibold">{safety ? <ShieldAlert className="size-5" /> : <Gem className="size-5" />}{safety ? 'Safety fix + re-tag proposed' : 'Re-tag proposed'}</div>
        <p className="mt-1 text-sm leading-relaxed">{p.summary}</p>
        {p.why_underperforming && <p className="mt-2 text-sm leading-relaxed"><b>Why it under-performs:</b> {p.why_underperforming}</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>Completeness <b>{t.originalMeta?.completeness_score ?? t.meta.completeness_score}</b> → <b>{p.proposed.completeness_score}</b>/100</span>
          <span>Brand safety <b>{t.originalMeta?.brand_safety_tier ?? t.meta.brand_safety_tier}</b> → <b>{p.proposed.brand_safety_tier}</b></span>
          {p.rating_after !== p.rating_before && <span>Rating <b>{p.rating_before}</b> → <b>{p.rating_after}</b></span>}
          {p.rows_gained.length > 0 && <span>+{p.rows_gained.length} home rows</span>}
          {p.rows_lost.length > 0 && <span className="font-semibold">leaves {p.rows_lost.join(', ')}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
          <span>Proposed changes</span>{editable && <span className="normal-case tracking-normal">click a tag to drop it · edit the synopsis</span>}
        </div>
        {arrays.map((c) => (
          <div key={c.field} className="grid grid-cols-[110px_1fr] gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0">
            <div className="text-xs font-medium pt-0.5">{c.label}</div>
            <div className="space-y-1">
              {(c.before as string[]).length > 0 && <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">was <Chips items={c.before as string[]} strike={c.removed} /></div>}
              {editable
                ? <EditableChips items={c.after as string[]} removed={drop[c.field] ?? []} added={c.added} onToggle={(v) => toggle(c.field, v)} />
                : <Chips items={c.after as string[]} highlight={c.added} />}
            </div>
          </div>
        ))}
        {p.changes.some((c) => c.field === 'synopsis') && (
          <div className="grid grid-cols-[110px_1fr] gap-3 border-t border-[var(--border)] px-4 py-2.5">
            <div className="text-xs font-medium pt-0.5">Synopsis</div>
            <div className="space-y-1">
              <div className="text-[11px] text-[var(--muted-foreground)] line-through">{(t.originalMeta ?? t.meta).synopsis || 'none'}</div>
              {editable
                ? <textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} data-testid="synopsis" className="h-20 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-xs leading-relaxed outline-none focus:border-[var(--primary-light)]" />
                : <div className="text-xs leading-relaxed">{p.proposed.synopsis}</div>}
            </div>
          </div>
        )}
        {(p.rows_gained.length > 0 || p.rows_lost.length > 0) && (
          <div className="grid grid-cols-[110px_1fr] gap-3 border-t border-[var(--border)] px-4 py-2.5">
            <div className="text-xs font-medium pt-0.5">Home rows</div>
            <div className="flex flex-wrap gap-1">
              {p.rows_gained.map((r) => <Pill key={r} tone="good">+ {r}</Pill>)}
              {p.rows_lost.map((r) => <Pill key={r} tone="bad">− {r}</Pill>)}
            </div>
          </div>
        )}
      </div>

      {ai.warning_evidence.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-[var(--brand-4)]" />Content warnings — evidence from the scenes</div>
          <ul className="mt-2 space-y-1.5">
            {ai.warning_evidence.map((e) => (
              <li key={`${e.warning}-${e.scene_no}`} onMouseEnter={() => onHover([e.scene_no])} onMouseLeave={() => onHover([])} className="flex gap-2 text-xs cursor-default">
                <Pill tone={t.meta.content_warnings.includes(e.warning) ? 'neutral' : 'bad'}>{e.warning}</Pill>
                <span className="text-[var(--muted-foreground)]">scene {e.scene_no} ·</span>
                <span className="italic">{e.evidence.replace(/^"|"$/g, '')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--muted)] px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Standards checks</div>
        {p.checks.map((c) => (
          <div key={c.id} className="grid grid-cols-[70px_1fr] gap-3 border-t border-[var(--border)] px-4 py-2 first:border-t-0">
            <div><Pill tone={RESULT_TONE[c.result]}>{c.result === 'PASS' ? <Check className="size-3" /> : c.result === 'FIX' ? <Wrench className="size-3" /> : <Flag className="size-3" />}{RESULT_LABEL[c.result]}</Pill></div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{c.label}</div>
              <div className="text-xs text-[var(--foreground)]/80 leading-relaxed">{c.finding}</div>
              <div className="mt-0.5 text-[11px] text-[var(--primary-light)]">{c.rule}</div>
            </div>
          </div>
        ))}
      </div>

      {p.standards && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--info-subtle)]/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]"><BookOpen className="size-4" />Standards Guide (Genie agent)</div>
          <div className="mt-1 text-xs italic text-[var(--muted-foreground)]">“{p.standards.question}”</div>
          <div className="mt-1.5 text-sm leading-relaxed space-y-1.5 [&_strong]:font-semibold"><ReactMarkdown>{p.standards.answer}</ReactMarkdown></div>
          {p.standards.source && <div className="mt-1 text-[11px] text-[var(--primary-light)]">Sources: {p.standards.source}</div>}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Film className="size-4 text-[var(--primary-light)]" />More like this <span className="font-normal text-xs text-[var(--muted-foreground)]">· Vector Search</span></div>
          {p.similar.length === 0 && <div className="mt-2 text-xs text-[var(--muted-foreground)]">No well-tagged look-alikes found.</div>}
          <ul className="mt-2 space-y-1.5">
            {p.similar.map((s) => (
              <li key={s.title_id} className="flex items-center justify-between gap-2 text-xs">
                <Link to={`/titles/${s.title_id}`} className="truncate hover:underline"><b>{s.title}</b> <span className="text-[var(--muted-foreground)]">{SOURCE_SHORT[s.source] ?? s.source} · {s.primary_genre}</span></Link>
                <span className="shrink-0 tabular-nums">{fmtK(s.impressions_4w)} <span className="text-[var(--muted-foreground)]">imps</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="size-4 text-[var(--success)]" />Projected impact</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{fmtK(t.impressions4w)} → {fmtK(p.projected_impressions_4w)}</div>
          <div className="text-xs text-[var(--muted-foreground)]">impressions / 4 weeks · the July pilot titles earned ×{p.pilot_multiplier} after re-tagging (capped at the well-tagged {t.primaryGenre ?? 'peer'} median of {fmtK(t.peerImpressions4w)})</div>
          {p.ad_ops_note && <div className="mt-2 flex gap-1.5 rounded-lg bg-[var(--warning-subtle)] px-2.5 py-1.5 text-xs text-[var(--warning-subtle-foreground)]"><Megaphone className="size-3.5 shrink-0 mt-0.5" />{p.ad_ops_note}</div>}
        </div>
      </div>
    </div>
  );
}

function ClipsCard({ t }: { t: TitleDetail }) {
  const promo = t.ai?.promo_clip_scene_no ? t.scenes.find((s) => s.sceneNo === t.ai!.promo_clip_scene_no) : null;
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!promo) return null;
  const find = async () => {
    setLoading(true);
    setErr(null);
    try { setClips(await fetchClips(promo.description, t.id)); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold"><Clapperboard className="size-4 text-[var(--brand-2)]" />Repurpose: promo clip</div>
        <button onClick={find} disabled={loading} data-testid="find-clips" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:border-[var(--primary-light)] disabled:opacity-60">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Find matching clips across the library
        </button>
      </div>
      <div className="mt-2 rounded-lg bg-[var(--muted)]/60 px-3 py-2 text-xs">
        <div><b>Scene {promo.sceneNo}</b> <span className="text-[var(--muted-foreground)]">{promo.startTc}–{promo.endTc}</span> · {promo.description}</div>
        {t.ai?.promo_clip_reason && <div className="mt-1 text-[var(--muted-foreground)]">Why: {t.ai.promo_clip_reason}</div>}
      </div>
      {err && <div className="mt-2 text-xs text-[var(--destructive)]">{err}</div>}
      {clips && (
        <ul className="mt-2 space-y-1.5" data-testid="clips">
          {clips.slice(0, 5).map((c) => (
            <li key={c.scene_id} className="text-xs">
              <Link to={`/titles/${c.title_id}`} className="font-medium hover:underline">{c.title}</Link>
              <span className="text-[var(--muted-foreground)]"> · {SOURCE_SHORT[c.source ?? ''] ?? c.source} · {c.start_tc}–{c.end_tc} · match {Math.round(c.score * 100)}%</span>
              <div className="text-[var(--muted-foreground)]">{c.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { ai_retag: 'AI re-tag', approved: 'Published', rejected: 'Rejected', edited: 'Edited by editor', note: 'Note' };

export function TitleWorkbench() {
  const { id = '' } = useParams();
  const [t, setT] = useState<TitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [drop, setDrop] = useState<Record<string, string[]>>({});
  const [synopsis, setSynopsis] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [hover, setHover] = useState<number[]>([]);

  const load = useCallback(() => {
    fetchTitle(id).then((d) => { setT(d); setSynopsis(d.proposal?.proposed.synopsis ?? ''); setError(null); }).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { setSteps([]); setDrop({}); load(); }, [load]);

  const evidenceScenes = useMemo(() => new Set((t?.ai?.warning_evidence ?? []).map((e) => e.scene_no)), [t]);

  const run = async () => {
    setRunning(true);
    setSteps([]);
    setDrop({});
    await runRetag(id, {
      step: (e) => setSteps((prev) => { const i = prev.findIndex((p) => p.id === e.id); return i >= 0 ? prev.map((p, j) => (j === i ? e : p)) : [...prev, e]; }),
      result: (r) => { setT((prev) => prev && { ...prev, proposal: r.proposal, status: 'proposal_ready' }); setSynopsis(r.proposal.proposed.synopsis); },
      error: (m) => setSteps((prev) => [...prev, { id: 'err', label: 'AI re-tag failed', status: 'error', detail: m }]),
    });
    setRunning(false);
    load();
    dataMutated.emit();
  };

  const submit = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!t?.proposal) return;
    setSaving(decision);
    try {
      const p = t.proposal.proposed;
      const edits: Edits = {};
      for (const f of ['genres', 'moods', 'themes', 'content_warnings', 'talent', 'keywords'] as const) {
        if (drop[f]?.length) edits[f] = p[f].filter((x) => !drop[f].includes(x));
      }
      if (synopsis && synopsis !== p.synopsis) edits.synopsis = synopsis;
      const d = await decide(id, { decision, notes: notes || undefined, edits });
      setT(d);
      dataMutated.emit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (error && !t) return <div className="p-8 text-[var(--destructive)]">Could not load title {id}: {error}</div>;
  if (!t) return <div className="p-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-[var(--muted)] animate-pulse" />)}</div>;

  const p = t.proposal;
  const ratio = t.peerImpressions4w ? t.impressions4w / t.peerImpressions4w : null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5 space-y-4">
        <Link to="/library" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft className="size-3" />Metadata queue</Link>
        <div className="flex flex-wrap items-stretch gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-[var(--brand-ink)]">
          <KeyArt title={t.title} id={t.id} className="h-36 w-24 shrink-0" />
          <div className="flex-1 min-w-[260px] py-1">
            <div className="text-xs text-white/70">{t.id} · {t.source}{t.studio ? ` · ${t.studio}` : ''}{t.acquiredDate && t.source === 'Harborlight Library' ? ` · live since ${t.acquiredDate}` : ''}</div>
            <h1 className="font-display text-3xl font-semibold">{t.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill className="bg-white/15 text-white">{t.contentType} · {t.releaseYear}</Pill>
              {t.runtimeMin && <Pill className="bg-white/15 text-white">{t.runtimeMin} min</Pill>}
              <Pill className="bg-white/15 text-white">Rated {t.maturityRating}</Pill>
              {t.hiddenGem && <Pill tone="info"><Gem className="size-3" />Hidden gem</Pill>}
              {t.safetyRisk && !t.decision && <Pill tone="bad"><ShieldAlert className="size-3" />Safety review</Pill>}
              <StatusPill status={t.status} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 self-center">
            <div className="rounded-xl bg-white/10 px-3 py-2 min-w-[140px]">
              <div className="text-[10px] uppercase tracking-wide text-white/60">Impressions · 4 wk</div>
              <div className={cn('text-2xl font-semibold tabular-nums', ratio != null && ratio < 0.4 && 'text-[var(--brand-5)]')}>{fmtK(t.impressions4w)}</div>
              <div className="text-[11px] text-white/70">vs {fmtK(t.peerImpressions4w)} for well-tagged {t.primaryGenre ?? 'peers'}</div>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2 min-w-[140px]">
              <div className="text-[10px] uppercase tracking-wide text-white/60">Completion rate</div>
              <div className="text-2xl font-semibold tabular-nums">{pct(t.completionRate4w)}</div>
              <div className="text-[11px] text-white/70">vs {pct(t.peerCompletionRate4w)} peer median</div>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2 min-w-[150px]">
              <div className="text-[10px] uppercase tracking-wide text-white/60">Metadata completeness</div>
              <div className="text-2xl font-semibold tabular-nums">{t.meta.completeness_score}<span className="text-sm text-white/60">/100</span></div>
              <div className="text-[11px] text-white/70">{t.decision === 'APPROVED' ? `was ${t.originalMeta?.completeness_score ?? '—'}` : `AI proposal → ${t.ai?.completeness_score ?? '—'}`}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
          <div className="space-y-3">
            <LiveMetadata t={t} />
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Scenes ({t.scenes.length})</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">the AI reads these · <span className="text-[#FFB0A3]">■</span> evidence for a warning</div>
              </div>
              <ol className="mt-2 space-y-1.5">
                {t.scenes.map((s) => (
                  <li key={s.id} data-scene={s.sceneNo}
                    className={cn('rounded-lg px-2.5 py-1.5 text-xs leading-relaxed transition-colors',
                      hover.includes(s.sceneNo) ? 'bg-[rgb(255_107_87/0.14)] ring-2 ring-[#FF6B57]/50' : evidenceScenes.has(s.sceneNo) ? 'bg-[rgb(255_107_87/0.07)]' : 'bg-[var(--muted)]/40')}>
                    <span className="mr-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">{String(s.sceneNo).padStart(2, '0')} · {s.startTc}{s.episode ? ` · ${s.episode}` : ''}</span>{s.description}
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <div className="text-sm font-semibold">Audit trail</div>
              {t.auditTrail.length === 0 && <div className="mt-1 text-xs text-[var(--muted-foreground)]">No actions yet.</div>}
              <ol className="mt-2 space-y-1.5">
                {[...t.auditTrail].reverse().map((e, i) => (
                  <li key={i} className="text-xs"><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span> · {e.by} · <span className="text-[var(--muted-foreground)]">{new Date(e.at).toLocaleString()}</span>{e.notes && <div className="text-[var(--muted-foreground)]">{e.notes}</div>}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[var(--brand-5)]" />AI re-tag</div>
                  <div className="text-xs text-[var(--muted-foreground)]">Reads every scene, tags it against the taxonomy, applies the Standards Guide, finds look-alikes and writes the brief. You publish.</div>
                </div>
                {!t.decision && (
                  <button onClick={run} disabled={running} data-testid="run-retag"
                    className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60">
                    {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {p ? 'Re-run AI re-tag' : 'Run AI re-tag'}
                  </button>
                )}
              </div>
              {steps.length > 0 && <div className="mt-4 rounded-xl bg-[var(--muted)]/60 p-3"><Steps steps={steps} /></div>}
              {p && !running && t.ai && (
                <div className="mt-4">
                  <ProposalView t={t} p={p} drop={drop} setDrop={setDrop} synopsis={synopsis} setSynopsis={setSynopsis} editable={!t.decision} onHover={setHover} />
                </div>
              )}
              {!p && steps.length === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                  Not re-tagged yet. The AI proposal is ready to review in ~20 seconds.
                  {t.ai && <div className="mt-2"><CompletenessBar value={t.meta.completeness_score} to={t.ai.completeness_score} /></div>}
                </div>
              )}
            </div>

            {p && !running && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Editor decision</div>
                  <Pill tone="info">AI proposal — an editor publishes</Pill>
                </div>
                {t.decision ? (
                  <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-sm', t.decision === 'APPROVED' ? 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]' : 'bg-[rgb(255_107_87/0.16)] text-[#FFB0A3]')} data-testid="decision-banner">
                    {t.decision === 'APPROVED' ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                    {t.decision === 'APPROVED'
                      ? <>Published to the live catalogue by {t.decidedBy} · completeness {t.originalMeta?.completeness_score} → <b>{t.meta.completeness_score}</b> · {t.meta.brand_safety_tier} · rated {t.maturityRating} · now in {t.meta.collections.length} home row{t.meta.collections.length === 1 ? '' : 's'}</>
                      : <>Rejected by {t.decidedBy}{t.decisionNotes ? ` — ${t.decisionNotes}` : ''}</>}
                  </div>
                ) : (
                  <>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Editor note (optional)"
                      className="h-9 w-full rounded-lg border border-[var(--border)] px-3 text-sm outline-none" />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => submit('APPROVED')} disabled={!!saving} data-decision="APPROVED"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success)] px-3 py-2 text-sm font-medium text-[var(--success-foreground)] disabled:opacity-50 ring-2 ring-offset-2 ring-[var(--brand-4)]">
                        {saving === 'APPROVED' ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}Approve & publish metadata
                      </button>
                      <button onClick={() => submit('REJECTED')} disabled={!!saving} data-decision="REJECTED"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium disabled:opacity-50">
                        {saving === 'REJECTED' ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}Reject
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <ClipsCard t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}
