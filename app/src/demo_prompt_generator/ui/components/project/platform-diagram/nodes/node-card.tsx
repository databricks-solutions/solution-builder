/**
 * platform-diagram/nodes/node-card — the shared icon + title tile primitive.
 *
 * ONE render for the three "icon + label" node kinds that used to have their
 * own copies:
 *   • product/catalog tiles (ComponentNode)  — brand icon, subtitle, badge,
 *     live dot, optional extra content (SDP medallion), fixed baseSize;
 *   • data sources                           — brand icon, caption position,
 *     auto-fit;
 *   • logo annotations                       — any icon (recolorable), caption
 *     position, auto-fit, box on/off.
 *
 * Composites (lakeflow / governance / agent-bricks / …) and the text/box/image
 * annotation variants are NOT built on this — they have their own layouts.
 *
 * The icon is supplied by the caller as a render function so NodeCard stays
 * agnostic about BrandMark (trademark gate) vs AnyIcon (recolor) — it only owns
 * the icon *slot* sizing. Sizing/box/caption/edit all live here so every caller
 * behaves identically.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  RotatableCard,
  cardStyle,
  shadowLevel,
  shadowCss,
  SHADOW_DEFAULT,
  logoFitSize,
  type NodeData,
} from "../shared";

export type CaptionPosition = "right" | "left" | "top" | "bottom";

export interface NodeCardProps {
  /** Node id (instance id) — for the mutation callbacks. */
  nodeId: string;
  selected: boolean;
  editMode: boolean;
  isDropTarget: boolean;

  /** Per-node style + geometry (from NodeData). */
  rot: number;
  scale: number;
  /** User-resized box; undefined → default/auto-fit size. */
  w?: number;
  h?: number;

  /** Icon slot: caller renders BrandMark / AnyIcon into a full-size element.
   *  `fill` true (positioned/auto-fit) → the svg fills the given box; false
   *  (legacy logo) → same, we just size the slot differently. */
  icon: ReactNode;

  /** Main label. */
  title: string;
  /** Commit an edited title (unifies onRename / onAnnotate({text})). */
  onCommitTitle: (value: string) => void;
  /** Placeholder shown while editing an empty title; also whether a blank
   *  title renders nothing (logo) vs the raw value. */
  titlePlaceholder?: string;
  /** Render nothing when the title is empty (logos), instead of an empty slot. */
  hideEmptyTitle?: boolean;

  /** Optional extras — product tiles only. */
  subtitle?: string;
  badge?: { text: string; icon?: ReactNode };
  liveLink?: boolean;
  /** Extra content under the header row (e.g. the SDP medallion). */
  extraContent?: ReactNode;

  /** Editable description line under the title. Shown only when
   *  `showDescription` and `onCommitDescription` are both set. Double-click to
   *  edit (same UX as the title); truncates long text. Does NOT drive auto-fit
   *  width — the box sizes to icon+title only. Distinct from `subtitle`, which
   *  is a static catalog sublabel. Unified across product tiles / sources /
   *  logos. */
  description?: string;
  showDescription?: boolean;
  onCommitDescription?: (value: string) => void;

  /** Layout. `caption` positions the icon vs the title. `fixed` uses baseSize/
   *  manual; `autoFit` measures icon+text and calls onResize on content change. */
  caption?: CaptionPosition;
  contentMode: "fixed" | "autoFit";
  /** Default (natural) size used when the box isn't user-resized. */
  defaultSize: { w: number; h: number };

  /** Style. */
  fontColor?: string;
  fontSize?: number;
  bold?: boolean;
  iconColor?: string;
  fillColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderColor?: string;
  borderRadius?: number;
  shadow?: number | boolean;
  opacity?: number;
  /** Muted "mentioned" state (product tiles) → dimmed + transparent border. */
  muted?: boolean;
  /** cardStyle default border color (band tint) for the FIXED product look. */
  bandBorderColor?: string;
  /** Which styling model: "tile" = the product/composite cardStyle (border +
   *  bg-card + band tint by default); "logo" = the annotation logo look
   *  (transparent, no border/shadow by default, auto-shadow once a fill/border
   *  is added). */
  styleVariant: "tile" | "logo";

  onSelect: (id: string) => void;
  onResize: (id: string, w: number, h: number, scale?: number, center?: { x: number; y: number }) => void;
  /** Corner uniform-scale (product tiles). Omit → corner behaves like resize. */
  onScale?: (id: string, w: number) => void;
  onContext: (id: string, clientX: number, clientY: number) => void;
}

