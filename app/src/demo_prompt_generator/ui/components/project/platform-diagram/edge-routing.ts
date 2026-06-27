/**
 * platform-diagram/edge-routing — pure geometry for floating edges: which side
 * of a node an edge attaches to, where along that side, how a group of edges
 * fans out, plus the EdgeOps context the custom edge uses to drive reconnects.
 */
import { createContext } from "react";
import { Position } from "@xyflow/react";

export type Side = "t" | "r" | "b" | "l";
export type Rect = { x: number; y: number; w: number; h: number };

/** A point on a border SIDE of a rect at `frac` (0..1) ALONG that side — 0.5 is
 *  the center. Lets multiple edges sharing a side fan out instead of stacking.
 *  Deterministic per (side, frac) → doesn't drift when the node moves. */
export function sidePoint(r: Rect, side: Side, frac = 0.5): { x: number; y: number } {
  switch (side) {
    case "t": return { x: r.x + r.w * frac, y: r.y };
    case "b": return { x: r.x + r.w * frac, y: r.y + r.h };
    case "l": return { x: r.x, y: r.y + r.h * frac };
    default: return { x: r.x + r.w, y: r.y + r.h * frac }; // "r"
  }
}

/** The border side whose CENTER is nearest a point — used so a dragged
 *  reconnect endpoint snaps to the anchor closest to the cursor (lets the user
 *  aim at any of the 4 sides), not always the geometrically-facing one. */
export function nearestSide(r: Rect, px: number, py: number): Side {
  const sides: Side[] = ["t", "r", "b", "l"];
  let best: Side = "r";
  let bestD = Infinity;
  for (const s of sides) {
    const c = sidePoint(r, s, 0.5);
    const dx = c.x - px;
    const dy = c.y - py;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) { bestD = dd; best = s; }
  }
  return best;
}

/** Fraction along a side for edge `index` of `count` sharing it. Packed
 *  tightly around the CENTER (0.5) with a small fixed gap, instead of spreading
 *  across the whole side — so multiple lines stay close together near the
 *  middle. 1→0.5; 2→0.43/0.57; 3→0.36/0.5/0.64; clamped to stay on the side. */
export function spreadFrac(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const gap = 0.14; // spacing between adjacent lines, as a fraction of the side
  const f = 0.5 + (index - (count - 1) / 2) * gap;
  return Math.min(0.92, Math.max(0.08, f));
}

/** Pick the border side that best faces a target point (used when the edge has
 *  no explicit handle, e.g. auto-seeded edges). */
export function facingSide(r: Rect, tx: number, ty: number): Side {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  // Compare normalized distances to decide horizontal vs vertical dominance.
  if (Math.abs(dx) / (r.w / 2) >= Math.abs(dy) / (r.h / 2)) return dx >= 0 ? "r" : "l";
  return dy >= 0 ? "b" : "t";
}

export const POS_OF: Record<Side, Position> = {
  t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left,
};

/** Edge-editing ops shared with the custom edge (which can't take arbitrary
 *  props). Drives the click-to-select → drag-endpoint → magnet-reconnect flow. */
export interface EdgeOps {
  editMode: boolean;
  retarget: (edgeId: string, end: "source" | "target", nodeId: string, handle?: string) => void;
  nodeAt: (fx: number, fy: number) => string | null;
  rectOf: (nodeId: string) => Rect | null;
  setDropTarget: (nodeId: string | null) => void;
  toFlow: (clientX: number, clientY: number) => { x: number; y: number };
  /** Named input ports of a composite node, as absolute flow-coord anchors +
   *  their handle id. Empty for plain tiles. */
  portsOf: (nodeId: string) => { handle: string; x: number; y: number }[];
  /** Set (or clear, with undefined) the manual X of an edge's vertical elbow. */
  setEdgeCenterX: (edgeId: string, centerX: number | undefined) => void;
}
export const EdgeOpsContext = createContext<EdgeOps | null>(null);

export const rectOf = (n: { internals: { positionAbsolute: { x: number; y: number } }; measured: { width?: number; height?: number } }): Rect => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured.width ?? 200,
  h: n.measured.height ?? 56,
});

/** Which side of a node a given edge-end attaches to (explicit handle wins,
 *  else the side facing the other node's center). Module-level so the store
 *  selector and the edge can agree. */
export function endSide(
  rect: Rect,
  handleId: string | null | undefined,
  otherCenter: { x: number; y: number },
): Side {
  if (handleId && ["t", "r", "b", "l"].includes(handleId)) return handleId as Side;
  return facingSide(rect, otherCenter.x, otherCenter.y);
}
