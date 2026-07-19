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
  type PlatformComponent,
  type PlatformSchema,
  type BandId,
  type AnnotationData,
  type AnnotationVariant,
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
  VERTICAL_SOURCE_SIZE,
} from "./shared";
import {
  type Rect,
  type EdgeOps,
  EdgeOpsContext,
  remapHandleForType,
} from "./edge-routing";
import { LF_PORTS } from "./composite-lakeflow";
import {
  IconPicker,
  ANNOTATION_DEFAULT_SIZE,
  logoFitSize,
  type AnnotationNodeData,
} from "./annotations";
import { logoLabel } from "../../file-icons";
import { Button } from "@/components/ui/button";
import {
  Eye,
  Pencil,
  Undo2,
  Redo2,
  Copy,
} from "lucide-react";
import { nodeTypes, edgeTypes } from "./node-types";
import { DetailPanel } from "./panels/detail-panel";
import { EditPanel } from "./panels/edit-panel";
import { LibraryPalette } from "./panels/library-palette";
import { componentLookup, schemaToFlow, flowToLayout, EDGE_Z, handlesFor, fallbackHandle } from "./flow-mapping";
import { ContextMenu, type CtxMenu } from "./menus/context-menu";
import { useDiagramHistory } from "./hooks/use-diagram-history";
import { useNodeMutations } from "./hooks/use-node-mutations";
import { useEdgeMutations } from "./hooks/use-edge-mutations";
import { usePasteImage } from "./hooks/use-paste-image";

interface CanvasProps {
  schema: PlatformSchema;
  deepLinks: Record<string, string | null>;
  onPersist: (layout: PlatformSchema["layout"]) => void;
  onSetTrademark: (on: boolean) => void;
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

/** Stable empty-selection sentinel so `groupTargets` keeps one identity when
 *  nothing multi-selected (a fresh `[]` each render would churn the memo'd
 *  EditPanel every drag frame). */
const EMPTY_IDS: string[] = [];

/** Stable no-op context-menu suppressor for the ReactFlow node/selection
 *  handlers (a fresh `(e) => e.preventDefault()` each render is needless). */
const preventDefault = (e: { preventDefault: () => void }) => e.preventDefault();

// --- Static <ReactFlow> props — hoisted to module scope so they keep ONE
//     identity for the component's lifetime. Passing fresh object/array
//     literals inline would hand ReactFlow a new reference every Canvas render
//     (i.e. every drag frame), churning its internal store. ---
const NODE_ORIGIN: [number, number] = [0.5, 0.5];
const SNAP_GRID: [number, number] = [16, 16];
// Cap the initial fit at 0.75 so the diagram starts zoomed OUT a bit
// (components render smaller) instead of filling the viewport at 1×.
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 0.75 };
const PRO_OPTIONS = { hideAttribution: true };
const DEFAULT_EDGE_OPTIONS = { type: "flow" };
const PAN_ON_DRAG: [number, number] = [1, 2];
const MULTI_SELECT_KEYS = ["Shift"];

