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
  createContext,
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
  Handle,
  Position,
  NodeResizer,
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
import { DATABRICKS_ICONS, BRAND_ICONS, type DatabricksIconName } from "../databricks-icons";
import {
  buildSchema,
  parseOverride,
  resolveDeepLink,
  serializeArchitecture,
  BAND_COLOR,
  BAND_META,
  type PlatformComponent,
  type PlatformSchema,
  type PlatformEdge,
  type BandId,
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
} from "lucide-react";

// ---------------------------------------------------------------------------
// Node data + props
// ---------------------------------------------------------------------------

interface NodeData {
  component: PlatformComponent;
  bandId: BandId;
  bandColor: string;
  deepLink: string | null;
  onSelect: (id: string) => void;
  /** Right-click on a node → open its context menu (rotate, remove). */
  onContext: (id: string, clientX: number, clientY: number) => void;
  /** Resize callback (from NodeResizer) — w/h are the un-rotated card size. */
  onResize: (id: string, w: number, h: number) => void;
  selected: boolean;
  /** Edit mode shows connection handles; view mode hides them for a cleaner look. */
  editMode: boolean;
  /** Rotation in degrees (0/90/180/270). */
  rot: number;
  /** User-resized footprint (px); undefined → natural size. */
  w?: number;
  h?: number;
  /** Manual content scale (right-click slider); default 1. */
  scale?: number;
  [key: string]: unknown;
}

/** Base (un-rotated) footprint of each node type — needed so the rotatable
 *  shell can swap W/H for 90°/270° and ReactFlow's handles land on the real
 *  rotated edges (not the original box). */
function baseSize(c: PlatformComponent): { w: number; h: number } {
  if (c.kind === "lakeflow") return { w: 360, h: 176 }; // composite super-block
  if (c.id === "sdp") return { w: 230, h: 112 };
  return { w: 200, h: 56 };
}

/** On-canvas footprint of a node = its card dims (natural or resized) with W/H
 *  swapped for 90°/270° rotation. This is what ReactFlow uses as the node size
 *  so handles, the selection frame, and the resizer all match the rotated box. */
function nodeFootprint(
  c: PlatformComponent,
  pos: { w?: number; h?: number; rot?: number },
): { w: number; h: number } {
  const nat = baseSize(c);
  const w = pos.w ?? nat.w;
  const h = pos.h ?? nat.h;
  const q = (((pos.rot ?? 0) % 360) + 360) % 360;
  return q === 90 || q === 270 ? { w: h, h: w } : { w, h };
}

/** Shell that gives a node TRUE rotation + resize:
 *   - outer box = the on-canvas footprint (W/H swapped for 90/270) so handles,
 *     snap, and the resizer use the real rotated bounds;
 *   - inner card rendered at NATURAL size then uniformly SCALED to fill the
 *     resized box → text + icons scale proportionally with no per-size code;
 *   - inner card rotated about the shell center.
 *  `w`/`h` are the un-rotated card size (natural or user-resized). */
