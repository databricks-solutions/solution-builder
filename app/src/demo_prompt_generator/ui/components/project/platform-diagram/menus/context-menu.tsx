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
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
} from "lucide-react";

const FLOW_STYLE_NAME: Record<FlowStyle, string> = {
  model: "Model",
  laser: "Laser",
  particles: "Particles",
  docs: "Docs",
  dot: "Dot",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  onSetBezier,
  onSetWaypoints,
  onSetFlowStyle,
  onSetArrow,
  onSetEdgeLabel,
  onSetEdgeLabelPos,
  onRemoveEdge,
}: {
  edge?: Edge;
  onClose: () => void;
  onToggleFlow: () => void;
  onToggleDashed: () => void;
  onSetShape: (s: "smooth" | "straight" | "step") => void;
  onSetBezier: (enabled: boolean) => void;
  onSetWaypoints: (points: { x: number; y: number }[] | undefined) => void;
  onSetFlowStyle: (s: FlowStyle | undefined) => void;
  onSetArrow: (a: "auto" | "none" | "end" | "start" | "both") => void;
  /** Set (or clear, with "") the edge's mid-line label. */
  onSetEdgeLabel: (label: string) => void;
  /** Manual label placement: `t` along the path, `off` across it. Undefined hands
   *  the label back to automatic placement. */
  onSetEdgeLabelPos: (pos: { d?: number; from?: "source" | "target"; off?: number; t?: number } | undefined) => void;
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
            title={FLOW_STYLE_NAME[fs]}
            className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted ${ed?.flowStyle === fs ? "bg-muted" : ""}`}
          >
            <span className="w-16 shrink-0 text-left text-[12px] text-foreground">{FLOW_STYLE_NAME[fs]}</span>
            <span className="min-w-0 flex-1"><FlowStylePreview style={fs} /></span>
            {ed?.flowStyle === fs && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>
        ))}
        <div className="my-1 border-t border-border/60" />
        <Item icon={<Spline className="h-3.5 w-3.5" />} label="Smooth" onClick={() => { onSetShape("smooth"); onSetBezier(false); onSetWaypoints(undefined); }} active={(ed?.shape ?? "smooth") === "smooth" && !ed?.bezier} />
        <Item icon={<Spline className="h-3.5 w-3.5" />} label="Bezier (drag controls)" onClick={() => { onSetShape("smooth"); onSetBezier(true); }} active={!!ed?.bezier} />
        <Item icon={<MoveRight className="h-3.5 w-3.5" />} label="Straight" onClick={() => { onSetShape("straight"); onSetBezier(false); onSetWaypoints(undefined); }} active={ed?.shape === "straight"} />
        <Item icon={<CornerDownRight className="h-3.5 w-3.5" />} label="Step" onClick={() => { onSetShape("step"); onSetBezier(false); onSetWaypoints(undefined); }} active={ed?.shape === "step" && ed?.waypoints === undefined} />
        <Item icon={<CornerDownRight className="h-3.5 w-3.5" />} label="Step (drag waypoints)" onClick={() => { onSetShape("step"); onSetBezier(false); onSetWaypoints([]); }} active={ed?.shape === "step" && ed?.waypoints !== undefined} />
        {ed?.shape === "step" && ed?.waypoints !== undefined && <div className="px-2 py-1 text-[10px] leading-snug text-muted-foreground">Drag a handle, or Shift-double-click the line to add another waypoint.</div>}
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
        {/* Label placement. Dragging the chip on the canvas sets both of these at
            once; the sliders exist because "nudge it 12px above the line" is easier
            to type than to drag, and because a perpendicular offset is otherwise
            hard to hit precisely. Both are disabled without a label to place. */}
        {typeof edge?.label === "string" && !!edge.label && (() => {
          const pos = ed?.labelPos;
          const manual = pos !== undefined;
          return (
            <>
              {/* ALONG the line, in px from the anchored end. Absolute px (not a
                  0..1 fraction) for the same reason the stored value is: a fraction
                  re-scales whenever the path length changes, so the chip drifts when
                  an unrelated node moves. 400px covers a lane-spanning edge; a
                  longer path just clamps at its own midpoint. */}
              {/* The readout is clamped to the slider's own range: a stored value
                  outside it (e.g. set by hand in the JSON) would otherwise show a
                  number the thumb can't reach. */}
              <div className="flex items-center gap-2 px-2 py-1">
                <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="w-[68px] shrink-0 text-[11.5px] text-foreground" title="Slide the label ALONG the line (px from the anchored end)">Along line</span>
                <input
                  type="range" min={0} max={400} step={2}
                  value={clamp(pos?.d ?? 0, 0, 400)}
                  onChange={(e) => onSetEdgeLabelPos({
                    d: Number(e.target.value), from: pos?.from ?? "source", off: pos?.off,
                  })}
                  className="min-w-0 flex-1 accent-primary"
                  title={`Slide the label ALONG the line (px from the ${pos?.from ?? "source"} end)`}
                />
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {clamp(pos?.d ?? 0, 0, 400)}px
                </span>
              </div>
              <div className="flex items-center gap-2 px-2 py-1">
                <MoveVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="w-[68px] shrink-0 text-[11.5px] text-foreground" title="Move the label ACROSS the line (px, negative = up/left)">Offset</span>
                <input
                  type="range" min={-40} max={40} step={1}
                  value={clamp(pos?.off ?? 0, -40, 40)}
                  onChange={(e) => onSetEdgeLabelPos({
                    d: pos?.d, from: pos?.from, t: pos?.t, off: Number(e.target.value),
                  })}
                  className="min-w-0 flex-1 accent-primary"
                  title="Move the label ACROSS the line"
                />
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {clamp(pos?.off ?? 0, -40, 40)}px
                </span>
              </div>
              {manual && (
                <Item
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  label="Auto-place label"
                  onClick={() => onSetEdgeLabelPos(undefined)}
                />
              )}
            </>
          );
        })()}
        <div className="my-1 border-t border-border/60" />
        <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete line" onClick={onRemoveEdge} />
      </div>
    </div>
  );
});
