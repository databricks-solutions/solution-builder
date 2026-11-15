/**
 * platform-diagram/edges/edge-geometry — ONE source of truth for "what path is
 * actually drawn" for an edge at rest.
 *
 * Three places need the exact drawn geometry: `FlowEdge` (renders it),
 * `crossings` (finds line-jumps on it) and `label-layout` (places the label on
 * it). Re-deriving it drifts from the render — the smooth-step router turns
 * toward the ENTRY side, and both the stub shrink and the centerX guard change
 * the path — so the stub/guard rules live HERE and the other modules call in.
 *
 * FlowEdge still owns its own copy of the arg assembly, because it must feed the
 * TRANSIENT drag state (a dragged endpoint / elbow) through the same rules; it
 * uses `stubOffset` + `guardCenterX` from here so the rules themselves aren't
 * duplicated. `crossings` and `label-layout` use `drawnPath` for the at-rest
 * geometry.
 *
 * Pure geometry — no React, no ReactFlow context.
 */
import { getSmoothStepPath, getStraightPath } from "@xyflow/react";
import { type Rect, type Side, POS_OF, sidePoint } from "../edge-routing";

/** Edge shape (mirrors FlowEdge's `data.shape`). */
export type EdgeShape = "straight" | "step" | "smooth";

/** True when a side runs along the horizontal axis (an edge end on l/r exits
 *  sideways, so its adjoining path segment is horizontal). */
export const isHorizontalSide = (s: Side): boolean => s === "l" || s === "r";

/**
 * The exit stub each end gets before the router is allowed to turn.
 *
 * getSmoothStepPath extends a fixed 20px stub out of each side first. For tiles
 * sitting CLOSE together the two stubs overshoot past each other and the path
 * doubles back — the "S" wiggle. Cap each stub at ~40% of the facing gap (leaves
 * 20% in the middle for the turn) so the line turns once. Only the facing axis
 * matters: horizontal sides → the x-gap, vertical sides → the y-gap.
 */
export function stubOffset(
  sSide: Side, tSide: Side,
  sp: { x: number; y: number }, tp: { x: number; y: number },
  /** Absolute y a bottom-to-bottom (or top-to-top) U-turn must run beyond — see
   *  `turnClearY`. Ignored for every other side pair. */
  turnY?: number,
): number {
  const horiz = isHorizontalSide(sSide) && isHorizontalSide(tSide);
  const vert = !isHorizontalSide(sSide) && !isHorizontalSide(tSide);
  const facingGap = horiz ? Math.abs(tp.x - sp.x) : vert ? Math.abs(tp.y - sp.y) : Infinity;
  const base = Math.max(4, Math.min(20, facingGap * 0.4));
  // A U-turn's run sits at (anchor + offset), so the offset IS the run's depth. Deepen it to
  // the clearance a container/tile needs; the stub grows with it (it is the same segment).
  if (turnY !== undefined && sSide === tSide) {
    if (sSide === "b") return Math.max(base, turnY - Math.max(sp.y, tp.y));
    if (sSide === "t") return Math.max(base, Math.min(sp.y, tp.y) - turnY);
  }
  return base;
}

/**
 * The y a same-side U-turn (bottom→bottom or top→top) must run beyond so it does not run
 * INSIDE a box it passes under. A bottom loop between two cards sitting in stage boxes would
 * otherwise run through the padding of every box it crosses (the boxes are equal-height now,
 * so the empty space inside them is exactly where the loop would land). Returns the y the run
 * must clear, or undefined when no U-turn / nothing to clear. `blockers` are the rects the
 * unclamped run would cross (any node whose x-span meets the run and whose y-span contains
 * it); iterated because clearing one box can land the run inside the next.
 */
