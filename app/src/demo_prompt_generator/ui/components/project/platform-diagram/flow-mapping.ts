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
  logoFootprint,
  naturalSize,
  isDerivedNodeId,
  cardLayout,
  withCardFont,
  htmlBlockLayout,
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
  onAutoHeight?: (id: string, h: number) => void,
): { nodes: Node[]; edges: Edge[] } {
  const lookup = componentLookup(schema);
  const hidden = new Set(schema.layout.hidden);

  const nodes: Node[] = [];
  for (const [id, pos] of Object.entries(schema.layout.nodes)) {
    // Free-form annotation node (text/box/logo/image) — no catalog component;
    // build it straight from the saved annotation props.
    if (pos.annotation) {
      const sz = ANNOTATION_DEFAULT_SIZE[pos.annotation.variant];
      // A captioned LOGO with no explicit w/h (e.g. col-placed) sizes its box to
      // the full icon+caption footprint, so the box wraps the centered icon+text
      // unit tightly (matches computeLayout's sizeOf + the render). An explicit
      // w/h (dragged / add-time-sized) still wins.
      const base =
        // A card's height is measured from its text (the same cardLayout the
        // render draws from); an explicit w/h sets the width / a height floor.
        pos.annotation.variant === "card"
          ? (() => { const l = cardLayout(withCardFont(pos.annotation!, pos.cardFont), { w: pos.w, h: pos.h }); return { w: l.w, h: l.h }; })()
          // An html block is measured from its HTML (the same htmlBlockLayout the render draws).
          : pos.annotation.variant === "html"
          ? htmlBlockLayout(pos.annotation.html, { w: pos.w, h: pos.h }, pos.annotation.padding ?? 0)
          : pos.annotation.variant === "logo" && !pos.w && !pos.h
          // A same-lane captioned-logo group imposes a uniform width (step 2.5's
          // derived `laneW`) so the cards match + icons align; otherwise the box
          // hugs the icon+caption footprint. An explicit w/h still wins.
          ? (() => {
              const a = { ...pos.annotation, fontSize: pos.annotation.fontSize ?? (schema.theme === "slide" ? 18 : undefined) };
              const f = logoFootprint(sz.w, sz.h, a);
              return { w: pos.laneW ?? f.w, h: f.h };
            })()
          : { w: pos.w ?? sz.w, h: pos.h ?? sz.h };
      const fp = nodeFootprint({ id, label: "", icon: "data", desc: "", state: "active" } as PlatformComponent, { w: base.w, h: base.h, rot: pos.rot });
      nodes.push({
        id,
        type: "annotation",
        position: { x: pos.x, y: pos.y },
        width: fp.w,
        height: fp.h,
        zIndex: pos.z ?? pos.autoZ ?? NODE_Z,
        style: { width: fp.w, height: fp.h },
        data: {
          nodeId: id,
          type: pos.type ?? pos.annotation.variant,
          theme: schema.theme,
          annotation: pos.annotation,
          component: { id, label: (pos.annotation.title ?? pos.annotation.text ?? "").split("\n")[0].replace(/[*#`]/g, "").trim(), icon: "data", desc: pos.annotation.desc ?? "", state: "active" } as PlatformComponent,
          bandId: "sources" as BandId,
          bandColor: "#64748b",
          deepLink: pos.url ?? null,
          onSelect, onContext, onResize, onRename, onSetDescription, onAnnotate,
          rot: pos.rot ?? 0,
          // Keep w/h as the FILE's explicit size (undefined for a col-placed logo,
          // so it round-trips symbolically — no frozen `size` on save). The render
          // (RotatableCard for a captioned logo) derives the footprint itself when
          // w/h are absent, filling the RF box computed above.
          w: pos.w, h: pos.h, laneW: pos.laneW, cardFont: pos.cardFont, scale: pos.scale,
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
      const verticalSource = pos.sourceCaption === "top" || pos.sourceCaption === "bottom";
      const themed = pos.w === undefined && pos.h === undefined && !verticalSource
        ? naturalSize("source")
        : null;
      // When wrap-desc auto-grows the box, leave `h` unset so nodeFootprint owns
      // the (nat + wrapped-lines) height; else keep the themed height as before.
      // A lane-uniform `laneW` (step 2.5) wins over the themed width: the card
      // renders at laneW, so the node box (export crop, anchors) must match it.
      const fp = nodeFootprint(component, themed ? { ...pos, theme: schema.theme, w: pos.laneW ?? themed.w, ...(pos.wrapDesc ? {} : { h: themed.h }) } : { ...pos, theme: schema.theme });
      nodes.push({
        id, type: "component", position: { x: pos.x, y: pos.y },
        width: fp.w, height: fp.h, zIndex: pos.z ?? pos.autoZ ?? NODE_Z, style: { width: fp.w, height: fp.h },
        data: {
          nodeId: id, type: pos.type ?? "source", theme: schema.theme, component, bandId: "sources" as BandId, bandColor: BAND_COLOR.sources,
          deepLink: pos.url ?? null, onSelect, onContext, onResize, onRename, onSetDescription, onAutoHeight,
          allowTrademark: schema.enableTrademarkLogos ?? false,
          sourceKey: pos.source.key,
          sourceCaption: pos.sourceCaption,
          laneW: pos.laneW,
          fontSize: pos.fontSize,
          desc: pos.desc,
          showDesc: pos.showDesc,
          wrapDesc: pos.wrapDesc,
          rot: pos.rot ?? 0,
          w: pos.w, h: pos.h, scale: pos.scale,
          opacity: pos.opacity, fillColor: pos.fillColor, fontColor: pos.fontColor, iconColor: pos.iconColor,
          borderWidth: pos.borderWidth, borderStyle: pos.borderStyle, borderColor: pos.borderColor, borderRadius: pos.borderRadius, shadow: pos.shadow, groupId: pos.groupId,
        } satisfies NodeData,
      });
      continue;
    }
    // Resolve the catalog component by the node's TYPE (the source of truth) —
    // the `id` is a free-form instance handle and need not equal the type. Keep
    // the id as the ReactFlow node id.
    if (hidden.has(id)) continue;
    const compType = pos.type ?? baseId(id); // pos.type is always set on parse; fallback is defensive
    // Unknown type (e.g. a component id removed from the catalog): don't silently
    // drop it — render a labeled placeholder tile so the node stays visible +
    // editable. The user can re-pick its type.
    const found = lookup.get(compType) ?? {
      component: {
        id: compType,
        label: compType,
        icon: "data" as const,
        desc: "Unknown component — this type isn't in the catalog (it may have been removed or renamed). Pick a type.",
        state: "active" as const,
      } satisfies PlatformComponent,
      bandId: "sources" as BandId,
    };
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
    const themed = pos.w === undefined && pos.h === undefined
      ? naturalSize(compType, pos.params, pos.sources)
      : null;
    const fp = nodeFootprint(component, themed ? { ...pos, w: themed.w, theme: schema.theme, ...(pos.wrapDesc ? {} : { h: themed.h }) } : { ...pos, theme: schema.theme });
    nodes.push({
      id,
      type: nodeTypeFor(component),
      position: { x: pos.x, y: pos.y },
      // ReactFlow OWNS the node size — NodeResizer drives these, and the shell
      // fills 100%, so the selection frame + resizer + visual never drift.
      width: fp.w,
      height: fp.h,
      zIndex: pos.z ?? pos.autoZ ?? NODE_Z,
      style: { width: fp.w, height: fp.h },
      data: {
        nodeId: id,
        type: compType,
        theme: schema.theme,
        component,
        bandId,
        bandColor: BAND_COLOR[bandId],
        deepLink: pos.url ?? deepLinks[compType] ?? null,
        onSelect,
        onContext,
        onResize,
        onRename,
        onSetDescription,
        onAutoHeight,
        rot: pos.rot ?? 0,
        w: pos.w,
        h: pos.h,
        scale: pos.scale,
        opacity: pos.opacity,
        fillColor: pos.fillColor,
        fontColor: pos.fontColor,
        headerFill: pos.headerFill,
        iconColor: pos.iconColor,
        borderWidth: pos.borderWidth,
        borderStyle: pos.borderStyle,
        borderColor: pos.borderColor,
        borderRadius: pos.borderRadius,
        shadow: pos.shadow,
        groupId: pos.groupId,
        sourceCaption: pos.sourceCaption,
        laneW: pos.laneW,
        fontSize: pos.fontSize,
        desc: pos.desc,
        showDesc: pos.showDesc,
        wrapDesc: pos.wrapDesc,
        allowTrademark: schema.enableTrademarkLogos ?? false,
      } satisfies NodeData,
    });
  }

  // Carry author-time symbolic placement + the pinned flag onto every node's data
  // (uniform post-pass so each construction branch above stays simple). These
  // round-trip through flowToLayout → serializeArchitecture so an unmoved node
  // re-emits its symbolic fields instead of flattening to pixel `at`.
  for (const n of nodes) {
    // The DERIVED legend box (synthesized from the tab's `legend`): it isn't a
    // file node, so it must not be draggable or selectable — otherwise the user
    // could move/edit something that has nowhere to persist. Edit it by editing
    // `legend` (or drop a plain box if you want a free-form one).
    if (isDerivedNodeId(n.id)) { n.draggable = false; n.selectable = false; }
    const pos = schema.layout.nodes[n.id];
    if (!pos) continue;
    const d = n.data as NodeData;
    if (pos.placement) d.placement = pos.placement;
    if (pos.pinned) d.pinned = true;
    if (pos.params) d.params = pos.params;
    if (pos.sources) d.sources = pos.sources;
    if (pos.stack && pos.stack > 1) d.stack = pos.stack;
    if (pos.ai_reasoning) d.ai_reasoning = pos.ai_reasoning;
  }

  // Heal saved edge handles against the handles a node ACTUALLY exposes right
  // now. A composite's named ports depend on its kind AND its current params
  // (e.g. the medallion table only exposes `out-fs` while `feature_store` is on).
  // If an edge references a handle that isn't currently available — an older
  // file, or an option the user just turned OFF — ReactFlow can't place it and
  // the whole line silently vanishes. So: compute each node's available-handle
  // set, and remap any missing handle to the nearest sensible fallback. GENERAL —
  // works for any component that declares its handles via `handlesFor`.
  const dataOf = new Map(nodes.map((n) => [n.id, n.data as NodeData | undefined]));
  const fixHandle = (id: string, h: string | null | undefined, end: "source" | "target") => {
    const d = dataOf.get(id);
    if (!d) return h ?? undefined;
    const set = handlesFor(d);
    if (!set) return h ?? undefined;         // no declared handle set → leave as-is
    if (h && set.has(h)) return h;           // still valid → keep
    return fallbackHandle(set, h, end);      // missing → nearest available
  };
  const edges: Edge[] = schema.layout.edges
    .filter((e) => schema.layout.nodes[e.source] && schema.layout.nodes[e.target])
    .map((e) => flowToEdge(e, schema.theme, schema.edgeLabelSize))
    .map((e) => ({ ...e, sourceHandle: fixHandle(e.source, e.sourceHandle, "source"), targetHandle: fixHandle(e.target, e.targetHandle, "target") }));

  return { nodes, edges };
}

/** The set of handle ids a node currently exposes (composite ports that depend
 *  on kind + params, plus the generic sides). Returns null for plain nodes,
 *  whose handles (`l`/`r`/`t`/`b`) are always all present so no healing is
 *  needed. Extend this as composites gain param-driven ports. */
export function handlesFor(d: NodeData): Set<string> | null {
  const kind = d.component?.kind;
  const sides = ["l", "r", "t", "b"];
  if (kind === "lakeflow" || kind === "lakeflow-genie") {
    return new Set(["in-lakeflow-connect", "in-zerobus", "in-direct", "r", "t", "b", "bl"]);
  }
  if (kind === "medallion-table") {
    const p = d.params ?? {};
    return new Set([
      ...sides,
      "out-gold",
      ...(p.feature_store ? ["out-fs"] : []),
      ...(p.metric_views ? ["out-mv"] : []),
    ]);
  }
  return null;
}

/** Pick a fallback handle from the available set for a handle that no longer
 *  exists. Prefer the SAME side family (an `out-*` falls back to another `out-*`,
 *  ideally `out-gold`; a plain side to another side), else the primary in/out. */
export function fallbackHandle(set: Set<string>, missing: string | null | undefined, end: "source" | "target"): string | undefined {
  const has = (h: string) => set.has(h);
  // A dropped medallion output → the always-present gold output.
  if (missing && missing.startsWith("out-") && has("out-gold")) return "out-gold";
  // A ported-composite target → its default file-landing input.
  if (end === "target" && has("in-direct")) return "in-direct";
  // Otherwise the natural side: source leaves right, target enters left.
  if (end === "source" && has("r")) return "r";
  if (end === "target" && has("l")) return "l";
  // Last resort: any available handle.
  return set.values().next().value as string | undefined;
}

export function flowToEdge(e: PlatformEdge, theme: PlatformSchema["theme"] = "technical", labelFontSize?: number): Edge {
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
    // NOTE: this rebuilds `data` field-by-field, so ANY new persisted edge property
    // must be added here as well as to the two serialisers. Omit it and the value
    // round-trips to the file correctly and is then dropped on the way back in —
    // which looks exactly like "it doesn't persist" while the saved JSON is fine.
    data: { theme, labelFontSize, animated: e.animated ?? false, dashed: e.dashed ?? false, color: e.color, shape: e.shape ?? "smooth", flowStyle: e.flowStyle, arrow: e.arrow ?? "auto", centerX: e.centerX, bezier: e.bezier, controlPoints: e.controlPoints, waypoints: e.waypoints, labelPos: e.labelPos },
    label: e.label,
    // FlowEdge derives the visible stroke + arrow from the (possibly
    // auto-resolved) flowStyle; this is just the base.
    style: {
      stroke: e.color ?? "var(--muted-foreground)",
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
    // Never persist a DERIVED node (legend box, frame title band) —
    // parseArchitecture re-synthesizes them from `legend` / `frame` on every load.
    if (isDerivedNodeId(n.id)) return;
    const dd = n.data as NodeData;
    const rot = dd.rot ?? 0;
    // Persist label/icon only when they DIFFER from the default — i.e. the
    // user renamed the node or changed its type on the canvas. For catalog
    // nodes the default is the catalog component; for canvas-added sources
    // (`dd.sourceKey`, not in the catalog) it's the logo's catalog label.
    const base = catalog.get(dd.type)?.component;
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
    // A wrapping box (its z is the auto default, not to be persisted). Boxes keep
    // their `wraps` in placement (symbolic, un-pinned).
    const isWrappingBox = !!(dd.placement?.wraps?.length);
    positions[n.id] = {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      type: dd.type,
      ...(rot ? { rot } : {}),
      ...(dd.w ? { w: Math.round(dd.w) } : {}),
      ...(dd.h ? { h: Math.round(dd.h) } : {}),
      ...(dd.scale && dd.scale !== 1 ? { scale: Math.round(dd.scale * 100) / 100 } : {}),
      ...(labelOv !== undefined ? { label: labelOv } : {}),
      ...(iconOv !== undefined ? { icon: iconOv } : {}),
      ...(descOv !== undefined ? { desc: descOv } : {}),
      ...(dd.showDesc !== undefined ? { showDesc: dd.showDesc } : {}),
      ...(dd.wrapDesc !== undefined ? { wrapDesc: dd.wrapDesc } : {}),
      ...(anno ? { annotation: anno } : {}),
      ...(dd.sourceKey ? { source: { key: dd.sourceKey, icon: dd.component.icon } } : {}),
      ...(dd.sourceCaption !== undefined ? { sourceCaption: dd.sourceCaption } : {}),
      ...(Array.isArray(dd.sources) && dd.sources.length ? { sources: dd.sources } : {}),
      ...(dd.fontSize !== undefined ? { fontSize: dd.fontSize } : {}),
      ...(dd.opacity !== undefined ? { opacity: dd.opacity } : {}),
      ...(dd.fillColor !== undefined ? { fillColor: dd.fillColor } : {}),
      ...(dd.fontColor !== undefined ? { fontColor: dd.fontColor } : {}),
      ...(dd.headerFill !== undefined ? { headerFill: dd.headerFill } : {}),
      ...(dd.iconColor !== undefined ? { iconColor: dd.iconColor } : {}),
      ...(dd.borderWidth !== undefined ? { borderWidth: dd.borderWidth } : {}),
      ...(dd.borderStyle !== undefined ? { borderStyle: dd.borderStyle } : {}),
      ...(dd.borderColor !== undefined ? { borderColor: dd.borderColor } : {}),
      ...(dd.borderRadius !== undefined ? { borderRadius: dd.borderRadius } : {}),
      ...(dd.shadow !== undefined ? { shadow: dd.shadow } : {}),
      ...(dd.groupId ? { groupId: dd.groupId } : {}),
      // Persist z only when it differs from the default node stacking (NODE_Z) —
      // so the render-time default doesn't get written onto every node. An
      // explicit z:0 (tuck a node to edge-level, below other tiles) IS a real
      // author choice and must round-trip — only skip the NODE_Z default (a
      // node with no authored z already renders at NODE_Z, so n.zIndex is 1, not
      // 0; only an intentional z:0 reaches here as 0).
      // EXCEPTION: a wrapping box's negative z is the AUTO default (autoBoxZ),
      // recomputed on every parse — never persist it (else every box would grow
      // a hand-set `z`, the footgun we removed). A box needs no `z` in the file.
      ...(typeof n.zIndex === "number" && n.zIndex !== NODE_Z && !(isWrappingBox && n.zIndex < 0) ? { z: n.zIndex } : {}),
      // Round-trip symbolic placement: an unmoved node (dd.placement set, not
      // pinned) re-emits its col/relational fields; a dragged/at node is pinned.
      ...(dd.placement && !dd.pinned ? { placement: dd.placement } : {}),
      ...(dd.pinned ? { pinned: true } : {}),
      ...(dd.params && Object.keys(dd.params).length ? { params: dd.params } : {}),
      ...(dd.stack && dd.stack > 1 ? { stack: dd.stack } : {}),
      ...(dd.ai_reasoning ? { ai_reasoning: dd.ai_reasoning } : {}),
    };
  });
  // `hidden` is keyed by catalog component TYPE: a component is hidden iff NO
  // instance of that type is on the canvas (two instances share one `type`).
  const placed = new Set(nds.map((n) => (n.data as NodeData).type));
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
      ...(ed?.color ? { color: ed.color } : {}),
      shape: ed?.shape ?? "smooth",
      ...(ed?.flowStyle ? { flowStyle: ed.flowStyle } : {}),
      ...(ed?.arrow && ed.arrow !== "auto" ? { arrow: ed.arrow } : {}),
      ...(typeof ed?.centerX === "number" ? { centerX: ed.centerX } : {}),
      // Manual routing + label placement must survive the SAVE, not just the load.
      // This is the write half of the round trip and it silently dropped all four of
      // these, so any node move persisted a layout without them and the reseed then
      // "correctly" restored an auto-placed label / default route. The read side
      // being right is not enough — both halves have to carry every persisted field.
      ...(ed?.bezier ? { bezier: true } : {}),
      ...(ed?.controlPoints ? { controlPoints: ed.controlPoints } : {}),
      ...(ed?.waypoints ? { waypoints: ed.waypoints } : {}),
      ...(ed?.labelPos ? { labelPos: ed.labelPos } : {}),
      label: typeof e.label === "string" ? e.label : undefined,
    };
  });
  return { nodes: positions, edges: layoutEdges, hidden };
}
