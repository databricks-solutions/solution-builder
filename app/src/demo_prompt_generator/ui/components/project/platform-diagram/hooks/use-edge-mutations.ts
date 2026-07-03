/**
 * platform-diagram/hooks/use-edge-mutations — every "patch the edges + schedule
 * a save" reducer: retarget, mutate, toggle flow/dashed, set shape/flow-style/
 * label/centerX, and remove. All driven by the edge right-click menu or the
 * custom endpoint/elbow drag.
 *
 * Pulling these into a hook lets Canvas call it BEFORE building `edgeOps` (the
 * EdgeOps context value FlowEdge consumes), so `setEdgeCenterX` exists in time
 * and Canvas no longer needs the old `setEdgeCenterXRef` use-before-define hack.
 */
import { useCallback, type RefObject } from "react";
import { type Node, type Edge } from "@xyflow/react";
import { type FlowStyle } from "../shared";

export interface EdgeMutations {
  mutateEdge: (id: string, fn: (e: Edge) => Edge) => void;
  toggleEdgeFlow: (id: string) => void;
  toggleEdgeDashed: (id: string) => void;
  setEdgeShape: (id: string, shape: "smooth" | "straight" | "step") => void;
  setEdgeFlowStyle: (id: string, flowStyle: FlowStyle | undefined) => void;
  setEdgeArrow: (id: string, arrow: "auto" | "none" | "end" | "start" | "both") => void;
  setEdgeLabel: (id: string, label: string) => void;
  setEdgeCenterX: (id: string, centerX: number | undefined) => void;
  removeEdge: (id: string) => void;
  retargetEdge: (edgeId: string, end: "source" | "target", nodeId: string, handle?: string) => void;
}

export function useEdgeMutations({
  setEdges,
  scheduleSave,
  nodesRef,
}: {
  setEdges: (updater: (eds: Edge[]) => Edge[]) => void;
  scheduleSave: (nds: Node[], eds: Edge[]) => void;
  // A ref (not the live array) so the mutators stay STABLE — `edgeOps` is built
  // from these, and a new identity per drag frame would re-render every edge.
  nodesRef: RefObject<Node[]>;
}): EdgeMutations {
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
        scheduleSave(nodesRef.current, next);
        return next;
      });
    },
    [setEdges, scheduleSave, nodesRef],
  );

  const mutateEdge = useCallback(
    (id: string, fn: (e: Edge) => Edge) => {
      setEdges((eds) => {
        const next = eds.map((e) => (e.id === id ? fn(e) : e));
        scheduleSave(nodesRef.current, next);
        return next;
      });
    },
    [setEdges, scheduleSave, nodesRef],
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

  // Set the arrowhead mode. Arrow and flow are NO LONGER mutually exclusive —
  // the arrowhead paints on its own overlay path on top of any line style, so an
  // arrow can sit on top of a running flow animation. We therefore leave
  // `animated` untouched (setting an arrow used to force it off, which silently
  // killed a laser/flow source edge's beam the moment you added an arrow).
  const setEdgeArrow = useCallback(
    (id: string, arrow: "auto" | "none" | "end" | "start" | "both") =>
      mutateEdge(id, (e) => ({ ...e, data: { ...e.data, arrow } })),
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

  const removeEdge = useCallback(
    (id: string) =>
      setEdges((eds) => {
        const next = eds.filter((e) => e.id !== id);
        scheduleSave(nodesRef.current, next);
        return next;
      }),
    [setEdges, scheduleSave, nodesRef],
  );

  return {
    mutateEdge,
    toggleEdgeFlow,
    toggleEdgeDashed,
    setEdgeShape,
    setEdgeFlowStyle,
    setEdgeArrow,
    setEdgeLabel,
    setEdgeCenterX,
    removeEdge,
    retargetEdge,
  };
}
