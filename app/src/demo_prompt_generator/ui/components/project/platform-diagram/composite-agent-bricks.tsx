/**
 * platform-diagram/composite-agent-bricks — the "Agent Bricks" block: the
 * Agent Bricks logo as a header over a 2×2 grid of the agent building blocks
 * it bundles — Supervisor agent, Information extraction, Document parsing,
 * Classification. A composite node kind ("agent-bricks").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

const ITEMS: { icon: DatabricksIconName; label: string }[] = [
  { icon: "multiAgentSupervisor", label: "Supervisor agent" },
  { icon: "unstructuredData", label: "Information extraction" },
  { icon: "inputData", label: "Document parsing" },
  { icon: "aiFunctions", label: "Classification" },
];

export const AgentBricksBlock = memo(function AgentBricksBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16 });
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
        className={`flex h-full w-full flex-col overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""} ${card.shadow ? (selected ? "shadow-md" : "shadow-sm hover:shadow-md") : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full flex-col gap-1.5 p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* header */}
          <div className="flex items-center gap-1.5">
            <FileSvgIcon iconKey="file:vendor/agent-bricks" className="h-5 w-5 shrink-0" />
            <span className="text-[12px] font-bold text-foreground">{d.component.label || "Agent Bricks"}</span>
          </div>

          {/* 2×2 grid of the bundled agent building blocks */}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5">
            {ITEMS.map((it) => {
              const Icon = DATABRICKS_ICONS[it.icon];
              return (
                <div key={it.label} className="flex items-center gap-1.5 overflow-hidden rounded-md border border-border/60 bg-background/70 px-1.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate text-[9px] font-medium leading-tight text-foreground">{it.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
