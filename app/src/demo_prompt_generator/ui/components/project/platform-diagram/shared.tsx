/**
 * platform-diagram/shared — core node primitives shared by the vanilla
 * (`ComponentNode`) and composite (`LakeflowBlock`) nodes: the data shape, the
 * footprint math, the rotatable/resizable card shell, the connection handles,
 * and the drop-target context.
 */
import { createContext, useContext, useRef, type CSSProperties } from "react";
import { Handle, Position, NodeResizeControl, useStore } from "@xyflow/react";
import { naturalSize, type PlatformComponent, type BandId, type FlowStyle } from "@/lib/platform-architecture";

export type { FlowStyle };

// ---------------------------------------------------------------------------
// Node data + props
// ---------------------------------------------------------------------------

export interface NodeData {
  /** The ReactFlow node id — the INSTANCE id (`genie` or `genie#2`). Callbacks
   *  must use this, NOT `component.id` (the base catalog id), so duplicates of
   *  the same component resize/select/move independently. */
  nodeId: string;
  component: PlatformComponent;
  bandId: BandId;
  bandColor: string;
  deepLink: string | null;
  onSelect: (id: string) => void;
  /** Right-click on a node → open its context menu (rotate, remove). */
  onContext: (id: string, clientX: number, clientY: number) => void;
  /** Commit a new label for this node (double-click to rename). */
  onRename: (id: string, label: string) => void;
  /** Commit an edited description line (double-click the description to edit).
   *  Optional — nodes without a description toggle omit it. */
  onSetDescription?: (id: string, desc: string) => void;
  /** Resize callback (from NodeResizer) — w/h are the un-rotated card size.
   *  Optional `scale` (corner-drag) is stored so content scales with the box. */
  onResize: (id: string, w: number, h: number, scale?: number, center?: { x: number; y: number }) => void;
  /** Rotation in degrees (0/90/180/270). */
  rot: number;
  /** User-resized footprint (px); undefined → natural size. */
  w?: number;
  h?: number;
  /** Manual content scale (right-click slider); default 1. */
  scale?: number;
  /** Per-node style overrides (right-click): whole-node opacity (0..1), box
   *  fill color, text/label color, border. Undefined → use node defaults. */
  opacity?: number;
  fillColor?: string;
  fontColor?: string;
  /** Label font size (px). Sources + logo annotations only; undefined → the
   *  node's default. */
  fontSize?: number;
  /** Logo annotations: recolor the SVG icon. Undefined → the icon's own color. */
  iconColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderColor?: string;
  /** Corner radius (px) override; undefined → the card's default rounding. */
  borderRadius?: number;
  /** Drop-shadow intensity (0–100; 0 = none). Legacy boolean accepted:
   *  true/undefined → default intensity, false → none. */
  shadow?: number | boolean;
  /** Whether real third-party trademarked logos may be shown (schema-level
   *  opt-in). When false, gated vendor logos render as a text badge. */
  allowTrademark?: boolean;
  /** Group membership — a shared id on every member of a group. Selecting one
   *  member selects the whole group so they move together. */
  groupId?: string;
  /** For canvas-added sources ("+ more data sources"): the logo-catalog key,
   *  persisted so the source round-trips without a catalog entry. */
  sourceKey?: string;
  /** Source tiles only: where the label sits relative to the icon
   *  (right default | left | top | bottom). Mirrors the logo caption option. */
  sourceCaption?: "right" | "left" | "top" | "bottom";
  /** Editable description line under the title. For catalog product tiles this
   *  overrides the CATALOG default; for sources it's the only source. */
  desc?: string;
  /** Whether the description line is shown (undefined → default resolution). */
  showDesc?: boolean;
  [key: string]: unknown;
}

/** The runtime ReactFlow `edge.data` shape (mirrors the persisted
 *  `PlatformEdge` style fields). Declared once so the edge renderer, the
 *  context menu, and the save serializer all agree on the field types. */
