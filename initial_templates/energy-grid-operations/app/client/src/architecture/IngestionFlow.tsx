/**
 * IngestionFlow — card placed beside the Operations page title, telling
 * the viewer where the numbers in the queue (Pending / Approved /
 * Escalated) actually come from:
 *
 *   Data (POS · web · CS) → Zerobus → Pipeline (silver → gold)
 *                        → Lakebase → This app
 *
 * The first node is a bespoke "raw shapes" glyph (no white tile) so it
 * reads as unstructured input rather than a product logo; the rest use
 * the shared <Stage> primitive.
 */
import { Connector, FlowKeyframes, Stage } from './Flow';
import {
  AppsIcon,
  LakebaseIcon,
  LakeflowIcon,
  ZerobusBolt,
} from './icons';

/** Raw "data" glyph — three rows of mixed shapes (dot · square · triangle)
 *  starting scattered on the LEFT and funnelling toward a tight cluster
 *  near the RIGHT edge (where the connector line picks up). Each row gets
 *  its own end-y so the cluster lands on the mid-line (y≈22) but the
 *  drift isn't a perfectly straight triangle — the per-shape staggers
 *  and small Y nudges keep it organic. */
const DataEventsIcon = () => (
  <svg viewBox="0 0 44 44" width="100%" height="100%" overflow="visible">
    <style>{`
      /* Each row funnels: x slides right while y converges toward 22. */
      @keyframes db-data-funnel-top { 0% { transform: translate(-4px, 0); opacity: 0 } 20% { opacity: 1 } 78% { opacity: 1 } 100% { transform: translate(30px, 11px);  opacity: 0 } }
      @keyframes db-data-funnel-mid { 0% { transform: translate(-4px, 0); opacity: 0 } 20% { opacity: 1 } 78% { opacity: 1 } 100% { transform: translate(30px, 0);    opacity: 0 } }
      @keyframes db-data-funnel-bot { 0% { transform: translate(-4px, 0); opacity: 0 } 20% { opacity: 1 } 78% { opacity: 1 } 100% { transform: translate(30px, -11px); opacity: 0 } }
      .db-data-shape { fill: #EF5B3F; }
      .db-row-top { animation: db-data-funnel-top 2.6s linear infinite; }
      .db-row-mid { animation: db-data-funnel-mid 2.6s linear infinite; }
      .db-row-bot { animation: db-data-funnel-bot 2.6s linear infinite; }
      /* per-shape stagger so the stream feels continuous, not pulsed */
      .db-d-a { animation-delay: 0.00s }
      .db-d-b { animation-delay: 0.65s }
      .db-d-c { animation-delay: 1.30s }
      .db-d-d { animation-delay: 1.95s }
    `}</style>
    {/* top row — y≈11, funnels down to ~22 */}
    <circle  className="db-data-shape db-row-top db-d-a" cx="6"  cy="11" r="1.6" />
    <rect    className="db-data-shape db-row-top db-d-c" x="11" y="9.4" width="3.2" height="3.2" rx="0.4" />
    <polygon className="db-data-shape db-row-top db-d-b" points="17,13 21,13 19,9" />

    {/* mid row — y≈22, drifts straight (the target lane) */}
    <rect    className="db-data-shape db-row-mid db-d-b" x="5"  y="20.4" width="3.2" height="3.2" rx="0.4" />
    <polygon className="db-data-shape db-row-mid db-d-d" points="11,24 15,24 13,20" />
    <circle  className="db-data-shape db-row-mid db-d-a" cx="19" cy="22" r="1.6" />

    {/* bottom row — y≈33, funnels up to ~22 */}
    <polygon className="db-data-shape db-row-bot db-d-d" points="5,35 9,35 7,31" />
    <circle  className="db-data-shape db-row-bot db-d-c" cx="13" cy="33" r="1.6" />
    <rect    className="db-data-shape db-row-bot db-d-b" x="17" y="31.4" width="3.2" height="3.2" rx="0.4" />
  </svg>
);

export function IngestionFlow() {
  return (
    <section
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
      aria-label="Live data ingestion pipeline"
    >
      <FlowKeyframes />
      <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
        Order data flows in real time through{' '}
        <b className="text-foreground">Zerobus</b>,{' '}
        <b className="text-foreground">Lakeflow</b>, and{' '}
        <b className="text-foreground">Lakebase</b>.
      </p>

      {/* the pipeline — centered inside the card.
          inner div is inline-flex (width = sum of children) and is centered
          via the outer flex; this works even when sub-labels overhang. */}
      <div className="flex justify-center" style={{ marginBottom: 38 }}>
        <div className="inline-flex items-start" style={{ gap: 2 }}>
          <Stage bare icon={<DataEventsIcon />} name="Data" sub="POS · web · CS" />
          <Connector />
          <Stage
            icon={
              <span style={{ color: '#EF5B3F', display: 'block', width: '100%', height: '100%' }}>
                <ZerobusBolt />
              </span>
            }
            name="Zerobus"
            sub="real-time ingest"
          />
          <Connector />
          <Stage icon={<LakeflowIcon />} name="Pipeline" sub="silver → gold" />
          <Connector />
          <Stage icon={<LakebaseIcon />} name="Lakebase" sub="serverless PG" />
          <Connector />
          <Stage icon={<AppsIcon />} name="This app" sub="Databricks App" />
        </div>
      </div>
    </section>
  );
}
