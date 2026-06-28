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

          {/* governed surfaces below the header: AI Gateway + Genie Ontology */}
          <div className="flex flex-1 items-stretch gap-2">
            {/* Unity AI Gateway — foundation-model logos (always shown) + chips */}
            <div className="flex flex-[1.4] items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2">
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

            {/* Genie Ontology */}
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2">
              <FileSvgIcon iconKey="file:vendor/genie-ontology" className="h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[10px] font-semibold text-foreground">Genie Ontology</span>
                <span className="truncate text-[8px] text-muted-foreground">Semantic layer over your data</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
