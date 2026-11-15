/**
 * Analytics — three warehouse-backed charts that tell the "why" behind the
 * queue (config/queries/*.sql via /api/charts/:key):
 *   1. Expedited 72h compliance by arrival window × channel (weekend fax backlog)
 *   2. Weekly SLA compliance / first-pass-clean / auto-approval rate
 *   3. Pend rate by practice group (provider education vs gold-card candidates)
 */
import { useEffect, useState, type ReactNode } from 'react';
import { BarChart, LineChart } from '@databricks/appkit-ui/react';
import { BRAND_PALETTE } from '@/lib/brand';

function useChart<T = Record<string, unknown>>(key: string) {
  const [s, set] = useState<{ data: T[] | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    fetch(`/api/charts/${key}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b?.error ?? `HTTP ${r.status}`);
        return b.data as T[];
      })
      .then((data) => alive && set({ data, error: null }))
      .catch((e) => alive && set({ data: null, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [key]);
  return s;
}

type Seg = { segment: string; sla_pct: number; requests: number; median_tat_h: number };
type Wk = { week: string; sla_pct: number; auto_approval_pct: number; first_pass_clean_pct: number; median_tat_h: number };
type Grp = { practice_group: string; pend_pct: number; first_pass_clean_pct: number; requests: number };

export function AnalyticsView() {
  const seg = useChart<Seg>('expedited_sla_by_arrival');
  const wk = useChart<Wk>('weekly_trend');
  const grp = useChart<Grp>('practice_group_pends');
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Why the queue looks like this · last 120 days</div>
          <h1 className="text-2xl font-semibold">Prior-auth analytics</h1>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Expedited 72h compliance — arrival window × channel" sub="Faxes that land Friday 3pm–Sunday wait for Monday indexing">
            {seg.error ? <Err e={seg.error} /> : seg.data ? <BarChart data={seg.data} xKey="segment" yKey="sla_pct" colors={[BRAND_PALETTE[0]]} height={280} /> : <Loading />}
          </Card>
          <Card title="Pend rate by practice group (%)" sub="Cascade Spine & Pain: education target · Northside Orthopedic: gold-card candidate">
            {grp.error ? <Err e={grp.error} /> : grp.data ? <BarChart data={grp.data} xKey="practice_group" yKey="pend_pct" colors={[BRAND_PALETTE[4] ?? BRAND_PALETTE[0]]} height={280} /> : <Loading />}
          </Card>
        </div>
        <Card title="Weekly: SLA compliance, first-pass clean and auto-approval rate (%)" sub="~half of requests are clean on first review; the ePA auto-approval pilot started 3 weeks ago">
          {wk.error ? <Err e={wk.error} /> : wk.data ? (
            <LineChart
              data={wk.data.map((r) => ({ week: r.week, 'Within deadline %': r.sla_pct, 'First-pass clean %': r.first_pass_clean_pct, 'Auto-approval %': r.auto_approval_pct }))}
              xKey="week"
              yKey={['Within deadline %', 'First-pass clean %', 'Auto-approval %']}
              colors={BRAND_PALETTE.slice(0, 3)}
              height={300}
              smooth
            />
          ) : <Loading />}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-xs text-muted-foreground mb-3">{sub}</div>
      {children}
    </div>
  );
}
const Loading = () => <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Running on the SQL warehouse…</div>;
const Err = ({ e }: { e: string }) => <div className="text-sm text-destructive">{e}</div>;
