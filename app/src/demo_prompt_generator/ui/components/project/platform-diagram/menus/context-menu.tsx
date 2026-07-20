/**
 * platform-diagram/menus/context-menu — the floating right-click menu for an
 * EDGE (flow toggle, flow style, routing shape, label, delete). Nodes no longer
 * use this menu: in edit mode, selecting one or more nodes opens the docked
 * right-side edit panel (panels/edit-panel.tsx) instead. The shared style +
 * annotation controls live in panels/style-controls and are reused by both.
 */
import { memo } from "react";
import { type Edge } from "@xyflow/react";
import { type FlowStyle, type EdgeData } from "../shared";
import { FlowStylePreview } from "../edges/edge-flow";
import {
  Zap,
  Trash2,
  Check,
  Minus,
  Spline,
  MoveRight,
  CornerDownRight,
  Wand2,
  Tag,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Slash,
  X,
} from "lucide-react";

export type CtxMenu =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | null;

/** Docked right-side edit panel for an edge (toggle flow, dashed, routing
 *  shape, flow style, arrow, label, delete). */
export const ContextMenu = memo(function ContextMenu({
  edge,
  onClose,
  onToggleFlow,
  onToggleDashed,
  onSetShape,
  onSetFlowStyle,
  onSetArrow,
  onSetEdgeLabel,
  onRemoveEdge,
}: {
  edge?: Edge;
  onClose: () => void;
  onToggleFlow: () => void;
  onToggleDashed: () => void;
  onSetShape: (s: "smooth" | "straight" | "step") => void;
  onSetFlowStyle: (s: FlowStyle | undefined) => void;
  onSetArrow: (a: "auto" | "none" | "end" | "start" | "both") => void;
  /** Set (or clear, with "") the edge's mid-line label. */
  onSetEdgeLabel: (label: string) => void;
  onRemoveEdge: () => void;
}) {
  const ed = edge?.data as EdgeData | undefined;
  const Item = ({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-muted ${active ? "text-primary" : "text-foreground"}`}
    >
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {label}
      {active && <Check className="ml-auto h-3.5 w-3.5" />}
    </button>
  );
  // Docked right-side panel — same shell as the node EditPanel, so editing a
  // line feels like editing a node (no floating menu pinned to the cursor).
  return (
    <div className="flex h-full w-[240px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="text-[13px] font-semibold text-foreground">Line</span>
        <button type="button" onClick={onClose} className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        <Item icon={<Zap className="h-3.5 w-3.5" />} label="Data flow" onClick={onToggleFlow} active={!!ed?.animated} />
        <Item icon={<Minus className="h-3.5 w-3.5" />} label="Dashed line" onClick={onToggleDashed} active={!!ed?.dashed} />
        <div className="my-1 border-t border-border/60" />
        <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Flow style</div>
        <Item icon={<Wand2 className="h-3.5 w-3.5" />} label="Auto (by source)" onClick={() => onSetFlowStyle(undefined)} active={ed?.flowStyle == null} />
        {(["model", "laser", "particles", "docs", "dot"] as const).map((fs) => (
          <button
            key={fs}
            type="button"
            onClick={() => onSetFlowStyle(fs)}
            title={fs}
            className={`flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-muted ${ed?.flowStyle === fs ? "bg-muted" : ""}`}
          >
            <span className="min-w-0 flex-1"><FlowStylePreview style={fs} /></span>
            {ed?.flowStyle === fs && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>
        ))}
        <div className="my-1 border-t border-border/60" />
        <Item icon={<Spline className="h-3.5 w-3.5" />} label="Smooth" onClick={() => onSetShape("smooth")} active={(ed?.shape ?? "smooth") === "smooth"} />
        <Item icon={<MoveRight className="h-3.5 w-3.5" />} label="Straight" onClick={() => onSetShape("straight")} active={ed?.shape === "straight"} />
        <Item icon={<CornerDownRight className="h-3.5 w-3.5" />} label="Step" onClick={() => onSetShape("step")} active={ed?.shape === "step"} />
        <div className="my-1 border-t border-border/60" />
        <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Arrow</div>
        <Item icon={<Wand2 className="h-3.5 w-3.5" />} label="Auto" onClick={() => onSetArrow("auto")} active={(ed?.arrow ?? "auto") === "auto"} />
        <Item icon={<Slash className="h-3.5 w-3.5" />} label="No arrow" onClick={() => onSetArrow("none")} active={ed?.arrow === "none"} />
        <Item icon={<ArrowRight className="h-3.5 w-3.5" />} label="Arrow at end" onClick={() => onSetArrow("end")} active={ed?.arrow === "end"} />
        <Item icon={<ArrowLeft className="h-3.5 w-3.5" />} label="Arrow at start" onClick={() => onSetArrow("start")} active={ed?.arrow === "start"} />
        <Item icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Both ends" onClick={() => onSetArrow("both")} active={ed?.arrow === "both"} />
        <div className="my-1 border-t border-border/60" />
        <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Label</div>
        <div className="flex items-center gap-2 px-2 py-1">
          <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={typeof edge?.label === "string" ? edge.label : ""}
            placeholder="Line label…"
            onChange={(e) => onSetEdgeLabel(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[12.5px] text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="my-1 border-t border-border/60" />
        <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete line" onClick={onRemoveEdge} />
      </div>
    </div>
  );
});
