/**
 * platform-diagram/composite-lakeflow — the composite "Lakeflow" super-block
 * (Lakeflow Connect + Zerobus + direct file ingest feeding a bronze→silver→gold
 * Spark Declarative Pipeline) plus its medallion-cylinder pieces and the named
 * left-side input ports. First of several composite blocks.
 */
import { memo, useContext, Fragment } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { RotatableCard, baseSize, DropTargetContext, type NodeData } from "./shared";
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
      className={`flex flex-1 flex-row items-center justify-center gap-1 ${first ? "" : "border-t"}`}
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
    <div className="flex flex-col items-center justify-end gap-[1px]">
      <svg viewBox="0 0 24 28" className="w-auto" preserveAspectRatio="xMidYMax meet" style={{ height: 26, overflow: "visible" }}>
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
    <div className="flex items-center justify-center gap-[2px]">
      {MEDALLION.map((m, i) => (
        <Fragment key={m.label}>
          {i > 0 && <span className="h-[2px] w-3 shrink-0 rounded-full bg-muted-foreground/25" />}
          <DbTable label={m.label} color={m.color} />
        </Fragment>
      ))}
    </div>
  );
}

export const LakeflowBlock = memo(function LakeflowBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const nat = baseSize(d.component);
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={d.editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      {/* 3 left input ports (lakeflow-connect / zerobus / direct) + right output.
          All type="source" (loose mode) so they connect both ways. */}
      {d.editMode &&
        LF_PORTS.map((p) => (
          <Handle key={p.port} type="source" position={Position.Left} id={`in-${p.port}`} isConnectable
            className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-background" style={{ top: `${p.frac * 100}%` }} />
        ))}
      {d.editMode && (
        <Handle type="source" position={Position.Right} id="r" isConnectable className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-background" />
      )}

      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow ${
          selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"
        }`}
        style={{ borderColor: `${d.bandColor}66` }}
      >
        <div className="flex h-full w-full" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
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
          <div className="flex flex-1 flex-col p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-[12px] font-bold text-foreground">{d.component.label}</span>
            </div>
            <div className="flex flex-1 flex-col rounded-lg border border-border/60 bg-background/60 p-2">
              <div className="mb-1.5 flex items-center gap-1.5">
                {(() => { const I = DATABRICKS_ICONS.sdpBrand; return <I className="h-4 w-4 shrink-0" />; })()}
                <span className="truncate text-[9.5px] font-bold leading-tight text-foreground">Spark Declarative Pipelines</span>
              </div>
              <MedallionRow />

              {/* Open Format — under the tables to save height. Logos only. */}
              <div className="mt-1.5 flex items-center gap-2 border-t border-border/60 pt-1.5">
                <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">Open Format</span>
                {(() => { const I = DATABRICKS_ICONS.deltaLakeLogo; return <I className="h-3.5 w-3.5" />; })()}
                {(() => { const I = DATABRICKS_ICONS.icebergLogo; return <I className="h-3.5 w-3.5" />; })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
