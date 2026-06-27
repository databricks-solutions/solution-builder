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
  type FlowStyle,
  type StylePatch,
  DropTargetContext,
  nodeFootprint,
  nodeTypeFor,
} from "./shared";
import {
  type Rect,
  type EdgeOps,
  EdgeOpsContext,
} from "./edge-routing";
import { LF_PORTS } from "./composite-lakeflow";
import {
  IconPicker,
  ANNOTATION_DEFAULT_SIZE,
  imageFileToDownscaledDataUrl,
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
      persistRef.current(flowToLayout(nds, eds, schema));
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
      return [
        // Left-edge input ports …
        ...LF_PORTS.map((p) => ({ handle: `in-${p.port}`, x: r.x, y: r.y + r.h * p.frac })),
        // … plus the bottom-left anchor (under the files), so a reconnect drag
        // can snap to it (matches `portAnchor`'s {side:"b", frac:0.08}).
        { handle: "bl", x: r.x + r.w * 0.08, y: r.y + r.h },
      ];
    },
    [nodes, nodeRect],
  );
  // setEdgeCenterX is declared further below; call it via a ref so edgeOps
  // (and the FlowEdge consuming it) doesn't hit a use-before-define.
  const setEdgeCenterXRef = useRef<(id: string, centerX: number | undefined) => void>(() => {});
  const edgeOps = useMemo<EdgeOps>(
    () => ({
      editMode, retarget: retargetEdge, nodeAt, rectOf: nodeRect, setDropTarget, portsOf,
      toFlow: (cx: number, cy: number) => screenToFlowPosition({ x: cx, y: cy }),
      setEdgeCenterX: (id, centerX) => setEdgeCenterXRef.current(id, centerX),
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
            selected: false, editMode: true, rot: 0,
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

  // Set an explicit flow style (overrides the source-derived default), or pass
  // undefined to clear back to "Auto". FlowEdge handles the visible styling.
  const setEdgeFlowStyle = useCallback(
    (id: string, flowStyle: FlowStyle | undefined) =>
      mutateEdge(id, (e) => ({ ...e, data: { ...e.data, flowStyle, animated: true } })),
    [mutateEdge],
  );

  // Set (or clear, with "") the edge's mid-line label. Stored on `e.label`
  // (ReactFlow's native field); scheduleSave persists it.
  const setEdgeLabel = useCallback(
    (id: string, label: string) =>
      mutateEdge(id, (e) => ({ ...e, label: label || undefined })),
    [mutateEdge],
  );

  // Set/clear the manual centerX of an edge's vertical elbow (from the ↔ drag).
  const setEdgeCenterX = useCallback(
    (id: string, centerX: number | undefined) =>
      mutateEdge(id, (e) => ({ ...e, data: { ...e.data, centerX } })),
    [mutateEdge],
  );
  setEdgeCenterXRef.current = setEdgeCenterX;

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
            style={{ opacity: menuNodeData?.opacity, fillColor: menuNodeData?.fillColor, fontColor: menuNodeData?.fontColor }}
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
  );
}