export function turnClearY(
  sSide: Side, tSide: Side,
  sp: { x: number; y: number }, tp: { x: number; y: number },
  blockers: Rect[],
): number | undefined {
  if (sSide !== tSide || (sSide !== "b" && sSide !== "t")) return undefined;
  const sign = sSide === "b" ? 1 : -1;
  const anchor = sSide === "b" ? Math.max(sp.y, tp.y) : Math.min(sp.y, tp.y);
  const x0 = Math.min(sp.x, tp.x), x1 = Math.max(sp.x, tp.x);
  let run = anchor + sign * 20;
  for (let i = 0; i < 8; i++) {
    let moved = false;
    for (const r of blockers) {
      if (r.x + r.w < x0 || r.x > x1) continue;               // not under the run's x-span
      const top = r.y, bot = r.y + r.h;
      if (run > top && run < bot) {                           // the run lies inside it
        run = sign > 0 ? bot + 12 : top - 12;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return run === anchor + sign * 20 ? undefined : run;
}

/**
 * Keep a vertical-elbow X from folding the path into a backward zigzag.
 *
 * The router always extends ~`offset` from each end before turning; a `centerX`
 * INSIDE that stub makes the path overshoot to the stub then curl back to the
 * elbow. So push it at least `offset` beyond both the source exit and the target
 * entry, on the correct outbound side. Only meaningful when both ends are
 * horizontal sides; returns the input unchanged otherwise.
 */
export function guardCenterX(
  centerX: number | undefined,
  sSide: Side, tSide: Side,
  sp: { x: number; y: number }, tp: { x: number; y: number },
  offset: number,
): number | undefined {
  if (centerX === undefined) return undefined;
  if (!isHorizontalSide(sSide) || !isHorizontalSide(tSide)) return centerX;
  let c = centerX;
  if (sSide === "r") c = Math.max(c, sp.x + offset);
  else c = Math.min(c, sp.x - offset);
  if (tSide === "l") c = Math.min(c, tp.x - offset);
  else c = Math.max(c, tp.x + offset);
  return c;
}

/**
 * The vertical-run twin of `guardCenterX`: a top/bottom-to-top/bottom edge's horizontal elbow
 * (`centerY`) must sit ≥ offset beyond both the source exit and the target entry, on the outbound
 * side, or the path folds back the same way a vertical elbow would. Returns the input unchanged
 * unless BOTH ends are vertical sides.
 */
export function guardCenterY(
  centerY: number | undefined,
  sSide: Side, tSide: Side,
  sp: { x: number; y: number }, tp: { x: number; y: number },
  offset: number,
): number | undefined {
  if (centerY === undefined) return undefined;
  if (isHorizontalSide(sSide) || isHorizontalSide(tSide)) return centerY;
  let c = centerY;
  if (sSide === "b") c = Math.max(c, sp.y + offset);
  else c = Math.min(c, sp.y - offset);
  if (tSide === "t") c = Math.min(c, tp.y - offset);
  else c = Math.max(c, tp.y + offset);
  return c;
}

/** The fan geometry `drawnPath` needs (a structural subset of `FanEntry`). */
export interface PathFan {
  sSide: Side;
  tSide: Side;
  sFrac: number;
  tFrac: number;
  /** Elbow X for a horizontal-run edge (l/r → l/r). */
  centerX: number | undefined;
  /** Elbow Y for a vertical-run edge (t/b → t/b): the y of the horizontal run. */
  centerY?: number;
  turnY?: number;
}

export interface DrawnPath {
  /** The SVG path string, identical to what FlowEdge renders at rest. */
  path: string;
  /** Anchor the router computed ON the path — the elbow centre for an L-shape. */
  labelX: number;
  labelY: number;
  /** Resolved anchor points on each node's border. */
  sp: { x: number; y: number };
  tp: { x: number; y: number };
  stepOffset: number;
  centerX: number | undefined;
}

/**
 * The label point a route really uses — the ONE rule FlowEdge renders and label-layout places
 * against (both call this; drawnPath applies it, so the solver never disagrees with the draw).
 *
 * The router's label point is the elbow centre. It is kept when it lies within the endpoints'
 * span, and also for a U-TURN: both ends leave the same side and the turn sits beyond both ends
 * (a bottom-to-bottom loop back). A U-turn's label belongs ON the turn, outside the span by
 * design. Otherwise (a backward step whose elbow overshoots an endpoint) the label falls back to
 * the endpoints' midpoint, which is always between the two boxes.
 */
export function resolveLabelAnchor(
  pathLabel: { x: number; y: number },
  sp: { x: number; y: number },
  tp: { x: number; y: number },
  sSide: Side,
  tSide: Side,
): { x: number; y: number } {
  const inBox = (v: number, a: number, b: number) => v >= Math.min(a, b) - 1 && v <= Math.max(a, b) + 1;
  if (inBox(pathLabel.x, sp.x, tp.x) && inBox(pathLabel.y, sp.y, tp.y)) return pathLabel;
  const uTurn =
    (sSide === "b" && tSide === "b" && pathLabel.y > Math.max(sp.y, tp.y)) ||
    (sSide === "t" && tSide === "t" && pathLabel.y < Math.min(sp.y, tp.y)) ||
    (sSide === "r" && tSide === "r" && pathLabel.x > Math.max(sp.x, tp.x)) ||
    (sSide === "l" && tSide === "l" && pathLabel.x < Math.min(sp.x, tp.x));
  if (uTurn) return pathLabel;
  return { x: (sp.x + tp.x) / 2, y: (sp.y + tp.y) / 2 };
}

/**
 * Build the at-rest path (+ its router-computed label anchor) for one edge.
 * `manualCenterX` is the saved `data.centerX` (the user's parked elbow), which
 * wins over the fan's auto-stagger — same precedence FlowEdge uses.
 */
export function drawnPath(
  fan: PathFan,
  sR: Rect,
  tR: Rect,
  shape: EdgeShape = "smooth",
  manualCenterX?: number,
  /** Optional exact anchor POINTS, overriding the rect-derived `sidePoint`. Used
   *  for a captioned logo end, whose anchor is caption-aware (`logoAnchorPoint`):
   *  the icon edge on three sides, the box edge on the caption side so a line
   *  clears the text. Everything downstream (stubs, elbow guard, label) uses these.
   */
  anchors?: { source?: { x: number; y: number }; target?: { x: number; y: number } },
): DrawnPath {
  const sp = anchors?.source ?? sidePoint(sR, fan.sSide, fan.sFrac);
  const tp = anchors?.target ?? sidePoint(tR, fan.tSide, fan.tFrac);
  const offset = stubOffset(fan.sSide, fan.tSide, sp, tp, fan.turnY);

  if (shape === "straight") {
    const [path, labelX, labelY] = getStraightPath({
      sourceX: sp.x, sourceY: sp.y, targetX: tp.x, targetY: tp.y,
    });
    return { path, labelX, labelY, sp, tp, stepOffset: offset, centerX: undefined };
  }

  const centerX = guardCenterX(
    manualCenterX ?? fan.centerX, fan.sSide, fan.tSide, sp, tp, offset,
  );
  const centerY = guardCenterY(fan.centerY, fan.sSide, fan.tSide, sp, tp, offset);
  const [path, rawLabelX, rawLabelY] = getSmoothStepPath({
    sourceX: sp.x, sourceY: sp.y, targetX: tp.x, targetY: tp.y,
    sourcePosition: POS_OF[fan.sSide], targetPosition: POS_OF[fan.tSide],
    offset,
    borderRadius: shape === "step" ? 0 : Math.min(14, offset),
    ...(centerX !== undefined ? { centerX } : {}),
    ...(centerY !== undefined ? { centerY } : {}),
  });
  const label = resolveLabelAnchor({ x: rawLabelX, y: rawLabelY }, sp, tp, fan.sSide, fan.tSide);
  return { path, labelX: label.x, labelY: label.y, sp, tp, stepOffset: offset, centerX };
}

/** The drawn curve as a polyline, rounded corners SAMPLED (not chorded). Use this wherever the
 *  question is "do two drawn lines touch or cross" — `pathToPolyline` collapses each Q corner to
 *  its end point, which hides a line that brushes the corner of another (the browser draws the
 *  curve, so that brush is a visible crossing). Tile/label geometry keeps `pathToPolyline`. */
export function flattenPath(path: string, steps = 6): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const push = (p: { x: number; y: number }) => {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  };
  const re = /([MLQ])([^MLQ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const cmd = m[1];
    const nums = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) push({ x: nums[i], y: nums[i + 1] });
    } else if (cmd === "Q" && nums.length >= 4 && out.length) {
      const p0 = out[out.length - 1];
      const c = { x: nums[0], y: nums[1] }, p2 = { x: nums[2], y: nums[3] };
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        push({
          x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
          y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
        });
      }
    }
  }
  return out;
}

