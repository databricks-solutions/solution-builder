/**
 * platform-diagram/composite-lakeflow-genie — "Lakeflow + Genie": one box that
 * stacks the full Lakeflow super-block (ingest rail + SDP/medallion) on top and
 * a slim "Built with Genie Code" footer below (just the label + tagline — no
 * terminal/build animation). Reuses LakeflowBody so the top half stays in
 * lockstep with the standalone Lakeflow block. Carries the Lakeflow ports.
 * A composite node kind ("lakeflow-genie").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, type NodeData } from "./shared";
import { LakeflowBody, LakeflowPorts } from "./composite-lakeflow";

export const LakeflowGenieBlock = memo(function LakeflowGenieBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const GenieCode = DATABRICKS_ICONS.genieCodeBrand;
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      hideHandles
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <LakeflowPorts editMode={editMode} selected={!!selected} isDropTarget={isDropTarget} />

      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow ${
          selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"
        }`}
        style={{ borderColor: `${d.bandColor}66` }}
      >
        <div className="flex h-full w-full flex-col" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* TOP: Lakeflow (ingest + SDP) — the dominant section. */}
          <div className="flex min-h-0 flex-1">
            <LakeflowBody d={d} />
          </div>
          {/* BOTTOM: a slim "Built with Genie Code" footer — label + tagline
              only (no terminal/build animation). Light but a touch darker than
              the Lakeflow section above, with a hairline divider. */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-border/60 bg-muted/50 px-2.5 py-1.5">
            <GenieCode className="h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[10px] font-bold text-foreground">Built with Genie Code</span>
              <span className="truncate text-[8px] text-muted-foreground">Tell genie what to do, it'll build it for you and maintain it</span>
            </span>
            <FileSvgIcon iconKey="file:vendor/zeroops" className="ml-auto h-3.5 w-auto shrink-0" />
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
