/**
 * platform-diagram/flow-mapping — pure transforms between the resolved
 * `PlatformSchema` and ReactFlow's nodes/edges, in both directions:
 *   • schemaToFlow / flowToEdge — schema → ReactFlow graph (build the canvas);
 *   • flowToLayout — ReactFlow graph → persisted layout (save back to file).
 * No React, no ReactFlow context — just data mapping.
 */
import { type Node, type Edge } from "@xyflow/react";
import {
  baseId,
  BAND_COLOR,
  type PlatformComponent,
  type PlatformSchema,
  type PlatformEdge,
  type NodePosition,
  type BandId,
  type AnnotationData,
} from "@/lib/platform-architecture";
import { type NodeData, type EdgeData, nodeFootprint, nodeTypeFor } from "./shared";
import { ANNOTATION_DEFAULT_SIZE, type AnnotationNodeData } from "./annotations";
import { logoLabel } from "../../file-icons";

/** Edges render BELOW nodes by default — a line passing near a tile tucks UNDER
 *  it rather than crossing over its face (cleaner). Plain nodes default to z=1
 *  (NODE_Z), edges to 0, background wrapper boxes to their explicit negative z.
 *  A user bring-to-front (positive z) still lifts a node above everything.
 *  NOTE: keep edges at a MODEST z (not a big constant) — a huge edge z combined
 *  with node-internals refreshes made ReactFlow transiently drop edge handles
 *  ("Couldn't create edge for source handle id") on selection changes. */
export const EDGE_Z = 0;
/** Default node stacking — one above the default edge z (0) so lines tuck under
 *  tiles. Explicit `z` (bring-to-front / a background box's negative) overrides. */
export const NODE_Z = 1;

export function componentLookup(schema: PlatformSchema) {
  const m = new Map<string, { component: PlatformComponent; bandId: BandId }>();
  schema.bands.forEach((b) => b.components.forEach((c) => m.set(c.id, { component: c, bandId: b.id })));
  return m;
}

