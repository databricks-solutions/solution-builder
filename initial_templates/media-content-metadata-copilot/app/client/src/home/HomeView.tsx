/**
 * Home — the catalogue wall. Orbitline+ bought the 420-title Harborlight library in April and it
 * arrived with almost no metadata, so the tag-driven home rows barely surface it. The page is an
 * editorial masthead over a poster wall of the Harborlight shelf as viewers' home rows see it:
 * each poster carries its metadata-completeness ring, its tags and its 4-week impressions. Every
 * number comes from the same endpoints as before.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { fetchActivity, fetchSummary, fetchTitles, type ActivityRow, type Summary, type TitleRow } from '@/titles/api';
import { fmtK } from '@/titles/ui';

const ACTION: Record<string, string> = { ai_retag: 'AI re-tag', approved: 'Published', rejected: 'Rejected', edited: 'Edited' };
const SRC_COLOR: Record<string, string> = { 'Harborlight Library': 'var(--brand-5)', 'Studio Licensed': 'var(--brand-3)', 'Orbitline Original': 'var(--brand-2)' };

/** Poster art generated from the title id: two hues + a soft light source. No images shipped. */
function posterStyle(id: string): CSSProperties {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 70 + (h % 90)) % 360;
  const x = 20 + (h % 60);
  return {
    background: `radial-gradient(120% 80% at ${x}% 0%, hsl(${b} 80% 62% / 0.55), transparent 60%), linear-gradient(160deg, hsl(${a} 45% 22%), hsl(${b} 40% 9%))`,
  };
}

