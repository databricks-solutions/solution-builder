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
  spreadFrac,
  endSide,
  rectOf,
} from "../edge-routing";
import { PORT_FRAC, portAnchor } from "../composite-lakeflow";
import { EdgeFlow } from "./edge-flow";

const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const { id, source, target, sourceHandleId, targetHandleId, markerEnd, style, data, selected, label } = props;
  const sNode = useInternalNode(source);
  const tNode = useInternalNode(target);
  const ops = useContext(EdgeOpsContext);
  const d = data as EdgeData | undefined;

  // For fan-out: among all edges sharing this edge's (node, side) anchor, find
  // this edge's index + the group size, so we can spread them along the side.
  const fan = useStore((s) => {
    const node = (nid: string) => s.nodeLookup.get(nid);
    const rect = (nid: string) => {
      const n = node(nid);
      return n ? rectOf(n as never) : null;
    };
    const sideForEnd = (e: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }, end: "source" | "target"): Side | null => {
      const selfR = rect(end === "source" ? e.source : e.target);
      const otherR = rect(end === "source" ? e.target : e.source);
      if (!selfR || !otherR) return null;
      const oc = { x: otherR.x + otherR.w / 2, y: otherR.y + otherR.h / 2 };
      return endSide(selfR, end === "source" ? e.sourceHandle : e.targetHandle, oc);
    };
    // Group key = nodeId|side. For each edge in a group, remember the OTHER
    // endpoint's center coordinate along the side's perpendicular axis (Y for
    // left/right sides, X for top/bottom). Sorting the group by that key makes
    // the fan order follow the other tiles' positions → lines don't cross, and
    // it re-sorts live as nodes are dragged (this selector reads live rects).
    const groups = new Map<string, { id: string; key: number }[]>();
    s.edges.forEach((e) => {
      for (const end of ["source", "target"] as const) {
        const side = sideForEnd(e, end);
        if (!side) continue;
        const nid = end === "source" ? e.source : e.target;
        const otherR = rect(end === "source" ? e.target : e.source);
        if (!otherR) continue;
        const sortKey =
          side === "l" || side === "r"
            ? otherR.y + otherR.h / 2 // order by other tile's vertical center
            : otherR.x + otherR.w / 2; // top/bottom → horizontal center
        // Group by the specific PORT handle if this end targets one (so edges
        // sharing a port fan within it); else by node|side.
        const handle = end === "source" ? e.sourceHandle : e.targetHandle;
        const port = handle && handle in PORT_FRAC ? handle : null;
        const key = port ? `${nid}|${port}` : `${nid}|${side}`;
        const arr = groups.get(key) ?? [];
        arr.push({ id: e.id, key: sortKey });
        groups.set(key, arr);
      }
    });
    const idx = (key: string) => {
      const arr = (groups.get(key) ?? [])
        .slice()
        // Sort by other-endpoint position; tie-break on id for stability.
        .sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1));
      return { i: arr.findIndex((x) => x.id === id), n: arr.length };
    };
    // Recompute this edge's sides here too (selector is self-contained).
    const sR = rect(source);
    const tR = rect(target);
    if (!sR || !tR) return null;
    const sCtr = { x: sR.x + sR.w / 2, y: sR.y + sR.h / 2 };
    const tCtr = { x: tR.x + tR.w / 2, y: tR.y + tR.h / 2 };
    const ss = endSide(sR, sourceHandleId, tCtr);
    const ts = endSide(tR, targetHandleId, sCtr);
    const sPort = portAnchor(sourceHandleId);
    const tPort = portAnchor(targetHandleId);
    // Group index/count: by port if the end targets one, else by side.
    const sg = idx(sPort ? `${source}|${sourceHandleId}` : `${source}|${ss}`);
    const tg = idx(tPort ? `${target}|${targetHandleId}` : `${target}|${ts}`);
    // Edges sharing a PORT fan around its base fraction with a tight gap (so
    // 3 sources into one port spread slightly instead of stacking).
    const portFan = (base: number, i: number, n: number) =>
      n <= 1 ? base : Math.min(0.95, Math.max(0.05, base + (i - (n - 1) / 2) * 0.06));

    // Stagger the vertical mid-segment (centerX) for edges converging on the
    // same target anchor, so their elbows don't stack on one vertical line.
    // The direction depends on which SIDE of the anchor the source sits:
    //   • source ABOVE the anchor  → bend its vertical to the LEFT  (out, then
    //     drop down into the anchor) — farther above ⇒ farther left;
    //   • source BELOW the anchor  → bend to the RIGHT (drop up into it).
    // This makes the lines fan symmetrically around the anchor without crossing,
    // and behaves correctly for a top port (most sources below it), a bottom
    // port (most sources above it), or a middle one. Magnitude = rank among
    // same-side siblings so two sources on the same side still separate.
    // Only meaningful when the target end is a horizontal side (l/r).
    const tEndSide = tPort?.side ?? ts;
    const tFrac = tPort ? portFan(tPort.frac, tg.i < 0 ? 0 : tg.i, tg.n) : spreadFrac(tg.i < 0 ? 0 : tg.i, tg.n);
    let centerX: number | undefined;
    if (tg.n > 1 && (tEndSide === "l" || tEndSide === "r")) {
      const midX = (sCtr.x + tCtr.x) / 2;
      const STEP = 22; // px between adjacent verticals
      // Anchor point's Y on the target side (computed from the rect we have in
      // the selector — `tp` isn't available until after the selector runs).
      const anchorY = sidePoint(tR, tEndSide, tFrac).y;
      const sibs = (groups.get(tPort ? `${target}|${targetHandleId}` : `${target}|${ts}`) ?? [])
        .slice()
        .sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1));
      const above = sCtr.y < anchorY; // this source sits above the anchor
      // Same-side siblings, ordered so the row NEAREST the anchor offsets least.
      const sameSide = sibs.filter((e) => (above ? e.key < anchorY : e.key >= anchorY));
      const pos = sameSide.findIndex((e) => e.id === id);
      // Magnitude by distance from the anchor: the source FARTHEST from the
      // anchor (top of an above-half / bottom of a below-half) offsets most, so
      // same-side lines fan out without crossing. `sameSide` is sorted top→bottom
      // by source Y; the row nearest the anchor offsets least in both halves.
      const mag = sameSide.length - pos;
      // Per the original spec: source ABOVE the anchor bends its vertical RIGHT
      // (+, toward/closer to the anchor), source BELOW bends LEFT (−).
      centerX = midX + (above ? 1 : -1) * mag * STEP;
    }
    return {
      sSide: sPort?.side ?? ss,
      tSide: tPort?.side ?? ts,
      sFrac: sPort ? portFan(sPort.frac, sg.i < 0 ? 0 : sg.i, sg.n) : spreadFrac(sg.i < 0 ? 0 : sg.i, sg.n),
      tFrac,
      centerX,
    };
  },
  // Shallow-compare so the selector doesn't trigger a re-render every store
  // tick (it returns a fresh object) — only when the computed anchors change.
  (a, b) =>
    !!a && !!b &&
    a.sSide === b.sSide && a.tSide === b.tSide &&
    a.sFrac === b.sFrac && a.tFrac === b.tFrac && a.centerX === b.centerX);

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
  const centerX = drag
    ? undefined
    : centerDrag ?? d?.centerX ?? fan.centerX;
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
  const flowing = d?.animated && !drag && centerDrag === null;
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
  const showArrow = !beamish;

  return (
    <>
      <BaseEdge path={path} markerEnd={showArrow ? markerEnd : undefined} style={baseStyle} interactionWidth={24} />
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
