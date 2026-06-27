/**
 * platform-diagram/panels/library-palette — the left-hand component library.
 * Drag (or double-click) a catalog component, annotation, or cloud logo onto
 * the canvas to add it; also hosts the trademark-logo toggle, the search box,
 * the "+ more data sources" entry, and the "pick a replacement type" mode.
 */
import { memo, useState } from "react";
import { BAND_COLOR, type PlatformSchema } from "@/lib/platform-architecture";
import {
  X,
  GripVertical,
  Type,
  Square,
  Shapes,
  Image as ImageIcon,
  Search,
  Check,
} from "lucide-react";
import { BrandMark } from "../brand-mark";
import { AnyIcon } from "../annotations";
import { type AnnotationVariant } from "@/lib/platform-architecture";
import { FILE_ICONS, type FileIcon } from "../../../file-icons";

export const LibraryPalette = memo(function LibraryPalette({
  schema,
  placedIds,
  onAdd,
  picking = false,
  onPick,
  onCancelPick,
  onAddAnnotation,
  onAddLogo,
  onToggleTrademark,
  onMoreSources,
}: {
  schema: PlatformSchema;
  placedIds: Set<string>;
  onAdd: (componentId: string) => void;
  onAddAnnotation: (variant: AnnotationVariant) => void;
  /** Add a logo annotation pre-set to a file-icon key (cloud / vendor mark). */
  onAddLogo: (iconKey: string) => void;
  /** Toggle the trademark-logo opt-in (Canvas handles the confirm flow). */
  onToggleTrademark?: () => void;
  /** Open the "+ more data sources" picker. */
  onMoreSources?: () => void;
  /** When set, the palette is in "select a replacement type" mode: clicking a
   *  component calls onPick instead of dragging/adding. */
  picking?: boolean;
  onPick?: (componentId: string) => void;
  onCancelPick?: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matchText = (s: string) => !ql || s.toLowerCase().includes(ql);
  return (
    <div className={`relative flex w-52 shrink-0 flex-col border-r border-border bg-muted/20 ${picking ? "z-50 ring-2 ring-primary" : ""}`}>
      {picking ? (
        <div className="flex items-center justify-between gap-1 border-b border-border bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
          <span>Pick the new type →</span>
          <button type="button" onClick={onCancelPick} className="rounded p-0.5 hover:bg-white/20" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Components
        </div>
      )}
      {!picking && (
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              name="component-search"
              aria-label="Search components"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search components…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-[12px] outline-none focus:border-primary"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Free-form annotations (not Databricks catalog components). */}
        {!picking && !ql && (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Annotations</div>
            {([
              { v: "text" as const, icon: <Type className="h-4 w-4" />, label: "Text" },
              { v: "box" as const, icon: <Square className="h-4 w-4" />, label: "Box" },
              { v: "logo" as const, icon: <Shapes className="h-4 w-4" />, label: "Logo" },
              { v: "image" as const, icon: <ImageIcon className="h-4 w-4" />, label: "Image" },
            ]).map((it) => (
              <button
                key={it.v}
                type="button"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/x-annotation", it.v); e.dataTransfer.effectAllowed = "copy"; }}
                onDoubleClick={() => onAddAnnotation(it.v)}
                title={`Drag onto the canvas (or double-click to add): ${it.label}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
              >
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span className="grid h-4 w-4 place-items-center text-muted-foreground">{it.icon}</span>
                <span className="truncate">{it.label}</span>
              </button>
            ))}
          </div>
        )}
        {schema.bands.map((band) => {
          // Always list the FULL catalog (don't hide placed ones — it's
          // confusing). Placed components are just dimmed + marked "on canvas".
          // The search box filters by label.
          const items = band.components.filter((c) => matchText(c.label));
          if (items.length === 0) return null;
          return (
            <div key={band.id} className="mb-3">
              <div className="flex items-center px-1 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: BAND_COLOR[band.id] }}>
                <span>{band.label}</span>
                {/* Trademark-logo toggle lives on the Sources header (sources
                    are the third-party brands this gates). */}
                {band.id === "sources" && !picking && (
                  <button
                    type="button"
                    onClick={() => onToggleTrademark?.()}
                    title="Show real third-party brand logos (requires permission)"
                    className={`ml-auto rounded px-1.5 py-0.5 text-[8px] font-bold normal-case tracking-normal ${schema.enableTrademarkLogos ? "bg-primary/15 text-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}
                  >
                    Logos {schema.enableTrademarkLogos ? "on" : "off"}
                  </button>
                )}
              </div>
              {items.map((c) => {
                const onCanvas = placedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    draggable={!picking}
                    onDragStart={picking ? undefined : (e) => {
                      e.dataTransfer.setData("application/x-component-id", c.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={picking ? () => onPick?.(c.id) : undefined}
                    onDoubleClick={picking ? undefined : () => onAdd(c.id)}
                    title={picking ? `Change to: ${c.label}` : onCanvas ? `${c.label} — already on the canvas (drag to add another)` : `Drag onto the canvas (or double-click to add): ${c.label}`}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted ${!picking && onCanvas ? "opacity-60" : ""}`}
                  >
                    {!picking && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <span className="grid h-4 w-4 shrink-0 place-items-center">
                      <BrandMark iconKey={c.icon} label={c.label} bandColor={BAND_COLOR[band.id]} allowTrademark={!!schema.enableTrademarkLogos} className="h-4 w-4" mono />
                    </span>
                    <span className="truncate text-foreground">{c.label}</span>
                    {!picking && onCanvas && <Check className="ml-auto h-3 w-3 shrink-0 text-primary/60" />}
                  </button>
                );
              })}
              {/* + more data sources — opens the source picker (sources only). */}
              {band.id === "sources" && !picking && (
                <button
                  type="button"
                  onClick={() => onMoreSources?.()}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-primary hover:bg-muted"
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center text-primary">+</span>
                  <span className="truncate">More data sources…</span>
                </button>
              )}
            </div>
          );
        })}

        {/* Cloud — AWS / GCP / Azure logos (file icons). Each adds a logo
            annotation pre-set to that mark. Grouped by provider. */}
        {!picking && (() => {
          const cloud = FILE_ICONS.filter((f) => f.group === "cloud" && matchText(`${f.category} ${f.name}`));
          if (cloud.length === 0) return null;
          const byProvider = new Map<string, FileIcon[]>();
          for (const f of cloud) {
            const provider = f.category.split("/")[0] || "other";
            const arr = byProvider.get(provider) ?? [];
            arr.push(f);
            byProvider.set(provider, arr);
          }
          return (
            <div className="mb-3">
              <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cloud</div>
              {[...byProvider.entries()].map(([provider, icons]) => (
                <div key={provider} className="mb-1">
                  <div className="px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">{provider}</div>
                  {icons.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/x-logo", f.key); e.dataTransfer.effectAllowed = "copy"; }}
                      onDoubleClick={() => onAddLogo(f.key)}
                      title={`Add logo: ${f.name}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
                    >
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <AnyIcon iconKey={f.key} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
});
