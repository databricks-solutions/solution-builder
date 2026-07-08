/**
 * platform-diagram/annotations — free-form canvas annotations that aren't
 * Databricks catalog components: plain Text, a Box (bordered text), a Logo
 * (any icon from the library), and an Image (URL or pasted base64). All four
 * are one ReactFlow node kind ("annotation") with a `variant`; their props live
 * in the node's layout entry (NodePosition.annotation) so they persist.
 */
import { memo, useContext, useState, useMemo, useRef, useLayoutEffect } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, BRAND_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { FILE_ICONS, FileSvgIcon, isFileIconKey, logoMetaByName, logoAliases } from "../../file-icons";
import INDUSTRY_MAP from "../../../icons/industry-map.json";
import { BrandMark } from "./brand-mark";
import { type AnnotationData, type AnnotationVariant, isCustomIconKey, customLogoId } from "@/lib/platform-architecture";
import { RotatableCard, DropTargetContext, EditModeContext, CustomLogosContext, InlineSvgIcon, type NodeData } from "./shared";
import { NodeCard } from "./nodes/node-card";

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

  const fontSize = a.fontSize ?? 14;
  const fontWeight = a.bold ? 700 : 400;
  // Border: `style.border` (borderWidth) is the ONLY border control. A box
  // defaults to a 1px border; text to none. Set borderWidth 0 to remove a box's.
  const borderW = d.borderWidth ?? (a.variant === "box" ? 1 : 0);
  const showBorder = borderW > 0;
  const vA = a.vAlign ?? "middle";
  const hA = a.hAlign ?? "center";

  // --- Auto-fit for the plain TEXT annotation --------------------------------
  // A text label sizes to its content: we measure the rendered text off-layout
  // and write the natural size back via onResize. SIGNATURE-GUARDED: the
  // measure (a forced-layout offsetWidth read) + refit run only when the
  // CONTENT changes (text/font/scale) — with d.w/d.h in the deps it re-ran on
  // every resize/drag frame, thrashing layout and snapping the node back
  // (text nodes were un-resizable). Unlike the logo fit below, the FIRST run
  // does fit (a fresh text node should always hug its content).
  const measureRef = useRef<HTMLSpanElement>(null);
  const isTextVariant = a.variant === "text";
  const scale = d.scale ?? 1;
  // The text we size to: the LIVE editing buffer while editing (so the node
  // grows as you type), else the committed text.
  const sizingText = editing !== null ? editing : (a.text ?? "");
  const textFitSig = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isTextVariant) { textFitSig.current = null; return; }
    const sig = `${sizingText}|${fontSize}|${fontWeight}|${scale}`;
    if (textFitSig.current === sig) return; // content unchanged (manual resize / selection) → skip
    textFitSig.current = sig;
    const el = measureRef.current;
    if (!el) return;
    const PAD = 6; // small breathing room around the glyphs
    const w = Math.max(24, Math.ceil(el.offsetWidth * scale) + PAD * 2);
    const h = Math.max(20, Math.ceil(el.offsetHeight * scale) + PAD * 2);
    if (Math.abs((d.w ?? 0) - w) > 1 || Math.abs((d.h ?? 0) - h) > 1) {
      d.onResize(d.nodeId, w, h);
    }
  }, [isTextVariant, sizingText, fontSize, fontWeight, scale, d]);

  // The LOGO variant renders via the shared <NodeCard> (icon + caption tile,
  // auto-fit, box styling) — see the short-circuit right below. Its normalize:
  // legacy caption "side"→right, "below"→bottom; unset → the old "below" look.
  const isLogo = a.variant === "logo";
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : a.caption;
  const logoPositioned = isLogo && (capNorm === "right" || capNorm === "left" || capNorm === "top" || capNorm === "bottom");

  if (a.variant === "logo") {
    const pos = capNorm ?? "bottom";
    // Positioned → fixed icon square that NodeCard wraps + auto-fits; legacy
    // unpositioned → icon fills the box. Minimal padding so the glyph fills the
    // tile (node-card already adds its own px-3 py-2.5 around the content).
    const iconEl = logoPositioned ? (
      <AnyIcon iconKey={a.icon ?? "data"} className="h-full w-full [&_svg]:h-full [&_svg]:w-full" style={d.iconColor ? { color: d.iconColor } : undefined} />
    ) : (
      <AnyIcon iconKey={a.icon ?? "data"} className="min-h-0 w-full flex-1 [&_svg]:h-full [&_svg]:w-full" style={d.iconColor ? { color: d.iconColor } : undefined} />
    );
    return (
      <NodeCard
        nodeId={d.nodeId}
        selected={!!selected}
        editMode={editMode}
        isDropTarget={isDropTarget}
        rot={d.rot}
        scale={d.scale ?? 1}
        w={d.w}
        h={d.h}
        icon={iconEl}
        title={a.text ?? ""}
        onCommitTitle={(v) => d.onAnnotate(d.nodeId, { text: v })}
        hideEmptyTitle
        // Editable description line — opt-in via the persisted showDesc flag.
        description={a.desc}
        showDescription={a.showDesc}
        onCommitDescription={(v) => d.onAnnotate(d.nodeId, { desc: v })}
        caption={pos}
        contentMode={logoPositioned ? "autoFit" : "fixed"}
        defaultSize={ANNOTATION_DEFAULT_SIZE.logo}
        styleVariant="logo"
        fontColor={d.fontColor}
        fontSize={a.fontSize}
        bold={a.bold}
        iconColor={d.iconColor}
        fillColor={d.fillColor}
        borderWidth={d.borderWidth}
        borderStyle={d.borderStyle}
        borderColor={d.borderColor}
        borderRadius={d.borderRadius}
        shadow={d.shadow}
        opacity={d.opacity}
        onSelect={d.onSelect}
        onResize={d.onResize}
        // Give logos the 4 side resize rectangles (+ corners) that sources and
        // product tiles get — RotatableCard only renders the side controls in
        // its onScale branch. Auto-fit respects a manual w/h (same as sources).
        onScale={(id, w) => d.onResize(id, w, Math.round((w * ANNOTATION_DEFAULT_SIZE.logo.h) / ANNOTATION_DEFAULT_SIZE.logo.w), w / ANNOTATION_DEFAULT_SIZE.logo.w)}
        onContext={d.onContext}
      />
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
      onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      {(a.variant === "text" || a.variant === "box") && (() => {
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
          <div
            onClick={(e) => { e.stopPropagation(); d.onSelect(d.nodeId); }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(a.title ?? ""); }}
            title="Double-click to edit title"
            className="absolute left-3 top-0 z-10 flex max-w-[calc(100%-24px)] -translate-y-1/2 items-center gap-1.5"
            style={hasTitle ? { background: legendMask, padding: "0 6px", borderTopLeftRadius: boxRadius, borderTopRightRadius: boxRadius } : { minWidth: 40, height: 12 }}
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
              <span
                // Text: `whitespace-pre` so it sizes to content + only wraps on
                // explicit newlines (the node auto-fits it). Box: wrap within
                // the manually-sized box as before.
                className={`${isBox ? "whitespace-pre-wrap break-words" : "whitespace-pre"} ${d.fontColor ? "" : "text-foreground"}`}
                style={{ fontSize, fontWeight, transform: "scale(var(--cs, 1))", ...(d.fontColor ? { color: d.fontColor } : {}) }}
                title="Double-click to edit"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
              >
                {a.text || (isBox ? "" : "Text")}
              </span>
            )}
            {/* Off-layout measurer for the auto-fit text node — mirrors the
                display span's font at scale 1 so we can read its natural size.
                Renders the LIVE editing buffer so the node grows as you type.
                A trailing space keeps a width on empty/blank lines. */}
            {isTextVariant && (
              <span
                ref={measureRef}
                aria-hidden
                className="pointer-events-none invisible absolute whitespace-pre"
                style={{ left: -99999, top: -99999, fontSize, fontWeight }}
              >
                {(sizingText || "Text") + " "}
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
interface PickItem { key: string; label: string; search: string; tabs: string[]; source: boolean }

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

function buildPickIndex(): { items: PickItem[]; tabs: string[] } {
  const items: PickItem[] = [];
  for (const k of Object.keys(DATABRICKS_ICONS) as DatabricksIconName[]) {
    if (SUPERSEDED_BUILTINS.has(k)) continue; // dup of file:vendor/<name>
    // Databricks built-ins: treat product/source-ish ones as sources; the rest
    // (agents, governance glyphs) aren't data sources. Keep it permissive.
    items.push({ key: k, label: k, search: k.toLowerCase(), tabs: ["Databricks"], source: true });
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
}: {
  onPick: (key: string) => void;
  onClose: () => void;
  /** Honor the trademark gate (gated logos render as a badge here too). */
  allowTrademark?: boolean;
  /** Restrict to actual data sources (for the "+ more data sources" picker). */
  sourcesOnly?: boolean;
}) {
  const [q, setQ] = useState("");
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