export function schemaToFlow(
  schema: PlatformSchema,
  deepLinks: Record<string, string | null>,
  onSelect: (id: string) => void,
  onContext: (id: string, x: number, y: number) => void,
  onResize: (id: string, w: number, h: number) => void,
  onRename: (id: string, label: string) => void,
  onSetDescription: (id: string, desc: string) => void,
  onAnnotate: (id: string, patch: Partial<AnnotationData>) => void,
): { nodes: Node[]; edges: Edge[] } {
  const lookup = componentLookup(schema);
  const hidden = new Set(schema.layout.hidden);

  const nodes: Node[] = [];
  for (const [id, pos] of Object.entries(schema.layout.nodes)) {
    // Free-form annotation node (text/box/logo/image) — no catalog component;
    // build it straight from the saved annotation props.
    if (pos.annotation) {
      const sz = ANNOTATION_DEFAULT_SIZE[pos.annotation.variant];
      const fp = nodeFootprint({ id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent, { w: pos.w ?? sz.w, h: pos.h ?? sz.h, rot: pos.rot });
      nodes.push({
        id,
        type: "annotation",
        position: { x: pos.x, y: pos.y },
        width: fp.w,
        height: fp.h,
        zIndex: pos.z ?? NODE_Z,
        style: { width: fp.w, height: fp.h },
        data: {
          nodeId: id,
          annotation: pos.annotation,
          component: { id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent,
          bandId: "sources" as BandId,
          bandColor: "#64748b",
          deepLink: null,
          onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate,
          rot: pos.rot ?? 0,
          w: pos.w, h: pos.h, scale: pos.scale,
          opacity: pos.opacity, fillColor: pos.fillColor, fontColor: pos.fontColor, iconColor: pos.iconColor,
          borderWidth: pos.borderWidth, borderStyle: pos.borderStyle, borderColor: pos.borderColor, borderRadius: pos.borderRadius, shadow: pos.shadow, groupId: pos.groupId,
        } satisfies AnnotationNodeData,
      });
      continue;
    }
    // Canvas-added data source ("+ more data sources") — not in the catalog.
    // Build a source component from pos.source + the unified logo catalog.
    if (pos.source) {
      const component: PlatformComponent = {
        id, label: pos.label ?? logoLabel(pos.source.key), icon: pos.icon ?? pos.source.icon,
        desc: "", state: "active",
      };
      const fp = nodeFootprint(component, pos);
      nodes.push({
        id, type: "component", position: { x: pos.x, y: pos.y },
        width: fp.w, height: fp.h, zIndex: pos.z ?? NODE_Z, style: { width: fp.w, height: fp.h },
        data: {
          nodeId: id, component, bandId: "sources" as BandId, bandColor: BAND_COLOR.sources,
          deepLink: null, onSelect, onContext, onResize, onRename, onSetDescription,
          allowTrademark: schema.enableTrademarkLogos ?? false,
          sourceKey: pos.source.key,
          sourceCaption: pos.sourceCaption,
          fontSize: pos.fontSize,
          desc: pos.desc,
          showDesc: pos.showDesc,
          rot: pos.rot ?? 0,
          w: pos.w, h: pos.h, scale: pos.scale,
          opacity: pos.opacity, fillColor: pos.fillColor, fontColor: pos.fontColor, iconColor: pos.iconColor,
          borderWidth: pos.borderWidth, borderStyle: pos.borderStyle, borderColor: pos.borderColor, borderRadius: pos.borderRadius, shadow: pos.shadow, groupId: pos.groupId,
        } satisfies NodeData,
      });
      continue;
    }
    // Node id may be an instance id (`genie#2`); resolve the catalog component
    // by its base id, but keep the instance id as the ReactFlow node id.
    const found = lookup.get(baseId(id));
    if (!found || hidden.has(id)) continue;
    const { bandId } = found;
    // Apply canvas-edited overrides (double-click rename / change-type / desc)
    // saved in the layout: label + icon + desc win over the catalog component.
    const component =
      pos.label !== undefined || pos.icon !== undefined || pos.desc !== undefined
        ? {
            ...found.component,
            ...(pos.label !== undefined ? { label: pos.label } : {}),
            ...(pos.icon !== undefined ? { icon: pos.icon } : {}),
            ...(pos.desc !== undefined ? { desc: pos.desc } : {}),
          }
        : found.component;
    const fp = nodeFootprint(component, pos);
    nodes.push({
      id,
      type: nodeTypeFor(component),
      position: { x: pos.x, y: pos.y },
      // ReactFlow OWNS the node size — NodeResizer drives these, and the shell
      // fills 100%, so the selection frame + resizer + visual never drift.
      width: fp.w,
      height: fp.h,
      zIndex: pos.z ?? NODE_Z,
      style: { width: fp.w, height: fp.h },
      data: {
        nodeId: id,
        component,
        bandId,
        bandColor: BAND_COLOR[bandId],
        deepLink: deepLinks[baseId(id)] ?? null,
        onSelect,
        onContext,
        onResize,
        onRename,
        onSetDescription,
        rot: pos.rot ?? 0,
        w: pos.w,
        h: pos.h,
        scale: pos.scale,
        opacity: pos.opacity,
        fillColor: pos.fillColor,
        fontColor: pos.fontColor,
        iconColor: pos.iconColor,
        borderWidth: pos.borderWidth,
        borderStyle: pos.borderStyle,
        borderColor: pos.borderColor,
        borderRadius: pos.borderRadius,
        shadow: pos.shadow,
        groupId: pos.groupId,
        sourceCaption: pos.sourceCaption,
        fontSize: pos.fontSize,
        desc: pos.desc,
        showDesc: pos.showDesc,
        allowTrademark: schema.enableTrademarkLogos ?? false,
      } satisfies NodeData,
    });
  }

  // Carry author-time symbolic placement + the pinned flag onto every node's data
  // (uniform post-pass so each construction branch above stays simple). These
  // round-trip through flowToLayout → serializeArchitecture so an unmoved node
  // re-emits its symbolic fields instead of flattening to pixel `at`.
  for (const n of nodes) {
    const pos = schema.layout.nodes[n.id];
    if (!pos) continue;
    const d = n.data as NodeData;
    if (pos.placement) d.placement = pos.placement;
    if (pos.pinned) d.pinned = true;
  }

  // Heal handles on saved edges: a ported composite (lakeflow / lakeflow-genie)
  // only has in-* ports + r/t/b/bl — NOT the plain sides t/r/b/l. Older edges
  // saved with e.g. targetHandle "l" make ReactFlow fail to position them
  // ("Couldn't create edge for handle id"), so the edge silently vanishes.
  // Map any such invalid handle to a real one.
  const kindOf = new Map(nodes.map((n) => [n.id, (n.data as NodeData | undefined)?.component?.kind]));
  const ported = (id: string) => { const k = kindOf.get(id); return k === "lakeflow" || k === "lakeflow-genie"; };
  const fixHandle = (id: string, h: string | null | undefined, end: "source" | "target") => {
    if (!ported(id)) return h ?? undefined;
    if (h && (h.startsWith("in-") || ["r", "t", "b", "bl"].includes(h))) return h;
    return end === "target" ? "in-direct" : "r";
  };
  const edges: Edge[] = schema.layout.edges
    .filter((e) => schema.layout.nodes[e.source] && schema.layout.nodes[e.target])
    .map((e) => flowToEdge(e))
    .map((e) => ({ ...e, sourceHandle: fixHandle(e.source, e.sourceHandle, "source"), targetHandle: fixHandle(e.target, e.targetHandle, "target") }));

  return { nodes, edges };
}

export function flowToEdge(e: PlatformEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    zIndex: EDGE_Z, // below nodes (EDGE_Z=0 < NODE_Z=1; see EDGE_Z docblock)
    // Restore saved handles (composite port id or side); fall back to the
    // default L→R so older/auto-seeded edges still render.
    sourceHandle: e.sourceHandle ?? "r",
    targetHandle: e.targetHandle ?? "l",
    type: "flow",
    data: { animated: e.animated ?? false, dashed: e.dashed ?? false, shape: e.shape ?? "smooth", flowStyle: e.flowStyle, arrow: e.arrow ?? "auto", centerX: e.centerX },
    label: e.label,
    // FlowEdge derives the visible stroke + arrow from the (possibly
    // auto-resolved) flowStyle; this is just the base.
    style: {
      stroke: "var(--muted-foreground)",
      strokeWidth: 1.5,
      opacity: 0.55,
      ...(e.dashed ? { strokeDasharray: "5 4" } : {}),
    },
    markerEnd: "url(#arrow)",
  };
}

/** Reverse of schemaToFlow: project the live ReactFlow nodes/edges back into a
 *  persistable layout (positions, edges, hidden). Pure data mapping — no save
 *  side-effects, no history/burst logic. */
export function flowToLayout(nds: Node[], eds: Edge[], schema: PlatformSchema): PlatformSchema["layout"] {
  const catalog = componentLookup(schema);
  const positions: Record<string, NodePosition> = {};
  nds.forEach((n) => {
    const dd = n.data as NodeData;
    const rot = dd.rot ?? 0;
    // Persist label/icon only when they DIFFER from the default — i.e. the
    // user renamed the node or changed its type on the canvas. For catalog
    // nodes the default is the catalog component; for canvas-added sources
    // (`dd.sourceKey`, not in the catalog) it's the logo's catalog label.
    const base = catalog.get(baseId(n.id))?.component;
    const defLabel = base ? base.label : dd.sourceKey ? logoLabel(dd.sourceKey) : undefined;
    const labelOv = defLabel !== undefined && dd.component.label !== defLabel ? dd.component.label : undefined;
    const iconOv = base && dd.component.icon !== base.icon ? dd.component.icon : undefined;
    // Description: sources carry it directly on dd.desc; catalog tiles carry it
    // on dd.component.desc and only persist it when it differs from the catalog
    // default (mirrors labelOv). Logos round-trip via `annotation`.
    const descOv = dd.sourceKey
      ? dd.desc
      : base && dd.component.desc !== base.desc
        ? dd.component.desc
        : undefined;
    // Annotation nodes carry their full props (text/icon/src/alignment).
    const anno = (dd as Partial<AnnotationNodeData>).annotation;
    positions[n.id] = {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      ...(rot ? { rot } : {}),
      ...(dd.w ? { w: Math.round(dd.w) } : {}),
      ...(dd.h ? { h: Math.round(dd.h) } : {}),
      ...(dd.scale && dd.scale !== 1 ? { scale: Math.round(dd.scale * 100) / 100 } : {}),
      ...(labelOv !== undefined ? { label: labelOv } : {}),
      ...(iconOv !== undefined ? { icon: iconOv } : {}),
      ...(descOv !== undefined ? { desc: descOv } : {}),
      ...(dd.showDesc !== undefined ? { showDesc: dd.showDesc } : {}),
      ...(anno ? { annotation: anno } : {}),
      ...(dd.sourceKey ? { source: { key: dd.sourceKey, icon: dd.component.icon } } : {}),
      ...(dd.sourceCaption !== undefined ? { sourceCaption: dd.sourceCaption } : {}),
      ...(dd.fontSize !== undefined ? { fontSize: dd.fontSize } : {}),
      ...(dd.opacity !== undefined ? { opacity: dd.opacity } : {}),
      ...(dd.fillColor !== undefined ? { fillColor: dd.fillColor } : {}),
      ...(dd.fontColor !== undefined ? { fontColor: dd.fontColor } : {}),
      ...(dd.iconColor !== undefined ? { iconColor: dd.iconColor } : {}),
      ...(dd.borderWidth !== undefined ? { borderWidth: dd.borderWidth } : {}),
      ...(dd.borderStyle !== undefined ? { borderStyle: dd.borderStyle } : {}),
      ...(dd.borderColor !== undefined ? { borderColor: dd.borderColor } : {}),
      ...(dd.borderRadius !== undefined ? { borderRadius: dd.borderRadius } : {}),
      ...(dd.shadow !== undefined ? { shadow: dd.shadow } : {}),
      ...(dd.groupId ? { groupId: dd.groupId } : {}),
      // Persist z only when it differs from the default node stacking (NODE_Z) —
      // so the render-time default doesn't get written onto every node.
      ...(typeof n.zIndex === "number" && n.zIndex !== NODE_Z && n.zIndex !== 0 ? { z: n.zIndex } : {}),
      // Round-trip symbolic placement: an unmoved node (dd.placement set, not
      // pinned) re-emits its col/relational fields; a dragged/at node is pinned.
      ...(dd.placement && !dd.pinned ? { placement: dd.placement } : {}),
      ...(dd.pinned ? { pinned: true } : {}),
    };
  });
  // `hidden` is keyed by catalog (base) ids: a component is hidden iff NO
  // instance of it is on the canvas (collapse `genie#2` → `genie`).
  const placed = new Set(nds.map((n) => baseId(n.id)));
  const hidden = [...componentLookup(schema).keys()].filter((id) => !placed.has(id));
  const layoutEdges: PlatformEdge[] = eds.map((e) => {
    const ed = e.data as EdgeData | undefined;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      animated: ed?.animated ?? false,
      dashed: ed?.dashed ?? false,
      shape: ed?.shape ?? "smooth",
      ...(ed?.flowStyle ? { flowStyle: ed.flowStyle } : {}),
      ...(ed?.arrow && ed.arrow !== "auto" ? { arrow: ed.arrow } : {}),
      ...(typeof ed?.centerX === "number" ? { centerX: ed.centerX } : {}),
      label: typeof e.label === "string" ? e.label : undefined,
    };
  });
  return { nodes: positions, edges: layoutEdges, hidden };
}
