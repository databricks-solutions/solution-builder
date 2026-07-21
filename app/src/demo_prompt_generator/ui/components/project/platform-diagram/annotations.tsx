/**
 * platform-diagram/annotations — free-form canvas annotations that aren't
 * Databricks catalog components: plain Text, a Box (bordered text), a Logo
 * (any icon from the library), and an Image (URL or pasted base64). All four
 * are one ReactFlow node kind ("annotation") with a `variant`; their props live
 * in the node's layout entry (NodePosition.annotation) so they persist.
 */
import { memo, useContext, useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, BRAND_ICONS, BRAND_ICON_LABEL_COLOR, type DatabricksIconName } from "../../databricks-icons";
import { FILE_ICONS, FileSvgIcon, isFileIconKey, logoMetaByName, logoAliases } from "../../file-icons";
import INDUSTRY_MAP from "../../../icons/industry-map.json";
import { BrandMark } from "./brand-mark";
import { type AnnotationData, type AnnotationVariant, isCustomIconKey, customLogoId } from "@/lib/platform-architecture";
import { RotatableCard, DropTargetContext, EditModeContext, CustomLogosContext, AutoEditContext, InlineSvgIcon, type NodeData } from "./shared";

/** Render any icon key — a built-in DatabricksIconName, a file-icon key
 *  ("file:…"), or a custom inline-SVG logo ("custom:<id>") — at a given size.
 *  Used by the Logo annotation + the picker. */
export function AnyIcon({ iconKey, className, style }: { iconKey: string; className?: string; style?: React.CSSProperties }) {
  const customLogos = useContext(CustomLogosContext);
  if (isCustomIconKey(iconKey)) {
    const svg = customLogos[customLogoId(iconKey)];
    if (svg) return <InlineSvgIcon svg={svg} className={className} style={style} />;
    // Unknown custom id → neutral placeholder.
    const Data = DATABRICKS_ICONS.data;
    return <Data className={className} style={{ color: "var(--muted-foreground)", ...style }} />;
  }
  if (isFileIconKey(iconKey)) return <FileSvgIcon iconKey={iconKey} className={className} style={style} />;
  const Icon = DATABRICKS_ICONS[iconKey as DatabricksIconName] || DATABRICKS_ICONS.data;
  const isBrand = BRAND_ICONS.has(iconKey as DatabricksIconName);
  return <Icon className={className} style={isBrand ? style : { color: "var(--foreground)", ...style }} />;
}

/** Annotation node data lives under NodeData.component is a stub; the real
 *  props are on NodeData.annotation. We extend NodeData via the index sig. */
export interface AnnotationNodeData extends NodeData {
  annotation: AnnotationData;
  /** Commit edited annotation props (text, src, icon, alignment…). */
  onAnnotate: (id: string, patch: Partial<AnnotationData>) => void;
}

export const ANNOTATION_DEFAULT_SIZE: Record<AnnotationVariant, { w: number; h: number }> = {
  text: { w: 160, h: 40 },
  box: { w: 320, h: 180 },
  logo: { w: 60, h: 60 },
  image: { w: 200, h: 140 },
};

// The positioned-icon-tile sizing helpers now live in shared.tsx (used by the
// shared NodeCard). Re-exported here so existing importers (canvas.tsx) keep
// working through `./annotations`.
export { LOGO_ICON, LOGO_GAP, LOGO_PAD, logoFitSize } from "./shared";

const V_CLASS = { top: "items-start", middle: "items-center", bottom: "items-end" } as const;
const H_CLASS = { left: "justify-start text-left", center: "justify-center text-center", right: "justify-end text-right" } as const;

