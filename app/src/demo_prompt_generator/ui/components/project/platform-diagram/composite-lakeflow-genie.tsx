/**
 * platform-diagram/composite-lakeflow-genie — "Lakeflow + Genie": one box that
 * stacks the full Lakeflow super-block (ingest rail + SDP/medallion) on top and
 * the full Genie Code block (typing terminal → pipeline/dashboard build) below.
 * Reuses LakeflowBody + GenieCodeBody so the two halves stay in lockstep with
 * their standalone counterparts. Carries the Lakeflow input/output ports.
 * A composite node kind ("lakeflow-genie").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, type NodeData } from "./shared";
import { LakeflowBody, LakeflowPorts } from "./composite-lakeflow";
import { GenieCodeBody } from "./composite-genie-code";

export const LakeflowGenieBlock = memo(function LakeflowGenieBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
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
          {/* TOP: Lakeflow (ingest + SDP). */}
          <div className="flex min-h-0 flex-[1.1]">
            <LakeflowBody d={d} />
          </div>
          {/* divider */}
          <div className="h-px shrink-0" style={{ background: `${d.bandColor}33` }} />
          {/* BOTTOM: Genie Code (build animation). */}
          <div className="flex min-h-0 flex-1 flex-col p-2.5">
            <GenieCodeBody d={d} />
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
