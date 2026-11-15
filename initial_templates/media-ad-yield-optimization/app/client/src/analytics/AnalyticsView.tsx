/**
 * Revenue & forecast — the SVP Ad Revenue's numbers, straight from the Delta gold tables via the
 * SQL warehouse (/api/charts/<key> → config/queries/<key>.sql):
 *   1. weekly ad revenue by channel (guaranteed / PMP / open auction) + sell-through
 *   2. Crest+ Live Sports: programmatic eCPM vs open-auction clearing vs rate card, weekly
 *   3. avails actual vs ai_forecast for Crest+ Live Sports and ACN Prime Drama
 *   4. programmatic eCPM as a share of rate card, per product
 */
import { useEffect, useState } from 'react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { cpm, imps, moneyK, pct } from '@/yield/api';
import { Pill, cn } from '@/yield/ui';

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

type Mix = { week: string; guaranteed: number; pmp: number; open_auction: number; sell_through: number };
type Sports = { week: string; programmatic_ecpm: number; open_clearing: number | null; rate_card: number; inventory_group: string };
type Fc = { product_id: string; week: string; avails: number; kind: 'actual' | 'forecast' };
type Card = { product_name: string; tier: string; rate_card_cpm: number; programmatic_ecpm: number; open_clearing: number; current_inventory_group: string; group_mismatch: boolean | string; pct_of_rate_card: number };