// memo: the parent (PlatformDiagram) re-renders on every save-status change
// (saving → saved → idle, ~3× per save). All of Canvas's props are stable
// (memoized schema/deepLinks, useCallback'd handlers), so the memo drops those
// parent-driven full re-renders entirely — they'd otherwise re-run the whole
// render body for a status chip the Canvas doesn't even show.
export const Canvas = memo(function Canvas({ schema, deepLinks, onPersist, onSetTrademark, defaultEditMode = true, readOnly = false, toolbarExtras, toolbarStatus, tabBar }: CanvasProps) {
  const [confirmTrademark, setConfirmTrademark] = useState(false);
  const [sourcePicker, setSourcePicker] = useState(false);
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
  const { screenToFlowPosition, getInternalNode } = useReactFlow();
  const rfStore = useStoreApi();
  const wrapRef = useRef<HTMLDivElement>(null);

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
  const { onResize, onRename, onSetDescription, onAnnotate, onAnnotateResize, bind: bindNodeMutations } = useNodeMutations();

  const initial = useMemo(
    () => schemaToFlow(schema, deepLinks, onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate),
    // Rebuild only when schema identity changes (not on every selection).
    [schema, deepLinks, onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate],
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
  const { beginBurst, endBurst, resetHistory, undo, redo, canUndo, canRedo, setScheduleSave } =
    useDiagramHistory({ nodes, edges, setNodes, setEdges });

  // Re-seed the graph when the underlying schema changes. useNodesState/
  // useEdgesState only take `initial` ONCE, so without this the canvas keeps
  // the auto-seeded graph it mounted with and never picks up architecture.md
  // once it finishes loading (the file's saved nodes/edges were being ignored).
  // Guarded so it only fires on a real schema-identity change, not on drags.
  const seededFrom = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  useEffect(() => {
    if (seededFrom.current === initial) return;
    seededFrom.current = initial;
    setNodes(initial.nodes);
    setEdges(initial.edges);
    // Reset undo history to the freshly-loaded state as the new baseline.
    resetHistory();
  }, [initial, setNodes, setEdges, resetHistory]);

  // NOTE: selection + edit mode are NOT written into node.data — selection
  // comes from ReactFlow's `selected` NodeProp, edit mode from EditModeContext,
  // and draggability from the <ReactFlow nodesDraggable> prop. That keeps node
  // data identities stable across selection/mode changes so React.memo holds.

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

  // --- Persistence: debounce-save the layout whenever nodes/edges settle ----
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback((nds: Node[], eds: Edge[]) => {
    // History = ONE entry per logical action (burst). A drag/resize fires
    // scheduleSave on every pixel; we push the pre-burst baseline onto the undo
    // stack only at the START of a burst (timer not pending), and snapshot the
    // FINAL state at burst end (in the timeout below).
    if (!saveTimer.current) beginBurst();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      endBurst(nds, eds);
      persistRef.current(flowToLayout(nds, eds, schema));
      saveTimer.current = null; // burst ended → next change starts a new burst
    }, 700);
  }, [schema, beginBurst, endBurst]);
  // Keep the node-mutation reducers (onResize/onRename/onAnnotate) pointed at the
  // live setNodes/scheduleSave/edges now that those exist.
  bindNodeMutations({ setNodes, scheduleSave, edges });
  // Register the live scheduleSave back into the history hook so restore/undo/
  // redo reach the current closure (the hook is declared before scheduleSave).
  setScheduleSave(scheduleSave);

  // All edge reducers (retarget / toggle flow+dashed / shape / flow-style /
  // label / centerX / remove). Declared here — before edgeOps — so setEdgeCenterX
  // exists in time for the EdgeOps context (no more setEdgeCenterXRef).
  const {
    toggleEdgeFlow, toggleEdgeDashed, setEdgeShape, setEdgeFlowStyle, setEdgeArrow,
    setEdgeLabel, setEdgeCenterX, removeEdge, retargetEdge,
  } = useEdgeMutations({ setEdges, scheduleSave, nodesRef });

  // Wrap change handlers so a drag/add/remove triggers a save + history entry.
  // CRITICAL: a drag emits a `position` change on EVERY pixel (dragging:true)
  // and one final one on drop (dragging:false). We only commit on the FINAL
  // one (or on removal) — otherwise history fills with hundreds of micro-steps
  // per drag and undo barely moves.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
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
          const next = dropped.size
            ? nds.map((n) =>
                dropped.has(n.id) && !(n.data as NodeData).pinned
                  ? { ...n, data: { ...(n.data as NodeData), pinned: true } }
                  : n,
              )
            : nds;
          scheduleSave(next, edges);
          return next;
        });
      }
    },
    [onNodesChange, setNodes, scheduleSave, edges],
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
    (fx: number, fy: number, margin = 24): string | null => {
      let hit: string | null = null;
      let hitZ = -Infinity;
      let hitDist = Infinity;
      for (const n of nodesRef.current) {
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
  // A composite block's named ports as absolute flow-coord anchors so a drag
  // INTO the block snaps to (and targets) the RIGHT one, not just a single side.
  const portsOf = useCallback(
    (nid: string): { handle: string; x: number; y: number }[] => {
      const n = nodesRef.current.find((x) => x.id === nid);
      const kind = (n?.data as NodeData | undefined)?.component.kind;
      const r = nodeRect(nid);
      if (!n || !r) return [];
      if (kind === "lakeflow") {
        return [
          // Left-edge input ports …
          ...LF_PORTS.map((p) => ({ handle: `in-${p.port}`, x: r.x, y: r.y + r.h * p.frac })),
          // … plus the bottom-left anchor (under the files), so a reconnect drag
          // can snap to it (matches `portAnchor`'s {side:"b", frac:0.08}).
          { handle: "bl", x: r.x + r.w * 0.08, y: r.y + r.h },
        ];
      }
      if (kind === "medallion-table") {
        // The medallion's fork OUTPUT rows (out-mv / out-gold / out-fs) are on the
        // right and their Y depends on the current fork layout — so read RF's
        // MEASURED handle bounds (the ground truth) instead of recomputing. Local
        // (node-space) centres → absolute flow coords via the node rect. Exposing
        // them lets a drag INTO the medallion snap to the correct row, not just
        // one side. (Falls back to nothing if not measured yet → generic sides.)
        const internal = getInternalNode(nid) as
          | { internals?: { handleBounds?: { source?: { id?: string | null; x: number; y: number; width: number; height: number }[] | null } | null } }
          | undefined;
        const src = internal?.internals?.handleBounds?.source ?? [];
        // Expose the fork OUTPUT rows (right) AND the generic sides (l/t/b) so a
        // drag can snap to any of them by proximity.
        return src
          .filter((h) => h.id && (h.id.startsWith("out-") || ["l", "t", "b"].includes(h.id)))
          .map((h) => ({ handle: h.id as string, x: r.x + h.x + h.width / 2, y: r.y + h.y + h.height / 2 }));
      }
      return [];
    },
    [nodeRect, getInternalNode],
  );
  const edgeOps = useMemo<EdgeOps>(
    () => ({
      editMode, retarget: retargetEdge, nodeAt, rectOf: nodeRect, setDropTarget, portsOf,
      toFlow: (cx: number, cy: number) => screenToFlowPosition({ x: cx, y: cy }),
      setEdgeCenterX, setEdgeLabel,
    }),
    [editMode, retargetEdge, nodeAt, nodeRect, setDropTarget, portsOf, screenToFlowPosition, setEdgeCenterX, setEdgeLabel],
  );

  // --- Add from library (drop or double-click) ------------------------------
  const addComponent = useCallback(
    (componentId: string, at?: { x: number; y: number }) => {
      const found = rawCatalog.get(baseId(componentId));
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
    [rawCatalog, deepLinks, onSelect, onContext, onResize, onRename, onSetDescription, setNodes, scheduleSave, edges],
  );

  // Add a free-form annotation node (text / box / logo / image). Returns the
  // new node id so callers can act on it (e.g. open the logo picker).
  const annoCounter = useRef(0);
  const addAnnotation = useCallback(
    (variant: AnnotationVariant, at?: { x: number; y: number }, extra?: Partial<AnnotationData>, dataExtra?: Partial<NodeData>): string => {
      const pos = at ?? { x: 160, y: 160 };
      const defaults: AnnotationData =
        variant === "box" ? { variant, text: "", vAlign: "middle", hAlign: "center", fontSize: 14 }
        : variant === "text" ? { variant, text: "", fontSize: 14 }
        : variant === "logo" ? { variant, icon: "data" }
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
        const sz = positionedLogo
          ? logoFitSize(annotation.text ?? "", cap === "right" || cap === "left", annotation.fontSize ?? 13, annotation.bold)
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
            selected: true,
            data: {
              nodeId: id,
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
    [onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate, setNodes, scheduleSave, edges],
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
      const fp = nodeFootprint(component, {});
      const srcYs = nds.filter((n) => baseId(n.id).startsWith("src-")).map((n) => n.position.y);
      const y = srcYs.length ? Math.max(...srcYs) + 96 : 0;
      const next = [
        // Deselect the rest; the new source is THE selection → its edit panel
        // opens right away (onSelectionChange syncs selectedIds).
        ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        {
          id, type: "component", position: { x: 0, y }, width: fp.w, height: fp.h, style: { width: fp.w, height: fp.h },
          selected: true,
          data: {
            nodeId: id, component, bandId: "sources" as BandId, bandColor: BAND_COLOR.sources,
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
  }, [onSelect, onContext, onResize, onRename, onSetDescription, schema.enableTrademarkLogos, setNodes, scheduleSave, edges]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const logoKey = e.dataTransfer.getData("application/x-logo");
      if (logoKey) { addAnnotation("logo", pos, { icon: logoKey }); return; }
      const sourceKey = e.dataTransfer.getData("application/x-source");
      if (sourceKey) { addSourceFromIcon(sourceKey); return; }
      const anno = e.dataTransfer.getData("application/x-annotation");
      if (anno) {
        const id = addAnnotation(anno as AnnotationVariant, pos);
        if (anno === "logo") setLogoPickerFor(id); // pick the logo right away
        else if (anno === "text") setAutoEditFor(id); // cursor into the text now
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
          const size = vertical ? VERTICAL_SOURCE_SIZE : baseSize(dd.component);
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
        const nat = baseSize(dd.component);
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
          ? (vertical ? VERTICAL_SOURCE_SIZE : baseSize(dd.component))
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
      const oldBase = catalog.get(baseId(id))?.component;
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
      // Rewire edges from the old id → new id. The new type may have a
      // different anchor set (e.g. a Lakeflow composite has named ports
      // `in-*`/`bl`, a plain tile only t/r/b/l). Keep the handle when it's still
      // valid; otherwise collapse it to the equivalent SIDE so the edge stays
      // attached on the same side rather than dangling on a missing handle.
      const newHasPorts = component.kind === "lakeflow" || component.kind === "lakeflow-genie";
      setEdges((eds) => {
        const seen = new Set<string>();
        const e2 = eds
          .map((e) => ({
            ...e,
            ...(e.source === id ? { source: newId, sourceHandle: remapHandleForType(e.sourceHandle, newHasPorts) } : {}),
            ...(e.target === id ? { target: newId, targetHandle: remapHandleForType(e.targetHandle, newHasPorts) } : {}),
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
        // Annotations get a fresh anno-* id; others use the <base>#<n> dedupe.
        const base = oldId.startsWith("anno-")
          ? `anno-${Date.now().toString(36)}-${annoCounter.current++}`
          : baseId(oldId);
        let nid = base;
        if (taken.has(nid)) {
          let k = 2;
          while (taken.has(`${base}#${k}`)) k++;
          nid = `${base}#${k}`;
        }
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
    return catalog.get(baseId(selectedId)) ?? null;
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
    () => Array.from(new Set(nodes.map((n) => baseId(n.id)))).sort().join(" "),
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
  // (Agent Bricks explode was removed — it's a single composite, not a group.)
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
      const next = nds.map((n) => {
        if (!n.selected) return n;
        if (!snap) return { ...n, position: { x: n.position.x + ux, y: n.position.y + uy } };
        // Snap the TOP-LEFT edge to the grid (matching drag-drop), then step one
        // cell in the arrow direction. position is origin-relative (center by
        // default; top-left for origin:[0,0] text), so offset by the origin.
        const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
        const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
        const [ox, oy] = (n.origin as [number, number] | undefined) ?? NODE_ORIGIN;
        const left = Math.round((n.position.x - ox * w) / GRID) * GRID + ux * GRID;
        const top = Math.round((n.position.y - oy * h) / GRID) * GRID + uy * GRID;
        return { ...n, position: { x: left + ox * w, y: top + oy * h } };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);
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
    remove: () => { if (selectedIds.length) { const ids = [...selectedIds]; clearSelection(); ids.forEach(removeNode); } },
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
  const panelOnSetParam = useCallback((key: string, value: boolean) => {
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
  const panelHasTitle = selectedIds.length === 1 && panelPrimaryData?.component.kind === "medallion-table";
  // Show the user's title in the input; blank (→ "Title…" placeholder) when it's
  // still the catalog default, so the block's own "Ingestion (SDP)" default shows.
  const panelNodeTitle = panelHasTitle && panelPrimaryData?.component.label !== "Medallion Table"
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
  const panelIsSource = !!panelPrimaryData?.sourceKey || (!!panelPrimaryId && baseId(panelPrimaryId).startsWith("src-"));
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
  const panelShowDescription = panelIsLogo
    ? !!panelAnno?.showDesc
    : panelIsPlainTile
      ? (panelPrimaryData?.showDesc ?? !!(panelPrimaryData?.component?.desc ?? panelPrimaryData?.component?.sublabel))
      : !!panelPrimaryData?.showDesc;
  const panelOnSetShowDescription = useCallback(
    (show: boolean) => { if (panelPrimaryId) setShowDescription(panelPrimaryId, show); },
    [panelPrimaryId, setShowDescription],
  );

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
    (v: AnnotationVariant) => { const id = addAnnotation(v); if (v === "logo") setLogoPickerFor(id); else if (v === "text") setAutoEditFor(id); },
    [addAnnotation],
  );
  const paletteOnAddPreset = useCallback(
    (pid: string) => { const p = DBX_ARCH_PRESET_BY_ID[pid]; if (p) addAnnotation(p.variant ?? "box", undefined, p.annotation); },
    [addAnnotation],
  );
  const paletteOnAddLogo = useCallback((iconKey: string) => addAnnotation("logo", undefined, { icon: iconKey }), [addAnnotation]);
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
    <div className="flex min-h-0 flex-1" ref={wrapRef}>
      {editMode && (
        <LibraryPalette
          schema={schema}
          placedIds={placedIds}
          onAdd={paletteOnAdd}
          onAddAnnotation={paletteOnAddAnnotation}
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

      <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={onCanvasDragOver}>
        {/* Dim + block the canvas while choosing a replacement type — the only
            interactive surface is the highlighted library on the left. */}
        {pickingFor !== null && (
          <div
            className="absolute inset-0 z-40 cursor-pointer bg-background/60"
            onClick={() => setPickingFor(null)}
            title="Click a component in the library, or click here to cancel"
          />
        )}
        {/* Paste-style mode banner — shows until the user presses Esc. */}
        {copiedStyle && (
          <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] text-foreground shadow-sm">
            <Copy className="h-3.5 w-3.5 text-primary" />
            <span>Click a component to paste the style</span>
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
            standalone viewer shows only the diagram). */}
        {!readOnly && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
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
        </div>
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
          // Edges render BELOW nodes by default (EDGE_Z=0 < NODE_Z=1) so a line
          // tucks under a tile it passes. (No `elevateEdgesOnSelect`: toggling an
          // edge's z on selection refreshed node internals and transiently dropped
          // edge handles — every line vanished until the next full re-render. The
          // endpoint dots draw inside the edge SVG, which is enough to grab.)
          onNodesChange={handleNodesChange}
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
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.3}
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
        </ReactFlow>

        {/* Searchable logo picker for a "Logo" annotation. Honors the
            trademark gate so gated logos show as a monogram here too. */}
        {logoPickerFor && (
          <IconPicker
            allowTrademark={!!schema.enableTrademarkLogos}
            onPick={(key) => onAnnotate(logoPickerFor, { icon: key })}
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
          onSetFlowStyle={(s) => setEdgeFlowStyle(menu.id, s)}
          onSetArrow={(a) => setEdgeArrow(menu.id, a)}
          onSetEdgeLabel={(label) => setEdgeLabel(menu.id, label)}
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
          sourceFontSize={panelIsSource ? (panelPrimaryData?.fontSize as number | undefined) : undefined}
          onSetSourceFontSize={panelIsSource ? panelOnSetSourceFontSize : undefined}
          sourceCaption={panelIsSource ? (panelPrimaryData?.sourceCaption as "right" |"left" | "top" | "bottom" | undefined) : undefined}
          onSetSourceCaption={panelIsSource ? panelOnSetSourceCaption : undefined}
          showDescription={panelCanToggleDesc ? panelShowDescription : undefined}
          onSetShowDescription={panelCanToggleDesc ? panelOnSetShowDescription : undefined}
          options={panelOptions}
          params={panelParams}
          onSetParam={panelOnSetParam}
          nodeTitle={panelHasTitle ? panelNodeTitle : undefined}
          onSetTitle={panelHasTitle ? panelOnSetTitle : undefined}
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
          deepLink={deepLinks[selected.component.id] ?? null}
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
