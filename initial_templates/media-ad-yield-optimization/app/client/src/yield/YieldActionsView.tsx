/**
 * Yield actions — the write-back tables in Lakebase: approved recovery plans (sent to ad ops) and
 * queued floor-price changes.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FolderCheck, Repeat2, Tags } from 'lucide-react';
import { dataMutated } from '@/lib/events';
import { cpm, who, fetchFloorChanges, fetchPlans, imps, moneyK, type FloorChange, type YieldPlan } from '@/yield/api';
import { Pill } from '@/yield/ui';

export function YieldActionsView() {
  const [plans, setPlans] = useState<YieldPlan[] | null>(null);
  const [floors, setFloors] = useState<FloorChange[] | null>(null);
  const load = () => {
    fetchPlans().then(setPlans).catch(() => setPlans([]));
    fetchFloorChanges().then(setFloors).catch(() => setFloors([]));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => dataMutated.subscribe(load), []);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Written back to Lakebase</div>
          <h1 className="font-display text-3xl font-semibold text-[var(--primary)]">Yield actions</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Recovery plans approved by the yield desk and the floor-price changes queued for ad ops.</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold"><FolderCheck className="size-4 text-[var(--success)]" />Recovery plans</div>
          {plans?.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">No plan approved yet — open an at-risk IO and build its recovery plan.</div>}
          {plans?.map((p) => (
            <div key={p.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4" data-plan={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-[var(--muted-foreground)]">{p.id} · {p.advertiserName} · approved by {who(p.approvedBy)} via {p.approvedVia} · {new Date(p.createdAt).toLocaleString()}</div>
                  <Link to={`/campaigns/${p.campaignId}`} className="font-semibold hover:underline">{p.title}</Link>
                </div>
                <Pill tone="good">Sent to ad ops</Pill>
              </div>
              <div className="mt-2 grid gap-1 text-sm">
                {p.reallocations.map((r) => <div key={r.product_id} className="flex items-center gap-2"><Repeat2 className="size-3.5 text-[var(--primary-light)]" />{imps(r.impressions)} → {r.product_name} <span className="text-xs text-[var(--muted-foreground)]">(cap {imps(r.daily_cap)}/day)</span></div>)}
                {p.floorChanges.map((f) => <div key={f.product_id} className="flex items-center gap-2"><Tags className="size-3.5 text-[var(--brand-5)]" />{f.product_name}: {f.from_group} {cpm(f.from_floor)} → {f.to_group} {cpm(f.to_floor)}</div>)}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span>liability avoided <b>{moneyK(p.liabilityAvoided)}</b></span>
                <span>programmatic displaced <b>{moneyK(p.displacedRevenue)}</b></span>
                <span>floor fix <b>+{moneyK(p.floorUplift)}</b></span>
                <span>net <b className="text-[var(--success)]">{moneyK(p.netImpact)}</b></span>
                {p.notes && <span className="text-[var(--muted-foreground)]">note: {p.notes}</span>}
              </div>
              {p.agencyNotice && (
                <details className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium">Agency notice</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed">{p.agencyNotice}</pre>
                </details>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold"><Tags className="size-4 text-[var(--brand-5)]" />Floor-price changes</div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>{['Change', 'Product', 'From', 'To', 'Release from', 'Expected +30 days', 'Requested', 'Status'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {floors?.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">No floor change queued.</td></tr>}
                {floors?.map((f) => (
                  <tr key={f.id} className="border-t border-[var(--border)]" data-floor-change={f.id}>
                    <td className="px-3 py-2 font-medium">{f.id}<div className="text-[11px] text-[var(--muted-foreground)]">{f.planId ?? 'from the yield board'}</div></td>
                    <td className="px-3 py-2">{f.productName}</td>
                    <td className="px-3 py-2 text-xs">{f.fromGroup} {cpm(f.fromFloor)}</td>
                    <td className="px-3 py-2 text-xs font-semibold">{f.toGroup} {cpm(f.toFloor)}</td>
                    <td className="px-3 py-2 text-xs">{f.releaseFromDeal ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-[var(--success)]">{f.planId ? '—' : `+${moneyK(f.expectedUplift30d)}`}</td>
                    <td className="px-3 py-2 text-xs">{who(f.requestedBy)}<div className="text-[11px] text-[var(--muted-foreground)]">{new Date(f.createdAt).toLocaleString()}</div></td>
                    <td className="px-3 py-2"><Pill tone="warn">Pending ad ops</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
