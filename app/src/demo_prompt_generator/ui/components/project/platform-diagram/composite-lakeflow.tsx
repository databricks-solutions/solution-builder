/**
 * platform-diagram/composite-lakeflow — the composite "Lakeflow" super-block
 * (Lakeflow Connect + Zerobus + direct file ingest feeding a bronze→silver→gold
 * Spark Declarative Pipeline) plus its medallion-cylinder pieces and the named
 * left-side input ports. First of several composite blocks.
 */
import { memo, useContext, Fragment, type ReactNode } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, ConnectionDot, dotsOn, type DotSpec, type NodeData } from "./shared";
import { type Side } from "./edge-routing";

export const MEDALLION = [
  { label: "Bronze", color: "#cd7f32" },
  { label: "Silver", color: "#9ca3af" },
  { label: "Gold", color: "#d4a72c" },
] as const;

// The 3 left input ports. Lakeflow Connect + Zerobus are shown as vertical
// boxes; "direct" is an unlabelled anchor in the empty space below them.
// Anchor fractions aligned to the stacked left rails: Connect (top rail),
// Zerobus (middle rail), direct (the empty zone at the bottom). Keep in sync
// with PORT_FRAC used by the edge anchor logic.
export const LF_PORTS = [
  { port: "lakeflow-connect", frac: 0.17 },
  { port: "zerobus", frac: 0.5 },
  { port: "direct", frac: 0.83 },
] as const;

// Single source of truth for composite port fractions: handle id → left-side
// fraction. Derived from LF_PORTS so the rendered handle, the drag-snap
// (portsOf), and the committed-edge anchor (portAnchor) can never drift.
export const PORT_FRAC: Record<string, number> = Object.fromEntries(
  LF_PORTS.map((p) => [`in-${p.port}`, p.frac]),
);

/** Composite blocks expose named input ports on their LEFT side at fixed
 *  fractions (handle id `in-<port>`). An edge connected to such a handle
 *  anchors there directly (no fan spread). Returns null for normal handles. */
export function portAnchor(handleId: string | null | undefined): { side: Side; frac: number } | null {
  if (handleId && handleId in PORT_FRAC) return { side: "l", frac: PORT_FRAC[handleId] };
  // Bottom-left anchor (under the files zone): bottom side, near the left edge.
  if (handleId === "bl") return { side: "b", frac: 0.08 };
  return null;
}

/** A couple of stacked, agnostic "data file" sheets (CSV/Parquet/etc) — used
 *  for the direct-files ingest zone instead of a format-specific logo. */
function StackedFiles() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none">
      <rect x="7" y="3" width="11" height="14" rx="1.5" fill="#fff" stroke="#94a3b8" strokeWidth="1.4" />
      <rect x="4" y="6" width="11" height="14" rx="1.5" fill="#fff" stroke="#64748b" strokeWidth="1.4" />
      <path d="M7 10h5M7 13h5M7 16h3" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** An ingest "zone" flush against the block's left edge — icon on top + a
 *  single line of VERTICAL text reading downward. Tinted band fill, no rounded
 *  pill, so it reads as part of the block's left side (zones), not a tile. */
function IngestBox({ icon, iconEl, label, bandColor, first }: { icon?: DatabricksIconName; iconEl?: React.ReactNode; label: string; bandColor: string; first?: boolean }) {
  const Icon = icon ? DATABRICKS_ICONS[icon] || DATABRICKS_ICONS.data : null;
  return (
    <div
      className={`flex flex-1 flex-row items-center justify-center gap-1 px-1 py-2 ${first ? "" : "border-t"}`}
      style={{ borderColor: `${bandColor}33`, background: `${bandColor}12` }}
    >
      {label && (
        <span
          className="text-[7.5px] font-bold uppercase tracking-[0.08em] leading-none text-foreground/80"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {label}
        </span>
      )}
      {iconEl ?? (Icon ? <Icon className="h-4 w-4 shrink-0" /> : null)}
    </div>
  );
}

/** A DATABASE glyph for a medallion layer: the classic cylinder ("tube") DB
 *  shape — top ellipse, body, two stacked "data band" ellipses — filled in the
 *  layer color, with the layer name underneath. */
export function DbTable({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-[2px]">
      {/* Grows with the block, but capped so the cylinders don't get so tall
          they widen past each other (aspect-locked SVG). Past the cap they
          just sit centered in the extra space. */}
      <svg viewBox="0 0 24 28" className="min-h-0 w-auto flex-1" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 48, overflow: "visible" }}>
        {/* body */}
        <path d="M2 5 V21 a10 4 0 0 0 20 0 V5" fill={`${color}26`} stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
        {/* inner data bands */}
        <path d="M2 11 a10 4 0 0 0 20 0" fill="none" stroke={`${color}99`} strokeWidth="1.1" />
        <path d="M2 16 a10 4 0 0 0 20 0" fill="none" stroke={`${color}99`} strokeWidth="1.1" />
        {/* top ellipse (rim) */}
        <ellipse cx="12" cy="5" rx="10" ry="4" fill={`${color}40`} stroke={color} strokeWidth="1.4" />
      </svg>
      <span className="text-[7.5px] font-bold uppercase tracking-wide leading-none" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

/** The bronze → silver → gold cylinders, packed close together with a thin
 *  light connector bar between each (the medallion flow). */
