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
  /** AUTO-HEIGHT: a wrap-desc tile's card measured its real rendered content height
   *  and reports it here. Sets the node's box height + `data.autoH` so the box,
   *  selection frame, and edge anchors track the measured content exactly. TRANSIENT
   *  (DOM-derived) — does NOT scheduleSave, so it never persists or loops. */
  onAutoHeight: (id: string, h: number) => void;
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
  // so the box, selection frame, and visual all stay the same size. `center`
  // (optional) is the new node position — passed by a grid-snapped resize that
  // shifted the box to keep the pinned edge fixed; without it position is left
  // as RF set it.
  const onResize = useCallback((id: string, w: number, h: number, scale?: number, center?: { x: number; y: number }) => {
    setNodesRef.current?.((nds) => {
      // RF node positions are TOP-LEFT; width/height are the on-canvas footprint.
      // The resized box's new rect (position may shift when a pinned edge is kept).
      const box = nds.find((n) => n.id === id);
      const boxDd = box?.data as NodeData | undefined;
      const boxPos = center ?? box?.position;
      const wrapList = boxDd?.placement?.wraps;
      // A wrapping box that shrank may now EXCLUDE some children → drop those from
      // its `wraps` so it stops trying to contain them (dynamic, on every resize).
      // "Outside" = the child's CENTER falls outside the box's new rect (forgiving
      // of borders + partial overlap). Only prunes; never adds.
      let keptWraps: string[] | undefined;
      if (wrapList?.length && boxPos) {
        const bx = boxPos.x, by = boxPos.y;
        const inside = (n: Node): boolean => {
          const cw = (n.width ?? (n.data as NodeData)?.w ?? 0);
          const ch = (n.height ?? (n.data as NodeData)?.h ?? 0);
          const cx = n.position.x + cw / 2;
          const cy = n.position.y + ch / 2;
          return cx >= bx && cx <= bx + w && cy >= by && cy <= by + h;
        };
        const kept = wrapList.filter((cid) => {
          const child = nds.find((n) => n.id === cid);
          return !child || inside(child); // keep if still inside (or not on canvas)
        });
        if (kept.length !== wrapList.length) keptWraps = kept;
      }

      const next = nds.map((n) => {
        if (n.id !== id) return n;
        const dd = n.data as NodeData;
        const q = (((dd.rot ?? 0) % 360) + 360) % 360;
        const swapped = q === 90 || q === 270;
        const cardW = swapped ? h : w;
        const cardH = swapped ? w : h;
        const placement = keptWraps
          ? { ...dd.placement, wraps: keptWraps }
          : dd.placement;
        return {
          ...n,
          width: w,
          height: h,
          ...(center ? { position: { x: center.x, y: center.y } } : {}),
          style: { ...n.style, width: w, height: h },
          data: {
            ...dd,
            w: Math.round(cardW),
            h: Math.round(cardH),
            ...(scale !== undefined ? { scale } : {}),
            ...(keptWraps ? { placement } : {}),
          },
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
        const isSrc = dd.type === "source" || !!dd.sourceKey || baseId(id).startsWith("src-");
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

  // AUTO-HEIGHT (wrap-desc): stamp the measured content height onto the node's box
  // + data. NOT saved — it's derived from the live DOM, so persisting it would bake
  // a viewport-specific pixel height into the file and could loop through save.
  const onAutoHeight = useCallback((id: string, h: number) => {
    setNodesRef.current?.((nds) => nds.map((n) => {
      if (n.id !== id) return n;
      const dd = n.data as NodeData;
      if (dd.autoH === h) return n; // no-op if unchanged (loop guard)
      const q = (((dd.rot ?? 0) % 360) + 360) % 360;
      const rotated = q === 90 || q === 270;
      const w = (n.width ?? dd.w ?? 200) as number;
      // The measured height is the CARD height; the box axis-swaps it when rotated.
      return rotated
        ? { ...n, width: h, style: { ...n.style, width: h }, data: { ...dd, autoH: h } }
        : { ...n, height: h, style: { ...n.style, width: w, height: h }, data: { ...dd, autoH: h } };
    }));
  }, []);

  return { onResize, onRename, onSetDescription, onAnnotate, onAnnotateResize, onAutoHeight, bind };
}
