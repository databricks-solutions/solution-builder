/**
 * platform-diagram/composite-db-platform — the "Databricks Platform" banner: a
 * wide tile with the Databricks wordmark on the left and "The Databricks Data
 * Intelligence Platform" beside it. A header/title-style element.
 * A composite node kind ("db-platform").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

export const DbPlatformBlock = memo(function DbPlatformBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
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
        className={`flex h-full w-full items-center overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full items-center gap-3 px-4" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "left center" }}>
          <FileSvgIcon iconKey="file:vendor/databricks-wordmark" className="h-5 w-auto shrink-0" />
          <span className="h-7 w-px shrink-0 bg-border" />
          <span className="min-w-0 text-[15px] font-bold leading-tight text-foreground">The Data Intelligence Platform</span>
        </div>
      </div>
    </RotatableCard>
  );
});