/** The single annotation node component — switches on variant. */
export const AnnotationNode = memo(function AnnotationNode({ data, selected }: NodeProps) {
  const d = data as AnnotationNodeData;
  const a = d.annotation;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  const commit = () => {
    if (editing !== null) {
      d.onAnnotate(d.nodeId, { text: editing });
      setEditing(null);
    }
  };
  const commitTitle = () => {
    if (editingTitle !== null) {
      d.onAnnotate(d.nodeId, { title: editingTitle });
      setEditingTitle(null);
    }
  };

  // A freshly-dropped TEXT node auto-enters edit mode so the cursor lands in it
  // (like any editor). Consume the one-shot signal so it doesn't re-fire.
  const autoEdit = useContext(AutoEditContext);
  useEffect(() => {
    if (autoEdit.id === d.nodeId && a.variant === "text") {
      setEditing(a.text ?? "");
      autoEdit.clear();
    }
  }, [autoEdit, d.nodeId, a.variant, a.text]);

  const fontSize = a.fontSize ?? 14;
  const fontWeight = a.bold ? 700 : 400;
  // Border: `style.border` (borderWidth) is the ONLY border control. A box
  // defaults to a 1px border; text to none. Set borderWidth 0 to remove a box's.
  const borderW = d.borderWidth ?? (a.variant === "box" ? 1 : 0);
  const showBorder = borderW > 0;
  const vA = a.vAlign ?? "middle";
  // Plain TEXT defaults to LEFT-aligned; a box keeps center.
  const hA = a.hAlign ?? (a.variant === "text" ? "left" : "center");

  // --- Plain TEXT: a top-left-anchored, auto-fitting text box -----------------
  // A text annotation is NOT drawn through RotatableCard's centered card model
  // (which fights a growing text box). It renders its own top-left shell + fits
  // its box to the text. The canvas uses center positions (nodeOrigin 0.5), so
  // to keep the TOP-LEFT corner fixed while the box grows right/down (like a
  // normal editor), we SHIFT the center by half the size delta — reading the
  // node's CURRENT position + size imperatively from the RF store (not props /
  // deps), so the fit fires once per text change and never chases its own write
  // (that self-chase, plus a NaN from a missing NodeProps field, was the runaway).
  const rf = useReactFlow();
  const TEXT_PAD = 4; // px around the glyphs (must match the render padding)
  // Overflow mode drives everything. `auto` (default / unset) → the box
  // AUTO-FITS its content (grows as you type). `wrap`/`truncate` → FIXED box.
  // (Legacy `a.sized` from old files also means fixed.) One source of truth.
  const textMode: "auto" | "wrap" | "truncate" =
    a.textWrap && a.textWrap !== "auto" ? a.textWrap : a.sized ? "wrap" : "auto";
  const textFixed = textMode !== "auto";
  const isTextVariant = a.variant === "text" && !textFixed;
  const scale = d.scale ?? 1;
  // The text we size to: the LIVE editing buffer while editing (so the box grows
  // as you type), else the committed text.
  const sizingText = editing !== null ? editing : (a.text ?? "");
  // Hidden measurer: mirrors the display font, whitespace-pre so it hugs the
  // text (wraps only on explicit newlines). Off-flow + hidden so it never shows.
  const measureRef = useRef<HTMLDivElement>(null);
  const textFitSig = useRef<string | null>(null);
  const onResizeRef = useRef(d.onResize);
  onResizeRef.current = d.onResize;
  useLayoutEffect(() => {
    if (!isTextVariant) { textFitSig.current = null; return; }
    const sig = `${sizingText}|${fontSize}|${fontWeight}|${scale}`;
    if (textFitSig.current === sig) return; // content/font unchanged → skip
    const el = measureRef.current;
    if (!el) return;
    textFitSig.current = sig;
    // offsetWidth/Height of the measurer = the exact rendered text box; add the
    // padding the visible text carries, so the node box hugs the text.
    const w = Math.max(24, Math.ceil(el.offsetWidth * scale) + TEXT_PAD * 2);
    const h = Math.max(20, Math.ceil(el.offsetHeight * scale) + TEXT_PAD * 2);
    // Current node state from the store (consistent snapshot; not reactive).
    const node = rf.getNode(d.nodeId);
    if (!node) { onResizeRef.current(d.nodeId, w, h); return; }
    const oldW = (node.width ?? (node.data as NodeData).w ?? w) as number;
    const oldH = (node.height ?? (node.data as NodeData).h ?? h) as number;
    if (Math.abs(oldW - w) < 1 && Math.abs(oldH - h) < 1) return; // no change
    // Hold the top-left: center shifts by half the size delta (position==center).
    const center = { x: node.position.x + (w - oldW) / 2, y: node.position.y + (h - oldH) / 2 };
    onResizeRef.current(d.nodeId, w, h, undefined, center);
  }, [isTextVariant, sizingText, fontSize, fontWeight, scale, d.nodeId, rf]);

  // The LOGO variant renders as a full-box icon with its caption floating
  // OUTSIDE the box (see the short-circuit below). Normalize the legacy caption
  // values: "side"→right, "below"→bottom; unset → bottom.
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : a.caption;

  if (a.variant === "logo") {
    // The logo icon ALWAYS fills the full box (it's square/natural). The caption
    // renders OUTSIDE the box on the chosen side, so it never shrinks the logo.
    const pos = capNorm ?? "bottom";
    const fontSize = a.fontSize ?? 13;
    // Caption color: explicit fontColor wins; otherwise, if the icon has a
    // signature hue (medallion layers), match the label to it; else foreground.
    const labelColor = d.fontColor ?? (a.icon ? BRAND_ICON_LABEL_COLOR[a.icon as DatabricksIconName] : undefined);
    // Where the caption sits relative to the box + which way it grows so it stays
    // centered on the logo's edge (top/bottom center horizontally; left/right
    // center vertically and grow away from the box).
    const capClass =
      pos === "top" ? "bottom-full left-1/2 -translate-x-1/2 mb-1 text-center"
      : pos === "bottom" ? "top-full left-1/2 -translate-x-1/2 mt-1 text-center"
      : pos === "left" ? "right-full top-1/2 -translate-y-1/2 mr-1.5 text-right"
      : "left-full top-1/2 -translate-y-1/2 ml-1.5 text-left"; // right
    const hasText = !!a.text;
    // Show the caption when: editing, or it has text, OR it's edit-mode AND
    // SELECTED (the faint "Add label…" placeholder only appears once the logo is
    // selected — not on every logo in edit mode, which was noisy).
    const caption = (editing !== null || hasText || (editMode && selected)) ? (
      editing !== null ? (
        <input
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(null); e.stopPropagation(); }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="w-28 rounded border border-primary/40 bg-background px-1 text-center text-[13px] font-medium outline-none"
          style={{ fontSize, ...(a.bold ? { fontWeight: 700 } : {}), ...(d.fontColor ? { color: d.fontColor } : {}) }}
        />
      ) : hasText ? (
        <span
          className={`whitespace-nowrap font-medium ${labelColor ? "" : "text-foreground"}`}
          style={{ fontSize, ...(a.bold ? { fontWeight: 700 } : {}), ...(labelColor ? { color: labelColor } : {}) }}
          title="Double-click to edit"
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
        >
          {a.text}
        </span>
      ) : (
        // Edit mode + no label yet: faint placeholder as a double-click target.
        <span
          className="whitespace-nowrap text-[13px] italic text-muted-foreground/50"
          style={{ fontSize }}
          title="Double-click to add a label"
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(""); }}
        >
          Add label…
        </span>
      )
    ) : null;
    return (
      <RotatableCard
        rot={d.rot}
        w={d.w ?? ANNOTATION_DEFAULT_SIZE.logo.w}
        h={d.h ?? ANNOTATION_DEFAULT_SIZE.logo.h}
        scale={d.scale ?? 1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        {/* Wrapper is relative so the caption can float OUTSIDE the box.
            Double-clicking the LOGO ITSELF (not just the caption) opens label
            editing — the mark fills the box, so this is the obvious target. */}
        <div
          className="relative h-full w-full"
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={editMode ? (e) => { e.stopPropagation(); setEditing(a.text ?? ""); } : undefined}
        >
          <AnyIcon
            iconKey={a.icon ?? "data"}
            className="h-full w-full [&_svg]:h-full [&_svg]:w-full"
            style={d.iconColor ? { color: d.iconColor } : undefined}
          />
          {caption && <div className={`pointer-events-auto absolute z-10 ${capClass}`}>{caption}</div>}
        </div>
      </RotatableCard>
    );
  }

  // ─── TEXT ─────────────────────────────────────────────────────────────────
  // A dedicated left/top-aligned text renderer. The content FILLS the node box;
  // while UNSIZED the auto-fit effect grows the box to the text (holding the
  // top-left corner fixed — see the effect). Once the user drags a resize grip
  // it becomes `sized` and honors textWrap (wrap | truncate).
  if (a.variant === "text") {
    const align = H_CLASS[hA].split(" ").slice(1).join(" "); // just the text-* class
    // Display whitespace/overflow per mode: auto hugs content (pre, grows);
    // wrap flows within the fixed box; truncate is one line + ellipsis.
    const displayWS =
      textMode === "auto"
        ? "whitespace-pre"
        : textMode === "truncate"
          ? "truncate"
          : "whitespace-pre-wrap break-words";
    const textStyle: React.CSSProperties = {
      fontSize, fontWeight, lineHeight: 1.3, padding: TEXT_PAD,
      ...(d.fontColor ? { color: d.fontColor } : {}),
      ...(d.opacity !== undefined ? { opacity: d.opacity } : {}),
    };
    return (
      <RotatableCard
        rot={d.rot}
        w={d.w ?? ANNOTATION_DEFAULT_SIZE.text.w}
        h={d.h ?? ANNOTATION_DEFAULT_SIZE.text.h}
        scale={1 /* text auto-fits its own box; no content --cs scaling */}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(w, h, center) => {
          // A manual resize means the user wants a FIXED box: switch an `auto`
          // node to `wrap` (the natural fixed default) in the same commit so it
          // keeps the dragged dimensions and stops auto-fitting.
          if (textMode === "auto") d.onAnnotate(d.nodeId, { textWrap: "wrap" });
          d.onResize(d.nodeId, w, h, undefined, center);
        }}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          className={`relative h-full w-full overflow-hidden ${d.fontColor ? "" : "text-foreground"} ${selected ? "ring-2 ring-primary/60" : ""}`}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
          title="Double-click to edit"
          style={{
            background: d.fillColor && d.fillColor !== "transparent" ? d.fillColor : undefined,
            borderRadius: d.borderRadius ?? (showBorder ? 6 : 0),
            borderStyle: showBorder ? (d.borderStyle ?? "solid") : undefined,
            borderWidth: showBorder ? borderW : undefined,
            borderColor: showBorder ? (d.borderColor ?? "var(--border)") : undefined,
          }}
        >
          {editing !== null ? (
            <textarea
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
                else if (e.key === "Escape") setEditing(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              // Fills the box, top-left, whitespace-pre so the text (and thus the
              // measurer/box) grows to the right. No manual rows — the box height
              // comes from the auto-fit.
              className={`absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre border-0 bg-transparent outline-none ${align}`}
              style={textStyle}
            />
          ) : a.text ? (
            <div className={`h-full w-full ${displayWS} ${align}`} style={textStyle}>{a.text}</div>
          ) : (
            <div className={`h-full w-full italic text-muted-foreground/50 ${align}`} style={textStyle}>Text</div>
          )}
          {/* Hidden measurer — off-flow, never visible. whitespace-pre so
              offsetWidth/Height is the exact one-line-per-newline text box. */}
          {isTextVariant && (
            <div
              ref={measureRef}
              aria-hidden
              className="pointer-events-none absolute whitespace-pre"
              style={{ left: -99999, top: -99999, visibility: "hidden", fontSize, fontWeight, lineHeight: 1.3 }}
            >
              {sizingText || "Text"}
            </div>
          )}
        </div>
      </RotatableCard>
    );
  }

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? ANNOTATION_DEFAULT_SIZE[a.variant].w}
      h={d.h ?? ANNOTATION_DEFAULT_SIZE[a.variant].h}
      scale={d.scale ?? 1}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h, center) => {
        d.onResize(d.nodeId, w, h, undefined, center);
      }}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      {a.variant === "box" && (() => {
        // Fill default: a BOX is solid white unless the user sets a color (or
        // "transparent"); plain TEXT is transparent by default.
        const fill = d.fillColor ?? (a.variant === "box" ? "#ffffff" : "transparent");
        const isBox = a.variant === "box";
        // The title bar: BOXES only. Rendered even when empty so there's a
        // double-click target across the top strip — but the divider + padding
        // only show once there's a title (or we're editing it), so an untitled
        // box looks like a plain box.
        const hasTitle = !!(a.title || a.titleIcon) || editingTitle !== null;
        // Mask the border segment behind the legend with the box fill (or the
        // canvas bg when transparent) so the border truly "stops" for the title.
        const legendMask = fill && fill !== "transparent" ? fill : "var(--background)";
        // The box's own corner radius (rounded-md = 6px default; overridable).
        // The legend's TOP corners track it so the rounding stays proportional.
        const boxRadius = d.borderRadius ?? 6;
        const titleBar = isBox ? (
          // A WIDE invisible hit strip spanning the whole top edge — makes the
          // double-click-to-edit target easy to hit anywhere along the top (not
          // just the ~40px legend). The visible legend (mask + title text) is a
          // child docked at the left; it looks like a fieldset legend while the
          // whole strip is clickable. Height 16px straddling the border.
          <div
            onClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(a.title ?? ""); }}
            title="Double-click to edit title"
            className="absolute inset-x-0 top-0 z-10 flex h-4 -translate-y-1/2 items-center"
            style={{ cursor: "text" }}
          >
            <div
              className="ml-3 flex max-w-[calc(100%-24px)] items-center gap-1.5"
              style={hasTitle ? { background: legendMask, padding: "0 6px", borderTopLeftRadius: boxRadius, borderTopRightRadius: boxRadius } : undefined}
            >
              {hasTitle && a.titleIcon && (
                <AnyIcon iconKey={a.titleIcon} className="h-5 w-5 shrink-0 [&_svg]:h-5 [&_svg]:w-5" />
              )}
              {editingTitle !== null ? (
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle();
                    else if (e.key === "Escape") setEditingTitle(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Title"
                  className={`bg-transparent text-[15px] font-semibold leading-none outline-none ${d.fontColor ? "" : "text-foreground"}`}
                  style={d.fontColor ? { color: d.fontColor } : undefined}
                />
              ) : hasTitle ? (
                <span className={`truncate text-[15px] font-semibold leading-none ${d.fontColor ? "" : "text-foreground"}`} style={d.fontColor ? { color: d.fontColor } : undefined}>
                  {a.title}
                </span>
              ) : null}
            </div>
          </div>
        ) : null;
        return (
        <div
          onClick={() => d.onSelect(d.nodeId)}
          title="Double-click to edit"
          className={`relative flex h-full w-full flex-col ${selected ? "ring-2 ring-primary/60" : ""}`}
          style={{
            borderRadius: boxRadius,
            borderStyle: showBorder ? (d.borderStyle ?? "solid") : undefined,
            borderWidth: showBorder ? borderW : undefined,
            borderColor: showBorder ? (d.borderColor ?? "var(--border)") : undefined,
            opacity: d.opacity ?? 1,
            background: fill,
          }}
        >
          {titleBar}
          {/* Body — centered (or aligned) editable text, as before. */}
          <div
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
            className={`flex min-h-0 w-full flex-1 overflow-hidden ${V_CLASS[vA]} ${H_CLASS[hA]}`}
            style={{ padding: showBorder ? 8 : 2 }}
          >
            {editing !== null ? (
              <textarea
                autoFocus
                value={editing}
                rows={Math.max(1, editing.split("\n").length)}
                onChange={(e) => setEditing(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
                  else if (e.key === "Escape") setEditing(null);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                // No h-full: the textarea auto-sizes to its content and lives in
                // the aligned flex slot, so you edit text where it'll actually
                // render (center / top-left / etc.) instead of always top-left.
                className={`w-full resize-none overflow-hidden bg-transparent outline-none ${d.fontColor ? "" : "text-foreground"}`}
                style={{ fontSize, fontWeight, lineHeight: 1.3, textAlign: hA, ...(d.fontColor ? { color: d.fontColor } : {}) }}
              />
            ) : (
              // A BOX wraps its text within the manually-sized box.
              <span
                className={`whitespace-pre-wrap break-words ${d.fontColor ? "" : "text-foreground"}`}
                style={{ fontSize, fontWeight, ...(d.fontColor ? { color: d.fontColor } : {}) }}
                title="Double-click to edit"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
              >
                {a.text}
              </span>
            )}
          </div>
        </div>
        );
      })()}


      {a.variant === "image" && (
        <div
          onClick={() => d.onSelect(d.nodeId)}
          className={`grid h-full w-full place-items-center overflow-hidden rounded-md ${selected ? "ring-2 ring-primary/60" : ""}`}
        >
          {a.src ? (
            <img src={a.src} alt="" className="h-full w-full object-contain" draggable={false} />
          ) : (
            <span className="px-2 text-center text-[11px] text-muted-foreground">Set the image url in the right menu</span>
          )}
        </div>
      )}
    </RotatableCard>
  );
});

