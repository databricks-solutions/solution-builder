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
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, type NodeData } from "./shared";

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

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow ${
          selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"
        }`}
        style={{ borderColor: `${d.bandColor}66` }}
      >
        <div className="flex h-full w-full flex-col gap-1.5 p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* header = Unity Catalog (the top-level governance surface) */}
          <div className="flex items-center gap-1.5">
            <UnityCatalog className="h-4 w-4 shrink-0" />
            <span className="text-[12px] font-bold text-foreground">Unity Catalog</span>
            <span className="truncate text-[8.5px] text-muted-foreground">: Unified governance for Data + AI</span>
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
            <div className="flex flex-1 flex-col gap-0.5 overflow-hidden rounded-md border border-border/60 bg-background/70 px-2 py-1">
              <span className="flex items-center gap-1.5 leading-tight">
                <FileSvgIcon iconKey="file:vendor/genie-ontology" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[10px] font-semibold text-foreground">Genie Ontology</span>
                <span className="ml-auto flex items-center gap-1">
                  {["Metric views", "Glossary", "Domains"].map((c) => (
                    <span key={c} className="rounded bg-muted px-1 py-px text-[7px] font-medium text-muted-foreground">{c}</span>
                  ))}
                </span>
              </span>
              <OntologyGraph />
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
  // Heterogeneous nodes: [x, y, iconKey, label].
  const NODES: { x: number; y: number; icon: keyof typeof DATABRICKS_ICONS; label: string }[] = [
    { x: 92, y: 8, icon: "metricViews", label: "metric" },
    { x: 30, y: 24, icon: "deltaTable", label: "table" },
    { x: 96, y: 40, icon: "businessUser", label: "domain" },
    { x: 158, y: 14, icon: "aibiBrand", label: "dashboard" },
    { x: 162, y: 40, icon: "unstructuredData", label: "glossary" },
  ];
  // Edges as index pairs — the real relationships, NOT a star.
  const EDGES: [number, number][] = [
    [1, 0], // table → metric
    [0, 2], // metric → domain
    [3, 0], // dashboard → metric
    [0, 4], // metric → glossary
    [2, 1], // domain → table
  ];
  const STEP = 0.85; // seconds each edge holds the focus
  const DUR = EDGES.length * STEP;
  const lit = 100 / EDGES.length / 2; // % of cycle an edge stays "lit"
  return (
    <svg viewBox="0 0 192 52" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      <style>{`
        @keyframes og-edge { 0%,100% { stroke-opacity: .16 } ${lit}% { stroke-opacity: .95 } }
        @keyframes og-pop  { 0%,100% { opacity: .55 } ${lit}% { opacity: 1 } }
      `}</style>
      {/* edges (drawn first, under the nodes); each lights up in turn */}
      {EDGES.map(([a, b], i) => (
        <line
          key={`e${i}`}
          x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y}
          stroke="#FF5F46" strokeWidth={1.1} strokeOpacity={0.16}
          style={{ animation: `og-edge ${DUR}s ease-in-out infinite`, animationDelay: `${i * STEP}s` }}
        />
      ))}
      {/* nodes: a product icon in a chip + a tiny label */}
      {NODES.map((n, i) => {
        const Icon = DATABRICKS_ICONS[n.icon];
        // This node's focus delay = the first edge that touches it.
        const ei = EDGES.findIndex(([a, b]) => a === i || b === i);
        return (
          <g key={`n${i}`} style={{ animation: `og-pop ${DUR}s ease-in-out infinite`, animationDelay: `${Math.max(0, ei) * STEP}s` }}>
            <circle cx={n.x} cy={n.y} r={7.5} fill="var(--background)" stroke="#FF5F46" strokeWidth={1} strokeOpacity={0.5} />
            <g transform={`translate(${n.x - 5} ${n.y - 5})`}>
              <Icon width={10} height={10} />
            </g>
            <text x={n.x} y={n.y + 13} textAnchor="middle" fontSize={6} fill="currentColor" className="text-muted-foreground">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