/** Parse an SVG path (the M/L/Q subset the routers emit) into a polyline.
 *  Q corners collapse to their end point; consecutive duplicates are dropped. */
export function pathToPolyline(path: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const re = /([MLQ])([^MLQ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const cmd = m[1];
    const nums = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    } else if (cmd === "Q" && nums.length >= 4) {
      pts.push({ x: nums[2], y: nums[3] });
    }
  }
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  return out;
}

/** Does segment AB pass through rect R, shrunk by `inset`? Liang–Barsky.
 *
 *  Must be a real segment/rect test, not "are sampled points inside": a long
 *  straight run can cross a tile with no sampled vertex landing inside it.
 */
export function segmentHitsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: Rect,
  inset = 3,
): boolean {
  const xmin = r.x + inset, xmax = r.x + r.w - inset;
  const ymin = r.y + inset, ymax = r.y + r.h - inset;
  if (xmax <= xmin || ymax <= ymin) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - xmin], [dx, xmax - a.x], [-dy, a.y - ymin], [dy, ymax - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 > t0;
}

/** Split node rects into TILES and CONTAINERS. A container is any node whose rect
 *  encloses another's — a line or label crossing the platform/cloud box interior
 *  is normal, so only tiles are obstacles. (Shared by the label placement and the
 *  edge-avoidance passes so they agree on what counts as "in the way".) */
