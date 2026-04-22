/**
 * The filterable returns table. Status filter chips + search + lot chip +
 * the row list itself. Click a row → opens the detail drawer.
 */
import { Search } from 'lucide-react';
import type { ReturnRow, ReturnStatus } from '@/shared/types';
import { StatusBadge, TierBadge } from '@/shared/badges';

const STATUS_TABS: { value: ReturnStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'escalated', label: 'Escalated' },
];

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr
          key={i}
          className="border-t border-border"
          style={{ animation: `skelPulse 1.2s ease-in-out ${i * 60}ms infinite` }}
        >
          <td className="px-4 py-3">
            <div className="h-3 w-40 rounded bg-muted" />
            <div className="mt-1.5 h-2 w-24 rounded bg-muted/70" />
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-36 rounded bg-muted" />
            <div className="mt-1.5 h-2 w-28 rounded bg-muted/70" />
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-28 rounded bg-muted" />
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-40 rounded bg-muted" />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="h-3 w-14 rounded bg-muted ml-auto" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-16 rounded-full bg-muted" />
          </td>
        </tr>
      ))}
      <style>{`
        @keyframes skelPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

type Props = {
  rows: ReturnRow[];
  loading: boolean;
  error: string | null;
  statusFilter: ReturnStatus | 'all';
  onStatusFilter: (s: ReturnStatus | 'all') => void;
  search: string;
  onSearch: (s: string) => void;
  lotFilter: string;
  onLotFilter: (lot: string) => void;
  onSelect: (id: string) => void;
};

export function ReturnsTable({
  rows,
  loading,
  error,
  statusFilter,
  onStatusFilter,
  search,
  onSearch,
  lotFilter,
  onLotFilter,
  onSelect,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Status filter"
          className="relative inline-flex rounded-full border border-border bg-card p-0.5 text-sm"
        >
          {STATUS_TABS.map((s) => {
            const active = statusFilter === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onStatusFilter(s.value)}
                aria-pressed={active}
                className={`relative z-10 rounded-full px-3 py-1 transition-colors duration-200 ${
                  active
                    ? 'text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-full bg-foreground transition-all"
                    style={{ viewTransitionName: 'status-tab-active' }}
                    aria-hidden
                  />
                )}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, SKU, reason…"
            className="bg-transparent outline-none w-60 placeholder:text-muted-foreground"
          />
        </div>
        {lotFilter && (
          <button
            onClick={() => onLotFilter('')}
            className="text-xs rounded-full px-2 py-1 bg-muted text-foreground"
          >
            Lot: {lotFilter} ✕
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        {loading && (
          <div
            className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden"
            aria-hidden
          >
            <div
              className="h-full w-1/3 rounded-full"
              style={{
                background: 'var(--primary)',
                animation: 'loadingBar 1.1s ease-in-out infinite',
              }}
            />
          </div>
        )}
        <div
          className={`transition-opacity duration-150 ${
            loading && rows.length > 0 ? 'opacity-70' : 'opacity-100'
          }`}
        >
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Customer</th>
              <th className="text-left px-4 py-2 font-semibold">Product</th>
              <th className="text-left px-4 py-2 font-semibold">Lot</th>
              <th className="text-left px-4 py-2 font-semibold">Reason</th>
              <th className="text-right px-4 py-2 font-semibold">Value</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <SkeletonRows />}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No returns match the current filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="cursor-pointer border-t border-border hover:bg-muted/50 transition-colors"
              >
                <td className="px-4 py-2">
                  <div className="font-medium">{r.customerName}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {r.loyaltyTier && <TierBadge tier={r.loyaltyTier} />}
                    {r.region ?? ''}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium">{r.productName ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.category ?? ''} · {r.sku ?? ''}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLotFilter(r.lot ?? '');
                    }}
                    className="font-mono text-xs text-muted-foreground hover:text-foreground"
                  >
                    {r.lot ?? '—'}
                  </button>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {r.returnReason ?? '—'}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  ${r.returnValueUsd}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
