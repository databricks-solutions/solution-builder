/**
 * platform-diagram/composite-medallion — the "Medallion Table" composite: the
 * three layer marks (Bronze · Silver · Gold), each recolored to its metal tone
 * with its name below, connected left→right by a small animated flow line (tiny
 * floating shapes). A composite node kind ("medallion-table"). The layer icons
 * paint at `currentColor`, so each column sets its own metal tone.
 *
 * OPTIONS (node.params): `feature_store` / `metric_views` — each adds a fork off
 * the GOLD layer, shown INSIDE the block (Feature Store above, Metric Views
 * below), and exposes an extra right-side OUTPUT handle so edges can wire to the
 * right fork: `out-gold` (always), `out-fs` / `out-mv` (when enabled).
 */
import { memo, useContext, useState, useEffect, useRef, Fragment, type ReactNode } from "react";
import { type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { BronzeLayerIcon, SilverLayerIcon, GoldLayerIcon, FeatureStoreBrandIcon, MetricViewsIcon } from "../../databricks-icons";
import { RotatableCard, medallionSize, DropTargetContext, EditModeContext, cardStyle, ConnectionDot, dotsOn, type DotSpec, type NodeData } from "./shared";

// Metal tones. Bronze + Silver render inline; Gold is the LAST column (inline,
// or the middle of the MV/Gold/FS stack when a fork option is on).
const BRONZE_SILVER = [
  { label: "Bronze", color: "#cd7f32", Icon: BronzeLayerIcon },
  { label: "Silver", color: "#9ca3af", Icon: SilverLayerIcon },
] as const;

// A short internal flow line with three super-small shapes (square · circle ·
// triangle) drifting left→right — the medallion "data flowing" cue, kept subtle.
// The viewBox is UNIFORM (36×36, meet) so the shapes stay round/square and never
// stretch; the line sits at y=18 (vertical center of the icon row).
const HOP_PATH = "M2 18 H34";
function Connector() {
  const shapes = ["sq", "circ", "tri"] as const;
  const N = shapes.length;
  const DUR = 3;
  // Nudge UP ~5px: the layer columns are icon + label STACKED, so their flex
  // centre sits below the icon centre. Shifting the connector up aligns it with
  // the middle of the logos (not the icon+label midpoint).
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 -translate-y-[5px] overflow-visible" preserveAspectRatio="xMidYMid meet">
      <path d={HOP_PATH} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.28} />
      {shapes.map((s, i) => (
        <g key={s} opacity={0.75}>
          {s === "sq" ? (
            <rect x={-1.6} y={-1.6} width={3.2} height={3.2} rx={0.5} fill="var(--muted-foreground)" />
          ) : s === "circ" ? (
            <circle r={1.7} fill="var(--muted-foreground)" />
          ) : (
            <path d="M0 -1.9 L1.7 1.4 L-1.7 1.4 Z" fill="var(--muted-foreground)" />
          )}
          <animateMotion dur={`${DUR}s`} begin={`${-(i * DUR) / N}s`} repeatCount="indefinite" path={HOP_PATH} />
        </g>
      ))}
    </svg>
  );
}