export function MedallionRow() {
  return (
    <div className="flex min-h-0 flex-1 items-stretch justify-center gap-[2px]">
      {MEDALLION.map((m, i) => (
        <Fragment key={m.label}>
          {i > 0 && <span className="my-auto h-[2px] w-3 shrink-0 rounded-full bg-muted-foreground/25" />}
          <DbTable label={m.label} color={m.color} />
        </Fragment>
      ))}
    </div>
  );
}

export const LakeflowBlock = memo(function LakeflowBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16 });
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      baseW={nat.w}
      baseH={nat.h}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      hideHandles
      onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
      onScale={(w) => d.onResize(d.nodeId, w, Math.round((w * nat.h) / nat.w), w / nat.w)}
      stack={d.stack}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <LakeflowPorts editMode={editMode} selected={!!selected} isDropTarget={isDropTarget} />

      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          <LakeflowBody d={d} />
        </div>
      </div>
    </RotatableCard>
  );
});

/** The Lakeflow input/output handles — the composite's answer to the generic
 *  4-side dots. These ARE the connection anchors: named input ports on the left
 *  (Connect / Zerobus / direct) plus generic anchors on right / top / bottom /
 *  bottom-left, so you can draw a fresh edge from any side. "Ports take priority,
 *  dedup by side" falls out naturally — each side already has exactly one handle.
 *
 *  Visibility mirrors the plain node's dots: hidden at rest, fade in on hover in
 *  edit mode, and forced ON when the block is SELECTED or a reconnect drop
 *  target — so selecting a composite shows the same "here's where to pull from"
 *  affordance a plain tile does. Connectable whenever we're in edit mode (a
 *  selected node must still be draggable-from, like NodeHandles). Shared by the
 *  standalone Lakeflow block and the combined Lakeflow + Genie block. */
export function LakeflowPorts({ editMode, selected, isDropTarget }: { editMode: boolean; selected: boolean; isDropTarget: boolean }) {
  const on = dotsOn(selected, isDropTarget);
  return (
    <>
      {LAKEFLOW_DOTS.map((s) => (
        <ConnectionDot key={s.id} {...s} editMode={editMode} dotOn={on} />
      ))}
    </>
  );
}

/** The Lakeflow block's anchors, as ConnectionDot specs (same dots as a plain
 *  node): 3 named input ports on the LEFT at their rail fractions, plus generic
 *  right / top / bottom / bottom-left anchors so an edge can start from any side.
 *  Frac for `bl` matches portAnchor's bottom:0.08 (under the files zone). */
const LAKEFLOW_DOTS: DotSpec[] = [
  ...LF_PORTS.map((p) => ({ id: `in-${p.port}`, side: "l" as const, frac: p.frac })),
  { id: "r", side: "r" },
  { id: "t", side: "t" },
  { id: "b", side: "b" },
  { id: "bl", side: "b", frac: 0.08 },
];

/** The Lakeflow inner content (ingest rail + SDP/medallion panel), WITHOUT the
 *  card chrome — so it can be embedded standalone or stacked above Genie Code
 *  in the combined block. An optional `footer` renders inside the RIGHT column,
 *  below the SDP/Open-Format panel — so it aligns under that panel and the
 *  full-height ingest rail stays on its left (not spanned by the footer). */
export function LakeflowBody({ d, footer }: { d: NodeData; footer?: ReactNode }) {
  return (
    <>
      {/* LEFT: ingest zones stacked vertically, flush against the block edge
          — Connect (top), Zerobus (middle), files (bottom = direct port).
          Each zone aligns with its left-edge input port. */}
      <div className="flex w-9 shrink-0 flex-col border-r" style={{ borderColor: `${d.bandColor}33` }}>
        <IngestBox icon="lakeflowConnectBrand" label="Connect" bandColor={d.bandColor} first />
        <IngestBox icon="zerobus" label="Zerobus" bandColor={d.bandColor} />
        {/* bottom zone = "direct" port — agnostic data files (CSV/Parquet),
            icon only, no label. */}
        <IngestBox iconEl={<StackedFiles />} label="" bandColor={d.bandColor} />
      </div>

      {/* RIGHT: title + SDP tables + Open Format underneath them. */}
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <div className="mb-1.5 flex shrink-0 flex-col leading-tight">
          <span className="truncate text-[8px] font-medium uppercase tracking-wide text-muted-foreground">Data ingestion and processing</span>
          <span className="text-[12px] font-bold text-foreground">{d.component.label}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-background/60 p-2">
          <div className="mb-1.5 flex shrink-0 items-center gap-1.5">
            {(() => { const I = DATABRICKS_ICONS.sdpBrand; return <I className="h-4 w-4 shrink-0" />; })()}
            <span className="truncate text-[9.5px] font-bold leading-tight text-foreground">Spark Declarative Pipelines</span>
          </div>
          {/* Medallion grows to absorb extra height on resize. */}
          <MedallionRow />

          {/* Open Format — fixed small height, stays put as the block grows. */}
          <div className="mt-1.5 flex shrink-0 items-center gap-2 border-t border-border/60 pt-1.5">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">Open Format</span>
            {(() => { const I = DATABRICKS_ICONS.deltaLakeLogo; return <I className="h-3.5 w-3.5" />; })()}
            {(() => { const I = DATABRICKS_ICONS.icebergLogo; return <I className="h-3.5 w-3.5" />; })()}
          </div>
        </div>
        {/* Optional footer (e.g. the Genie strip) — under the SDP panel, within
            the right column, so it doesn't span under the ingest rail. */}
        {footer}
      </div>
    </>
  );
}