/** A container's title strip — the band at its top where its label sits. The ONLY part of a
 *  container an edge or a label must keep clear of (its body is free space). Shared so the
 *  label solver and the fan avoidance pass agree on what a title is. */
export const TITLE_STRIP_H = 34;
export const titleStripOf = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: Math.min(TITLE_STRIP_H, r.h) });

export function partitionNodes<T extends { id: string; r: Rect }>(
  nodes: T[],
): { tiles: T[]; containers: T[] } {
  const encloses = (outer: Rect, inner: Rect): boolean =>
    inner.x >= outer.x - 2 && inner.y >= outer.y - 2 &&
    inner.x + inner.w <= outer.x + outer.w + 2 &&
    inner.y + inner.h <= outer.y + outer.h + 2;
  const tiles: T[] = [], containers: T[] = [];
  for (const n of nodes) {
    (nodes.some((o) => o.id !== n.id && encloses(n.r, o.r)) ? containers : tiles).push(n);
  }
  return { tiles, containers };
}

/** How close to a path's own endpoints a tile may sit before a crossing there is
 *  forgiven. The exit stub necessarily leaves the source's immediate
 *  neighbourhood and can graze a tile packed right against it — counting that as a
 *  routing fault produces false positives that no re-route can fix. Mirrors the
 *  same allowance in `scripts/inspect-arch.mjs`; keep the two in step or the app
 *  will "fix" faults the checker doesn't report (and churn diagrams for nothing). */
export const END_MARGIN = 18;

/** Ids of the tiles a polyline runs through, ignoring `exclude` (an edge's own
 *  endpoints legitimately touch their tiles) and any tile hugging the path's own
 *  ends (see `END_MARGIN`). */
export function tilesCrossed<T extends { id: string; r: Rect }>(
  poly: { x: number; y: number }[],
  tiles: T[],
  exclude: ReadonlySet<string>,
  endMargin = END_MARGIN,
): string[] {
  if (poly.length === 0) return [];
  const ends = [poly[0], poly[poly.length - 1]];
  const nearEnd = (r: Rect): boolean => ends.some((q) =>
    q.x > r.x - endMargin && q.x < r.x + r.w + endMargin &&
    q.y > r.y - endMargin && q.y < r.y + r.h + endMargin);
  const hit: string[] = [];
  for (const t of tiles) {
    if (exclude.has(t.id) || nearEnd(t.r)) continue;
    for (let i = 0; i + 1 < poly.length; i++) {
      if (segmentHitsRect(poly[i], poly[i + 1], t.r)) { hit.push(t.id); break; }
    }
  }
  return hit;
}

/** The straight RUN of a path a point sits on: its axis and its extent along
 *  that axis (`lo`..`hi` in flow coords). */
/**
 * How far along the drawn path a MANUAL label sits, and how far off it.
 *
 * Anchoring is by ABSOLUTE ARC DISTANCE FROM THE NEARER END (`d` px, with `from`
 * naming which end), not by a normalised fraction.
 *
 * The fraction was the first design and it was wrong in practice: `t` is a
 * proportion of total length, so lengthening the path at one end slides the label
 * along it. Measured on a straight edge, `t=0.4` sat at x=400 on a 500px path and
 * at x=480 once the target moved 200px right — the label "stayed" in path space
 * while visibly drifting on screen, which is not what parking a label by hand
 * means. Storing the distance from whichever end the user put it near keeps it put
 * when the far end moves, and only shifts when its OWN end does.
 *
 * `off` is perpendicular px, signed relative to the direction of travel (negative
 * = left of it).
 */
