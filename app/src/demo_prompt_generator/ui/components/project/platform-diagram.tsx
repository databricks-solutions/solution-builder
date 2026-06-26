/**
 * PlatformDiagram — the architecture tab's interactive canvas.
 * ============================================================
 *
 * A Lucidchart-style editor for the demo's Databricks architecture, built on
 * ReactFlow (@xyflow/react):
 *
 *   • Brand-icon component nodes, draggable; positions persist to architecture.md.
 *   • A component LIBRARY palette (left) — drag a component onto the canvas to
 *     add it, delete a node to remove it.
 *   • Editable, animated edges — connect nodes by dragging from their dots,
 *     toggle the "data flowing" red-dot animation, reposition, persist.
 *   • Click a node → a detail panel with its description + live deep-link.
 *   • Special nodes: source tiles (vendor logos), a vertical "Lakeflow Connect"
 *     rail, and an SDP node that shows bronze/silver/gold as little tables.
 *
 * Persistence: on any layout change we debounce-save the whole architecture.md
 * (semantic bands preserved, `layout` block rewritten) via saveProjectFile.
 *
 * Schema/layout resolution lives in `lib/platform-architecture`; this file is
 * the canvas + interactions.
 */

import {
  memo,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  useInternalNode,
  useStore,
  BaseEdge,
  getSmoothStepPath,
  getStraightPath,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DATABRICKS_ICONS, BRAND_ICONS } from "../databricks-icons";
import {
  buildSchema,
  parseOverride,
  resolveDeepLink,
  serializeArchitecture,
  baseId,
  BAND_COLOR,
  BAND_META,
  type PlatformComponent,
  type PlatformSchema,
  type PlatformEdge,
  type NodePosition,
  type BandId,
} from "@/lib/platform-architecture";
import {
  type NodeData,
  RotatableCard,
  DropTargetContext,
  baseSize,
  nodeFootprint,
  nodeTypeFor,
} from "./platform-diagram/shared";
import { GenieCodeBlock } from "./platform-diagram/composite-genie-code";
import {
  type Side,
  type Rect,
  type EdgeOps,
  EdgeOpsContext,
  POS_OF,
  sidePoint,
  nearestSide,
  spreadFrac,
  endSide,
  rectOf,
} from "./platform-diagram/edge-routing";
import {
  LakeflowBlock,
  MedallionRow,
  LF_PORTS,
  PORT_FRAC,
  portAnchor,
} from "./platform-diagram/composite-lakeflow";
import {
  AnnotationNode,
  AnyIcon,
  IconPicker,
  ANNOTATION_DEFAULT_SIZE,
  imageFileToDownscaledDataUrl,
  type AnnotationNodeData,
} from "./platform-diagram/annotations";
import { FILE_ICONS, type FileIcon } from "../file-icons";
import {
  type AnnotationData,
  type AnnotationVariant,
} from "@/lib/platform-architecture";
import { saveProjectFile, type DeployedResourceLink } from "@/lib/custom-api";
import { Button } from "@/components/ui/button";
import {
  X,
  ExternalLink,
  Zap,
  Trash2,
  Check,
  Loader2,
  GripVertical,
  Eye,
  Pencil,
  RotateCw,
  Minus,
  Spline,
  MoveRight,
  CornerDownRight,
  Undo2,
  Redo2,
  Scaling,
  Replace,
  Type,
  Square,
  Shapes,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Search,
  BringToFront,
  SendToBack,
} from "lucide-react";

/** A per-node style patch from the right-click menu (applied to 1 or many). */
type StylePatch = {
  opacity?: number;
  fillColor?: string;
  fontColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderColor?: string;
};

