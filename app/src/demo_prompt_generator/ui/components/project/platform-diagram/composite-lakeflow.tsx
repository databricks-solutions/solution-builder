/**
 * platform-diagram/composite-lakeflow — the composite "Lakeflow" super-block
 * (Lakeflow Connect + Zerobus + direct file ingest feeding a bronze→silver→gold
 * Spark Declarative Pipeline) plus its medallion-cylinder pieces and the named
 * left-side input ports. First of several composite blocks.
 */
import { memo, useContext, useState, Fragment, type ReactNode } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, ConnectionDot, dotsOn, type DotSpec, type NodeData } from "./shared";
import { type Side } from "./edge-routing";

export const MEDALLION = [
  { key: "bronze", label: "Bronze", color: "#cd7f32" },
  { key: "silver", label: "Silver", color: "#9ca3af" },
  { key: "gold", label: "Gold", color: "#d4a72c" },
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
 *  pill, so it reads as part of the block's left side (zones), not a tile.
/*  The zone renders the SAME in slide as technical (icon + vertical port label);
 *  slide changes only the OUTER composite (flat card / stronger lines) and
 *  suppresses descriptions — the box stays its natural size, so the internals
 *  must fit it exactly as technical does. Tight right padding (`pl-1 pr-0`) keeps
 *  the rail narrow so the SDP/medallion panel keeps its width. */
function IngestBox({ icon, iconEl, label, bandColor, first, slide }: { icon?: DatabricksIconName; iconEl?: React.ReactNode; label: string; bandColor: string; first?: boolean; slide?: boolean }) {
  const Icon = icon ? DATABRICKS_ICONS[icon] || DATABRICKS_ICONS.data : null;
  return (
    <div
      className={`flex flex-1 flex-row items-center justify-center gap-0.5 pl-1 pr-0 py-2 ${first ? "" : "border-t"}`}
      style={{ borderColor: `${bandColor}33`, background: `${bandColor}12` }}
    >
      {label && (
        <span
          className="font-bold uppercase tracking-[0.08em] leading-none text-foreground/80"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed", fontSize: slide ? 10 : 7.5 }}
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
 *  layer color, with the layer name underneath and an optional short caption
 *  (from a `*_desc` param) below that.
 *  Slide keeps the SAME cylinder + label size as technical (they fit the natural
 *  box); slide only SUPPRESSES the desc caption. */
export function DbTable({ label, color, desc, slide }: { label: string; color: string; desc?: string; slide?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-[2px]">
      {/* Grows with the block, but capped so the cylinders don't get so tall
          they widen past each other (aspect-locked SVG). Past the cap they
          just sit centered in the extra space. */}
      <svg viewBox="0 0 24 28" className="min-h-0 w-auto flex-1" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 38, overflow: "visible" }}>
        {/* body */}
        <path d="M2 5 V21 a10 4 0 0 0 20 0 V5" fill={`${color}26`} stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
        {/* inner data bands */}
        <path d="M2 11 a10 4 0 0 0 20 0" fill="none" stroke={`${color}99`} strokeWidth="1.1" />
        <path d="M2 16 a10 4 0 0 0 20 0" fill="none" stroke={`${color}99`} strokeWidth="1.1" />
        {/* top ellipse (rim) */}
        <ellipse cx="12" cy="5" rx="10" ry="4" fill={`${color}40`} stroke={color} strokeWidth="1.4" />
      </svg>
      <span className="font-bold uppercase tracking-wide leading-none" style={{ color, fontSize: slide ? 10 : 7.5 }}>
        {label}
      </span>
      {!slide && desc && (
        <span
          className="mt-[1px] max-w-[72px] text-center text-[6.5px] leading-tight text-muted-foreground"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          title={desc}
        >
          {desc}
        </span>
      )}
    </div>
  );
}

/** The bronze → silver → gold cylinders with a thin light connector bar between
 *  each (the medallion flow). Spacing WIDENS when any layer has a `*_desc` param
 *  so the captions get room. `params` carries the optional `bronze_desc` /
 *  `silver_desc` / `gold_desc` captions.
 *  Slide passes through desc-suppression to DbTable; sizing is theme-invariant. */
export function MedallionRow({ params, slide }: { params?: Record<string, boolean | string>; slide?: boolean } = {}) {
  const descOf = (k: string): string | undefined => {
    const v = params?.[`${k}_desc`];
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  // Slide hides descs, so treat the row as desc-less for spacing regardless.
  const hasDesc = !slide && !!(descOf("bronze") || descOf("silver") || descOf("gold"));
  return (
    <div className={`flex min-h-0 flex-1 items-stretch justify-center ${hasDesc ? "gap-3" : "gap-2"}`}>
      {MEDALLION.map((m, i) => (
        <Fragment key={m.label}>
          {/* Connector bar — wider than before so the layers read as spaced-out
              stages, not crammed together. */}
          {i > 0 && <span className="my-auto h-[2px] w-6 shrink-0 rounded-full bg-muted-foreground/25" />}
          <DbTable label={m.label} color={m.color} desc={descOf(m.key)} slide={slide} />
        </Fragment>
      ))}
    </div>
  );
}

export const LakeflowBlock = memo(function LakeflowBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component, d.params, d.theme);
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
      {/* Title legend on the top border (sibling of the overflow-hidden content
          so it can straddle the edge). */}
      <LakeflowHeader d={d} mask={card.hasFill ? (d.fillColor as string) : "var(--card)"} />

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

// The catalog labels we treat as "not a custom title" — the block's own default
// name, which should render as the DEFAULT header rather than verbatim. A user
// title (anything else, incl. empty→cleared) shows as typed / falls back.
const LAKEFLOW_DEFAULT_TITLE = "Lakeflow: Data ingestion and processing";
const LAKEFLOW_CATALOG_LABELS = new Set(["Lakeflow", "Lakeflow + Genie"]);

/** The Lakeflow block's editable title — a LEGEND on the top border (like the
 *  medallion / a box), not an inner line. Default: "Lakeflow: Data ingestion and
 *  processing" (shown when the label is unset or still the catalog default).
 *  Double-click (edit mode) to rename — stored as the node label via onRename;
 *  committing empty restores the default. Rendered as a card-level sibling of the
 *  (overflow-hidden) content so it can straddle the border; `mask` paints the
 *  strip's background to hide the border line behind the text. */
export function LakeflowHeader({ d, mask }: { d: NodeData; mask: string }) {
  const editMode = useContext(EditModeContext);
  const label = d.component.label;
  const isDefault = !label || LAKEFLOW_CATALOG_LABELS.has(label);
  const title = isDefault ? LAKEFLOW_DEFAULT_TITLE : label;
  const [editing, setEditing] = useState<string | null>(null);
  const commit = () => {
    if (editing !== null) { d.onRename(d.nodeId, editing.trim()); setEditing(null); }
  };
  return (
    <div
      onClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); }}
      onDoubleClick={editMode ? (e) => { e.stopPropagation(); setEditing(isDefault ? "" : title); } : undefined}
      title={editMode ? "Double-click to edit title" : undefined}
      className="absolute inset-x-0 top-0 z-10 flex h-4 -translate-y-1/2 items-center"
      style={{ cursor: "text" }}
    >
      <div className="ml-3 flex items-baseline gap-1.5" style={{ background: mask, padding: "0 6px", borderRadius: 6 }}>
        {editing !== null ? (
          <input
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(null); e.stopPropagation(); }}
            onClick={(e) => e.stopPropagation()}
            placeholder={LAKEFLOW_DEFAULT_TITLE}
            className="w-64 bg-transparent text-[12px] font-bold leading-none text-foreground outline-none"
          />
        ) : isDefault ? (
          <>
            {/* Slide drops the trailing tagline, so drop the colon too — a bare
                "Lakeflow" reads as a title, "Lakeflow:" with nothing after it
                dangles. Technical keeps "Lakeflow:" + the tagline. Slide bumps the
                title to 15px (a slide-visual change, not a box-size one — the
                header strip fits ≤15px); technical stays 12px. */}
            <span className={`shrink-0 font-bold leading-none text-foreground ${d.theme === "slide" ? "text-[15px]" : "text-[12px]"}`}>{d.theme === "slide" ? "Lakeflow" : "Lakeflow:"}</span>
            {d.theme !== "slide" && <span className="whitespace-nowrap text-[9px] font-medium leading-none text-muted-foreground">Data ingestion and processing</span>}
          </>
        ) : (
          <span className={`truncate font-bold leading-none text-foreground ${d.theme === "slide" ? "text-[15px]" : "text-[12px]"}`}>{title}</span>
        )}
      </div>
    </div>
  );
}

