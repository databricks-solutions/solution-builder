/**
 * platform-diagram/annotations — free-form canvas annotations that aren't
 * Databricks catalog components: plain Text, a Box (bordered text), a Logo
 * (any icon from the library), and an Image (URL or pasted base64). All four
 * are one ReactFlow node kind ("annotation") with a `variant`; their props live
 * in the node's layout entry (NodePosition.annotation) so they persist.
 */
import { memo, useContext, useState, useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS, BRAND_ICONS, type DatabricksIconName } from "../../databricks-icons";
import { FILE_ICONS, FileSvgIcon, isFileIconKey, logoMetaByName, logoAliases } from "../../file-icons";
import INDUSTRY_MAP from "../../../icons/industry-map.json";
import { BrandMark } from "./brand-mark";
import { type AnnotationData, type AnnotationVariant, isCustomIconKey, customLogoId } from "@/lib/platform-architecture";
import { RotatableCard, DropTargetContext, EditModeContext, CustomLogosContext, InlineSvgIcon, type NodeData } from "./shared";

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
  box: { w: 180, h: 100 },
  logo: { w: 64, h: 64 },
  image: { w: 200, h: 140 },
};

const V_CLASS = { top: "items-start", middle: "items-center", bottom: "items-end" } as const;
const H_CLASS = { left: "justify-start text-left", center: "justify-center text-center", right: "justify-end text-right" } as const;

/** The single annotation node component — switches on variant. */
export const AnnotationNode = memo(function AnnotationNode({ data, selected }: NodeProps) {
  const d = data as AnnotationNodeData;
  const a = d.annotation;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const [editing, setEditing] = useState<string | null>(null);

  const commit = () => {
    if (editing !== null) {
      d.onAnnotate(d.nodeId, { text: editing });
      setEditing(null);
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

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? ANNOTATION_DEFAULT_SIZE[a.variant].w}
      h={d.h ?? ANNOTATION_DEFAULT_SIZE[a.variant].h}
      scale={d.scale ?? 1}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      {(a.variant === "text" || a.variant === "box") && (() => {
        // Fill default: a BOX is solid white unless the user sets a color (or
        // "transparent"); plain TEXT is transparent by default.
        const fill = d.fillColor ?? (a.variant === "box" ? "#ffffff" : "transparent");
        return (
        <div
          onClick={() => d.onSelect(d.nodeId)}
          className={`flex h-full w-full overflow-hidden rounded-md ${V_CLASS[vA]} ${H_CLASS[hA]} ${selected ? "ring-2 ring-primary/60" : ""}`}
          style={{
            borderStyle: showBorder ? (d.borderStyle ?? "solid") : undefined,
            borderWidth: showBorder ? borderW : undefined,
            borderColor: showBorder ? (d.borderColor ?? "var(--border)") : undefined,
            padding: showBorder ? 8 : 2,
            opacity: d.opacity ?? 1,
            background: fill,
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
              className={`h-full w-full resize-none bg-transparent outline-none ${d.fontColor ? "" : "text-foreground"}`}
              style={{ fontSize, fontWeight, textAlign: hA, ...(d.fontColor ? { color: d.fontColor } : {}) }}
            />
          ) : (
            <span
              className={`whitespace-pre-wrap break-words ${d.fontColor ? "" : "text-foreground"}`}
              style={{ fontSize, fontWeight, transform: "scale(var(--cs, 1))", ...(d.fontColor ? { color: d.fontColor } : {}) }}
              title="Double-click to edit"
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(a.text ?? ""); }}
            >
              {a.text || (a.variant === "box" ? "" : "Text")}
            </span>
          )}
        </div>
        );
      })()}

      {a.variant === "logo" && (
        <div
          onClick={() => d.onSelect(d.nodeId)}
          className={`flex h-full w-full flex-col items-center justify-center rounded-md ${selected ? "ring-2 ring-primary/60" : ""}`}
          title="Right-click → Pick logo"
        >
          <AnyIcon iconKey={a.icon ?? "data"} className="min-h-0 w-full flex-1 p-1 [&_svg]:h-full [&_svg]:w-full" />
          {a.text && (
            <span
              className="w-full shrink-0 truncate text-center text-[11px] font-medium text-muted-foreground"
              style={{ ...(a.fontSize ? { fontSize: a.fontSize } : {}), ...(a.bold ? { fontWeight: 700 } : {}) }}
            >
              {a.text}
            </span>
          )}
        </div>
      )}

      {a.variant === "image" && (
        <div
          onClick={() => d.onSelect(d.nodeId)}
          className={`grid h-full w-full place-items-center overflow-hidden rounded-md ${selected ? "ring-2 ring-primary/60" : ""}`}
        >
          {a.src ? (
            <img src={a.src} alt="" className="h-full w-full object-contain" draggable={false} />
          ) : (
            <span className="px-2 text-center text-[11px] text-muted-foreground">Right-click → Set image URL</span>
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