/** A searchable picker over EVERY icon we ship — built-in catalog/brand/vendor
 *  React icons AND the file-based icon library (vendor logos, cloud marks).
 *  Used by the "Logo" annotation + the source/cloud library flows. */
export interface PickItem { key: string; label: string; search: string; tabs: string[]; source: boolean }

// Which industry buckets each canonical vendor logo belongs to (built from the
// dedup mapping). Lets one canonical file appear under several industry tabs.
const INDUSTRY_BY_NAME: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [bucket, names] of Object.entries(INDUSTRY_MAP as Record<string, string[]>)) {
    for (const n of names) (out[n] ??= []).push(bucket);
  }
  return out;
})();

/** Build the tabbed icon index once: Databricks (built-in) + cloud + vendor
 *  logos, the latter also tagged with their industry buckets (from the map). */
// Built-in vendor icons that are superseded by a canonical file icon
// (file:vendor/<name>) — skip them in the picker so we don't list a brand twice.
const SUPERSEDED_BUILTINS = new Set<string>(["shopifyLogo", "zendeskLogo", "sapLogo"]);

/** Clean display label for a Databricks icon KEY. Strips the internal
 *  `Brand`/`Logo` suffix and camelCase-splits + title-cases — so `genieBrand` →
 *  "Genie", `genieCodeBrand` → "Genie Code", `genieOneBrand` → "Genie One".
 *  A small override map handles acronyms the generic rule would mangle. */
