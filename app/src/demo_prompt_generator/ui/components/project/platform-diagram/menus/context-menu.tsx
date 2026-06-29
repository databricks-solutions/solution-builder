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
} from "lucide-react";

export type CtxMenu =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | null;

/** Floating right-click menu for an edge (toggle flow, dashed, routing shape,
 *  flow style, label, delete). */
export const ContextMenu = memo(function ContextMenu({
  menu,
  edge,
  onClose,
  onToggleFlow,
  onToggleDashed,
  onSetShape,
  onSetFlowStyle,
  onSetEdgeLabel,
  onRemoveEdge,
}: {
  menu: NonNullable<CtxMenu>;
  edge?: Edge;
  onClose: () => void;
  onToggleFlow: () => void;
  onToggleDashed: () => void;
  onSetShape: (s: "smooth" | "straight" | "step") => void;
  onSetFlowStyle: (s: FlowStyle | undefined) => void;
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
  // Flip the menu so it's always fully visible: open LEFT when the click is in
  // the right portion of the viewport, and open UP when it's in the bottom
  // portion. Anchoring with right/bottom (instead of left/top) keeps the menu
  // pinned to the click point as it grows the other way.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const flipX = menu.x > vw * 0.65; // right portion → open leftward
  const flipY = menu.y > vh * 0.55; // bottom portion → open upward
  const pos: React.CSSProperties = {
    ...(flipX ? { right: vw - menu.x } : { left: menu.x }),
    ...(flipY ? { bottom: vh - menu.y } : { top: menu.y }),
  };
  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 max-h-[85vh] w-52 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        style={pos}
      >
        <Item icon={<Zap className="h-3.5 w-3.5" />} label="Data flow" onClick={onToggleFlow} active={!!ed?.animated} />
        <Item icon={<Minus className="h-3.5 w-3.5" />} label="Dashed line" onClick={onToggleDashed} active={!!ed?.dashed} />
        <div className="my-1 border-t border-border/60" />
        <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Flow style</div>
        <Item icon={<Wand2 className="h-3.5 w-3.5" />} label="Auto (by source)" onClick={() => onSetFlowStyle(undefined)} active={ed?.flowStyle == null} />
        {(["laser", "particles", "docs", "dot"] as const).map((fs) => (
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
        <Item
          icon={<Tag className="h-3.5 w-3.5" />}
          label={typeof edge?.label === "string" && edge.label ? "Edit label…" : "Add label…"}
          onClick={() => {
            const next = window.prompt("Line label (leave empty to remove):", typeof edge?.label === "string" ? edge.label : "");
            if (next !== null) onSetEdgeLabel(next.trim());
          }}
          active={typeof edge?.label === "string" && !!edge.label}
        />
        <div className="my-1 border-t border-border/60" />
        <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete line" onClick={onRemoveEdge} />
      </div>
    </>
  );
});