export function NodeCard(p: NodeCardProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const commit = () => {
    if (editing !== null) {
      const v = editing.trim();
      if (v !== p.title) p.onCommitTitle(v);
      setEditing(null);
    }
  };

  // Description edit — its own state, same UX as the title.
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const commitDesc = () => {
    if (editingDesc !== null) {
      const v = editingDesc.trim();
      if (v !== (p.description ?? "")) p.onCommitDescription?.(v);
      setEditingDesc(null);
    }
  };
  const showDesc = !!p.showDescription && !!p.onCommitDescription;

  const cap: CaptionPosition = p.caption ?? "right";
  const horizontal = cap === "right" || cap === "left";
  const iconFirst = cap === "right" || cap === "bottom";
  const scale = p.scale;
  const fontSize = p.fontSize ?? 13;
  const bold = !!p.bold;

  // --- Auto-fit (source/logo): measure icon+text, resize on CONTENT change ---
  // Signature-guarded exactly like the old logo effect: never fires on
  // mount/reload (persisted/manual size wins) and never fights a manual resize
  // (a drag doesn't change the content signature).
  const autoFit = p.contentMode === "autoFit";
  const sizingText = editing !== null ? editing : p.title;
  const fitSig = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!autoFit) { fitSig.current = null; return; }
    const sig = `${sizingText}|${fontSize}|${bold}|${horizontal}`;
    if (fitSig.current === sig) return;
    const first = fitSig.current === null;
    fitSig.current = sig;
    if (first) return; // mount/reload → keep the persisted (possibly manual) size
    const { w, h } = logoFitSize(sizingText, horizontal, fontSize, bold);
    const W = Math.ceil(w * scale);
    const H = Math.ceil(h * scale);
    if (Math.abs((p.w ?? 0) - W) > 1 || Math.abs((p.h ?? 0) - H) > 1) {
      p.onResize(p.nodeId, W, H);
    }
  }, [autoFit, sizingText, fontSize, bold, horizontal, scale, p]);

  // Box style. "tile" → the product cardStyle (border + band tint + bg-card);
  // "logo" → transparent, no border/shadow unless a fill/border is set.
  let boxStyle: React.CSSProperties;
  let hasFill: boolean;
  if (p.styleVariant === "tile") {
    const card = cardStyle(
      {
        borderWidth: p.borderWidth, borderStyle: p.borderStyle, borderColor: p.borderColor,
        borderRadius: p.borderRadius, shadow: p.shadow, fillColor: p.fillColor,
        fontColor: p.fontColor, opacity: p.opacity,
      } as NodeData,
      {
        borderColor: p.muted ? "transparent" : (p.bandBorderColor ?? "var(--border)"),
        radius: 12,
        opacity: p.muted ? 0.6 : 1,
      },
    );
    boxStyle = card.style;
    hasFill = card.hasFill;
  } else {
    const bw = p.borderWidth ?? 0; // logos: no border by default
    hasFill = !!(p.fillColor && p.fillColor !== "transparent");
    const isTile = bw > 0 || hasFill;
    const lvl = p.shadow !== undefined ? shadowLevel(p.shadow) : isTile ? SHADOW_DEFAULT : 0;
    const s: React.CSSProperties = {
      background: hasFill ? p.fillColor : undefined,
      opacity: p.opacity ?? 1,
      borderRadius: p.borderRadius ?? 8,
    };
    if (bw > 0) {
      s.borderStyle = p.borderStyle ?? "solid";
      s.borderWidth = bw;
      s.borderColor = p.borderColor ?? "var(--border)";
    }
    const sh = shadowCss(lvl);
    if (sh) s.boxShadow = sh;
    boxStyle = s;
  }

  // --- Title (editable) ------------------------------------------------------
  const titleEl = editing !== null ? (
    <input
      autoFocus
      value={editing}
      {...(autoFit ? { size: Math.max(3, editing.length) } : {})}
      onChange={(e) => setEditing(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setEditing(null);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder={p.titlePlaceholder}
      className={`min-w-0 bg-transparent text-[13px] font-semibold outline-none ${
        autoFit ? (horizontal ? "text-left" : "text-center") : "w-full"
      } ${p.fontColor ? "" : "text-foreground"}`}
      style={p.fontColor ? { color: p.fontColor, fontSize, ...(bold ? { fontWeight: 700 } : {}) } : { fontSize, ...(bold ? { fontWeight: 700 } : {}) }}
    />
  ) : p.title ? (
    <span
      className={`min-w-0 truncate ${autoFit ? "whitespace-nowrap font-medium" : "font-semibold"} text-[13px] ${p.fontColor ? "" : "text-foreground"}`}
      style={{ fontSize, ...(bold ? { fontWeight: 700 } : {}), ...(p.fontColor ? { color: p.fontColor } : {}) }}
      title="Double-click to edit"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(p.title); }}
    >
      {p.title}
    </span>
  ) : p.hideEmptyTitle ? null : (
    // Empty title (non-logo). In edit mode render a faint, double-clickable
    // placeholder so there's a visible target to double-click and type a label.
    // Logos (hideEmptyTitle) render NOTHING here — the mark fills the tile and
    // double-clicking the icon adds a label (see the icon wrapper below).
    <span
      className={`min-w-0 truncate text-[13px] italic ${autoFit ? "whitespace-nowrap" : ""} text-muted-foreground/50`}
      style={{ fontSize }}
      title="Double-click to add a label"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(""); }}
    >
      {p.titlePlaceholder ?? "Add label…"}
    </span>
  );

  // Editable description line — double-click to edit, Enter/blur commit, Esc
  // cancel. Truncates. Distinct from the static `subtitle` above.
  const descEl = !showDesc ? null : editingDesc !== null ? (
    <input
      autoFocus
      value={editingDesc}
      onChange={(e) => setEditingDesc(e.target.value)}
      onBlur={commitDesc}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitDesc();
        else if (e.key === "Escape") setEditingDesc(null);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder="Description"
      className={`mt-0.5 block w-full min-w-0 bg-transparent text-[9.5px] font-normal leading-tight text-muted-foreground outline-none ${horizontal ? "text-left" : "text-center"}`}
    />
  ) : (
    // When the toggle is ON but empty, still render a faint, double-clickable
    // placeholder so the user has something to click to add the text.
    <span
      className={`mt-0.5 block truncate text-[9.5px] font-normal leading-tight ${p.description ? "text-muted-foreground" : "italic text-muted-foreground/50"}`}
      title="Double-click to edit description"
      onDoubleClick={(e) => { e.stopPropagation(); setEditingDesc(p.description ?? ""); }}
    >
      {p.description || "Add description…"}
    </span>
  );

  // Header text column: title (+ badge + live dot), optional subtitle, and the
  // optional editable description line.
  const labelCol = (
    <span className={`flex min-w-0 flex-col ${horizontal ? "flex-1" : "items-center text-center"}`}>
      <span className={`flex min-w-0 items-center gap-1.5 leading-tight ${horizontal ? "" : "justify-center"}`}>
        {titleEl}
        {p.badge && editing === null && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
            style={{ background: "#EF5B3F", lineHeight: 1 }}
            title={`${p.title} — ${p.badge.text}`}
          >
            {p.badge.icon}
            {p.badge.text}
          </span>
        )}
        {p.liveLink && editing === null && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
          />
        )}
      </span>
      {p.subtitle && (
        <span className="mt-0.5 block truncate text-[9.5px] font-normal leading-tight text-muted-foreground">{p.subtitle}</span>
      )}
      {descEl}
    </span>
  );

  // Icon slot: fixed square when auto-fitting; else fills its flex cell.
  const iconEl = autoFit ? (
    <span
      className={`grid place-items-center ${horizontal ? "h-full shrink-0" : "min-h-0 w-full flex-1"}`}
      style={horizontal ? { aspectRatio: "1 / 1" } : undefined}
    >
      {p.icon}
    </span>
  ) : (
    p.icon
  );

  return (
    <RotatableCard
      rot={p.rot}
      w={p.w ?? p.defaultSize.w}
      h={p.h ?? p.defaultSize.h}
      scale={scale}
      baseW={p.defaultSize.w}
      baseH={p.defaultSize.h}
      editMode={p.editMode}
      selected={p.selected}
      forceDots={p.isDropTarget}
      onResize={(w, h, center) => p.onResize(p.nodeId, w, h, undefined, center)}
      {...(p.onScale ? { onScale: (w: number) => p.onScale!(p.nodeId, w) } : {})}
      onContext={(e) => { e.preventDefault(); p.onContext(p.nodeId, e.clientX, e.clientY); }}
    >
      <div
        onClick={() => p.onSelect(p.nodeId)}
        // Double-click starts label editing. For autoFit tiles AND for logos
        // (which hide the empty-title placeholder), so a labelless logo can get
        // a caption by double-clicking it. `?? ""` so an undefined title still
        // opens a controlled (focusable) input.
        onDoubleClick={
          (autoFit || p.hideEmptyTitle) && p.editMode
            ? (e) => { e.stopPropagation(); setEditing(p.title ?? ""); }
            : undefined
        }
        className={`group relative flex h-full w-full flex-col overflow-hidden transition-shadow ${
          p.styleVariant === "tile" && !hasFill ? "bg-card" : ""
        } ${selectedRing(p.selected)}`}
        style={boxStyle}
        title={autoFit ? "Double-click to edit text · right-click for options" : undefined}
      >
        <div
          className={`flex min-h-0 w-full flex-1 ${horizontal ? "flex-row items-center gap-2.5" : "flex-col items-center justify-center gap-1.5"} px-3 py-2.5`}
          style={{ transform: "scale(var(--cs, 1))", transformOrigin: horizontal ? "left center" : "center" }}
        >
          {iconFirst ? <>{iconEl}{labelCol}</> : <>{labelCol}{iconEl}</>}
        </div>
        {p.extraContent && (
          <div className="border-t border-border/60 px-3 py-2" style={{ minHeight: 44 }}>
            {p.extraContent}
          </div>
        )}
      </div>
    </RotatableCard>
  );
}

function selectedRing(selected: boolean): string {
  return selected ? "ring-2 ring-primary/60" : "";
}
