/**
 * platform-diagram/hooks/use-diagram-history — undo/redo for the canvas.
 *
 * A snapshot is the committed graph. We push the PREVIOUS state before each
 * committed change, so undo restores it. History = ONE entry per logical
 * action (a "burst"): a drag/resize fires scheduleSave on every pixel; the
 * canvas pushes the pre-burst baseline at burst START (`beginBurst`) and
 * snapshots the FINAL state at burst END (`endBurst`).
 *
 * This hook owns ALL the history machinery (past/future/applying/lastCommitted
 * refs + histTick) so Canvas no longer needs the beginBurstRef/endBurstRef/
 * resetHistoryRef use-before-define hacks. `beginBurst`/`endBurst`/
 * `resetHistory` are returned as stable callbacks; Canvas's scheduleSave closes
 * over the first two directly, and the re-seed effect calls resetHistory.
 *
 * scheduleSave is itself defined in Canvas AFTER this hook (it needs beginBurst/
 * endBurst), but undo/redo's `restore` needs scheduleSave — a genuine cycle. We
 * break it with a ref kept INTERNAL to this hook (`scheduleSaveRef`), refreshed
 * every render via the returned `setScheduleSave(fn)`. Canvas stays ref-free.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { type Node, type Edge } from "@xyflow/react";

export type Snap = { nodes: Node[]; edges: Edge[] };

function cloneSnap(nds: Node[], eds: Edge[]): Snap {
  return {
    nodes: nds.map((n) => ({ ...n, position: { ...n.position }, data: { ...n.data } })),
    edges: eds.map((e) => ({ ...e, data: { ...e.data } })),
  };
}

export interface DiagramHistory {
  /** Push the pre-burst baseline onto the undo stack (once per logical action). */
  beginBurst: () => void;
  /** The final state becomes the new baseline (what a subsequent edit pushes). */
  endBurst: (nds: Node[], eds: Edge[]) => void;
  /** Clear history; the next populated render re-seeds the baseline. */
  resetHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Register the live scheduleSave (defined in Canvas after this hook). Called
   *  every render so restore/undo/redo always reach the current closure. */
  setScheduleSave: (fn: (nds: Node[], eds: Edge[]) => void) => void;
}

export function useDiagramHistory({
  nodes,
  edges,
  setNodes,
  setEdges,
}: {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nds: Node[]) => void;
  setEdges: (eds: Edge[]) => void;
}): DiagramHistory {
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const applying = useRef(false);
  const lastCommitted = useRef<Snap | null>(null);
  const [histTick, setHistTick] = useState(0); // re-render to refresh button enabled state

  // scheduleSave is recreated in Canvas after this hook; keep a live ref so
  // restore/undo/redo always call the current one without a Canvas-level ref.
  const scheduleSaveRef = useRef<(nds: Node[], eds: Edge[]) => void>(() => {});
  const setScheduleSave = useCallback((fn: (nds: Node[], eds: Edge[]) => void) => {
    scheduleSaveRef.current = fn;
  }, []);

  // BURST START: push the pre-burst baseline onto the undo stack (once per
  // logical action). Does NOT change lastCommitted — that's set at burst end.
  const beginBurst = useCallback(() => {
    if (applying.current) return;
    if (lastCommitted.current) {
      past.current.push(lastCommitted.current);
      if (past.current.length > 100) past.current.shift();
      future.current = []; // a fresh edit invalidates the redo stack
      setHistTick((t) => t + 1);
    }
  }, []);

  // BURST END: the final state becomes the new baseline (what a subsequent
  // edit will push, and what redo restores to).
  const endBurst = useCallback((nds: Node[], eds: Edge[]) => {
    if (applying.current) return;
    lastCommitted.current = cloneSnap(nds, eds);
  }, []);

  const resetHistory = useCallback(() => {
    past.current = [];
    future.current = [];
    lastCommitted.current = null; // re-seeded by the baseline effect
    setHistTick((t) => t + 1);
  }, []);

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
      // Edit mode / draggability come from context + the ReactFlow prop now, so
      // restored nodes pick up the current UI mode without re-stamping data.
      setNodes(snap.nodes);
      setEdges(snap.edges);
      lastCommitted.current = cloneSnap(snap.nodes, snap.edges);
      scheduleSaveRef.current(snap.nodes, snap.edges);
      setHistTick((t) => t + 1);
      // release the guard after the state settles
      setTimeout(() => { applying.current = false; }, 0);
    },
    [setNodes, setEdges],
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

  return { beginBurst, endBurst, resetHistory, undo, redo, canUndo, canRedo, setScheduleSave };
}
