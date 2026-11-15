/**
 * platform-diagram/composite-governance — the "Unified Governance" strip.
 *
 * A wide horizontal bar that reads as the platform's single control plane,
 * holding up to three governed surfaces side by side. Each is an OPT-OUT
 * `params` boolean (absent/true = shown, false = hidden; no params → all three):
 *   1. `access_control`  — ACL · ABAC · Audit across Data + AI.
 *   2. `ai_gateway`      — Unity AI Gateway: every model/agent call governed;
 *      shows the foundation-model logos (OpenAI, Anthropic, Gemini).
 *   3. `genie_ontology`  — the semantic layer over the governed data.
 * Unity Catalog stays the header. Each SHOWN surface exposes a top + bottom
 * anchor handle (`@acl`/`@ai-gateway`/`@ontology`, + `-b` for bottom) so an edge
 * can wire to that surface — mirrors the medallion's per-fork handles.
 * A composite node kind ("governance").
 */
import { memo, useContext, useEffect, useRef } from "react";
import { type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { governanceSurfaces } from "@/lib/platform-architecture";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, ConnectionDot, dotsOn, type NodeData } from "./shared";

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
  const slide = d.theme === "slide";
  const nat = baseSize(d.component, d.params, d.theme);
  const UnityCatalog = DATABRICKS_ICONS.unityCatalogBrand;
  const AIGateway = DATABRICKS_ICONS.aiGatewayBrand;
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16, borderWidth: 1, shadow: 0 });

  // Opt-out surfaces (absent/true = shown, false = hidden; no params → all 3).
  const s = governanceSurfaces(d.params);
  const showAcl = !!s.acl, showGateway = !!s.gateway, showOntology = !!s.ontology;

  // The exposed handle SET changes with which surfaces are shown (+ rotation).
  // Re-measure ONLY when it changes — NOT on mount — or RF drops every edge
  // during the commit frame (see the medallion note for the full story).
  const updateNodeInternals = useUpdateNodeInternals();
  const handleSig = `${showAcl}|${showGateway}|${showOntology}|${d.rot ?? 0}`;
  const prevSig = useRef(handleSig);
  useEffect(() => {
    if (prevSig.current === handleSig) return;
    prevSig.current = handleSig;
    updateNodeInternals(d.nodeId);
  }, [handleSig, d.nodeId, updateNodeInternals]);
  const on = dotsOn(!!selected, isDropTarget);
  // Per-surface top+bottom anchors, spread evenly in render order
  // (Access control · Genie Ontology · AI Gateway).
  const surfaces = [showAcl && "acl", showOntology && "ontology", showGateway && "ai-gateway"].filter(Boolean) as string[];
  const anchorDots = surfaces.flatMap((id, i) => {
    const frac = (i + 0.5) / surfaces.length;
    return [{ id, side: "t" as const, frac }, { id: `${id}-b`, side: "b" as const, frac }];
  });

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
      stack={d.stack}
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
            <UnityCatalog className={`shrink-0 self-center ${slide ? "h-5 w-5" : "h-4 w-4"}`} />
            <span className={`shrink-0 whitespace-nowrap font-bold text-foreground ${slide ? "text-[15px]" : "text-[12px]"}`}>Unity Catalog</span>
            {!slide && <span className="min-w-0 truncate text-[8.5px] text-muted-foreground">Unified governance for Data + AI</span>}
          </div>

          {/* governed surfaces: ACL/ABAC/Audit + AI Gateway + Genie Ontology —
              each opt-out via params, all the SAME width. */}
          <div className="flex flex-1 items-stretch gap-2">
            {/* Access control — ACL · ABAC · Audit across Data + AI */}
            {showAcl && (
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2">
              <UnityCatalog className="shrink-0 h-4 w-4" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                <span className="truncate font-semibold text-foreground text-[10px]">Access control</span>
                {!slide && <span className="text-[7.5px] leading-snug text-muted-foreground">Across Data + AI</span>}
                {!slide && (
                  <span className="flex flex-wrap items-center gap-1">
                    {["ACL", "ABAC", "Audit"].map((c) => (
                      <span key={c} className="rounded bg-muted px-1 py-px text-[7.5px] font-medium text-muted-foreground">{c}</span>
                    ))}
                  </span>
                )}
              </span>
            </div>
            )}

            {/* Genie Ontology — the semantic layer (compact, same width). In
                the MIDDLE (between Access control and the AI Gateway). */}
            {showOntology && (
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2">
              <FileSvgIcon iconKey="file:vendor/genie-ontology" className="shrink-0 h-4 w-4" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                <span className="truncate font-semibold text-foreground text-[10px]">Genie Ontology</span>
                {!slide && <span className="text-[7.5px] leading-snug text-muted-foreground">The semantic layer</span>}
                {!slide && (
                  <span className="flex flex-wrap items-center gap-1">
                    {["Metric views", "Glossary", "Domains"].map((c) => (
                      <span key={c} className="rounded bg-muted px-1 py-px text-[7px] font-medium text-muted-foreground">{c}</span>
                    ))}
                  </span>
                )}
              </span>
            </div>
            )}

            {/* Unity AI Gateway — foundation-model logos (always shown) + chips.
                On the RIGHT. */}
            {showGateway && (
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2">
              <AIGateway className="shrink-0 h-4 w-4" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-semibold text-foreground text-[10px]">Unity AI Gateway</span>
                  <span className="flex items-center gap-1">
                    {FM_LOGOS.map((m) => (
                      <FileSvgIcon key={m.key} iconKey={m.key} className="h-3 w-3 shrink-0" />
                    ))}
                  </span>
                </span>
                {!slide && (
                  <span className="flex flex-wrap items-center gap-1">
                    {["Cost control", "MCP", "Audit"].map((c) => (
                      <span key={c} className="rounded bg-muted px-1 py-px text-[7.5px] font-medium text-muted-foreground">{c}</span>
                    ))}
                  </span>
                )}
              </span>
            </div>
            )}
          </div>
        </div>
      </div>
      {/* Anchors: generic left/right, plus a top + bottom handle per SHOWN
          surface (@acl / @ai-gateway / @ontology, + `-b` for bottom). */}
      <ConnectionDot id="l" side="l" editMode={editMode} dotOn={on} />
      <ConnectionDot id="r" side="r" editMode={editMode} dotOn={on} />
      {anchorDots.map((a) => (
        <ConnectionDot key={a.id} id={a.id} side={a.side} frac={a.frac} editMode={editMode} dotOn={on} />
      ))}
    </RotatableCard>
  );
});
