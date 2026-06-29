/**
 * platform-diagram/shared — core node primitives shared by the vanilla
 * (`ComponentNode`) and composite (`LakeflowBlock`) nodes: the data shape, the
 * footprint math, the rotatable/resizable card shell, the connection handles,
 * and the drop-target context.
 */
import { createContext, type CSSProperties } from "react";
import { Handle, Position, NodeResizer, NodeResizeControl } from "@xyflow/react";
import { type PlatformComponent, type BandId, type FlowStyle } from "@/lib/platform-architecture";

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
  /** Resize callback (from NodeResizer) — w/h are the un-rotated card size.
   *  Optional `scale` (corner-drag) is stored so content scales with the box. */
  onResize: (id: string, w: number, h: number, scale?: number) => void;
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
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderColor?: string;
  borderRadius?: number;
  shadow?: number | boolean;
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
function shadowCss(level: number): string | undefined {
  if (level <= 0) return undefined;
  const t = level / 100;
  const y = Math.round(1 + t * 9);          // 1 → 10 px offset
  const blur = Math.round(2 + t * 22);      // 2 → 24 px blur
  const alpha = (0.06 + t * 0.22).toFixed(3); // 0.06 → 0.28
  return `0 ${y}px ${blur}px -${Math.round(y / 2)}px rgba(15, 23, 42, ${alpha})`;
}

export function cardStyle(
  d: NodeData,
  defaults: { borderColor: string; radius: number; opacity?: number },
): { style: CSSProperties; hasFill: boolean; shadow: boolean } {
  const w = d.borderWidth ?? 1;
  const level = shadowLevel(d.shadow);
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

/** ReactFlow node `type` for a component, by its composite kind. */
export function nodeTypeFor(c: PlatformComponent): string {
  if (c.kind === "lakeflow") return "composite";
  if (c.kind === "genie-code") return "genieCode";
  if (c.kind === "governance") return "governance";
  if (c.kind === "lakeflow-genie") return "lakeflowGenie";
  if (c.kind === "agent-bricks") return "agentBricks";
  if (c.kind === "db-platform") return "dbPlatform";
  return "component";
}

/** Base (un-rotated) footprint of each node type — needed so the rotatable
 *  shell can swap W/H for 90°/270° and ReactFlow's handles land on the real
 *  rotated edges (not the original box). */
export function baseSize(c: PlatformComponent): { w: number; h: number } {
  if (c.kind === "lakeflow") return { w: 224, h: 148 }; // composite super-block
  if (c.kind === "lakeflow-genie") return { w: 360, h: 208 }; // Lakeflow over a slim Genie footer
  if (c.kind === "agent-bricks") return { w: 230, h: 170 }; // logo header + supervisor tree + task-type chips
  if (c.kind === "genie-code") return { w: 360, h: 112 }; // wide "built with Genie Code" strip
  if (c.kind === "governance") return { w: 580, h: 108 }; // wide horizontal governance bar
  if (c.kind === "db-platform") return { w: 380, h: 60 }; // Databricks wordmark + "The Data Intelligence Platform" banner
  if (c.id === "sdp") return { w: 230, h: 112 };
  // A sub-line + (optional) badge needs a slightly wider, taller tile.
  if (c.sublabel) return { w: 230, h: 70 };
  return { w: 200, h: 56 };
}

/** On-canvas footprint of a node = its card dims (natural or resized) with W/H
 *  swapped for 90°/270° rotation. This is what ReactFlow uses as the node size
 *  so handles, the selection frame, and the resizer all match the rotated box. */
export function nodeFootprint(
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
  /** Side-drag: stretch the box on one axis (content stays its scaled size). */
  onResize: (w: number, h: number) => void;
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
  return (
    <div className="group relative h-full w-full" onContextMenu={onContext}>
      {onScale ? (
        <>
          {/* CORNER handles (locked aspect) → uniform scale of the element. */}
          <NodeResizer
            isVisible={editMode && selected}
            minWidth={minW}
            minHeight={minH}
            keepAspectRatio
            onResize={(_, p) => onScale(p.width)}
            onResizeEnd={(_, p) => onScale(p.width)}
            lineClassName="!border-transparent"
            handleClassName="!bg-primary !border-2 !border-background !w-3.5 !h-3.5 !rounded-sm !shadow-md"
          />
          {/* SIDE handles → stretch the BOX on one axis (content unscaled). */}
          {editMode && selected && (["top", "right", "bottom", "left"] as const).map((side) => (
            <NodeResizeControl
              key={side}
              position={side}
              minWidth={minW}
              minHeight={minH}
              onResize={(_, p) => onResize(p.width, p.height)}
              onResizeEnd={(_, p) => { const snap = (v: number) => Math.round(v / 16) * 16; onResize(snap(p.width), snap(p.height)); }}
              style={{ background: "transparent", border: "none" }}
            >
              <span
                className="block rounded-full border border-primary bg-background shadow-sm"
                style={{
                  width: side === "left" || side === "right" ? 5 : 18,
                  height: side === "left" || side === "right" ? 18 : 5,
                  cursor: side === "left" || side === "right" ? "ew-resize" : "ns-resize",
                }}
              />
            </NodeResizeControl>
          ))}
        </>
      ) : (
        <NodeResizer
          isVisible={editMode && selected}
          minWidth={minW}
          minHeight={minH}
          onResize={(_, p) => onResize(p.width, p.height)}
          onResizeEnd={(_, p) => {
            const snap = (v: number) => Math.round(v / 16) * 16;
            onResize(snap(p.width), snap(p.height));
          }}
          lineClassName="!border-primary/50"
          handleClassName="!bg-primary !border-2 !border-background !w-3.5 !h-3.5 !rounded-sm !shadow-md"
        />
      )}
      {!hideHandles && <NodeHandles show={editMode && !selected} forceDots={forceDots} />}
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

/** The four connection dots (top/right/bottom/left) every node carries so the
 *  user can link from any side. Each side is both source + target. */
export function NodeHandles({ show, forceDots = false }: { show: boolean; forceDots?: boolean }) {
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