function RotatableCard({
  rot,
  w,
  h,
  scale,
  editMode,
  selected,
  forceDots = false,
  onContext,
  onResize,
  children,
}: {
  rot: number;
  w: number;
  h: number;
  scale: number;
  editMode: boolean;
  selected: boolean;
  forceDots?: boolean;
  onContext: (e: React.MouseEvent) => void;
  onResize: (w: number, h: number) => void;
  children: React.ReactNode;
}) {
  const quarter = ((rot % 360) + 360) % 360;
  // The card renders at its OWN card dims (w×h, un-rotated). Rotating it 90/270
  // makes its bounding box (h×w) — which exactly equals the node footprint
  // (see nodeFootprint, which swaps for 90/270). So the rotated card fills the
  // box. We must NOT swap here too (that double-swap was the bug where only the
  // selection box rotated, not the card).
  const cardW = w;
  const cardH = h;
  // Content scale is now MANUAL (right-click → Scale slider; default 1). The
  // card content renders at its natural size × this scale and is CROPPED by
  // the box (overflow-hidden) if it doesn't fit — no auto-fit.
  const contentScale = scale;
  // The shell FILLS the ReactFlow node box (ReactFlow + NodeResizer own the
  // node's width/height — see schemaToFlow). Filling 100% keeps the selection
  // frame, the resizer, and the visual all the same size (no drift on resize).
  // NodeResizer's min/max apply to the FOOTPRINT (the node box), which is
  // axis-swapped when rotated 90/270. If we passed the card-axis mins, a
  // rotated node whose footprint-width (= card height ≈56) is below minWidth=96
  // would get force-bumped on the first drag → the "vertical drag shrinks the
  // horizontal for no reason" bug. So swap the mins to match the footprint.
  const swapped90 = quarter === 90 || quarter === 270;
  const minW = swapped90 ? 40 : 96;
  const minH = swapped90 ? 96 : 40;
  return (
    <div className="group relative h-full w-full" onContextMenu={onContext}>
      <NodeResizer
        isVisible={editMode && selected}
        minWidth={minW}
        minHeight={minH}
        // Free width/height (no locked aspect). Snap each dimension to the 16px
        // grid so resized boxes stay aligned with everything else (magnet).
        // Resize SMOOTHLY (raw px) during the drag — snapping every tick made
        // the resizer's internal delta tracking fight the fed-back width and
        // jump. Snap to the 16px grid only once, on release.
        onResize={(_, p) => onResize(p.width, p.height)}
        onResizeEnd={(_, p) => {
          const snap = (v: number) => Math.round(v / 16) * 16;
          onResize(snap(p.width), snap(p.height));
        }}
        lineClassName="!border-primary/50"
        handleClassName="!bg-primary !border-2 !border-background !w-3.5 !h-3.5 !rounded-sm !shadow-md"
      />
      <NodeHandles show={editMode && !selected} forceDots={forceDots} />
      {/* Card sized to EXACTLY the (un-rotated) card box and rotated about the
          shell center — fills the footprint so its border == the box edges.
          `--cs` lets the card scale its content with the box. */}
      <div
        style={
          {
            position: "absolute",
            top: "50%",
            left: "50%",
            width: cardW,
            height: cardH,
            transform: `translate(-50%, -50%) rotate(${quarter}deg)`,
            transformOrigin: "center center",
            ["--cs" as string]: contentScale,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

const MEDALLION = [
  { label: "Bronze", color: "#cd7f32" },
  { label: "Silver", color: "#9ca3af" },
  { label: "Gold", color: "#d4a72c" },
] as const;

/** The four connection dots (top/right/bottom/left) every node carries so the
 *  user can link from any side. Each side is both source + target. */
function NodeHandles({ show, forceDots = false }: { show: boolean; forceDots?: boolean }) {
  // Two-part design so the DOT can float outside the box while EDGES still
  // terminate ON the box edge:
  //   • the real <Handle> stays on the node border (ReactFlow anchors edges to
  //     it → lines touch the box, no floating gap). It's a small invisible
  //     hit-area.
  //   • a separate decorative dot is pushed ~9px OUTSIDE the border (visual
  //     only). Dots fade in on node hover in edit mode (so the canvas isn't a
  //     sea of dots at rest), OR are FORCED visible when this tile is the
  //     reconnect drop target — so the user sees the anchor points to aim at.
  const vis = show
    ? "opacity-0 transition-opacity duration-150 group-hover:opacity-100"
    : "opacity-0 pointer-events-none";
  // Invisible-ish hit handle pinned to the border.
  const handle = `!w-3 !h-3 !bg-transparent !border-0 ${vis}`;
  // Decorative dot, offset outward per side. Larger + always-on when forced.
  const dotVis = forceDots ? "opacity-100" : vis;
  const dot =
    `pointer-events-none absolute z-10 rounded-full bg-background shadow-sm ${dotVis} ` +
    (forceDots ? "h-3 w-3 border-2 border-primary" : "h-2.5 w-2.5 border-2 border-primary/70");
  // All handles are type="source"; with ConnectionMode.Loose on the canvas a
  // source handle can be BOTH the start and the end of a connection — so every
  // side is grabbable to start a link AND a valid drop target. (Previously
  // r/b were source-only and l/t target-only, so you couldn't start from the
  // left/top — that was the "nothing on mouseover left" bug.)
  return (
    <>
      <Handle type="source" position={Position.Right} id="r" className={handle} isConnectable={show} />
      <Handle type="source" position={Position.Left} id="l" className={handle} isConnectable={show} />
      <Handle type="source" position={Position.Bottom} id="b" className={handle} isConnectable={show} />
      <Handle type="source" position={Position.Top} id="t" className={handle} isConnectable={show} />
      {/* decorative outward dots (don't affect edge anchoring) */}
      <span className={dot} style={{ right: -9, top: "50%", transform: "translateY(-50%)" }} />
      <span className={dot} style={{ left: -9, top: "50%", transform: "translateY(-50%)" }} />
      <span className={dot} style={{ bottom: -9, left: "50%", transform: "translateX(-50%)" }} />
      <span className={dot} style={{ top: -9, left: "50%", transform: "translateX(-50%)" }} />
    </>
  );
}

/** The standard product/source node — brand icon tile + label. */
const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const { component: c, bandColor } = d;
  const Icon = DATABRICKS_ICONS[c.icon] || DATABRICKS_ICONS.data;
  const isBrand = BRAND_ICONS.has(c.icon);
  const live = !!d.deepLink;
  const muted = c.state === "mentioned";
  // Lit up when a dragged edge endpoint is hovering this tile (magnet).
  const isDropTarget = useContext(DropTargetContext) === c.id;

  // SDP renders bronze/silver/gold as little tables inside the node.
  const isSdp = c.id === "sdp";
  const nat = baseSize(c);

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={d.editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(c.id, w, h)}
      onContext={(e) => {
        e.preventDefault();
        d.onContext(c.id, e.clientX, e.clientY);
      }}
    >
    <div
      onClick={() => d.onSelect(c.id)}
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card transition-shadow ${
        selected ? "ring-2 ring-primary/60 shadow-md" : "shadow-sm hover:shadow-md"
      }`}
      style={{
        borderColor: muted ? undefined : `${bandColor}66`,
        opacity: muted ? 0.6 : 1,
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
          <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight text-foreground">
            <span className="truncate">{c.label}</span>
            {live && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
              />
            )}
          </span>
        </span>
      </div>

      {/* SDP medallion tables */}
      {isSdp && (
        <div className="flex gap-1.5 border-t border-border/60 px-3 py-2">
          {MEDALLION.map((m) => (
            <div
              key={m.label}
              className="flex-1 overflow-hidden rounded-md border"
              style={{ borderColor: `${m.color}55` }}
            >
              <div
                className="px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-white"
                style={{ background: m.color }}
              >
                {m.label}
              </div>
              <div className="space-y-0.5 bg-background/60 p-1">
                <div className="h-1 w-full rounded-full" style={{ background: `${m.color}40` }} />
                <div className="h-1 w-3/4 rounded-full" style={{ background: `${m.color}30` }} />
                <div className="h-1 w-5/6 rounded-full" style={{ background: `${m.color}30` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </RotatableCard>
  );
});

// ---------------------------------------------------------------------------
// Composite "Lakeflow" block — Lakeflow Connect + Zerobus + direct ingest
// feeding a bronze→silver→gold pipeline, in one nicely-designed card with 3
// labelled input ports on the left and a single output on the right.
// ---------------------------------------------------------------------------

// The 3 left input ports. Lakeflow Connect + Zerobus are shown as vertical
// boxes; "direct" is an unlabelled anchor in the empty space below them.
// Anchor fractions aligned to the stacked left rails: Connect (top rail),
// Zerobus (middle rail), direct (the empty zone at the bottom). Keep in sync
// with PORT_FRAC used by the edge anchor logic.
const LF_PORTS = [
  { port: "lakeflow-connect", frac: 0.17 },
  { port: "zerobus", frac: 0.5 },
  { port: "direct", frac: 0.83 },
] as const;

/** A small vertical ingest box for the block's left column. */
/** A couple of stacked, agnostic "data file" sheets (CSV/Parquet/etc) — used
 *  for the direct-files ingest zone instead of a format-specific logo. */
function StackedFiles() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none">
      <rect x="7" y="3" width="11" height="14" rx="1.5" fill="#fff" stroke="#94a3b8" strokeWidth="1.4" />
      <rect x="4" y="6" width="11" height="14" rx="1.5" fill="#fff" stroke="#64748b" strokeWidth="1.4" />
      <path d="M7 10h5M7 13h5M7 16h3" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** An ingest "zone" flush against the block's left edge — icon on top + a
 *  single line of VERTICAL text reading downward. Tinted band fill, no rounded
 *  pill, so it reads as part of the block's left side (zones), not a tile. */
function IngestBox({ icon, iconEl, label, bandColor, first }: { icon?: DatabricksIconName; iconEl?: React.ReactNode; label: string; bandColor: string; first?: boolean }) {
  const Icon = icon ? DATABRICKS_ICONS[icon] || DATABRICKS_ICONS.data : null;
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-1 ${first ? "" : "border-t"}`}
      style={{ borderColor: `${bandColor}33`, background: `${bandColor}12` }}
    >
      {iconEl ?? (Icon ? <Icon className="h-4 w-4 shrink-0" /> : null)}
      <span
        className="text-[8px] font-bold uppercase tracking-[0.1em] text-foreground/80"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {label}
      </span>
    </div>
  );
}

/** A tiny DATABASE-TABLE glyph: colored header (the layer name) + a few
 *  "column" rows. Used for the bronze/silver/gold layers inside the block. */
function DbTable({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-[3px] border bg-card shadow-sm" style={{ borderColor: `${color}66` }}>
      <div className="px-1 py-[3px] text-center text-[7.5px] font-bold uppercase tracking-wide text-white" style={{ background: color }}>
        {label}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-[3px] px-1 py-1">
        {[0, 1, 2].map((r) => (
          <div key={r} className="flex items-center gap-1">
            <span className="h-1 w-1 shrink-0 rounded-[1px]" style={{ background: color }} />
            <span className="h-[3px] flex-1 rounded-sm" style={{ background: `${color}28` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const LakeflowBlock = memo(function LakeflowBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.component.id;
  const nat = baseSize(d.component);
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={d.editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.component.id, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.component.id, e.clientX, e.clientY); }}
    >
      {/* 3 left input ports (lakeflow-connect / zerobus / direct) + right output.
          All type="source" (loose mode) so they connect both ways. */}
      {d.editMode &&
        LF_PORTS.map((p) => (
          <Handle key={p.port} type="source" position={Position.Left} id={`in-${p.port}`} isConnectable
            className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-background" style={{ top: `${p.frac * 100}%` }} />
        ))}
      {d.editMode && (
        <Handle type="source" position={Position.Right} id="r" isConnectable className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-background" />
      )}

      <div
        onClick={() => d.onSelect(d.component.id)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow ${
          selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"
        }`}
        style={{ borderColor: `${d.bandColor}66` }}
      >
        <div className="flex h-full w-full" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* LEFT: ingest zones flush against the block edge — Connect (top),
              Zerobus (middle), empty (bottom = direct port). */}
          <div className="flex w-10 shrink-0 flex-col border-r" style={{ borderColor: `${d.bandColor}33` }}>
            <IngestBox icon="lakeflowConnectBrand" label="Connect" bandColor={d.bandColor} first />
            <IngestBox icon="zerobus" label="Zerobus" bandColor={d.bandColor} />
            {/* bottom zone = "direct" port — agnostic data files (CSV/Parquet). */}
            <IngestBox iconEl={<StackedFiles />} label="Files" bandColor={d.bandColor} />
          </div>

          {/* RIGHT: title + SDP tables + Open Format underneath them. */}
          <div className="flex flex-1 flex-col p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-[12px] font-bold text-foreground">{d.component.label}</span>
            </div>
            <div className="flex flex-1 flex-col rounded-lg border border-border/60 bg-background/60 p-2">
              <div className="mb-1.5 flex items-center gap-1.5">
                {(() => { const I = DATABRICKS_ICONS.sdpBrand; return <I className="h-4 w-4 shrink-0" />; })()}
                <span className="truncate text-[9.5px] font-bold leading-tight text-foreground">Spark Declarative Pipelines</span>
              </div>
              <div className="flex flex-1 items-stretch gap-1.5">
                {MEDALLION.map((m) => (
                  <DbTable key={m.label} label={m.label} color={m.color} />
                ))}
              </div>
              {/* Open Format — under the tables to save height. */}
              <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/60 pt-1.5">
                <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">Open Format</span>
                {(() => { const I = DATABRICKS_ICONS.deltaLakeLogo; return <I className="h-3.5 w-3.5" />; })()}
                <span className="text-[9px] font-medium text-muted-foreground">Delta</span>
                {(() => { const I = DATABRICKS_ICONS.icebergLogo; return <I className="h-3.5 w-3.5" />; })()}
                <span className="text-[9px] font-medium text-muted-foreground">Iceberg</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});

const nodeTypes = { component: ComponentNode, composite: LakeflowBlock };

// ---------------------------------------------------------------------------
// Animated "data flowing" edge — red dot travels the path (template style)
// ---------------------------------------------------------------------------

type Side = "t" | "r" | "b" | "l";
type Rect = { x: number; y: number; w: number; h: number };

/** A point on a border SIDE of a rect at `frac` (0..1) ALONG that side — 0.5 is
 *  the center. Lets multiple edges sharing a side fan out instead of stacking.
 *  Deterministic per (side, frac) → doesn't drift when the node moves. */
function sidePoint(r: Rect, side: Side, frac = 0.5): { x: number; y: number } {
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
function nearestSide(r: Rect, px: number, py: number): Side {
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
function spreadFrac(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const gap = 0.14; // spacing between adjacent lines, as a fraction of the side
  const f = 0.5 + (index - (count - 1) / 2) * gap;
  return Math.min(0.92, Math.max(0.08, f));
}

/** Pick the border side that best faces a target point (used when the edge has
 *  no explicit handle, e.g. auto-seeded edges). */
function facingSide(r: Rect, tx: number, ty: number): Side {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  // Compare normalized distances to decide horizontal vs vertical dominance.
  if (Math.abs(dx) / (r.w / 2) >= Math.abs(dy) / (r.h / 2)) return dx >= 0 ? "r" : "l";
  return dy >= 0 ? "b" : "t";
}

const POS_OF: Record<Side, Position> = {
  t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left,
};

/** Composite blocks expose named input ports on their LEFT side at fixed
 *  fractions (handle id `in-<port>`). An edge connected to such a handle
 *  anchors there directly (no fan spread). Returns null for normal handles. */
// Single source of truth for composite port fractions: handle id → left-side
// fraction. Derived from LF_PORTS so the rendered handle, the drag-snap
// (portsOf), and the committed-edge anchor (portAnchor) can never drift.
const PORT_FRAC: Record<string, number> = Object.fromEntries(
  LF_PORTS.map((p) => [`in-${p.port}`, p.frac]),
);
function portAnchor(handleId: string | null | undefined): { side: Side; frac: number } | null {
  if (handleId && handleId in PORT_FRAC) return { side: "l", frac: PORT_FRAC[handleId] };
  return null;
}

/** Edge-editing ops shared with the custom edge (which can't take arbitrary
 *  props). Drives the click-to-select → drag-endpoint → magnet-reconnect flow. */
interface EdgeOps {
  editMode: boolean;
  retarget: (edgeId: string, end: "source" | "target", nodeId: string, handle?: string) => void;
  nodeAt: (fx: number, fy: number) => string | null;
  rectOf: (nodeId: string) => Rect | null;
  setDropTarget: (nodeId: string | null) => void;
  toFlow: (clientX: number, clientY: number) => { x: number; y: number };
  /** Named input ports of a composite node, as absolute flow-coord anchors +
   *  their handle id. Empty for plain tiles. */
  portsOf: (nodeId: string) => { handle: string; x: number; y: number }[];
}
const EdgeOpsContext = createContext<EdgeOps | null>(null);
/** Node id currently under a dragged endpoint (magnet highlight). */
const DropTargetContext = createContext<string | null>(null);

const rectOf = (n: { internals: { positionAbsolute: { x: number; y: number } }; measured: { width?: number; height?: number } }): Rect => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured.width ?? 200,
  h: n.measured.height ?? 56,
});

/** Which side of a node a given edge-end attaches to (explicit handle wins,
 *  else the side facing the other node's center). Module-level so the store
 *  selector and the edge can agree. */
function endSide(
  rect: Rect,
  handleId: string | null | undefined,
  otherCenter: { x: number; y: number },
): Side {
  if (handleId && ["t", "r", "b", "l"].includes(handleId)) return handleId as Side;
  return facingSide(rect, otherCenter.x, otherCenter.y);
}

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
    return {
      sSide: sPort?.side ?? ss,
      tSide: tPort?.side ?? ts,
      sFrac: sPort ? portFan(sPort.frac, sg.i < 0 ? 0 : sg.i, sg.n) : spreadFrac(sg.i < 0 ? 0 : sg.i, sg.n),
      tFrac: tPort ? portFan(tPort.frac, tg.i < 0 ? 0 : tg.i, tg.n) : spreadFrac(tg.i < 0 ? 0 : tg.i, tg.n),
    };
  },
  // Shallow-compare so the selector doesn't trigger a re-render every store
  // tick (it returns a fresh object) — only when the computed anchors change.
  (a, b) =>
    !!a && !!b &&
    a.sSide === b.sSide && a.tSide === b.tSide &&
    a.sFrac === b.sFrac && a.tFrac === b.tFrac);

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
  const args = {
    sourceX: sPt.x, sourceY: sPt.y, targetX: tPt.x, targetY: tPt.y,
    sourcePosition: sPos, targetPosition: tPos,
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
}: {
  schema: PlatformSchema;
  placedIds: Set<string>;
  onAdd: (componentId: string) => void;
}) {
  return (
    <div className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Components
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {schema.bands.map((band) => {
          const items = band.components.filter((c) => !placedIds.has(c.id));
          if (items.length === 0) return null;
          return (
            <div key={band.id} className="mb-3">
              <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: BAND_COLOR[band.id] }}>
                {band.label}
              </div>
              {items.map((c) => {
                const Icon = DATABRICKS_ICONS[c.icon] || DATABRICKS_ICONS.data;
                const isBrand = BRAND_ICONS.has(c.icon);
                return (
                  <button
                    key={c.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-component-id", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDoubleClick={() => onAdd(c.id)}
                    title={`Drag onto the canvas (or double-click to add): ${c.label}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted"
                  >
                    <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                    <Icon className="h-4 w-4 shrink-0" style={isBrand ? undefined : { color: BAND_COLOR[band.id] }} />
                    <span className="truncate text-foreground">{c.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {schema.bands.every((b) => b.components.every((c) => placedIds.has(c.id))) && (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            All components are on the canvas.
          </div>
        )}
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
): { nodes: Node[]; edges: Edge[] } {
  const lookup = componentLookup(schema);
  const hidden = new Set(schema.layout.hidden);

  const nodes: Node[] = [];
  for (const [id, pos] of Object.entries(schema.layout.nodes)) {
    const found = lookup.get(id);
    if (!found || hidden.has(id)) continue;
    const { component, bandId } = found;
    const fp = nodeFootprint(component, pos);
    nodes.push({
      id,
      type: component.kind ? "composite" : "component",
      position: { x: pos.x, y: pos.y },
      draggable: editMode,
      // ReactFlow OWNS the node size — NodeResizer drives these, and the shell
      // fills 100%, so the selection frame + resizer + visual never drift.
      width: fp.w,
      height: fp.h,
      style: { width: fp.w, height: fp.h },
      data: {
        component,
        bandId,
        bandColor: BAND_COLOR[bandId],
        deepLink: deepLinks[id] ?? null,
        onSelect,
        onContext,
        onResize,
        selected: id === selectedId,
        editMode,
        rot: pos.rot ?? 0,
        w: pos.w,
        h: pos.h,
        scale: pos.scale,
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
    sourceHandle: "r",
    targetHandle: "l",
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

/** Floating right-click menu for a node (rotate/remove) or an edge
 *  (toggle flow, dashed, routing shape, delete). */
const ContextMenu = memo(function ContextMenu({
  menu,
  edge,
  nodeScale = 1,
  onClose,
  onRotate,
  onRemoveNode,
  onSetScale,
  onToggleFlow,
  onToggleDashed,
  onSetShape,
  onRemoveEdge,
}: {
  menu: NonNullable<CtxMenu>;
  edge?: Edge;
  nodeScale?: number;
  onClose: () => void;
  onRotate: () => void;
  onRemoveNode: () => void;
  onSetScale: (s: number) => void;
  onToggleFlow: () => void;
  onToggleDashed: () => void;
  onSetShape: (s: "smooth" | "straight" | "step") => void;
  onRemoveEdge: () => void;
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
  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 w-44 rounded-lg border border-border bg-card p-1 shadow-lg"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.kind === "node" ? (
          <>
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

  const initial = useMemo(
    () => schemaToFlow(schema, deepLinks, null, onSelect, true, onContext, onResize),
    // Rebuild only when schema identity changes (not on every selection).
    [schema, deepLinks, onSelect, onContext, onResize],
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
      const positions: Record<string, { x: number; y: number; rot?: number; w?: number; h?: number; scale?: number }> = {};
      nds.forEach((n) => {
        const dd = n.data as NodeData;
        const rot = dd.rot ?? 0;
        positions[n.id] = {
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
          ...(rot ? { rot } : {}),
          ...(dd.w ? { w: Math.round(dd.w) } : {}),
          ...(dd.h ? { h: Math.round(dd.h) } : {}),
          ...(dd.scale && dd.scale !== 1 ? { scale: Math.round(dd.scale * 100) / 100 } : {}),
        };
      });
      const placed = new Set(nds.map((n) => n.id));
      const hidden = [...componentLookup(schema).keys()].filter((id) => !placed.has(id));
      const layoutEdges: PlatformEdge[] = eds.map((e) => {
        const ed = e.data as { animated?: boolean; dashed?: boolean; shape?: "smooth" | "straight" | "step" } | undefined;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
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
        const id = `e-${params.source}-${params.target}-${eds.length}`;
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
      const found = componentLookup(schema).get(componentId);
      if (!found) return;
      const pos = at ?? { x: 120, y: 120 };
      setNodes((nds) => {
        if (nds.some((n) => n.id === componentId)) return nds;
        const fp = nodeFootprint(found.component, {});
        const next = [
          ...nds,
          {
            id: componentId,
            type: found.component.kind ? "composite" : "component",
            position: pos,
            width: fp.w,
            height: fp.h,
            style: { width: fp.w, height: fp.h },
            data: {
              component: found.component,
              bandId: found.bandId,
              bandColor: BAND_COLOR[found.bandId],
              deepLink: deepLinks[componentId] ?? null,
              onSelect,
              onContext,
              onResize,
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
    [schema, deepLinks, onSelect, onContext, onResize, setNodes, scheduleSave, edges],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("application/x-component-id");
      if (!id) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addComponent(id, pos);
    },
    [addComponent, screenToFlowPosition],
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

  // Set a node's manual content scale (from the right-click slider).
  const setNodeScale = useCallback((id: string, scale: number) => {
    setNodes((nds) => {
      const next = nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, scale } } : n));
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

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

  const selected = selectedId ? componentLookup(schema).get(selectedId) : null;
  const placedIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const menuEdge = menu?.kind === "edge" ? edges.find((e) => e.id === menu.id) : undefined;

  return (
    <EdgeOpsContext.Provider value={edgeOps}>
    <DropTargetContext.Provider value={dropTargetId}>
    <div className="flex min-h-0 flex-1" ref={wrapRef}>
      {editMode && (
        <LibraryPalette schema={schema} placedIds={placedIds} onAdd={(id) => addComponent(id)} />
      )}

      <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
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
          onMoveStart={() => setMenu(null)}
          nodeOrigin={[0.5, 0.5]}
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
            nodeScale={(nodes.find((n) => n.id === menu.id)?.data as NodeData | undefined)?.scale ?? 1}
            onClose={() => setMenu(null)}
            onRotate={() => { rotateNode(menu.id); setMenu(null); }}
            onRemoveNode={() => { removeNode(menu.id); setMenu(null); }}
            onSetScale={(s) => setNodeScale(menu.id, s)}
            onToggleFlow={() => toggleEdgeFlow(menu.id)}
            onToggleDashed={() => toggleEdgeDashed(menu.id)}
            onSetShape={(s) => setEdgeShape(menu.id, s)}
            onRemoveEdge={() => { removeEdge(menu.id); setMenu(null); }}
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
