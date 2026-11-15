/**
 * platform-diagram/edges/flow-edge — the custom ReactFlow edge (`FlowEdge`):
 * side/port-aware routing + fan-out, draggable endpoints + vertical elbow,
 * mid-line label, and the animated "data flowing" overlay.
 */
import { memo, useState, useContext, useEffect } from "react";
import {
  useInternalNode,
  useStore,
  useConnection,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";
import { type EdgeData, type FlowStyle } from "../shared";
import {
  type Side,
  EdgeOpsContext,
  POS_OF,
  sidePoint,
  nearestSide,
  sidePointForNode,
} from "../edge-routing";
import { computeFanLayout } from "../fan-layout";
import { labelAnchorAt, labelPosFromPoint, pathToPolyline, resolveLabelAnchor, stubOffset, guardCenterY, type LabelPos } from "./edge-geometry";
import { computeCrossings, type Hop } from "./crossings";
import { computeLabelOffsets } from "./label-layout";
import { measureLabel, isClamped, lineCenterY, EDGE_LABEL_FONT } from "./label-chip";
import { injectHops } from "./path-hops";
import { EdgeFlow } from "./edge-flow";

// Stable empty-hops fallback so the store selector returns the SAME ref when an
// edge has no crossings (a fresh [] each tick would defeat the equality check).
const EMPTY_HOPS: Hop[] = [];

type Point = { x: number; y: number };

/** Turn a source, user waypoint(s), and target into an orthogonal SVG route. */
function orthogonalPath(source: Point, waypoints: Point[], target: Point): [string, number, number] {
  const all = [source, ...waypoints, target];
  const out: Point[] = [source];
  for (const p of all.slice(1)) {
    const prev = out[out.length - 1];
    if (prev.x !== p.x && prev.y !== p.y) out.push({ x: p.x, y: prev.y });
    out.push(p);
  }
  const mid = out[Math.floor((out.length - 1) / 2)];
  return [`M ${out.map((p) => `${p.x} ${p.y}`).join(" L ")}`, mid.x, mid.y];
}

/** A cubic curve through the edge's two control points (xyflow's getBezierPath derives its
 *  own controls and can't take these), labelled at its midpoint (t = 0.5). */
function cubicPath(s: Point, c1: Point, c2: Point, t: Point): [string, number, number] {
  const mid = (a: number, b: number, c: number, d: number) => 0.125 * a + 0.375 * b + 0.375 * c + 0.125 * d;
  return [`M ${s.x} ${s.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${t.x} ${t.y}`, mid(s.x, c1.x, c2.x, t.x), mid(s.y, c1.y, c2.y, t.y)];
}

const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const { id, source, target, style, data, selected, label } = props;
  const sNode = useInternalNode(source);
  const tNode = useInternalNode(target);
  const ops = useContext(EdgeOpsContext);
  const d = data as EdgeData | undefined;

  // Fan-out geometry: this edge's side/frac/centerX among the edges sharing its
  // anchors. Computed for ALL edges AT ONCE by `computeFanLayout` (memoized on a
  // store signature), so the E edge selectors share ONE O(E) computation per
  // store tick instead of each redoing it (the old O(E²)-per-frame drag cost).
  const fan = useStore(
    (s) => computeFanLayout(s.edges, s.nodeLookup).get(id) ?? null,
    // Shallow-compare the entry so a store tick that doesn't change THIS edge's
    // anchors doesn't re-render it (the map is fresh only when the signature
    // changes; the entry object is stable across ticks with the same layout).
    (a, b) =>
      !!a && !!b &&
      a.sSide === b.sSide && a.tSide === b.tSide &&
      a.sFrac === b.sFrac && a.tFrac === b.tFrac && a.centerX === b.centerX && a.centerY === b.centerY,
  );

  // Line jumps: the crossing points on THIS edge where it should hop OVER
  // another line. Computed for ALL edges at once (memoized, same pattern as the
  // fan selector). Compared by a cheap serialization so a tick that doesn't move
  // this edge's crossings doesn't re-render it.
  const hops = useStore(
    (s) => computeCrossings(s.edges, s.nodeLookup).get(id) ?? EMPTY_HOPS,
    (a, b) => a.length === b.length && a.every((h, i) => h.x === b[i].x && h.y === b[i].y),
  );

  // Label de-confliction: how far THIS edge's label must shift off the router's
  // anchor to clear tiles, box titles and other labels. Computed for ALL edges at
  // once (memoized, same pattern as the fan/crossings selectors) because the
  // choice depends on where every other label already went.
  const labelShift = useStore(
    (s) => computeLabelOffsets(s.edges, s.nodeLookup).get(id) ?? null,
    (a, b) => a?.dx === b?.dx && a?.dy === b?.dy && a?.leader === b?.leader,
  );
  // Live endpoint drag (reconnect). Hook runs unconditionally before guards.
  const [drag, setDrag] = useState<{ end: "source" | "target"; x: number; y: number; side?: Side; handle?: string } | null>(null);
  // While a NEW connection is being dragged, the edge layer (which sits above
  // the node handles via EDGE_Z) must NOT capture the pointer — otherwise the
  // hover ribbon / endpoint dots swallow the drop and the connection silently
  // fails to land on the target handle (the "sometimes the line isn't created"
  // bug). Selector keeps this a boolean (re-renders only when it flips).
  const connecting = useConnection((c) => c.inProgress);
  // Live drag of the vertical-elbow handle (manual centerX). Hooks before guard.
  const [centerDrag, setCenterDrag] = useState<number | null>(null);
  // Live manual-label drag, in flow coords; committed to `labelPos` on release.
  const [labelDrag, setLabelDrag] = useState<{ x: number; y: number } | null>(null);
  // The manual placement in force: the live drag while one is happening, else the
  // saved `labelPos`. Null means this edge is still auto-placed.
  const savedLabelPos = (d as { labelPos?: LabelPos } | undefined)?.labelPos;
  const manualLabel = savedLabelPos ?? null;
  // Custom cubic Bézier control-point drag. Points are absolute flow/SVG coords.
  const [controlDrag, setControlDrag] = useState<{ index: 0 | 1; point: { x: number; y: number } } | null>(null);
  const [waypointDrag, setWaypointDrag] = useState<{ index: number; point: Point } | null>(null);
  // Inline mid-line label editor (double-click the line). Holds the draft text
  // while open; null = not editing. Hooks before guard.
  const [labelDraft, setLabelDraft] = useState<string | null>(null);

  if (!sNode || !tNode || !fan) return null;

  // Anchor points — caption-aware for a logo (icon edge on non-caption sides, box
  // edge on the caption side so a line clears the text); plain sidePoint otherwise.
  const sp = sidePointForNode(sNode as never, fan.sSide, fan.sFrac);
  const tp = sidePointForNode(tNode as never, fan.tSide, fan.tFrac);
  const sourcePos = POS_OF[fan.sSide];
  const targetPos = POS_OF[fan.tSide];

  // Grab dots sit ~12px OUTSIDE each tile so they're easy to hit.
  const OUT = 12;
  const out = (side: Side, p: { x: number; y: number }) =>
    side === "l" ? { x: p.x - OUT, y: p.y } : side === "r" ? { x: p.x + OUT, y: p.y }
    : side === "t" ? { x: p.x, y: p.y - OUT } : { x: p.x, y: p.y + OUT };
  const sDot = out(fan.sSide, sp);
  const tDot = out(fan.tSide, tp);

  // While dragging an end, the path follows the (snapped) cursor for that end,
  // AND its curve direction hint follows the dragged side (drag.side when
  // snapped to a tile, else a loose default) — otherwise the curve exits the
  // ORIGINAL side while the point is elsewhere, which looks kinked/buggy.
  const sPt = drag?.end === "source" ? drag : sp;
  const tPt = drag?.end === "target" ? drag : tp;
  const sPos = drag?.end === "source" ? POS_OF[drag.side ?? "r"] : sourcePos;
  const tPos = drag?.end === "target" ? POS_OF[drag.side ?? "l"] : targetPos;

  const shape = d?.shape ?? "smooth";
  const hasBezier = !!d?.bezier && shape === "smooth";
  const hasWaypoints = shape === "step" && d?.waypoints !== undefined;
  // getSmoothStepPath extends a fixed stub (default 20px) straight out of each
  // side before it's allowed to turn. When two connected tiles sit CLOSE
  // together, the source stub and the target stub overshoot past each other and
  // the path has to double back — the "S" wiggle. Shrink the stub so it never
  // eats more than its share of the gap between the exit and entry points: the
  // two stubs together stay within the available run, so the line turns once and
  // reads as a single gentle curve instead of an S. Only the facing axis matters
  // (horizontal sides → the x-gap; vertical sides → the y-gap).
  // Cap each stub at ~40% of the gap (leaves 20% in the middle for the turn),
  // never above the default 20; a same-side loop deepens to clear its containers
  // (the shared rule in edge-geometry, so the drawn path and the solver agree).
  const stepOffset = stubOffset(fan.sSide, fan.tSide, sp, tp, fan.turnY);
  // Vertical-elbow X: while dragging the center handle use that; else a manual
  // saved centerX (d.centerX) wins; else the auto-stagger (fan.centerX). Skip
  // entirely while dragging an endpoint (path tracks the cursor).
  let centerX = drag
    ? undefined
    : centerDrag ?? d?.centerX ?? fan.centerX;
  // Guard the vertical elbow X against folding the smooth-step path into a
  // backward zigzag. getSmoothStepPath ALWAYS extends ~20px from each end in its
  // exit direction before turning; if `centerX` lands inside that stub (closer
  // to an endpoint than the offset), the path overshoots to the stub then curls
  // back to the elbow — the zigzag in the screenshots. So keep `centerX` at
  // least OFFSET beyond BOTH the source exit and the target entry, on the
  // correct outbound side. Only meaningful when both ends are horizontal sides.
  if (centerX !== undefined && (fan.sSide === "l" || fan.sSide === "r") && (fan.tSide === "l" || fan.tSide === "r")) {
    const OFFSET = stepOffset; // smooth-step's exit stub (shrunk when tiles are close)
    // Source side: elbow must be ≥ OFFSET past the source exit.
    if (fan.sSide === "r") centerX = Math.max(centerX, sp.x + OFFSET);
    else centerX = Math.min(centerX, sp.x - OFFSET);
    // Target side: elbow must be ≥ OFFSET before the target entry.
    if (fan.tSide === "l") centerX = Math.min(centerX, tp.x - OFFSET);
    else centerX = Math.max(centerX, tp.x + OFFSET);
  }
  // Horizontal elbow of a top/bottom-to-top/bottom fan-out edge (the same guard drawnPath applies).
  const centerY = drag ? undefined : guardCenterY(fan.centerY, fan.sSide, fan.tSide, sp, tp, stepOffset);
  const args = {
    sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y,
    sourcePosition: sPos, targetPosition: tPos,
    ...(centerX !== undefined ? { centerX } : {}),
    ...(centerY !== undefined ? { centerY } : {}),
  };
  const controlOffset = Math.max(42, Math.min(180, Math.hypot(tPt.x - sPt.x, tPt.y - sPt.y) * 0.42));
  const along = (p: { x: number; y: number }, pos: string, amount: number) =>
    pos === "left" ? { x: p.x - amount, y: p.y }
    : pos === "right" ? { x: p.x + amount, y: p.y }
    : pos === "top" ? { x: p.x, y: p.y - amount }
    : { x: p.x, y: p.y + amount };
  const automaticControls: [{ x: number; y: number }, { x: number; y: number }] = [
    along(sPt, String(sPos), controlOffset),
    along(tPt, String(tPos), controlOffset),
  ];
  const customControls = d?.controlPoints ?? automaticControls;
  const automaticWaypoint: Point = { x: Math.round((sPt.x + tPt.x) / 2), y: Math.round((sPt.y + tPt.y) / 2) };
  const savedWaypoints = d?.waypoints ?? [];
  const visibleWaypoints = waypointDrag
    ? savedWaypoints.length ? savedWaypoints.map((p, i) => i === waypointDrag.index ? waypointDrag.point : p) : [waypointDrag.point]
    : savedWaypoints.length ? savedWaypoints : [automaticWaypoint];
  // These helpers also return the label X/Y they compute ON the drawn path — for
  // a step (L-shaped) route that's the true centre of the elbow, NOT the midpoint
  // of the endpoints. We reuse them so the label sits on the line even when it
  // bends (see labelX/labelY below).
  const [rawPath, pathLabelX, pathLabelY] =
    hasWaypoints
      ? orthogonalPath(sPt, visibleWaypoints, tPt)
      : shape === "straight"
      ? getStraightPath({ sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y })
      : shape === "step"
      ? getSmoothStepPath({ ...args, offset: stepOffset, borderRadius: 0 })
      : hasBezier
      ? cubicPath(sPt,
          controlDrag?.index === 0 ? controlDrag.point : customControls[0],
          controlDrag?.index === 1 ? controlDrag.point : customControls[1], tPt)
      : getSmoothStepPath({ ...args, offset: stepOffset, borderRadius: Math.min(14, stepOffset) });
  // Inject line-jump arcs where this edge crosses OVER another. Skip while
  // dragging an endpoint or the elbow — the geometry (and thus the crossings)
  // is transient and the hop points would lag a frame. `injectHops` no-ops when
  // there are no hops, so a crossing-free edge keeps its exact original path.
  const path = drag || centerDrag !== null || controlDrag !== null || waypointDrag !== null || hasBezier || hasWaypoints ? rawPath : injectHops(rawPath, hops);
  // Where this edge runs under ANOTHER edge's label. Painted over further down

  const start = (end: "source" | "target") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const f = ops!.toFlow(e.clientX, e.clientY);
    setDrag({ end, x: f.x, y: f.y });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || !(e.buttons & 1)) return;
    e.stopPropagation();
    const f = ops!.toFlow(e.clientX, e.clientY);
    // Exclude the edge's OTHER endpoint so a nearby valid target isn't shadowed
    // by it (nodeAt returns a single nearest node within margin).
    const otherEnd = drag.end === "source" ? target : source;
    const valid = ops!.nodeAt(f.x, f.y, undefined, otherEnd);
    ops!.setDropTarget(valid);
    if (valid) {
      const r = ops!.rectOf(valid);
      if (r) {
        // If the tile exposes named ports (composite block), snap to the PORT
        // nearest the cursor and remember its handle id. Otherwise snap to the
        // nearest side center.
        const ports = ops!.portsOf(valid);
        if (ports.length) {
          let best = ports[0];
          let bestD = Infinity;
          for (const p of ports) {
            const dx = p.x - f.x, dy = p.y - f.y, dd = dx * dx + dy * dy;
            if (dd < bestD) { bestD = dd; best = p; }
          }
          setDrag({ ...drag, x: best.x, y: best.y, side: "l", handle: best.handle });
          return;
        }
        const side = nearestSide(r, f.x, f.y);
        const snap = sidePoint(r, side, 0.5);
        setDrag({ ...drag, x: snap.x, y: snap.y, side, handle: undefined });
        return;
      }
    }
    setDrag({ ...drag, x: f.x, y: f.y, side: undefined, handle: undefined });
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const f = ops!.toFlow(e.clientX, e.clientY);
    // Exclude the OTHER endpoint, exactly as the `move` preview does — otherwise
    // the preview could snap to a valid nearby target while this commit resolves
    // to the (nearer, excluded) other endpoint and silently drops the reconnect.
    const otherEnd = drag.end === "source" ? target : source;
    const over = ops!.nodeAt(f.x, f.y, undefined, otherEnd);
    if (over) ops!.retarget(id, drag.end, over, drag.handle ?? drag.side); // else keep old edge
    ops!.setDropTarget(null);
    setDrag(null);
  };

  // Escape while dragging an endpoint CANCELS the reposition — drop the drag +
  // clear the drop-target WITHOUT retargeting, so the edge keeps its original
  // endpoint (the subsequent pointerup is a no-op since `end` guards on `drag`).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      ops?.setDropTarget(null);
      setDrag(null);
    };
    // Capture phase so we cancel before any other Escape handler (e.g. the canvas
    // clearing selection) reacts.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag, ops]);

  // Endpoint grab-dots — only shown when the edge is SELECTED/dragging (below),
  // so they're always full-size + bright. Drag one to reconnect that end.
  const dotProps = {
    r: 7,
    fill: "var(--primary)", stroke: "var(--background)", strokeWidth: 2,
    opacity: 1,
    // Don't intercept the pointer while a new connection is being dragged (see
    // `connecting`) — the drop must reach the target node's handle.
    style: { cursor: "grab", pointerEvents: connecting ? ("none" as const) : ("all" as const) },
    onPointerMove: move, onPointerUp: end,
  };

  // The vertical elbow handle (↔): sits at the segment's X, vertically between
  // the two endpoints. Only meaningful for smooth/step edges with a real
  // vertical run (source/target on left/right sides).
  const hasElbow = !hasBezier && !hasWaypoints && shape !== "straight" && (fan.sSide === "l" || fan.sSide === "r") && (fan.tSide === "l" || fan.tSide === "r");
  const elbowY = (sp.y + tp.y) / 2;
  // The elbow DRAG handle follows the cursor / saved centerX (so dragging feels
  // live). The LABEL, however, must sit on the ACTUAL drawn line: an elbow X only
  // moves the line when there's a horizontal gap for the vertical run — when the
  // two nodes are (near-)vertically aligned, getSmoothStepPath draws a straight
  // line at ~sp.x and IGNORES centerX, so a centerX-anchored label would drift
  // sideways off a line that never moved. Pin the label to the line midpoint in
  // that case.
  const elbowX = centerDrag ?? d?.centerX ?? fan.centerX ?? (sp.x + tp.x) / 2;
  const HAS_H_RUN = Math.abs(tp.x - sp.x) > 8;
  // Where the label sits. If the user parked the vertical-elbow handle (manual
  // centerX) on a horizontal-run edge, honour that. Otherwise use the label X/Y
  // getSmoothStepPath/getStraightPath computed ON THE PATH — for an L-shaped
  // (step) route that's the elbow centre, so the label lands on the line instead
  // of floating in the gap between the two boxes (the "Feedback loop" bug).
  const manualElbow = hasElbow && HAS_H_RUN && (centerDrag != null || d?.centerX != null);
  // getSmoothStepPath's returned label X/Y usually sits on the drawn path, BUT for
  // "overshoot" geometries (a backward step where the elbow is pushed past an
  // endpoint) it returns a point OUTSIDE the endpoint span — the label then floats
  // off the line (the "Load" label drifting left of the UC Model Registry). When
  // the path-computed label falls outside the source↔target box, fall back to the
  // endpoint midpoint (always between the two boxes); otherwise trust the path
  // label (correct elbow centre for normal L-shapes).
  // Clamp/fallback against the SAME endpoints the drawn path used (`sPt`/`tPt`),
  // not the resting `sp`/`tp` — during an endpoint reconnect drag they diverge,
  // and comparing the dragged path label to the resting box would jump the label
  // off the line for a frame.
  // The shared rule (edge-geometry.resolveLabelAnchor) — label-layout places against the same point.
  const resolved = resolveLabelAnchor({ x: pathLabelX, y: pathLabelY }, sPt, tPt, fan.sSide, fan.tSide);
  const anchorX = manualElbow ? elbowX : resolved.x;
  const anchorY = manualElbow ? elbowY : resolved.y;
  // Then shift it clear of tiles / other labels. Suppressed while a drag is live
  // (the pass runs on at-rest geometry, so mid-drag it would lag a frame) and for
  // a manually-parked elbow (the user positioned this label deliberately).
  const shift = drag || centerDrag !== null || manualElbow || manualLabel ? null : labelShift;
  // A MANUAL label wins over both the anchor and the auto shift: `labelPos` stores
  // a fraction along the path (plus a perpendicular nudge), so it is resolved
  // against the polyline we just drew and stays on the line when nodes move.
  // While dragging, resolve the LIVE pointer through the same projection the drop
  // will commit, so the chip previews exactly where it will land (including the
  // endpoint clamp) rather than tracking the cursor and then jumping on release.
  const livePos = labelDrag
    ? labelPosFromPoint(pathToPolyline(rawPath), labelDrag.x, labelDrag.y)
    : null;
  const effectiveLabelPos = livePos ?? manualLabel;
  const manualAnchor = effectiveLabelPos
    ? labelAnchorAt(pathToPolyline(rawPath), effectiveLabelPos)
    : null;
  const labelX = manualAnchor ? manualAnchor.x : anchorX + (shift?.dx ?? 0);
  const labelY = manualAnchor ? manualAnchor.y : anchorY + (shift?.dy ?? 0);
  const startCenterDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setCenterDrag(ops!.toFlow(e.clientX, e.clientY).x);
  };

  // --- Manual label drag ----------------------------------------------------
  // Mirrors the elbow handle: live position in local state, ONE commit on release
  // so history gets a single entry rather than one per pointer frame.
  const startLabelDrag = (e: React.PointerEvent) => {
    if (!label) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const f = ops!.toFlow(e.clientX, e.clientY);
    setLabelDrag({ x: f.x, y: f.y });
  };
  const moveLabelDrag = (e: React.PointerEvent) => {
    if (labelDrag === null || !(e.buttons & 1)) return;
    e.stopPropagation();
    const f = ops!.toFlow(e.clientX, e.clientY);
    setLabelDrag({ x: f.x, y: f.y });
  };
  const endLabelDrag = (e: React.PointerEvent) => {
    if (labelDrag === null) return;
    e.stopPropagation();
    // Project the drop point onto the path: the along-path component becomes `t`,
    // the residual becomes the perpendicular `off`. So one free drag serves both
    // "slide along the line" and "park it across the line" with no modifier.
    const pos = labelPosFromPoint(pathToPolyline(rawPath), labelDrag.x, labelDrag.y);
    setLabelDrag(null);
    ops!.setEdgeLabelPos(id, pos);
  };
  const moveCenter = (e: React.PointerEvent) => {
    if (centerDrag === null || !(e.buttons & 1)) return;
    e.stopPropagation();
    setCenterDrag(ops!.toFlow(e.clientX, e.clientY).x);
  };
  const endCenter = (e: React.PointerEvent) => {
    if (centerDrag === null) return;
    e.stopPropagation();
    ops!.setEdgeCenterX(id, Math.round(centerDrag));
    setCenterDrag(null);
  };
  const startControlDrag = (index: 0 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = ops!.toFlow(e.clientX, e.clientY);
    setControlDrag({ index, point: p });
  };
  const moveControlDrag = (e: React.PointerEvent) => {
    if (!controlDrag || !(e.buttons & 1)) return;
    e.stopPropagation();
    setControlDrag({ ...controlDrag, point: ops!.toFlow(e.clientX, e.clientY) });
  };
  const endControlDrag = (e: React.PointerEvent) => {
    if (!controlDrag) return;
    e.stopPropagation();
    const points: [{ x: number; y: number }, { x: number; y: number }] = customControls.map((p, i) =>
      i === controlDrag.index ? { ...controlDrag.point } : { ...p },
    ) as [{ x: number; y: number }, { x: number; y: number }];
    ops!.setEdgeControlPoints(id, points);
    setControlDrag(null);
  };
  const startWaypointDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setWaypointDrag({ index, point: ops!.toFlow(e.clientX, e.clientY) });
  };
  const moveWaypointDrag = (e: React.PointerEvent) => {
    if (!waypointDrag || !(e.buttons & 1)) return;
    e.stopPropagation();
    setWaypointDrag({ ...waypointDrag, point: ops!.toFlow(e.clientX, e.clientY) });
  };
  const endWaypointDrag = (e: React.PointerEvent) => {
    if (!waypointDrag) return;
    e.stopPropagation();
    const points = savedWaypoints.length ? savedWaypoints.map((p, i) => i === waypointDrag.index ? waypointDrag.point : p) : [waypointDrag.point];
    ops!.setEdgeWaypoints(id, points);
    setWaypointDrag(null);
  };

  // The flowing-data animation: a single dot, streaming particles (dots + red
  // squares), moving documents, or a laser beam.
  // Flow style: an explicit edge choice wins; when NONE is set, derive it from
  // the edge's endpoints — the SOURCE kind + the target's named ingest port say
  // HOW the data arrives, so the animation matches with zero extra config:
  //   • an edge touching the UC MODEL REGISTRY → `model` — an ML model glyph
  //     travelling the line (a registered/served model flowing through).
  //   • FROM a PDF / document source, OR into an `in-direct` file port → `docs` —
  //     travelling document glyphs.
  //   • `in-zerobus` (realtime streams / sensors) → `particles` — a dense river.
  //   • any other edge FROM a data source → `laser` — a bright ingest beam.
  //   • a non-source origin → a plain `dot`.
  const targetHandle = props.targetHandleId ?? undefined;
  const sData = sNode?.data as { type?: string; sourceKey?: string; component?: { icon?: string } } | undefined;
  const tData = tNode?.data as { type?: string } | undefined;
  const isSource = sData?.type === "source" || !!sData?.sourceKey || source.startsWith("src-");
  // Base ids (strip a `#N` duplicate suffix) — computed once, reused below.
  const srcBase = source.replace(/#\d+$/, "");
  const tgtBase = target.replace(/#\d+$/, "");
  // A document/PDF source (by id or icon) → its ingest is files, so `docs` even
  // when it lands on a plain tile (e.g. the medallion @l), not just an `in-direct`
  // Lakeflow port. Only a SOURCE origin can be a doc source, so gate on it.
  const isDocSource =
    isSource
    && (srcBase === "src-pdf"
      || /pdf|doc/i.test(sData?.sourceKey ?? "")
      || /pdf|doc/i.test(sData?.component?.icon ?? ""));
  // Either endpoint is the UC Model Registry? (base id, so `uc-model-registry#2`
  // counts too). A model leaving/entering the registry rides the line as a model.
  const touchesModelReg = srcBase === "uc-model-registry" || tgtBase === "uc-model-registry";
  const autoStyle: FlowStyle =
    touchesModelReg ? "model"
    : targetHandle === "in-zerobus" ? "particles"
    : targetHandle === "in-direct" || isDocSource ? "docs"
    : isSource ? "laser"
    : "dot";
  const flowStyle = d?.flowStyle ?? autoStyle;
  // Arrowheads. "auto" (the default / empty) picks a sensible direction so a
  // STATIC export (PNG/SVG) shows flow direction without the author hand-setting
  // an arrow on every edge. Explicit none/end/start/both always override — set
  // one for the rare edge auto would guess wrong (e.g. a return/feedback edge).
  // The auto DIRECTION is meaningful and ignores which end is source/target:
  //   • user      → the arrow points INTO Genie One   (the user enters there).
  //   • Genie One → the arrow points AWAY from Genie One, to the resource
  //                 (dashboard / Genie Space / app).
  //   • a PROCESS-FLOW edge (either end is a `shape` node — a flowchart
  //     step/decision/etc.) → arrow at the target: a flowchart step→step edge is
  //     directional by definition, so a shape diagram gets arrows for free.
  // We pick "end" (arrow at target) vs "start" (arrow at source) accordingly.
  // NOTE: a plain data-FLOW edge between components (lakehouse/lakebase/dashboard
  // etc.) gets NO auto arrow — the animated flow already shows direction on the
  // canvas, and a static platform diagram reads cleaner without an arrowhead on
  // every rail. Set `arrow:"end"` explicitly on the rare edge that needs one.
  const isUser = (node: typeof sNode) => {
    const icon = (node?.data as { annotation?: { icon?: string } } | undefined)?.annotation?.icon;
    return typeof icon === "string" && icon.includes("persona/user");
  };
  const srcUser = isUser(sNode), tgtUser = isUser(tNode);
  const srcGO = srcBase === "genie-one", tgtGO = tgtBase === "genie-one";
  const arrowSetting = (d?.arrow ?? "auto") as "auto" | "none" | "end" | "start" | "both";
  let arrow: "none" | "end" | "start" | "both";
  if (arrowSetting !== "auto") {
    arrow = arrowSetting;
  } else if (srcUser || tgtUser) {
    // arrow points at Genie One (the non-user end)
    arrow = srcUser ? "end" : "start";
  } else if (srcGO || tgtGO) {
    // arrow points away from Genie One, toward the resource
    arrow = srcGO ? "end" : "start";
  } else if (srcBase === "uc-model-registry") {
    // An edge LEAVING the UC Model Registry shows direction by default — the
    // registered model flows OUT to its target (serving / batch job). An edge
    // merely arriving at a model node gets no auto arrow.
    arrow = "end";
  } else if (sData?.type === "shape" || tData?.type === "shape") {
    // A process-flow (flowchart) edge — either endpoint is a `shape` node. A
    // flowchart step→step edge is directional, so it reads target-pointing; an
    // explicit `arrow` still overrides for a feedback/return branch. Ordinary
    // data-flow edges between components get NO auto arrow (see the note above).
    arrow = "end";
  } else {
    arrow = "none";
  }
  const isArrow = arrow !== "none";
  // STATIC-ONLY arrowhead. An animated (flow) edge with no explicit `arrow` gets a
  // target arrowhead in a STATIC render (PNG/SVG export, agent snapshot, headless
  // render), so direction reads without the animation. The live canvas keeps its
  // arrowless look: the overlay carries `arch-arrow-static`, which the stylesheet
  // hides unless the document is in static mode (see styles/globals.css).
  const staticOnlyArrow = !isArrow && arrowSetting === "auto" && !!d?.animated;
  const showArrows = isArrow || staticOnlyArrow;
  // An arrow no longer suppresses the flow animation — the arrowhead is drawn on
  // its OWN overlay path (below) so it sits on top of ANY line style, including
  // an animated laser/particles beam. Flow keeps running underneath.
  const flowing = d?.animated && !drag && centerDrag === null;
  // Below ~35% zoom the per-particle glyphs are sub-pixel; skip the (expensive)
  // animation entirely and let the base line carry the edge. Primitive return →
  // no comparator, re-renders only when crossing the threshold.
  const showFlow = useStore((s) => s.transform[2] >= 0.35);

  // The base line is styled by the RESOLVED flowStyle (which may be
  // auto-derived). When the animation is ON: particles/laser ARE the line
  // (transparent base); docs ride a faint line; dot keeps the grey line. When
  // flow is OFF, always show the normal grey line so the edge reads. Any
  // arrowhead is drawn separately on the overlay path, so a transparent base
  // here never hides it. "beamish" styles (particles/laser) ARE the line, so the
  // base goes transparent — but only while the animation is actually rendered.
  // When it's suppressed (zoomed out), fall back to a visible base line.
  const beamish = flowing && showFlow && (flowStyle === "particles" || flowStyle === "laser");
  // The model glyph rides a DASHED line in the model's own orange (#FF5F46) so
  // the "a model flows here" cue reads even before you spot the travelling icon.
  const MODEL_ORANGE = "#FF5F46";
  const slide = d?.theme === "slide";
  // An authored edge colour (`color`, hex) replaces the grey/model stroke and
  // the arrowhead + label chip take it too. A coloured line is drawn at full
  // opacity — the muted opacity steps exist to recede GREY lines, and would wash
  // a deliberate colour out to pale.
  const tint = d?.color || undefined;
  const opac = (muted: number) => (tint ? 1 : muted);
  const baseStyle = !flowing
    // A STATIC (non-animated) edge should read as SECONDARY to the animated ones —
    // it carries no motion cue, so a near-black line made it compete for attention
    // and it was hard to tell the fixed lines from the flowing ones. Use the muted
    // grey (not --foreground) at a lower opacity so static edges recede a touch.
    ? { ...style, stroke: tint ?? "var(--muted-foreground)", strokeWidth: 1.5, opacity: opac(slide ? 0.55 : 0.45) }
    : beamish
      ? { ...style, stroke: "transparent" as const, opacity: 1 }
      : flowStyle === "model"
        ? { ...style, stroke: tint ?? MODEL_ORANGE, strokeWidth: 1.5, strokeDasharray: "5 4", opacity: opac(slide ? 0.78 : 0.7) }
        : flowStyle === "docs"
          ? { ...style, stroke: tint ?? "var(--muted-foreground)", strokeWidth: slide ? 1.25 : 1, opacity: opac(slide ? 0.45 : 0.3) }
          : { ...style, stroke: tint ?? "var(--muted-foreground)", strokeWidth: 1.5, opacity: opac(slide ? 0.65 : 0.55) };
  // SELECTION feedback: a selected edge draws a THICKER, fully-opaque primary
  // stroke so it clearly reads as picked — even for beamish styles whose normal
  // base is transparent (we force a visible line under the animation). Preserves
  // the resolved dasharray (model stays dashed).
  const selBaseWidth = ((baseStyle as { strokeWidth?: number }).strokeWidth ?? 1.5) + 2;
  const finalBaseStyle = selected
    ? { ...baseStyle, stroke: "var(--primary)", strokeWidth: selBaseWidth, opacity: 1 }
    : baseStyle;
  // Arrowheads come from the resolved `arrow` (end/start/both) and paint via a
  // dedicated overlay path (below) so they sit on top of any line style. We
  // define the marker INLINE in this edge's own SVG output (unique id per edge)
  // so it's always in the same SVG document as the path — a shared <defs> in a
  // sibling SVG isn't reliably resolvable by ReactFlow's edge paths.
  const arrowEnd = arrow === "end" || arrow === "both" || staticOnlyArrow;
  const arrowStart = arrow === "start" || arrow === "both";
  const mid = `arrowhead-${id}`;
  const markerEndUrl = arrowEnd ? `url(#${mid})` : undefined;
  const markerStartUrl = arrowStart ? `url(#${mid})` : undefined;
  // The model edge's arrowhead matches its orange line; everything else keeps the
  // neutral grey marker.
  const arrowFill = tint ?? (flowStyle === "model" ? "#FF5F46" : "var(--muted-foreground)");

  return (
    <>
      {showArrows && (
        <defs>
          <marker id={mid} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={arrowFill} opacity={tint ? 1 : 0.7} />
          </marker>
        </defs>
      )}
      {/* interactionWidth kept modest: a fat stripe blankets the source/target
          anchors and steals the pointer, so you can't start a NEW link (fork)
          from an already-connected anchor. 10px still clicks the line easily. */}
      <BaseEdge path={path} style={finalBaseStyle} className={flowing ? "arch-flow-base" : undefined} interactionWidth={connecting ? 0 : 10} />
      {/* Double-click the line → open the inline mid-line label editor. A wide
          transparent hit path (only in edit mode, not mid-connection) so a
          double-click anywhere along the edge triggers it. */}
      {ops?.editMode && !connecting && (
        <path
          d={path} fill="none" stroke="transparent" strokeWidth={16}
          // Hand pointer over the line; it becomes a text caret only once the
          // inline label editor is open (double-click to enter it).
          style={{ pointerEvents: "stroke", cursor: "pointer" }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            // Shift-double-click is the quick way to add another custom step
            // waypoint without requiring a second menu action. Ordinary
            // double-click keeps its existing label-edit behaviour.
            if (e.shiftKey && hasWaypoints) {
              ops.setEdgeWaypoints(id, [...savedWaypoints, ops.toFlow(e.clientX, e.clientY)]);
            } else {
              setLabelDraft(typeof label === "string" ? label : "");
            }
          }}
        />
      )}
      {/* Key by edge id (NOT path): a drag/resize changes `path`, but keying by
          it would unmount + remount the whole SMIL subtree every frame. Keyed
          by id, the animated elements stay mounted and just re-read the updated
          `path` attribute. Hidden below a zoom threshold (sub-pixel anyway). */}
      {/* Decorative flow animation — never captures the pointer (it sits at the
          edge zIndex, so without this a beam over a target handle would swallow
          a connection drop). */}
      {flowing && showFlow && (
        <g className="arch-flow" style={{ pointerEvents: "none" }}>
          <EdgeFlow key={id} style={flowStyle} path={path} />
        </g>
      )}

      {/* Arrowhead overlay — its OWN transparent path so the arrow sits on top of
          ANY line style (incl. a beamish laser/particles base that's transparent
          or an animated flow). Drawn AFTER the flow so it's never occluded; the
          stroke is transparent so it adds no visible line, only the marker. */}
      {showArrows && (
        <path
          d={path} fill="none" stroke="transparent" markerEnd={markerEndUrl} markerStart={markerStartUrl}
          className={staticOnlyArrow ? "arch-arrow-static" : undefined}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Mid-line label. Double-click the line to add/edit (also right-click →
          Add label). Pill sits on the vertical-elbow centre, above the line; a
          backing rect keeps it readable. While editing, an inline input replaces
          the pill (commit on Enter/blur, cancel on Escape; empty removes it). */}
      {labelDraft !== null ? (
        <foreignObject x={labelX - 70} y={labelY - 12} width={140} height={24} style={{ overflow: "visible" }}>
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => { ops!.setEdgeLabel(id, labelDraft.trim()); setLabelDraft(null); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { ops!.setEdgeLabel(id, labelDraft.trim()); setLabelDraft(null); }
              else if (e.key === "Escape") setLabelDraft(null);
            }}
            style={{
              width: "100%", textAlign: "center", fontSize: 11, fontWeight: 500,
              padding: "1px 4px", borderRadius: 4, border: "1px solid var(--primary)",
              background: "var(--background)", color: "var(--foreground)", outline: "none",
            }}
          />
        </foreignObject>
      ) : (
        typeof label === "string" && label && (
          <>
          {/* Stepped far enough off the line to read as detached — tie it back
              with a hairline leader so it's still obviously THIS edge's label. */}
          {shift?.leader && (
            <line
              x1={anchorX} y1={anchorY} x2={labelX} y2={labelY}
              stroke="var(--border)" strokeWidth={1} strokeDasharray="2 2"
              style={{ pointerEvents: "none" }}
            />
          )}
          {/* PORTALLED out of this edge's <svg> into ReactFlow's edge-label layer.
              Every edge is its own <svg> painted in document order, so a chip drawn
              inline is overpainted by every edge that comes AFTER it — on the
              mlops-v2 slide, e7's "Approved only" sat under e11/e12/e13's routing
              lines. No opacity or backing plate inside e7 can win that; the label
              has to leave the edge's own SVG. The label layer renders after all
              edges, so a crossing line is behind the chip by construction. */}
          <EdgeLabelRenderer>
          <svg className="absolute overflow-visible"
               style={{ left: 0, top: 0, width: 1, height: 1, pointerEvents: "none" }}>
          <g transform={`translate(${labelX} ${labelY})`}
             style={{ pointerEvents: ops?.editMode ? "all" : "none", cursor: ops?.editMode ? (labelDrag ? "grabbing" : "grab") : "default" }}
             onPointerDown={ops?.editMode ? startLabelDrag : undefined}
             onPointerMove={ops?.editMode ? moveLabelDrag : undefined}
             onPointerUp={ops?.editMode ? endLabelDrag : undefined}
             onDoubleClick={ops?.editMode ? (e) => {
               e.stopPropagation();
               // Shift-double-click hands a manually placed label back to the
               // solver — the analogue of double-clicking the elbow to clear
               // centerX. Plain double-click keeps its existing job (edit the text),
               // so the reset needs its own modifier rather than stealing that.
               if (e.shiftKey && manualLabel) ops!.setEdgeLabelPos(id, undefined);
               else setLabelDraft(label);
             } : undefined}>
            {/* Wrapped pill. Geometry comes from `label-chip`, the SAME module
                `label-layout` measures with — don't inline sizes here or the
                placement pass reserves a box that isn't the one drawn. */}
            {(() => {
              const fontPx = d?.labelFontSize ?? EDGE_LABEL_FONT;
              const chip = measureLabel(label, fontPx);
              return (
                <>
                  {/* TWO rects, and the first one is the point. The chip renders
                      above every edge stroke, so an OPAQUE plate is what makes a
                      line cross BEHIND the label instead of straight through the
                      text. The visible pill keeps its 0.95 opacity for the softer
                      look, but it can only soften what is already hidden.

                      This is why the feature is not a path edit: an earlier attempt
                      cut a gap into the crossing edge's own path string, which broke
                      inspect-arch (getPointAtLength interpolates across a pen lift,
                      inventing 14 phantom crossings) AND could not work anyway,
                      since SVG paints edges in document order — a cover drawn in one
                      edge's group is overpainted by every edge after it. Backing the
                      chip sidesteps ordering entirely: labels render last. */}
                  <rect x={-chip.w / 2} y={-chip.h / 2} width={chip.w} height={chip.h} rx={4}
                    fill="var(--background)" stroke="none" />
                  <rect x={-chip.w / 2} y={-chip.h / 2} width={chip.w} height={chip.h} rx={4}
                    fill="var(--background)" stroke={tint ?? "var(--border)"} strokeWidth={1} opacity={0.95} />
                  <text textAnchor="middle" fontSize={fontPx}
                    fill={tint ?? "var(--foreground)"} style={{ fontWeight: 500 }}>
                    {/* Clamped at MAX_LINES → the full text stays reachable as a
                        tooltip, so wrapping never destroys content. */}
                    {isClamped(label, fontPx) && <title>{label}</title>}
                    {chip.lines.map((line, i) => (
                      <tspan key={i} x={0} y={lineCenterY(i, chip.h, fontPx)} dominantBaseline="central">{line}</tspan>
                    ))}
                  </text>
                </>
              );
            })()}
          </g>
          </svg>
          </EdgeLabelRenderer>
          </>
        )
      )}

      {/* Step waypoints. An empty custom list starts with one temporary midpoint;
          dragging it creates the first persisted waypoint. */}
      {hasWaypoints && (selected || waypointDrag !== null) && ops?.editMode && (
        <g>
          {visibleWaypoints.map((p, index) => (
            <g key={index} style={{ pointerEvents: "all", cursor: "move" }}
               onPointerDown={startWaypointDrag(index)} onPointerMove={moveWaypointDrag} onPointerUp={endWaypointDrag}
               onDoubleClick={(e) => { e.stopPropagation(); ops.setEdgeWaypoints(id, undefined); }}>
              <circle cx={p.x} cy={p.y} r={8} fill="var(--background)" stroke="var(--primary)" strokeWidth={2} />
              <path d={`M ${p.x - 3} ${p.y} H ${p.x + 3} M ${p.x} ${p.y - 3} V ${p.y + 3}`} stroke="var(--primary)" strokeWidth={1.5} />
            </g>
          ))}
        </g>
      )}

      {/* Bézier control handles. They are deliberately only shown for a selected
          edge: the controls are authoring chrome, not part of the diagram. */}
      {hasBezier && (selected || controlDrag !== null) && ops?.editMode && (
        <g>
          {[0, 1].map((rawIndex) => {
            const index = rawIndex as 0 | 1;
            const p = controlDrag?.index === index ? controlDrag.point : customControls[index];
            const end = index === 0 ? sPt : tPt;
            return (
              <g key={index} style={{ pointerEvents: "all", cursor: "crosshair" }}
                 onPointerDown={startControlDrag(index)} onPointerMove={moveControlDrag} onPointerUp={endControlDrag}
                 onDoubleClick={(e) => { e.stopPropagation(); ops.setEdgeControlPoints(id, undefined); }}>
                <line x1={end.x} y1={end.y} x2={p.x} y2={p.y} stroke="var(--primary)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
                <circle cx={p.x} cy={p.y} r={7} fill="var(--background)" stroke="var(--primary)" strokeWidth={2} />
                <circle cx={p.x} cy={p.y} r={2.5} fill="var(--primary)" />
              </g>
            );
          })}
        </g>
      )}

      {/* ↔ handle to drag the vertical elbow left/right (hover or select). */}
      {hasElbow && (selected || centerDrag !== null) && ops?.editMode && (
        <g transform={`translate(${centerDrag ?? elbowX} ${elbowY})`} style={{ cursor: "ew-resize", pointerEvents: "all" }}
           onPointerDown={startCenterDrag} onPointerMove={moveCenter} onPointerUp={endCenter}
           onDoubleClick={(e) => { e.stopPropagation(); ops!.setEdgeCenterX(id, undefined); }}>
          <rect x={-8} y={-6} width={16} height={12} rx={3} fill="var(--background)" stroke="var(--primary)" strokeWidth={1.5} />
          <path d="M-4 0 L-1.5 -2.2 M-4 0 L-1.5 2.2 M4 0 L1.5 -2.2 M4 0 L1.5 2.2 M-4 0 H4" stroke="var(--primary)" strokeWidth={1.2} fill="none" strokeLinecap="round" />
        </g>
      )}

      {/* Draggable endpoint dots — shown ONLY when the edge is SELECTED (or
          mid-drag). Select a line → its two endpoints appear (drag one onto
          another tile to reconnect). When NOT selected the line shows no dots;
          you start a NEW line from a COMPONENT's own hover anchor instead. */}
      {(selected || drag !== null) && ops?.editMode && (
        <>
          <circle cx={drag?.end === "source" ? drag.x : sDot.x} cy={drag?.end === "source" ? drag.y : sDot.y} {...dotProps} onPointerDown={start("source")} />
          <circle cx={drag?.end === "target" ? drag.x : tDot.x} cy={drag?.end === "target" ? drag.y : tDot.y} {...dotProps} onPointerDown={start("target")} />
        </>
      )}
    </>
  );
});

export { FlowEdge };