export interface EdgeData {
  animated?: boolean;
  dashed?: boolean;
  shape?: "smooth" | "straight" | "step";
  flowStyle?: FlowStyle;
  /** Static arrowheads on the line. Undefined/"auto" → auto-decide: an arrow
   *  for relationship edges (touching the user persona or Genie One), else a
   *  normal flow line. "none" forces no arrow; "end"/"start"/"both" force one.
   *  An arrow edge is a static relationship line (no data-flow animation). */
  arrow?: "auto" | "none" | "end" | "start" | "both";
  /** Manual X of the vertical elbow segment (px, flow coords); undefined → auto. */
  centerX?: number;
}

/** A per-node style patch from the right-click menu (applied to 1 or many). */
export type StylePatch = {
  opacity?: number;
  fillColor?: string;
  fontColor?: string;
  iconColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderColor?: string;
  borderRadius?: number;
  shadow?: number | boolean;
  // Presentation fields that also travel with "copy style" (harmlessly ignored
  // by node kinds they don't apply to): source label position + size, and the
  // description-line toggle.
  sourceCaption?: "right" | "left" | "top" | "bottom";
  fontSize?: number;
  showDesc?: boolean;
};

/** Build the inline card style from a node's per-node overrides — used by the
 *  plain ComponentNode AND every composite (lakeflow/genie/governance) so the
 *  right-click style controls (border width/style/color/radius, fill, opacity,
 *  shadow) behave identically across all node kinds. `defaults` supply each
 *  value when the node hasn't overridden it. Returns the style + flags for
 *  whether a custom fill is set (drop `bg-card`) and whether the drop shadow is
 *  on (default true; the caller adds `shadow-sm` when so). */
/** Default drop-shadow intensity (0–100 slider scale) when a node hasn't set
 *  one. Matches the old `shadow-sm` look. */
export const SHADOW_DEFAULT = 35;

/** Normalize the per-node `shadow` field (legacy boolean OR a 0–100 number) to
 *  a 0–100 intensity. true/undefined → default; false → 0. */
export function shadowLevel(shadow: number | boolean | undefined): number {
  if (shadow === undefined || shadow === true) return SHADOW_DEFAULT;
  if (shadow === false) return 0;
  return Math.max(0, Math.min(100, shadow));
}

/** A CSS box-shadow string for a given 0–100 intensity (0 → none). The blur,
 *  spread and alpha all scale with the level so the slider reads continuously
 *  from "flat" to "lifted". */
export function shadowCss(level: number): string | undefined {
  if (level <= 0) return undefined;
  const t = level / 100;
  const y = Math.round(1 + t * 9);          // 1 → 10 px offset
  const blur = Math.round(2 + t * 22);      // 2 → 24 px blur
  const alpha = (0.06 + t * 0.22).toFixed(3); // 0.06 → 0.28
  return `0 ${y}px ${blur}px -${Math.round(y / 2)}px rgba(15, 23, 42, ${alpha})`;
}

export function cardStyle(
  d: NodeData,
  defaults: { borderColor: string; radius: number; opacity?: number; borderWidth?: number; shadow?: number | boolean },
): { style: CSSProperties; hasFill: boolean; shadow: boolean } {
  // Per-node override (d.*) always wins; otherwise the caller's default (e.g. a
  // composite that wants no border/shadow), otherwise the global fallback.
  const w = d.borderWidth ?? defaults.borderWidth ?? 1;
  const level = shadowLevel(d.shadow ?? defaults.shadow);
  return {
    hasFill: !!d.fillColor,
    // Kept for API compat (callers spread card.style for the shadow now); true
    // when any shadow is present so a selected ring still reads.
    shadow: level > 0,
    style: {
      borderStyle: w > 0 ? (d.borderStyle ?? "solid") : "none",
      borderWidth: w,
      borderColor: d.borderColor ?? defaults.borderColor,
      borderRadius: d.borderRadius ?? defaults.radius,
      opacity: d.opacity ?? defaults.opacity ?? 1,
      ...(shadowCss(level) ? { boxShadow: shadowCss(level) } : {}),
      ...(d.fillColor ? { background: d.fillColor } : {}),
      ...(d.fontColor ? { color: d.fontColor } : {}),
    },
  };
}

