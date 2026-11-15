/**
 * platform-diagram/canvas — the inner ReactFlow canvas (needs ReactFlow
 * context). Owns the live nodes/edges, the library/detail panels, the
 * right-click menu, drag-to-add, undo/redo history, and the debounced save.
 */
import {
  memo,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import {
  ReactFlow,
  ConnectionMode,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  useStoreApi,
  useNodesInitialized,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import {
  baseId,
  BAND_COLOR,
  BAND_META,
  catalogBands,
  DBX_ARCH_PRESET_BY_ID,
  logoFootprint,
  type PlatformComponent,
  type PlatformSchema,
  type NodePosition,
  type BandId,
  type AnnotationData,
  type AnnotationVariant,
  legendEntries,
} from "@/lib/platform-architecture";
import {
  type NodeData,
  type StylePatch,
  DropTargetContext,
  EditModeContext,
  SingleSelectionContext,
  AutoEditContext,
  EdgeSelectedContext,
  nodeFootprint,
  nodeTypeFor,
  baseSize,
  verticalSourceSize,
} from "./shared";
import {
  type Rect,
  type EdgeOps,
  EdgeOpsContext,
  remapHandleForType,
} from "./edge-routing";
import { LF_PORTS } from "./composite-lakeflow";
import { DEFAULT_SHAPE_KIND, type ShapeKind } from "./shape-geometry";
import {
  IconPicker,
  ANNOTATION_DEFAULT_SIZE,
  HTML_BLOCK_STARTER,
  type AnnotationNodeData,
} from "./annotations";
import { logoLabel } from "../../file-icons";
import { Button } from "@/components/ui/button";
import {
  Eye,
  Pencil,
  Undo2,
  Redo2,
  PaintRoller,
  Clock,
  ListOrdered,
} from "lucide-react";
import { nodeTypes, edgeTypes } from "./node-types";
import { DetailPanel } from "./panels/detail-panel";
import { EditPanel } from "./panels/edit-panel";
import { LibraryPalette } from "./panels/library-palette";
import { LegendPanel } from "./panels/legend-panel";
import { componentLookup, schemaToFlow, flowToLayout, EDGE_Z, NODE_Z, handlesFor, fallbackHandle } from "./flow-mapping";
import { parseArchitecture, serializeArchitecture, naturalSize, cardLayout, htmlBlockLayout } from "@/lib/platform-architecture";
import { ContextMenu, type CtxMenu } from "./menus/context-menu";
import { GroupResize, rectOfNode, type GroupScale } from "./group-resize";
import { useDiagramHistory } from "./hooks/use-diagram-history";
import { useNodeMutations } from "./hooks/use-node-mutations";
import { useEdgeMutations } from "./hooks/use-edge-mutations";
import { usePasteImage } from "./hooks/use-paste-image";
import { CollabCursors } from "./collab/collab-cursors";
import type { CanvasCollab } from "./collab/types";

interface CanvasProps {
  schema: PlatformSchema;
  deepLinks: Record<string, string | null>;
  onPersist: (layout: PlatformSchema["layout"]) => void;
  onSetTrademark: (on: boolean) => void;
  /** Live collaboration binding (cursors + presence). Absent when the project
   *  isn't shared / collab is off. */
  collab?: CanvasCollab;
  /** Interaction gate (in-app collab only). Canvas sets `.current = true` while
   *  the local user is mid drag/resize so the parent defers remote-op reseeds
   *  (which would otherwise flash/jank the live interaction). Absent standalone. */
  interactingRef?: React.MutableRefObject<boolean>;
  /** Called the moment a local drag/resize settles, so the parent can flush any
   *  peer op it deferred during the interaction. Paired with `interactingRef`. */
  onInteractionEnd?: () => void;
  /** Opens the Share dialog ("Share live with others"). When set, a share
   *  button shows in the floating toolbar. Absent in standalone / read-only. */
  onShareLive?: () => void;
  /** Toggles the architecture-history panel. When set, a History button shows
   *  in the floating toolbar next to Share live. In-app only. */
  onToggleHistory?: () => void;
  /** Initial edit-mode. Defaults to true (the in-app editor); the standalone
   *  viewer passes false to render read-only. */
  defaultEditMode?: boolean;
  /** Hard read-only: hide the floating action bar (View/Edit toggle, undo/redo,
   *  …) entirely and lock to view mode. The standalone VIEWER passes this so it
   *  shows ONLY the diagram — no edit affordances at all. */
  readOnly?: boolean;
  /** Extra controls rendered at the RIGHT end of the floating action bar (the
   *  Download menu, whose logic + deps live in the parent PlatformDiagram).
   *  Kept as a node so the parent owns their behavior. */
  toolbarExtras?: React.ReactNode;
  /** Status indicator rendered at the LEFT end of the floating action bar (the
   *  save-status icon), so it doesn't leave a gap on the right. */
  toolbarStatus?: React.ReactNode;
  /** The multi-tab strip, rendered at the TOP-LEFT of the canvas (the parent
   *  PlatformDiagram owns the tab state). Node so the parent controls it. */
  tabBar?: React.ReactNode;
}

/** Mint a unique instance id for a newly-ADDED node. The first instance keeps the
 *  bare `base` id (clean for the common single-instance case); a second+ instance
 *  gets `base#<rand>` with a short RANDOM token — not a sequential `#2/#3`. The
 *  randomness matters under live collaboration: two people adding another instance
 *  of the same component concurrently would both compute `#2` deterministically
 *  and collide on the shared doc (one add lost to key-LWW); a random token makes
 *  concurrent adds distinct. `baseId()` still recovers `base` (splits at `#`). */
function mintInstanceId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  let id = `${base}#${Math.random().toString(36).slice(2, 6)}`;
  while (taken(id)) id = `${base}#${Math.random().toString(36).slice(2, 6)}`;
  return id;
}

/** Stable empty-selection sentinel so `groupTargets` keeps one identity when
 *  nothing multi-selected (a fresh `[]` each render would churn the memo'd
 *  EditPanel every drag frame). */
const EMPTY_IDS: string[] = [];

/** Stable no-op context-menu suppressor for the ReactFlow node/selection
 *  handlers (a fresh `(e) => e.preventDefault()` each render is needless). */
const preventDefault = (e: { preventDefault: () => void }) => e.preventDefault();

/** True iff two graphs have the SAME set of ids (order-independent). Used to tell
 *  a pure re-layout reseed (keep undo history) from a structural load (reset it). */
function sameIdSet(a: { id: string }[], b: { id: string }[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((x) => x.id));
  return b.every((x) => ids.has(x.id));
}

/** The set of un-pinned nodes that would REFLOW in `computeLayout` when `draggedId`
 *  moves — so a drag can freeze exactly them to pixels first and they don't "jump":
 *
 *   • the dragged node's column AND every column to its RIGHT. Column X is a
 *     left→right cascade (each lane's x = the previous lane's right edge + gaps),
 *     and pinning a node drops it out of the lane math — which re-widths its lane
 *     and shifts every DOWNSTREAM column. Freezing the dragged column + everything
 *     right of it keeps those columns exactly where they sit. Columns to the LEFT
 *     are upstream in the cascade, unaffected by this drag, so they stay symbolic.
 *   • nodes RELATIONALLY anchored to the group (`below`/`above`/`leftOf`/`rightOf`/
 *     `alignX`/`alignY` pointing at any node already in the set), transitively.
 *
 *  Excludes: the dragged node itself, already-pinned nodes, and WRAPPING BOXES /
 *  pinned banners (they must stay symbolic to keep auto-sizing around + docking to
 *  their children — pinning a box to pixels freezes it and children escape it).
 *  Reads only live `NodeData.placement` + the tab's column order, so it's cheap. */
function relativeReflowGroup(nds: Node[], draggedId: string, columns?: string[]): Set<string> {
  const pl = (n: Node) => (n.data as NodeData).placement;
  const isContainer = (n: Node) => !!(pl(n)?.wraps?.length || pl(n)?.pin);
  const dragged = nds.find((n) => n.id === draggedId);
  const draggedCol = pl(dragged ?? ({} as Node))?.col;

  const group = new Set<string>();
  if (draggedCol) {
    // Column index in the left→right order; -1 if the tab declares no `columns`
    // (then we fall back to freezing only the same-named column).
    const order = columns ?? [];
    const draggedIdx = order.indexOf(draggedCol);
    for (const n of nds) {
      if (n.id === draggedId) continue;
      if ((n.data as NodeData).pinned || isContainer(n)) continue;
      const c = pl(n)?.col;
      if (!c) continue;
      const inScope = draggedIdx < 0
        ? c === draggedCol                       // no column order → same column only
        : order.indexOf(c) >= draggedIdx;        // this column and everything to its right
      if (inScope) group.add(n.id);
    }
  }
  // Transitively pull in anything anchored to the dragged node or a group member.
  const anchoredTo = (p: NodePosition["placement"] | undefined) =>
    [p?.below, p?.above, p?.leftOf, p?.rightOf, p?.alignX, p?.alignY].filter(Boolean) as string[];
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of nds) {
      if (n.id === draggedId || group.has(n.id)) continue;
      if ((n.data as NodeData).pinned || isContainer(n)) continue;
      if (anchoredTo(pl(n)).some((ref) => ref === draggedId || group.has(ref))) {
        group.add(n.id);
        grew = true;
      }
    }
  }
  return group;
}

/** After a node is dropped in a relative column, the un-pinned siblings re-stack.
 *  Compute that reflow LOCALLY (so it's instant, not after the save round-trip):
 *  serialize the live graph → parse (which runs computeLayout) → return the nodes
 *  with ONLY the siblings' positions patched IN PLACE. Node identities, selection,
 *  data, and the dropped/pinned nodes are untouched. Best-effort — on any error
 *  returns the input unchanged (the round-trip reflow still corrects it).
 *
 *  A sibling is patched iff it: is NOT one of the just-`dropped` ids, is NOT
 *  pinned (pinned nodes keep their pixel position), and appears in the recomputed
 *  layout at a DIFFERENT position. */
function reflowRelativeSiblings(
  nds: Node[],
  eds: Edge[],
  schema: PlatformSchema,
  dropped: Set<string>,
): Node[] {
  try {
    const body = serializeArchitecture(schema, flowToLayout(nds, eds, schema));
    const recomputed = parseArchitecture(body).layout.nodes;
    let changed = false;
    const next = nds.map((n) => {
      if (dropped.has(n.id) || (n.data as NodeData).pinned) return n;
      const p = recomputed[n.id];
      if (!p) return n;
      const posMoved = Math.round(p.x) !== Math.round(n.position.x) || Math.round(p.y) !== Math.round(n.position.y);
      // A wrapping box / composite is AUTO-SIZED by computeLayout from its
      // children, so a sibling move can change its w/h too. Patch that here as
      // well — else the box keeps its stale (halfway) size until the round-trip
      // corrects it ~400ms later (the "double resize" flicker). p.w/p.h are the
      // footprint dims, matching RF width/height directly.
      const curW = (n.width ?? (n.data as NodeData).w);
      const curH = (n.height ?? (n.data as NodeData).h);
      const sizeChanged =
        p.w != null && p.h != null &&
        (Math.round(p.w) !== Math.round(curW ?? -1) || Math.round(p.h) !== Math.round(curH ?? -1));
      if (!posMoved && !sizeChanged) return n;
      changed = true;
      const dd = n.data as NodeData;
      // Only write data.w/data.h when the node was ALREADY user-sized (dd.w set) —
      // else flowToLayout would emit explicit w/h and PIN an auto-sized box's
      // size, breaking its wrap auto-sizing. For an auto-sized box we patch just
      // the RF visual dims (width/height/style); its data stays size-free.
      const wasUserSized = dd.w != null;
      return {
        ...n,
        ...(posMoved ? { position: { x: p.x, y: p.y } } : {}),
        ...(sizeChanged
          ? {
              width: p.w,
              height: p.h,
              style: { ...n.style, width: p.w, height: p.h },
              ...(wasUserSized ? { data: { ...dd, w: Math.round(p.w!), h: Math.round(p.h!) } } : {}),
            }
          : {}),
      };
    });
    return changed ? next : nds;
  } catch {
    return nds; // fall back to the round-trip reflow
  }
}

// --- Static <ReactFlow> props — hoisted to module scope so they keep ONE
//     identity for the component's lifetime. Passing fresh object/array
//     literals inline would hand ReactFlow a new reference every Canvas render
//     (i.e. every drag frame), churning its internal store. ---
const NODE_ORIGIN: [number, number] = [0.5, 0.5];
const SNAP_GRID: [number, number] = [16, 16];
const PRO_OPTIONS = { hideAttribution: true };
const DEFAULT_EDGE_OPTIONS = { type: "flow" };
const PAN_ON_DRAG: [number, number] = [1, 2];
const MULTI_SELECT_KEYS = ["Shift"];
// Initial-fit options. `maxZoom: 1` caps how far the auto-fit zooms IN: without
// it, a near-empty canvas (0–1 nodes, or a couple of small annotations) frames
// its tiny bbox and RF zooms to the global maxZoom (2×), so one note/component
// fills the screen and everything you then add is enormous. Capping the FIT at
// 1× keeps a sparse diagram at a natural size while still filling the viewport
// for a dense one. This bounds only the AUTO-fit — the user can still zoom to
// the full 0.3–2 range by hand (mouse wheel / Controls). `padding` leaves a
// comfortable margin so a single centered node isn't edge-to-edge.
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.08 };
// Margin kept clear of the pane's right edge when the docked panel opens over
// the selection (see the occlusion guard). Wide enough for the resize grips,
// which reach ~13px outside the box.
const PANEL_GUARD = 28;
// Smallest box an exact numeric size edit may produce (same floor the group
// resize uses).
const MIN_NODE_SIZE = 16;

