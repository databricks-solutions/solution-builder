/**
 * The Operations page — the WRITE SURFACE for the use case.
 *
 * Template intent: every use case has a "work queue" — rows waiting for a
 * decision + an audit trail of what happened. This page renders that queue
 * from Lakebase (live, writable, transactional) and stays in sync with the
 * agent's actions via the `dataMutated` pub/sub (when the chat stream
 * completes, the queue refetches — so you literally WATCH the agent's
 * writes land here).
 *
 * Responsibility: orchestration only — owns filter/selection state, fetches
 * data, subscribes to `dataMutated`. Sub-components render the pieces:
 *
 *    KpiCards       — pending / approved / escalated at a glance
 *    ReturnsTable   — filterable queue, click a row to open the drawer
 *    ReturnDrawer   — slide-over with 3 tabs (Return / Customer / Activity)
 *
 * The "Ask the assistant about this spike" banner at the top is the
 * contextual bridge back into the floating dock — clicking it opens the
 * assistant with a scripted prompt prefilled. Great for showing how the
 * assistant and the queue are two sides of the same data.
 *
 * ─────────────────────────────────────────────────────────────────────
 * REPURPOSING (when changing the data model)
 * ─────────────────────────────────────────────────────────────────────
 * The structural pattern (KPIs + filterable table + detail drawer with
 * timeline) holds for almost any work-queue use case. To swap entities:
 *
 *   1. Update `client/src/shared/types.ts` (the canonical schema —
 *      every page reads from there).
 *   2. Replace `server/db/queries/returns.ts` with queries for the new
 *      entity. Keep the file name aligned with the domain.
 *   3. Rename / rewrite `client/src/lib/returns.ts` (the fetch helpers
 *      that hit /api/returns, /api/lots, etc.).
 *   4. Rename `routes/returns.ts` and update the `/api/...` paths if
 *      you want them to match the new domain (optional — paths are not
 *      semantic, but it's nicer when they read right).
 *   5. Replace the three drawer tabs (Return / Customer / Activity) in
 *      `tabs/` with whatever your entity's detail view needs.
 *   6. If the demo doesn't have a "queue" use case at all, delete this
 *      page from `App.tsx` routing + remove the sidebar entry.
 *
 * If your use case has NO queue/work-list, delete this whole folder.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import { fetchReturns, fetchReturnsSummary } from '@/lib/returns';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type {
  ReturnRow,
  ReturnStatus,
  ReturnsSummary,
} from '@/shared/types';

import { CityMap } from './CityMap';
import { KpiCards } from './KpiCards';
import { ReturnsTable } from './ReturnsTable';
import { ReturnDrawer } from './ReturnDrawer';
import { IngestionFlow } from '@/architecture/IngestionFlow';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const lotFromUrl = searchParams.get('lot') ?? '';

  const [filter, setFilter] = useState<ReturnStatus | 'all'>('pending');
  const [lotFilter, setLotFilter] = useState(lotFromUrl);
  const [tierFilter, setTierFilter] = useState<'premium' | 'standard' | null>(
    (searchParams.get('tier') as 'premium' | 'standard' | null) ?? null,
  );
  const [countryFilter, setCountryFilter] = useState<string | null>(
    searchParams.get('country') ?? null,
  );
  const [sort, setSort] = useState<'anger' | 'recent' | 'value'>(
    (searchParams.get('sort') as 'anger' | 'recent' | 'value') ?? 'recent',
  );
  const [search, setSearch] = useState('');

  // Sync all queue filters → URL so deep links + back/forward work.
  // Handles lot, tier, country, sort in one pass.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete('lot', lotFilter || null);
    setOrDelete('tier', tierFilter);
    setOrDelete('country', countryFilter);
    // Default sort isn't worth surfacing in the URL.
    setOrDelete('sort', sort === 'recent' ? null : sort);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotFilter, tierFilter, countryFilter, sort]);

  // Update state when URL changes (e.g. user clicks a link from Analytics).
  useEffect(() => {
    const urlLot = searchParams.get('lot') ?? '';
    if (urlLot !== lotFilter) setLotFilter(urlLot);
    const urlTier = searchParams.get('tier') as 'premium' | 'standard' | null;
    if (urlTier !== tierFilter) setTierFilter(urlTier);
    const urlCountry = searchParams.get('country');
    if (urlCountry !== countryFilter) setCountryFilter(urlCountry);
    const urlSort = (searchParams.get('sort') as 'anger' | 'value' | null) ?? 'recent';
    if (urlSort !== sort) setSort(urlSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [summary, setSummary] = useState<ReturnsSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useSession();

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchReturns({
          status: filter === 'all' ? undefined : filter,
          lot: lotFilter || undefined,
          tier: tierFilter ?? undefined,
          country: countryFilter ?? undefined,
          sort,
        }),
        fetchReturnsSummary(),
      ]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, lotFilter, tierFilter, countryFilter, sort]);

  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, lotFilter, tierFilter, countryFilter, sort]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(q) ||
        (r.sku ?? '').toLowerCase().includes(q) ||
        (r.productName ?? '').toLowerCase().includes(q) ||
        (r.returnReason ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
        {/* Title + situation + CTA stack on the LEFT; the IngestionFlow
            sits on the RIGHT spanning the full left stack — denser open
            for the Operations page. Stacks under the title on smaller
            screens. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 lg:items-end">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Returns — operations queue
              </div>
              <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
                Work the returns backlog.
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Each return is a signal. Approve the refund, reject if invalid, or
              escalate to QA when a lot-level defect is suspected.
            </p>
            {config?.assistantScript?.[0] && (
              <button
                onClick={() =>
                  dockController.openAndSend(config.assistantScript[0].prompt)
                }
                className="w-full text-left rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-sm px-5 py-4 transition-all flex items-center gap-4 group"
              >
                <div
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  <Sparkles className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Something feels off
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5">
                    Ask the assistant about this spike
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            )}
          </div>
          <IngestionFlow />
        </div>

        <KpiCards summary={summary} />

        <CityMap status={filter} lot={lotFilter} />

        <ReturnsTable
          rows={filteredRows}
          loading={loading}
          error={error}
          statusFilter={filter}
          onStatusFilter={setFilter}
          search={search}
          onSearch={setSearch}
          lotFilter={lotFilter}
          onLotFilter={setLotFilter}
          tierFilter={tierFilter}
          onTierFilter={setTierFilter}
          countryFilter={countryFilter}
          onCountryFilter={setCountryFilter}
          sort={sort}
          onSortChange={setSort}
          onSelect={setSelectedId}
        />
      </div>

      <ReturnDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onMutated={() => {
          setSelectedId(null);
          void reload();
        }}
      />
    </div>
  );
}
