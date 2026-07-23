/**
 * RtPitch — header panel for the Operations Analytics page.
 *
 *   LEFT : Lakehouse ⚡RT pitch (why these charts are real-time)
 *   RIGHT: orders → Zerobus → Lakeflow → Lakehouse RT → {AI/BI, Genie}
 *          with a Genie Ontology tile tucked underneath.
 *
 * Optional `warehouse` prop hooks the warehouse name/state into the
 * live pill. Pass null while loading; the pill shows "warming…".
 */
import { Connector, FlowKeyframes, Fork, Stage } from './Flow';
import {
  AIBIIcon,
  GenieIcon,
  GenieOntologyIcon,
  LakeflowIcon,
  LakehouseIcon,
  RtBadge,
  ScanIcon,
} from './icons';

export type RtPitchWarehouse = {
  name: string;
  state: string | null | undefined;
  /** Optional warehouse size (Small / Medium / …). Surfaced in the pill's
   *  hover tooltip; pass when known so users can hover to see it. */
  size?: string;
};

/** Left padding nudges the right rail away from the panel's vertical
 *  divider so the upstream chain doesn't sit flush against the pitch copy.
 *  Used for both the rail and the Genie Ontology pill below it, so they
 *  align on the same x-axis. */
const RAIL_LEFT_PAD = 60;

function StatePill({ wh, latencyMs }: { wh: RtPitchWarehouse | null; latencyMs: number | null }) {
  const state = wh?.state ?? '…';
  const ok = state === 'RUNNING';
  const color = ok
    ? 'var(--status-running, oklch(0.78 0.15 150))'
    : state === 'STARTING'
      ? 'var(--status-starting, oklch(0.82 0.16 80))'
      : 'var(--muted-foreground)';
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm"
      title={wh ? `${wh.name}${wh.size ? ' · ' + wh.size : ''}` : 'warehouse'}
    >
      <span
        className="inline-block size-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="text-muted-foreground">{wh?.name ?? 'Lakehouse warehouse'}</span>
      <span style={{ color, fontFamily: '"DM Mono", monospace', fontSize: 11, fontWeight: 600 }}>
        {state}
      </span>
      {latencyMs != null && (
        <span className="text-xs text-muted-foreground">
          · {latencyMs} ms
        </span>
      )}
    </span>
  );
}

export function RtPitch({
  warehouse,
  latencyMs,
}: {
  warehouse: RtPitchWarehouse | null;
  latencyMs?: number | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-card px-5 sm:px-6 pt-5 sm:pt-6 pb-6 sm:pb-8">
      <FlowKeyframes />

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6 lg:gap-8">
        {/* LEFT — pitch */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex items-center gap-3">
            <div style={{ width: 36, height: 36, flexShrink: 0 }}>
              <LakehouseIcon />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center">
                Lakehouse <RtBadge />
              </div>
              <h2 className="display text-2xl sm:text-3xl font-semibold leading-tight">
                Real-time analytics, built into the app.
              </h2>
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            These charts are rendered <b className="text-foreground">inside this product</b> with a
            charting library — served straight off the governed gold tables by a serverless
            Databricks SQL warehouse.{' '}
            <b className="text-foreground">~100 ms</b> queries, scaling to{' '}
            <b className="text-foreground">thousands of concurrent users</b>, with no copies.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-1">
            <StatePill wh={warehouse} latencyMs={latencyMs ?? null} />
            <div className="flex items-center gap-5 text-xs text-muted-foreground">
              <span><b className="text-foreground text-base font-semibold">∞</b> concurrent users</span>
              <span><b className="text-foreground text-base font-semibold">0</b> data copies</span>
            </div>
          </div>
        </div>

        {/* RIGHT — flow: Orders → Lakeflow → Lakehouse → fork{AI/BI, Genie}
            The fork is the visually-tallest element (130px). The upstream
            chain (Orders → Lakeflow → Lakehouse) is shifted down 43px so
            the fork's trunk (y=65 within itself) aligns with the upstream
            44px tile centers (y=22 within the tile). The right column tiles
            land on the fork's branch endpoints (y=22 top, y=108 bottom) via
            `justify-content: space-between` on the 130-tall column. */}
        <div className="min-w-0">
          <div className="flex items-start" style={{ gap: 2, paddingLeft: RAIL_LEFT_PAD }}>
            <div style={{ paddingTop: 43, display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              <Stage icon={<ScanIcon />} name="Orders" sub="POS · web · CS" />
              <Connector />
              <Stage icon={<LakeflowIcon />} name="Lakeflow" sub="streaming ETL" />
              <Connector />
              <Stage icon={<LakehouseIcon />} name="Lakehouse" sub="RT warehouse" />
            </div>
            <Fork />
            <div
              className="flex flex-col"
              style={{ height: 130, justifyContent: 'space-between', flexShrink: 0 }}
            >
              <Stage icon={<AIBIIcon />} name="AI/BI" sub="dashboards" />
              <Stage icon={<GenieIcon />} name="Genie" sub="ask questions" />
            </div>
          </div>

          <div className="mt-6" style={{ paddingLeft: RAIL_LEFT_PAD }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs">
              <span style={{ width: 22, height: 22 }}><GenieOntologyIcon /></span>
              <span className="font-semibold">Genie Ontology</span>
              <span className="text-muted-foreground">· the semantic layer</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