/** Node id currently under a dragged endpoint (magnet highlight). */
export const DropTargetContext = createContext<string | null>(null);

/** Canvas edit mode (handles/resizers visible). Delivered via context rather
 *  than per-node data so toggling edit mode doesn't rewrite every node's data
 *  object (which would defeat React.memo on all N nodes). */
export const EditModeContext = createContext<boolean>(true);

/** True when at most ONE node is selected. Gates the per-node resize/rotate
 *  handles: a lasso multi-select would otherwise mount 5 ReactFlow resize
 *  controls PER node (1 NodeResizer + 4 side controls) in a single frame —
 *  the dominant lasso cost. Per-node resize on a big multi-selection isn't
 *  usable anyway (one handle can't resize the group), so we hide them unless
 *  the selection is a single node. Context-delivered so it doesn't churn node
 *  data; the value only flips when the selection crosses the 1↔many boundary. */
export const SingleSelectionContext = createContext<boolean>(true);

/** Inline custom SVG logos (id → svg string), from the file's `custom_logos`.
 *  An `icon: "custom:<id>"` resolves against this. Context-delivered (like edit
 *  mode) so it reaches every leaf renderer without per-node data. */
export const CustomLogosContext = createContext<Record<string, string>>({});

/** Render an inline SVG string as a scalable `<img>` (data URI) — used for
 *  custom logos. Consistent with FileSvgIcon (objectFit: contain). */
export function InlineSvgIcon({ svg, className, style }: { svg: string; className?: string; style?: CSSProperties }) {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return <img src={src} alt="" draggable={false} className={className} style={{ objectFit: "contain", ...style }} />;
}

/** ReactFlow node `type` for a component, by its composite kind. */
export function nodeTypeFor(c: PlatformComponent): string {
  if (c.kind === "lakeflow") return "composite";
  if (c.kind === "genie-code") return "genieCode";
  if (c.kind === "governance") return "governance";
  if (c.kind === "lakeflow-genie") return "lakeflowGenie";
  if (c.kind === "agent-bricks") return "agentBricks";
  if (c.kind === "db-platform") return "dbPlatform";
  if (c.kind === "genie-one") return "genieOne";
  return "component";
}

/** Base (un-rotated) footprint of each node type — needed so the rotatable
 *  shell can swap W/H for 90°/270° and ReactFlow's handles land on the real
 *  rotated edges (not the original box). */
export function baseSize(c: PlatformComponent): { w: number; h: number } {
  // Single source of truth lives in the lib layer (naturalSize), keyed by the
  // component's composite kind / id. A composite kind takes priority over the
  // id (naturalSize keys composites by their catalog id, but a runtime
  // component may carry only `kind`), so branch on kind here first, then defer
  // to naturalSize for plain tiles / sublabel sizing.
  if (c.kind === "lakeflow") return { w: 224, h: 148 };
  if (c.kind === "lakeflow-genie") return { w: 360, h: 208 };
  if (c.kind === "agent-bricks") return { w: 230, h: 170 };
  if (c.kind === "genie-code") return { w: 360, h: 112 };
  if (c.kind === "governance") return { w: 580, h: 108 };
  if (c.kind === "db-platform") return { w: 380, h: 60 };
  return naturalSize(c.id);
}

/** Default box for a SOURCE tile with a vertical caption (top/bottom) — the
 *  icon+label stack needs a taller, narrower tile than the default wide row.
 *  Shared by nodeFootprint (the ReactFlow node box) and component-node (the
 *  card) so the selection frame + edge anchors match the visual. */
export const VERTICAL_SOURCE_SIZE = { w: 132, h: 96 };

