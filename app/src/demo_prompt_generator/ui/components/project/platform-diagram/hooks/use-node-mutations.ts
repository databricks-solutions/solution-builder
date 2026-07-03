/**
 * platform-diagram/hooks/use-node-mutations — the three "patch a node's data +
 * schedule a save" reducers: onResize, onRename, onAnnotate.
 *
 * Why a hook (and why it still keeps refs): these three callbacks are baked into
 * each node's data by schemaToFlow, which runs inside the `initial` useMemo
 * BEFORE useNodesState exists — so they must be STABLE and defined before
 * setNodes/scheduleSave/edges are available. That's a genuine cycle.
 *
 * The old code solved it with setNodesRef/scheduleSaveRef/edgesRef declared in
 * Canvas. This hook moves that exact machinery OUT of Canvas: it owns the refs
 * internally, exposes stable onResize/onRename/onAnnotate, and Canvas just calls
 * `bind({ setNodes, scheduleSave, edges })` once per render to keep the refs
 * live. Canvas reads clean — no ref atoms — and the ordering hazard is gone.
 */
import { useCallback, useRef } from "react";
import { type Node, type Edge } from "@xyflow/react";
import {
  type AnnotationData,
  baseId,
} from "@/lib/platform-architecture";
import { type NodeData } from "../shared";
import { type AnnotationNodeData } from "../annotations";

type SetNodes = (updater: (nds: Node[]) => Node[]) => void;

export interface NodeMutations {
  /** Resize a node's box. `scale` (corner-drag, fit mode) is stored too so the
   *  content scales with it; omit for a side-drag (box stretch, content fixed). */
  onResize: (id: string, w: number, h: number, scale?: number) => void;
  onRename: (id: string, label: string) => void;
  /** Commit an edited description line (double-click the description). Writes to
   *  the right target by kind: logo → annotation.desc; source → dd.desc; catalog
   *  tile → dd.component.desc. "" is preserved (deliberately cleared). */
  onSetDescription: (id: string, desc: string) => void;
  onAnnotate: (id: string, patch: Partial<AnnotationData>) => void;
  /** Patch annotation props AND resize the box in ONE commit — avoids the
   *  annotate→re-render→measure→resize→re-render double pass (the ~100ms lag on
   *  flipping a logo's text position). Pass w/h to also set the box. */
  onAnnotateResize: (id: string, patch: Partial<AnnotationData>, w?: number, h?: number) => void;
  /** Refresh the live setNodes/scheduleSave/edges the stable callbacks read. */
  bind: (live: { setNodes: SetNodes; scheduleSave: (nds: Node[], eds: Edge[]) => void; edges: Edge[] }) => void;
}

export function useNodeMutations(): NodeMutations {
  const setNodesRef = useRef<SetNodes | null>(null);
  const scheduleSaveRef = useRef<((nds: Node[], eds: Edge[]) => void) | null>(null);
  const edgesRef = useRef<Edge[]>([]);

  const bind = useCallback(
    (live: { setNodes: SetNodes; scheduleSave: (nds: Node[], eds: Edge[]) => void; edges: Edge[] }) => {
      setNodesRef.current = live.setNodes;
      scheduleSaveRef.current = live.scheduleSave;
      edgesRef.current = live.edges;
    },
    [],
  );

  // w/h here are the FOOTPRINT (on-canvas) dims from NodeResizer. Store them
  // back as CARD dims (un-swap for rotation) and keep node.width/height in sync
  // so the box, selection frame, and visual all stay the same size.
  const onResize = useCallback((id: string, w: number, h: number, scale?: number) => {
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
          data: { ...dd, w: Math.round(cardW), h: Math.round(cardH), ...(scale !== undefined ? { scale } : {}) },
        };
      });
      scheduleSaveRef.current?.(next, edgesRef.current);
      return next;
    });
  }, []);

  // Rename a node (double-click on its label). Overrides the component label for
  // this node; persisted in the layout (scheduleSave diffs it vs the catalog).
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

  // Commit an edited description line. Writes to the right target by kind:
  //   • logo annotation → annotation.desc
  //   • source tile      → dd.desc (carried directly on the node)
  //   • catalog tile     → dd.component.desc (override vs the catalog default)
  // "" is preserved (deliberately cleared); flowToLayout diffs vs the catalog.
  const onSetDescription = useCallback((id: string, desc: string) => {
    setNodesRef.current?.((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData & { annotation?: AnnotationData };
        if (dd.annotation) {
          return { ...n, data: { ...dd, annotation: { ...dd.annotation, desc } } };
        }
        const isSrc = !!dd.sourceKey || baseId(id).startsWith("src-");
        return isSrc
          ? { ...n, data: { ...dd, desc } }
          : { ...n, data: { ...dd, component: { ...dd.component, desc } } };
      });
      scheduleSaveRef.current?.(next, edgesRef.current);
      return next;
    });
  }, []);

  // Patch an annotation node's props (text/icon/src/alignment/fontSize/border).
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

  // Patch + resize in a SINGLE commit (see interface note).
  const onAnnotateResize = useCallback((id: string, patch: Partial<AnnotationData>, w?: number, h?: number) => {
    setNodesRef.current?.((nds) => {
      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as AnnotationNodeData;
        const sized = w !== undefined && h !== undefined
          ? { width: w, height: h, style: { ...n.style, width: w, height: h } }
          : {};
        return {
          ...n,
          ...sized,
          data: {
            ...dd,
            annotation: { ...dd.annotation, ...patch },
            ...(w !== undefined && h !== undefined ? { w, h } : {}),
          },
        };
      });
      scheduleSaveRef.current?.(next, edgesRef.current);
      return next;
    });
  }, []);

  return { onResize, onRename, onSetDescription, onAnnotate, onAnnotateResize, bind };
}
