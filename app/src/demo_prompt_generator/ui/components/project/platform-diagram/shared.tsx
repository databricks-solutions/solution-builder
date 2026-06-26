/**
 * platform-diagram/shared — core node primitives shared by the vanilla
 * (`ComponentNode`) and composite (`LakeflowBlock`) nodes: the data shape, the
 * footprint math, the rotatable/resizable card shell, the connection handles,
 * and the drop-target context.
 */
import { createContext } from "react";
import { Handle, Position, NodeResizer } from "@xyflow/react";
import { type PlatformComponent, type BandId } from "@/lib/platform-architecture";

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
  /** Per-node style overrides (right-click): whole-node opacity (0..1), box
   *  fill color, text/label color, border. Undefined → use node defaults. */
  opacity?: number;
  fillColor?: string;
  fontColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderColor?: string;
  /** Whether real third-party trademarked logos may be shown (schema-level
   *  opt-in). When false, gated vendor logos render as a text badge. */
  allowTrademark?: boolean;
  /** For canvas-added sources ("+ more data sources"): the logo-catalog key,
   *  persisted so the source round-trips without a catalog entry. */
  sourceKey?: string;
  [key: string]: unknown;
}

/** Node id currently under a dragged endpoint (magnet highlight). */
export const DropTargetContext = createContext<string | null>(null);

/** ReactFlow node `type` for a component, by its composite kind. */
export function nodeTypeFor(c: PlatformComponent): string {
  if (c.kind === "lakeflow") return "composite";
  if (c.kind === "genie-code") return "genieCode";
  return "component";
}

/** Base (un-rotated) footprint of each node type — needed so the rotatable
 *  shell can swap W/H for 90°/270° and ReactFlow's handles land on the real
 *  rotated edges (not the original box). */
export function baseSize(c: PlatformComponent): { w: number; h: number } {
  if (c.kind === "lakeflow") return { w: 224, h: 148 }; // composite super-block
  if (c.kind === "genie-code") return { w: 360, h: 150 }; // wide "built with Genie Code" strip
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
  children,
}: {
  rot: number;
  w: number;
  h: number;
  scale: number;
  editMode: boolean;
  selected: boolean;
  forceDots?: boolean;
  /** Suppress the 4 standard side handles — composite nodes draw their own
   *  named ports instead and don't want the generic dots. */
  hideHandles?: boolean;
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
      {!hideHandles && <NodeHandles show={editMode && !selected} forceDots={forceDots} />}
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