/** The Lakeflow inner content (ingest rail + SDP/medallion panel), WITHOUT the
 *  card chrome — so it can be embedded standalone or stacked above Genie Code
 *  in the combined block. An optional `footer` renders inside the RIGHT column,
 *  below the SDP/Open-Format panel — so it aligns under that panel and the
 *  full-height ingest rail stays on its left (not spanned by the footer).
 *  Geometry is THEME-INVARIANT (same box as technical): slide only suppresses
 *  descriptions + the open-format marks and flattens the outer card. */
export function LakeflowBody({ d, footer }: { d: NodeData; footer?: ReactNode }) {
  const slide = d.theme === "slide";
  return (
    <>
      {/* LEFT: ingest zones stacked vertically, flush against the block edge
          — Connect (top), Zerobus (middle), files (bottom = direct port).
          Each zone aligns with its left-edge input port. Narrow rail (w-9) in
          both themes so the SDP/medallion panel keeps its width. */}
      <div className="flex w-9 shrink-0 flex-col border-r" style={{ borderColor: `${d.bandColor}33` }}>
        <IngestBox icon="lakeflowConnectBrand" label="Connect" bandColor={d.bandColor} first slide={slide} />
        <IngestBox icon="zerobus" label="Zerobus" bandColor={d.bandColor} slide={slide} />
        {/* bottom zone = "direct" port — agnostic data files (CSV/Parquet),
            icon only, no label. */}
        <IngestBox iconEl={<StackedFiles />} label="" bandColor={d.bandColor} slide={slide} />
      </div>

      {/* RIGHT: SDP panel. The block TITLE is a legend on the card's top border
          (rendered by the block, not here). */}
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-background/60 p-2">
          {/* SDP title row — the open-format logos (Delta · Iceberg) sit at the
              RIGHT end of this row, aligned with the "Spark Declarative Pipelines"
              title (replaces the old "Open Format" footer). */}
          <div className="mb-1.5 flex shrink-0 items-center gap-1.5">
            {(() => { const I = DATABRICKS_ICONS.sdpBrand; return <I className={`shrink-0 ${slide ? "h-5 w-5" : "h-4 w-4"}`} />; })()}
            {/* Title shrinks (min-w-0 + truncate) so the open-format logos on the
                right always stay inside the panel, even in the narrow block.
                Slide bumps it to 13px (still truncates → never overflows). */}
            <span className={`min-w-0 flex-1 truncate font-bold leading-tight text-foreground ${slide ? "text-[13px]" : "text-[11px]"}`}>Spark Declarative Pipelines</span>
            {!slide && (
              <span className="flex shrink-0 items-center gap-1">
                {(() => { const I = DATABRICKS_ICONS.deltaLakeLogo; return <I className="h-3.5 w-3.5" />; })()}
                {(() => { const I = DATABRICKS_ICONS.icebergLogo; return <I className="h-3.5 w-3.5" />; })()}
              </span>
            )}
          </div>
          {/* Medallion grows to absorb extra height on resize. */}
          <MedallionRow params={d.params} slide={slide} />
        </div>
        {/* Optional footer (e.g. the Genie strip) — under the SDP panel, within
            the right column, so it doesn't span under the ingest rail. */}
        {footer}
      </div>
    </>
  );
}
