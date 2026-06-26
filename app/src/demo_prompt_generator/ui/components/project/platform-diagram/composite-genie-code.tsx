/**
 * platform-diagram/composite-genie-code — the "Built with Genie Code" strip:
 * a header (genie-code mark + tagline), an animated terminal prompt that types
 * out a request, an arrow, and a generated `pipeline.sql` artifact showing a
 * Bronze → Silver → Gold medallion. A composite node kind ("genie-code").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { RotatableCard, baseSize, DropTargetContext, type NodeData } from "./shared";
import { MEDALLION } from "./composite-lakeflow";

const PROMPT_TEXT = "ingest turbine telemetry into a daily pipeline";

export const GenieCodeBlock = memo(function GenieCodeBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const nat = baseSize(d.component);
  const GenieCode = DATABRICKS_ICONS.genieCodeBrand;
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={d.editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <style>{`
        @keyframes gc-type { from { width: 0 } to { width: 100% } }
        @keyframes gc-caret { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes gc-dot { 0%,100% { transform: translateX(0); opacity: .4 } 50% { transform: translateX(8px); opacity: 1 } }
      `}</style>
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow ${
          selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"
        }`}
        style={{ borderColor: `${d.bandColor}66` }}
      >
        <div className="flex h-full w-full flex-col gap-1.5 p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* header */}
          <div className="flex items-center gap-1.5">
            <GenieCode className="h-5 w-5 shrink-0" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[12px] font-bold text-foreground">{d.component.label || "Built with Genie Code"}</span>
              <span className="truncate text-[8.5px] text-muted-foreground">Describe the pipeline — Genie Code writes the SQL, the DAG, the tests.</span>
            </span>
          </div>

          {/* stage: prompt → arrow → artifact */}
          <div className="flex flex-1 items-center gap-2">
            {/* terminal prompt with a typing animation */}
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[9px]">
              <span className="shrink-0 text-[#EF5B3F]">$</span>
              <span className="relative inline-block overflow-hidden whitespace-nowrap text-foreground" style={{ animation: "gc-type 3s steps(40) infinite alternate" }}>
                {PROMPT_TEXT}
              </span>
              <span className="ml-[1px] inline-block h-[10px] w-[5px] shrink-0 bg-[#EF5B3F]" style={{ animation: "gc-caret 1s steps(1) infinite" }} />
            </div>

            {/* animated arrow */}
            <div className="relative flex h-[2px] w-7 shrink-0 items-center">
              <span className="absolute inset-0 rounded-full bg-muted-foreground/25" />
              <span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#EF5B3F]" style={{ animation: "gc-dot 1.4s ease-in-out infinite" }} />
            </div>

            {/* generated artifact */}
            <div className="flex w-[44%] shrink-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background/70">
              <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1">
                {(() => { const I = DATABRICKS_ICONS.jobsPipelines; return <I className="h-3 w-3 shrink-0 text-muted-foreground" />; })()}
                <span className="truncate font-mono text-[8.5px] text-foreground">pipeline.sql</span>
                <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[7px] font-bold uppercase text-emerald-600">ready</span>
              </div>
              <div className="flex items-center justify-center gap-1 px-1.5 py-2">
                {MEDALLION.map((m, i) => (
                  <span key={m.label} className="flex items-center gap-1">
                    {i > 0 && <span className="text-[9px] text-muted-foreground/50">→</span>}
                    <span className="flex items-center gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                      <span className="text-[7.5px] font-semibold" style={{ color: m.color }}>{m.label}</span>
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