export interface LabelAnchor {
  x: number;
  y: number;
  /** Unit tangent at `t` — the caller uses it to orient a leader or a gap. */
  tx: number;
  ty: number;
}

/** Cumulative segment lengths of a polyline, plus its total. */
function arcTable(poly: { x: number; y: number }[]): { cum: number[]; total: number } {
  const cum = [0];
  let total = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    total += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    cum.push(total);
  }
  return { cum, total };
}

/**
 * Clamp range for a manual `t`, keeping the label off the endpoint stubs.
 *
 * A label parked over a port anchor is unreadable and overlaps the tile it
 * attaches to, so manual placement is bounded to the visible middle of the run
 * rather than the full 0..1. Expressed in px of arc length converted to a
 * fraction, so a short edge clamps proportionally harder than a long one.
 */
export const LABEL_T_MARGIN_PX = 24;

/** The clamped [min,max] for a legacy fractional `t` on a path of this length. */
export function labelTBounds(total: number): [number, number] {
  if (total <= 1) return [0.5, 0.5];
  const m = Math.min(0.45, LABEL_T_MARGIN_PX / total);
  return [m, 1 - m];
}

/** A manual label position as stored on the edge. */
export interface LabelPos {
  /** Arc distance in px from the `from` end. Preferred. */
  d?: number;
  /** Which end `d` is measured from. Defaults to the source. */
  from?: "source" | "target";
  /** Perpendicular offset in px (negative = left of the direction of travel). */
  off?: number;
  /** LEGACY fractional position, still honoured when `d` is absent. */
  t?: number;
}

/** Keep a label this far off the endpoint stubs — a chip over a port anchor is
 *  unreadable and laps the tile it attaches to. */
const LABEL_END_MARGIN = LABEL_T_MARGIN_PX;

/**
 * Resolve a manual position into a point on `poly`.
 *
 * Distance is clamped clear of both ends, so a value stored before the edge got
 * shorter can never push the chip onto a stub. On a path shorter than twice the
 * margin the label simply centres.
 */
export function labelAnchorAt(
  poly: { x: number; y: number }[],
  pos: LabelPos | number,
  offArg = 0,
): LabelAnchor | null {
  if (poly.length < 2) return null;
  const { cum, total } = arcTable(poly);
  if (total <= 0) return null;
  // A bare number is the legacy fractional call signature.
  const p: LabelPos = typeof pos === "number" ? { t: pos, off: offArg } : pos;
  const off = p.off ?? (typeof pos === "number" ? offArg : 0);
  let want: number;
  if (typeof p.d === "number" && Number.isFinite(p.d)) {
    // Measure from the stored end, so growth at the OTHER end doesn't move it.
    want = p.from === "target" ? total - p.d : p.d;
  } else {
    const [lo, hi] = labelTBounds(total);
    want = Math.max(lo, Math.min(hi, Number.isFinite(p.t ?? NaN) ? (p.t as number) : 0.5)) * total;
  }
  const margin = Math.min(LABEL_END_MARGIN, total / 2);
  want = Math.max(margin, Math.min(total - margin, want));
  // Segment containing `want`.
  let i = 0;
  while (i + 2 < cum.length && cum[i + 1] < want) i++;
  const a = poly[i], b = poly[i + 1];
  const segLen = cum[i + 1] - cum[i];
  const f = segLen > 1e-6 ? (want - cum[i]) / segLen : 0;
  const tx = segLen > 1e-6 ? (b.x - a.x) / segLen : 1;
  const ty = segLen > 1e-6 ? (b.y - a.y) / segLen : 0;
  // Perpendicular is the tangent rotated 90°; negative `off` therefore sits to
  // the LEFT of the direction of travel.
  return {
    x: a.x + (b.x - a.x) * f + -ty * off,
    y: a.y + (b.y - a.y) * f + tx * off,
    tx,
    ty,
  };
}

/**
 * Inverse of `labelAnchorAt`: project a dragged point onto the polyline and
 * return the `{t, off}` that reproduces it.
 *
 * This is what makes one free drag serve BOTH placements the editor offers —
 * sliding along the line and stepping across it — without a modifier key: the
 * along-path component becomes `t`, the residual becomes `off`.
 */