/** The standard product/source node — brand icon tile + label. */
const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const { component: c, bandColor } = d;
  const Icon = DATABRICKS_ICONS[c.icon] || DATABRICKS_ICONS.data;
  const isBrand = BRAND_ICONS.has(c.icon);
  const live = !!d.deepLink;
  const muted = c.state === "mentioned";
  // Lit up when a dragged edge endpoint is hovering this tile (magnet).
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;

  // SDP renders bronze/silver/gold as little tables inside the node.
  const isSdp = c.id === "sdp";
  const nat = baseSize(c);

  // Inline label editing (double-click). `editing` holds the draft text.
  const [editing, setEditing] = useState<string | null>(null);
  const commitRename = () => {
    if (editing !== null) {
      const v = editing.trim();
      if (v && v !== c.label) d.onRename(d.nodeId, v);
      setEditing(null);
    }
  };

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={d.editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => {
        e.preventDefault();
        d.onContext(d.nodeId, e.clientX, e.clientY);
      }}
    >
    <div
      onClick={() => d.onSelect(d.nodeId)}
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-xl transition-shadow ${
        d.fillColor ? "" : "bg-card"
      } ${selected ? "ring-2 ring-primary/60 shadow-md" : "shadow-sm hover:shadow-md"}`}
      style={{
        // Border defaults to a 1px band-tinted line; overridable per node.
        borderStyle: (d.borderWidth ?? 1) > 0 ? (d.borderStyle ?? "solid") : "none",
        borderWidth: d.borderWidth ?? 1,
        borderColor: d.borderColor ?? (muted ? "transparent" : `${bandColor}66`),
        opacity: d.opacity ?? (muted ? 0.6 : 1),
        ...(d.fillColor ? { background: d.fillColor } : {}),
        ...(d.fontColor ? { color: d.fontColor } : {}),
      }}
    >
      <div
        className="flex flex-1 items-center gap-2.5 px-3 py-2.5"
        style={{ transform: "scale(var(--cs, 1))", transformOrigin: "left center" }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-background"
          style={{ boxShadow: `inset 0 0 0 1px ${bandColor}22` }}
        >
          <Icon className="h-5 w-5" style={isBrand ? undefined : { color: bandColor }} />
        </span>
        <span className="min-w-0">
          <span className={`flex items-center gap-1.5 text-[13px] font-semibold leading-tight ${d.fontColor ? "" : "text-foreground"}`} style={d.fontColor ? { color: d.fontColor } : undefined}>
            {editing !== null ? (
              <input
                autoFocus
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="w-full min-w-0 rounded border border-primary/50 bg-background px-1 text-[13px] font-semibold text-foreground outline-none"
              />
            ) : (
              <span
                className="truncate"
                title="Double-click to rename"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(c.label); }}
              >
                {c.label}
              </span>
            )}
            {c.badge && editing === null && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
                style={{ background: "#EF5B3F", lineHeight: 1 }}
                title={`${c.label} — ${c.badge}`}
              >
                {c.badge === "RT" && (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" /></svg>
                )}
                {c.badge}
              </span>
            )}
            {live && editing === null && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
              />
            )}
          </span>
          {c.sublabel && (
            <span className="mt-0.5 block truncate text-[9.5px] font-normal leading-tight text-muted-foreground">{c.sublabel}</span>
          )}
        </span>
      </div>

      {/* SDP medallion databases */}
      {isSdp && (
        <div className="border-t border-border/60 px-3 py-2" style={{ minHeight: 44 }}>
          <MedallionRow />
        </div>
      )}
    </div>
    </RotatableCard>
  );
});

const nodeTypes = { component: ComponentNode, composite: LakeflowBlock, genieCode: GenieCodeBlock, annotation: AnnotationNode };

// ---------------------------------------------------------------------------
// Animated "data flowing" edge — red dot travels the path (template style)
// ---------------------------------------------------------------------------

const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const { id, source, target, sourceHandleId, targetHandleId, markerEnd, style, data, selected } = props;
  const sNode = useInternalNode(source);
  const tNode = useInternalNode(target);
  const ops = useContext(EdgeOpsContext);
  const d = data as { animated?: boolean; shape?: "smooth" | "straight" | "step" } | undefined;

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
  // Staggered vertical mid-segment so edges converging on one anchor don't
  // overlap (see fan.centerX). Skip it while dragging an endpoint (the path
  // should track the cursor with the default midpoint).
  const centerX = drag ? undefined : fan.centerX;
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
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />
      {d?.animated && !drag && (
        <circle r="3.5" fill="var(--primary)" style={{ filter: "drop-shadow(0 0 4px var(--primary))" }}>
          <animateMotion dur="2s" repeatCount="indefinite" path={path} />
        </circle>
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

const edgeTypes = { flow: FlowEdge };

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

const DetailPanel = memo(function DetailPanel({
  component,
  bandLabel,
  bandColor,
  deepLink,
  onClose,
}: {
  component: PlatformComponent;
  bandLabel: string;
  bandColor: string;
  deepLink: string | null;
  onClose: () => void;
}) {
  const Icon = DATABRICKS_ICONS[component.icon] || DATABRICKS_ICONS.data;
  const isBrand = BRAND_ICONS.has(component.icon);
  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-background"
            style={{ boxShadow: `inset 0 0 0 1px ${bandColor}33` }}
          >
            <Icon className="h-6 w-6" style={isBrand ? undefined : { color: bandColor }} />
          </span>
          <div>
            <div className="text-[15px] font-bold leading-tight text-foreground">{component.label}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: bandColor }}>
              {bandLabel}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[13.5px] leading-relaxed text-foreground/90">{component.desc}</p>
        {deepLink && (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in workspace
          </a>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Component library palette — drag a component onto the canvas to add it
// ---------------------------------------------------------------------------

const LibraryPalette = memo(function LibraryPalette({
  schema,
  placedIds,
  onAdd,
  picking = false,
  onPick,
  onCancelPick,
  onAddAnnotation,
  onAddLogo,
}: {
  schema: PlatformSchema;
  placedIds: Set<string>;
  onAdd: (componentId: string) => void;
  onAddAnnotation: (variant: AnnotationVariant) => void;
  /** Add a logo annotation pre-set to a file-icon key (cloud / vendor mark). */
  onAddLogo: (iconKey: string) => void;
  /** When set, the palette is in "select a replacement type" mode: clicking a
   *  component calls onPick instead of dragging/adding. */
  picking?: boolean;
  onPick?: (componentId: string) => void;
  onCancelPick?: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matchText = (s: string) => !ql || s.toLowerCase().includes(ql);
  return (
    <div className={`relative flex w-52 shrink-0 flex-col border-r border-border bg-muted/20 ${picking ? "z-50 ring-2 ring-primary" : ""}`}>
      {picking ? (
        <div className="flex items-center justify-between gap-1 border-b border-border bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
          <span>Pick the new type →</span>
          <button type="button" onClick={onCancelPick} className="rounded p-0.5 hover:bg-white/20" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Components
        </div>
      )}
      {!picking && (
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              name="component-search"
              aria-label="Search components"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search components…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-[12px] outline-none focus:border-primary"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Free-form annotations (not Databricks catalog components). */}
        {!picking && !ql && (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Annotations</div>
            {([
              { v: "text" as const, icon: <Type className="h-4 w-4" />, label: "Text" },
              { v: "box" as const, icon: <Square className="h-4 w-4" />, label: "Box" },
              { v: "logo" as const, icon: <Shapes className="h-4 w-4" />, label: "Logo" },
              { v: "image" as const, icon: <ImageIcon className="h-4 w-4" />, label: "Image" },
            ]).map((it) => (
              <button
                key={it.v}
                type="button"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/x-annotation", it.v); e.dataTransfer.effectAllowed = "copy"; }}
                onDoubleClick={() => onAddAnnotation(it.v)}
                title={`Drag onto the canvas (or double-click to add): ${it.label}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
              >
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span className="grid h-4 w-4 place-items-center text-muted-foreground">{it.icon}</span>
                <span className="truncate">{it.label}</span>
              </button>
            ))}
          </div>
        )}
        {schema.bands.map((band) => {
          // Always list the FULL catalog (don't hide placed ones — it's
          // confusing). Placed components are just dimmed + marked "on canvas".
          // The search box filters by label.
          const items = band.components.filter((c) => matchText(c.label));
          if (items.length === 0) return null;
          return (
            <div key={band.id} className="mb-3">
              <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: BAND_COLOR[band.id] }}>
                {band.label}
              </div>
              {items.map((c) => {
                const Icon = DATABRICKS_ICONS[c.icon] || DATABRICKS_ICONS.data;
                const isBrand = BRAND_ICONS.has(c.icon);
                const onCanvas = placedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    draggable={!picking}
                    onDragStart={picking ? undefined : (e) => {
                      e.dataTransfer.setData("application/x-component-id", c.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={picking ? () => onPick?.(c.id) : undefined}
                    onDoubleClick={picking ? undefined : () => onAdd(c.id)}
                    title={picking ? `Change to: ${c.label}` : onCanvas ? `${c.label} — already on the canvas (drag to add another)` : `Drag onto the canvas (or double-click to add): ${c.label}`}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted ${!picking && onCanvas ? "opacity-60" : ""}`}
                  >
                    {!picking && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <Icon className="h-4 w-4 shrink-0" style={isBrand ? undefined : { color: BAND_COLOR[band.id] }} />
                    <span className="truncate text-foreground">{c.label}</span>
                    {!picking && onCanvas && <Check className="ml-auto h-3 w-3 shrink-0 text-primary/60" />}
                  </button>
                );
              })}
            </div>
          );
        })}

        {/* Cloud — AWS / GCP / Azure logos (file icons). Each adds a logo
            annotation pre-set to that mark. Grouped by provider. */}
        {!picking && (() => {
          const cloud = FILE_ICONS.filter((f) => f.group === "cloud" && matchText(`${f.category} ${f.name}`));
          if (cloud.length === 0) return null;
          const byProvider = new Map<string, FileIcon[]>();
          for (const f of cloud) {
            const provider = f.category.split("/")[0] || "other";
            const arr = byProvider.get(provider) ?? [];
            arr.push(f);
            byProvider.set(provider, arr);
          }
          return (
            <div className="mb-3">
              <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cloud</div>
              {[...byProvider.entries()].map(([provider, icons]) => (
                <div key={provider} className="mb-1">
                  <div className="px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">{provider}</div>
                  {icons.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/x-logo", f.key); e.dataTransfer.effectAllowed = "copy"; }}
                      onDoubleClick={() => onAddLogo(f.key)}
                      title={`Add logo: ${f.name}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
                    >
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <AnyIcon iconKey={f.key} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Build initial ReactFlow nodes/edges from the resolved schema
// ---------------------------------------------------------------------------

function componentLookup(schema: PlatformSchema) {
  const m = new Map<string, { component: PlatformComponent; bandId: BandId }>();
  schema.bands.forEach((b) => b.components.forEach((c) => m.set(c.id, { component: c, bandId: b.id })));
  return m;
}

function schemaToFlow(
  schema: PlatformSchema,
  deepLinks: Record<string, string | null>,
  selectedId: string | null,
  onSelect: (id: string) => void,
  editMode: boolean,
  onContext: (id: string, x: number, y: number) => void,
  onResize: (id: string, w: number, h: number) => void,
  onRename: (id: string, label: string) => void,
  onAnnotate: (id: string, patch: Partial<AnnotationData>) => void,
): { nodes: Node[]; edges: Edge[] } {
  const lookup = componentLookup(schema);
  const hidden = new Set(schema.layout.hidden);

  const nodes: Node[] = [];
  for (const [id, pos] of Object.entries(schema.layout.nodes)) {
    // Free-form annotation node (text/box/logo/image) — no catalog component;
    // build it straight from the saved annotation props.
    if (pos.annotation) {
      const sz = ANNOTATION_DEFAULT_SIZE[pos.annotation.variant];
      const fp = nodeFootprint({ id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent, { w: pos.w ?? sz.w, h: pos.h ?? sz.h, rot: pos.rot });
      nodes.push({
        id,
        type: "annotation",
        position: { x: pos.x, y: pos.y },
        draggable: editMode,
        width: fp.w,
        height: fp.h,
        zIndex: pos.z ?? 0,
        style: { width: fp.w, height: fp.h },
        data: {
          nodeId: id,
          annotation: pos.annotation,
          component: { id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent,
          bandId: "sources" as BandId,
          bandColor: "#64748b",
          deepLink: null,
          onSelect, onContext, onResize, onRename, onAnnotate,
          selected: id === selectedId,
          editMode,
          rot: pos.rot ?? 0,
          w: pos.w, h: pos.h, scale: pos.scale,
          opacity: pos.opacity, fillColor: pos.fillColor, fontColor: pos.fontColor,
          borderWidth: pos.borderWidth, borderStyle: pos.borderStyle, borderColor: pos.borderColor,
        } satisfies AnnotationNodeData,
      });
      continue;
    }
    // Node id may be an instance id (`genie#2`); resolve the catalog component
    // by its base id, but keep the instance id as the ReactFlow node id.
    const found = lookup.get(baseId(id));
    if (!found || hidden.has(id)) continue;
    const { bandId } = found;
    // Apply canvas-edited overrides (double-click rename / change-type) saved in
    // the layout: label + icon win over the catalog component for this node.
    const component =
      pos.label !== undefined || pos.icon !== undefined
        ? { ...found.component, ...(pos.label !== undefined ? { label: pos.label } : {}), ...(pos.icon !== undefined ? { icon: pos.icon } : {}) }
        : found.component;
    const fp = nodeFootprint(component, pos);
    nodes.push({
      id,
      type: nodeTypeFor(component),
      position: { x: pos.x, y: pos.y },
      draggable: editMode,
      // ReactFlow OWNS the node size — NodeResizer drives these, and the shell
      // fills 100%, so the selection frame + resizer + visual never drift.
      width: fp.w,
      height: fp.h,
      zIndex: pos.z ?? 0,
      style: { width: fp.w, height: fp.h },
      data: {
        nodeId: id,
        component,
        bandId,
        bandColor: BAND_COLOR[bandId],
        deepLink: deepLinks[baseId(id)] ?? null,
        onSelect,
        onContext,
        onResize,
        onRename,
        selected: id === selectedId,
        editMode,
        rot: pos.rot ?? 0,
        w: pos.w,
        h: pos.h,
        scale: pos.scale,
        opacity: pos.opacity,
        fillColor: pos.fillColor,
        fontColor: pos.fontColor,
        borderWidth: pos.borderWidth,
        borderStyle: pos.borderStyle,
        borderColor: pos.borderColor,
      } satisfies NodeData,
    });
  }

  const edges: Edge[] = schema.layout.edges
    .filter((e) => schema.layout.nodes[e.source] && schema.layout.nodes[e.target])
    .map((e) => flowToEdge(e));

  return { nodes, edges };
}

function flowToEdge(e: PlatformEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    // Restore saved handles (composite port id or side); fall back to the
    // default L→R so older/auto-seeded edges still render.
    sourceHandle: e.sourceHandle ?? "r",
    targetHandle: e.targetHandle ?? "l",
    type: "flow",
    data: { animated: e.animated ?? false, dashed: e.dashed ?? false, shape: e.shape ?? "smooth" },
    label: e.label,
    style: {
      stroke: "var(--muted-foreground)",
      strokeWidth: 1.5,
      opacity: 0.55,
      ...(e.dashed ? { strokeDasharray: "5 4" } : {}),
    },
    markerEnd: "url(#arrow)",
  };
}

// ---------------------------------------------------------------------------
// Inner canvas (needs ReactFlow context)
// ---------------------------------------------------------------------------

interface CanvasProps {
  schema: PlatformSchema;
  deepLinks: Record<string, string | null>;
  onPersist: (layout: PlatformSchema["layout"]) => void;
}

type CtxMenu =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | null;

type MenuItemFn = (p: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) => React.ReactElement;

/** The right-click menu body for a free-form annotation node — varies by
 *  variant (text/box: font + border + alignment; logo: pick; image: set URL). */
function AnnotationMenu({
  a, Item, onAnno, onPickLogo, onSetImageUrl, onRotate, onRemove,
}: {
  a: AnnotationData;
  Item: MenuItemFn;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onSetImageUrl: () => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  const isTextual = a.variant === "text" || a.variant === "box";
  const fontSize = a.fontSize ?? 14;
  const hAlign = a.hAlign ?? "center";
  return (
    <>
      {a.variant === "logo" && <Item icon={<Shapes className="h-3.5 w-3.5" />} label="Pick logo…" onClick={onPickLogo} />}
      {a.variant === "image" && <Item icon={<ImageIcon className="h-3.5 w-3.5" />} label="Set image URL…" onClick={onSetImageUrl} />}
      {isTextual && (
        <>
          {/* Font size */}
          <div className="px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Type className="h-3.5 w-3.5" /> Font</span>
              <span>{fontSize}px</span>
            </div>
            <input type="range" min={9} max={48} step={1} value={fontSize}
              onChange={(e) => onAnno({ fontSize: Number(e.target.value) })}
              onClick={(e) => e.stopPropagation()} className="h-1.5 w-full cursor-pointer accent-primary" />
          </div>
          {/* Horizontal text alignment */}
          <div className="flex items-center gap-1 px-2 py-1.5">
            <span className="mr-auto text-[11px] text-muted-foreground">Align</span>
            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([al, Ico]) => (
              <button key={al} type="button" onClick={() => onAnno({ hAlign: al })}
                className={`grid h-6 w-6 place-items-center rounded ${hAlign === al ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                <Ico className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          {a.variant === "box" && (
            <div className="flex items-center gap-1 px-2 py-1.5">
              <span className="mr-auto text-[11px] text-muted-foreground">Position</span>
              {(["top", "middle", "bottom"] as const).map((v) => (
                <button key={v} type="button" onClick={() => onAnno({ vAlign: v })}
                  className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${(a.vAlign ?? "middle") === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                  {v[0]}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="my-1 border-t border-border/60" />
      <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} />
      <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove" onClick={onRemove} />
    </>
  );
}

/** Opacity / fill-color / font-color controls shared by single + multi-select.
 *  A color swatch with a reset (×) that clears the override (back to default). */
function StyleControls({
  style,
  onStyle,
}: {
  style?: StylePatch;
  onStyle: (patch: StylePatch) => void;
}) {
  const opacityPct = Math.round((style?.opacity ?? 1) * 100);
  const isTransparent = style?.fillColor === "transparent";
  // Default fonts to the theme's dark foreground so the picker shows it.
  const DEFAULT_FONT = "#1e293b";
  const borderW = style?.borderWidth ?? 1;
  const borderStyle = style?.borderStyle ?? "solid";
  return (
    <>
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Opacity</span><span>{opacityPct}%</span>
        </div>
        <input
          type="range" min={10} max={100} step={5} value={opacityPct}
          onChange={(e) => onStyle({ opacity: Number(e.target.value) / 100 })}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
      </div>
      {/* Fill: color swatch + a "transparent" toggle. */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="mr-auto text-[11px] text-muted-foreground">Fill</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStyle({ fillColor: "transparent" }); }}
          className={`rounded px-1.5 py-0.5 text-[10px] ${isTransparent ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          title="Transparent fill"
        >
          None
        </button>
        <input
          type="color"
          value={isTransparent || !style?.fillColor ? "#ffffff" : style.fillColor}
          onChange={(e) => onStyle({ fillColor: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent p-0"
          title="Fill color"
        />
      </div>
      {/* Text color. */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="mr-auto text-[11px] text-muted-foreground">Text color</span>
        <input
          type="color"
          value={style?.fontColor || DEFAULT_FONT}
          onChange={(e) => onStyle({ fontColor: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent p-0"
          title="Text color"
        />
      </div>
      {/* Border: width slider, solid/dashed toggle, color. */}
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Border</span><span>{borderW}px</span>
        </div>
        <input
          type="range" min={0} max={6} step={1} value={borderW}
          onChange={(e) => onStyle({ borderWidth: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStyle({ borderStyle: "solid" }); }}
            className={`flex-1 rounded px-1.5 py-0.5 text-[10px] ${borderStyle === "solid" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          >
            Solid
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStyle({ borderStyle: "dashed" }); }}
            className={`flex-1 rounded px-1.5 py-0.5 text-[10px] ${borderStyle === "dashed" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          >
            Dashed
          </button>
          <input
            type="color"
            value={style?.borderColor || "#94a3b8"}
            onChange={(e) => onStyle({ borderColor: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            title="Border color"
          />
        </div>
      </div>
    </>
  );
}

/** Floating right-click menu for a node (rotate/remove) or an edge
 *  (toggle flow, dashed, routing shape, delete). */
const ContextMenu = memo(function ContextMenu({
  menu,
  edge,
  nodeScale = 1,
  annotation,
  onClose,
  onRotate,
  onRemoveNode,
  onChangeType,
  onSetScale,
  onToggleFlow,
  onToggleDashed,
  onSetShape,
  onRemoveEdge,
  onAnno,
  onPickLogo,
  onSetImageUrl,
  style,
  selectionCount = 1,
  onStyle,
  onZ,
}: {
  menu: NonNullable<CtxMenu>;
  edge?: Edge;
  nodeScale?: number;
  /** Present when the right-clicked node is a free-form annotation. */
  annotation?: AnnotationData;
  onClose: () => void;
  onRotate: () => void;
  onRemoveNode: () => void;
  onChangeType: () => void;
  onSetScale: (s: number) => void;
  onToggleFlow: () => void;
  onToggleDashed: () => void;
  onSetShape: (s: "smooth" | "straight" | "step") => void;
  onRemoveEdge: () => void;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onSetImageUrl: () => void;
  /** Current style of the right-clicked node (for the controls' values). */
  style?: { opacity?: number; fillColor?: string; fontColor?: string };
  /** How many nodes the style controls will affect (>1 → multi-select). */
  selectionCount?: number;
  onStyle: (patch: { opacity?: number; fillColor?: string; fontColor?: string }) => void;
  onZ: (dir: "front" | "back") => void;
}) {
  const ed = edge?.data as { animated?: boolean; dashed?: boolean; shape?: string } | undefined;
  const Item = ({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-muted ${active ? "text-primary" : "text-foreground"}`}
    >
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {label}
      {active && <Check className="ml-auto h-3.5 w-3.5" />}
    </button>
  );
  const ZItems = (
    <>
      <Item icon={<BringToFront className="h-3.5 w-3.5" />} label="Bring to front" onClick={() => onZ("front")} />
      <Item icon={<SendToBack className="h-3.5 w-3.5" />} label="Send to back" onClick={() => onZ("back")} />
    </>
  );
  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 w-44 rounded-lg border border-border bg-card p-1 shadow-lg"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.kind === "node" && selectionCount > 1 ? (
          /* MULTI-SELECT: only the options common to ALL selected nodes — the
             style controls. They apply to every selected node at once; nodes a
             given option doesn't fit just ignore it. */
          <>
            <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">{selectionCount} selected</div>
            <StyleControls style={style} onStyle={onStyle} />
            <div className="my-1 border-t border-border/60" />
            {ZItems}
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove all" onClick={onRemoveNode} />
          </>
        ) : menu.kind === "node" && annotation ? (
          <>
            <AnnotationMenu a={annotation} Item={Item} onAnno={onAnno} onPickLogo={onPickLogo} onSetImageUrl={onSetImageUrl} onRotate={onRotate} onRemove={onRemoveNode} />
            <div className="my-1 border-t border-border/60" />
            <StyleControls style={style} onStyle={onStyle} />
            <div className="my-1 border-t border-border/60" />
            {ZItems}
          </>
        ) : menu.kind === "node" ? (
          <>
            <Item icon={<Replace className="h-3.5 w-3.5" />} label="Change type…" onClick={onChangeType} />
            <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} />
            {/* Content scale slider — shrink/grow the icon+label inside the box
                (the box itself is unchanged; content is cropped if too big). */}
            <div className="px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><Scaling className="h-3.5 w-3.5" /> Scale</span>
                <span>{Math.round(nodeScale * 100)}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={Math.round(nodeScale * 100)}
                onChange={(e) => onSetScale(Number(e.target.value) / 100)}
                onClick={(e) => e.stopPropagation()}
                className="h-1.5 w-full cursor-pointer accent-primary"
              />
            </div>
            <div className="my-1 border-t border-border/60" />
            <StyleControls style={style} onStyle={onStyle} />
            <div className="my-1 border-t border-border/60" />
            {ZItems}
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove" onClick={onRemoveNode} />
          </>
        ) : (
          <>
            <Item icon={<Zap className="h-3.5 w-3.5" />} label="Data flow" onClick={onToggleFlow} active={!!ed?.animated} />
            <Item icon={<Minus className="h-3.5 w-3.5" />} label="Dashed line" onClick={onToggleDashed} active={!!ed?.dashed} />
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Spline className="h-3.5 w-3.5" />} label="Smooth" onClick={() => onSetShape("smooth")} active={(ed?.shape ?? "smooth") === "smooth"} />
            <Item icon={<MoveRight className="h-3.5 w-3.5" />} label="Straight" onClick={() => onSetShape("straight")} active={ed?.shape === "straight"} />
            <Item icon={<CornerDownRight className="h-3.5 w-3.5" />} label="Step" onClick={() => onSetShape("step")} active={ed?.shape === "step"} />
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete line" onClick={onRemoveEdge} />
          </>
        )}
      </div>
    </>
  );
});

function Canvas({ schema, deepLinks, onPersist }: CanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [menu, setMenu] = useState<CtxMenu>(null);
  // Node id whose TYPE we're changing (right-click → Change type). While set,
  // the library palette is in "pick a replacement" mode + the canvas is dimmed.
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  // Annotation node id whose LOGO we're picking (opens the IconPicker modal).
  const [logoPickerFor, setLogoPickerFor] = useState<string | null>(null);
  // Ids of all currently-selected nodes (lasso / shift-click). Drives whether
  // the right-click style controls apply to one node or the whole selection.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedIds(sel.map((n) => n.id));
  }, []);
  const { screenToFlowPosition } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  const onSelect = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);

  const onContext = useCallback((id: string, x: number, y: number) => {
    setMenu({ kind: "node", id, x, y });
  }, []);

  // Stable resize handler — writes w/h into node data + schedules a save.
  // Uses refs so it can be passed into schemaToFlow before scheduleSave is
  // declared below (avoids a use-before-define ordering hazard).
  const setNodesRef = useRef<ReturnType<typeof useNodesState>[1] | null>(null);
  const scheduleSaveRef = useRef<((nds: Node[], eds: Edge[]) => void) | null>(null);
  const edgesRef = useRef<Edge[]>([]);
  // w/h here are the FOOTPRINT (on-canvas) dims from NodeResizer. Store them
  // back as CARD dims (un-swap for rotation) and keep node.width/height in sync
  // so the box, selection frame, and visual all stay the same size.
  const onResize = useCallback((id: string, w: number, h: number) => {
    setNodesRef.current?.((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        const q = (((dd.rot ?? 0) % 360) + 360) % 360;
        const swapped = q === 90 || q === 270;
        const cardW = swapped ? h : w;
        const cardH = swapped ? w : h;
        return {
          ...n,
          width: w,
          height: h,
          style: { ...n.style, width: w, height: h },
          data: { ...dd, w: Math.round(cardW), h: Math.round(cardH) },
        };
      });
      scheduleSaveRef.current?.(next, edgesRef.current);
      return next;
    });
  }, []);

  // Rename a node (double-click on its label). Overrides the component label for
  // this node; persisted in the layout (scheduleSave diffs it vs the catalog).
  // Stable + ref-based so it can be passed into schemaToFlow before scheduleSave
  // is declared below (same ordering trick as onResize).
  const onRename = useCallback((id: string, label: string) => {
    setNodesRef.current?.((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        return { ...n, data: { ...dd, component: { ...dd.component, label } } };
      });
      scheduleSaveRef.current?.(next, edgesRef.current);
      return next;
    });
  }, []);

  // Patch an annotation node's props (text/icon/src/alignment/fontSize/border).
  // Ref-based for the same use-before-define reason as onRename/onResize.
  const onAnnotate = useCallback((id: string, patch: Partial<AnnotationData>) => {
    setNodesRef.current?.((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as AnnotationNodeData;
        return { ...n, data: { ...dd, annotation: { ...dd.annotation, ...patch } } };
      });
      scheduleSaveRef.current?.(next, edgesRef.current);
      return next;
    });
  }, []);

  const initial = useMemo(
    () => schemaToFlow(schema, deepLinks, null, onSelect, true, onContext, onResize, onRename, onAnnotate),
    // Rebuild only when schema identity changes (not on every selection).
    [schema, deepLinks, onSelect, onContext, onResize, onRename, onAnnotate],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  setNodesRef.current = setNodes;
  edgesRef.current = edges;

  // Re-seed the graph when the underlying schema changes. useNodesState/
  // useEdgesState only take `initial` ONCE, so without this the canvas keeps
  // the auto-seeded graph it mounted with and never picks up architecture.md
  // once it finishes loading (the file's saved nodes/edges were being ignored).
  // Guarded so it only fires on a real schema-identity change, not on drags.
  const seededFrom = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const resetHistoryRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (seededFrom.current === initial) return;
    seededFrom.current = initial;
    setNodes(initial.nodes);
    setEdges(initial.edges);
    // Reset undo history to the freshly-loaded state as the new baseline.
    resetHistoryRef.current?.();
  }, [initial, setNodes, setEdges]);

  // Keep node.data.selected + editMode + draggability in sync without
  // rebuilding the graph (preserves live positions).
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        draggable: editMode,
        data: { ...n.data, selected: n.id === selectedId, editMode },
      })),
    );
  }, [selectedId, editMode, setNodes]);

  // Paste an image (Ctrl/Cmd+V) anywhere on the canvas → downscaled base64
  // image annotation at the canvas center. Ref-indirect because addAnnotation
  // is declared below. Ignored when typing in an input/textarea.
  const addAnnotationRef = useRef<((v: AnnotationVariant, at?: { x: number; y: number }, extra?: Partial<AnnotationData>) => void) | null>(null);
  useEffect(() => {
    if (!editMode) return;
    const onPaste = async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      const src = await imageFileToDownscaledDataUrl(file);
      // Warn (but still allow) if the encoded image is large.
      if (src.length > 1.5 * 1024 * 1024) {
        // eslint-disable-next-line no-console
        console.warn(`[platform-diagram] pasted image is large (${Math.round(src.length / 1024)}KB base64) — architecture.md will grow.`);
      }
      const rect = wrapRef.current?.getBoundingClientRect();
      const at = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 200, y: 200 };
      addAnnotationRef.current?.("image", at, { src });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editMode, screenToFlowPosition]);

  // --- Persistence: debounce-save the layout whenever nodes/edges settle ----
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginBurstRef = useRef<(() => void) | null>(null);
  const endBurstRef = useRef<((nds: Node[], eds: Edge[]) => void) | null>(null);
  const scheduleSave = useCallback((nds: Node[], eds: Edge[]) => {
    // History = ONE entry per logical action (burst). A drag/resize fires
    // scheduleSave on every pixel; we push the pre-burst baseline onto the undo
    // stack only at the START of a burst (timer not pending), and snapshot the
    // FINAL state at burst end (in the timeout below).
    if (!saveTimer.current) beginBurstRef.current?.();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      endBurstRef.current?.(nds, eds);
      const catalog = componentLookup(schema);
      const positions: Record<string, NodePosition> = {};
      nds.forEach((n) => {
        const dd = n.data as NodeData;
        const rot = dd.rot ?? 0;
        // Persist label/icon only when they DIFFER from the catalog base — i.e.
        // the user renamed the node or changed its type on the canvas.
        const base = catalog.get(baseId(n.id))?.component;
        const labelOv = base && dd.component.label !== base.label ? dd.component.label : undefined;
        const iconOv = base && dd.component.icon !== base.icon ? dd.component.icon : undefined;
        // Annotation nodes carry their full props (text/icon/src/alignment).
        const anno = (dd as Partial<AnnotationNodeData>).annotation;
        positions[n.id] = {
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
          ...(rot ? { rot } : {}),
          ...(dd.w ? { w: Math.round(dd.w) } : {}),
          ...(dd.h ? { h: Math.round(dd.h) } : {}),
          ...(dd.scale && dd.scale !== 1 ? { scale: Math.round(dd.scale * 100) / 100 } : {}),
          ...(labelOv !== undefined ? { label: labelOv } : {}),
          ...(iconOv !== undefined ? { icon: iconOv } : {}),
          ...(anno ? { annotation: anno } : {}),
          ...(dd.opacity !== undefined ? { opacity: dd.opacity } : {}),
          ...(dd.fillColor !== undefined ? { fillColor: dd.fillColor } : {}),
          ...(dd.fontColor !== undefined ? { fontColor: dd.fontColor } : {}),
          ...(dd.borderWidth !== undefined ? { borderWidth: dd.borderWidth } : {}),
          ...(dd.borderStyle !== undefined ? { borderStyle: dd.borderStyle } : {}),
          ...(dd.borderColor !== undefined ? { borderColor: dd.borderColor } : {}),
          ...(typeof n.zIndex === "number" && n.zIndex !== 0 ? { z: n.zIndex } : {}),
        };
      });
      // `hidden` is keyed by catalog (base) ids: a component is hidden iff NO
      // instance of it is on the canvas (collapse `genie#2` → `genie`).
      const placed = new Set(nds.map((n) => baseId(n.id)));
      const hidden = [...componentLookup(schema).keys()].filter((id) => !placed.has(id));
      const layoutEdges: PlatformEdge[] = eds.map((e) => {
        const ed = e.data as { animated?: boolean; dashed?: boolean; shape?: "smooth" | "straight" | "step" } | undefined;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
          ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
          animated: ed?.animated ?? false,
          dashed: ed?.dashed ?? false,
          shape: ed?.shape ?? "smooth",
          label: typeof e.label === "string" ? e.label : undefined,
        };
      });
      persistRef.current({ nodes: positions, edges: layoutEdges, hidden });
      saveTimer.current = null; // burst ended → next change starts a new burst
    }, 700);
  }, [schema]);
  scheduleSaveRef.current = scheduleSave;

  // --- Undo / redo history --------------------------------------------------
  // A snapshot is the committed graph. We push the PREVIOUS state before each
  // committed change, so undo restores it. `applying` guards against the
  // undo/redo restore itself being recorded as a new change.
  type Snap = { nodes: Node[]; edges: Edge[] };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const applying = useRef(false);
  const lastCommitted = useRef<Snap | null>(null);
  const [histTick, setHistTick] = useState(0); // re-render to refresh button enabled state

  const cloneSnap = (nds: Node[], eds: Edge[]): Snap => ({
    nodes: nds.map((n) => ({ ...n, position: { ...n.position }, data: { ...n.data } })),
    edges: eds.map((e) => ({ ...e, data: { ...e.data } })),
  });

  // BURST START: push the pre-burst baseline onto the undo stack (once per
  // logical action). Does NOT change lastCommitted — that's set at burst end.
  beginBurstRef.current = () => {
    if (applying.current) return;
    if (lastCommitted.current) {
      past.current.push(lastCommitted.current);
      if (past.current.length > 100) past.current.shift();
      future.current = []; // a fresh edit invalidates the redo stack
      setHistTick((t) => t + 1);
    }
  };
  // BURST END: the final state becomes the new baseline (what a subsequent
  // edit will push, and what redo restores to).
  endBurstRef.current = (nds: Node[], eds: Edge[]) => {
    if (applying.current) return;
    lastCommitted.current = cloneSnap(nds, eds);
  };
  resetHistoryRef.current = () => {
    past.current = [];
    future.current = [];
    lastCommitted.current = null; // re-seeded by the baseline effect
    setHistTick((t) => t + 1);
  };

  // Seed the baseline snapshot once the graph is first populated.
  useEffect(() => {
    if (!lastCommitted.current && (nodes.length || edges.length)) {
      lastCommitted.current = cloneSnap(nodes, edges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const restore = useCallback(
    (snap: Snap) => {
      applying.current = true;
      // Re-apply editMode/selected so restored nodes match current UI mode.
      setNodes(snap.nodes.map((n) => ({ ...n, draggable: editMode, data: { ...n.data, editMode } })));
      setEdges(snap.edges);
      lastCommitted.current = cloneSnap(snap.nodes, snap.edges);
      scheduleSave(snap.nodes, snap.edges);
      setHistTick((t) => t + 1);
      // release the guard after the state settles
      setTimeout(() => { applying.current = false; }, 0);
    },
    [setNodes, setEdges, scheduleSave, editMode],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    if (lastCommitted.current) future.current.push(lastCommitted.current);
    restore(prev);
  }, [restore]);

  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    if (lastCommitted.current) past.current.push(lastCommitted.current);
    restore(nxt);
  }, [restore]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;
  void histTick; // referenced so the lint + render-on-change is intentional

  // Keyboard: Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z (or Ctrl+Y) = redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Don't hijack undo while typing in an input/textarea/contenteditable
      // (e.g. the chat panel) — only act when the canvas/page has focus.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Wrap change handlers so a drag/add/remove triggers a save + history entry.
  // CRITICAL: a drag emits a `position` change on EVERY pixel (dragging:true)
  // and one final one on drop (dragging:false). We only commit on the FINAL
  // one (or on removal) — otherwise history fills with hundreds of micro-steps
  // per drag and undo barely moves.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      const committed = changes.some(
        (c) =>
          (c.type === "position" && c.dragging === false) ||
          c.type === "remove",
      );
      if (committed) {
        setNodes((nds) => {
          scheduleSave(nds, edges);
          return nds;
        });
      }
    },
    [onNodesChange, setNodes, scheduleSave, edges],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      // No self-loops; no duplicate of an existing source→target pair.
      if (!params.source || !params.target || params.source === params.target) return;
      setEdges((eds) => {
        if (eds.some((e) => e.source === params.source && e.target === params.target)) return eds;
        // Stable, collision-free id from the (now-guaranteed-unique) endpoint
        // pair + handles — NOT eds.length, which repeats after a delete.
        const id = `e-${params.source}-${params.sourceHandle ?? ""}-${params.target}-${params.targetHandle ?? ""}`;
        const next = addEdge(
          {
            ...params,
            id,
            type: "flow",
            data: { animated: true },
            style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: 0.55 },
            markerEnd: "url(#arrow)",
          },
          eds,
        );
        scheduleSave(nodes, next);
        return next;
      });
    },
    [setEdges, scheduleSave, nodes],
  );

  // --- Re-target an edge endpoint to another node (from the custom drag).
  const retargetEdge = useCallback(
    (edgeId: string, end: "source" | "target", nodeId: string, handle?: string) => {
      setEdges((eds) => {
        const next = eds.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                [end]: nodeId,
                // Pin to the aimed handle (a composite port id like "in-zerobus"
                // or a side "l/r/t/b"); null lets the edge auto-derive the side.
                [end === "source" ? "sourceHandle" : "targetHandle"]: handle ?? null,
              }
            : e,
        );
        scheduleSave(nodes, next);
        return next;
      });
    },
    [setEdges, scheduleSave, nodes],
  );

  // Node footprint rect (flow coords) + hit-test, for the endpoint drag.
  // IMPORTANT: the canvas uses nodeOrigin=[0.5,0.5], so `node.position` is the
  // node's CENTER, not its top-left. The rect's top-left is position - size/2.
  // (Getting this wrong made only the right/bottom half of a tile hit-testable
  // — the "left half doesn't show the anchor" bug.)
  const nodeRect = useCallback(
    (nid: string): Rect | null => {
      const n = nodes.find((x) => x.id === nid);
      if (!n) return null;
      const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
      const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
      return { x: n.position.x - w / 2, y: n.position.y - h / 2, w, h };
    },
    [nodes],
  );
  const nodeAt = useCallback(
    (fx: number, fy: number): string | null => {
      let hit: string | null = null;
      for (const n of nodes) {
        const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
        const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
        const x = n.position.x - w / 2;
        const y = n.position.y - h / 2;
        if (fx >= x && fx <= x + w && fy >= y && fy <= y + h) hit = n.id;
      }
      return hit;
    },
    [nodes],
  );
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const setDropTarget = useCallback((nid: string | null) => setDropTargetId(nid), []);
  // A composite block's named input ports as absolute flow-coord anchors so the
  // reconnect drag can snap to (and target) the RIGHT one, not just "left".
  const portsOf = useCallback(
    (nid: string): { handle: string; x: number; y: number }[] => {
      const n = nodes.find((x) => x.id === nid);
      const kind = (n?.data as NodeData | undefined)?.component.kind;
      if (!n || kind !== "lakeflow") return [];
      const r = nodeRect(nid);
      if (!r) return [];
      return LF_PORTS.map((p) => ({ handle: `in-${p.port}`, x: r.x, y: r.y + r.h * p.frac }));
    },
    [nodes, nodeRect],
  );
  const edgeOps = useMemo<EdgeOps>(
    () => ({
      editMode, retarget: retargetEdge, nodeAt, rectOf: nodeRect, setDropTarget, portsOf,
      toFlow: (cx: number, cy: number) => screenToFlowPosition({ x: cx, y: cy }),
    }),
    [editMode, retargetEdge, nodeAt, nodeRect, setDropTarget, portsOf, screenToFlowPosition],
  );

  // --- Add from library (drop or double-click) ------------------------------
  const addComponent = useCallback(
    (componentId: string, at?: { x: number; y: number }) => {
      const found = componentLookup(schema).get(baseId(componentId));
      if (!found) return;
      const pos = at ?? { x: 120, y: 120 };
      setNodes((nds) => {
        // Same component can be placed more than once: if the base id is taken,
        // mint a fresh instance id (`<id>#2`, `#3`, …) so node ids stay unique.
        const base = baseId(componentId);
        let nodeId = base;
        if (nds.some((n) => n.id === nodeId)) {
          let k = 2;
          while (nds.some((n) => n.id === `${base}#${k}`)) k++;
          nodeId = `${base}#${k}`;
        }
        const fp = nodeFootprint(found.component, {});
        const next = [
          ...nds,
          {
            id: nodeId,
            type: nodeTypeFor(found.component),
            position: pos,
            width: fp.w,
            height: fp.h,
            style: { width: fp.w, height: fp.h },
            data: {
              nodeId,
              component: found.component,
              bandId: found.bandId,
              bandColor: BAND_COLOR[found.bandId],
              deepLink: deepLinks[base] ?? null,
              onSelect,
              onContext,
              onResize,
              onRename,
              selected: false,
              editMode: true,
              rot: 0,
            } satisfies NodeData,
          } as Node,
        ];
        scheduleSave(next, edges);
        return next;
      });
    },
    [schema, deepLinks, onSelect, onContext, onResize, onRename, setNodes, scheduleSave, edges],
  );

  // Add a free-form annotation node (text / box / logo / image). Returns the
  // new node id so callers can act on it (e.g. open the logo picker).
  const annoCounter = useRef(0);
  const addAnnotation = useCallback(
    (variant: AnnotationVariant, at?: { x: number; y: number }, extra?: Partial<AnnotationData>): string => {
      const pos = at ?? { x: 160, y: 160 };
      const defaults: AnnotationData =
        variant === "box" ? { variant, text: "", border: true, vAlign: "middle", hAlign: "center", fontSize: 14 }
        : variant === "text" ? { variant, text: "Text", border: false, fontSize: 14 }
        : variant === "logo" ? { variant, icon: "data" }
        : { variant }; // image — src set via menu/paste
      const annotation = { ...defaults, ...extra };
      annoCounter.current += 1;
      const id = `anno-${variant}-${Date.now().toString(36)}-${annoCounter.current}`;
      setNodes((nds) => {
        const sz = ANNOTATION_DEFAULT_SIZE[variant];
        const next = [
          ...nds,
          {
            id,
            type: "annotation",
            position: pos,
            width: sz.w,
            height: sz.h,
            style: { width: sz.w, height: sz.h },
            data: {
              nodeId: id,
              annotation,
              component: { id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent,
              bandId: "sources" as BandId,
              bandColor: "#64748b",
              deepLink: null,
              onSelect, onContext, onResize, onRename, onAnnotate,
              selected: false,
              editMode: true,
              rot: 0,
            } satisfies AnnotationNodeData,
          } as Node,
        ];
        scheduleSave(next, edges);
        return next;
      });
      return id;
    },
    [onSelect, onContext, onResize, onRename, onAnnotate, setNodes, scheduleSave, edges],
  );
  addAnnotationRef.current = addAnnotation;

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const logoKey = e.dataTransfer.getData("application/x-logo");
      if (logoKey) { addAnnotation("logo", pos, { icon: logoKey }); return; }
      const anno = e.dataTransfer.getData("application/x-annotation");
      if (anno) {
        const id = addAnnotation(anno as AnnotationVariant, pos);
        if (anno === "logo") setLogoPickerFor(id); // pick the logo right away
        return;
      }
      const id = e.dataTransfer.getData("application/x-component-id");
      if (!id) return;
      addComponent(id, pos);
    },
    [addComponent, addAnnotation, screenToFlowPosition],
  );

  // Rotate a node by +90° (wraps 0→90→180→270→0). From the right-click menu.
  // Also swaps the node footprint so the box + handles follow the rotation.
  const rotateNode = useCallback((id: string) => {
    setNodes((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        const rot = (((dd.rot ?? 0) + 90) % 360) as number;
        const fp = nodeFootprint(dd.component, { w: dd.w, h: dd.h, rot });
        return { ...n, width: fp.w, height: fp.h, style: { ...n.style, width: fp.w, height: fp.h }, data: { ...dd, rot } };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Apply a STYLE patch (opacity / fillColor / fontColor) to one or many nodes.
  // Used by the right-click menu — operates on the whole selection so lasso-
  // selecting several boxes and changing a color updates all of them at once.
  // Options that don't apply to a given node type are simply stored and ignored
  // by that node's renderer (no-op), per the requested behavior.
  const styleNodes = useCallback((ids: string[], patch: StylePatch) => {
    const idset = new Set(ids);
    setNodes((nds) => {
      const next = nds.map((n) => (idset.has(n.id) ? { ...n, data: { ...n.data, ...patch } } : n));
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Bring a node to front / send to back by setting its zIndex just past the
  // current extreme. Works for a single node or a whole selection.
  const setNodeZ = useCallback((ids: string[], dir: "front" | "back") => {
    const idset = new Set(ids);
    setNodes((nds) => {
      const zs = nds.map((n) => (typeof n.zIndex === "number" ? n.zIndex : 0));
      const target = dir === "front" ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      const next = nds.map((n) => (idset.has(n.id) ? { ...n, zIndex: target } : n));
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Set a node's manual content scale (from the right-click slider).
  const setNodeScale = useCallback((id: string, scale: number) => {
    setNodes((nds) => {
      const next = nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, scale } } : n));
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Change a node's TYPE: replace it with a node of the chosen catalog
  // component at the SAME position/size, and rewire its edges to the new id.
  // (Type is an identity change, so the node id must follow the new component —
  // a stale id would desync the active/hidden bookkeeping on reload.) A custom
  // label (from a rename) is carried over; otherwise the new component's label.
  const changeNodeType = useCallback((id: string, newComponentId: string) => {
    const found = componentLookup(schema).get(baseId(newComponentId));
    if (!found) return;
    setNodes((nds) => {
      if (!nds.some((n) => n.id === id)) return nds;
      const dd = nds.find((n) => n.id === id)!.data as NodeData;
      const oldBase = componentLookup(schema).get(baseId(id))?.component;
      const renamed = oldBase && dd.component.label !== oldBase.label;
      // Mint a unique node id for the new type (dedupe like addComponent).
      const wanted = found.component.id;
      let newId = wanted;
      if (nds.some((n) => n.id === newId && n.id !== id)) {
        let k = 2;
        while (nds.some((n) => n.id === `${wanted}#${k}`)) k++;
        newId = `${wanted}#${k}`;
      }
      const component = renamed ? { ...found.component, label: dd.component.label } : found.component;
      const fp = nodeFootprint(component, { w: dd.w, h: dd.h, rot: dd.rot });
      const next = nds.map((n) =>
        n.id !== id
          ? n
          : {
              ...n,
              id: newId,
              type: nodeTypeFor(component),
              width: fp.w,
              height: fp.h,
              style: { ...n.style, width: fp.w, height: fp.h },
              data: { ...dd, nodeId: newId, component, bandId: found.bandId, bandColor: BAND_COLOR[found.bandId], deepLink: deepLinks[baseId(newComponentId)] ?? null },
            },
      );
      // Rewire edges from the old id → new id (handles preserved), then drop
      // any that now duplicate an existing source→target pair (the rewire can
      // collide with a pre-existing edge to/from the new id).
      setEdges((eds) => {
        const seen = new Set<string>();
        const e2 = eds
          .map((e) => ({
            ...e,
            ...(e.source === id ? { source: newId } : {}),
            ...(e.target === id ? { target: newId } : {}),
          }))
          .filter((e) => {
            if (e.source === e.target) return false; // self-loop from the swap
            const k = `${e.source}->${e.target}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        scheduleSave(next, e2);
        return e2;
      });
      return next;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [schema, deepLinks, setNodes, setEdges, scheduleSave]);

  const removeNode = useCallback((id: string) => {
    setNodes((nds) => {
      const next = nds.filter((n) => n.id !== id);
      setEdges((eds) => {
        const e2 = eds.filter((e) => e.source !== id && e.target !== id);
        scheduleSave(next, e2);
        return e2;
      });
      return next;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [setNodes, setEdges, scheduleSave]);

  // --- Edge mutations (from the edge right-click menu) ----------------------
  const mutateEdge = useCallback(
    (id: string, fn: (e: Edge) => Edge) => {
      setEdges((eds) => {
        const next = eds.map((e) => (e.id === id ? fn(e) : e));
        scheduleSave(nodes, next);
        return next;
      });
    },
    [setEdges, scheduleSave, nodes],
  );

  const toggleEdgeFlow = useCallback(
    (id: string) =>
      mutateEdge(id, (e) => ({
        ...e,
        data: { ...e.data, animated: !(e.data as { animated?: boolean } | undefined)?.animated },
      })),
    [mutateEdge],
  );

  const toggleEdgeDashed = useCallback(
    (id: string) =>
      mutateEdge(id, (e) => {
        const dashed = !(e.style as { strokeDasharray?: string } | undefined)?.strokeDasharray;
        return {
          ...e,
          data: { ...e.data, dashed },
          style: { ...(e.style ?? {}), strokeDasharray: dashed ? "5 4" : undefined },
        };
      }),
    [mutateEdge],
  );

  const setEdgeShape = useCallback(
    (id: string, shape: "smooth" | "straight" | "step") =>
      mutateEdge(id, (e) => ({ ...e, data: { ...e.data, shape } })),
    [mutateEdge],
  );

  const removeEdge = useCallback(
    (id: string) =>
      setEdges((eds) => {
        const next = eds.filter((e) => e.id !== id);
        scheduleSave(nodes, next);
        return next;
      }),
    [setEdges, scheduleSave, nodes],
  );

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setMenu({ kind: "edge", id: edge.id, x: e.clientX, y: e.clientY });
  }, []);

  const selected = selectedId ? componentLookup(schema).get(baseId(selectedId)) : null;
  // Base ids of every placed instance — the library dims a catalog item when at
  // least one instance is on the canvas (but it stays draggable for duplicates).
  const placedIds = useMemo(() => new Set(nodes.map((n) => baseId(n.id))), [nodes]);
  const menuEdge = menu?.kind === "edge" ? edges.find((e) => e.id === menu.id) : undefined;
  // The right-clicked node's annotation props, if it's a free-form annotation.
  const menuAnno = menu?.kind === "node"
    ? (nodes.find((n) => n.id === menu.id)?.data as Partial<AnnotationNodeData> | undefined)?.annotation
    : undefined;
  // Style controls operate on the whole selection IF the right-clicked node is
  // part of a 2+ selection; otherwise just that node.
  const styleTargets =
    menu?.kind === "node" && selectedIds.length > 1 && selectedIds.includes(menu.id)
      ? selectedIds
      : menu?.kind === "node"
        ? [menu.id]
        : [];
  const menuNodeData = menu?.kind === "node" ? (nodes.find((n) => n.id === menu.id)?.data as NodeData | undefined) : undefined;

  return (
    <EdgeOpsContext.Provider value={edgeOps}>
    <DropTargetContext.Provider value={dropTargetId}>
    <div className="flex min-h-0 flex-1" ref={wrapRef}>
      {editMode && (
        <LibraryPalette
          schema={schema}
          placedIds={placedIds}
          onAdd={(id) => addComponent(id)}
          onAddAnnotation={(v) => { const id = addAnnotation(v); if (v === "logo") setLogoPickerFor(id); }}
          onAddLogo={(iconKey) => addAnnotation("logo", undefined, { icon: iconKey })}
          picking={pickingFor !== null}
          onPick={(id) => { if (pickingFor) changeNodeType(pickingFor, id); setPickingFor(null); }}
          onCancelPick={() => setPickingFor(null)}
        />
      )}

      <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        {/* Dim + block the canvas while choosing a replacement type — the only
            interactive surface is the highlighted library on the left. */}
        {pickingFor !== null && (
          <div
            className="absolute inset-0 z-40 cursor-pointer bg-background/60"
            onClick={() => setPickingFor(null)}
            title="Click a component in the library, or click here to cancel"
          />
        )}
        {/* arrow marker def */}
        <svg className="pointer-events-none absolute h-0 w-0">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" opacity="0.6" />
            </marker>
          </defs>
        </svg>

        {/* floating action bar */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
          {/* View / Edit mode toggle */}
          <div className="flex items-center rounded-md bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                !editMode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Eye className="h-3.5 w-3.5" /> View
            </button>
            <button
              type="button"
              onClick={() => setEditMode(true)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                editMode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          </div>
          {editMode && (
            <>
              <div className="mx-0.5 h-5 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={!canUndo}
                onClick={undo}
                title="Undo (⌘Z)"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={!canRedo}
                onClick={redo}
                title="Redo (⇧⌘Z)"
              >
                <Redo2 className="h-3.5 w-3.5" /> Redo
              </Button>
              <div className="mx-0.5 h-5 w-px bg-border" />
              <span className="px-1.5 text-[10.5px] text-muted-foreground">Right-click a block or line</span>
            </>
          )}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={() => { setSelectedId(null); setMenu(null); }}
          onEdgeContextMenu={onEdgeContextMenu}
          onSelectionChange={onSelectionChange}
          onMoveStart={() => setMenu(null)}
          nodeOrigin={[0.5, 0.5]}
          selectionOnDrag
          panOnDrag={[1, 2]}
          selectNodesOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "flow" }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          nodesConnectable={editMode}
          nodesDraggable={editMode}
          elementsSelectable
          snapToGrid
          snapGrid={[16, 16]}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#94a3b8" className="opacity-30" />
          <Controls className="!bg-background !border-border !shadow-sm [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground" showInteractive={false} />
        </ReactFlow>

        {/* Right-click context menus (node / edge) */}
        {menu && editMode && (
          <ContextMenu
            menu={menu}
            edge={menuEdge}
            annotation={menuAnno}
            nodeScale={(nodes.find((n) => n.id === menu.id)?.data as NodeData | undefined)?.scale ?? 1}
            onClose={() => setMenu(null)}
            onRotate={() => { rotateNode(menu.id); setMenu(null); }}
            onRemoveNode={() => { (styleTargets.length > 1 ? styleTargets : [menu.id]).forEach(removeNode); setMenu(null); }}
            onChangeType={() => { setPickingFor(menu.id); setSelectedId(null); setMenu(null); }}
            onSetScale={(s) => setNodeScale(menu.id, s)}
            onToggleFlow={() => toggleEdgeFlow(menu.id)}
            onToggleDashed={() => toggleEdgeDashed(menu.id)}
            onSetShape={(s) => setEdgeShape(menu.id, s)}
            onRemoveEdge={() => { removeEdge(menu.id); setMenu(null); }}
            onAnno={(patch) => onAnnotate(menu.id, patch)}
            onPickLogo={() => { setLogoPickerFor(menu.id); setMenu(null); }}
            onSetImageUrl={() => {
              const cur = menuAnno?.src ?? "";
              const url = window.prompt("Image URL:", cur);
              if (url !== null) onAnnotate(menu.id, { src: url.trim() });
              setMenu(null);
            }}
            style={{ opacity: menuNodeData?.opacity, fillColor: menuNodeData?.fillColor, fontColor: menuNodeData?.fontColor }}
            selectionCount={styleTargets.length}
            onStyle={(patch) => styleNodes(styleTargets, patch)}
            onZ={(dir) => { setNodeZ(styleTargets.length ? styleTargets : [menu.id], dir); setMenu(null); }}
          />
        )}

        {/* Searchable logo picker for a "Logo" annotation. */}
        {logoPickerFor && (
          <IconPicker
            onPick={(key) => onAnnotate(logoPickerFor, { icon: key })}
            onClose={() => setLogoPickerFor(null)}
          />
        )}
      </div>

      {selected && (
        <DetailPanel
          component={selected.component}
          bandLabel={BAND_META[selected.bandId].label}
          bandColor={BAND_COLOR[selected.bandId]}
          deepLink={deepLinks[selected.component.id] ?? null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
    </DropTargetContext.Provider>
    </EdgeOpsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Top-level component — owns parse, deep-link resolution, save
// ---------------------------------------------------------------------------

interface PlatformDiagramProps {
  content: string | null;
  capabilities: { buildable: string[]; talking_track: string[] } | null;
  deployedResources?: DeployedResourceLink[];
  projectId: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function PlatformDiagram({ content, capabilities, deployedResources, projectId }: PlatformDiagramProps) {
  const override = useMemo(() => (content ? parseOverride(content) : null), [content]);
  const schema = useMemo(
    () => buildSchema({ override, capabilities }),
    [override, capabilities],
  );

  const deepLinks = useMemo(() => {
    const map: Record<string, string | null> = {};
    schema.bands.forEach((b) =>
      b.components.forEach((c) => (map[c.id] = resolveDeepLink(c, deployedResources))),
    );
    return map;
  }, [schema, deployedResources]);

  const [status, setStatus] = useState<SaveStatus>("idle");
  // Serialize from the live SCHEMA (always complete: bands + descriptions),
  // never from the parsed override — so a save can't strip the file.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const onPersist = useCallback(
    (layout: PlatformSchema["layout"]) => {
      setStatus("saving");
      const md = serializeArchitecture(schemaRef.current, layout);
      saveProjectFile(projectId, "architecture.md", md)
        .then(() => setStatus("saved"))
        .catch(() => setStatus("error"));
    },
    [projectId],
  );

  // Reset "saved" → "idle" after a moment so the chip doesn't linger.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <div className="text-sm font-medium text-foreground">{schema.name}</div>
        <SaveChip status={status} />
      </div>
      <ReactFlowProvider>
        <Canvas schema={schema} deepLinks={deepLinks} onPersist={onPersist} />
      </ReactFlowProvider>
    </div>
  );
}

const SaveChip = memo(function SaveChip({ status }: { status: SaveStatus }) {
  if (status === "idle") return <span className="text-[11px] text-muted-foreground">Drag to arrange · auto-saves</span>;
  if (status === "saving")
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  if (status === "saved")
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-emerald-600">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  return <span className="text-[11px] text-destructive">Save failed</span>;
});

export default memo(PlatformDiagram);
