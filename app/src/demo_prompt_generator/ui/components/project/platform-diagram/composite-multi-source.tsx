/**
 * platform-diagram/composite-multi-source — a titled GROUP of source systems.
 *
 * The recurring shape in real customer "source systems" columns: a labelled box
 * ("Operational databases", "SaaS apps with a managed connector", …) holding
 * several source logos + names stacked vertically, with an optional short
 * description line under the title. One edge from the group's right side then
 * carries the whole group into ingest — so a busy estate of 6-10 systems reads
 * as a handful of grouped blocks instead of a wall of loose tiles.
 *
 * The header (the node label) is the group title — double-click to rename, like
 * the other composite headers. The rows come from `params.items` (a JSON array
 * of {icon, label, note}); an optional `params.note` string renders as the
 * description line. Each logo goes through BrandMark, so third-party marks are
 * trademark-gated exactly like loose source tiles.
 * A composite node kind ("multi-source").
 */
import { memo, useContext, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { multiSourceItems } from "@/lib/platform-architecture";
import { BrandMark } from "./brand-mark";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

export const MultiSourceBlock = memo(function MultiSourceBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const c = d.component;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const slide = d.theme === "slide";
  const nat = baseSize(c, d.params, d.theme, d.sources);
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 12, borderWidth: 1, shadow: 1 });

  const items = multiSourceItems(d.sources, d.params);
  // Description line (optional): a `note` param, editable like a tile desc.
  const note = typeof d.params?.note === "string" ? d.params.note.trim() : "";
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const commitNote = () => {
    if (editingNote !== null) { d.onSetDescription?.(d.nodeId, editingNote.trim()); setEditingNote(null); }
  };

  // Editable title (the node label), matching the composite-header UX.
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const commitTitle = () => {
    if (editingTitle !== null) { d.onRename(d.nodeId, editingTitle.trim()); setEditingTitle(null); }
  };
  const title = c.label || "Source systems";

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
      onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
      onScale={(w) => d.onResize(d.nodeId, w, Math.round((w * nat.h) / nat.w), w / nat.w)}
      stack={d.stack}
      stackRadius={12}
      stackBorderColor={card.style.borderColor as string | undefined}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-[12px] transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full flex-col gap-1 px-3 py-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* Title (group name) — double-click to rename. */}
          {editingTitle !== null ? (
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); else if (e.key === "Escape") setEditingTitle(null); e.stopPropagation(); }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Group title"
              className={`w-full min-w-0 bg-transparent font-bold leading-tight text-foreground outline-none ${slide ? "text-[15px]" : "text-[12.5px]"}`}
            />
          ) : (
            <span
              className={`shrink-0 truncate font-bold leading-tight text-foreground ${slide ? "text-[15px]" : "text-[12.5px]"}`}
              title={editMode ? "Double-click to rename the group" : title}
              onDoubleClick={editMode ? (e) => { e.stopPropagation(); setEditingTitle(title); } : undefined}
            >
              {title}
            </span>
          )}

          {/* Optional description line under the title. Unlike an ordinary tile
              desc (hidden in slide), a source-group note carries real ingest
              context the deck always shows — so it renders in BOTH themes, just
              a touch larger in slide. */}
          {editingNote !== null ? (
            <input
              autoFocus
              value={editingNote}
              onChange={(e) => setEditingNote(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => { if (e.key === "Enter") commitNote(); else if (e.key === "Escape") setEditingNote(null); e.stopPropagation(); }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Short note (optional)"
              className={`w-full min-w-0 bg-transparent italic leading-snug text-muted-foreground outline-none ${slide ? "text-[10px]" : "text-[9px]"}`}
            />
          ) : note ? (
            <span
              className={`block italic leading-snug text-muted-foreground ${slide ? "text-[10px]" : "text-[9px]"}`}
              title={editMode ? "Double-click to edit the note" : note}
              onDoubleClick={editMode ? (e) => { e.stopPropagation(); setEditingNote(note); } : undefined}
            >
              {note}
            </span>
          ) : null}

          {/* Source rows: logo + name (+ optional inline note). Top-packed (not
              centered) so a 1-item and a 4-item group both hug their title the
              same way — the box height is sized to exactly this content, so
              centering would only introduce slack for tall boxes and cramping
              for short ones. `mt-1` gives a small gap under the title/note. */}
          <div className="mt-1 flex flex-col gap-1.5">
            {items.map((it, i) => (
              <div key={`${it.label}-${i}`} className={`flex gap-2 ${it.wrap && it.note && !slide ? "items-start" : "items-center leading-none"}`}>
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  <BrandMark iconKey={it.icon} label={it.label} bandColor={d.bandColor} allowTrademark={!!d.allowTrademark} className="h-4 w-4" mono />
                </span>
                {it.wrap && it.note && !slide ? (
                  /* Wrapped: name on top, the note wraps to multiple lines below
                     it (the box height auto-adapts — see multiSourceSize). */
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`font-semibold leading-tight text-foreground ${slide ? "text-[13px]" : "text-[11px]"}`}>{it.label}</span>
                    <span className="text-[8.5px] font-normal leading-snug text-muted-foreground">{it.note}</span>
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className={`truncate font-semibold text-foreground ${slide ? "text-[13px]" : "text-[11px]"}`}>{it.label}</span>
                    {!slide && it.note && <span className="shrink truncate text-[8.5px] font-normal text-muted-foreground">{it.note}</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Generic l/r/t/b anchors come from RotatableCard's default NodeHandles —
          a source group exits on the right into its ingest method, but any side
          is available. (We don't add our own dots: that double-stacked every
          handle on top of NodeHandles'.) */}
    </RotatableCard>
  );
});