// --- Positioned-icon-tile sizing (logo annotations + captioned sources) ------
// A labelled icon tile (icon + caption on a chosen side) auto-fits its box to
// the icon + text. The icon is a fixed square; the tile hugs it + the caption.
export const LOGO_ICON = 30; // fixed icon square (px)
export const LOGO_GAP = 8;
export const LOGO_PAD = 9;   // inner padding so a filled/bordered tile breathes

/** Natural (scale-1) size of a positioned icon+caption tile for given text.
 *  Uses canvas measureText (same font as the rendered caption) — synchronous,
 *  so callers can size the node in the SAME commit as the change (no
 *  measure-after-render pass). */
export function logoFitSize(text: string, horizontal: boolean, fontSize = 13, bold = false): { w: number; h: number } {
  const ctx = document.createElement("canvas").getContext("2d");
  let tw = 40;
  if (ctx) {
    // Mirrors the caption: text-[13px] font-medium on the app's sans stack.
    ctx.font = `${bold ? 700 : 500} ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    tw = Math.ceil(ctx.measureText(text || " ").width);
  }
  const th = Math.ceil(fontSize * 1.3);
  const w = horizontal ? LOGO_ICON + LOGO_GAP + tw + LOGO_PAD * 2 : Math.max(LOGO_ICON, tw) + LOGO_PAD * 2;
  const h = horizontal ? Math.max(LOGO_ICON, th) + LOGO_PAD * 2 : LOGO_ICON + LOGO_GAP + th + LOGO_PAD * 2;
  return { w: Math.max(28, w), h: Math.max(24, h) };
}

/** On-canvas footprint of a node = its card dims (natural or resized) with W/H
 *  swapped for 90°/270° rotation. This is what ReactFlow uses as the node size
 *  so handles, the selection frame, and the resizer all match the rotated box.
 *  `sourceCaption` (top/bottom) switches an unsized source to the taller box. */
export function nodeFootprint(
  c: PlatformComponent,
  pos: { w?: number; h?: number; rot?: number; sourceCaption?: "right" | "left" | "top" | "bottom" },
): { w: number; h: number } {
  const vertical = pos.sourceCaption === "top" || pos.sourceCaption === "bottom";
  const nat = vertical ? VERTICAL_SOURCE_SIZE : baseSize(c);
  const w = pos.w ?? nat.w;
  const h = pos.h ?? nat.h;
  const q = (((pos.rot ?? 0) % 360) + 360) % 360;
  return q === 90 || q === 270 ? { w: h, h: w } : { w, h };
}

// Resize-grip geometry — ONE source of truth for how far every grip (corners
// AND sides) floats outside the box and how big it is, so they can't drift.
const GRIP_LEN = 15; // grip box size (px)
const GRIP_OUT = 9; // distance the grip's OUTER edge sits past the border (px)

/** A resize grip drawn as a single SVG stroke (fat background line under a thin
 *  primary line → the "outlined" look), round caps + joints. ONE primitive for
 *  every grip: corner L-brackets (`top-left`…) and straight side bars (`h`/`v`).
 *  Sized GRIP_LEN×GRIP_LEN so callers can center it with a shared offset. */
function GripStroke({ shape }: { shape: "top-left" | "top-right" | "bottom-right" | "bottom-left" | "h" | "v" }) {
  const L = GRIP_LEN;
  const S = 3; // inset from the box edge so the round cap isn't clipped
  let d: string;
  let cursor: string;
  if (shape === "h" || shape === "v") {
    // Straight bar centered in the box, ~2/3 of its length.
    const a = S + 1;
    const b = L - S - 1;
    d = shape === "h" ? `M ${a} ${L / 2} L ${b} ${L / 2}` : `M ${L / 2} ${a} L ${L / 2} ${b}`;
    cursor = shape === "h" ? "ns-resize" : "ew-resize"; // h bar = top/bottom side, v bar = left/right side
  } else {
    const [oy, ox] = shape.split("-") as ["top" | "bottom", "left" | "right"];
    const ARM = 6; // arm length from the elbow (shorter than the full box side)
    const cx = ox === "left" ? S : L - S; // elbow x (outer corner)
    const cy = oy === "top" ? S : L - S; // elbow y (outer corner)
    const hx = ox === "left" ? cx + ARM : cx - ARM; // horizontal arm's inner end
    const vy = oy === "top" ? cy + ARM : cy - ARM; // vertical arm's inner end
    d = `M ${hx} ${cy} L ${cx} ${cy} L ${cx} ${vy}`;
    cursor = shape === "top-left" || shape === "bottom-right" ? "nwse-resize" : "nesw-resize";
  }
  return (
    <svg width={L} height={L} viewBox={`0 0 ${L} ${L}`} style={{ display: "block", overflow: "visible", cursor }}>
      {/* fat background stroke (the white outline) then the primary line on top */}
      <path d={d} fill="none" strokeLinecap="round" strokeLinejoin="round"
        style={{ stroke: "var(--color-background)", strokeWidth: 5.5 } as CSSProperties} />
      <path d={d} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Shell that gives a node TRUE rotation + resize:
 *   - outer box = the on-canvas footprint (W/H swapped for 90/270) so handles,
 *     snap, and the resizer use the real rotated bounds;
 *   - inner card rendered at NATURAL size then uniformly SCALED to fill the
 *     resized box → text + icons scale proportionally with no per-size code;
 *   - inner card rotated about the shell center.
 *  `w`/`h` are the un-rotated card size (natural or user-resized). */
export function RotatableCard({
  rot,
  w,
  h,
  scale,
  editMode,
  selected,
  forceDots = false,
  hideHandles = false,
  onContext,
  onResize,
  onScale,
  children,
}: {
  rot: number;
  w: number;
  h: number;
  scale: number;
  /** Natural (un-resized) content size. Accepted for callers' convenience but
   *  no longer used for sizing — the box (w×h) drives the visible size and
   *  `scale` (--cs) scales the inner content. */
  baseW?: number;
  baseH?: number;
  editMode: boolean;
  selected: boolean;
  forceDots?: boolean;
  /** Suppress the 4 standard side handles — composite nodes draw their own
   *  named ports instead and don't want the generic dots. */
  hideHandles?: boolean;
  onContext: (e: React.MouseEvent) => void;
  /** Side-drag: stretch the box on one axis (content stays its scaled size).
   *  `center` (optional) is the node's new CENTER position — passed when a
   *  grid-snap shifted the box so the PINNED edge stays put (RF pins the
   *  opposite edge, but snapping the dimension moves the box, so we recompute
   *  the center to keep the pinned edge on-grid). Callers persist it. */
  onResize: (w: number, h: number, center?: { x: number; y: number }) => void;
  /** Corner-drag (fit mode): uniform scale of the whole element. Given the new
   *  width, the caller derives scale = w / naturalW and resizes the box to
   *  natural × scale. Omitted → corner behaves like onResize (legacy). */
  onScale?: (newW: number) => void;
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
  // CORNER drag / Scale slider set `scale` → `--cs` scales the inner content
  // (the children's `scale(var(--cs))` wrappers). SIDE drag changes only w/h
  // (box-only) and leaves `scale` untouched, so the box grows/shrinks while the
  // content keeps its scale. Default scale 1 = content at natural size.
  const contentScale = scale || 1;
  // The shell FILLS the ReactFlow node box (ReactFlow + NodeResizer own the
  // node's width/height — see schemaToFlow). Filling 100% keeps the selection
  // frame, the resizer, and the visual all the same size (no drift on resize).
  // NodeResizer's min/max apply to the FOOTPRINT (the node box), which is
  // axis-swapped when rotated 90/270. If we passed the card-axis mins, a
  // rotated node whose footprint-width (= card height ≈56) is below minWidth=96
  // would get force-bumped on the first drag → the "vertical drag shrinks the
  // horizontal for no reason" bug. So swap the mins to match the footprint.
  // Small mins so any tile/logo can be shrunk right down (the old 96px floor
  // blocked scaling logos/boxes smaller). Swapped for 90/270 so a rotated
  // node's footprint axes get the right floor.
  const swapped90 = quarter === 90 || quarter === 270;
  const minW = swapped90 ? 24 : 32;
  const minH = swapped90 ? 32 : 24;
  // Resize handles show only for a SINGLE selection — a lasso multi-select
  // would otherwise mount 5 ReactFlow resize controls per node in one frame
  // (the lasso lag). One handle can't resize a group anyway.
  const singleSel = useContext(SingleSelectionContext);
  const showResize = editMode && selected && singleSel;
  // Shift-drag a resize handle = keep the aspect ratio. We capture the ratio at
  // drag start (onResizeStart) and, while Shift is held, constrain h to w.
  const ratioRef = useRef(1);
  const onSizeStart = (_: unknown, p: { width: number; height: number }) => {
    ratioRef.current = p.height > 0 ? p.width / p.height : 1;
  };

  // Shift-lock: keep the aspect ratio when Shift is down (drives h from w).
  const lockRatio = (e: { shiftKey?: boolean } | undefined, w: number, h: number): [number, number] =>
    e?.shiftKey ? [w, Math.round(w / (ratioRef.current || 1))] : [w, h];
  return (
    <div className="group relative h-full w-full" onContextMenu={onContext}>
      {/* Resize grips — ONE code path for every node (plain tiles, composites,
          annotations). CORNERS resize freely on both axes by default; hold SHIFT
          to keep the aspect ratio (nodes that scale their content — onScale —
          scale uniformly; others just lock w:h). SIDES stretch one axis. All
          drawn as thin round-capped grips (L-brackets on corners, bars on sides)
          pushed just outside the border, above the connection anchors (z:21). */}
      {showResize && (["top-left", "top-right", "bottom-right", "bottom-left"] as const).map((corner) => {
        // Push the bracket outward diagonally by the SHARED grip distance, then
        // back by half the grip's own size so it centers on the corner point.
        const [oy, ox] = corner.split("-") as ["top" | "bottom", "left" | "right"];
        const dx = (ox === "left" ? -GRIP_OUT : GRIP_OUT) - GRIP_LEN / 2;
        const dy = (oy === "top" ? -GRIP_OUT : GRIP_OUT) - GRIP_LEN / 2;
        // Shift-lock: onScale nodes scale uniformly; the rest lock w:h via ratio.
        const shiftResize = (p: { width: number; height: number }) => {
          if (onScale) { onScale(p.width); return null; }
          return [p.width, Math.round(p.width / (ratioRef.current || 1))] as [number, number];
        };
        return (
          <NodeResizeControl
            key={corner}
            position={corner}
            minWidth={minW}
            minHeight={minH}
            onResizeStart={onSizeStart}
            // RF owns the geometry: it snaps the pointer to the grid (snapToGrid)
            // and pins the diagonal-opposite corner via nodeOrigin. We just
            // persist the size. Shift → uniform scale (continuous).
            onResize={(e, p) => {
              if ((e as { shiftKey?: boolean })?.shiftKey) { const r = shiftResize(p); if (r) onResize(r[0], r[1]); }
              else onResize(p.width, p.height);
            }}
            onResizeEnd={(e, p) => {
              if ((e as { shiftKey?: boolean })?.shiftKey) { const r = shiftResize(p); if (r) onResize(r[0], r[1]); }
              else onResize(p.width, p.height);
            }}
            style={{ background: "transparent", border: "none", zIndex: 21, transform: `translate(${dx}px, ${dy}px)` }}
          >
            <GripStroke shape={corner} />
          </NodeResizeControl>
        );
      })}
      {showResize && (["top", "right", "bottom", "left"] as const).map((side) => {
        // Match the CORNERS' visible distance. The corner's ink (its elbow) sits
        // at the outer corner of its box, but a side bar is drawn down the box
        // CENTER — so aligning box centers leaves the side ink ~half a grip too
        // far IN. Push sides out by an extra half-grip so the drawn lines line up.
        const sideAxis = side === "left" || side === "right";
        const half = GRIP_LEN / 2;
        const D = GRIP_OUT + 4; // small nudge so the bar's ink lines up with the corner ink
        const out = D - half; // top-left offset that lands the center at D
        // Parallel-axis correction: RF's side-handle anchor isn't exactly the
        // edge midpoint, so plain -half read a touch off (top/bottom too far
        // left, left/right too far up). Nudge back toward center.
        const par = -half + 2;
        const transform =
          side === "left" ? `translate(${-D - half}px, ${par}px)`
          : side === "right" ? `translate(${out}px, ${par}px)`
          : side === "top" ? `translate(${par}px, ${-D - half}px)`
          : `translate(${par}px, ${out}px)`;
        return (
          <NodeResizeControl
            key={side}
            position={side}
            minWidth={minW}
            minHeight={minH}
            onResizeStart={onSizeStart}
            // RF snaps the pointer to the grid + pins the opposite edge; we just
            // persist the resulting size (one axis stretches, content unscaled).
            onResize={(e, p) => { const [w, h] = lockRatio(e as { shiftKey?: boolean }, p.width, p.height); onResize(w, h); }}
            onResizeEnd={(e, p) => { const [w, h] = lockRatio(e as { shiftKey?: boolean }, p.width, p.height); onResize(w, h); }}
            style={{ background: "transparent", border: "none", zIndex: 21, transform }}
          >
            <GripStroke shape={sideAxis ? "v" : "h"} />
          </NodeResizeControl>
        );
      })}
      {!hideHandles && <NodeHandles editMode={editMode} selected={selected} forceDots={forceDots} />}
      {/* Card box at the node's w×h (un-rotated), rotated about the shell centre
          so its border == the box edges. The children (the bordered card +
          content) FILL this box, so any resize handle moves the visible box.
          `--cs` = scale lets the inner content scale (corner/slider) inside it;
          a side drag changes w/h only → box grows, content keeps its scale. */}
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

/** One side a connection dot can sit on. `l`/`r`/`t`/`b` are the plain-node
 *  ids; composites reuse the same sides for their named ports. */
export type DotSide = "l" | "r" | "t" | "b";

const DOT_POSITION: Record<DotSide, Position> = {
  l: Position.Left,
  r: Position.Right,
  t: Position.Top,
  b: Position.Bottom,
};

export interface DotSpec {
  /** Handle id ReactFlow anchors edges to (`r`/`l`/… or `in-<port>`/`bl`/…). */
  id: string;
  /** Which side of the box the dot sits on. */
  side: DotSide;
  /** Position ALONG that side, 0→1 (default 0.5 = centered). A left-side port
   *  at 0.17 sits near the top; `bl` sits at the bottom near the left, etc. */
  frac?: number;
}

/**
 * A single connection anchor — the ONE source of truth for how a draggable dot
 * looks + behaves, shared by plain nodes (NodeHandles) and composites
 * (LakeflowPorts). Extracted so the two can't drift in size/shape again.
 *
 * Two-part design so the DOT can float outside the box while EDGES still
 * terminate ON the box edge:
 *   • the real <Handle> stays on the node border (ReactFlow anchors edges to it
 *     → lines touch the box, no floating gap). It's the grabbable hit area.
 *   • a separate decorative dot is pushed OUTSIDE the border (visual only).
 *
 * Both are counter-scaled by 1/zoom so they stay a FIXED pixel size on screen.
 * Handles are CONNECTABLE whenever we're in edit mode — including when the node
 * is already selected or the anchor already has an edge (start a SECOND link).
 */
export function ConnectionDot({
  id,
  side,
  frac = 0.5,
  editMode,
  dotOn,
}: DotSpec & { editMode: boolean; dotOn: boolean }) {
  // Screen-CONSTANT sizing: dots live inside the zoomed viewport; counter-scale
  // by 1/zoom so they're a fixed pixel size at any zoom.
  const zoom = useStore((s) => s.transform[2]);
  const inv = 1 / (zoom || 1);
  // A middling dot — between the old fat plain-node dot (12) and the tiny
  // composite square (~7). One size for every anchor in the diagram.
  const DOT = dotOn ? 10 : 8;
  const OUT = 8; // px the dot floats outside the border (screen-constant)
  // Hit area (~2x the dot) so aiming at the round lands on the handle even when
  // an edge is attached. High zIndex to beat a connected edge's stripe.
  const HIT = Math.max(22, 22 * inv);
  const off = OUT * inv;
  const dot = DOT * inv;
  const along = `${frac * 100}%`;
  // Along-side coordinate (the axis perpendicular to `side`).
  const alongPos: CSSProperties =
    side === "l" || side === "r" ? { top: along } : { left: along };
  // Cross-axis: which border the dot hugs + the outward push direction.
  const cross: Record<DotSide, { anchor: CSSProperties; push: string }> = {
    r: { anchor: { left: "100%" }, push: `translate(calc(-50% + ${off}px), -50%)` },
    l: { anchor: { left: 0 }, push: `translate(calc(-50% - ${off}px), -50%)` },
    b: { anchor: { top: "100%" }, push: `translate(-50%, calc(-50% + ${off}px))` },
    t: { anchor: { top: 0 }, push: `translate(-50%, calc(-50% - ${off}px))` },
  };
  // Center the along-axis of the hit box on the anchor point.
  const alongCenter =
    side === "l" || side === "r" ? "translateY(-50%)" : "translateX(-50%)";
  const handleCls = `!bg-transparent !border-0 ${editMode ? "" : "!pointer-events-none"}`;
  const dotVisCls = dotOn
    ? "opacity-100"
    : editMode
      ? "opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      : "opacity-0";
  const dotCls =
    `pointer-events-none absolute z-10 rounded-full bg-background shadow-sm ${dotVisCls} ` +
    (dotOn ? "border-2 border-primary" : "border-2 border-primary/70");
  // The real handle (hit area, anchored to the border) …
  const hStyle: CSSProperties = {
    position: "absolute",
    width: HIT,
    height: HIT,
    zIndex: 20,
    ...alongPos,
    ...cross[side].anchor,
    // Recenter the (resized) hit box on the anchor point, then push it outward
    // so it sits over the decorative dot (RF's default transform is for the
    // default box size — we override it).
    transform: cross[side].push,
  };
  // … and the decorative dot (visual only, floats OUT px outside the border).
  const dStyle: CSSProperties = {
    position: "absolute",
    width: dot,
    height: dot,
    ...alongPos,
    ...(side === "r" ? { right: -OUT * inv } : side === "l" ? { left: -OUT * inv } : {}),
    ...(side === "b" ? { bottom: -OUT * inv } : side === "t" ? { top: -OUT * inv } : {}),
    transform: alongCenter,
  };
  return (
    <>
      <Handle type="source" position={DOT_POSITION[side]} id={id} className={handleCls} style={hStyle} isConnectable={editMode} />
      <span className={dotCls} style={dStyle} />
    </>
  );
}

/** Whether a node's anchors are forced visible: SELECTED or a reconnect drop
 *  target. (Otherwise they fade in on hover in edit mode.) */
export function dotsOn(selected: boolean, forceDots: boolean) {
  return selected || forceDots;
}

/** The four connection dots (top/right/bottom/left) every plain node carries so
 *  the user can link from any side. Each side is both source + target. Composite
 *  blocks build their own port list from ConnectionDot instead (same dots). */
const PLAIN_DOTS: DotSpec[] = [
  { id: "r", side: "r" },
  { id: "l", side: "l" },
  { id: "b", side: "b" },
  { id: "t", side: "t" },
];
export function NodeHandles({ editMode, selected = false, forceDots = false }: { editMode: boolean; selected?: boolean; forceDots?: boolean }) {
  const on = dotsOn(selected, forceDots);
  return (
    <>
      {PLAIN_DOTS.map((s) => (
        <ConnectionDot key={s.id} {...s} editMode={editMode} dotOn={on} />
      ))}
    </>
  );
}