const ICON_LABEL_OVERRIDES: Record<string, string> = {
  aibiBrand: "AI/BI",
  sdpBrand: "SDP",
  pdfLogo: "PDF",
  aiGatewayBrand: "AI Gateway",
};
export function prettyIconLabel(key: string): string {
  if (ICON_LABEL_OVERRIDES[key]) return ICON_LABEL_OVERRIDES[key];
  return key
    .replace(/(Brand|Logo|Source|Icon)$/, "")     // drop the internal suffix
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")        // camelCase → spaced
    .replace(/^\w/, (m) => m.toUpperCase())          // capitalize first
    .trim();
}

export function buildPickIndex(): { items: PickItem[]; tabs: string[] } {
  const items: PickItem[] = [];
  for (const k of Object.keys(DATABRICKS_ICONS) as DatabricksIconName[]) {
    if (SUPERSEDED_BUILTINS.has(k)) continue; // dup of file:vendor/<name>
    // Databricks built-ins: treat product/source-ish ones as sources; the rest
    // (agents, governance glyphs) aren't data sources. Keep it permissive.
    // Search on the raw key AND the pretty label so "genie" still matches.
    const label = prettyIconLabel(k);
    items.push({ key: k, label, search: `${k} ${label}`.toLowerCase(), tabs: ["Databricks"], source: true });
  }
  for (const f of FILE_ICONS) {
    const tabs = f.group === "cloud"
      ? ["Cloud"]
      : f.group === "persona"
      ? ["Personas"]
      : ["Vendors", ...(INDUSTRY_BY_NAME[f.name] ?? [])]; // vendor → Vendors + its industries
    items.push({ key: f.key, label: f.name, search: `${f.group} ${f.category} ${f.name} ${logoAliases(f.name).join(" ")}`.toLowerCase(), tabs, source: logoMetaByName(f.name).source });
  }
  const order = ["Databricks", "Cloud", "Vendors"];
  const allTabs = new Set<string>();
  items.forEach((i) => i.tabs.forEach((t) => allTabs.add(t)));
  const tabs = ["All", ...Array.from(allTabs).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b);
  })];
  return { items, tabs };
}