const dateLabel = (w: string) => new Date(`${w.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function Card({ title, sub, children, error }: { title: string; sub?: string; children: React.ReactNode; error?: string | null }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="font-semibold">{title} {sub && <span className="text-xs font-normal text-[var(--muted-foreground)]">· {sub}</span>}</div>
      {error && <div className="mt-2 text-sm text-[var(--destructive)]">{error}</div>}
      {children}
    </div>
  );
}

function MixChart({ rows }: { rows: Mix[] }) {
  const W = 720, H = 230, L = 48, B = 26, T = 10;
  const max = Math.max(1, ...rows.map((r) => r.guaranteed + r.pmp + r.open_auction));
  const bw = (W - L - 10) / rows.length;
  const y = (v: number) => (v / max) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - 10} y1={H - B - f * (H - T - B)} y2={H - B - f * (H - T - B)} stroke="var(--border)" /><text x={L - 6} y={H - B - f * (H - T - B) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{moneyK(max * f)}</text></g>))}
      {rows.map((r, i) => {
        const x = L + i * bw + 2;
        const g = y(r.guaranteed), p = y(r.pmp), o = y(r.open_auction);
        return (
          <g key={r.week}>
            <title>{`${r.week}: guaranteed ${moneyK(r.guaranteed)} · PMP ${moneyK(r.pmp)} · open ${moneyK(r.open_auction)} · sell-through ${pct(r.sell_through)}`}</title>
            <rect x={x} width={bw - 4} y={H - B - g} height={g} fill="var(--brand-2)" />
            <rect x={x} width={bw - 4} y={H - B - g - p} height={p} fill="var(--brand-5)" />
            <rect x={x} width={bw - 4} y={H - B - g - p - o} height={o} fill="var(--brand-3)" />
            {i % 4 === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{dateLabel(r.week)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function SportsChart({ rows }: { rows: Sports[] }) {
  const W = 720, H = 230, L = 40, B = 26, T = 10;
  const max = Math.ceil(Math.max(1, ...rows.map((r) => Math.max(r.rate_card, r.open_clearing ?? 0))) / 10) * 10;
  const x = (i: number) => L + (i * (W - L - 10)) / Math.max(1, rows.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (vals: Array<number | null>) => vals.map((v, i) => (v == null ? '' : `${i ? 'L' : 'M'}${x(i)},${y(v)}`)).join(' ');
  const change = rows.findIndex((r, i) => i > 0 && r.inventory_group !== rows[i - 1].inventory_group);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, max / 2, max].map((v) => <g key={v}><line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">${v}</text></g>)}
      {rows[0] && <line x1={L} x2={W - 10} y1={y(rows[0].rate_card)} y2={y(rows[0].rate_card)} stroke="var(--brand-4)" strokeDasharray="5 4" strokeWidth="1.5" />}
      {change > 0 && <><line x1={x(change - 0.5)} x2={x(change - 0.5)} y1={T} y2={H - B} stroke="var(--brand-5)" strokeDasharray="3 3" /><text x={x(change - 0.5) + 4} y={H - B - 6} fontSize="12" fill="var(--brand-5)">ad-server migration → {rows[change].inventory_group}</text></>}
      <path d={path(rows.map((r) => r.open_clearing))} fill="none" stroke="var(--brand-3)" strokeWidth="2.5" />
      <path d={path(rows.map((r) => r.programmatic_ecpm))} fill="none" stroke="var(--brand-5)" strokeWidth="3" />
      {rows.map((r, i) => i % 4 === 0 && <text key={r.week} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{dateLabel(r.week)}</text>)}
    </svg>
  );
}

function ForecastChart({ rows, product, label }: { rows: Fc[]; product: string; label: string }) {
  const r = rows.filter((x) => x.product_id === product);
  const max = Math.max(1, ...r.map((x) => x.avails));
  return (
    <div>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-2 flex h-28 items-end gap-1">
        {r.map((x) => (
          <div key={x.week + x.kind} className="flex h-full flex-1 flex-col justify-end" title={`${x.kind} · week of ${x.week}: ${imps(x.avails)}`}>
            <div className={cn('w-full rounded-t', x.kind === 'forecast' && 'border-2 border-dashed border-[var(--primary-light)]')} style={{ height: `${Math.max(2, (x.avails / max) * 100)}%`, background: x.kind === 'actual' ? 'var(--primary-light)' : 'color-mix(in oklab, var(--primary-light) 18%, transparent)' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">{r.map((x, i) => <div key={x.week + x.kind} className="flex-1 text-center text-[9px] text-[var(--muted-foreground)]">{i % 3 === 0 ? dateLabel(x.week) : ''}</div>)}</div>
    </div>
  );
}

export function AnalyticsView() {
  const [wh, setWh] = useState<Warehouse | null>(null);
  useEffect(() => { fetchWarehouse().then(setWh).catch(() => {}); }, []);
  const mix = useChart<Mix>('weekly_revenue_mix');
  const sports = useChart<Sports>('sports_ecpm_weekly');
  const fc = useChart<Fc>('avails_forecast');
  const card = useChart<Card>('ecpm_vs_rate_card');
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">SVP Ad Revenue · Jordan Ellis</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Revenue &amp; forecast</h1>
          </div>
          {wh?.name && <Pill tone="info">SQL warehouse: {wh.name} · {wh.state}</Pill>}
        </div>
        <Card title="Weekly ad revenue by channel" sub="last 26 weeks" error={mix.error}>
          <div className="mt-1 flex gap-3 text-xs"><span className="font-semibold text-[var(--brand-2)]">■ Guaranteed IOs</span><span className="font-semibold text-[var(--brand-5)]">■ PMP deals</span><span className="font-semibold text-[var(--brand-3)]">■ Open auction</span></div>
          {!mix.data && !mix.error && <div className="mt-3 h-52 rounded-xl bg-[var(--muted)] animate-pulse" />}
          {mix.data && <MixChart rows={mix.data} />}
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Crest+ Live Sports — programmatic eCPM" sub="weekly" error={sports.error}>
            <div className="mt-1 flex gap-3 text-xs"><span className="font-semibold text-[var(--brand-5)]">● Programmatic eCPM</span><span className="font-semibold text-[var(--brand-3)]">● Open-auction clearing</span><span className="font-semibold text-[var(--brand-4)]">- - Rate card</span></div>
            {!sports.data && !sports.error && <div className="mt-3 h-52 rounded-xl bg-[var(--muted)] animate-pulse" />}
            {sports.data && <SportsChart rows={sports.data} />}
          </Card>
          <Card title="Avails — actual vs ai_forecast" sub="last 10 weeks + next 6" error={fc.error}>
            {!fc.data && !fc.error && <div className="mt-3 h-52 rounded-xl bg-[var(--muted)] animate-pulse" />}
            {fc.data && (
              <div className="mt-3 space-y-4">
                <ForecastChart rows={fc.data} product="STR-SPORTS-LIVE" label="Crest+ Live Sports — spare avails for the make-good" />
                <ForecastChart rows={fc.data} product="LIN-PRIME-DRAMA" label="ACN Prime Drama — the audience Harbor Lights lost" />
                <div className="text-[11px] text-[var(--muted-foreground)]">Solid = actual weekly avails · dashed = ai_forecast (gold_avails_forecast)</div>
              </div>
            )}
          </Card>
        </div>
        <Card title="Programmatic eCPM vs rate card" sub="last 28 days" error={card.error}>
          <div className="mt-3 space-y-1.5">
            {(card.data ?? []).map((r) => {
              const bad = r.group_mismatch === true || r.group_mismatch === 'true';
              return (
                <div key={r.product_name} className="grid grid-cols-[260px_1fr_170px] items-center gap-3 text-sm">
                  <span className={cn('truncate', bad && 'font-semibold text-[var(--brand-5)]')}>{r.product_name}</span>
                  <div className="h-3 rounded-full bg-[var(--muted)]"><div className="h-3 rounded-full" style={{ width: `${Math.min(100, r.pct_of_rate_card * 100)}%`, background: bad ? 'var(--brand-5)' : 'var(--primary-light)' }} /></div>
                  <span className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">{cpm(r.programmatic_ecpm)} of {cpm(r.rate_card_cpm)} · {pct(r.pct_of_rate_card)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