// Fan of flow lines from silver's right edge to EACH row of the output stack
// (top / mid / bottom), each with the drifting shapes. `rows` = how many rows,
// so the fan targets their vertical centers. Rendered in place of the plain
// Connector when a fork option is on. Width ~36 (same as Connector) so bronze/
// silver spacing is unchanged.
function FanConnector({ rows }: { rows: number }) {
  const H = rows * 38;           // total stack height (matches StackRow h-9 + gap)
  // Both ends align: the fork COLUMN is nudged up 5px (see its wrapper) to sit at
  // the Silver logo's centre, so a straight silver→gold line stays straight.
  const src = { x: 1, y: H / 2 };
  const shapes = ["sq", "circ", "tri"] as const;
  const DUR = 3;
  const targets = Array.from({ length: rows }, (_, r) => (r + 0.5) * (H / rows));
  return (
    <svg viewBox={`0 0 36 ${H}`} width={36} height={H} className="shrink-0 overflow-visible" style={{ alignSelf: "center" }}>
      {targets.map((ty, r) => {
        const path = `M${src.x} ${src.y} C 18 ${src.y}, 18 ${ty}, 35 ${ty}`;
        return (
          <g key={r}>
            <path d={path} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.28} />
            {shapes.map((s, i) => (
              <g key={s} opacity={0.75}>
                {s === "sq" ? <rect x={-1.6} y={-1.6} width={3.2} height={3.2} rx={0.5} fill="var(--muted-foreground)" />
                  : s === "circ" ? <circle r={1.7} fill="var(--muted-foreground)" />
                  : <path d="M0 -1.9 L1.7 1.4 L-1.7 1.4 Z" fill="var(--muted-foreground)" />}
                <animateMotion dur={`${DUR}s`} begin={`${-(i * DUR) / shapes.length}s`} repeatCount="indefinite" path={path} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// One row in the right-hand output column: a mark + its label, side by side.
// Used for Gold + the optional Feature Store (above) / Metric Views (below), all
// left-aligned in a single column so an output anchor lines up with each row.
// The output anchor is a plain right-side ConnectionDot rendered INSIDE this
// `relative` row — RF measures it from the DOM at the row's exact vertical
// center, so it always lines up (no separate frac math to drift), and it reuses
// the ONE dot renderer (same size/behaviour/edge-selected handling as every
// other anchor) rather than a forked copy.
// The row stretches to the block's right BORDER (the parent column cancels the
// block's px-3 with -mr-3) — so the dot's `side="r"` anchor lands exactly on the
// edge. `pr-3` keeps the label text off the border while the row box reaches it.
function StackRow({ Icon, label, color, handleId, editMode, on }: { Icon: (p: { className?: string; style?: React.CSSProperties }) => ReactNode; label: string; color?: string; handleId: string; editMode: boolean; on: boolean }) {
  return (
    <div className="relative flex h-9 w-full items-center gap-1.5 pr-3">
      <Icon className="h-9 w-9 shrink-0" style={color ? { color } : undefined} />
      <span className="whitespace-nowrap text-[11px] font-semibold leading-none" style={color ? { color } : { color: "var(--foreground)" }}>{label}</span>
      <ConnectionDot id={handleId} side="r" editMode={editMode} dotOn={on} />
    </div>
  );
}

/** Generic side anchors (source/target from any side): left, top, bottom always;
 *  the RIGHT `out-gold` anchor ONLY when NOT forked (a fork puts out-gold on its
 *  own row via a StackRow ConnectionDot). All float just outside the border like
 *  every other ConnectionDot. */
function MedallionPorts({ editMode, selected, isDropTarget, hasFork }: { editMode: boolean; selected: boolean; isDropTarget: boolean; hasFork: boolean }) {
  const on = dotsOn(selected, isDropTarget);
  const dots: DotSpec[] = [
    { id: "l", side: "l" },
    { id: "t", side: "t" },
    { id: "b", side: "b" },
    ...(hasFork ? [] : [{ id: "out-gold", side: "r" } as DotSpec]),
  ];
  return <>{dots.map((s) => <ConnectionDot key={s.id} {...s} editMode={editMode} dotOn={on} />)}</>;
}

export const MedallionBlock = memo(function MedallionBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const fs = !!d.params?.feature_store;
  const mv = !!d.params?.metric_views;
  const hasFork = fs || mv;
  // The exposed handle SET changes with the fork options + rotation. ReactFlow
  // caches each node's handle positions (handleBounds); toggling an option would
  // otherwise leave edges anchored to a STALE position. Re-measure ONLY when the
  // set actually CHANGES — NOT on mount. A mount-time updateNodeInternals forces
  // a global re-measure while RF is still committing; during that frame
  // getEdgePosition finds an empty handle map and drops EVERY edge on the canvas
  // ("Couldn't create edge for handle id …" → all lines vanish). Skipping the
  // first run avoids that thrash (RF already measures handles on mount anyway).
  const updateNodeInternals = useUpdateNodeInternals();
  const handleSig = `${fs}|${mv}|${d.rot ?? 0}`;
  const prevSig = useRef(handleSig);
  useEffect(() => {
    if (prevSig.current === handleSig) return; // mount or unrelated re-render
    prevSig.current = handleSig;
    updateNodeInternals(d.nodeId);
  }, [handleSig, d.nodeId, updateNodeInternals]);
  const forkRows = 1 + (fs ? 1 : 0) + (mv ? 1 : 0);
  // Size from the SHARED helper so the composite and the ReactFlow node box (the
  // selection frame / resize handles) always agree.
  const { w: natW, h: natH } = medallionSize(d.params);
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16 });
  // Title behaves like a box legend: double-click the top edge (or use the panel
  // Title input) to edit. Stored as the component label via onRename; falls back
  // to "Ingestion (SDP)" when unset/default.
  const DEFAULT_TITLE = "Ingestion (SDP)";
  const label = d.component.label;
  const title = label && label !== "Medallion Table" ? label : DEFAULT_TITLE;
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const commitTitle = () => {
    if (editingTitle !== null) { d.onRename(d.nodeId, editingTitle.trim()); setEditingTitle(null); }
  };
  const legendMask = card.hasFill ? (d.fillColor as string) : "var(--card)";
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? natW}
      h={d.h ?? natH}
      scale={d.scale ?? 1}
      baseW={natW}
      baseH={natH}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      hideHandles
      onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
      onScale={(w) => d.onResize(d.nodeId, w, Math.round((w * natH) / natW), w / natW)}
      stack={d.stack}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <MedallionPorts editMode={editMode} selected={!!selected} isDropTarget={isDropTarget} hasFork={hasFork} />
      {/* Title legend on the top border — wide double-click strip (like a box). */}
      <div
        onClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(title === DEFAULT_TITLE ? "" : title); }}
        title="Double-click to edit title"
        className="absolute inset-x-0 top-0 z-10 flex h-4 -translate-y-1/2 items-center"
        style={{ cursor: "text" }}
      >
        <div className="ml-3 flex items-center" style={{ background: legendMask, padding: "0 6px", borderRadius: 6 }}>
          {editingTitle !== null ? (
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); else if (e.key === "Escape") setEditingTitle(null); e.stopPropagation(); }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Title"
              className="bg-transparent text-[12px] font-semibold leading-none text-foreground outline-none"
            />
          ) : (
            <span className="truncate text-[12px] font-semibold leading-none text-foreground">{title}</span>
          )}
        </div>
      </div>
      <div
        onClick={() => d.onSelect(d.nodeId)}
        // NOTE: overflow-VISIBLE (not hidden) — the per-row output dots (StackRow)
        // float just OUTSIDE the right border; overflow-hidden would crop them.
        // The card content is centered and never reaches the rounded corners, so
        // not clipping is safe here (the fill/border still round via the radius).
        className={`flex h-full w-full flex-col overflow-visible rounded-[16px] transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full flex-col px-3 pb-2 pt-2" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "center" }}>
          <div className="flex min-h-0 flex-1 items-center justify-center gap-1">
            {/* Bronze → Silver (icon + label stacked). */}
            {BRONZE_SILVER.map((l, i) => (
              <Fragment key={l.label}>
                {i > 0 && <Connector />}
                <div className="flex flex-col items-center gap-0.5">
                  <l.Icon className="h-9 w-9 shrink-0" style={{ color: l.color }} />
                  <span className="text-[11px] font-semibold leading-none" style={{ color: l.color }}>{l.label}</span>
                </div>
              </Fragment>
            ))}
            {/* Silver → (Gold | fork stack). A fan draws a line to EVERY row.
                Each row carries its own output handle (StackRow) so it anchors
                + connects at the row. */}
            {hasFork ? (
              <>
                {/* Both the fan AND the output column nudge UP 5px so they leave
                    from / align with the Silver logo's centre (its column is
                    icon+label stacked). Keeps the silver→gold run straight. */}
                <div className="-translate-y-[5px]"><FanConnector rows={forkRows} /></div>
                {/* Output column: FS (top) · Gold (mid) · MV (bottom). `-mr-3`
                    cancels the block's px-3 so the rows reach the right BORDER and
                    each per-row handle+dot sits on the edge (not tucked inside). */}
                <div className="-mr-3 flex flex-1 -translate-y-[5px] flex-col justify-center gap-1">
                  {fs && <StackRow Icon={FeatureStoreBrandIcon} label="Feature store" color="#d4a72c" handleId="out-fs" editMode={editMode} on={dotsOn(!!selected, isDropTarget)} />}
                  <StackRow Icon={GoldLayerIcon} label="Gold" color="#d4a72c" handleId="out-gold" editMode={editMode} on={dotsOn(!!selected, isDropTarget)} />
                  {mv && <StackRow Icon={MetricViewsIcon} label="Metric views" color="#d4a72c" handleId="out-mv" editMode={editMode} on={dotsOn(!!selected, isDropTarget)} />}
                </div>
              </>
            ) : (
              <>
                <Connector />
                {/* Non-fork Gold: the right-side `out-gold` anchor is provided by
                    MedallionPorts (a border-floating ConnectionDot), so this column
                    is purely visual. */}
                <div className="flex flex-col items-center gap-0.5">
                  <GoldLayerIcon className="h-9 w-9 shrink-0" style={{ color: "#d4a72c" }} />
                  <span className="text-[11px] font-semibold leading-none" style={{ color: "#d4a72c" }}>Gold</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
