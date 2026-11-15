/**
 * Campaigns — every live IO with pacing and projected delivery against its audience guarantee.
 * At-risk IOs (projected < 95% = make-good) first, ranked by make-good liability.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Siren } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { HERO_CAMPAIGN, fetchCampaigns, imps, moneyK, pct, type Campaign } from '@/yield/api';
import { StatusPill, cn } from '@/yield/ui';

function PaceBar({ c }: { c: Campaign }) {
  const p = Math.min(1.1, c.projectedDeliveryPct ?? 0);
  return (
    <div className="relative h-2 w-28 rounded-full bg-[var(--muted)]">
      <div className="absolute left-0 top-0 h-2 rounded-full" style={{ width: `${(p / 1.1) * 100}%`, background: c.atRisk ? 'var(--brand-5)' : 'var(--success)' }} />
      <div className="absolute top-[-3px] h-3.5 w-px bg-[var(--foreground)]/50" style={{ left: `${(0.95 / 1.1) * 100}%` }} title="95% make-good threshold" />
    </div>
  );
}

export function CampaignsView() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [onlyRisk, setOnlyRisk] = useState(false);
  const load = () => fetchCampaigns().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  useEffect(() => dataMutated.subscribe(load), []);
  const list = (rows ?? []).filter((c) => !onlyRisk || c.atRisk).sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || (b.makeGoodLiability ?? 0) - (a.makeGoodLiability ?? 0) || b.bookedRevenue - a.bookedRevenue);
  const risk = (rows ?? []).filter((c) => c.atRisk);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Guaranteed deals · pacing to flight end</div>
            <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Campaigns at risk</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {rows ? <><b className="text-[var(--brand-5)]">{risk.length}</b> of {rows.length} live IOs are projected below 95% of their guarantee — <b>{moneyK(risk.reduce((a, c) => a + (c.makeGoodLiability ?? 0), 0))}</b> of make-good liability.</> : 'Loading…'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} />Only at-risk IOs</label>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>{['Campaign', 'Audience', 'Booked', 'Pacing', 'Projected at flight end', 'Shortfall', 'Liability', 'Days left', 'Status'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!rows && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={9} className="px-3 py-2"><div className="h-6 rounded bg-[var(--muted)] animate-pulse" /></td></tr>)}
              {list.map((c) => (
                <tr key={c.id} onClick={() => nav(`/campaigns/${c.id}`)} data-campaign={c.id}
                  className={cn('cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]/60', c.id === HERO_CAMPAIGN && 'bg-[rgb(255_77_94/0.09)]')}>
                  <td className="px-3 py-2"><div className="flex items-center gap-1.5 font-medium">{c.atRisk && <Siren className="size-3.5 text-[var(--brand-5)]" />}{c.name}</div><div className="text-[11px] text-[var(--muted-foreground)]">{c.ioNumber} · {c.dealType} · {c.agency}</div></td>
                  <td className="px-3 py-2 text-xs">{c.targetSegment}</td>
                  <td className="px-3 py-2 tabular-nums">{imps(c.bookedImpressions)}<div className="text-[11px] text-[var(--muted-foreground)]">{moneyK(c.bookedRevenue)}</div></td>
                  <td className="px-3 py-2 tabular-nums">{pct(c.pacing)}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><PaceBar c={c} /><span className={cn('tabular-nums', c.atRisk && 'font-semibold text-[var(--brand-5)]')}>{pct(c.projectedDeliveryPct)}</span></div></td>
                  <td className="px-3 py-2 tabular-nums">{(c.projectedShortfall ?? 0) > 0 ? imps(c.projectedShortfall) : '—'}</td>
                  <td className={cn('px-3 py-2 tabular-nums', c.atRisk && 'font-semibold')}>{c.atRisk ? moneyK(c.makeGoodLiability) : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{c.daysRemaining}</td>
                  <td className="px-3 py-2"><StatusPill status={c.status} atRisk={c.atRisk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
