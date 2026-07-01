/**
 * platform-diagram/edges/flow-edge — the custom ReactFlow edge (`FlowEdge`):
 * side/port-aware routing + fan-out, draggable endpoints + vertical elbow,
 * mid-line label, and the animated "data flowing" overlay.
 */
import { memo, useState, useContext } from "react";
import {
  useInternalNode,
  useStore,
  BaseEdge,
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
  rectOf,
} from "../edge-routing";
import { computeFanLayout } from "../fan-layout";
import { EdgeFlow } from "./edge-flow";

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
      a.sFrac === b.sFrac && a.tFrac === b.tFrac && a.centerX === b.centerX,
  );

  // Live endpoint drag (reconnect). Hook runs unconditionally before guards.
  const [drag, setDrag] = useState<{ end: "source" | "target"; x: number; y: number; side?: Side; handle?: string } | null>(null);
  // Live drag of the vertical-elbow handle (manual centerX). Hooks before guard.
  const [centerDrag, setCenterDrag] = useState<number | null>(null);

  if (!sNode || !tNode || !fan) return null;

  const sRect = rectOf(sNode as never);
  const tRect = rectOf(tNode as never);
  const sp = sidePoint(sRect, fan.sSide, fan.sFrac);
  const tp = sidePoint(tRect, fan.tSide, fan.tFrac);
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
    const OFFSET = 20; // smooth-step's built-in exit stub
    // Source side: elbow must be ≥ OFFSET past the source exit.
    if (fan.sSide === "r") centerX = Math.max(centerX, sp.x + OFFSET);
    else centerX = Math.min(centerX, sp.x - OFFSET);
    // Target side: elbow must be ≥ OFFSET before the target entry.
    if (fan.tSide === "l") centerX = Math.min(centerX, tp.x - OFFSET);
    else centerX = Math.max(centerX, tp.x + OFFSET);
  }
  const args = {
    sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y,
    sourcePosition: sPos, targetPosition: tPos,
    ...(centerX !== undefined ? { centerX } : {}),
  };
  const [path] =
    shape === "straight"
      ? getStraightPath({ sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y })
      : shape === "step"
      ? getSmoothStepPath({ ...args, borderRadius: 0 })
      : getSmoothStepPath({ ...args, borderRadius: 14 });

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
    const over = ops!.nodeAt(f.x, f.y);
    const otherEnd = drag.end === "source" ? target : source;
    const valid = over && over !== otherEnd ? over : null;
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
    const over = ops!.nodeAt(f.x, f.y);
    const otherEnd = drag.end === "source" ? target : source;
    if (over && over !== otherEnd) ops!.retarget(id, drag.end, over, drag.handle ?? drag.side); // else keep old edge
    ops!.setDropTarget(null);
    setDrag(null);
  };

  const dotProps = {
    r: 7, fill: "var(--primary)", stroke: "var(--background)", strokeWidth: 2,
    style: { cursor: "grab", pointerEvents: "all" as const },
    onPointerMove: move, onPointerUp: end,
  };

  // The vertical elbow handle (↔): sits at the segment's X, vertically between
  // the two endpoints. Only meaningful for smooth/step edges with a real
  // vertical run (source/target on left/right sides).
  const hasElbow = shape !== "straight" && (fan.sSide === "l" || fan.sSide === "r") && (fan.tSide === "l" || fan.tSide === "r");
  const elbowX = centerDrag ?? d?.centerX ?? fan.centerX ?? (sp.x + tp.x) / 2;
  const elbowY = (sp.y + tp.y) / 2;
  const startCenterDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setCenterDrag(ops!.toFlow(e.clientX, e.clientY).x);
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

  // The flowing-data animation: a single dot (default), streaming particles
  // (dots + red squares), or moving documents.
  // Flow style: an explicit user choice wins; otherwise derived from the SOURCE
  // node's ingest — but ONLY when the source is an actual data source (it has
  // an `ingest`). zerobus (realtime) → particles; direct (file landing) → docs;
  // lakeflow-connect (managed connectors) and everything else → plain dot. This
  // mirrors `seedEdges` exactly (laser is an explicit-choice-only style).
  const srcIngest = (sNode?.data as { component?: { ingest?: string } } | undefined)?.component?.ingest;
  const autoStyle: FlowStyle =
    srcIngest === "zerobus" ? "particles" : srcIngest === "direct" ? "docs" : "dot";
  const flowStyle = d?.flowStyle ?? autoStyle;
  // Arrowheads. "auto" (the default / empty) → a static arrow for RELATIONSHIP
  // edges: any edge touching the user persona or Genie One. Explicit
  // none/end/start/both override. The auto DIRECTION is meaningful and ignores
  // which end is source/target:
  //   • user      → the arrow points INTO Genie One   (the user enters there).
  //   • Genie One → the arrow points AWAY from Genie One, to the resource
  //                 (dashboard / Genie Room / app).
  // We pick "end" (arrow at target) vs "start" (arrow at source) accordingly.
  const isGenieOne = (nid: string) => nid.replace(/#\d+$/, "") === "genie-one";
  const isUser = (node: typeof sNode) => {
    const icon = (node?.data as { annotation?: { icon?: string } } | undefined)?.annotation?.icon;
    return typeof icon === "string" && icon.includes("persona/user");
  };
  const srcUser = isUser(sNode), tgtUser = isUser(tNode);
  const srcGO = isGenieOne(source), tgtGO = isGenieOne(target);
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
  } else {
    arrow = "none";
  }
  const isArrow = arrow !== "none";
  const flowing = d?.animated && !isArrow && !drag && centerDrag === null;
  // Below ~35% zoom the per-particle glyphs are sub-pixel; skip the (expensive)
  // animation entirely and let the base line carry the edge. Primitive return →
  // no comparator, re-renders only when crossing the threshold.
  const showFlow = useStore((s) => s.transform[2] >= 0.35);

  // The base line + arrow are styled by the RESOLVED flowStyle (which may be
  // auto-derived). When the animation is ON: particles/laser ARE the line
  // (transparent base, no arrow); docs ride a faint line; dot keeps the grey
  // line. When flow is OFF, always show the normal grey line so the edge reads.
  // "beamish" styles (particles/laser) ARE the line, so the base goes
  // transparent — but only while the animation is actually rendered. When it's
  // suppressed (zoomed out), fall back to a visible base line.
  const beamish = flowing && showFlow && (flowStyle === "particles" || flowStyle === "laser");
  const baseStyle = !flowing
    ? { ...style, stroke: "var(--muted-foreground)", opacity: 0.55 }
    : beamish
      ? { ...style, stroke: "transparent" as const, opacity: 1 }
      : flowStyle === "docs"
        ? { ...style, stroke: "var(--muted-foreground)", strokeWidth: 1, opacity: 0.3 }
        : { ...style, stroke: "var(--muted-foreground)", opacity: 0.55 };
  // Static arrowheads come from the resolved `arrow` (end/start/both). We define
  // the marker INLINE in this edge's own SVG output (unique id per edge) so it's
  // always in the same SVG document as the path — a shared <defs> in a sibling
  // SVG isn't reliably resolvable by ReactFlow's edge paths.
  const arrowEnd = arrow === "end" || arrow === "both";
  const arrowStart = arrow === "start" || arrow === "both";
  const mid = `arrowhead-${id}`;
  const markerEndUrl = arrowEnd ? `url(#${mid})` : undefined;
  const markerStartUrl = arrowStart ? `url(#${mid})` : undefined;

  return (
    <>
      {isArrow && (
        <defs>
          <marker id={mid} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" opacity="0.7" />
          </marker>
        </defs>
      )}
      <BaseEdge path={path} markerEnd={markerEndUrl} markerStart={markerStartUrl} style={baseStyle} interactionWidth={24} />
      {/* Key by edge id (NOT path): a drag/resize changes `path`, but keying by
          it would unmount + remount the whole SMIL subtree every frame. Keyed
          by id, the animated elements stay mounted and just re-read the updated
          `path` attribute. Hidden below a zoom threshold (sub-pixel anyway). */}
      {flowing && showFlow && <EdgeFlow key={id} style={flowStyle} path={path} />}

      {/* Optional mid-line label (right-click → Add label). Pill sits on the
          vertical elbow centre; a backing rect keeps it readable over the line. */}
      {typeof label === "string" && label && (
        <g transform={`translate(${elbowX} ${elbowY})`} style={{ pointerEvents: "none" }}>
          <rect x={-label.length * 3.2 - 5} y={-8} width={label.length * 6.4 + 10} height={16} rx={4}
            fill="var(--background)" stroke="var(--border)" strokeWidth={1} opacity={0.95} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={9.5}
            fill="var(--foreground)" style={{ fontWeight: 500 }}>{label}</text>
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

      {/* Click the line to select → these endpoint dots appear (just outside
          each tile). Drag one onto another tile (it highlights + snaps) to
          reconnect; drop on empty space keeps the original edge. */}
      {selected && ops?.editMode && (
        <>
          <circle cx={drag?.end === "source" ? drag.x : sDot.x} cy={drag?.end === "source" ? drag.y : sDot.y} {...dotProps} onPointerDown={start("source")} />
          <circle cx={drag?.end === "target" ? drag.x : tDot.x} cy={drag?.end === "target" ? drag.y : tDot.y} {...dotProps} onPointerDown={start("target")} />
        </>
      )}
    </>
  );
});

export { FlowEdge };
