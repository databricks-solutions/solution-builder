/**
 * platform-diagram/composite-governance — the "Unified Governance" strip.
 *
 * A wide horizontal bar that reads as the platform's single control plane,
 * holding three governed surfaces side by side:
 *   1. Unity Catalog        — the governed catalog (access / lineage / audit).
 *   2. Unity AI Gateway      — every model + agent call governed; shows the
 *      foundation-model logos (OpenAI, Anthropic, Gemini) to convey "access
 *      all foundation models".
 *   3. Genie Ontology        — the semantic layer over the governed data.
 * Footer tagline: lineage · audit · quality · access control.
 * A composite node kind ("governance").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

/** The foundation models surfaced through the AI Gateway. ALWAYS shown (these
 *  marks are integral to the "access any model" story), regardless of the
 *  trademark-logo toggle. */
const FM_LOGOS: { key: string; label: string }[] = [
  { key: "file:vendor/openai", label: "OpenAI" },
  { key: "file:vendor/anthropic", label: "Anthropic" },
  { key: "file:vendor/gemini", label: "Gemini" },
];

export const GovernanceBlock = memo(function GovernanceBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const UnityCatalog = DATABRICKS_ICONS.unityCatalogBrand;
  const AIGateway = DATABRICKS_ICONS.aiGatewayBrand;
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16, borderWidth: 0, shadow: 0 });

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      baseW={nat.w}
      baseH={nat.h}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
      onScale={(w) => d.onResize(d.nodeId, w, Math.round((w * nat.h) / nat.w), w / nat.w)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full flex-col gap-1.5 p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* header = Unity Catalog (the top-level governance surface) */}
          <div className="flex items-baseline gap-1.5">
            <UnityCatalog className="h-4 w-4 shrink-0 self-center" />
            <span className="text-[12px] font-bold text-foreground">Unity Catalog</span>
            <span className="truncate text-[8.5px] text-muted-foreground">Unified governance for Data + AI</span>
          </div>

          {/* governed surfaces below the header: AI Gateway + Genie Ontology
              (the ontology takes ~half the width to fit its live graph). */}
          <div className="flex flex-1 items-stretch gap-2">
            {/* Unity AI Gateway — foundation-model logos (always shown) + chips */}
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2">
              <AIGateway className="h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] font-semibold text-foreground">Unity AI Gateway</span>
                  <span className="flex items-center gap-1">
                    {FM_LOGOS.map((m) => (
                      <FileSvgIcon key={m.key} iconKey={m.key} className="h-3 w-3 shrink-0" />
                    ))}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {["Cost control", "MCP", "Audit"].map((c) => (
                    <span key={c} className="rounded bg-muted px-1 py-px text-[7.5px] font-medium text-muted-foreground">{c}</span>
                  ))}
                </span>
              </span>
            </div>

            {/* Genie Ontology — ~half the bar. Top: the building blocks
                (metric views / glossary / domains). Below: a live graph that
                links them to the tables + dashboards they describe. */}
            <div className="flex flex-1 items-stretch gap-2 overflow-hidden rounded-md border border-border/60 bg-background/70 px-2 py-1">
              {/* left: title + description + building-block chips */}
              <span className="flex w-[52%] shrink-0 flex-col gap-0.5 leading-tight">
                <span className="flex items-center gap-1.5">
                  <FileSvgIcon iconKey="file:vendor/genie-ontology" className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-[10px] font-semibold text-foreground">Genie Ontology</span>
                </span>
                <span className="text-[7.5px] leading-snug text-muted-foreground">
                  Genie's context layer — what the business <em>means</em>.
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {["Metric views", "Glossary", "Domains"].map((c) => (
                    <span key={c} className="rounded bg-muted px-1 py-px text-[7px] font-medium text-muted-foreground">{c}</span>
                  ))}
                </span>
              </span>
              {/* right: the live graph — centered, capped to a small fixed size
                  so it never scales up to fill a wider/taller box. */}
              <div className="flex min-w-0 flex-1 items-center justify-center">
                <OntologyGraph />
              </div>
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});

/** A real (hub-less) ontology graph: heterogeneous nodes — a metric view, the
 *  table it's computed from, the domain it belongs to, a glossary term, and the
 *  dashboard that surfaces it — wired together the way the ontology links them
 *  (metric→table, metric→glossary, table→domain, dashboard→metric). Each node
 *  is a small product icon. A focus pulse walks the EDGES in sequence so it
 *  reads as the graph being traversed. Pure CSS keyframes. */
function OntologyGraph() {
  const R = 8; // node radius
  const NODES: { x: number; y: number; icon: keyof typeof DATABRICKS_ICONS }[] = [
    { x: 50, y: 12, icon: "metricViews" },   // metric view
    { x: 12, y: 38, icon: "deltaTable" },    // table
    { x: 54, y: 44, icon: "businessUser" },  // domain
    { x: 92, y: 12, icon: "aibiBrand" },     // dashboard
    { x: 94, y: 40, icon: "unstructuredData" }, // glossary
  ];
  // Edges as index pairs — the real relationships, NOT a star.
  const EDGES: [number, number][] = [
    [1, 0], // table → metric
    [0, 2], // metric → domain
    [3, 0], // dashboard → metric
    [0, 4], // metric → glossary
    [2, 1], // domain → table
  ];
  // Trim an edge so it starts/ends at the node's rim (R), not its centre — so
  // the line never shows through the circle.
  const seg = (a: number, b: number) => {
    const p = NODES[a], q = NODES[b];
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return { x1: p.x + ux * R, y1: p.y + uy * R, x2: q.x - ux * R, y2: q.y - uy * R };
  };
  const STEP = 0.85; // seconds each edge holds the focus
  const DUR = EDGES.length * STEP;
  const lit = 100 / EDGES.length / 2; // % of cycle an edge stays "lit"
  return (
    <svg
      viewBox="0 0 106 54"
      preserveAspectRatio="xMidYMid meet"
      // Cap to a small fixed size + keep the viewBox aspect, so the graph stays
      // minimal and DOESN'T grow when the governance box is widened/heightened.
      className="h-auto max-h-full w-full"
      style={{ maxWidth: 132, aspectRatio: "106 / 54" }}
    >
      <style>{`
        @keyframes og-edge { 0%,100% { stroke-opacity: .18 } ${lit}% { stroke-opacity: .95 } }
        @keyframes og-pop  { 0%,100% { opacity: .6 } ${lit}% { opacity: 1 } }
      `}</style>
      {/* edges (drawn first, under the nodes); trimmed to the rims + lit in turn */}
      {EDGES.map(([a, b], i) => {
        const s = seg(a, b);
        return (
          <line
            key={`e${i}`}
            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke="#FF5F46" strokeWidth={1.1} strokeLinecap="round" strokeOpacity={0.18}
            style={{ animation: `og-edge ${DUR}s ease-in-out infinite`, animationDelay: `${i * STEP}s` }}
          />
        );
      })}
      {/* nodes: an opaque chip with a product icon (no labels) */}
      {NODES.map((n, i) => {
        const Icon = DATABRICKS_ICONS[n.icon];
        const ei = EDGES.findIndex(([a, b]) => a === i || b === i);
        return (
          <g key={`n${i}`} style={{ animation: `og-pop ${DUR}s ease-in-out infinite`, animationDelay: `${Math.max(0, ei) * STEP}s` }}>
            <circle cx={n.x} cy={n.y} r={R} fill="var(--card)" stroke="#FF5F46" strokeWidth={1} />
            <g transform={`translate(${n.x - 5} ${n.y - 5})`}>
              <Icon width={10} height={10} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
