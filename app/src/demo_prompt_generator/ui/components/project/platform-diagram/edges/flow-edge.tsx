/**
 * platform-diagram/edges/flow-edge — the custom ReactFlow edge (`FlowEdge`):
 * side/port-aware routing + fan-out, draggable endpoints + vertical elbow,
 * mid-line label, and the animated "data flowing" overlay.
 */
import { memo, useState, useContext } from "react";
import {
  useInternalNode,
  useStore,
  useConnection,
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
import { computeCrossings, type Hop } from "./crossings";
import { injectHops } from "./path-hops";
import { EdgeFlow } from "./edge-flow";

// Stable empty-hops fallback so the store selector returns the SAME ref when an
// edge has no crossings (a fresh [] each tick would defeat the equality check).
const EMPTY_HOPS: Hop[] = [];

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

  // Line jumps: the crossing points on THIS edge where it should hop OVER
  // another line. Computed for ALL edges at once (memoized, same pattern as the
  // fan selector). Compared by a cheap serialization so a tick that doesn't move
  // this edge's crossings doesn't re-render it.
  const hops = useStore(
    (s) => computeCrossings(s.edges, s.nodeLookup).get(id) ?? EMPTY_HOPS,
    (a, b) => a.length === b.length && a.every((h, i) => h.x === b[i].x && h.y === b[i].y),
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
  // Inline mid-line label editor (double-click the line). Holds the draft text
  // while open; null = not editing. Hooks before guard.
  const [labelDraft, setLabelDraft] = useState<string | null>(null);

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
  // getSmoothStepPath extends a fixed stub (default 20px) straight out of each
  // side before it's allowed to turn. When two connected tiles sit CLOSE
  // together, the source stub and the target stub overshoot past each other and
  // the path has to double back — the "S" wiggle. Shrink the stub so it never
  // eats more than its share of the gap between the exit and entry points: the
  // two stubs together stay within the available run, so the line turns once and
  // reads as a single gentle curve instead of an S. Only the facing axis matters
  // (horizontal sides → the x-gap; vertical sides → the y-gap).
  const horiz = (fan.sSide === "l" || fan.sSide === "r") && (fan.tSide === "l" || fan.tSide === "r");
  const vert = (fan.sSide === "t" || fan.sSide === "b") && (fan.tSide === "t" || fan.tSide === "b");
  const facingGap = horiz ? Math.abs(tp.x - sp.x) : vert ? Math.abs(tp.y - sp.y) : Infinity;
  // Cap each stub at ~40% of the gap (leaves 20% in the middle for the turn),
  // never above the default 20. Below the default only when tiles are within
  // ~50px — normal spacing is untouched.
  const stepOffset = Math.max(4, Math.min(20, facingGap * 0.4));
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
  const args = {
    sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y,
    sourcePosition: sPos, targetPosition: tPos,
    ...(centerX !== undefined ? { centerX } : {}),
  };
  // These helpers also return the label X/Y they compute ON the drawn path — for
  // a step (L-shaped) route that's the true centre of the elbow, NOT the midpoint
  // of the endpoints. We reuse them so the label sits on the line even when it
  // bends (see labelX/labelY below).
  const [rawPath, pathLabelX, pathLabelY] =
    shape === "straight"
      ? getStraightPath({ sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y })
      : shape === "step"
      ? getSmoothStepPath({ ...args, offset: stepOffset, borderRadius: 0 })
      : getSmoothStepPath({ ...args, offset: stepOffset, borderRadius: Math.min(14, stepOffset) });
  // Inject line-jump arcs where this edge crosses OVER another. Skip while
  // dragging an endpoint or the elbow — the geometry (and thus the crossings)
  // is transient and the hop points would lag a frame. `injectHops` no-ops when
  // there are no hops, so a crossing-free edge keeps its exact original path.
  const path = drag || centerDrag !== null ? rawPath : injectHops(rawPath, hops);

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
    const over = ops!.nodeAt(f.x, f.y);
    const otherEnd = drag.end === "source" ? target : source;
    if (over && over !== otherEnd) ops!.retarget(id, drag.end, over, drag.handle ?? drag.side); // else keep old edge
    ops!.setDropTarget(null);
    setDrag(null);
  };

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
  const hasElbow = shape !== "straight" && (fan.sSide === "l" || fan.sSide === "r") && (fan.tSide === "l" || fan.tSide === "r");
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
  const inBox = (v: number, a: number, b: number) => v >= Math.min(a, b) - 1 && v <= Math.max(a, b) + 1;
  const pathLabelOk = !manualElbow && inBox(pathLabelX, sPt.x, tPt.x) && inBox(pathLabelY, sPt.y, tPt.y);
  const labelX = manualElbow ? elbowX : pathLabelOk ? pathLabelX : (sPt.x + tPt.x) / 2;
  const labelY = manualElbow ? elbowY : pathLabelOk ? pathLabelY : (sPt.y + tPt.y) / 2;
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
  const sData = sNode?.data as { sourceKey?: string; component?: { icon?: string } } | undefined;
  const isSource = !!sData?.sourceKey || source.startsWith("src-");
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
  // Arrowheads. "auto" (the default / empty) → a static arrow for RELATIONSHIP
  // edges: any edge touching the user persona or Genie One. Explicit
  // none/end/start/both override. The auto DIRECTION is meaningful and ignores
  // which end is source/target:
  //   • user      → the arrow points INTO Genie One   (the user enters there).
  //   • Genie One → the arrow points AWAY from Genie One, to the resource
  //                 (dashboard / Genie Room / app).
  // We pick "end" (arrow at target) vs "start" (arrow at source) accordingly.
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
  } else {
    arrow = "none";
  }
  const isArrow = arrow !== "none";
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
  const baseStyle = !flowing
    ? { ...style, stroke: "var(--muted-foreground)", opacity: 0.55 }
    : beamish
      ? { ...style, stroke: "transparent" as const, opacity: 1 }
      : flowStyle === "model"
        ? { ...style, stroke: MODEL_ORANGE, strokeWidth: 1.5, strokeDasharray: "5 4", opacity: 0.7 }
        : flowStyle === "docs"
          ? { ...style, stroke: "var(--muted-foreground)", strokeWidth: 1, opacity: 0.3 }
          : { ...style, stroke: "var(--muted-foreground)", opacity: 0.55 };
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
  const arrowEnd = arrow === "end" || arrow === "both";
  const arrowStart = arrow === "start" || arrow === "both";
  const mid = `arrowhead-${id}`;
  const markerEndUrl = arrowEnd ? `url(#${mid})` : undefined;
  const markerStartUrl = arrowStart ? `url(#${mid})` : undefined;
  // The model edge's arrowhead matches its orange line; everything else keeps the
  // neutral grey marker.
  const arrowFill = flowStyle === "model" ? "#FF5F46" : "var(--muted-foreground)";

  return (
    <>
      {isArrow && (
        <defs>
          <marker id={mid} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={arrowFill} opacity="0.7" />
          </marker>
        </defs>
      )}
      {/* interactionWidth kept modest: a fat stripe blankets the source/target
          anchors and steals the pointer, so you can't start a NEW link (fork)
          from an already-connected anchor. 10px still clicks the line easily. */}
      <BaseEdge path={path} style={finalBaseStyle} interactionWidth={connecting ? 0 : 10} />
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
            setLabelDraft(typeof label === "string" ? label : "");
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
        <g style={{ pointerEvents: "none" }}>
          <EdgeFlow key={id} style={flowStyle} path={path} />
        </g>
      )}

      {/* Arrowhead overlay — its OWN transparent path so the arrow sits on top of
          ANY line style (incl. a beamish laser/particles base that's transparent
          or an animated flow). Drawn AFTER the flow so it's never occluded; the
          stroke is transparent so it adds no visible line, only the marker. */}
      {isArrow && (
        <path d={path} fill="none" stroke="transparent" markerEnd={markerEndUrl} markerStart={markerStartUrl} style={{ pointerEvents: "none" }} />
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
              width: "100%", textAlign: "center", fontSize: 9.5, fontWeight: 500,
              padding: "1px 4px", borderRadius: 4, border: "1px solid var(--primary)",
              background: "var(--background)", color: "var(--foreground)", outline: "none",
            }}
          />
        </foreignObject>
      ) : (
        typeof label === "string" && label && (
          <g transform={`translate(${labelX} ${labelY})`}
             style={{ pointerEvents: ops?.editMode ? "all" : "none", cursor: ops?.editMode ? "pointer" : "default" }}
             onDoubleClick={ops?.editMode ? (e) => { e.stopPropagation(); setLabelDraft(label); } : undefined}>
            <rect x={-label.length * 3.2 - 5} y={-8} width={label.length * 6.4 + 10} height={16} rx={4}
              fill="var(--background)" stroke="var(--border)" strokeWidth={1} opacity={0.95} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={9.5}
              fill="var(--foreground)" style={{ fontWeight: 500 }}>{label}</text>
          </g>
        )
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
