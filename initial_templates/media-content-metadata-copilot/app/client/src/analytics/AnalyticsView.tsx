/**
 * Analytics — the content-strategy proof, straight from the Delta gold tables via the SQL
 * warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. weekly impressions per title: the 40 July-pilot titles vs the rest of Harborlight vs the library
 *   2. metadata completeness band vs impressions per title and completion rate
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { Pill, cn, fmtK } from '@/titles/ui';

function useChart<T>(key: string) {
  const [s, set] = useState<{ data: T[] | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    fetch(`/api/charts/${key}`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error ?? `HTTP ${r.status}`); return b.data as T[]; })
      .then((data) => set({ data, error: null }))
      .catch((e) => set({ data: null, error: (e as Error).message }));
  }, [key]);
  return s;
}

type Weekly = { week: string; pilot_retagged: number; harborlight_not_retagged: number; rest_of_library: number };
type Band = { completeness_band: string; titles: number; impressions_per_title: number; completion_pct: number };
const PILOT_WEEK = '2026-07-27';
const SERIES = [
  { k: 'rest_of_library', label: 'Rest of library', color: 'var(--primary-light)', w: 2.5 },
  { k: 'pilot_retagged', label: 'Harborlight — re-tagged in the July pilot (40)', color: 'var(--success)', w: 3 },
  { k: 'harborlight_not_retagged', label: 'Harborlight — not re-tagged (380)', color: 'var(--brand-5)', w: 3 },
] as const;

function WeeklyChart({ rows }: { rows: Weekly[] }) {
  const W = 760, H = 250, L = 48, B = 28, T = 14;
  const max = Math.max(1, ...rows.flatMap((r) => [r.pilot_retagged, r.harborlight_not_retagged, r.rest_of_library].map(Number)));
  const x = (i: number) => L + (i * (W - L - 12)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (k: keyof Weekly) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(r[k]))}`).join(' ');
  const pi = rows.findIndex((r) => r.week.slice(0, 10) === PILOT_WEEK);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map((v) => (
        <g key={v}><line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{fmtK(v)}</text></g>
      ))}
      {pi >= 0 && (
        <g>
          <line x1={x(pi)} x2={x(pi)} y1={T} y2={H - B} stroke="var(--success)" strokeDasharray="4 4" />
          <text x={x(pi) + 4} y={T + 10} fontSize="10" fill="var(--success)">July re-tag pilot</text>
        </g>
      )}
      {SERIES.map((s) => <path key={s.k} d={path(s.k)} fill="none" stroke={s.color} strokeWidth={s.w} />)}
      {rows.map((r, i) => (i % 3 === 0 ? (
        <text key={r.week} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
          {new Date(`${r.week.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
        </text>
      ) : null))}
    </svg>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const weekly = useChart<Weekly>('weekly_impressions_by_group');
  const bands = useChart<Band>('completeness_vs_engagement');
  const maxI = Math.max(1, ...(bands.data ?? []).map((b) => Number(b.impressions_per_title)));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Content strategy · Daniel Okafor</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Discovery &amp; re-tag impact</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-semibold">Weekly impressions per title since the Harborlight library went live</div>
            <div className="flex flex-wrap gap-3 text-xs">{SERIES.map((s) => <span key={s.k} className="font-semibold" style={{ color: s.color }}>● {s.label}</span>)}</div>
          </div>
          {weekly.error && <div className="mt-3 text-sm text-[var(--destructive)]">{weekly.error}</div>}
          {!weekly.data && !weekly.error && <div className="mt-3 h-56 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {weekly.data && <WeeklyChart rows={weekly.data} />}
          <p className="text-xs text-[var(--muted-foreground)]">Same library, same quality, same weeks — the only difference between the green and red lines is that editors fixed the metadata.</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-3 font-semibold">Metadata completeness vs discovery <span className="text-xs font-normal text-[var(--muted-foreground)]">· last 4 complete weeks, all 1,400 titles</span></div>
          {bands.error && <div className="px-5 pb-4 text-sm text-[var(--destructive)]">{bands.error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Completeness band', 'Titles', 'Impressions per title', '', 'Completion rate'].map((h, i) => <th key={i} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(bands.data ?? []).map((b) => (
                <tr key={b.completeness_band} className={cn('border-t border-[var(--border)]', b.completeness_band.startsWith('1') && 'bg-[rgb(255_107_87/0.07)]')}>
                  <td className="px-4 py-2 font-medium">{b.completeness_band.replace(/^\d\.\s*/, '')}</td>
                  <td className="px-4 py-2 tabular-nums">{b.titles}</td>
                  <td className="px-4 py-2 tabular-nums font-semibold">{fmtK(Number(b.impressions_per_title))}</td>
                  <td className="px-4 py-2 w-[40%]"><div className="h-3 rounded-full bg-[var(--muted)]"><div className="h-3 rounded-full" style={{ width: `${(Number(b.impressions_per_title) / maxI) * 100}%`, background: b.completeness_band.startsWith('1') ? 'var(--brand-5)' : 'var(--primary-light)' }} /></div></td>
                  <td className="px-4 py-2 tabular-nums">{b.completion_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
