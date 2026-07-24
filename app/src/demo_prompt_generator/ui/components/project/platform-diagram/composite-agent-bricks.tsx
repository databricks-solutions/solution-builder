/**
 * platform-diagram/composite-agent-bricks — the "Agent Bricks" block.
 *
 * A Supervisor agent at the centre, orchestrating four capabilities it routes
 * to — Knowledge Assistant (PDF docs), Genie Agent, MCP tools, and Functions.
 * The four are laid out as tiles in the corners with connector lines running
 * back to the supervisor in the middle; an animated pulse walks the links so it
 * reads as the supervisor dispatching to each in turn.
 * A composite node kind ("agent-bricks").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

type Capability = { icon: DatabricksIconName; label: string };

/** Databricks coral/red — every icon in this block is tinted to it so the set
 *  reads as one unified family (not a mix of brand colors). */
const AB_RED = "#FF5F46";

/** The four capabilities the supervisor orchestrates. All use the recolorable
 *  (currentColor) icon variants so they can be tinted to AB_RED. */
const TILES: Capability[] = [
  { icon: "knowledgeAssistant", label: "Knowledge Assistant" },
  { icon: "genie", label: "Genie Agent" },
  { icon: "mcp", label: "MCP" },
  { icon: "aiFunctions", label: "Functions" },
];

/** The Agent Bricks task types, shown top-right. */
const TASK_TYPES = ["Classification", "Extraction", "Doc parsing"];

/** One child row in the supervisor tree: an elbow connector (├─ / └─) drawn
 *  with CSS borders, then the capability icon + label. */
function TreeRow({ t, last, color }: { t: Capability; last: boolean; color: string }) {
  const Icon = DATABRICKS_ICONS[t.icon];
  return (
    <div className="flex items-stretch gap-1.5">
      {/* elbow connector — a vertical stub down from the parent + a horizontal
          tick out to the row. For the last child the vertical stub stops at the
          mid-line so the trunk ends cleanly. */}
      <span className="relative w-3 shrink-0">
        <span
          className={`absolute left-0 top-0 w-0 border-l ${last ? "h-1/2" : "h-full"}`}
          style={{ borderColor: `${color}66` }}
        />
        <span
          className="absolute left-0 top-1/2 w-full border-t"
          style={{ borderColor: `${color}66` }}
        />
      </span>
      <span className="flex items-center gap-1 whitespace-nowrap py-0.5 text-[9.5px] font-medium leading-tight text-foreground">
        <Icon className="h-4 w-4 shrink-0" style={{ color: AB_RED }} />
        {t.label}
      </span>
    </div>
  );
}

export const AgentBricksBlock = memo(function AgentBricksBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const Supervisor = DATABRICKS_ICONS.multiAgentSupervisor;
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16 });
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
        <div className="flex h-full w-full flex-col gap-1 p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* header: logo + title */}
          <div className="flex items-center gap-1.5">
            <FileSvgIcon iconKey="file:vendor/agent-bricks" className="h-5 w-5 shrink-0" />
            <span className="text-[12px] font-bold text-foreground">{d.component.label || "Agent Bricks"}</span>
          </div>

          {/* the supervisor, with the capabilities it orchestrates listed as a
              tree below it (├─ / └─ connectors). */}
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            {/* supervisor row */}
            <div className="flex items-center gap-1.5">
              <Supervisor className="h-4 w-4 shrink-0" style={{ color: AB_RED }} />
              <span className="text-[10.5px] font-semibold text-foreground">Supervisor</span>
            </div>
            {/* children */}
            <div className="ml-1.5 flex flex-col">
              {TILES.map((t, i) => (
                <TreeRow key={t.label} t={t} last={i === TILES.length - 1} color={d.bandColor} />
              ))}
            </div>
            {/* task-type chips */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {TASK_TYPES.map((t) => (
                <span key={t} className="rounded bg-muted px-1 py-px text-[7.5px] font-medium text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
