/**
 * "Customer" tab of the drawer. Loyalty + region + prior orders — gives
 * the operator context before they decide on a refund.
 */
import { useEffect, useState } from 'react';
import { fetchCustomerOrders } from '@/lib/returns';
import { TierBadge } from '@/shared/badges';
import type { CustomerOrder, ReturnDetail } from '@/shared/types';

export function CustomerTab({ detail }: { detail: ReturnDetail }) {
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail.customer_id) return;
    fetchCustomerOrders(detail.customer_id, 10)
      .then(setOrders)
      .catch((e) => setError((e as Error).message));
  }, [detail.customer_id]);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Phone: 2-up grid pairs short fields (Tier/Region, Country/Customer since)
          so the drawer doesn't scroll. Email and Customer id span both
          columns since they're long strings. sm+: 1-col stack, each row a
          label/value sub-grid. */}
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <DetailRow label="Name" value={detail.customer_name ?? '—'} />
        <DetailRow label="Email" value={detail.customer_email ?? '—'} full />
        <DetailRow
          label="Tier"
          value={
            detail.loyalty_tier ? <TierBadge tier={detail.loyalty_tier} /> : '—'
          }
        />
        <DetailRow label="Region" value={detail.customer_region ?? '—'} />
        <DetailRow label="Country" value={detail.customer_country ?? '—'} />
        <DetailRow
          label="Customer since"
          value={detail.registration_date ?? '—'}
        />
        <DetailRow label="Customer id" value={detail.customer_id ?? '—'} full />
      </dl>

      {detail.final_tier && detail.premium_prob !== null && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Premium tier (ML)
            </div>
            <span
              className={
                detail.final_tier === 'premium'
                  ? detail.premium_status_labeled === 'premium'
                    ? 'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-primary/15 text-primary'
                    : 'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-primary/8 text-primary border border-primary/30 border-dashed'
                  : 'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-muted text-muted-foreground'
              }
            >
              {detail.final_tier === 'premium'
                ? detail.premium_status_labeled === 'premium'
                  ? 'premium · CS-tagged'
                  : 'premium · hidden (model)'
                : 'standard'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${
                  detail.final_tier === 'premium'
                    ? 'bg-primary'
                    : 'bg-muted-foreground/60'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(0, detail.premium_prob * 100))}%`,
                }}
              />
            </div>
            <div className="font-mono text-xs tabular-nums w-12 text-right">
              {(detail.premium_prob * 100).toFixed(0)}%
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {detail.premium_status_labeled === 'premium' ? (
              <>CS-tagged premium. Model score shown for transparency.</>
            ) : detail.final_tier === 'premium' ? (
              <>
                <span className="font-medium text-foreground">
                  Hidden premium
                </span>{' '}
                — model surfaced this customer; not yet CS-tagged.
              </>
            ) : (
              <>Classified standard by <code>customer_premium_classifier@prod</code>.</>
            )}
            {detail.predicted_at && (
              <>
                {' '}· scored {new Date(detail.predicted_at).toLocaleDateString()}
              </>
            )}
            {detail.coupon_pct_applied !== null && (
              <>
                {' '}· offer applied: <span className="font-mono">{detail.coupon_pct_applied}%</span>
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-2">
          Recent orders
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        {!orders && !error && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {orders && orders.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No other orders on file.
          </div>
        )}
        {orders && orders.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {orders.map((o) => (
              <li
                key={o.order_id}
                className="px-3 py-2 flex items-center justify-between text-sm"
              >
                <div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {o.order_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.order_date ?? '—'} · {o.item_count} item
                    {o.item_count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">
                    ${Number(o.total_usd).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.status ?? ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  full,
}: {
  label: string;
  value: React.ReactNode;
  /** When true, the row spans both columns on phone (used for long strings). */
  full?: boolean;
}) {
  // Phone (parent grid-cols-2): each cell = one field with label above value.
  // sm+ (parent grid-cols-1): each cell becomes a 3-col sub-grid (label 1/3, value 2/3).
  return (
    <div
      className={`flex flex-col sm:grid sm:grid-cols-3 ${
        full ? 'col-span-2 sm:col-span-1' : ''
      }`}
    >
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="sm:col-span-2">{value}</dd>
    </div>
  );
}
