/**
 * platform-diagram/nodes/component-node — the standard product/source node:
 * a brand-icon tile + label, with inline rename, an optional "live" dot,
 * badges, and the SDP medallion sub-tables.
 */
import { memo, useState, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  type NodeData,
  RotatableCard,
  DropTargetContext,
  EditModeContext,
  baseSize,
  cardStyle,
} from "../shared";
import { BrandMark, isTrademarkMark } from "../brand-mark";
import { MedallionRow } from "../composite-lakeflow";

/** The standard product/source node — brand icon tile + label. */
export const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const { component: c, bandColor } = d;
  // Lakebase is app state, not a user-facing live surface — no "live" dot.
  const live = !!d.deepLink && c.id !== "lakebase";
  const muted = c.state === "mentioned";
  // Lit up when a dragged edge endpoint is hovering this tile (magnet).
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);

  // SDP renders bronze/silver/gold as little tables inside the node.
  const isSdp = c.id === "sdp";
  const nat = baseSize(c);

  // Per-node style (border w/style/color/radius, fill, opacity) — shared with
  // the composites so the right-click controls behave the same everywhere.
  const card = cardStyle(d, {
    borderColor: muted ? "transparent" : `${bandColor}66`,
    radius: 12, // matches the old rounded-xl
    opacity: muted ? 0.6 : 1,
  });

  // Inline label editing (double-click). `editing` holds the draft text.
  const [editing, setEditing] = useState<string | null>(null);
  const commitRename = () => {
    if (editing !== null) {
      const v = editing.trim();
      if (v && v !== c.label) d.onRename(d.nodeId, v);
      setEditing(null);
    }
  };

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => {
        e.preventDefault();
        d.onContext(d.nodeId, e.clientX, e.clientY);
      }}
    >
    <div
      onClick={() => d.onSelect(d.nodeId)}
      className={`group relative flex h-full w-full flex-col overflow-hidden transition-shadow ${
        card.hasFill ? "" : "bg-card"
      } ${selected ? "ring-2 ring-primary/60" : ""} ${card.shadow ? (selected ? "shadow-md" : "shadow-sm hover:shadow-md") : ""}`}
      style={card.style}
    >
      <div
        className="flex flex-1 items-center gap-2.5 px-3 py-2.5"
        style={{ transform: "scale(var(--cs, 1))", transformOrigin: "left center" }}
      >
        {/* Icon slot. Real logo (or a full-name brand badge when the logo is
            trademark-gated and not enabled). The text label still stays. */}
        {isTrademarkMark(c.icon) && !d.allowTrademark ? (
          <BrandMark iconKey={c.icon} label={c.label} bandColor={bandColor} allowTrademark={false} />
        ) : (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-background"
            style={{ boxShadow: `inset 0 0 0 1px ${bandColor}22` }}
          >
            <BrandMark iconKey={c.icon} label={c.label} bandColor={bandColor} allowTrademark={!!d.allowTrademark} className="h-5 w-5" />
          </span>
        )}
        <span className="min-w-0">
          <span className={`flex items-center gap-1.5 text-[13px] font-semibold leading-tight ${d.fontColor ? "" : "text-foreground"}`} style={d.fontColor ? { color: d.fontColor } : undefined}>
            {editing !== null ? (
              <input
                autoFocus
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="w-full min-w-0 rounded border border-primary/50 bg-background px-1 text-[13px] font-semibold text-foreground outline-none"
              />
            ) : (
              <span
                className="truncate"
                title="Double-click to rename"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(c.label); }}
              >
                {c.label}
              </span>
            )}
            {c.badge && editing === null && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
                style={{ background: "#EF5B3F", lineHeight: 1 }}
                title={`${c.label} — ${c.badge}`}
              >
                {c.badge === "RT" && (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" /></svg>
                )}
                {c.badge}
              </span>
            )}
            {live && editing === null && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
              />
            )}
          </span>
          {c.sublabel && (
            <span className="mt-0.5 block truncate text-[9.5px] font-normal leading-tight text-muted-foreground">{c.sublabel}</span>
          )}
        </span>
      </div>

      {/* SDP medallion databases */}
      {isSdp && (
        <div className="border-t border-border/60 px-3 py-2" style={{ minHeight: 44 }}>
          <MedallionRow />
        </div>
      )}
    </div>
    </RotatableCard>
  );
});
