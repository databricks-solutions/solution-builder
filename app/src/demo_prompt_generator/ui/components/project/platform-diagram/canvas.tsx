/**
 * platform-diagram/canvas — the inner ReactFlow canvas (needs ReactFlow
 * context). Owns the live nodes/edges, the library/detail panels, the
 * right-click menu, drag-to-add, undo/redo history, and the debounced save.
 */
import {
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
  nodeFootprint,
  nodeTypeFor,
  baseSize,
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
  type AnnotationNodeData,
} from "./annotations";
import { logoLabel, logoMetaByName } from "../../file-icons";
import { Button } from "@/components/ui/button";
import {
  Eye,
  Pencil,
  Undo2,
  Redo2,
  Image as ImageIcon,
  Copy,
} from "lucide-react";
import { nodeTypes, edgeTypes } from "./node-types";
import { DetailPanel } from "./panels/detail-panel";
import { EditPanel } from "./panels/edit-panel";
import { LibraryPalette } from "./panels/library-palette";
import { componentLookup, schemaToFlow, flowToLayout } from "./flow-mapping";
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
}

export function Canvas({ schema, deepLinks, onPersist, onSetTrademark }: CanvasProps) {
  const [confirmTrademark, setConfirmTrademark] = useState(false);
  const [sourcePicker, setSourcePicker] = useState(false);
  // Turning logos ON requires a permission ack; turning OFF is immediate.
  const toggleTrademark = useCallback(() => {
    if (schema.enableTrademarkLogos) onSetTrademark(false);
    else setConfirmTrademark(true);
  }, [schema.enableTrademarkLogos, onSetTrademark]);
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

  const onSelect = useCallback((id: string) => {
    // In paste mode, a click pastes the copied style onto the node (and stays
    // in paste mode for more pastes) instead of selecting it.
    if (copiedStyleRef.current) {
      styleNodesRef.current?.([id], copiedStyleRef.current);
      return;
    }
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
  const { onResize, onRename, onAnnotate, bind: bindNodeMutations } = useNodeMutations();

  const initial = useMemo(
    () => schemaToFlow(schema, deepLinks, onSelect, onContext, onResize, onRename, onAnnotate),
    // Rebuild only when schema identity changes (not on every selection).
    [schema, deepLinks, onSelect, onContext, onResize, onRename, onAnnotate],
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
      if (e.key === "Escape") { editKeyHandlersRef.current.clearSelection(); return; }
      if (isTyping()) return;
      // Plain arrow = step a grid cell and snap to the 16px grid (magnet).
      // Shift+arrow = exact 1px move for fine positioning.
      if (ARROWS[e.key]) {
        e.preventDefault();
        const [ux, uy] = ARROWS[e.key];
        editKeyHandlersRef.current.nudge(ux, uy, !e.shiftKey);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "c") { editKeyHandlersRef.current.copySelection(); }
      else if (k === "v") { e.preventDefault(); editKeyHandlersRef.current.pasteClipboard(); }
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
    toggleEdgeFlow, toggleEdgeDashed, setEdgeShape, setEdgeFlowStyle,
    setEdgeLabel, setEdgeCenterX, removeEdge, retargetEdge,
  } = useEdgeMutations({ setEdges, scheduleSave, nodesRef });

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
      setEdges((eds) => {
        if (eds.some((e) => e.source === params.source && e.target === params.target)) return eds;
        // Stable, collision-free id from the (now-guaranteed-unique) endpoint
        // pair + handles — NOT eds.length, which repeats after a delete.
        const id = `e-${params.source}-${sourceHandle ?? ""}-${params.target}-${targetHandle ?? ""}`;
        const next = addEdge(
          {
            ...params,
            sourceHandle,
            targetHandle,
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

  // Node footprint rect (flow coords) + hit-test, for the endpoint drag.
  // IMPORTANT: the canvas uses nodeOrigin=[0.5,0.5], so `node.position` is the
  // node's CENTER, not its top-left. The rect's top-left is position - size/2.
  // (Getting this wrong made only the right/bottom half of a tile hit-testable
  // — the "left half doesn't show the anchor" bug.)
  const nodeRect = useCallback(
    (nid: string): Rect | null => {
      const n = nodesRef.current.find((x) => x.id === nid);
      if (!n) return null;
      const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
      const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
      return { x: n.position.x - w / 2, y: n.position.y - h / 2, w, h };
    },
    [],
  );
  const nodeAt = useCallback(
    (fx: number, fy: number): string | null => {
      let hit: string | null = null;
      let hitZ = -Infinity;
      for (const n of nodesRef.current) {
        const w = (n.width ?? (n.data as NodeData).w ?? 200) as number;
        const h = (n.height ?? (n.data as NodeData).h ?? 56) as number;
        const x = n.position.x - w / 2;
        const y = n.position.y - h / 2;
        // Pick the TOPMOST node under the point (highest zIndex), so a
        // BringToFront node wins over one merely later in array order.
        const z = n.zIndex ?? 0;
        if (fx >= x && fx <= x + w && fy >= y && fy <= y + h && z >= hitZ) { hit = n.id; hitZ = z; }
      }
      return hit;
    },
    [],
  );
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const setDropTarget = useCallback((nid: string | null) => setDropTargetId(nid), []);
  // A composite block's named input ports as absolute flow-coord anchors so the
  // reconnect drag can snap to (and target) the RIGHT one, not just "left".
  const portsOf = useCallback(
    (nid: string): { handle: string; x: number; y: number }[] => {
      const n = nodesRef.current.find((x) => x.id === nid);
      const kind = (n?.data as NodeData | undefined)?.component.kind;
      if (!n || kind !== "lakeflow") return [];
      const r = nodeRect(nid);
      if (!r) return [];
      return [
        // Left-edge input ports …
        ...LF_PORTS.map((p) => ({ handle: `in-${p.port}`, x: r.x, y: r.y + r.h * p.frac })),
        // … plus the bottom-left anchor (under the files), so a reconnect drag
        // can snap to it (matches `portAnchor`'s {side:"b", frac:0.08}).
        { handle: "bl", x: r.x + r.w * 0.08, y: r.y + r.h },
      ];
    },
    [nodeRect],
  );
  const edgeOps = useMemo<EdgeOps>(
    () => ({
      editMode, retarget: retargetEdge, nodeAt, rectOf: nodeRect, setDropTarget, portsOf,
      toFlow: (cx: number, cy: number) => screenToFlowPosition({ x: cx, y: cy }),
      setEdgeCenterX,
    }),
    [editMode, retargetEdge, nodeAt, nodeRect, setDropTarget, portsOf, screenToFlowPosition, setEdgeCenterX],
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
              rot: 0,
            } satisfies NodeData,
          } as Node,
        ];
        scheduleSave(next, edges);
        return next;
      });
    },
    [rawCatalog, deepLinks, onSelect, onContext, onResize, onRename, setNodes, scheduleSave, edges],
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

  // Ctrl/Cmd+V pastes an image as a centered image annotation. The hook takes
  // addAnnotation directly (no addAnnotationRef now that it's defined above).
  usePasteImage({ editMode, addAnnotation, screenToFlowPosition, wrapRef });

  // Add a NEW data source from the "+ more data sources" picker. The source is
  // NOT a catalog component — its key/icon persist in layout.nodes[id].source
  // (label/ingest come from the unified logo catalog), and it round-trips via
  // buildLayout + schemaToFlow's source branch (no schema mutation, so the
  // re-seed effect won't clobber it).
  const addSourceFromIcon = useCallback((iconKey: string) => {
    const key = iconKey.replace(/^file:.*\//, "").replace(/^file:/, "").toLowerCase();
    const id = `src-${key.replace(/[^a-z0-9]+/g, "-")}`;
    const component: PlatformComponent = {
      id, label: logoLabel(key), icon: iconKey, desc: "", state: "active",
      ingest: (logoMetaByName(key).ingest as PlatformComponent["ingest"]) ?? "lakeflow-connect",
    };
    setSourcePicker(false);
    setNodes((nds) => {
      if (nds.some((n) => n.id === id)) return nds;
      const fp = nodeFootprint(component, {});
      const srcYs = nds.filter((n) => baseId(n.id).startsWith("src-")).map((n) => n.position.y);
      const y = srcYs.length ? Math.max(...srcYs) + 96 : 0;
      const next = [
        ...nds,
        {
          id, type: "component", position: { x: 0, y }, width: fp.w, height: fp.h, style: { width: fp.w, height: fp.h },
          data: {
            nodeId: id, component, bandId: "sources" as BandId, bandColor: BAND_COLOR.sources,
            deepLink: null, onSelect, onContext, onResize, onRename,
            allowTrademark: !!schema.enableTrademarkLogos,
            sourceKey: key,
            rot: 0,
          } satisfies NodeData,
        } as Node,
      ];
      scheduleSave(next, edges);
      return next;
    });
  }, [onSelect, onContext, onResize, onRename, schema.enableTrademarkLogos, setNodes, scheduleSave, edges]);

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
      const next = nds.map((n) => (idset.has(n.id) ? { ...n, data: { ...n.data, ...patch } } : n));
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
    setNodes((nds) => nds.map((n) => ({ ...n, selected: (n.data as NodeData).groupId === gid })));
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
    const multi = clip.length > 1;
    const gid = multi ? `group-${Date.now().toString(36)}-${groupCounter.current++}` : undefined;
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
        const d = { ...(src.data as NodeData), nodeId: newId, groupId: gid };
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

  // Prefer the LIVE node's own component data (it carries the correct
  // label/desc — including for freshly-added nodes resolved from the raw
  // catalog) over a re-lookup by base id, which would miss per-instance copy.
  const selected = (() => {
    if (!selectedId) return null;
    const live = nodes.find((n) => n.id === selectedId)?.data as NodeData | undefined;
    if (live?.component && live.bandId) return { component: live.component, bandId: live.bandId };
    return catalog.get(baseId(selectedId)) ?? null;
  })();
  // Base ids of every placed instance — the library dims a catalog item when at
  // least one instance is on the canvas (but it stays draggable for duplicates).
  const placedIds = useMemo(() => new Set(nodes.map((n) => baseId(n.id))), [nodes]);
  const menuEdge = menu?.kind === "edge" ? edges.find((e) => e.id === menu.id) : undefined;

  // --- Right-side EDIT PANEL state (driven by the SELECTION, not a menu) -----
  // The node options that used to live in the floating context menu now live in
  // a docked panel. Everything below is derived from `selectedIds` (the live
  // ReactFlow selection). Edges keep their own floating menu.
  // `panelPrimaryId` = the single node the panel's per-node controls (annotation,
  // scale, change-type, rotate) act on — the first selected node.
  const panelPrimaryId = selectedIds[0] as string | undefined;
  const panelPrimaryData = panelPrimaryId
    ? (nodes.find((n) => n.id === panelPrimaryId)?.data as NodeData | undefined)
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
  const groupTargets = selectedIds.length > 1 ? selectedIds : [];
  const groupIdsInSel = new Set(groupTargets.map((id) => (nodes.find((n) => n.id === id)?.data as NodeData | undefined)?.groupId));
  // The whole multi-selection is exactly one existing group (every member shares
  // one defined groupId) → offer Ungroup, not Group.
  const selIsOneGroup = groupTargets.length > 1 && groupIdsInSel.size === 1 && !groupIdsInSel.has(undefined);
  // `isGroup` (offer Ungroup): a single grouped node or a whole-group selection.
  // (Agent Bricks explode was removed — it's a single composite, not a group.)
  const isGroup = (selectedIds.length === 1 && !!panelPrimaryData?.groupId) || selIsOneGroup;
  // Offer Group unless the selection is already exactly one existing group.
  const canGroup = groupTargets.length > 1 && !selIsOneGroup;
  // The (primary) selected node's style fields — drives the controls' current
  // values and is what "Copy style" captures.
  const panelNodeStyle: StylePatch = {
    opacity: panelPrimaryData?.opacity,
    fillColor: panelPrimaryData?.fillColor,
    fontColor: panelPrimaryData?.fontColor,
    borderWidth: panelPrimaryData?.borderWidth,
    borderStyle: panelPrimaryData?.borderStyle,
    borderColor: panelPrimaryData?.borderColor,
    borderRadius: panelPrimaryData?.borderRadius,
    shadow: panelPrimaryData?.shadow,
  };
  // Clear the live ReactFlow selection (closes the panel). Used by the panel's
  // X, the Escape key, and the pane click.
  const clearSelection = useCallback(() => {
    setNodes((nds) => nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds);
  }, [setNodes]);
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
        // Snap each axis to the grid, then step one cell in the arrow direction.
        const sx = Math.round(n.position.x / GRID) * GRID + ux * GRID;
        const sy = Math.round(n.position.y / GRID) * GRID + uy * GRID;
        return { ...n, position: { x: sx, y: sy } };
      });
      scheduleSave(next, edges);
      return next;
    });
  }, [setNodes, scheduleSave, edges]);
  // Keep the window keydown effect's handlers pointed at the live callbacks
  // (the effect binds once per editMode; refs let it reach the current closures).
  editKeyHandlersRef.current = { copySelection, pasteClipboard, clearSelection, nudge };

  return (
    <EditModeContext.Provider value={editMode}>
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
          onAddSource={(iconKey) => addSourceFromIcon(iconKey)}
          onToggleTrademark={toggleTrademark}
          onMoreSources={() => setSourcePicker(true)}
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
              {/* Trademark-logo toggle: on requires a permission ack. */}
              <button
                type="button"
                onClick={toggleTrademark}
                title="Show real third-party brand logos (requires permission)"
                className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                  schema.enableTrademarkLogos ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" /> Logos {schema.enableTrademarkLogos ? "on" : "off"}
              </button>
              <div className="mx-0.5 h-5 w-px bg-border" />
              <span className="px-1.5 text-[10.5px] text-muted-foreground">Select a block · right-click a line</span>
            </>
          )}
        </div>

        {/* Permission confirmation before enabling real brand logos. */}
        {confirmTrademark && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-background/60" onClick={() => setConfirmTrademark(false)}>
            <div className="w-[min(420px,92vw)] rounded-xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 text-[14px] font-semibold text-foreground">Use third-party brand logos?</div>
              <p className="mb-3 text-[12px] leading-snug text-muted-foreground">
                Logos like Shopify, Snowflake, or SAP are trademarks of their owners. Only enable this if you have permission to use them in this material. Cloud and Databricks marks are always shown. You can turn this off anytime.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmTrademark(false)} className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted">Cancel</button>
                <button type="button" onClick={() => { onSetTrademark(true); setConfirmTrademark(false); }} className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90">I have permission — show logos</button>
              </div>
            </div>
          </div>
        )}

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
          // Clicking a grouped node selects the whole group → they drag together.
          // A SHIFT click (multi-select add/remove) must NOT group-select, so the
          // user can shift-add/remove individual members; only a plain click does.
          onNodeClick={(e, node) => {
            if (e.shiftKey) return;
            const gid = (node.data as NodeData | undefined)?.groupId;
            if (gid) selectGroupRef.current(gid);
          }}
          // Nodes no longer open a floating menu — selection drives the docked
          // edit panel. We still suppress the browser context menu on a node /
          // selection so a right-click there doesn't pop the native menu.
          onSelectionContextMenu={(e) => e.preventDefault()}
          onNodeContextMenu={(e) => e.preventDefault()}
          onSelectionChange={onSelectionChange}
          onMoveStart={() => setMenu(null)}
          nodeOrigin={[0.5, 0.5]}
          // Don't raise a node above the others just because it's selected —
          // keep its stacking order (only Bring-to-front/Send-to-back change z).
          elevateNodesOnSelect={false}
          selectionOnDrag
          panOnDrag={[1, 2]}
          selectNodesOnDrag={false}
          // Shift = additive multi-select: shift-click toggles a node in/out of
          // the selection, shift-drag lassos ADD to the current selection. (No
          // selectionKeyCode override — keeping default so a plain drag still
          // lassos thanks to selectionOnDrag.)
          multiSelectionKeyCode={["Shift"]}
          // Disable ReactFlow's built-in keyboard node movement — it snaps the
          // focused node to the 16px grid on every arrow press (Shift jumps even
          // further). Our own window keydown handler does the precise 1px nudge.
          disableKeyboardA11y
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

        {/* Floating context menu — EDGES ONLY now (nodes use the docked panel). */}
        {menu && menu.kind === "edge" && editMode && (
          <ContextMenu
            menu={menu}
            edge={menuEdge}
            onClose={() => setMenu(null)}
            onToggleFlow={() => toggleEdgeFlow(menu.id)}
            onToggleDashed={() => toggleEdgeDashed(menu.id)}
            onSetShape={(s) => setEdgeShape(menu.id, s)}
            onSetFlowStyle={(s) => setEdgeFlowStyle(menu.id, s)}
            onSetEdgeLabel={(label) => { setEdgeLabel(menu.id, label); setMenu(null); }}
            onRemoveEdge={() => { removeEdge(menu.id); setMenu(null); }}
          />
        )}

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
      </div>

      {/* EDIT MODE: the docked right-side panel — driven purely by the node
          selection (single, multi, annotation, or group). Replaces the old
          floating node context menu. */}
      {editMode && selectedIds.length > 0 && panelPrimaryId && (
        <EditPanel
          selectionCount={selectedIds.length}
          annotation={panelAnno}
          nodeScale={panelPrimaryData?.scale ?? 1}
          style={panelNodeStyle}
          isGroup={isGroup}
          canGroup={canGroup}
          onClose={clearSelection}
          onRotate={() => rotateNode(panelPrimaryId)}
          onRemove={() => { const ids = [...selectedIds]; clearSelection(); ids.forEach(removeNode); }}
          onChangeType={() => { setPickingFor(panelPrimaryId); clearSelection(); }}
          onSetScale={(s) => setNodeScale(panelPrimaryId, s)}
          onAnno={(patch) => onAnnotate(panelPrimaryId, patch)}
          onPickLogo={() => setLogoPickerFor(panelPrimaryId)}
          onSetImageUrl={() => {
            const url = window.prompt("Image URL:", panelAnno?.src ?? "");
            if (url !== null) onAnnotate(panelPrimaryId, { src: url.trim() });
          }}
          onStyle={(patch) => styleNodes(styleTargets, patch)}
          onCopyStyle={() => setCopiedStyle(panelNodeStyle)}
          onGroup={() => groupNodes(groupTargets)}
          onUngroup={() => ungroupNode(panelPrimaryId)}
          onZ={(dir) => setNodeZ(styleTargets, dir)}
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
    </DropTargetContext.Provider>
    </EdgeOpsContext.Provider>
    </EditModeContext.Provider>
  );
}