/** Circular completeness gauge (0-100). */
function Ring({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = v < 40 ? 'var(--brand-5)' : v < 80 ? 'var(--brand-4)' : 'var(--success)';
  return (
    <div className="relative flex size-11 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="3" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums text-white">{Math.round(v)}</span>
    </div>
  );
}

function Poster({ t, onOpen }: { t: TitleRow; onOpen: () => void }) {
  const tags = [t.primary_genre, ...t.genres.filter((g) => g !== t.primary_genre)].filter(Boolean).slice(0, 2) as string[];
  return (
    <button onClick={onOpen} className="group flex flex-col text-left">
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-[0_10px_30px_-12px_rgb(0_0_0/0.9)] ring-1 ring-white/10 transition-transform duration-200 group-hover:-translate-y-1" style={posterStyle(t.id)}>
        <div className="absolute left-2.5 top-2.5"><Ring value={t.completeness} /></div>
        {t.hidden_gem && <span className="absolute right-2.5 top-2.5 rounded-full bg-[var(--brand-2)] px-2 py-0.5 text-[10px] font-semibold text-[#0A0A0D]">Hidden gem</span>}
        {t.safety_risk && <span className="absolute right-2.5 top-10 rounded-full bg-[var(--brand-5)] px-2 py-0.5 text-[10px] font-semibold text-[#0A0A0D]">Warnings?</span>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-3 pt-12">
          <div className="font-display text-[17px] font-semibold leading-tight text-white">{t.title}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.length === 0 && <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white/80">no genre</span>}
            {tags.map((g) => <span key={g} className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white/85">{g}</span>)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between px-0.5 text-xs text-[var(--muted-foreground)]">
        <span className="tabular-nums">{t.release_year ?? ''} · {t.maturity_rating ?? 'NR'}</span>
        <span className="tabular-nums"><b className="text-[var(--brand-ink)]">{fmtK(Number(t.impressions_4w))}</b> impr.</span>
      </div>
    </button>
  );
}

export function HomeView() {
  const nav = useNavigate();
  const { config } = useSession();
  const [s, setS] = useState<Summary | null>(null);
  const [wall, setWall] = useState<TitleRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => dataMutated.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    fetchSummary().then(setS).catch(() => {});
    fetchTitles({ scope: 'harborlight' }).then((r) => setWall(r.slice(0, 12))).catch(() => setWall([]));
    fetchActivity(6).then(setActivity).catch(() => {});
  }, [tick]);
  const script = config?.assistantScript ?? [];
  const hb = s?.by_source.find((x) => x.source === 'Harborlight Library');
  const rest = s?.by_source.filter((x) => x.source !== 'Harborlight Library') ?? [];
  const restTitles = rest.reduce((a, x) => a + x.titles, 0);
  const restImpsPerTitle = restTitles ? rest.reduce((a, x) => a + Number(x.impressions_4w), 0) / restTitles : 0;
  const restCompletion = restTitles ? rest.reduce((a, x) => a + x.completion_pct * x.titles, 0) / restTitles : null;
  const shareCat = hb && s ? (100 * hb.titles) / s.titles : null;
  const shareImp = hb && s ? (100 * Number(hb.impressions_4w)) / Number(s.impressions_4w) : null;
  const maxIpt = Math.max(1, ...(s?.by_source ?? []).map((x) => x.impressions_per_title));

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-[1240px] px-8 pb-12 pt-8">
        {/* Masthead */}
        <section className="grid gap-10 border-b border-[var(--border)] pb-10 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-[var(--brand-2)]">Orbitline+ · Content operations · The Harborlight shelf</div>
            <h1 className="mt-4 text-[52px] font-semibold leading-[1.02] tracking-tight text-[var(--brand-ink)]">
              We bought 420 Harborlight titles in April. <em className="font-normal italic text-[var(--brand-2)]">Our viewers can’t find them.</em>
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-[var(--muted-foreground)]">
              The library arrived from a legacy vendor feed: “Feature Film” as the only genre, no moods, no talent, no content warnings. Home rows and search
              are tag-driven, so {shareCat != null ? `${Math.round(shareCat)}%` : '30%'} of the catalogue earns {shareImp != null ? `${shareImp.toFixed(1)}%` : '…'} of
              impressions, yet viewers who do find these titles finish them as often as anything else. Nadia Brooks’s team can’t hand-tag 380 titles.
              The Metadata Copilot reads the scenes, Nadia publishes.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={() => nav('/titles/TTL-HB-0117')} className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-2)] px-5 py-2.5 text-sm font-semibold text-[#0A0A0D]">
                Start with The Salt Road <ArrowRight className="size-4" />
              </button>
              <button onClick={() => nav('/titles/TTL-HB-0233')} className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm text-[var(--brand-ink)] hover:border-[var(--brand-5)]">Paper Lanterns · kids row</button>
              <button onClick={() => nav('/library')} className="rounded-full px-3 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--brand-ink)]">Open the queue →</button>
            </div>
          </div>
          <div className="grid grid-cols-2 content-end gap-x-8 gap-y-7 self-end">
            {hb && s ? (
              <>
                <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Share of catalogue</div><div className="font-display text-[44px] font-semibold leading-none tabular-nums">{shareCat!.toFixed(0)}%</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Share of impressions</div><div className="font-display text-[44px] font-semibold leading-none tabular-nums text-[var(--brand-5)]">{shareImp!.toFixed(1)}%</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Avg completeness</div><div className="font-display text-[44px] font-semibold leading-none tabular-nums">{Math.round(hb.avg_completeness)}<span className="text-lg text-[var(--muted-foreground)]">/100</span></div></div>
                <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Finished when watched</div><div className="font-display text-[44px] font-semibold leading-none tabular-nums text-[var(--brand-2)]">{hb.completion_pct}%</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">rest of library {restCompletion != null ? restCompletion.toFixed(1) : '…'}%</div></div>
              </>
            ) : [0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--muted)]" />)}
          </div>
        </section>

        {/* Poster wall */}
        <section className="pt-10">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold">The shelf, as the home row sees it</h2>
            <div className="text-xs text-[var(--muted-foreground)]">Harborlight titles by re-tag priority · ring = metadata completeness</div>
          </div>
          {!wall && <div className="grid grid-cols-6 gap-5">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-[var(--muted)]" />)}</div>}
          {wall?.length === 0 && <div className="text-sm text-[var(--muted-foreground)]">No Harborlight titles in the library mirror yet.</div>}
          <div className="grid grid-cols-3 gap-x-5 gap-y-8 sm:grid-cols-4 xl:grid-cols-6">
            {wall?.map((t) => <Poster key={t.id} t={t} onOpen={() => nav(`/titles/${t.id}`)} />)}
          </div>
        </section>

        {/* Discovery + copilot */}
        <section className="mt-14 grid gap-10 border-t border-[var(--border)] pt-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="font-display text-2xl font-semibold">Impressions per title · last 4 weeks</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{fmtK(Number(s?.impressions_4w ?? 0))} impressions in total</p>
            <div className="mt-6 space-y-5">
              {(s?.by_source ?? []).map((x) => (
                <div key={x.source}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className={x.source === 'Harborlight Library' ? 'font-semibold text-[var(--brand-5)]' : ''}>{x.source}</span>
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)]"><b className="font-display text-base text-[var(--brand-ink)]">{fmtK(x.impressions_per_title)}</b> / title · {x.completion_pct}% finish</span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-[var(--muted)]"><div className="h-1 rounded-full" style={{ width: `${(x.impressions_per_title / maxIpt) * 100}%`, background: SRC_COLOR[x.source] }} /></div>
                </div>
              ))}
            </div>
            {hb && restImpsPerTitle > 0 && (
              <p className="mt-6 font-display text-lg italic leading-snug text-[var(--brand-ink)]">
                A Harborlight title is shown {(restImpsPerTitle / hb.impressions_per_title).toFixed(1)}× less than the rest of the library, yet finishes at the same rate.
                <span className="not-italic text-[var(--muted-foreground)]"> It’s the metadata, not the content.</span>
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 font-display text-2xl font-semibold"><MessagesSquare className="size-5 text-[var(--brand-2)]" />Ask the Copilot</div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Strategy questions go to Genie over the governed tables; rules to the Standards Guide; look-alikes and clips to Vector Search.</p>
            <ol className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {script.map((c, i) => (
                <li key={c.prompt}>
                  <button onClick={() => dockController.openAndSend(c.prompt)} className="group flex w-full items-start gap-4 py-3 text-left">
                    <span className="font-display text-lg italic text-[var(--brand-2)]">{i + 1}</span>
                    <span className="flex-1 text-sm leading-snug text-[var(--brand-ink)] group-hover:text-[var(--brand-2)]">{c.prompt}</span>
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* KPIs + activity */}
        <section className="mt-12 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">
            <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Hidden gems</div><div className="font-display text-4xl font-semibold tabular-nums">{s?.hidden_gems_open ?? '…'}</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">viewers finish them, we rarely show them</div></div>
            <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Safety review</div><div className="font-display text-4xl font-semibold tabular-nums text-[var(--brand-5)]">{s?.safety_open ?? '…'}</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">missing warnings · {s?.kids_row_risk ?? '…'} in kids rows</div></div>
            <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">AI proposals waiting</div><div className="font-display text-4xl font-semibold tabular-nums">{s?.proposals_ready ?? '…'}</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">re-tagged, not yet published</div></div>
            <div><div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Published</div><div className="font-display text-4xl font-semibold tabular-nums text-[var(--success)]">{s?.approved ?? '…'}</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">written back to Lakebase</div></div>
          </div>
          <div>
            <div className="font-display text-2xl font-semibold">Recent workbench activity</div>
            {activity.length === 0 && <div className="mt-3 text-sm text-[var(--muted-foreground)]">Nothing published yet. Open a title and run the AI re-tag.</div>}
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <button onClick={() => nav(`/titles/${a.title_id}`)} className="truncate text-left hover:text-[var(--brand-2)]">
                    <span className="text-[var(--brand-2)]">{ACTION[a.action] ?? a.action}</span> · {a.title} <span className="text-[var(--muted-foreground)]">({a.source})</span>
                  </button>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
