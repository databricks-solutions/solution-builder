/**
 * platform-diagram/annotations — free-form canvas annotations that aren't
 * Databricks catalog components: plain Text, a Box (bordered text), a Logo
 * (any icon from the library), and an Image (URL or pasted base64). All four
 * are one ReactFlow node kind ("annotation") with a `variant`; their props live
 * in the node's layout entry (NodePosition.annotation) so they persist.
 */
import { memo, useContext, useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, BRAND_ICONS, BRAND_ICON_LABEL_COLOR, officialComponentFor, type DatabricksIconName } from "../../databricks-icons";
import { ICON_ALIASES, DBX_ICON_ORANGE, canonicalIconKey, iconColorOf } from "@/lib/icon-aliases";
import { FILE_ICONS, FileSvgIcon, isFileIconKey, logoMetaByName, logoAliases } from "../../file-icons";
import INDUSTRY_MAP from "../../../icons/industry-map.json";
import { BrandMark } from "./brand-mark";
import { MdText, MdTextarea } from "./md-text";
import { type AnnotationData, type AnnotationVariant, FRAME_TITLE_NODE_ID, isCustomIconKey, isLucideIconKey, customLogoId, logoFootprint, logoIconSlot, logoCaptionFont, withCardFont,LOGO_CAP_PAD, CALLOUT_FILL, CALLOUT_INK, CALLOUT_FONT_RATIO, cardLayout, boxSubtitleH, CARD_WIDTH, BOX_SUBTITLE_FONT, insideTitleMetrics, isInsideTitlePos, BOX_TITLE_INSET, htmlBlockLayout, HTML_BLOCK_DEFAULT_W, HTML_BLOCK_MIN_H, CARD_BODY_FONT } from "@/lib/platform-architecture";
import { sanitizeDiagramHtml } from "@/lib/card-body";
import { shapePath, shapeTextInset, SHAPE_LABEL, DEFAULT_SHAPE_KIND } from "./shape-geometry";
import { CardFace, CornerBadge } from "./card-face";
import { lucideGlyphComponent, LUCIDE_GLYPH_STROKE, LUCIDE_GLYPH_INK } from "./lucide-glyphs";
import { RotatableCard, DropTargetContext, EditModeContext, CustomLogosContext, AutoEditContext, InlineSvgIcon, shadowCss, shadowLevel, type NodeData } from "./shared";

/** Render any icon key — a built-in DatabricksIconName, a file-icon key
 *  ("file:…"), or a custom inline-SVG logo ("custom:<id>") — at a given size.
 *  Used by the Logo annotation + the picker. */
export function AnyIcon({ iconKey: rawIconKey, className, style, iconColor }: { iconKey: string; className?: string; style?: React.CSSProperties; iconColor?: string }) {
  // One resolver: an alias (built-in or file key) renders its canonical artwork, in its alias colour.
  const iconKey = canonicalIconKey(rawIconKey);
  const tint = iconColor ?? iconColorOf(rawIconKey);
  const customLogos = useContext(CustomLogosContext);
  if (isCustomIconKey(iconKey)) {
    const svg = customLogos[customLogoId(iconKey)];
    if (svg) return <InlineSvgIcon svg={svg} className={className} style={style} />;
    // Unknown custom id → neutral placeholder.
    const Data = DATABRICKS_ICONS.data;
    return <Data className={className} style={{ color: "var(--muted-foreground)", ...style }} />;
  }
  // Generic line glyph (`lucide:<name>`): thin strokes in the shared muted ink; an
  // explicit colour in `style` (card textColor, node iconColor) wins.
  const Glyph = lucideGlyphComponent(iconKey);
  if (Glyph) return <Glyph className={className} strokeWidth={LUCIDE_GLYPH_STROKE} style={{ color: tint ?? LUCIDE_GLYPH_INK, ...style }} />;
  const Official = officialComponentFor(iconKey);
  // Databricks line/UI art: one default colour (the brand orange) unless the node sets its own.
  if (Official) return <Official className={className} style={{ color: tint ?? DBX_ICON_ORANGE, ...style }} />;
  if (isFileIconKey(iconKey)) return <FileSvgIcon iconKey={iconKey} className={className} style={style} />;
  const Icon = DATABRICKS_ICONS[iconKey as DatabricksIconName] || DATABRICKS_ICONS.data;
  const isBrand = BRAND_ICONS.has(iconKey as DatabricksIconName);
  return <Icon className={className} style={isBrand ? (tint ? { color: tint, ...style } : style) : { color: tint ?? "var(--foreground)", ...style }} />;
}

/** Inline logo for markdown text (`![OpenAI](file:vendor/openai)`) — see md-text. */
const renderMdIcon = (iconKey: string) => <AnyIcon iconKey={iconKey} className="h-full w-auto" />;

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
  // A step callout is a circle — keep w == h (the render uses the short axis).
  callout: { w: 84, h: 84 },
  logo: { w: 60, h: 60 },
  image: { w: 200, h: 140 },
  note: { w: 180, h: 140 },
  // A process step — wide enough for two or three words on one line. Must match
  // ANNOTATION_SIZE.shape in platform-architecture.ts (symbolic layout sizes
  // nodes through that one; `test:layout` pins the two together).
  shape: { w: 200, h: 90 },
  // A card's height is content-driven (cardLayout); this is the no-content fallback.
  // MUST equal ANNOTATION_SIZE.card in platform-architecture.ts (test:layout pins it).
  card: { w: CARD_WIDTH, h: 120 },
  // MUST equal ANNOTATION_SIZE.html in platform-architecture.ts (test:layout pins it).
  html: { w: HTML_BLOCK_DEFAULT_W, h: HTML_BLOCK_MIN_H },
};

