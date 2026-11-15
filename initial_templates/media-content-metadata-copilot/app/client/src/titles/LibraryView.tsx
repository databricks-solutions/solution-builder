/**
 * Library — the metadata work queue from Lakebase. Scopes: hidden gems (viewers finish
 * them, the service barely shows them), safety review (AI-detected warnings missing on
 * Family-Safe / kids-row titles), the Harborlight library, reviewed, all. Each row shows
 * live completeness → what the AI proposal reaches, exposure vs a well-tagged peer,
 * completion vs peer, and the flags — before anyone opens the title.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Baby, Gem, Search, ShieldAlert } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { fetchSummary, fetchTitles, SOURCE_SHORT, type Summary, type TitleRow } from './api';
import { CompletenessBar, ExposureBar, KeyArt, Kpi, Pill, StatusPill, cn, fmtK, pct } from './ui';

const SCOPES = [
  { key: 'gems', label: 'Hidden gems' },
  { key: 'safety', label: 'Safety review' },
  { key: 'harborlight', label: 'Harborlight library' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'all', label: 'All titles' },
] as const;
const ORDER: Record<string, string> = {
  gems: 'highest re-tag priority first', safety: 'kids & family rows first, then most-watched', harborlight: 'highest re-tag priority first',
  reviewed: 'most recent decision first', all: 'highest re-tag priority first',
};

export function LibraryView() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') ?? 'gems';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<TitleRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      Promise.all([fetchTitles({ scope, q: q || undefined }), fetchSummary()])
        .then(([r, s]) => { if (alive) { setRows(r); setSummary(s); setError(null); } })
        .catch((e) => alive && setError((e as Error).message));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [scope, q, tick]);

  const setScope = (v: string) => { const n = new URLSearchParams(sp); n.set('scope', v); setSp(n, { replace: true }); };
  const hb = summary?.by_source.find((s) => s.source === 'Harborlight Library');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Orbitline+ · Content Operations</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Metadata queue</h1>
          </div>
          <div className="flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {SCOPES.map((s) => (
              <button key={s.key} onClick={() => setScope(s.key)} data-scope={s.key}
                className={cn('px-3 py-1.5 text-sm rounded-md transition-colors',
                  scope === s.key ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Titles in the library" value={summary.titles.toLocaleString()} sub={`${summary.poor} below 40/100 completeness`} />
            <Kpi label="Harborlight avg completeness" value={hb ? `${Math.round(hb.avg_completeness)}/100` : '…'} tone="bad" sub={`${hb?.titles ?? '…'} titles acquired in April`} />
            <Kpi label="Hidden gems to re-tag" value={summary.hidden_gems_open} sub="viewers finish them, we rarely show them" />
            <Kpi label="Safety review" value={summary.safety_open} tone="bad" sub={`${summary.kids_row_risk} in kids / family rows`} />
            <Kpi label="Published in the workbench" value={summary.approved} sub={`${summary.proposals_ready} AI proposals waiting`} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-[var(--muted-foreground)]">{rows ? `${rows.length} titles · ${ORDER[scope]}` : 'Loading…'}</div>
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2">
            <Search className="size-4 text-[var(--muted-foreground)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or TTL- id"
              className="h-8 w-56 bg-transparent text-sm outline-none" />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Metadata completeness</th>
                <th className="px-3 py-2 text-left">Impressions · 4 wk</th>
                <th className="px-3 py-2 text-left">Completion</th>
                <th className="px-3 py-2 text-left">Flags</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {error && <tr><td colSpan={6} className="px-4 py-6 text-[var(--destructive)]">Could not load the queue: {error}</td></tr>}
              {!error && rows === null && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-5 rounded bg-[var(--muted)] animate-pulse" /></td></tr>
              ))}
              {rows?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">{scope === 'reviewed' ? 'No titles reviewed yet — open a title and run the AI re-tag.' : 'No titles match this view.'}</td></tr>}
              {rows?.map((r) => {
                const good = r.completion_rate_4w != null && r.peer_completion_rate_4w != null && r.completion_rate_4w >= r.peer_completion_rate_4w;
                return (
                  <tr key={r.id} onClick={() => nav(`/titles/${r.id}`)} data-title-id={r.id}
                    className="border-t border-[var(--border)] cursor-pointer hover:bg-[var(--info-subtle)]/40">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <KeyArt title="" id={r.id} className="h-10 w-7 shrink-0 rounded-md" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{r.title}</div>
                          <div className="text-xs text-[var(--muted-foreground)]">{SOURCE_SHORT[r.source] ?? r.source} · {r.content_type} {r.release_year} · {r.maturity_rating} · {r.genres.join(', ') || 'no genre'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2"><CompletenessBar value={r.completeness} to={r.decision ? null : r.ai_completeness} compact /></td>
                    <td className="px-3 py-2"><ExposureBar actual={r.impressions_4w} peer={r.peer_impressions_4w} /></td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      <span className={cn(good && 'font-semibold text-[var(--success)]')}>{pct(r.completion_rate_4w)}</span>
                      <span className="text-[var(--muted-foreground)]"> vs {pct(r.peer_completion_rate_4w)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.hidden_gem && <Pill tone="info"><Gem className="size-3" />Hidden gem</Pill>}
                        {r.missing_warnings > 0 && !r.decision && <Pill tone="bad"><ShieldAlert className="size-3" />{r.missing_warnings} warning{r.missing_warnings > 1 ? 's' : ''} missing</Pill>}
                        {r.in_kids_row && r.safety_risk && !r.decision && <Pill tone="bad"><Baby className="size-3" />Kids row</Pill>}
                        {r.ai_brand_safety_tier && r.ai_brand_safety_tier !== r.brand_safety_tier && !r.decision && <Pill tone="warn">{r.brand_safety_tier} → {r.ai_brand_safety_tier}</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows && rows.length > 0 && (
            <div className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted-foreground)]">
              Impressions = tile shown on home rows, search and recommendations · peer = median of well-tagged titles of the same primary genre · {fmtK(summary?.impressions_4w)} impressions library-wide in the last 4 weeks
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