// memo: the parent (PlatformDiagram) re-renders on every save-status change
// (saving → saved → idle, ~3× per save). All of Canvas's props are stable
// (memoized schema/deepLinks, useCallback'd handlers), so the memo drops those
// parent-driven full re-renders entirely — they'd otherwise re-run the whole
// render body for a status chip the Canvas doesn't even show.
export const Canvas = memo(function Canvas({ schema, deepLinks, onPersist, onSetTrademark, collab, interactingRef: interactingRefProp, onInteractionEnd, onShareLive, onToggleHistory, defaultEditMode = true, readOnly = false, toolbarExtras, toolbarStatus, tabBar }: CanvasProps) {
  const [confirmTrademark, setConfirmTrademark] = useState(false);
  const [sourcePicker, setSourcePicker] = useState(false);
  // The readable Legend panel (chrome, so it's OUTSIDE the image export). Shown
  // whenever the tab has a legend — including read-only / standalone HTML, where
  // it's the only way to read a `show:"panel"` legend.
  const [legendOpen, setLegendOpen] = useState(false);
  const hasLegend = legendEntries(schema.legend).length > 0;
  // "see more logos" from search → the full logo picker, seeded with the query
  // the user already typed (null = closed).
  const [logoPicker, setLogoPicker] = useState<string | null>(null);
  // Turning logos ON requires a permission ack; turning OFF is immediate.
  const toggleTrademark = useCallback(() => {
    if (schema.enableTrademarkLogos) onSetTrademark(false);
    else setConfirmTrademark(true);
  }, [schema.enableTrademarkLogos, onSetTrademark]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(defaultEditMode);
  const [menu, setMenu] = useState<CtxMenu>(null);
  // Node id whose TYPE we're changing (right-click → Change type). While set,
  // the library palette is in "pick a replacement" mode + the canvas is dimmed.
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  // Annotation node id whose LOGO we're picking (opens the IconPicker modal).
  const [logoPickerFor, setLogoPickerFor] = useState<string | null>(null);
  // A freshly-added TEXT annotation to drop the cursor into immediately.
  const [autoEditFor, setAutoEditFor] = useState<string | null>(null);
  // Ids of all currently-selected nodes (lasso / shift-click). Drives whether
  // the right-click style controls apply to one node or the whole selection.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    // ReactFlow fires this on EVERY rubber-band tick as the lasso sweeps. A raw
    // `sel.map(...)` allocates a fresh array each time, so React never bails out
    // (Object.is on arrays) → the whole Canvas re-renders per tick even when the
    // selected SET is unchanged. Bail when membership is identical so only real
    // selection changes re-render.
    setSelectedIds((prev) => {
      if (prev.length === sel.length && prev.every((id, i) => id === sel[i].id)) return prev;
      return sel.map((n) => n.id);
    });
  }, []);
  const { screenToFlowPosition, getInternalNode, getViewport, setViewport, fitView } = useReactFlow();
  const rfStore = useStoreApi();
  // NOTE: fit-view on tab open is handled by the built-in `fitView` prop on
  // <ReactFlow> below. The ReactFlowProvider is keyed by tab in the shell, so
  // the store is recreated per tab and that prop's QUEUED initial fit (which RF
  // runs at exactly the right moment — when nodes are measured) fires fresh for
  // each tab. That's the same path a page refresh takes, so the framing matches.
  // A manual useNodesInitialized+fitView() effect here fought that queue and
  // fit against a mid-transition bbox (box not yet sized → zoomed in too far).
  const wrapRef = useRef<HTMLDivElement>(null);
  // The ReactFlow pane itself (the flex child that SHRINKS when a docked
  // right-side panel opens) — measured by the occlusion guard below.
  const paneRef = useRef<HTMLDivElement>(null);

  // --- Live collab: relay this tab's pointer (in FLOW coords, so peers place it
  //     correctly at any zoom/pan) whenever collaboration is active. Throttling
  //     lives in the hook's sendCursor. --------------------------------------
  const collabRef = useRef(collab);
  collabRef.current = collab;
  // --- Interaction gate (collab): tell the parent to hold off applying peer ops
  //     while a local drag/resize is in flight, then flush them on settle. Stable
  //     refs so the memoized change handlers don't re-create when the parent
  //     re-renders. `endInteraction` clears the gate (idempotent) + flushes. -----
  const interactingRef = useRef(interactingRefProp);
  interactingRef.current = interactingRefProp;
  const onInteractionEndRef = useRef(onInteractionEnd);
  onInteractionEndRef.current = onInteractionEnd;
  const beginInteraction = useCallback(() => {
    const g = interactingRef.current;
    if (g) g.current = true;
  }, []);
  const endInteraction = useCallback(() => {
    const g = interactingRef.current;
    if (g && g.current) {
      g.current = false;
      onInteractionEndRef.current?.(); // replay any op deferred during the drag
    }
  }, []);
  const onPointerMoveCursor = useCallback((e: React.PointerEvent) => {
    const c = collabRef.current;
    if (!c) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    c.sendCursor(p.x, p.y);
  }, [screenToFlowPosition]);

  // --- Device-aware wheel: a MOUSE WHEEL zooms (to cursor, via ReactFlow's
  //     zoomOnScroll); a TRACKPAD two-finger scroll PANS. ReactFlow can't tell
  //     them apart from props, so we detect the trackpad-pan gesture here and pan
  //     manually, letting a real mouse wheel fall through to ReactFlow's zoom.
  //     No modifier key is needed for either. `ctrlKey` (set by the OS for a
  //     trackpad PINCH) always means zoom → let it through.
  //
  //     DISCRIMINATOR (the reliable one — the old `deltaMode===0 && |deltaY|<40`
  //     was wrong: modern mice, especially on macOS/smooth-scroll, emit PIXEL
  //     mode with small per-notch deltas, so a normal wheel notch was misread as
  //     a trackpad pan → it panned a little and only zoomed on a hard flick).
  //     A single event can't perfectly separate the two, so we key on delta SHAPE
  //     and remember the recent gesture:
  //       • deltaMode ≠ 0 (line/page)                       → WHEEL  (zoom)
  //       • horizontal component (deltaX ≠ 0)               → TRACKPAD (pan)
  //       • fractional deltaY (deltaY % 1 ≠ 0)              → TRACKPAD (pan)
  //       • otherwise a clean integer vertical pixel tick   → WHEEL  (zoom)
  //     A trackpad's momentum tail degrades to integer, deltaX=0 frames; a short
  //     recent-gesture memory (~200ms) keeps it panning through that tail so it
  //     doesn't flip to zoom mid-flick (and symmetrically keeps a wheel zooming).
  //
  //     Attached as a NATIVE listener with { passive: false } — React's synthetic
  //     onWheel is passive, so calling preventDefault() there is a no-op and
  //     floods the console ("Unable to preventDefault inside passive event
  //     listener"). A native non-passive listener actually prevents the default
  //     scroll AND is silent. Refs keep the handler stable (no re-add per frame).
  const wheelDeps = useRef({ getViewport, setViewport });
  wheelDeps.current = { getViewport, setViewport };
  useEffect(() => {
    // Attach to the PANE (the ReactFlow surface), NOT the whole wrapper — the
    // wrapper also contains the left library palette and docked panels, and a
    // capture listener there swallowed THEIR wheel events so those panels could
    // no longer scroll (the wheel was read as a canvas pan/zoom). Scoped to the
    // pane, the canvas owns wheel-to-zoom/pan and every panel keeps native scroll.
    const el = paneRef.current;
    if (!el) return;
    // Recent-gesture memory: which device the last few wheel events looked like,
    // and when — so an ambiguous frame (integer, deltaX=0) inherits the ongoing
    // gesture instead of flipping mode. Reset after a short idle gap.
    let lastKind: "trackpad" | "wheel" | null = null;
    let lastAt = 0;
    const MEMORY_MS = 200;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom (OS sets ctrlKey) → ReactFlow zooms
      // Don't hijack a wheel over an OVERLAY surface (logo/icon picker modal); it
      // tags itself [data-arch-overlay] and owns its own scroll.
      if ((e.target as Element | null)?.closest?.("[data-arch-overlay]")) return;
      const { deltaX, deltaY, deltaMode } = e;
      const now = e.timeStamp || performance.now();
      const fresh = now - lastAt < MEMORY_MS;
      // DEFAULT IS ZOOM. A mouse wheel is the common case and should zoom-to-cursor
      // with NO modifier — so treat a vertical scroll as a wheel (zoom) unless we
      // have positive evidence it's a trackpad PAN. The only reliable trackpad
      // signal in a single event is a HORIZONTAL component (deltaX ≠ 0) — a
      // two-finger pan moves in x; a mouse wheel never does. (Fractional deltaY is
      // NOT a reliable trackpad tell: modern mice smooth-scroll fractionally too,
      // and keying on it misread a normal wheel as a pan — the regression here.)
      // A short recent-gesture memory keeps a trackpad's momentum tail (which
      // decays to deltaX=0 frames) panning instead of flipping to zoom mid-flick.
      let kind: "trackpad" | "wheel";
      if (Math.abs(deltaX) > 0) {
        kind = "trackpad"; // horizontal movement → trackpad two-finger pan
      } else if (fresh && lastKind === "trackpad") {
        kind = "trackpad"; // vertical tail of an in-progress trackpad pan
      } else {
        kind = "wheel"; // vertical-only → mouse wheel → zoom to cursor (default)
      }
      void deltaMode;
      lastKind = kind;
      lastAt = now;
      if (kind === "wheel") return; // → ReactFlow's zoom-to-cursor
      e.preventDefault();
      e.stopPropagation();
      const { getViewport: gv, setViewport: sv } = wheelDeps.current;
      const vp = gv();
      sv({ x: vp.x - deltaX, y: vp.y - deltaY, zoom: vp.zoom });
    };
    // capture + non-passive: runs before ReactFlow's own wheel handling and can
    // actually preventDefault the page/RF scroll.
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, []);

  // --- READ-ONLY previews only: re-fit when the container gains real size. The
  //     built-in `fitView` prop runs at mount, but a preview mounted inside a
  //     STILL-ANIMATING sheet/slide-over (the template gallery) measures a
  //     0/tiny container and frames wrong. A ResizeObserver re-fits once the
  //     container settles. Scoped to readOnly so it never fights an editing
  //     user's manual zoom/pan on a normal window resize — the workspace path
  //     is already correctly sized at mount and needs none of this. -------------
  const initialized = useNodesInitialized();
  const lastFitSize = useRef<string>("");
  useEffect(() => {
    if (!readOnly) return;
    const el = wrapRef.current;
    if (!el || !initialized) return;
    const refit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w < 2 || h < 2) return; // not laid out yet
      const key = `${w}x${h}`;
      if (key === lastFitSize.current) return; // size unchanged → skip
      lastFitSize.current = key;
      // rAF so the fit runs after the browser has committed the new layout.
      // Same maxZoom cap as the initial fit so a sparse preview doesn't over-zoom.
      requestAnimationFrame(() => fitView({ duration: 0, ...FIT_VIEW_OPTIONS }));
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [readOnly, initialized, fitView]);

  // "Copy style → paste onto others" mode. While `copiedStyle` is set, a banner
  // shows and clicking any node applies the style instead of selecting it
  // (until Esc). Refs let the stable onSelect read these without re-creating it.
  const [copiedStyle, setCopiedStyle] = useState<StylePatch | null>(null);
  const copiedStyleRef = useRef<StylePatch | null>(null);
  copiedStyleRef.current = copiedStyle;
  const styleNodesRef = useRef<((ids: string[], patch: StylePatch) => void) | null>(null);

  // In-memory clipboard for Ctrl/Cmd+C copy of one or more nodes. Stores a deep
  // snapshot of each copied node (type/data/size + position) so paste can clone
  // them as fresh nodes. A ref (not state) — pasting reads it imperatively from
  // the keydown handler and nothing renders off it.
  const clipboardRef = useRef<Node[] | null>(null);

  // Live editMode mirror so the stable onSelect can check the mode without
  // re-creating (which would churn every node's data identity).
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const onSelect = useCallback((id: string) => {
    // In paste mode, a click pastes the copied style onto the node (and stays
    // in paste mode for more pastes) instead of selecting it.
    if (copiedStyleRef.current) {
      styleNodesRef.current?.([id], copiedStyleRef.current);
      return;
    }
    // selectedId only drives the VIEW-mode DetailPanel. In edit mode, setting
    // it changes nothing visible but still lands as a separate full-Canvas
    // commit on every click (after RF's own selection commit) — one of the
    // sequential renders behind the click latency. Skip it entirely.
    if (editModeRef.current) return;
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);

  const onContext = useCallback((id: string, x: number, y: number) => {
    setMenu({ kind: "node", id, x, y });
  }, []);

  // The three "patch a node's data + schedule a save" reducers (onResize,
  // onRename, onAnnotate). They're baked into each node by schemaToFlow (inside
  // the `initial` memo below), which runs BEFORE useNodesState/scheduleSave
  // exist — so they must be stable + defined here. The hook owns the
  // setNodes/scheduleSave/edges refs internally (kept live via `bind` once those
  // values exist), which is what used to be Canvas's setNodesRef/scheduleSaveRef/
  // edgesRef trio.
  const { onResize, onRename, onSetDescription, onAnnotate, onAnnotateResize, onAutoHeight, bind: bindNodeMutations } = useNodeMutations();

  const initial = useMemo(
    () => schemaToFlow(schema, deepLinks, onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate, onAutoHeight),
    // Rebuild only when schema identity changes (not on every selection).
    [schema, deepLinks, onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate, onAutoHeight],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  // Live mirror of `nodes` so geometry helpers (nodeRect/nodeAt/portsOf) can be
  // STABLE callbacks instead of re-created every drag frame. A new identity for
  // those would churn `edgeOps` (the EdgeOpsContext value) on every frame and
  // re-render every FlowEdge consuming it. Reading via the ref keeps them at [].
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  // Catalog id→component map, rebuilt only when the schema changes (not on every
  // render/drag frame). componentLookup allocates a fresh Map each call, so the
  // render-path lookups below would otherwise re-scan the whole catalog per frame.
  const catalog = useMemo(() => componentLookup(schema), [schema]);
  // RAW global-catalog lookup (no per-demo overrides) — used when ADDING a
  // component from the palette so the dropped node carries the canonical
  // label/desc the menu showed, not a demo's relabel (e.g. "AI/BI Genie").
  // Existing on-canvas nodes still render from `catalog` (the demo's copy).
  const rawCatalog = useMemo(() => {
    const m = new Map<string, { component: PlatformComponent; bandId: BandId }>();
    catalogBands().forEach((b) =>
      b.components.forEach((c) => m.set(c.id, { component: { ...c, state: "active" }, bandId: b.id })),
    );
    return m;
  }, []);

  // Undo/redo + burst machinery lives in this hook. It returns beginBurst/
  // endBurst (consumed by scheduleSave below) and resetHistory (consumed by the
  // re-seed effect) — eliminating the old beginBurstRef/endBurstRef/
  // resetHistoryRef use-before-define hacks. scheduleSave is registered back
  // into the hook (setScheduleSave) once it's defined, since restore needs it.
  const { beginBurst, endBurst, resetHistory, rebaseHistory, undo, redo, canUndo, canRedo, setScheduleSave } =
    useDiagramHistory({ nodes, edges, setNodes, setEdges });

  // Re-seed the graph when the underlying schema changes. useNodesState/
  // useEdgesState only take `initial` ONCE, so without this the canvas keeps
  // the auto-seeded graph it mounted with and never picks up architecture.md
  // once it finishes loading (the file's saved nodes/edges were being ignored).
  // Guarded so it only fires on a real schema-identity change, not on drags.
  const seededFrom = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  useEffect(() => {
    if (seededFrom.current === initial) return;
    const prev = seededFrom.current;
    seededFrom.current = initial;
    // Carry the CURRENT selection (by id) onto the reseeded nodes — a reseed
    // rebuilds the node array, which would otherwise drop `selected` and deselect
    // whatever the user just added/clicked (the "new box flashes deselected" bug).
    const selectedNow = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
    setNodes(selectedNow.size
      ? initial.nodes.map((n) => (selectedNow.has(n.id) ? { ...n, selected: true } : n))
      : initial.nodes);
    setEdges(initial.edges);
    // History handling on a reseed:
    //   • SAME logical document (same node+edge id-set) — e.g. a save round-trip
    //     that only re-laid-out relative siblings, or a re-parse of our own echo:
    //     REBASE the baseline but KEEP the undo/redo stack, so the user doesn't
    //     lose their history just because a save reflowed the diagram.
    //   • DIFFERENT id-set (fresh open, agent takeover, restore, structural load):
    //     RESET — it's genuinely a new document, old history no longer applies.
    const sameGraph =
      !!prev &&
      sameIdSet(prev.nodes, initial.nodes) &&
      sameIdSet(prev.edges, initial.edges);
    if (sameGraph) rebaseHistory(initial.nodes, initial.edges);
    else resetHistory();
  }, [initial, setNodes, setEdges, resetHistory, rebaseHistory]);

  // NOTE: selection + edit mode are NOT written into node.data — selection
  // comes from ReactFlow's `selected` NodeProp, edit mode from EditModeContext,
  // and draggability from the <ReactFlow nodesDraggable> prop. That keeps node
  // data identities stable across selection/mode changes so React.memo holds.

  // Collab interaction-gate backstop: a drag/resize ALWAYS ends with a pointer
  // release, but a specific terminal NodeChange (dragging:false / resizing:false)
  // can be missed (pointer released off-canvas, group-resize's own pointer path,
  // a dropped final frame). A window pointerup/cancel guarantees the gate closes
  // and deferred peer ops flush — so it can never stick open and freeze remotes.
  useEffect(() => {
    if (!interactingRefProp) return; // collab off → no gate to manage
    const done = () => endInteraction();
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
    return () => {
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
  }, [interactingRefProp, endInteraction]);

  // Esc exits "paste style" mode.
  useEffect(() => {
    if (!copiedStyle) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCopiedStyle(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copiedStyle]);

  // Edit-mode keyboard: Ctrl/Cmd+C copies the selected node(s), Ctrl/Cmd+V
  // pastes them, Escape clears the selection (closing the edit panel). Skipped
  // while typing into an input/textarea/contenteditable so we never hijack the
  // browser's own copy/paste in a text field. copySelection/pasteClipboard/
  // clearSelection are read via refs so this effect doesn't re-bind on every
  // render (and isn't subject to use-before-define on those callbacks).
  const editKeyHandlersRef = useRef({
    copySelection: () => {},
    pasteClipboard: () => {},
    clearSelection: () => {},
    nudge: (_ux: number, _uy: number, _snap: boolean) => {},
    // Right-menu actions, also driven by shortcuts (Figma/Lucid convention).
    group: () => {},
    ungroup: () => {},
    bringToFront: () => {},
    sendToBack: () => {},
    duplicate: () => {},
    rotate: () => {},
    remove: () => {},
  });
  useEffect(() => {
    if (!editMode) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const ARROWS: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If a connection is being DRAWN (dragging out of a handle), Escape
        // cancels the pending line instead of clearing the selection. RF's own
        // connection state lives on the store; cancelConnection() aborts it so
        // the next pointerup won't create an edge.
        const st = rfStore.getState() as { connection?: { inProgress?: boolean }; cancelConnection?: () => void };
        if (st.connection?.inProgress) { st.cancelConnection?.(); return; }
        editKeyHandlersRef.current.clearSelection();
        return;
      }
      if (isTyping()) return;
      const H = editKeyHandlersRef.current;
      // ⌘⇧↑ / ⌘⇧↓ = bring-to-front / send-to-back (Keynote/Sketch convention).
      // Caught BEFORE the plain-arrow nudge since Cmd+arrow must not move.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.key === "ArrowUp" ? H.bringToFront() : H.sendToBack();
        return;
      }
      // Plain arrow = step a grid cell and snap to the 16px grid (magnet).
      // Shift+arrow = exact 1px move for fine positioning. (No modifier here —
      // Cmd/Ctrl+arrow fell through above.)
      if (ARROWS[e.key] && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const [ux, uy] = ARROWS[e.key];
        editKeyHandlersRef.current.nudge(ux, uy, !e.shiftKey);
        return;
      }
      // Delete / Backspace → remove the selection (no modifier). ReactFlow's own
      // delete is off; we route through removeNode so edges + history stay right.
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); H.remove(); return; }
      // R (no modifier) → rotate the primary selected node 90°.
      if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); H.rotate(); return; }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      // Figma/Lucid-standard modifier shortcuts. e.key for the bracket keys is
      // "]"/"[" regardless of layout; group/dup/undo use letters.
      if (k === "c") { H.copySelection(); }
      else if (k === "v") { e.preventDefault(); H.pasteClipboard(); }
      else if (k === "d") { e.preventDefault(); H.duplicate(); }
      else if (k === "g") { e.preventDefault(); e.shiftKey ? H.ungroup() : H.group(); }
      // NOTE: ⌘Z / ⇧⌘Z / ⌘Y are bound by useDiagramHistory's own keydown —
      // binding them here too made every undo/redo fire TWICE per press.
      else if (e.key === "]") { e.preventDefault(); H.bringToFront(); }
      else if (e.key === "[") { e.preventDefault(); H.sendToBack(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode]);

  // --- Persistence: persist the layout as it changes -----------------------
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fast broadcast throttle: `onPersist` writes to the shared store (Yjs doc),
  // which broadcasts to peers. We want that to feel INSTANT — a peer shouldn't
  // wait for the history-burst debounce (that made remote edits lag ~700ms). So
  // persist on a short ~50ms throttle (coalesces a fast drag's per-pixel frames
  // into a smooth stream without thrashing), and keep the 700ms timer ONLY for
  // ending the undo/redo history burst. The DURABLE architecture.md save is
  // debounced separately downstream (use-arch-doc's writer snapshot), so a
  // frequent doc write here is cheap (tiny CRDT deltas), not a file write.
  const fastPersist = useRef(0);
  const fastPending = useRef<{ nds: Node[]; eds: Edge[] } | null>(null);
  const fastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback((nds: Node[], eds: Edge[]) => {
    // History = ONE entry per logical action (burst): push the pre-burst baseline
    // at burst START (timer not pending), snapshot the FINAL state at burst END.
    if (!saveTimer.current) beginBurst();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      endBurst(nds, eds);
      saveTimer.current = null; // burst ended → next change starts a new burst
    }, 700);
    // Near-instant persist (broadcast). Trailing-throttle at ~50ms so a fast drag
    // coalesces and the final frame always lands.
    //
    // CRITICAL: the flush is ALWAYS scheduled on a timer, NEVER run synchronously
    // here. scheduleSave is frequently called from INSIDE a setNodes/setEdges
    // updater (e.g. removeEdge/removeNode), which React runs DURING RENDER. A
    // synchronous flush → persistTab → ydoc.transact → the doc observer's
    // setTabBodies would be "setState in PlatformDiagram while rendering Canvas"
    // (the React warning + a real cross-component render hazard). Deferring to a
    // timer runs the persist AFTER the current render/commit — safe.
    const FAST_MS = 50;
    const flush = () => {
      fastTimer.current = null;
      fastPersist.current = Date.now();
      const p = fastPending.current;
      if (p) { fastPending.current = null; persistRef.current(flowToLayout(p.nds, p.eds, schema)); }
    };
    fastPending.current = { nds, eds };
    if (fastTimer.current) return; // a flush is already scheduled; it'll pick up the latest pending
    const since = Date.now() - fastPersist.current;
    fastTimer.current = setTimeout(flush, Math.max(0, FAST_MS - since));
  }, [schema, beginBurst, endBurst]);
  // Keep the node-mutation reducers (onResize/onRename/onAnnotate) pointed at the
  // live setNodes/scheduleSave/edges now that those exist.
  bindNodeMutations({ setNodes, scheduleSave, edges });
  // Register the live scheduleSave back into the history hook so restore/undo/
  // redo reach the current closure (the hook is declared before scheduleSave).
  setScheduleSave(scheduleSave);

  // All edge reducers (retarget / toggle flow+dashed / shape / flow-style /
  // label / centerX / Bézier controls / remove). Declared here — before edgeOps — so setEdgeCenterX
  // exists in time for the EdgeOps context (no more setEdgeCenterXRef).
  const {
    toggleEdgeFlow, toggleEdgeDashed, setEdgeShape, setEdgeFlowStyle, setEdgeArrow,
    setEdgeLabel, setEdgeCenterX, setEdgeLabelPos, setEdgeBezier, setEdgeWaypoints, setEdgeControlPoints, removeEdge, retargetEdge,
  } = useEdgeMutations({ setEdges, scheduleSave, nodesRef });

  // FREEZE-ON-DRAG: dragging one node in a relative column used to re-stack its
  // symbolic siblings under it (computeLayout re-packs the lane), so the whole
  // column "jumped" mid-drag — surprising, since the user only grabbed one tile.
  // Fix: the instant a drag STARTS, pin the nodes that WOULD reflow because of it
  // (its column/anchor group — see relativeReflowGroup) to their CURRENT pixels.
  // They're now `at`, so computeLayout leaves them exactly where they sit and only
  // the dragged tile moves. Scoped to the dragged node's group (other columns keep
  // their auto-layout) and only on a real user drag (palette-drop still auto-places,
  // then freezes on its first drag like everything else). Fires once per drag.
  const handleNodeDragStart = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const group = relativeReflowGroup(nodesRef.current, node.id, schema.columns);
      if (!group.size) return; // nothing anchored to it → nothing would jump
      setNodes((nds) =>
        nds.map((n) =>
          group.has(n.id) && !(n.data as NodeData).pinned
            ? { ...n, data: { ...(n.data as NodeData), pinned: true } }
            : n,
        ),
      );
    },
    [setNodes, schema.columns],
  );

  // Wrap change handlers so a drag/add/remove triggers a save + history entry.
  // CRITICAL: a drag emits a `position` change on EVERY pixel (dragging:true)
  // and one final one on drop (dragging:false). We only commit on the FINAL
  // one (or on removal) — otherwise history fills with hundreds of micro-steps
  // per drag and undo barely moves.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Collab interaction gate: while a local drag/resize is IN FLIGHT, tell the
      // parent to defer peer ops (else a mid-interaction reseed flashes/janks the
      // move — see interactingRef in platform-diagram.tsx). A drag emits `position`
      // with dragging:true per frame then dragging:false on drop; a resize emits
      // `dimensions` with resizing:true then resizing:false on release. Open the
      // gate on either "in-progress" signal; close it (flushing deferred ops) on
      // either terminal signal or a remove.
      const inProgress = changes.some(
        (c) => (c.type === "position" && c.dragging === true) ||
               (c.type === "dimensions" && c.resizing === true),
      );
      if (inProgress) beginInteraction();
      const settled = changes.some(
        (c) => (c.type === "position" && c.dragging === false) ||
               (c.type === "dimensions" && c.resizing === false) ||
               c.type === "remove",
      );
      // Edge-based magnet: rewrite every position change (live drag frames AND
      // the drop) so the node's TOP-LEFT edge snaps to the 16px grid. Doing it
      // here (rather than via RF's snapToGrid, which snaps the CENTER because
      // nodeOrigin=[0.5,0.5]) both aligns the left/top edges of differently-
      // sized tiles AND keeps the magnet VISIBLE during the drag.
      //
      // BUT a RESIZE also emits `position` changes (RF moves the node's center
      // to keep the diagonal-opposite corner pinned while a size handle drags).
      // Those must NOT go through the top-left magnet: re-snapping the top-left
      // fights RF's opposite-corner pin (the far corner drifts) and, because the
      // node's committed w/h still lags a frame, recomputes the center against a
      // STALE size — so the box jumps on release. During a resize RF already
      // snaps the pointer to the grid via snapToGrid, so we let it own geometry
      // and skip the magnet for any node that's resizing in this same batch.
      const g = SNAP_GRID[0];
      const byId = nodesRef.current;
      const resizingIds = new Set(
        changes.flatMap((c) => (c.type === "dimensions" && c.resizing ? [c.id] : [])),
      );
      const snappedChanges = changes.map((c) => {
        if (c.type !== "position" || !c.position) return c;
        if (resizingIds.has(c.id)) return c; // resize repositioning — RF owns it
        const n = byId.find((x) => x.id === c.id);
        if (!n) return c;
        const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
        const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
        // Snap the TOP-LEFT edge to the grid. `position` is origin-relative
        // (center for the canvas default nodeOrigin), so offset by the node's
        // origin to get the top-left and back.
        const [ox, oy] = (n.origin as [number, number] | undefined) ?? NODE_ORIGIN;
        const left = Math.round((c.position.x - ox * w) / g) * g;
        const top = Math.round((c.position.y - oy * h) / g) * g;
        return { ...c, position: { x: left + ox * w, y: top + oy * h } };
      });
      onNodesChange(snappedChanges);
      // Commit (save + history) on the drop frame or a removal.
      const committed = changes.some(
        (c) => (c.type === "position" && c.dragging === false) || c.type === "remove",
      );
      if (committed) {
        // A finished DRAG pins the moved node to pixels: it should now serialize
        // as `at`, dropping any authored symbolic placement (col/alignY/below/…)
        // so its file stays honest, while UNTOUCHED nodes keep re-emitting their
        // symbolic fields (see NodePosition.pinned / serializeArchitecture).
        const dropped = new Set(
          changes.flatMap((c) => (c.type === "position" && c.dragging === false ? [c.id] : [])),
        );
        setNodes((nds) => {
          const pinnedNext = dropped.size
            ? nds.map((n) =>
                dropped.has(n.id) && !(n.data as NodeData).pinned
                  ? { ...n, data: { ...(n.data as NodeData), pinned: true } }
                  : n,
              )
            : nds;
          // INSTANT relative reflow: a moved node in a relative column makes the
          // symbolic (un-pinned) siblings re-stack. That reflow otherwise only
          // appeared AFTER the save round-trip (the lag). Recompute it LOCALLY now
          // — serialize → parse (runs computeLayout) → patch ONLY the siblings'
          // positions IN PLACE (node identities kept, so selection/undo survive;
          // the dropped node keeps its just-set pixel position). Best-effort: any
          // hiccup falls back to the (correct) round-trip reflow.
          const next = dropped.size ? reflowRelativeSiblings(pinnedNext, edges, schema, dropped) : pinnedNext;
          scheduleSave(next, edges);
          return next;
        });
      }
      // Interaction settled (drop / resize-release / remove) → close the gate and
      // let the parent replay any peer op it deferred during the move. Done AFTER
      // the local change is applied, so the deferred reseed can't race the commit.
      if (settled) endInteraction();
    },
    [onNodesChange, setNodes, scheduleSave, edges, schema, beginInteraction, endInteraction],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      // No self-loops.
      if (!params.source || !params.target || params.source === params.target) return;
      // A ported composite (Lakeflow / Lakeflow+Genie) only has the named input
      // ports (in-*) + r/t/b/bl — NOT the plain side handles t/r/b/l. If the
      // connection landed with such a phantom handle (e.g. "l"), ReactFlow can't
      // position the edge ("Couldn't create edge for handle id"). Snap it to a
      // real handle: a left/unknown target → the "direct" input port.
      const portedKinds = new Set(["lakeflow", "lakeflow-genie"]);
      const validHandle = (nid: string, handle: string | null | undefined, end: "source" | "target") => {
        const kind = (nodesRef.current.find((n) => n.id === nid)?.data as NodeData | undefined)?.component.kind;
        if (!kind || !portedKinds.has(kind)) return handle ?? undefined;
        if (handle && (handle.startsWith("in-") || ["r", "t", "b", "bl"].includes(handle))) return handle;
        // phantom / plain-side handle on a ported composite → snap to a port.
        return end === "target" ? "in-direct" : "r";
      };
      const sourceHandle = validHandle(params.source, params.sourceHandle, "source");
      const targetHandle = validHandle(params.target, params.targetHandle, "target");
      // Stable, collision-free id from the endpoint pair + HANDLES (NOT eds.length,
      // which repeats after a delete). Handle-aware so a composite with multiple
      // output ports (the medallion's out-gold / out-fs / out-mv) can fan several
      // DISTINCT edges to the SAME target — each handle pair is its own edge.
      const id = `e-${params.source}-${sourceHandle ?? ""}-${params.target}-${targetHandle ?? ""}`;
      setEdges((eds) => {
        // Dedup on the full handle-aware id, not just the (source,target) pair —
        // otherwise a 2nd port→same-target edge is silently dropped ("can't add
        // the 3rd connection"). Only an EXACT duplicate (same both handles) is a
        // no-op.
        if (eds.some((e) => e.id === id)) return eds;
        const next = addEdge(
          {
            ...params,
            sourceHandle,
            targetHandle,
            id,
            type: "flow",
            zIndex: EDGE_Z, // below nodes (EDGE_Z=0 < NODE_Z=1; see EDGE_Z docblock)
            data: { theme: schema.theme, labelFontSize: schema.edgeLabelSize, animated: true },
            style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: schema.theme === "slide" ? 0.65 : 0.55 },
            markerEnd: "url(#arrow)",
          },
          eds,
        );
        scheduleSave(nodes, next);
        return next;
      });
    },
    [setEdges, scheduleSave, nodes, schema.theme, schema.edgeLabelSize],
  );

  // Node footprint rect (flow coords) + hit-test, for the endpoint drag.
  // `node.position` is interpreted relative to the node's ORIGIN (canvas
  // default nodeOrigin=[0.5,0.5] → position == CENTER → top-left = pos - w/2).
  // Derive the top-left from the (per-node or default) origin so it's correct
  // regardless of a node overriding its origin.
  const topLeftOf = (n: Node, w: number, h: number): { x: number; y: number } => {
    const [ox, oy] = (n.origin as [number, number] | undefined) ?? NODE_ORIGIN;
    return { x: n.position.x - ox * w, y: n.position.y - oy * h };
  };
  const nodeRect = useCallback(
    (nid: string): Rect | null => {
      const n = nodesRef.current.find((x) => x.id === nid);
      if (!n) return null;
      const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
      const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
      const tl = topLeftOf(n, w, h);
      return { x: tl.x, y: tl.y, w, h };
    },
    [],
  );
  // Hit-test a flow-coord point against the nodes for the reconnect (endpoint
  // drag) snap. A MARGIN expands each node's rect so the endpoint catches when
  // the cursor is merely NEAR a box — matching how NEW-connection creation snaps
  // within `connectionRadius`, instead of requiring the cursor strictly INSIDE
  // the box (the old behaviour: "I have to go deep into each box for the magnet
  // to catch"). Among nodes within margin, prefer the TOPMOST (z), then the one
  // whose rect the cursor is closest to (so between two nearby boxes the nearer
  // wins). `margin` in FLOW units (24 ≈ the connection radius at 100% zoom).
  const nodeAt = useCallback(
    (fx: number, fy: number, margin = 24, exclude?: string): string | null => {
      let hit: string | null = null;
      let hitZ = -Infinity;
      let hitDist = Infinity;
      for (const n of nodesRef.current) {
        // Skip an excluded node (e.g. an edge's OTHER endpoint during reconnect)
        // so it can't shadow a different valid target that's also within margin.
        if (n.id === exclude) continue;
        const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
        const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
        const { x, y } = topLeftOf(n, w, h);
        // Distance from the point to the node RECT (0 if inside). Skip if farther
        // than the margin.
        const dx = Math.max(x - fx, 0, fx - (x + w));
        const dy = Math.max(y - fy, 0, fy - (y + h));
        const dist = Math.hypot(dx, dy);
        if (dist > margin) continue;
        const z = n.zIndex ?? 0;
        // Higher z wins; at equal z the nearer rect wins.
        if (z > hitZ || (z === hitZ && dist < hitDist)) { hit = n.id; hitZ = z; hitDist = dist; }
      }
      return hit;
    },
    [],
  );
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const setDropTarget = useCallback((nid: string | null) => setDropTargetId(nid), []);
  // A composite block's named ports as absolute flow-coord anchors so a RECONNECT
  // drag INTO the block snaps to (and targets) the RIGHT anchor, not just a single
  // side. UNIFIED with new-edge creation: both derive anchors from the block's
  // ACTUALLY-RENDERED handles. New-edge creation reads them implicitly (RF reports
  // the DOM handle under the cursor as params.targetHandle); reconnect reads RF's
  // MEASURED `handleBounds.source` here — the SAME source of truth. So any
  // composite whose handle set depends on its options (governance's per-surface
  // @acl/@ontology/@ai-gateway, the medallion's fork rows, lakeflow's in-* ports)
  // works for BOTH paths automatically, with no per-kind list to keep in sync.
  const portsOf = useCallback(
    (nid: string): { handle: string; x: number; y: number }[] => {
      const n = nodesRef.current.find((x) => x.id === nid);
      const kind = (n?.data as NodeData | undefined)?.component.kind;
      const r = nodeRect(nid);
      if (!n || !r || !kind) return []; // only composites have named ports
      // Every ConnectionDot renders a `type="source"` handle, so ALL of a block's
      // anchors live in handleBounds.source. Read them as absolute flow coords.
      const internal = getInternalNode(nid) as
        | { internals?: { handleBounds?: { source?: { id?: string | null; x: number; y: number; width: number; height: number }[] | null } | null } }
        | undefined;
      const src = internal?.internals?.handleBounds?.source ?? [];
      const measured = src
        .filter((h) => !!h.id)
        .map((h) => ({ handle: h.id as string, x: r.x + h.x + h.width / 2, y: r.y + h.y + h.height / 2 }));
      if (measured.length) return measured;
      // Not measured yet (block just mounted): fall back to lakeflow's computed
      // input ports so an immediate reconnect still snaps sensibly.
      if (kind === "lakeflow") {
        return [
          ...LF_PORTS.map((p) => ({ handle: `in-${p.port}`, x: r.x, y: r.y + r.h * p.frac })),
          { handle: "bl", x: r.x + r.w * 0.08, y: r.y + r.h },
        ];
      }
      return [];
    },
    [nodeRect, getInternalNode],
  );
  const edgeOps = useMemo<EdgeOps>(
    () => ({
      editMode, retarget: retargetEdge, nodeAt, rectOf: nodeRect, setDropTarget, portsOf,
      toFlow: (cx: number, cy: number) => screenToFlowPosition({ x: cx, y: cy }),
      setEdgeCenterX, setEdgeBezier, setEdgeWaypoints, setEdgeControlPoints, setEdgeLabel, setEdgeLabelPos,
    }),
    [editMode, retargetEdge, nodeAt, nodeRect, setDropTarget, portsOf, screenToFlowPosition, setEdgeCenterX, setEdgeBezier, setEdgeWaypoints, setEdgeControlPoints, setEdgeLabel, setEdgeLabelPos],
  );

  // --- Add from library (drop or double-click) ------------------------------
  const addComponent = useCallback(
    (componentId: string, at?: { x: number; y: number }) => {
      const found = rawCatalog.get(baseId(componentId));
      if (!found) return;
      const pos = at ?? { x: 120, y: 120 };
      setNodes((nds) => {
        // Same component can be placed more than once: mint a collision-free
        // instance id (bare base, else base#<rand> — random so concurrent adds by
        // two collaborators don't both compute the same #N and clobber).
        const base = baseId(componentId);
        const nodeId = mintInstanceId(base, (id) => nds.some((n) => n.id === id));
        const themed = naturalSize(base);
        const fp = nodeFootprint(found.component, { w: themed.w, h: themed.h });
        // A freshly-added node becomes THE selection (deselect the rest) so its
        // edit panel opens right away. onSelectionChange syncs selectedIds.
        const next = [
          ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
          {
            id: nodeId,
            type: nodeTypeFor(found.component),
            position: pos,
            width: fp.w,
            height: fp.h,
            style: { width: fp.w, height: fp.h },
            selected: true,
            data: {
              nodeId,
              type: base,
              theme: schema.theme,
              component: found.component,
              bandId: found.bandId,
              bandColor: BAND_COLOR[found.bandId],
              deepLink: deepLinks[base] ?? null,
              onSelect,
              onContext,
              onResize,
              onRename,
              onSetDescription,
              rot: 0,
            } satisfies NodeData,
          } as Node,
        ];
        scheduleSave(next, edges);
        return next;
      });
    },
    [rawCatalog, deepLinks, onSelect, onContext, onResize, onRename, onSetDescription, schema.theme, setNodes, scheduleSave, edges],
  );

  // Add a free-form annotation node (text / box / logo / image / callout).
  // Returns the new node id so callers can act on it (e.g. open the logo picker).
  const annoCounter = useRef(0);
  // The next free step number for a dropped callout: one past the highest number
  // already on the canvas, so numbering continues instead of repeating "1".
  const nextCalloutNumber = useCallback(() => {
    let max = 0;
    for (const n of nodesRef.current) {
      const a = (n.data as Partial<AnnotationNodeData>).annotation;
      if (a?.variant !== "callout") continue;
      const v = parseInt((a.text ?? "").replace(/\D+/g, ""), 10);
      if (Number.isFinite(v)) max = Math.max(max, v);
    }
    return max + 1;
  }, []);
  const addAnnotation = useCallback(
    (variant: AnnotationVariant, at?: { x: number; y: number }, extra?: Partial<AnnotationData>, dataExtra?: Partial<NodeData>): string => {
      const pos = at ?? { x: 160, y: 160 };
      const themeFont = schema.theme === "slide" ? 18 : 16;
      const defaults: AnnotationData =
        variant === "box" ? { variant, text: "", vAlign: "middle", hAlign: "center", fontSize: themeFont }
        : variant === "text" ? { variant, text: "", fontSize: themeFont }
        : variant === "card" ? { variant, title: "Title", body: `<p style="font-weight:700">One-line summary</p><p>Description, two or three lines.</p>` }
        : variant === "html" ? { variant, html: HTML_BLOCK_STARTER }
        : variant === "logo" ? { variant, icon: "data" }
        // A step callout: next number in sequence, sized/coloured by the render
        // (fontSize is left UNSET so the digit tracks the circle when resized).
        : variant === "callout" ? { variant, text: String(nextCalloutNumber()), bold: true }
        // A flow step: empty label (the drop auto-focuses it), centred text. The
        // KIND comes from `extra` — the palette passes which symbol was dragged.
        : variant === "shape" ? { variant, shape: DEFAULT_SHAPE_KIND, text: "", vAlign: "middle", hAlign: "center", fontSize: themeFont }
        : { variant }; // image — src set via menu/paste
      const annotation = { ...defaults, ...extra };
      annoCounter.current += 1;
      const id = `anno-${variant}-${Date.now().toString(36)}-${annoCounter.current}`;
      setNodes((nds) => {
        // A positioned-caption logo (Catalog/Schema/Table) sizes to its content
        // at ADD time (canvas measureText — synchronous), since the auto-fit
        // effect deliberately skips mount to respect manual/persisted sizes.
        const cap = annotation.caption === "side" ? "right" : annotation.caption === "below" ? "bottom" : annotation.caption;
        const positionedLogo = variant === "logo" && (cap === "right" || cap === "left" || cap === "top" || cap === "bottom");
        // Size a captioned logo to its full icon+caption footprint (same
        // `logoFootprint` the render + layout use) so the box wraps the centered
        // unit and the add-time box matches what a reload derives.
        // A card is measured from its own text (same cardLayout flow-mapping uses).
        const sz = positionedLogo
          ? logoFootprint(ANNOTATION_DEFAULT_SIZE.logo.w, ANNOTATION_DEFAULT_SIZE.logo.h, annotation)
          : variant === "card" ? cardLayout(annotation)
          : variant === "html" ? htmlBlockLayout(annotation.html, undefined, annotation.padding ?? 0)
          : ANNOTATION_DEFAULT_SIZE[variant];
        const next = [
          // Deselect the rest; the new annotation is THE selection so its edit
          // panel opens right away (onSelectionChange syncs selectedIds).
          ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
          {
            id,
            type: "annotation",
            position: pos,
            width: sz.w,
            height: sz.h,
            style: { width: sz.w, height: sz.h },
            // Front layer + selected on add. Without an explicit zIndex a fresh
            // node renders below the NODE_Z tiles (looked like it "dropped behind
            // everything" until the save round-trip re-seeded it at NODE_Z).
            zIndex: NODE_Z,
            selected: true,
            data: {
              nodeId: id,
              type: annotation.variant,
              theme: schema.theme,
              annotation,
              // Carry w/h into data so RotatableCard renders at the SAME size as
              // the ReactFlow node box on add — otherwise the card falls back to
              // the default logo size (64×64) while the node box is 150×44, and
              // you see two mismatched selection boxes until a reload re-syncs.
              w: sz.w, h: sz.h,
              component: { id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent,
              bandId: "sources" as BandId,
              bandColor: "#64748b",
              deepLink: null,
              onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate,
              rot: 0,
              ...dataExtra,
            } satisfies AnnotationNodeData,
          } as Node,
        ];
        scheduleSave(next, edges);
        return next;
      });
      return id;
    },
    [onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate, schema.theme, setNodes, scheduleSave, edges],
  );

  // Ctrl/Cmd+V pastes an image as a centered image annotation. The hook takes
  // addAnnotation directly (no addAnnotationRef now that it's defined above).
  usePasteImage({ editMode, addAnnotation, screenToFlowPosition, wrapRef });

  // Add a NEW data source from the "+ more data sources" picker. The source is
  // NOT a catalog component — its key/icon persist in layout.nodes[id].source
  // (label comes from the unified logo catalog), and it round-trips via
  // buildLayout + schemaToFlow's source branch (no schema mutation, so the
  // re-seed effect won't clobber it). Which Lakeflow ingest port it feeds is set
  // later by the edge handle the user draws (`@in-zerobus` / `@in-direct` / …).
  const addSourceFromIcon = useCallback((iconKey: string) => {
    const key = iconKey.replace(/^file:.*\//, "").replace(/^file:/, "").toLowerCase();
    const id = `src-${key.replace(/[^a-z0-9]+/g, "-")}`;
    const component: PlatformComponent = {
      id, label: logoLabel(key), icon: iconKey, desc: "", state: "active",
    };
    setSourcePicker(false);
    setNodes((nds) => {
      if (nds.some((n) => n.id === id)) return nds;
      const themed = naturalSize("source");
      const fp = nodeFootprint(component, { w: themed.w, h: themed.h });
      const srcYs = nds.filter((n) => (n.data as NodeData).type === "source" || baseId(n.id).startsWith("src-")).map((n) => n.position.y);
      const y = srcYs.length ? Math.max(...srcYs) + 96 : 0;
      const next = [
        // Deselect the rest; the new source is THE selection → its edit panel
        // opens right away (onSelectionChange syncs selectedIds).
        ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        {
          id, type: "component", position: { x: 0, y }, width: fp.w, height: fp.h, style: { width: fp.w, height: fp.h },
          selected: true,
          data: {
            nodeId: id, type: "source", theme: schema.theme, component, bandId: "sources" as BandId, bandColor: BAND_COLOR.sources,
            deepLink: null, onSelect, onContext, onResize, onRename, onSetDescription,
            allowTrademark: !!schema.enableTrademarkLogos,
            sourceKey: key,
            rot: 0,
          } satisfies NodeData,
        } as Node,
      ];
      scheduleSave(next, edges);
      return next;
    });
  }, [onSelect, onContext, onResize, onRename, onSetDescription, schema.enableTrademarkLogos, schema.theme, setNodes, scheduleSave, edges]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const logoKey = e.dataTransfer.getData("application/x-logo");
      if (logoKey) { addAnnotation("logo", pos, { icon: logoKey }); return; }
      // A flowchart shape from the Process-flow list — drop it and land the
      // cursor in its label, like a text node.
      const shapeKind = e.dataTransfer.getData("application/x-shape");
      if (shapeKind) {
        const id = addAnnotation("shape", pos, { shape: shapeKind as ShapeKind });
        setAutoEditFor(id);
        return;
      }
      const sourceKey = e.dataTransfer.getData("application/x-source");
      if (sourceKey) { addSourceFromIcon(sourceKey); return; }
      const anno = e.dataTransfer.getData("application/x-annotation");
      if (anno) {
        const id = addAnnotation(anno as AnnotationVariant, pos);
        if (anno === "logo") setLogoPickerFor(id); // pick the logo right away
        else if (anno === "text" || anno === "note") setAutoEditFor(id); // cursor into the text now
        return;
      }
      const preset = e.dataTransfer.getData("application/x-annotation-preset");
      if (preset) {
        const p = DBX_ARCH_PRESET_BY_ID[preset];
        if (p) addAnnotation(p.variant ?? "box", pos, p.annotation);
        return;
      }
      const id = e.dataTransfer.getData("application/x-component-id");
      if (!id) return;
      addComponent(id, pos);
    },
    [addComponent, addAnnotation, addSourceFromIcon, screenToFlowPosition],
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
      const next = nds.map((n) => {
        if (!idset.has(n.id)) return n;
        const dd = n.data as NodeData;
        // A pasted sourceCaption must snap the box the same way the panel
        // control does (vertical caption → taller box), so a top/bottom label
        // doesn't clip — unless this node was manually resized (w/h set).
        let sized = {};
        if (patch.sourceCaption !== undefined && dd.w === undefined && dd.h === undefined) {
          const vertical = patch.sourceCaption === "top" || patch.sourceCaption === "bottom";
          const size = vertical ? verticalSourceSize() : baseSize(dd.component);
          sized = { width: size.w, height: size.h, style: { ...n.style, width: size.w, height: size.h } };
        }
        return { ...n, ...sized, data: { ...dd, ...patch } };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);
  styleNodesRef.current = styleNodes; // for paste-style mode (stable onSelect)

  // --- Grouping: just a shared groupId tag on the members (no container) ----
  // Group: stamp a fresh groupId on the selected nodes. Selecting any member
  // then selects the whole group (see selectGroup) so they move together.
  const groupCounter = useRef(0);
  const groupNodes = useCallback((ids: string[]) => {
    if (ids.length < 2) return;
    const gid = `group-${Date.now().toString(36)}-${groupCounter.current++}`;
    const idset = new Set(ids);
    setNodes((nds) => {
      const next = nds.map((n) => (idset.has(n.id) ? { ...n, data: { ...n.data, groupId: gid } } : n));
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Ungroup: clear groupId from every member of the clicked node's group.
  const ungroupNode = useCallback((id: string) => {
    setNodes((nds) => {
      const gid = (nds.find((n) => n.id === id)?.data as NodeData | undefined)?.groupId;
      if (!gid) return nds;
      const next = nds.map((n) =>
        (n.data as NodeData).groupId === gid ? { ...n, data: { ...n.data, groupId: undefined } } : n,
      );
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Selecting one group member selects the whole group (so a drag moves them
  // together). Called from onNodeClick. Refs so the stable handler can reach it.
  const selectGroup = useCallback((gid: string) => {
    // Identity-preserving: only clone nodes whose `selected` actually flips —
    // a fresh object for every node busts every node's React.memo on each
    // grouped-node click.
    setNodes((nds) => nds.map((n) => {
      const want = (n.data as NodeData).groupId === gid;
      return (n.selected ?? false) === want ? n : { ...n, selected: want };
    }));
  }, [setNodes]);
  const selectGroupRef = useRef(selectGroup);
  selectGroupRef.current = selectGroup;

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
  // Scale a node: resize the whole box to natural-size × scale. RotatableCard
  // scales the content to fill whatever box size results (from this slider OR a
  // corner drag), so box + content always stay proportional.
  const setNodeScale = useCallback((id: string, scale: number) => {
    setNodes((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        // Params-aware natural size (un-rotated): a forked medallion is taller
        // than the base 268x96, so `baseSize` (params-unaware) would squish it.
        // nodeFootprint with no w/h + rot:0 routes the medallion through
        // medallionSize(params) — the single source used everywhere else.
        const rawNat = nodeFootprint(dd.component, { rot: 0, params: dd.params });
        const nat = rawNat;
        const cardW = Math.round(nat.w * scale);
        const cardH = Math.round(nat.h * scale);
        const fp = nodeFootprint(dd.component, { w: cardW, h: cardH, rot: dd.rot });
        return {
          ...n,
          width: fp.w, height: fp.h, style: { ...n.style, width: fp.w, height: fp.h },
          data: { ...dd, scale, w: cardW, h: cardH },
        };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Set the STACK count (N cards) for a node. Just patches data.stack (the stack
  // shadows are decorative + pointer-none, so no footprint change). 1 clears it.
  const setNodeStack = useCallback((id: string, stack: number) => {
    setNodes((nds) => {
      const next = nds.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data as NodeData), stack: stack > 1 ? stack : undefined } } : n,
      );
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Set a node's EXACT footprint + position from the panel's numeric fields.
  // `patch` is partial (one field at a time): w/h are the on-canvas FOOTPRINT,
  // x/y the box's TOP-LEFT in flow coords. Top-left is held fixed across a size
  // change (position is centre-relative, so it's re-derived from the new size) —
  // the Figma/Lucid convention, and it keeps the X/Y fields stable while you
  // type a width. A numeric edit is a deliberate manual placement, so it PINS
  // the node exactly like a drag-drop or an arrow nudge: it serializes as pixel
  // `at`/`size` and drops any authored symbolic placement, and the symbolic
  // siblings re-stack immediately (same local reflow as the drop frame).
  const setNodeGeometry = useCallback((id: string, patch: { x?: number; y?: number; w?: number; h?: number }) => {
    setNodes((nds) => {
      const target = nds.find((n) => n.id === id);
      if (!target) return nds;
      const dd0 = target.data as NodeData;
      const [ox, oy] = (target.origin as [number, number] | undefined) ?? NODE_ORIGIN;
      const curW = (target.width ?? target.measured?.width ?? dd0.w ?? 200) as number;
      const curH = (target.height ?? target.measured?.height ?? dd0.h ?? 56) as number;
      const w = Math.max(MIN_NODE_SIZE, Math.round(patch.w ?? curW));
      const h = Math.max(MIN_NODE_SIZE, Math.round(patch.h ?? curH));
      const left = Math.round(patch.x ?? target.position.x - ox * curW);
      const top = Math.round(patch.y ?? target.position.y - oy * curH);
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        // data.w/h are the CARD dims (un-rotated) — un-swap the footprint for a
        // 90/270° rotation, exactly like the resize-grip path (useNodeMutations).
        const q = (((dd.rot ?? 0) % 360) + 360) % 360;
        const swapped = q === 90 || q === 270;
        return {
          ...n,
          position: { x: left + ox * w, y: top + oy * h },
          width: w,
          height: h,
          style: { ...n.style, width: w, height: h },
          data: { ...dd, w: swapped ? h : w, h: swapped ? w : h, pinned: true },
        };
      });
      const reflowed = reflowRelativeSiblings(next, edges, schema, new Set([id]));
      scheduleSave(reflowed, edges);
      return reflowed;
    });
  }, [setNodes, scheduleSave, edges, schema]);

  // Set a SOURCE tile's label position (right/left/top/bottom) — mirrors the
  // logo caption option. Just patches node data + persists.
  const setSourceCaption = useCallback((id: string, pos: "right" | "left" | "top" | "bottom") => {
    setNodes((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        // The vertical (top/bottom) layout uses a taller/narrower box; the
        // horizontal one the default wide box. Snap the ReactFlow node box to
        // match so the selection frame + edge anchors track the caption change
        // — UNLESS the user resized this node (d.w/d.h set), which we respect.
        const vertical = pos === "top" || pos === "bottom";
        const size = dd.w === undefined && dd.h === undefined
          ? (vertical ? verticalSourceSize() : baseSize(dd.component))
          : null;
        return {
          ...n,
          ...(size ? { width: size.w, height: size.h, style: { ...n.style, width: size.w, height: size.h } } : {}),
          data: { ...dd, sourceCaption: pos },
        };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Source label font size (px). The card auto-fits to it (NodeCard reads
  // fontSize + re-fits on change), so no manual box resize needed here.
  const setSourceFontSize = useCallback((id: string, px: number) => {
    setNodes((nds) => {
      const next = nds.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data as NodeData), fontSize: px } } : n,
      );
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Toggle whether the description line is shown. Logos + sources store the flag
  // on the annotation / node data; catalog tiles store it on node data too
  // (their default-on is resolved in component-node.tsx, so an explicit false is
  // what turns it off).
  const setShowDescription = useCallback((id: string, show: boolean) => {
    setNodes((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData & { annotation?: AnnotationData };
        return dd.annotation
          ? { ...n, data: { ...dd, annotation: { ...dd.annotation, showDesc: show } } }
          : { ...n, data: { ...dd, showDesc: show } };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);

  // Toggle description WRAP (multi-line, box auto-grows) vs single-line truncate.
  // Flips the flag on the node; the box's new (taller) height is recomputed by
  // nodeFootprint on the save→reseed round-trip (same as showDesc's size change).
  const setWrapDescription = useCallback((id: string, wrap: boolean) => {
    setNodes((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        // Clear any stale measured height so the box re-measures for the new mode.
        return { ...n, data: { ...dd, wrapDesc: wrap, autoH: undefined } };
      });
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
    // The NEW type comes from the palette/picker → resolve from the raw catalog
    // (canonical label/desc), same as addComponent. The OLD node's component is
    // still read from `catalog` (the demo's copy) to detect a rename.
    const found = rawCatalog.get(baseId(newComponentId));
    if (!found) return;
    setNodes((nds) => {
      if (!nds.some((n) => n.id === id)) return nds;
      const dd = nds.find((n) => n.id === id)!.data as NodeData;
      const oldBase = catalog.get(dd.type)?.component;
      const renamed = oldBase && dd.component.label !== oldBase.label;
      // The node id stays STABLE — only its `type` + component swap. (Component
      // identity is `data.type`, not the id, so there's no id to re-mint and no
      // edge source/target to remap — edges stay attached by id.)
      const newType = found.component.id;
      const component = renamed ? { ...found.component, label: dd.component.label } : found.component;
      const raw = nodeFootprint(component, { w: dd.w, h: dd.h, rot: dd.rot });
      const fp = raw;
      const next = nds.map((n) =>
        n.id !== id
          ? n
          : {
              ...n,
              type: nodeTypeFor(component),
              width: fp.w,
              height: fp.h,
              style: { ...n.style, width: fp.w, height: fp.h },
              data: { ...dd, type: newType, component, bandId: found.bandId, bandColor: BAND_COLOR[found.bandId], deepLink: deepLinks[newType] ?? null },
            },
      );
      // The new type may have a different anchor set (e.g. a Lakeflow composite
      // has named ports `in-*`/`bl`, a plain tile only t/r/b/l). Keep each handle
      // when still valid; otherwise collapse it to the equivalent SIDE so the edge
      // stays attached rather than dangling on a missing handle. (No id remap —
      // the node id is unchanged.)
      const newHasPorts = component.kind === "lakeflow" || component.kind === "lakeflow-genie";
      setEdges((eds) => {
        const e2 = eds.map((e) => ({
          ...e,
          ...(e.source === id ? { sourceHandle: remapHandleForType(e.sourceHandle, newHasPorts) } : {}),
          ...(e.target === id ? { targetHandle: remapHandleForType(e.targetHandle, newHasPorts) } : {}),
        }));
        scheduleSave(next, e2);
        return e2;
      });
      return next;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [catalog, rawCatalog, deepLinks, setNodes, setEdges, scheduleSave]);

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

  // --- Copy / paste (Ctrl/Cmd+C / V) ---------------------------------------
  // Copy: snapshot the currently-selected nodes into the in-memory clipboard.
  const copySelection = useCallback(() => {
    const sel = nodesRef.current.filter((n) => n.selected);
    clipboardRef.current = sel.length
      ? sel.map((n) => ({ ...n, data: { ...(n.data as NodeData) } }))
      : null;
  }, []);

  // Paste: clone the clipboard nodes as NEW nodes with fresh unique ids, offset
  // ~24px, preserving type/data/style/size. A multi-paste gets a fresh shared
  // groupId; a single paste drops groupId. Edges *between* copied nodes are
  // recreated against the new ids. The pasted nodes become the new selection.
  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.length === 0) return;
    const OFF = 24;
    setNodes((nds) => {
      const taken = new Set(nds.map((n) => n.id));
      const idMap = new Map<string, string>(); // old id → new id
      const mkId = (oldId: string): string => {
        // Annotations get a fresh time+counter anno-* id (already collision-safe).
        // Others mint base / base#<rand> — random so a concurrent paste by a peer
        // can't compute the same #N and clobber on the shared doc.
        if (oldId.startsWith("anno-")) {
          const nid = `anno-${Date.now().toString(36)}-${annoCounter.current++}`;
          taken.add(nid);
          return nid;
        }
        const nid = mintInstanceId(baseId(oldId), (id) => taken.has(id));
        taken.add(nid);
        return nid;
      };
      const clones: Node[] = clip.map((src) => {
        const newId = mkId(src.id);
        idMap.set(src.id, newId);
        // Paste never creates a group — clear any groupId so pasted nodes
        // land as independent components.
        const d = { ...(src.data as NodeData), nodeId: newId, groupId: undefined };
        return {
          ...src,
          id: newId,
          position: { x: src.position.x + OFF, y: src.position.y + OFF },
          // Fresh nodes are the new selection; clear any dragging artifacts.
          selected: true,
          dragging: false,
          data: d,
        } as Node;
      });
      const next = nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(clones);
      // Recreate edges that ran BETWEEN copied nodes (both endpoints cloned).
      setEdges((eds) => {
        const within = eds.filter((e) => idMap.has(e.source) && idMap.has(e.target));
        if (within.length === 0) { scheduleSave(next, eds); return eds; }
        const add: Edge[] = within.map((e) => {
          const s = idMap.get(e.source)!, t = idMap.get(e.target)!;
          return {
            ...e,
            id: `e-${s}-${e.sourceHandle ?? ""}-${t}-${e.targetHandle ?? ""}-${Date.now().toString(36)}`,
            source: s,
            target: t,
            selected: false,
          } as Edge;
        });
        const e2 = [...eds, ...add];
        scheduleSave(next, e2);
        return e2;
      });
      return next;
    });
  }, [setNodes, setEdges, scheduleSave]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setMenu({ kind: "edge", id: edge.id, x: e.clientX, y: e.clientY });
  }, []);

  // Clicking a line opens its DOCKED edit panel (in edit mode). Clear any node
  // selection first so the edge panel (which shows only when no node is
  // selected) takes the docked slot.
  const onEdgeClick = useCallback((e: React.MouseEvent, edge: Edge) => {
    if (!editMode) return;
    e.stopPropagation();
    clearSelectionRef.current();
    setMenu({ kind: "edge", id: edge.id, x: e.clientX, y: e.clientY });
  }, [editMode]);

  // id → node map, rebuilt only when `nodes` changes. Turns the many O(n)
  // `nodes.find(...)` selection/panel lookups below into O(1) — they used to
  // run (each O(n)) on EVERY render, i.e. every drag frame.
  const nodesById = useMemo(() => {
    const m = new Map<string, Node>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Prefer the LIVE node's own component data (it carries the correct
  // label/desc — including for freshly-added nodes resolved from the raw
  // catalog) over a re-lookup by base id, which would miss per-instance copy.
  const selectedNodeData = selectedId ? (nodesById.get(selectedId)?.data as NodeData | undefined) : undefined;
  const selected = useMemo(() => {
    if (!selectedId) return null;
    if (selectedNodeData?.component && selectedNodeData.bandId) return { component: selectedNodeData.component, bandId: selectedNodeData.bandId };
    return (selectedNodeData?.type ? catalog.get(selectedNodeData.type) : undefined) ?? catalog.get(baseId(selectedId)) ?? null;
  }, [selectedId, selectedNodeData, catalog]);
  // Base ids of every placed instance — the library dims a catalog item when at
  // least one instance is on the canvas (but it stays draggable for duplicates).
  // TWO-STEP memo so the Set's IDENTITY only changes when MEMBERSHIP changes:
  // `nodes` gets a new array identity on every drag/resize frame and on every
  // selection commit, and a fresh Set each time busted the memo'd
  // LibraryPalette — re-rendering the entire catalog subtree per frame (the
  // main remaining resize/selection jank). The membership key is O(N) string
  // work per commit; the Set (and the palette) only rebuild on add/remove.
  const placedKey = useMemo(
    () => Array.from(new Set(nodes.map((n) => (n.data as NodeData).type))).sort().join(" "),
    [nodes],
  );
  const placedIds = useMemo(() => new Set(placedKey ? placedKey.split(" ") : []), [placedKey]);
  const menuEdge = menu?.kind === "edge" ? edges.find((e) => e.id === menu.id) : undefined;

  // --- Right-side EDIT PANEL state (driven by the SELECTION, not a menu) -----
  // The node options that used to live in the floating context menu now live in
  // a docked panel. Everything below is derived from `selectedIds` (the live
  // ReactFlow selection). Edges keep their own floating menu.
  // `panelPrimaryId` = the single node the panel's per-node controls (annotation,
  // scale, change-type, rotate) act on — the first selected node.
  const panelPrimaryId = selectedIds[0] as string | undefined;
  const panelPrimaryData = panelPrimaryId
    ? (nodesById.get(panelPrimaryId)?.data as NodeData | undefined)
    : undefined;
  // The selected node's annotation props, if it's a free-form annotation (single).
  const panelAnno = selectedIds.length === 1
    ? (panelPrimaryData as Partial<AnnotationNodeData> | undefined)?.annotation
    : undefined;
  // Style controls operate on every selected node at once.
  const styleTargets = selectedIds;
  // Grouping state. `isGroup`: the selected node already belongs to a group →
  // offer Ungroup. `canGroup`: 2+ nodes selected that aren't all already one
  // group → offer Group. groupTargets = the ids Group will stamp.
  const groupTargets = useMemo(() => (selectedIds.length > 1 ? selectedIds : EMPTY_IDS), [selectedIds]);
  const groupIdsInSel = new Set(groupTargets.map((id) => (nodesById.get(id)?.data as NodeData | undefined)?.groupId));
  // The whole multi-selection is exactly one existing group (every member shares
  // one defined groupId) → offer Ungroup, not Group.
  const selIsOneGroup = groupTargets.length > 1 && groupIdsInSel.size === 1 && !groupIdsInSel.has(undefined);
  // `isGroup` (offer Ungroup): a single grouped node or a whole-group selection.
  // (Databricks Agent explode was removed — it's a single composite, not a group.)
  const isGroup = (selectedIds.length === 1 && !!panelPrimaryData?.groupId) || selIsOneGroup;
  // Offer Group unless the selection is already exactly one existing group.
  const canGroup = groupTargets.length > 1 && !selIsOneGroup;
  // The (primary) selected node's style fields — drives the controls' current
  // values and is what "Copy style" captures. Memoized on the primitive fields
  // so its IDENTITY is stable across a drag (the dragged node's `data` object is
  // unchanged frame-to-frame) → the memo'd EditPanel doesn't re-render per frame.
  const ps = panelPrimaryData;
  const panelNodeStyle: StylePatch = useMemo(() => ({
    opacity: ps?.opacity,
    fillColor: ps?.fillColor,
    fontColor: ps?.fontColor,
    iconColor: ps?.iconColor,
    borderWidth: ps?.borderWidth,
    borderStyle: ps?.borderStyle,
    borderColor: ps?.borderColor,
    borderRadius: ps?.borderRadius,
    shadow: ps?.shadow,
    // Presentation, carried by copy-style too (ignored where inapplicable).
    sourceCaption: ps?.sourceCaption,
    fontSize: ps?.fontSize as number | undefined,
    showDesc: ps?.showDesc,
  }), [ps?.opacity, ps?.fillColor, ps?.fontColor, ps?.iconColor, ps?.borderWidth, ps?.borderStyle, ps?.borderColor, ps?.borderRadius, ps?.shadow, ps?.sourceCaption, ps?.fontSize, ps?.showDesc]);
  // Clear the live ReactFlow selection (closes the panel). Used by the panel's
  // X, the Escape key, and the pane click.
  const clearSelection = useCallback(() => {
    setNodes((nds) => nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds);
  }, [setNodes]);
  // Ref so the earlier-defined onEdgeClick can clear node selection without a
  // use-before-define dependency.
  const clearSelectionRef = useRef(clearSelection);
  clearSelectionRef.current = clearSelection;
  // Arrow-key nudge. `snap` true (plain arrow) → step a full grid cell and snap
  // the new position to the 16px grid (the magnet); `snap` false (Shift+arrow) →
  // an exact 1px move for fine positioning. Direct position write either way.
  const GRID = 16;
  const nudge = useCallback((ux: number, uy: number, snap: boolean) => {
    setNodes((nds) => {
      if (!nds.some((n) => n.selected)) return nds;
      // FREEZE-ON-NUDGE: same as drag-start (handleNodeDragStart). Before moving
      // the selection, pin every node that WOULD reflow because of it — the moved
      // nodes' column + every column to its right + relational dependents — to
      // their current pixels. Otherwise reflowRelativeSiblings re-stacks them
      // under the nudged tile and the neighbours "jump" on every arrow press,
      // exactly the surprise the drag path already fixes. Union the group over
      // the whole selection so a multi-select nudge freezes everything affected.
      const frozen = new Set<string>();
      for (const sel of nds) {
        if (!sel.selected) continue;
        for (const id of relativeReflowGroup(nds, sel.id, schema.columns)) frozen.add(id);
      }
      const next = nds.map((n) => {
        if (!n.selected) {
          return frozen.has(n.id) && !(n.data as NodeData).pinned
            ? { ...n, data: { ...(n.data as NodeData), pinned: true } }
            : n;
        }
        // A keyboard nudge is a deliberate reposition, exactly like a drag-drop —
        // PIN it so it serializes as pixel `at` and drops any authored symbolic
        // placement (col/below/alignY/…). Without this, a symbolically-placed
        // node's nudge is silently discarded on reload (computeLayout re-derives
        // the original spot). Mirrors handleNodesChange's drag-commit pinning.
        const dd = n.data as NodeData;
        const pinData = dd.pinned ? n.data : { ...dd, pinned: true };
        if (!snap) return { ...n, position: { x: n.position.x + ux, y: n.position.y + uy }, data: pinData };
        // Snap the TOP-LEFT edge to the grid (matching drag-drop), then step one
        // cell in the arrow direction. position is origin-relative (center by
        // default; top-left for origin:[0,0] text), so offset by the origin.
        const w = (n.width ?? dd.w ?? 200) as number;
        const h = (n.height ?? dd.h ?? 56) as number;
        const [ox, oy] = (n.origin as [number, number] | undefined) ?? NODE_ORIGIN;
        const left = Math.round((n.position.x - ox * w) / GRID) * GRID + ux * GRID;
        const top = Math.round((n.position.y - oy * h) / GRID) * GRID + uy * GRID;
        return { ...n, position: { x: left + ox * w, y: top + oy * h }, data: pinData };
      });
      // Same instant relative reflow as drag-drop: re-stack the symbolic siblings
      // (and re-size any wrapping box) locally so it doesn't lag the round-trip.
      const moved = new Set(nds.filter((n) => n.selected).map((n) => n.id));
      const reflowed = reflowRelativeSiblings(next, edges, schema, moved);
      scheduleSave(reflowed, edges);
      return reflowed;
    });
  }, [setNodes, scheduleSave, edges, schema]);

  // Group resize: apply scaled rects (top-left + size, flow coords) from the
  // multi-selection frame to each node — position (converted top-left → the
  // canvas's center origin), size (width/height/style/data.w/h), and PIN it
  // (a scaled node is now fixed-size, exactly like a single-node resize). Fires
  // live during the drag; scheduleSave coalesces it into one history burst.
  const onGroupScale = useCallback((next: GroupScale[]) => {
    beginInteraction(); // group resize runs its own pointer path; window pointerup closes the gate
    const byId = new Map(next.map((r) => [r.id, r]));
    setNodes((nds) => {
      const applied = nds.map((n) => {
        const r = byId.get(n.id);
        if (!r) return n;
        const dd = n.data as NodeData;
        const [ox, oy] = (n.origin as [number, number] | undefined) ?? NODE_ORIGIN;
        const w = Math.max(16, Math.round(r.w));
        const h = Math.max(16, Math.round(r.h));
        return {
          ...n,
          position: { x: r.x + ox * w, y: r.y + oy * h }, // top-left → origin-relative
          width: w,
          height: h,
          style: { ...n.style, width: w, height: h },
          data: { ...dd, w, h, pinned: true },
        };
      });
      scheduleSave(applied, edges);
      return applied;
    });
  }, [setNodes, scheduleSave, edges, beginInteraction]);
  // Keep the window keydown effect's handlers pointed at the live callbacks
  // (the effect binds once per editMode; refs let it reach the current closures).
  editKeyHandlersRef.current = {
    copySelection, pasteClipboard, clearSelection, nudge,
    group: () => { if (canGroup) groupNodes(groupTargets); },
    ungroup: () => { if (isGroup && panelPrimaryId) ungroupNode(panelPrimaryId); },
    bringToFront: () => { if (styleTargets.length) setNodeZ(styleTargets, "front"); },
    sendToBack: () => { if (styleTargets.length) setNodeZ(styleTargets, "back"); },
    // Duplicate = copy + paste in one step (the paste offsets +24 like Figma).
    duplicate: () => { if (selectedIds.length) { copySelection(); pasteClipboard(); } },
    rotate: () => { if (panelPrimaryId) rotateNode(panelPrimaryId); },
    // Delete/Backspace removes the current selection — NODES (selectedIds) AND
    // the selected EDGE(S). Edges track selection on the ReactFlow edge object
    // (edge.selected), separate from selectedIds (nodes only), OR the docked edge
    // panel targets menu.id — so a selected line pressed-Delete previously matched
    // NEITHER branch and silently did nothing (menu stayed open, nothing persisted,
    // edge back on refresh). Handle both, and route edges through removeEdge so
    // the deletion actually saves.
    remove: () => {
      // editKeyHandlersRef is reassigned every render, so `edges`/`menu` here are
      // the current-render values (no ref needed).
      const edgeIds = edges.filter((e) => e.selected).map((e) => e.id);
      // The docked edge menu is a selection too: if a line's edit panel is open,
      // its id is the delete target even when RF didn't flag `selected`.
      if (menu?.kind === "edge") edgeIds.push(menu.id);
      const nodeIds = [...selectedIds];
      if (!edgeIds.length && !nodeIds.length) return;
      clearSelection();
      setMenu(null);
      Array.from(new Set(edgeIds)).forEach(removeEdge);
      nodeIds.forEach(removeNode);
    },
  };

  // Memoized EditPanel handlers. The panel is `memo`'d; feeding it fresh inline
  // arrows every render (i.e. every drag frame, while dragging a SELECTED node)
  // defeated that. These are stable across a drag (selection doesn't change
  // mid-drag), so the panel skips re-render entirely while dragging.
  const panelOnRotate = useCallback(() => { if (panelPrimaryId) rotateNode(panelPrimaryId); }, [panelPrimaryId, rotateNode]);
  const panelOnRemove = useCallback(() => { const ids = [...selectedIds]; clearSelection(); ids.forEach(removeNode); }, [selectedIds, clearSelection, removeNode]);
  const panelOnChangeType = useCallback(() => { if (panelPrimaryId) { setPickingFor(panelPrimaryId); clearSelection(); } }, [panelPrimaryId, clearSelection]);
  const panelOnSetScale = useCallback((s: number) => { if (panelPrimaryId) setNodeScale(panelPrimaryId, s); }, [panelPrimaryId, setNodeScale]);
  const panelOnSetStack = useCallback((n: number) => { if (panelPrimaryId) setNodeStack(panelPrimaryId, n); }, [panelPrimaryId, setNodeStack]);
  // Component options (checkboxes): the selected component's declared options +
  // its current params, and a setter that writes one key into node.data.params.
  const panelOptions = selectedIds.length === 1 ? panelPrimaryData?.component.options : undefined;
  const panelParams = panelPrimaryData?.params;
  const panelOnSetParam = useCallback((key: string, value: boolean | string) => {
    if (!panelPrimaryId) return;
    setNodes((nds) => {
      const next = nds.map((n) => {
        if (n.id !== panelPrimaryId) return n;
        const dd = n.data as NodeData;
        const params = { ...(dd.params ?? {}), [key]: value };
        // Recompute the node box so the selection frame + resize handles track the
        // new (forked) size — only when the user hasn't manually resized it.
        const manual = dd.w !== undefined || dd.h !== undefined;
        const fp = manual ? null : nodeFootprint(dd.component, { rot: dd.rot, params });
        return { ...n, ...(fp ? { width: fp.w, height: fp.h, style: { ...n.style, width: fp.w, height: fp.h } } : {}), data: { ...dd, params } };
      });
      // Re-heal edges on this node: toggling an option OFF removes a port handle
      // (e.g. `out-fs`), which would drop the edge — remap it to a live handle.
      const changed = next.find((n) => n.id === panelPrimaryId);
      const set = changed ? handlesFor(changed.data as NodeData) : null;
      const healEdge = (e: typeof edges[number]) => {
        if (!set) return e;
        if (e.source === panelPrimaryId && e.sourceHandle && !set.has(e.sourceHandle)) return { ...e, sourceHandle: fallbackHandle(set, e.sourceHandle, "source") };
        if (e.target === panelPrimaryId && e.targetHandle && !set.has(e.targetHandle)) return { ...e, targetHandle: fallbackHandle(set, e.targetHandle, "target") };
        return e;
      };
      const healedEdges = set ? edges.map(healEdge) : edges;
      if (set) setEdges(healedEdges);
      scheduleSave(next, healedEdges);
      return next;
    });
  }, [panelPrimaryId, setNodes, setEdges, scheduleSave, edges]);
  // Editable block title — only composites that carry one (the medallion table).
  // Composites with an editable block title: the medallion table + both Lakeflow
  // blocks (their header is a customizable title, default "Lakeflow: …").
  const TITLED_KINDS = new Set(["medallion-table", "lakeflow", "lakeflow-genie"]);
  const panelHasTitle = selectedIds.length === 1 && !!panelPrimaryData && TITLED_KINDS.has(panelPrimaryData.component.kind ?? "");
  // Show the user's title in the input; blank (→ placeholder) when it's still the
  // catalog default, so the block's own default header shows. Each titled kind's
  // catalog label(s) count as "default".
  const TITLE_DEFAULT_LABELS = new Set(["Medallion Table", "Lakeflow", "Lakeflow + Genie"]);
  const panelNodeTitle = panelHasTitle && !TITLE_DEFAULT_LABELS.has(panelPrimaryData?.component.label ?? "")
    ? panelPrimaryData?.component.label : "";
  const panelOnSetTitle = useCallback((t: string) => { if (panelPrimaryId) onRename(panelPrimaryId, t); }, [panelPrimaryId, onRename]);
  const panelOnAnno = useCallback((patch: Partial<AnnotationData>) => {
    if (!panelPrimaryId) return;
    // Flipping a logo's text position between a HORIZONTAL (right/left) and a
    // VERTICAL (top/bottom) placement swaps the box's w/h. Apply the caption +
    // the swapped size in ONE commit so the box updates instantly (no
    // annotate→measure→resize double render → the ~100ms lag).
    if (patch.caption !== undefined) {
      const nd = nodesById.get(panelPrimaryId)?.data as (NodeData & { annotation?: AnnotationData }) | undefined;
      const norm = (c?: string) => (c === "side" ? "right" : c === "below" ? "bottom" : c);
      const wasH = (() => { const c = norm(nd?.annotation?.caption); return c === "right" || c === "left"; })();
      const nowH = patch.caption === "right" || patch.caption === "left";
      const w = nd?.w, h = nd?.h;
      if (wasH !== nowH && w !== undefined && h !== undefined) {
        onAnnotateResize(panelPrimaryId, patch, h, w); // swap axes
        return;
      }
    }
    onAnnotate(panelPrimaryId, patch);
  }, [panelPrimaryId, onAnnotate, onAnnotateResize, nodesById]);
  const panelOnPickLogo = useCallback(() => { if (panelPrimaryId) setLogoPickerFor(panelPrimaryId); }, [panelPrimaryId]);
  const panelOnStyle = useCallback((patch: StylePatch) => styleNodes(styleTargets, patch), [styleNodes, styleTargets]);
  const panelOnCopyStyle = useCallback(() => setCopiedStyle(panelNodeStyle), [panelNodeStyle]);
  const panelOnGroup = useCallback(() => groupNodes(groupTargets), [groupNodes, groupTargets]);
  const panelOnUngroup = useCallback(() => { if (panelPrimaryId) ungroupNode(panelPrimaryId); }, [panelPrimaryId, ungroupNode]);
  const panelOnZ = useCallback((dir: "front" | "back") => setNodeZ(styleTargets, dir), [setNodeZ, styleTargets]);
  // Source tiles get a label-position control in the panel.
  const panelIsSource = (panelPrimaryData as NodeData | undefined)?.type === "source" || !!panelPrimaryData?.sourceKey || (!!panelPrimaryId && baseId(panelPrimaryId).startsWith("src-"));
  const panelOnSetSourceCaption = useCallback(
    (pos: "right" | "left" | "top" | "bottom") => { if (panelPrimaryId) setSourceCaption(panelPrimaryId, pos); },
    [panelPrimaryId, setSourceCaption],
  );
  const panelOnSetSourceFontSize = useCallback(
    (px: number) => { if (panelPrimaryId) setSourceFontSize(panelPrimaryId, px); },
    [panelPrimaryId, setSourceFontSize],
  );

  // Description toggle — shown for a single source / logo / product tile. Its
  // resolved on/off state mirrors what the node renders: sources + logos are
  // opt-in (default off); product tiles default ON when the catalog supplies a
  // desc. The checkbox writes an explicit true/false via setShowDescription.
  const panelIsLogo = panelAnno?.variant === "logo";
  const panelIsPlainTile =
    selectedIds.length === 1 && !!panelPrimaryId && !panelIsSource && !panelAnno;
  const panelCanToggleDesc = selectedIds.length === 1 && (panelIsSource || panelIsLogo || panelIsPlainTile);
  // SLIDE hides every tile's description whatever showDesc says (component-node.tsx),
  // so the panel reports the rendered (off) state and locks the toggle — otherwise
  // it would show "on" while the canvas stays unchanged.
  const panelDescLocked = (panelIsPlainTile || panelIsSource) && panelPrimaryData?.theme === "slide";
  const panelShowDescription = panelIsLogo
    ? !!panelAnno?.showDesc
    : panelDescLocked
      ? false
      : panelIsPlainTile
        ? (panelPrimaryData?.showDesc ?? !!(panelPrimaryData?.component?.desc ?? panelPrimaryData?.component?.sublabel))
        : !!panelPrimaryData?.showDesc;
  // Label + description for the single node panel fields (same mutations as the
  // canvas double-click edit). Untitled composites + logos/annotations have no field.
  const panelCanEditLabel = selectedIds.length === 1 && !panelAnno && !panelHasTitle;
  const panelHasDesc = selectedIds.length === 1 && (panelIsPlainTile || panelIsSource);
  const panelDescText = panelIsSource
    ? (panelPrimaryData?.desc ?? "")
    : (panelPrimaryData?.component?.desc ?? panelPrimaryData?.component?.sublabel ?? "");
  const panelOnSetLabel = useCallback((t: string) => { if (panelPrimaryId) onRename(panelPrimaryId, t); }, [panelPrimaryId, onRename]);
  const panelOnSetDesc = useCallback((t: string) => { if (panelPrimaryId) onSetDescription(panelPrimaryId, t); }, [panelPrimaryId, onSetDescription]);
  const panelOnSetShowDescription = useCallback(
    (show: boolean) => { if (panelPrimaryId) setShowDescription(panelPrimaryId, show); },
    [panelPrimaryId, setShowDescription],
  );
  // Wrap-description toggle — offered on source + product tiles (NOT logos: a
  // captioned logo already wraps its own way). Only meaningful when a description
  // is shown. Reads the node's flag.
  const panelCanWrapDesc = panelCanToggleDesc && !panelIsLogo;
  const panelWrapDescription = !!panelPrimaryData?.wrapDesc;
  const panelOnSetWrapDescription = useCallback(
    (wrap: boolean) => { if (panelPrimaryId) setWrapDescription(panelPrimaryId, wrap); },
    [panelPrimaryId, setWrapDescription],
  );

  // Exact size/position fields (single selection only). Reported as the on-canvas
  // FOOTPRINT plus the box's TOP-LEFT in flow coords — the numbers the user reads
  // off the canvas (RF's own `position` is centre-relative via nodeOrigin).
  // Memoized on the four NUMBERS (not the node object, whose identity churns
  // every drag frame) so the memo'd EditPanel only re-renders when a displayed
  // value actually changes — and drags/resizes are grid-snapped, so that's in
  // 16px steps, not per frame.
  const geoNode = selectedIds.length === 1 && panelPrimaryId ? nodesById.get(panelPrimaryId) : undefined;
  const hasGeo = !!geoNode;
  const [gox, goy] = (geoNode?.origin as [number, number] | undefined) ?? NODE_ORIGIN;
  const geoW = Math.round((geoNode?.width ?? geoNode?.measured?.width ?? panelPrimaryData?.w ?? 0) as number);
  const geoH = Math.round((geoNode?.height ?? geoNode?.measured?.height ?? panelPrimaryData?.h ?? 0) as number);
  const geoX = Math.round((geoNode?.position.x ?? 0) - gox * geoW);
  const geoY = Math.round((geoNode?.position.y ?? 0) - goy * geoH);
  const panelGeometry = useMemo(
    () => (hasGeo ? { x: geoX, y: geoY, w: geoW, h: geoH } : undefined),
    [hasGeo, geoX, geoY, geoW, geoH],
  );
  const panelOnSetGeometry = useCallback(
    (patch: { x?: number; y?: number; w?: number; h?: number }) => { if (panelPrimaryId) setNodeGeometry(panelPrimaryId, patch); },
    [panelPrimaryId, setNodeGeometry],
  );

  // --- Docked-panel occlusion guard ----------------------------------------
  // The right-side panel is a flex SIBLING of the canvas, so the instant it opens
  // the ReactFlow pane loses ~240px of width: whatever sat in that strip — which
  // is usually the node you just clicked, near the right edge — slides out of
  // view together with its resize grips, and you can no longer drag the box
  // wider. Pan the viewport left by exactly the overhang (plus a grip margin) on
  // the panel's closed→open transition so the selection stays reachable. Only
  // pans when it must, and never pushes the selection's LEFT edge off-screen (a
  // selection wider than the pane keeps its left edge visible).
  const panelOpen = editMode && selectedIds.length > 0 && !!panelPrimaryId;
  const panelWasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = panelWasOpenRef.current;
    panelWasOpenRef.current = panelOpen;
    if (!panelOpen || wasOpen) return;
    const pane = paneRef.current;
    if (!pane) return;
    const sel = nodesRef.current.filter((n) => n.selected);
    if (!sel.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of sel) {
      const dd = n.data as NodeData;
      const w = (n.width ?? n.measured?.width ?? dd.w ?? 0) as number;
      const [ox] = (n.origin as [number, number] | undefined) ?? NODE_ORIGIN;
      const left = n.position.x - ox * w;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, left + w);
    }
    const { x, y, zoom } = getViewport();
    // The panel mounted in this same commit, so clientWidth is the SHRUNK pane.
    const overhang = maxX * zoom + x + PANEL_GUARD - pane.clientWidth;
    if (overhang <= 0) return;
    const room = Math.max(0, minX * zoom + x - PANEL_GUARD);
    const shift = Math.min(overhang, room);
    if (shift < 1) return;
    setViewport({ x: x - shift, y, zoom }, { duration: 140 });
  }, [panelOpen, getViewport, setViewport]);

  // Stable ReactFlow pane/node click handlers (avoid a fresh closure each frame).
  const onPaneClick = useCallback(() => { setSelectedId(null); setMenu(null); }, []);
  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    if (e.shiftKey) return;
    const gid = (node.data as NodeData | undefined)?.groupId;
    if (gid) selectGroupRef.current(gid);
  }, []);
  const onMoveStart = useCallback(() => setMenu(null), []);

  // Stable LibraryPalette handlers. The palette is `memo`'d and renders the
  // WHOLE catalog subtree; fresh inline arrows each render (every drag frame)
  // defeated the memo and re-rendered it per frame. The underlying add/change
  // callbacks are already stable, so these thin adapters only need wrapping.
  const paletteOnAdd = useCallback((id: string) => addComponent(id), [addComponent]);
  const paletteOnAddAnnotation = useCallback(
    (v: AnnotationVariant) => { const id = addAnnotation(v); if (v === "logo") setLogoPickerFor(id); else if (v === "text" || v === "note") setAutoEditFor(id); },
    [addAnnotation],
  );
  const paletteOnAddPreset = useCallback(
    (pid: string) => { const p = DBX_ARCH_PRESET_BY_ID[pid]; if (p) addAnnotation(p.variant ?? "box", undefined, p.annotation); },
    [addAnnotation],
  );
  const paletteOnAddLogo = useCallback((iconKey: string) => addAnnotation("logo", undefined, { icon: iconKey }), [addAnnotation]);
  const paletteOnAddShape = useCallback(
    (kind: ShapeKind) => { const id = addAnnotation("shape", undefined, { shape: kind }); setAutoEditFor(id); },
    [addAnnotation],
  );
  const paletteOnAddSource = useCallback((iconKey: string) => addSourceFromIcon(iconKey), [addSourceFromIcon]);
  const paletteOnMoreSources = useCallback(() => setSourcePicker(true), []);
  const paletteOnMoreLogos = useCallback((query: string) => setLogoPicker(query), []);
  const paletteOnPick = useCallback((id: string) => { if (pickingFor) changeNodeType(pickingFor, id); setPickingFor(null); }, [pickingFor, changeNodeType]);
  const paletteOnCancelPick = useCallback(() => setPickingFor(null), []);
  const paletteIsPicking = pickingFor !== null;
  const onCanvasDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  // Resize handles show only for a single (or empty) selection — see
  // SingleSelectionContext. A primitive, so context propagates only when it
  // actually flips across the 1↔many boundary (not per drag frame).
  const singleSelection = selectedIds.length <= 1;

  // Auto-edit signal for a freshly-dropped text node (cursor lands in it).
  const autoEditClear = useCallback(() => setAutoEditFor(null), []);
  const autoEditValue = useMemo(() => ({ id: autoEditFor, clear: autoEditClear }), [autoEditFor, autoEditClear]);
  // An edge is selected AND its docked panel is actually showing → hide
  // component anchors. Must match the panel-render guard below (which also
  // requires no node selection) — otherwise selecting a node/box AFTER a line
  // leaves the panel hidden but `edgeSelected` stuck true, suppressing every
  // box/node anchor (the "box anchors vanish after clicking a line" bug).
  const edgeSelected = menu?.kind === "edge" && selectedIds.length === 0;

  return (
    <AutoEditContext.Provider value={autoEditValue}>
    <EdgeSelectedContext.Provider value={edgeSelected}>
    <EditModeContext.Provider value={editMode}>
    <EdgeOpsContext.Provider value={edgeOps}>
    <DropTargetContext.Provider value={dropTargetId}>
    <SingleSelectionContext.Provider value={singleSelection}>
    <div className={`arch-theme-${schema.theme} flex min-h-0 flex-1`} ref={wrapRef} onPointerMove={collab ? onPointerMoveCursor : undefined}>
      {editMode && (
        <LibraryPalette
          schema={schema}
          placedIds={placedIds}
          onAdd={paletteOnAdd}
          onAddAnnotation={paletteOnAddAnnotation}
          onAddShape={paletteOnAddShape}
          onAddPreset={paletteOnAddPreset}
          onAddLogo={paletteOnAddLogo}
          onAddSource={paletteOnAddSource}
          onToggleTrademark={toggleTrademark}
          onMoreSources={paletteOnMoreSources}
          onMoreLogos={paletteOnMoreLogos}
          picking={paletteIsPicking}
          onPick={paletteOnPick}
          onCancelPick={paletteOnCancelPick}
        />
      )}

      <div className="relative min-w-0 flex-1" ref={paneRef} onDrop={onDrop} onDragOver={onCanvasDragOver}>
        {/* Dim + block the canvas while choosing a replacement type — the only
            interactive surface is the highlighted library on the left. */}
        {pickingFor !== null && (
          <div
            className="absolute inset-0 z-40 cursor-pointer bg-background/60"
            onClick={() => setPickingFor(null)}
            title="Click a component in the library, or click here to cancel"
          />
        )}
        {/* Format-painter mode banner — shows until the user presses Esc. The
            paint-roller signals "the style is loaded, click to apply it" (Word). */}
        {copiedStyle && (
          <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] text-foreground shadow-sm">
            <PaintRoller className="h-3.5 w-3.5 text-primary" />
            <span>Style loaded — click components to paint it on</span>
            <button
              type="button"
              onClick={() => setCopiedStyle(null)}
              className="ml-1 cursor-pointer rounded bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-background"
            >
              Esc to stop
            </button>
          </div>
        )}
        {/* Multi-tab strip (top-left; self-positioned absolute). Sits clear of
            the top-right floating action bar and the left library palette. */}
        {tabBar}

        {/* arrow marker def */}
        <svg className="pointer-events-none absolute h-0 w-0">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" opacity="0.6" />
            </marker>
          </defs>
        </svg>

        {/* floating action bar — hidden entirely in hard read-only (the
            standalone viewer shows only the diagram). Sits at top-8 (not top-3)
            so the multi-tab strip above has room to wrap onto a second row
            without colliding with these controls. */}
        <div className="absolute right-3 top-8 z-10 flex items-center gap-1.5">
          {/* Legend — rendered even in hard read-only: the standalone viewer HTML
              hides every other control, and a `show:"panel"` legend would be
              unreachable without this. */}
          {hasLegend && (
            <div className="flex items-center rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => setLegendOpen((v) => !v)}
                title="What each number on the diagram means"
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium hover:bg-muted ${legendOpen ? "bg-muted text-foreground" : "text-foreground"}`}
              >
                <ListOrdered className="h-3.5 w-3.5 text-primary" />
                Legend
              </button>
            </div>
          )}
          {!readOnly && (
          <>
          {/* History + Share live — grouped in one pill (matches the View/Edit
              group), borderless inner buttons split by a divider. In-app only. */}
          {(onToggleHistory || onShareLive) && (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
              {onToggleHistory && (
                <button
                  type="button"
                  onClick={onToggleHistory}
                  title="Architecture history"
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  History
                </button>
              )}
              {onToggleHistory && onShareLive && <div className="mx-0.5 h-5 w-px bg-border" />}
              {onShareLive && (
                <button
                  type="button"
                  onClick={onShareLive}
                  title="Share this architecture live with others"
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                  </svg>
                  Share live
                  {collab && collab.members.length > 1 && (
                    <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {collab.members.length}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
          {/* Save-status icon OUTSIDE the bar, to its left — so an idle/empty
              status leaves no gap inside the bar. */}
          {toolbarStatus}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
          {/* View / Edit mode toggle */}
          <div className="flex items-center rounded-md bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                !editMode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Eye className="h-3.5 w-3.5" /> View
            </button>
            <button
              type="button"
              onClick={() => setEditMode(true)}
              className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
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
                className="h-7 w-7 cursor-pointer px-0"
                disabled={!canUndo}
                onClick={undo}
                title="Undo (⌘Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 cursor-pointer px-0"
                disabled={!canRedo}
                onClick={redo}
                title="Redo (⇧⌘Z)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {/* Save status + Download (from the parent PlatformDiagram) at the
              right end — visible in both View and Edit mode. */}
          {toolbarExtras && (
            <>
              <div className="mx-0.5 h-5 w-px bg-border" />
              {toolbarExtras}
            </>
          )}
          </div>
          </>
          )}
        </div>

        {/* The readable legend — chrome outside `.react-flow`, so the PNG/SVG
            export never picks it up (see legend-panel.tsx). */}
        {hasLegend && legendOpen && schema.legend && (
          <LegendPanel legend={schema.legend} onClose={() => setLegendOpen(false)} />
        )}

        {/* Permission confirmation before enabling real brand logos. */}
        {confirmTrademark && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-background/60" onClick={() => setConfirmTrademark(false)}>
            <div className="w-[min(420px,92vw)] rounded-xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 text-[14px] font-semibold text-foreground">Use third-party brand logos?</div>
              <p className="mb-3 text-[12px] leading-snug text-muted-foreground">
                Third-party logos and trademarks are the property of their respective owners and are used for identification purposes only. No affiliation or endorsement is implied. Only enable this if you have permission to use them in the material. Cloud and Databricks marks are always shown. You can turn this off anytime
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmTrademark(false)} className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted">Cancel</button>
                <button type="button" onClick={() => { onSetTrademark(true); setConfirmTrademark(false); }} className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90">I have permission — show logos</button>
              </div>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          // Format-painter cursor: while a style is loaded, the pane + tiles show a
          // "copy" cursor so the pointer reads as "click to apply" (see the CSS rule).
          className={copiedStyle ? "sb-format-painter" : undefined}
          // Edges render BELOW nodes by default (EDGE_Z=0 < NODE_Z=1) so a line
          // tucks under a tile it passes. (No `elevateEdgesOnSelect`: toggling an
          // edge's z on selection refreshed node internals and transiently dropped
          // edge handles — every line vanished until the next full re-render. The
          // endpoint dots draw inside the edge SVG, which is enough to grab.)
          onNodesChange={handleNodesChange}
          // Freeze the relative-reflow group to pixels the instant a drag starts,
          // so dragging one tile doesn't re-stack its column (see handleNodeDragStart).
          onNodeDragStart={handleNodeDragStart}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          // Clicking a grouped node selects the whole group → they drag together.
          // A SHIFT click (multi-select add/remove) must NOT group-select, so the
          // user can shift-add/remove individual members; only a plain click does.
          onPaneClick={onPaneClick}
          onEdgeContextMenu={onEdgeContextMenu}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          // Nodes no longer open a floating menu — selection drives the docked
          // edit panel. We still suppress the browser context menu on a node /
          // selection so a right-click there doesn't pop the native menu.
          onSelectionContextMenu={preventDefault}
          onNodeContextMenu={preventDefault}
          onSelectionChange={onSelectionChange}
          onMoveStart={onMoveStart}
          nodeOrigin={NODE_ORIGIN}
          // Don't raise a node above the others just because it's selected —
          // keep its stacking order (only Bring-to-front/Send-to-back change z).
          elevateNodesOnSelect={false}
          // VIEW mode (read-only preview / the editor's "View" toggle): left-drag
          // PANS the canvas and there's no lasso — so you can freely scroll/move
          // around after zooming in. EDIT mode keeps left-drag lasso-select and
          // pans with the middle/right button (PAN_ON_DRAG).
          selectionOnDrag={editMode}
          panOnDrag={editMode ? PAN_ON_DRAG : true}
          // Wheel behavior is device-aware (see the native non-passive `wheel`
          // listener on the wrapper): a MOUSE WHEEL zooms to the cursor (ReactFlow's
          // built-in zoomOnScroll), a TRACKPAD two-finger scroll pans. We keep
          // zoomOnScroll ON for the mouse-wheel-zoom default and intercept only
          // the trackpad-pan gesture to pan instead — so no modifier key is
          // needed for either. Pinch still zooms.
          zoomOnScroll
          selectNodesOnDrag={false}
          // Shift = additive multi-select (shift-click toggles a node in/out of
          // the selection). selectionKeyCode is DISABLED: ReactFlow's default is
          // "Shift", which summons the selection overlay pane ABOVE the nodes the
          // moment Shift goes down — stealing the pointer from resize handles
          // (Shift+resize lassoed instead of keeping the aspect ratio). A plain
          // drag still lassos via selectionOnDrag, so nothing is lost.
          selectionKeyCode={null}
          multiSelectionKeyCode={MULTI_SELECT_KEYS}
          // Disable ReactFlow's built-in keyboard node movement — it snaps the
          // focused node to the 16px grid on every arrow press (Shift jumps even
          // further). Our own window keydown handler does the precise 1px nudge.
          disableKeyboardA11y
          // Initial fit is CAPPED at 1× (FIT_VIEW_OPTIONS.maxZoom) so a sparse
          // canvas (0–1 nodes) doesn't blow its tiny bbox up to the global 2×
          // maxZoom — see FIT_VIEW_OPTIONS. The user can still zoom the full
          // 0.3–2 range by hand. The readOnly refit effect above uses the same
          // options so previews frame identically.
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          // A read-only preview sits in a small frame and must fit a wide diagram whole.
          minZoom={readOnly ? 0.1 : 0.3}
          maxZoom={2}
          proOptions={PRO_OPTIONS}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          connectionMode={ConnectionMode.Loose}
          // 20px — MUST stay below the medallion's stacked-output spacing (~40px
          // node-local) so each of out-mv / out-gold / out-fs gets its own snap
          // zone. A larger radius (was 36) let the nearest handle grab the drop
          // from far away, so the 3 right-side ports collapsed to feeling like one.
          connectionRadius={20}
          nodesConnectable={editMode}
          nodesDraggable={editMode}
          elementsSelectable
          // snapToGrid drives ReactFlow's RESIZE pointer snapping (the grip
          // steps in 16s and RF pins the opposite edge correctly). It also
          // center-snaps a position drag, but handleNodesChange re-snaps the
          // TOP-LEFT edge afterward, so drag ends up edge-aligned regardless.
          snapToGrid
          snapGrid={SNAP_GRID}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1.6} color="#94a3b8" className="opacity-40" />
          <Controls className="!bg-background !border-border !shadow-sm [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground" showInteractive={false} />
          {/* Live peer cursors — inside <ReactFlow> so they re-render on
              pan/zoom (via useStore) and overlay the pane. */}
          {collab && <CollabCursors members={collab.members} meConnId={collab.meConnId} />}
          {/* Group-resize frame for a MULTI-selection — one frame around the whole
              selection; dragging a corner scales every selected node uniformly.
              (Per-node handles are single-selection only; see shared.tsx.) */}
          {editMode && selectedIds.length > 1 && (
            <GroupResize
              rects={nodes.filter((n) => n.selected).map(rectOfNode)}
              toFlow={(cx, cy) => screenToFlowPosition({ x: cx, y: cy })}
              onScale={onGroupScale}
            />
          )}
        </ReactFlow>

        {/* Searchable logo picker for a "Logo" annotation. Honors the
            trademark gate so gated logos show as a monogram here too. */}
        {logoPickerFor && (
          <IconPicker
            allowTrademark={!!schema.enableTrademarkLogos}
            onPick={(key) => {
              // A BOX carries its logo in the title legend (`titleIcon`); a LOGO
              // annotation carries it as its main `icon`. Set the right field.
              const variant = (nodesRef.current.find((n) => n.id === logoPickerFor)?.data as AnnotationNodeData | undefined)?.annotation?.variant;
              onAnnotate(logoPickerFor, variant === "box" ? { titleIcon: key } : { icon: key });
            }}
            onClose={() => setLogoPickerFor(null)}
          />
        )}

        {/* "+ More data sources" picker — same component, restricted to actual
            data sources; picking adds a source tile. */}
        {sourcePicker && (
          <IconPicker
            sourcesOnly
            allowTrademark={!!schema.enableTrademarkLogos}
            onPick={(key) => addSourceFromIcon(key)}
            onClose={() => setSourcePicker(false)}
          />
        )}

        {/* "see more logos" from search → the full logo picker, pre-filtered
            with the search term; picking adds a logo annotation (same as
            onAddLogo). */}
        {logoPicker !== null && (
          <IconPicker
            allowTrademark={!!schema.enableTrademarkLogos}
            initialQuery={logoPicker}
            onPick={(key) => paletteOnAddLogo(key)}
            onClose={() => setLogoPicker(null)}
          />
        )}
      </div>

      {/* DOCKED edge panel — clicking a line opens this on the right (like the
          node edit panel). Shown only when no node is selected. */}
      {menu && menu.kind === "edge" && editMode && selectedIds.length === 0 && (
        <ContextMenu
          edge={menuEdge}
          onClose={() => setMenu(null)}
          onToggleFlow={() => toggleEdgeFlow(menu.id)}
          onToggleDashed={() => toggleEdgeDashed(menu.id)}
          onSetShape={(s) => setEdgeShape(menu.id, s)}
          onSetBezier={(enabled) => setEdgeBezier(menu.id, enabled)}
          onSetWaypoints={(points) => setEdgeWaypoints(menu.id, points)}
          onSetFlowStyle={(s) => setEdgeFlowStyle(menu.id, s)}
          onSetArrow={(a) => setEdgeArrow(menu.id, a)}
          onSetEdgeLabel={(label) => setEdgeLabel(menu.id, label)}
          onSetEdgeLabelPos={(pos) => setEdgeLabelPos(menu.id, pos)}
          onRemoveEdge={() => { removeEdge(menu.id); setMenu(null); }}
        />
      )}

      {/* EDIT MODE: the docked right-side panel — driven purely by the node
          selection (single, multi, annotation, or group). Replaces the old
          floating node context menu. */}
      {editMode && selectedIds.length > 0 && panelPrimaryId && (
        <EditPanel
          selectionCount={selectedIds.length}
          annotation={panelAnno}
          nodeScale={panelPrimaryData?.scale ?? 1}
          nodeStack={(panelPrimaryData?.stack as number | undefined) ?? 1}
          onSetStack={selectedIds.length === 1 && !panelAnno ? panelOnSetStack : undefined}
          style={panelNodeStyle}
          isGroup={isGroup}
          canGroup={canGroup}
          sourceFontSize={panelIsSource ? ((panelPrimaryData?.fontSize as number | undefined) ?? (panelPrimaryData?.theme === "slide" ? 20 : 13)) : undefined}
          onSetSourceFontSize={panelIsSource ? panelOnSetSourceFontSize : undefined}
          sourceCaption={panelIsSource ? (panelPrimaryData?.sourceCaption as "right" |"left" | "top" | "bottom" | undefined) : undefined}
          onSetSourceCaption={panelIsSource ? panelOnSetSourceCaption : undefined}
          showDescription={panelCanToggleDesc ? panelShowDescription : undefined}
          onSetShowDescription={panelCanToggleDesc ? panelOnSetShowDescription : undefined}
          wrapDescription={panelCanWrapDesc ? panelWrapDescription : undefined}
          onSetWrapDescription={panelCanWrapDesc ? panelOnSetWrapDescription : undefined}
          options={panelOptions}
          params={panelParams}
          onSetParam={panelOnSetParam}
          componentId={panelPrimaryData?.component.id}
          label={panelCanEditLabel ? (panelPrimaryData?.component.label ?? "") : undefined}
          onSetLabel={panelCanEditLabel ? panelOnSetLabel : undefined}
          desc={panelHasDesc ? panelDescText : undefined}
          onSetDesc={panelHasDesc ? panelOnSetDesc : undefined}
          descLockedReason={panelDescLocked ? "hidden in Slide theme" : undefined}
          nodeTitle={panelHasTitle ? panelNodeTitle : undefined}
          onSetTitle={panelHasTitle ? panelOnSetTitle : undefined}
          titlePlaceholder={panelHasTitle
            ? (panelPrimaryData?.component.kind === "medallion-table" ? "Ingestion (SDP)" : "Lakeflow: Data ingestion and processing")
            : undefined}
          geometry={panelGeometry}
          onSetGeometry={panelGeometry ? panelOnSetGeometry : undefined}
          onClose={clearSelection}
          onRotate={panelOnRotate}
          onRemove={panelOnRemove}
          onChangeType={panelOnChangeType}
          onSetScale={panelOnSetScale}
          onAnno={panelOnAnno}
          onPickLogo={panelOnPickLogo}
          onStyle={panelOnStyle}
          onCopyStyle={panelOnCopyStyle}
          onGroup={panelOnGroup}
          onUngroup={panelOnUngroup}
          onZ={panelOnZ}
        />
      )}

      {/* VIEW MODE: the read-only detail panel (description + deep link). */}
      {!editMode && selected && (
        <DetailPanel
          component={selected.component}
          bandLabel={BAND_META[selected.bandId].label}
          bandColor={BAND_COLOR[selected.bandId]}
          deepLink={selectedNodeData?.deepLink ?? deepLinks[selected.component.id] ?? null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
    </SingleSelectionContext.Provider>
    </DropTargetContext.Provider>
    </EdgeOpsContext.Provider>
    </EditModeContext.Provider>
    </EdgeSelectedContext.Provider>
    </AutoEditContext.Provider>
  );
});