export function IconPicker({
  onPick,
  onClose,
  allowTrademark = false,
  sourcesOnly = false,
  initialQuery = "",
}: {
  onPick: (key: string) => void;
  onClose: () => void;
  /** Honor the trademark gate (gated logos render as a badge here too). */
  allowTrademark?: boolean;
  /** Restrict to actual data sources (for the "+ more data sources" picker). */
  sourcesOnly?: boolean;
  /** Seed the search box (e.g. the palette's "see more logos" carries the term
   *  the user already typed so the picker opens pre-filtered). */
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [tab, setTab] = useState("All");
  const { items, tabs } = useMemo(buildPickIndex, []);
  const ql = q.trim().toLowerCase();
  const matches = items.filter(
    (i) => (tab === "All" || i.tabs.includes(tab)) && (!ql || i.search.includes(ql)) && (!sourcesOnly || i.source),
  );
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/60" onClick={onClose}>
      <div
        className="flex max-h-[78vh] w-[min(680px,94vw)] flex-col rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 pt-3 text-[12px] font-semibold text-foreground">
          {sourcesOnly ? "Add a data source" : "Pick a logo"}
        </div>
        <div className="flex items-center gap-2 border-b border-border p-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={sourcesOnly ? "Search data sources (kafka, postgres, salesforce, …)" : "Search logos (snowflake, s3, bigquery, kafka, genie, …)"}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
          />
          <span className="text-[11px] text-muted-foreground">{matches.length}</span>
        </div>
        {/* Group tabs */}
        <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {t.replace(/-/g, " ")}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2 overflow-y-auto p-3">
          {matches.slice(0, 400).map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => { onPick(i.key); onClose(); }}
              title={i.key}
              className="flex flex-col items-center gap-1 rounded-lg border border-transparent p-2 hover:border-border hover:bg-muted"
            >
              <span className="grid h-7 w-7 place-items-center">
                <BrandMark iconKey={i.key} label={i.label} bandColor="#64748b" allowTrademark={allowTrademark} className="h-7 w-7" mono />
              </span>
              <span className="w-full truncate text-center text-[8px] text-muted-foreground">{i.label}</span>
            </button>
          ))}
          {matches.length === 0 && <div className="col-span-7 py-6 text-center text-[12px] text-muted-foreground">No icons match.</div>}
          {matches.length > 400 && (
            <div className="col-span-7 py-2 text-center text-[11px] text-muted-foreground">+{matches.length - 400} more — refine your search</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Downscale a pasted image to <= maxPx on its longest side and return a
 *  base64 data URL (JPEG for photos, PNG kept for graphics with alpha). */
export async function imageFileToDownscaledDataUrl(file: File, maxPx = 1024): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  if (scale >= 1) return dataUrl; // already small enough
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // PNG preserves alpha; fall back to it (JPEG would black out transparency).
  const out = file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  return out;
}
