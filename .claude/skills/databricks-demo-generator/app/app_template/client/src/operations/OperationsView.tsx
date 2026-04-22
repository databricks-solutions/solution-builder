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
 * Change the use case: swap `server/db/sync.ts`, rename `returns` → your
 * primary entity, update the tabs inside `ReturnDrawer`. The structural
 * pattern (KPIs + filterable table + detail drawer with timeline) holds.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles, ArrowRight } from 'lucide-react';
import { fetchReturns, fetchReturnsSummary } from '@/lib/returns';
import { fetchConfig, type AppConfig } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type {
  ReturnRow,
  ReturnStatus,
  ReturnsSummary,
} from '@/shared/types';

import { KpiCards } from './KpiCards';
import { ReturnsTable } from './ReturnsTable';
import { ReturnDrawer } from './ReturnDrawer';

export function OperationsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const lotFromUrl = searchParams.get('lot') ?? '';

  const [filter, setFilter] = useState<ReturnStatus | 'all'>('pending');
  const [lotFilter, setLotFilter] = useState(lotFromUrl);
  const [search, setSearch] = useState('');

  // Sync lotFilter → URL so deep links + back/forward work.
  useEffect(() => {
    if (lotFilter && lotFilter !== searchParams.get('lot')) {
      setSearchParams({ lot: lotFilter }, { replace: true });
    } else if (!lotFilter && searchParams.get('lot')) {
      const next = new URLSearchParams(searchParams);
      next.delete('lot');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotFilter]);

  // Update state when URL changes (e.g. user clicks a link from Analytics).
  useEffect(() => {
    const urlLot = searchParams.get('lot') ?? '';
    if (urlLot !== lotFilter) setLotFilter(urlLot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [summary, setSummary] = useState<ReturnsSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        fetchReturns({
          status: filter === 'all' ? undefined : filter,
          lot: lotFilter || undefined,
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
  }, [filter, lotFilter]);

  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, lotFilter]);

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
      <div className="max-w-7xl mx-auto px-8 py-10 space-y-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Returns — operations queue
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Work the returns backlog.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Each return is a signal. Approve the refund, reject if invalid, or
            escalate to QA when a lot-level defect is suspected.
          </p>
        </div>

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

        <KpiCards summary={summary} />

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
