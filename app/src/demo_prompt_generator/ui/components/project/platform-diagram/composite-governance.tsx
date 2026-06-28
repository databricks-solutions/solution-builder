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

            {/* Genie Ontology — ~half the bar, with a live "context graph" that
                pulses concept/source nodes as Genie explores + scores them. */}
            <div className="flex flex-1 flex-col gap-0.5 overflow-hidden rounded-md border border-border/60 bg-background/70 px-2 py-1">
              <span className="flex items-center gap-1.5 leading-tight">
                <FileSvgIcon iconKey="file:vendor/genie-ontology" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[10px] font-semibold text-foreground">Genie Ontology</span>
                <span className="truncate text-[7.5px] text-muted-foreground">— Genie's context layer</span>
              </span>
              <OntologyGraph />
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});

/** A compact, looping "context graph": a central Genie hub linked to the
 *  concepts + sources it maps (revenue, active user, a table, a dashboard, a
 *  doc). A highlight traverses node→node so it reads as Genie exploring and
 *  scoring context, one snippet at a time. Pure CSS keyframes (cheap; one node
 *  is the "current" focus at any moment), staggered per node. */
function OntologyGraph() {
  const CX = 34;
  const CY = 27;
  // Satellites: [x, y, label]. Spread to the right of the hub.
  const NODES: [number, number, string][] = [
    [108, 7, "revenue"],
    [150, 20, "active user"],
    [156, 42, "qualified lead"],
    [104, 47, "certified source"],
    [82, 27, "table · doc · app"],
  ];
  const N = NODES.length;
  const STEP = 1.1; // seconds each node holds the focus
  const DUR = N * STEP; // full sweep
  return (
    <svg viewBox="0 0 200 54" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      <style>{`
        @keyframes og-edge { 0%,100% { stroke-opacity: .18 } ${100 / N / 2}% { stroke-opacity: .9 } }
        @keyframes og-node { 0%,100% { opacity: .5 } ${100 / N / 2}% { opacity: 1 } }
        @keyframes og-ring { 0% { r: 4; opacity: .8 } 60%,100% { r: 11; opacity: 0 } }
        @keyframes og-hub { 0%,100% { filter: drop-shadow(0 0 1px #FF5F46) } 50% { filter: drop-shadow(0 0 4px #FF5F46) } }
      `}</style>
      {/* edges hub → each satellite */}
      {NODES.map(([x, y], i) => (
        <line
          key={`e${i}`}
          x1={CX} y1={CY} x2={x} y2={y}
          stroke="#FF5F46" strokeWidth={1} strokeOpacity={0.18}
          style={{ animation: `og-edge ${DUR}s ease-in-out infinite`, animationDelay: `${i * STEP}s` }}
        />
      ))}
      {/* satellite nodes + labels */}
      {NODES.map(([x, y, label], i) => (
        <g key={`n${i}`} style={{ animation: `og-node ${DUR}s ease-in-out infinite`, animationDelay: `${i * STEP}s` }}>
          {/* exploration pulse ring */}
          <circle cx={x} cy={y} r={4} fill="none" stroke="#FF5F46" strokeWidth={1}
            style={{ animation: `og-ring ${DUR}s ease-out infinite`, animationDelay: `${i * STEP}s` }} />
          <circle cx={x} cy={y} r={3} fill="#FABFBA" stroke="#FF5F46" strokeWidth={1} />
          <text x={x} y={y - 5.5} textAnchor="middle" fontSize={6.5} fill="currentColor" className="text-muted-foreground">{label}</text>
        </g>
      ))}
      {/* central Genie hub */}
      <circle cx={CX} cy={CY} r={6} fill="#FF5F46" style={{ animation: "og-hub 2.2s ease-in-out infinite" }} />
      <text x={CX} y={CY + 16} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="currentColor" className="text-foreground">Genie</text>
    </svg>
  );
}
