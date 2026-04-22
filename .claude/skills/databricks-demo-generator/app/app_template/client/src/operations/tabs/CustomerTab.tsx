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
      <dl className="grid grid-cols-3 gap-y-4 text-sm">
        <DetailRow label="Name" value={detail.customer_name ?? '—'} />
        <DetailRow label="Email" value={detail.customer_email ?? '—'} />
        <DetailRow
          label="Tier"
          value={
            detail.loyalty_tier ? <TierBadge tier={detail.loyalty_tier} /> : '—'
          }
        />
        <DetailRow label="Region" value={detail.customer_region ?? '—'} />
        <DetailRow
          label="Customer since"
          value={detail.registration_date ?? '—'}
        />
        <DetailRow label="Customer id" value={detail.customer_id ?? '—'} />
      </dl>

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
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground col-span-1 pt-0.5">
        {label}
      </dt>
      <dd className="col-span-2">{value}</dd>
    </>
  );
}
