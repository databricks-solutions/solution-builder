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
} from "lucide-react";
import { nodeTypes, edgeTypes } from "./node-types";
import { DetailPanel } from "./panels/detail-panel";
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

  const onSelect = useCallback((id: string) => {
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
      const found = catalog.get(baseId(componentId));
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
    [catalog, deepLinks, onSelect, onContext, onResize, onRename, setNodes, scheduleSave, edges],
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
    const found = catalog.get(baseId(newComponentId));
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
  }, [catalog, deepLinks, setNodes, setEdges, scheduleSave]);

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

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setMenu({ kind: "edge", id: edge.id, x: e.clientX, y: e.clientY });
  }, []);

  const selected = selectedId ? catalog.get(baseId(selectedId)) : null;
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
              <span className="px-1.5 text-[10.5px] text-muted-foreground">Right-click a block or line</span>
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
            onSetFlowStyle={(s) => setEdgeFlowStyle(menu.id, s)}
            onSetEdgeLabel={(label) => { setEdgeLabel(menu.id, label); setMenu(null); }}
            onRemoveEdge={() => { removeEdge(menu.id); setMenu(null); }}
            onAnno={(patch) => onAnnotate(menu.id, patch)}
            onPickLogo={() => { setLogoPickerFor(menu.id); setMenu(null); }}
            onSetImageUrl={() => {
              const cur = menuAnno?.src ?? "";
              const url = window.prompt("Image URL:", cur);
              if (url !== null) onAnnotate(menu.id, { src: url.trim() });
              setMenu(null);
            }}
            style={{
              opacity: menuNodeData?.opacity,
              fillColor: menuNodeData?.fillColor,
              fontColor: menuNodeData?.fontColor,
              borderWidth: menuNodeData?.borderWidth,
              borderStyle: menuNodeData?.borderStyle,
              borderColor: menuNodeData?.borderColor,
              borderRadius: menuNodeData?.borderRadius,
            }}
            selectionCount={styleTargets.length}
            onStyle={(patch) => styleNodes(styleTargets, patch)}
            onZ={(dir) => { setNodeZ(styleTargets.length ? styleTargets : [menu.id], dir); setMenu(null); }}
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
    </EditModeContext.Provider>
  );
}