/** What a freshly-added HTML block contains: a small generic KPI strip (three cells on a
 *  grid). The user or the agent replaces it; it only shows the block is free-form. */
export const HTML_BLOCK_STARTER =
  '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'
  + '<div style="background:#F1F5F9;border-radius:8px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#0F172A">98%</div><small style="color:#64748B">Uptime</small></div>'
  + '<div style="background:#F1F5F9;border-radius:8px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#0F172A">1.2M</div><small style="color:#64748B">Orders a day</small></div>'
  + '<div style="background:#F1F5F9;border-radius:8px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#0F172A">240 ms</div><small style="color:#64748B">p95 latency</small></div>'
  + '</div>';

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
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  // html block: double-click makes the rendered body contentEditable; blur commits
  // its innerHTML (re-sanitized on render), Escape restores the stored HTML.
  const [editingHtml, setEditingHtml] = useState(false);
  const htmlRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editingHtml) htmlRef.current?.focus(); }, [editingHtml]);
  const commitHtml = () => {
    if (!editingHtml) return;
    setEditingHtml(false);
    const next = htmlRef.current?.innerHTML;
    if (next !== undefined && next !== sanitizeDiagramHtml(a.html ?? "")) d.onAnnotate(d.nodeId, { html: next });
  };

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
  const commitDesc = () => {
    if (editingDesc !== null) {
      // A logo desc renders as the muted 2nd caption line; setting it turns the
      // line ON (showDesc), clearing it back to empty leaves it addable in edit.
      d.onAnnotate(d.nodeId, { desc: editingDesc, showDesc: editingDesc.trim() ? true : false });
      setEditingDesc(null);
    }
  };

  // A freshly-dropped TEXT or NOTE node auto-enters edit mode so the cursor lands
  // in it (like any editor). Consume the one-shot signal so it doesn't re-fire.
  const autoEdit = useContext(AutoEditContext);
  useEffect(() => {
    if (autoEdit.id === d.nodeId && (a.variant === "text" || a.variant === "note" || a.variant === "shape")) {
      setEditing(a.text ?? "");
      autoEdit.clear();
    }
  }, [autoEdit, d.nodeId, a.variant, a.text]);

  // A slightly larger default survives PNG framing better; authored sizes win.
  const fontSize = a.fontSize ?? (d.theme === "slide" ? 18 : 16);
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
    // onResize takes FOOTPRINT dims (what NodeResizer reports) and un-swaps a
    // rotated node back to card dims, so a rotated label must hand it the swapped
    // pair. Passing card dims here clipped a rotated label to its height.
    const q = (((d.rot ?? 0) % 360) + 360) % 360;
    const swapped = q === 90 || q === 270;
    const fw = swapped ? h : w;
    const fh = swapped ? w : h;
    // Current node state from the store (consistent snapshot; not reactive).
    const node = rf.getNode(d.nodeId);
    if (!node) { onResizeRef.current(d.nodeId, fw, fh); return; }
    const oldW = (node.width ?? (node.data as NodeData).w ?? fw) as number;
    const oldH = (node.height ?? (node.data as NodeData).h ?? fh) as number;
    if (Math.abs(oldW - fw) < 1 && Math.abs(oldH - fh) < 1) return; // no change
    // Hold the top-left: center shifts by half the size delta (position==center).
    const center = { x: node.position.x + (fw - oldW) / 2, y: node.position.y + (fh - oldH) / 2 };
    onResizeRef.current(d.nodeId, fw, fh, undefined, center);
  }, [isTextVariant, sizingText, fontSize, fontWeight, scale, d.nodeId, d.rot, rf]);

  // The LOGO variant renders as a centered icon+caption flex (see the
  // short-circuit below). Normalize the legacy caption values: "side"→right,
  // "below"→bottom; unset → bottom.
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : a.caption;

  // The derived FRAME title band (see FRAME_TITLE_NODE_ID): a deck-style heading
  // pair — bold title over a muted subtitle, left-aligned to the content edge,
  // bottom-anchored so it sits just above the diagram. No fill, no border: it is
  // typography, not a container.
  if (d.nodeId === FRAME_TITLE_NODE_ID) {
    const titleFont = a.fontSize ?? 44;
    const subFont = a.subtitleFontSize ?? 28;
    return (
      <div className="flex h-full w-full flex-col justify-end text-left">
        <div className="font-semibold leading-tight tracking-tight text-foreground" style={{ fontSize: titleFont }}>
          {a.text}
        </div>
        {a.subtitle && (
          <div className="mt-2 font-normal leading-snug text-muted-foreground" style={{ fontSize: subFont }}>
            {a.subtitle}
          </div>
        )}
      </div>
    );
  }

  // ─── HTML BLOCK (free-form content) ────────────────────────────────────────
  // Transparent unless the frame is styled (border / fill / radius / shadow / padding).
  // The HTML is the card body's sanitizer, and its height is measured by the same
  // htmlBlockLayout the layout uses, so the drawn block and the reserved box agree. The
  // inner body is overflow:hidden at that height: content the estimate missed clips
  // visibly, and inspect-arch reports it (CLIPPED TEXT on [data-html-body]).
  if (a.variant === "html") {
    const pad = a.padding ?? 0;
    const layout = htmlBlockLayout(a.html, { w: d.w, h: d.h }, pad);
    const bw = d.borderWidth ?? 0;
    const frame: React.CSSProperties = {
      boxSizing: "border-box",
      padding: pad,
      background: d.fillColor,
      border: bw > 0 ? `${bw}px ${d.borderStyle ?? "solid"} ${d.borderColor ?? "#CBD5E1"}` : undefined,
      borderRadius: d.borderRadius,
      boxShadow: shadowCss(d.shadow === undefined ? 0 : shadowLevel(d.shadow)),
      fontSize: CARD_BODY_FONT,
      lineHeight: 1.35,
      color: d.fontColor ?? "#0F172A",
      overflowWrap: "anywhere",
    };
    return (
      <RotatableCard
        rot={d.rot}
        w={layout.w}
        h={layout.h}
        scale={d.scale ?? 1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          className={`h-full w-full ${selected ? "ring-2 ring-primary/60 ring-offset-2" : ""}`}
          style={{ opacity: d.opacity }}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); if (editMode) setEditingHtml(true); }}
          title={editMode ? "Double-click to edit the text (the panel edits the HTML)" : undefined}
        >
          <div className="h-full w-full overflow-hidden" style={frame}>
            <div
              ref={htmlRef}
              data-html-body
              contentEditable={editingHtml}
              suppressContentEditableWarning
              onBlur={commitHtml}
              onKeyDown={editingHtml ? (e) => {
                e.stopPropagation();
                if (e.key === "Escape") { if (htmlRef.current) htmlRef.current.innerHTML = sanitizeDiagramHtml(a.html ?? ""); setEditingHtml(false); }
              } : undefined}
              className={`${editingHtml ? "nodrag nopan cursor-text outline-none " : ""}h-full w-full overflow-hidden [&_*]:m-0 [&_h1]:text-[18px] [&_h1]:font-bold [&_h2]:text-[16px] [&_h2]:font-bold [&_h3]:text-[14px] [&_h3]:font-bold [&_h4]:font-bold [&_ol]:pl-4 [&_ul]:pl-4`}
              dangerouslySetInnerHTML={{ __html: sanitizeDiagramHtml(a.html ?? "") }}
            />
          </div>
        </div>
      </RotatableCard>
    );
  }

  // ─── CARD (rich content tile) ──────────────────────────────────────────────
  // Header band (icon + title) + bold summary + grey description + chips + tags,
  // optional corner badge. The box size is measured from the text by cardLayout —
  // the SAME call flow-mapping and computeLayout make — so the drawn card and the
  // reserved footprint agree. A user-set w is honoured; h is a floor (never clips).
  if (a.variant === "card") {
    const layout = cardLayout(withCardFont(a, d.cardFont), { w: d.w, h: d.h });
    // Double-click the card to edit its title in place (same commit path as a box).
    const titleSlot = editingTitle !== null ? (
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
        onDoubleClick={(e) => e.stopPropagation()}
        placeholder="Title"
        className="nodrag w-full bg-transparent outline-none"
        style={{ font: "inherit", color: "inherit" }}
      />
    ) : undefined;
    return (
      <RotatableCard
        rot={d.rot}
        w={layout.w}
        h={layout.h}
        scale={d.scale ?? 1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          className={`h-full w-full ${selected ? "ring-2 ring-primary/60 ring-offset-2" : ""}`}
          style={{ opacity: d.opacity, borderRadius: 10 }}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(a.title ?? ""); }}
          title="Card — double-click to edit the title"
        >
          <CardFace
            a={a}
            layout={layout}
            border={{ width: d.borderWidth, style: d.borderStyle, radius: d.borderRadius }}
            titleSlot={titleSlot}
            icon={a.icon ? <AnyIcon iconKey={a.icon} className="h-full w-full" iconColor={d.iconColor} style={a.textColor && isLucideIconKey(a.icon) ? { color: a.textColor } : undefined} /> : undefined}
          />
        </div>
      </RotatableCard>
    );
  }

  if (a.variant === "logo") {
    // The logo renders as ONE centered unit: a fixed icon square + the caption
    // laid out beside/below it in a flex that FILLS the node box. Because the
    // flex container == the box (centered on the node position), the whole
    // icon+caption group reads as centered — so it sits centered inside a wrapping
    // box or a column (the off-center-caption bug). The node box is sized to the
    // full icon+caption footprint (see flow-mapping schemaToFlow + computeLayout's
    // sizeOf, both via `logoFootprint`); the icon keeps its natural square.
    const pos = capNorm ?? "bottom";
    const captionDefault = d.theme === "slide" ? 18 : 15;
    // Caption color: explicit fontColor wins; otherwise, if the icon has a
    // signature hue (medallion layers), match the label to it; else foreground.
    const labelColor = d.fontColor ?? (a.icon ? BRAND_ICON_LABEL_COLOR[a.icon as DatabricksIconName] : undefined);
    const horizontal = pos === "left" || pos === "right";
    // The icon keeps its natural square (the default logo size); the box is the
    // full icon+caption footprint. When the file stored no explicit w/h (a
    // col-placed logo), DERIVE that footprint here so the card fills the RF node
    // box (flow-mapping computed the same box via `logoFootprint`). A dragged /
    // add-time-sized logo (d.w/d.h set) keeps its box, and the icon square then
    // tracks the box's short axis so a resize scales the whole unit.
    const iconNat = ANNOTATION_DEFAULT_SIZE.logo.h;
    const fit = logoFootprint(ANNOTATION_DEFAULT_SIZE.logo.w, iconNat, a);
    // A captioned logo in a same-lane group carries a DERIVED lane-uniform width
    // (`d.laneW`, computeLayout step 2.5) so grouped cards match; the flex then
    // hugs the icon to the caption-side edge (below) so the icons still line up.
    // A user resize (`d.w`) wins; else `laneW`; else the tight icon+caption fit.
    const laneW = (d as NodeData).laneW;
    const boxW = d.w ?? laneW ?? fit.w;
    const boxH = d.h ?? fit.h;
    // When a uniform lane width is imposed (box wider than the tight fit), the
    // icon+caption unit must hug the caption-side edge instead of centering — the
    // group's icons all sit on the same lane edge (step 2.5 aligned the boxes).
    const hugEdge = !d.w && laneW !== undefined && horizontal;
    // Icon square. For an AUTO-SIZED box (no explicit user w/h) keep the icon at
    // its NATURAL size — `logoFootprint` reserved the box height as
    // icon+gap+caption(+desc), so scaling the icon to the box's short axis would
    // eat the caption/desc space and push them BELOW the box (the overflow bug).
    // Only when the USER resized the box (d.w/d.h set) does the icon scale to fill
    // it, so a drag grows the whole unit. `iconNat` is the default logo icon size.
    const userSized = d.w !== undefined || d.h !== undefined;
    // Caption size: a user-sized logo's caption grows with its slot (logoCaptionFont); auto-sized keeps the default.
    const fontSize = logoCaptionFont({ w: boxW, h: boxH }, a, { sized: userSized, dflt: captionDefault });
    // A user-sized logo's pictogram fills its slot (logoIconSlot — the same helper
    // logoIconRect anchors on), so a larger node gives a larger icon.
    const iconSq = !userSized
      ? iconNat
      : Math.max(12, logoIconSlot({ w: boxW, h: boxH }, a, { sized: userSized, dflt: captionDefault }));
    // Tile: a logo's own fill/border/shadow paints a rounded tile behind the ICON
    // (the "app icon" look), never around the caption. The tile takes the icon
    // square, so the footprint and the edge anchors are unchanged; the pictogram
    // is inset inside it.
    const tileFill = d.fillColor && d.fillColor !== "transparent" ? d.fillColor : undefined;
    const tileBorder = d.borderWidth ?? 0;
    const tiled = !!tileFill || tileBorder > 0 || (d.shadow !== undefined && shadowLevel(d.shadow) > 0);
    const tileIcon = Math.max(8, Math.round(iconSq * 0.74));
    // Flex direction so the icon+caption group is centered as a unit: row for
    // right (icon→text), row-reverse for left, column for bottom, column-reverse
    // for top. `items-center justify-center` centers the whole group in the box.
    const flexDir =
      pos === "right" ? "flex-row"
      : pos === "left" ? "flex-row-reverse"
      : pos === "bottom" ? "flex-col"
      : "flex-col-reverse"; // top
    const capAlign = horizontal ? (pos === "left" ? "text-right" : "text-left") : "text-center";
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
    // Optional SECOND caption line — a smaller, muted description under the label
    // (e.g. a domain logo "Airline" / "Flights, crew & ops data"). Shown when it
    // has text (showDesc), or as an "Add description…" affordance once the logo is
    // selected in edit mode. Only sensible for a top/bottom caption (a left/right
    // side caption stays single-line — stacking there reads badly).
    const descFontSize = Math.max(10, fontSize - 2);
    const hasDesc = !!(a.showDesc && a.desc);
    // A logo with no caption yet has a footprint of the bare icon, so an in-flow
    // placeholder/input would squash the icon and spill out of the box. Float it
    // under the box instead, and offer the description only once there is a label.
    const floatCaption = !hasText && !hasDesc;
    const descLine = (pos === "top" || pos === "bottom") && (editingDesc !== null || hasDesc || (editMode && selected && hasText)) ? (
      editingDesc !== null ? (
        <input
          autoFocus
          value={editingDesc}
          onChange={(e) => setEditingDesc(e.target.value)}
          onBlur={commitDesc}
          onKeyDown={(e) => { if (e.key === "Enter") commitDesc(); else if (e.key === "Escape") setEditingDesc(null); e.stopPropagation(); }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="mt-0.5 w-32 rounded border border-primary/40 bg-background px-1 text-center outline-none"
          style={{ fontSize: descFontSize }}
        />
      ) : hasDesc ? (
        <span
          className="mt-0.5 block max-w-[220px] text-center leading-tight text-muted-foreground"
          style={{ fontSize: descFontSize, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          title={a.desc}
          onDoubleClick={(e) => { e.stopPropagation(); setEditingDesc(a.desc ?? ""); }}
        >
          {a.desc}
        </span>
      ) : (
        <span
          className="mt-0.5 block text-center italic text-muted-foreground/40"
          style={{ fontSize: descFontSize }}
          title="Double-click to add a description"
          onDoubleClick={(e) => { e.stopPropagation(); setEditingDesc(""); }}
        >
          Add description…
        </span>
      )
    ) : null;
    return (
      <RotatableCard
        rot={d.rot}
        w={boxW}
        h={boxH}
        scale={d.scale ?? 1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        {/* Icon + caption as ONE centered flex FILLING the box. Because the
            container is the box (centered on the node position), the whole
            icon+caption group reads as centered — so it sits centered inside a
            wrapping box / column instead of the icon centering while the caption
            spills off one side (the bug). Double-clicking the group opens label
            editing. */}
        <div
          className={`relative flex h-full w-full items-center ${hugEdge ? "justify-start" : "justify-center"} ${flexDir}`}
          style={{ padding: LOGO_CAP_PAD }}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={editMode ? (e) => { e.stopPropagation(); setEditing(a.text ?? ""); } : undefined}
        >
          {tiled ? (
            <div
              className="grid shrink-0 place-items-center"
              style={{
                width: iconSq, height: iconSq, boxSizing: "border-box",
                background: tileFill,
                border: tileBorder > 0 ? `${tileBorder}px ${d.borderStyle ?? "solid"} ${d.borderColor ?? "#E2E8F0"}` : undefined,
                borderRadius: d.borderRadius ?? 8,
                boxShadow: shadowCss(d.shadow === undefined ? 0 : shadowLevel(d.shadow)),
              }}
            >
              <AnyIcon
                iconKey={a.icon ?? "data"}
                className="[&_svg]:h-full [&_svg]:w-full"
                style={{ width: tileIcon, height: tileIcon, ...(d.iconColor ? { color: d.iconColor } : {}) }}
              />
            </div>
          ) : (
            <AnyIcon
              iconKey={a.icon ?? "data"}
              className="shrink-0 [&_svg]:h-full [&_svg]:w-full"
              style={{ width: iconSq, height: iconSq, ...(d.iconColor ? { color: d.iconColor } : {}) }}
            />
          )}
          {(caption || descLine) && (
            <div
              className={floatCaption
                ? "pointer-events-auto absolute left-1/2 top-full mt-1 flex -translate-x-1/2 flex-col items-center"
                : `pointer-events-auto flex min-w-0 flex-col ${capAlign} ${horizontal ? (pos === "left" ? "mr-1.5 items-end" : "ml-1.5 items-start") : pos === "top" ? "mb-1 items-center" : "mt-1 items-center"}`}
            >
              {caption}
              {descLine}
            </div>
          )}
        </div>
      </RotatableCard>
    );
  }

  // ─── CALLOUT (numbered circle) ─────────────────────────────────────────────
  // The big numbered circle that keys a spot on the diagram to a legend line —
  // deliberately large, because at share size a mid-line edge number vanishes.
  // The digit scales with the circle (an explicit `fontSize` still wins), so
  // resizing one keeps it legible instead of leaving tiny text in a big disc.
  if (a.variant === "callout") {
    const w = d.w ?? ANNOTATION_DEFAULT_SIZE.callout.w;
    const h = d.h ?? ANNOTATION_DEFAULT_SIZE.callout.h;
    const diameter = Math.min(w, h);
    const numFont = a.fontSize ?? Math.round(diameter * CALLOUT_FONT_RATIO);
    const fill = d.fillColor && d.fillColor !== "transparent" ? d.fillColor : CALLOUT_FILL;
    const ink = d.fontColor ?? CALLOUT_INK;
    // A callout defaults to a subtle darker rim; borderWidth 0 removes it.
    const rim = d.borderWidth ?? 2;
    return (
      <RotatableCard
        rot={d.rot}
        w={w}
        h={h}
        scale={1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(rw, rh, center) => {
          // Keep it a circle: a drag on any grip resizes both axes together.
          const s = Math.round(Math.min(rw, rh));
          d.onResize(d.nodeId, s, s, undefined, center);
        }}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          className={`grid h-full w-full place-items-center rounded-full ${selected ? "ring-2 ring-primary/60" : ""}`}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
          title="Double-click to edit the number"
          style={{
            background: fill,
            borderColor: rim > 0 ? (d.borderColor ?? "rgba(0,0,0,0.22)") : undefined,
            borderStyle: rim > 0 ? (d.borderStyle ?? "solid") : undefined,
            borderWidth: rim > 0 ? rim : undefined,
            opacity: d.opacity,
            boxShadow: d.shadow === 0 || d.shadow === false ? undefined : "0 2px 6px rgba(0,0,0,0.18)",
          }}
        >
          {editing !== null ? (
            <input
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") setEditing(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full border-0 bg-transparent text-center outline-none"
              style={{ fontSize: numFont, fontWeight: 700, color: ink }}
            />
          ) : (
            <span
              className="select-none"
              // lineHeight must CONTAIN the glyph box: with `leading-none` a bold
              // 35px digit overflows its line box by ~5px, which the layout check
              // reports as clipped text on every callout.
              style={{ fontSize: numFont, lineHeight: 1.2, fontWeight: a.bold === false ? 500 : 700, color: ink }}
            >
              {a.text || "1"}
            </span>
          )}
        </div>
      </RotatableCard>
    );
  }

  // ─── SHAPE (flowchart symbol) ──────────────────────────────────────────────
  // A process-flow step: one SVG path (from the pure `shape-geometry` module)
  // filling the node box, with an editable centred label on top.
  //
  // Three things make it behave like a first-class node rather than a picture:
  //   • the SVG is sized in the node's OWN px (never a scaled viewBox), so the
  //     border stays uniform and corners stay sharp at any size — see the module
  //     header for why a 0..100 viewBox is wrong here;
  //   • the label sits inside `shapeTextInset`, so text in a diamond/triangle
  //     stays INSIDE the outline instead of spilling over the empty corners;
  //   • it goes through RotatableCard like every other annotation, so it gets
  //     resize grips, rotation AND connectable edge handles for free — which is
  //     what makes a flow (shape → shape → shape) drawable.
  if (a.variant === "shape") {
    const kind = a.shape ?? DEFAULT_SHAPE_KIND;
    const w = d.w ?? ANNOTATION_DEFAULT_SIZE.shape.w;
    const h = d.h ?? ANNOTATION_DEFAULT_SIZE.shape.h;
    // A shape defaults to a visible 2px outline (it IS the symbol — a borderless
    // shape reads as a floating label); borderWidth 0 removes it.
    const strokeW = d.borderWidth ?? 2;
    const stroke = strokeW > 0 ? (d.borderColor ?? "var(--border)") : "none";
    const fill = d.fillColor ?? "#ffffff";
    const path = shapePath(kind, { w, h, stroke: strokeW });
    const pad = shapeTextInset(kind, { w, h });
    const hasText = !!a.text;
    return (
      <RotatableCard
        rot={d.rot}
        w={w}
        h={h}
        scale={d.scale ?? 1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(rw, rh, center) => d.onResize(d.nodeId, rw, rh, undefined, center)}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          className={`relative h-full w-full ${selected ? "ring-2 ring-primary/60 ring-offset-2" : ""}`}
          style={{ opacity: d.opacity, borderRadius: 4 }}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
          title="Double-click to edit the label"
        >
          <svg
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            className="absolute inset-0"
            style={{ display: "block", overflow: "visible" }}
            aria-hidden
          >
            <path
              d={path}
              fill={fill === "transparent" ? "none" : fill}
              stroke={stroke}
              strokeWidth={strokeW > 0 ? strokeW : undefined}
              strokeDasharray={strokeW > 0 && d.borderStyle === "dashed" ? "6 4" : undefined}
              strokeLinejoin="round"
              style={d.shadow === 0 || d.shadow === false ? undefined : { filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.12))" }}
            />
          </svg>
          {/* Label — inside the shape's usable inner box. */}
          <div
            className={`absolute flex overflow-hidden ${V_CLASS[vA]} ${H_CLASS[hA]}`}
            style={{ top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left }}
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
                className={`w-full resize-none overflow-hidden bg-transparent text-center outline-none ${d.fontColor ? "" : "text-foreground"}`}
                style={{ fontSize, fontWeight, lineHeight: 1.35, textAlign: hA, ...(d.fontColor ? { color: d.fontColor } : {}) }}
              />
            ) : hasText ? (
              <span
                className={`whitespace-pre-wrap break-words ${d.fontColor ? "" : "text-foreground"}`}
                style={{ fontSize, fontWeight, lineHeight: 1.35, ...(d.fontColor ? { color: d.fontColor } : {}) }}
              >
                {a.text}
              </span>
            ) : editMode ? (
              <span className="italic text-muted-foreground/50" style={{ fontSize }}>
                {SHAPE_LABEL[kind]}
              </span>
            ) : null}
          </div>
        </div>
      </RotatableCard>
    );
  }

  // ─── NOTE (post-it) ────────────────────────────────────────────────────────
  // A stylized sticky note: a soft-yellow card with a subtle shadow + tiny tilt,
  // holding an editable comment. Drop it anywhere to annotate the diagram. Reuses
  // the same editing/commit machinery as text; `fillColor` overrides the paper
  // color and `fontColor`/`fontSize` the ink.
  if (a.variant === "note") {
    const paper = d.fillColor && d.fillColor !== "transparent" ? d.fillColor : "#FEF3C7"; // amber-100
    return (
      <RotatableCard
        rot={d.rot}
        w={d.w ?? ANNOTATION_DEFAULT_SIZE.note.w}
        h={d.h ?? ANNOTATION_DEFAULT_SIZE.note.h}
        scale={1}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          className={`relative h-full w-full overflow-hidden ${selected ? "ring-2 ring-primary/60" : ""}`}
          onClick={() => d.onSelect(d.nodeId)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
          title="Double-click to edit the note"
          style={{
            background: paper,
            // A gentle "peeled corner" feel: rounded except a squared top-left,
            // a warm shadow, and a hairline border a shade darker than the paper.
            borderRadius: "2px 10px 10px 10px",
            boxShadow: "0 3px 8px rgba(120,90,10,0.18), inset 0 1px 0 rgba(255,255,255,0.5)",
            border: "1px solid rgba(180,140,20,0.35)",
            transform: d.rot === undefined ? "rotate(-1.2deg)" : undefined, // tiny default tilt (unless the user rotated it)
            opacity: d.opacity,
          }}
        >
          {editing !== null ? (
            <MdTextarea
              autoFocus
              value={editing}
              onValue={setEditing}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
                else if (e.key === "Escape") setEditing(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words border-0 bg-transparent p-2.5 outline-none"
              style={{ fontSize: fontSize || 13, lineHeight: 1.35, color: d.fontColor || "#78350F", fontWeight }}
            />
          ) : (
            <div
              className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2.5"
              style={{ fontSize: fontSize || 13, lineHeight: 1.35, color: d.fontColor || "#78350F", fontWeight }}
            >
              {a.text ? <MdText icon={renderMdIcon} text={a.text} /> : <span className="italic opacity-50">Note…</span>}
            </div>
          )}
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
    // Whitespace per mode now lives in <MdText wrap>: auto hugs content (blocks
    // don't wrap, the box grows), wrap flows within the fixed box, truncate clips.
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
            <MdTextarea
              autoFocus
              value={editing}
              onValue={setEditing}
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
            // Markdown: an auto label grows (blocks don't wrap), a fixed box wraps.
            <MdText icon={renderMdIcon}
              text={a.text}
              wrap={textMode === "wrap" ? "pre-wrap" : "pre"}
              className={`h-full w-full ${textMode === "truncate" ? "overflow-hidden text-ellipsis" : ""} ${align}`}
              style={textStyle}
            />
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
              {editing === null && a.text ? <MdText icon={renderMdIcon} text={a.text} wrap="pre" /> : (sizingText || "Text")}
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
        // A box's title strip (style.headerFill) is its own fill, so the legend mask matches it.
        const legendMask = d.headerFill ? d.headerFill : fill && fill !== "transparent" ? fill : "var(--background)";
        // The box's own corner radius (rounded-md = 6px default; overridable).
        // The legend's TOP corners track it so the rounding stays proportional.
        const boxRadius = d.borderRadius ?? 6;
        // The title normally sits at a fixed 15px, but a box authored with a BIG
        // body font (the numbered-callout legend) needs a heading in proportion —
        // otherwise the one block meant to be read at share size has a heading
        // nobody can read. Only kicks in above the 14px default, so every
        // existing box is byte-identical.
        const titleFont = fontSize > 14 ? fontSize + 2 : 15;
        // An INSIDE title (titlePos top/bottom) replaces the border strip below: it is a
        // block inside the box, reserved by the same band computeLayout uses.
        const insideTitle = isBox && isInsideTitlePos(a.titlePos) ? a.titlePos : undefined;
        const titleBar = isBox && !insideTitle ? (
          // A WIDE invisible hit strip spanning the whole top edge — makes the
          // double-click-to-edit target easy to hit anywhere along the top (not
          // just the ~40px legend). The visible legend (mask + title text) is a
          // child docked at the left; it looks like a fieldset legend while the
          // whole strip is clickable. Height 16px straddling the border.
          <div
            onClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(a.title ?? ""); }}
            title="Double-click to edit title"
            className="absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 items-center"
            style={{ cursor: "text", height: Math.max(16, titleFont) }}
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
                  className={`bg-transparent font-semibold leading-none outline-none ${d.fontColor ? "" : "text-foreground"}`}
                  style={{ fontSize: titleFont, ...(d.fontColor ? { color: d.fontColor } : {}) }}
                />
              ) : hasTitle ? (
                <span className={`truncate font-semibold leading-none ${d.fontColor ? "" : "text-foreground"}`} style={{ fontSize: titleFont, ...(d.fontColor ? { color: d.fontColor } : {}) }}>
                  {a.title}
                </span>
              ) : null}
            </div>
          </div>
        ) : null;
        // Where the title block ends (the body's top padding clears the title's
        // lower half). A SUBTITLE sits in that same gap, so the body's top padding
        // grows by the subtitle's measured height — `boxSubtitleH` is the SAME helper
        // computeLayout uses to grow the box upward, at the SAME box width, so members
        // never sit under it.
        const topBase = hasTitle ? (showBorder ? 8 : 2) + Math.ceil(titleFont / 2) + 6 : (showBorder ? 8 : 2);
        // The box's drawn width: the width computeLayout measured its title band and
        // subtitle at (a wrapping box's `d.w` is that layout width).
        const boxW = d.w ?? ANNOTATION_DEFAULT_SIZE[a.variant].w;
        // Inside title: the band (inset + title + subtitle + gap) at the top/bottom edge.
        const inMetrics = insideTitle ? insideTitleMetrics(a, boxW) : null;
        const inBand = inMetrics?.band ?? 0;
        const subH = insideTitle ? 0 : boxSubtitleH(a.subtitle, boxW);
        // The title strip (title + subtitle area) as a band behind them — style.headerFill.
        const stripH = insideTitle ? inBand : hasTitle || subH > 0 ? topBase + subH : 0;
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
          {d.headerFill && stripH > 0 && (
            <div aria-hidden className={`pointer-events-none absolute inset-x-0 ${insideTitle?.startsWith("bottom") ? "bottom-0" : "top-0"}`}
              style={{ height: stripH, background: d.headerFill, ...(insideTitle?.startsWith("bottom")
                ? { borderBottomLeftRadius: boxRadius, borderBottomRightRadius: boxRadius }
                : { borderTopLeftRadius: boxRadius, borderTopRightRadius: boxRadius }) }} />
          )}
          {titleBar}
          {/* Inside title block (titlePos top/bottom): icon + title + subtitle, inset from the edge.
              Double-click the title to edit it, like the border title. */}
          {insideTitle && inMetrics && (hasTitle || !!a.subtitle?.trim()) && (() => {
            const left = insideTitle === "top-left" || insideTitle === "bottom-left";
            const bottomSide = insideTitle.startsWith("bottom");
            return (
              <div
                className="pointer-events-none absolute flex flex-col"
                style={{
                  ...(bottomSide ? { bottom: BOX_TITLE_INSET } : { top: BOX_TITLE_INSET }),
                  left: BOX_TITLE_INSET,
                  right: BOX_TITLE_INSET,
                  alignItems: left ? "flex-start" : "center",
                  textAlign: left ? "left" : "center",
                }}
              >
                <div
                  className="pointer-events-auto flex max-w-full min-w-0 items-center"
                  style={{ justifyContent: left ? "flex-start" : "center", gap: 8, cursor: "text" }}
                  onClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(a.title ?? ""); }}
                  title="Double-click to edit title"
                >
                  {a.titleIcon && (
                    <AnyIcon iconKey={a.titleIcon} className="shrink-0 [&_svg]:h-full [&_svg]:w-full"
                      style={{ width: inMetrics.iconPx, height: inMetrics.iconPx }} />
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
                      className={`min-w-0 bg-transparent font-semibold leading-none outline-none ${d.fontColor ? "" : "text-foreground"}`}
                      style={{ fontSize: inMetrics.font, ...(d.fontColor ? { color: d.fontColor } : {}) }}
                    />
                  ) : hasTitle ? (
                    <div
                      className={`min-w-0 font-semibold ${d.fontColor ? "" : "text-foreground"}`}
                      style={{ fontSize: inMetrics.font, lineHeight: 1.2, overflowWrap: "anywhere", textAlign: left ? "left" : "center", ...(d.fontColor ? { color: d.fontColor } : {}) }}
                    >
                      {a.title}
                    </div>
                  ) : null}
                </div>
                {!!a.subtitle?.trim() && (
                  <div
                    className="pointer-events-none"
                    style={{ marginTop: 4, fontSize: BOX_SUBTITLE_FONT, lineHeight: 1.35, color: "#64748B", textAlign: left ? "left" : "center", overflowWrap: "anywhere" }}
                  >
                    {a.subtitle}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Grey subtitle under the title (a group header's second line). */}
          {subH > 0 && (
            <div
              className="pointer-events-none absolute text-muted-foreground"
              style={{ left: 12, right: 12, top: topBase, fontSize: BOX_SUBTITLE_FONT, lineHeight: 1.35, color: "#64748B" }}
            >
              {a.subtitle}
            </div>
          )}
          {/* Corner badge (same pill as a card's), overlapping the top-right edge. */}
          {a.badge?.trim() && <CornerBadge text={a.badge} color={a.badgeColor} />}
          {/* Body — centered (or aligned) editable text, as before. */}
          <div
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
            className={`flex min-h-0 w-full flex-1 overflow-hidden ${V_CLASS[vA]} ${H_CLASS[hA]}`}
            // A title straddles the top border (centred on it), so its lower half
            // sits INSIDE the box: clear that half plus a gap, or the first line of
            // the body touches the title. Untitled boxes keep the plain padding.
            // A subtitle adds its measured height on top of that clearance.
            style={{
              padding: showBorder ? 8 : 2,
              ...(insideTitle
                // An inside title keeps its band clear of the body (top or bottom edge).
                ? (insideTitle.startsWith("bottom")
                  ? { paddingBottom: (showBorder ? 8 : 2) + inBand }
                  : { paddingTop: (showBorder ? 8 : 2) + inBand })
                : ((hasTitle || subH > 0) ? { paddingTop: topBase + subH } : {})),
            }}
          >
            {editing !== null ? (
              <MdTextarea
                autoFocus
                value={editing}
                rows={Math.max(1, editing.split("\n").length)}
                onValue={setEditing}
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
                style={{ fontSize, fontWeight, lineHeight: 1.5, textAlign: hA, ...(d.fontColor ? { color: d.fontColor } : {}) }}
              />
            ) : (
              // A BOX wraps its text within the manually-sized box. `lineHeight`
              // matches the editing textarea's 1.5 so committing text doesn't
              // reflow it — and multi-line bodies (a legend) get room to breathe.
              // Rendered as markdown (see md-text); a plain multi-line body looks
              // exactly as before. max-w-full + min-w-0 so long lines wrap inside
              // the aligned flex slot instead of overflowing it.
              <MdText icon={renderMdIcon}
                text={a.text ?? ""}
                className={`min-w-0 max-w-full break-words ${d.fontColor ? "" : "text-foreground"}`}
                style={{ fontSize, fontWeight, lineHeight: 1.5, textAlign: hA, ...(d.fontColor ? { color: d.fontColor } : {}) }}
              />
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
  // Alias keys (ICON_ALIASES) are listed as aliases of their canonical row, not as rows.
  const aliasWords = new Map<string, string>();
  for (const [from, to] of Object.entries(ICON_ALIASES)) {
    aliasWords.set(to, `${aliasWords.get(to) ?? ""} ${from} ${prettyIconLabel(from)}`);
  }
  for (const k of Object.keys(DATABRICKS_ICONS) as DatabricksIconName[]) {
    if (SUPERSEDED_BUILTINS.has(k)) continue; // dup of file:vendor/<name>
    if (ICON_ALIASES[k]) continue; // renders its canonical row's art
    // Databricks built-ins: treat product/source-ish ones as sources; the rest
    // (agents, governance glyphs) aren't data sources. Keep it permissive.
    // Search on the raw key AND the pretty label so "genie" still matches.
    const label = prettyIconLabel(k);
    items.push({ key: k, label, search: `${k} ${label}`.toLowerCase(), tabs: ["Databricks"], source: true });
  }
  for (const f of FILE_ICONS) {
    if (ICON_ALIASES[f.key]) continue; // a duplicate of its canonical row
    const tabs = f.group === "cloud"
      ? ["Cloud"]
      : f.group === "persona"
      ? ["Personas"]
      : f.group === "brand"
      ? ["Databricks"]
      : ["Vendors", ...(INDUSTRY_BY_NAME[f.name] ?? [])]; // vendor → Vendors + its industries
    items.push({ key: f.key, label: f.name, search: `${f.group} ${f.category} ${f.name} ${logoAliases(f.name).join(" ")} ${aliasWords.get(f.key) ?? ""}`.toLowerCase(), tabs, source: logoMetaByName(f.name).source });
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
  // `data-arch-overlay` marks this as an overlay UI surface: the canvas's
  // device-aware wheel handler (Canvas `onWheelCapture`) skips any wheel over such
  // a surface, so a trackpad two-finger scroll here scrolls the grid instead of
  // panning the diagram behind. `overscroll-contain` on the grid stops the scroll
  // from chaining once it bottoms out.
  return (
    <div
      data-arch-overlay=""
      className="fixed inset-0 z-[60] grid place-items-center bg-background/60"
      onClick={onClose}
    >
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
        <div className="grid grid-cols-7 gap-2 overflow-y-auto overscroll-contain p-3">
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