export function labelPosFromPoint(
  poly: { x: number; y: number }[],
  x: number,
  y: number,
): LabelPos {
  if (poly.length < 2) return { d: 0, from: "source", off: 0 };
  const { cum, total } = arcTable(poly);
  if (total <= 0) return { d: 0, from: "source", off: 0 };
  let best = { d: Infinity, t: 0.5, off: 0 };
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) continue;
    const len = Math.sqrt(len2);
    const raw = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    const f = Math.max(0, Math.min(1, raw));
    const px = a.x + f * dx, py = a.y + f * dy;
    const d = Math.hypot(px - x, py - y);
    if (d >= best.d) continue;
    // Signed perpendicular: cross product against the unit tangent, so the sign
    // matches `labelAnchorAt`'s convention.
    const off = ((x - px) * (dy / len) - (y - py) * (dx / len)) * -1;
    best = { d, t: (cum[i] + f * len) / total, off };
  }
  const margin = Math.min(LABEL_END_MARGIN, total / 2);
  const along = Math.max(margin, Math.min(total - margin, best.t * total));
  // Anchor to the NEARER end. A label dropped near the target should stay put when
  // the source moves, and vice versa; measuring from the far end would drag it by
  // the full delta. Ties go to the source, which is the conventional reading
  // direction for these diagrams.
  const fromTarget = along > total / 2;
  return {
    d: Math.round(fromTarget ? total - along : along),
    from: fromTarget ? "target" : "source",
    off: Math.round(best.off),
  };
}

export interface PathRun {
  horizontal: boolean;
  lo: number;
  hi: number;
}

/** Perpendicular offset of a run from its axis is treated as "the same run"
 *  within this many px — absorbs the sub-pixel jitter of collapsed Q corners. */
const RUN_TOL = 1.5;

/**
 * The straight run a point sits on. Used to decide which axis a label may slide
 * ALONG (sliding along its own run keeps it on the line; stepping across takes
 * it off) and how far it can go before it slides off the end of that run.
 *
 * Measures the whole COLLINEAR RUN, not one segment: the smooth-step router
 * emits a run as stub + middle + stub (plus vertices where `pathToPolyline`
 * collapsed a rounded Q corner), so a single segment badly under-reports the
 * available travel and forces the label off the line when it had room to stay
 * on it. Falls back to the endpoint direction for a degenerate polyline.
 */
export function runAt(
  poly: { x: number; y: number }[],
  x: number,
  y: number,
): PathRun {
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) continue;
    // Perpendicular distance to the SEGMENT (clamped projection).
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) {
    if (poly.length >= 2) {
      const a = poly[0], b = poly[poly.length - 1];
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const p = (q: { x: number; y: number }) => (horizontal ? q.x : q.y);
      return { horizontal, lo: Math.min(p(a), p(b)), hi: Math.max(p(a), p(b)) };
    }
    return { horizontal: true, lo: x, hi: x };
  }

  const a = poly[bestI], b = poly[bestI + 1];
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const along = (q: { x: number; y: number }) => (horizontal ? q.x : q.y);
  const across = (q: { x: number; y: number }) => (horizontal ? q.y : q.x);
  const level = (across(a) + across(b)) / 2;
  let lo = Math.min(along(a), along(b));
  let hi = Math.max(along(a), along(b));
  // A neighbouring segment continues this run when it points along the same axis
  // and stays on the same perpendicular level.
  const continues = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    Math.abs(along(q) - along(p)) >= Math.abs(across(q) - across(p)) &&
    Math.abs(across(p) - level) <= RUN_TOL &&
    Math.abs(across(q) - level) <= RUN_TOL;
  for (let i = bestI - 1; i >= 0; i--) {
    if (!continues(poly[i], poly[i + 1])) break;
    lo = Math.min(lo, along(poly[i]));
    hi = Math.max(hi, along(poly[i]));
  }
  for (let i = bestI + 1; i + 1 < poly.length; i++) {
    if (!continues(poly[i], poly[i + 1])) break;
    lo = Math.min(lo, along(poly[i + 1]));
    hi = Math.max(hi, along(poly[i + 1]));
  }
  return { horizontal, lo, hi };
}
