/**
 * platform-diagram/panels/library-palette — the left-hand component library.
 * Drag (or double-click) a catalog component, annotation, or cloud logo onto
 * the canvas to add it; also hosts the trademark-logo toggle, the search box,
 * the "+ more data sources" entry, and the "pick a replacement type" mode.
 */
import { memo, useState } from "react";
import { BAND_COLOR, catalogBands, DBX_ARCH_PRESETS, type PlatformSchema } from "@/lib/platform-architecture";
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
import { FILE_ICONS, type FileIcon, logoMetaForKey, logoLabel, logoAliases } from "../../../file-icons";

export const LibraryPalette = memo(function LibraryPalette({
  schema,
  placedIds,
  onAdd,
  picking = false,
  onPick,
  onCancelPick,
  onAddAnnotation,
  onAddPreset,
  onAddLogo,
  onAddSource,
  onToggleTrademark,
  onMoreSources,
}: {
  schema: PlatformSchema;
  placedIds: Set<string>;
  onAdd: (componentId: string) => void;
  onAddAnnotation: (variant: AnnotationVariant) => void;
  /** Add a titled-box preset ("Databricks Architecture" section) by preset id. */
  onAddPreset: (presetId: string) => void;
  /** Add a logo annotation pre-set to a file-icon key (cloud / vendor mark). */
  onAddLogo: (iconKey: string) => void;
  /** Add a data source from a file-icon key (same as the source picker). */
  onAddSource?: (iconKey: string) => void;
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
      ) : null}
      {/* Search box shown in both modes — incl. "pick the new type" (change
          type), so you can filter the replacement options too. */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            name="component-search"
            aria-label="Search components"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={picking ? "Search types…" : "Search components…"}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-[12px] outline-none focus:border-primary"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {/* When searching, surface matching LOGOS + SOURCES from the WHOLE icon
            bank (vendor, persona, cloud) — e.g. "kafka" → the Kafka source,
            "aws"/"s3" → the cloud mark. No arbitrary cap; the list scrolls. */}
        {!picking && ql && (() => {
          const matched = FILE_ICONS.filter((f) => matchText(`${f.name} ${f.category} ${f.group} ${logoAliases(f.name).join(" ")}`));
          // Mutually exclusive: a data-source logo shows under Sources only;
          // everything else under Logos — so a match (e.g. Kafka) appears once.
          const sources = matched.filter((f) => logoMetaForKey(f.key).source);
          const logos = matched.filter((f) => !logoMetaForKey(f.key).source);
          if (logos.length === 0 && sources.length === 0) return null;
          return (
            <>
              {logos.length > 0 && (
                <div className="mb-3">
                  <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Logos</div>
                  {logos.map((f) => (
                    <button
                      key={`logo-${f.key}`}
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/x-logo", f.key); e.dataTransfer.effectAllowed = "copy"; }}
                      onDoubleClick={() => onAddLogo(f.key)}
                      title={`Add logo: ${logoLabel(f.name)}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
                    >
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <AnyIcon iconKey={f.key} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
                      <span className="truncate">{logoLabel(f.name)}</span>
                    </button>
                  ))}
                </div>
              )}
              {sources.length > 0 && onAddSource && (
                <div className="mb-3">
                  <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: BAND_COLOR.sources }}>Sources</div>
                  {sources.map((f) => (
                    <button
                      key={`src-${f.key}`}
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/x-source", f.key); e.dataTransfer.effectAllowed = "copy"; }}
                      onDoubleClick={() => onAddSource(f.key)}
                      title={`Add data source: ${logoLabel(f.name)}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
                    >
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <AnyIcon iconKey={f.key} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
                      <span className="truncate">{logoLabel(f.name)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          );
        })()}
        {/* Free-form annotations (not Databricks catalog components). Filtered by
            the search box so they stay findable while searching. */}
        {!picking && (() => {
          const annos = ([
            { v: "text" as const, icon: <Type className="h-4 w-4" />, label: "Text" },
            { v: "box" as const, icon: <Square className="h-4 w-4" />, label: "Box" },
            { v: "logo" as const, icon: <Shapes className="h-4 w-4" />, label: "Logo" },
            { v: "image" as const, icon: <ImageIcon className="h-4 w-4" />, label: "Image" },
          ]).filter((it) => matchText(it.label));
          if (annos.length === 0) return null;
          return (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Annotations</div>
            {annos.map((it) => (
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
          );
        })()}
        {/* Databricks Architecture — ready-made presets: titled container boxes
            (Workspace / Metastore) + logo+label tiles (Catalog / Schema / Table).
            Filtered by the search box (matches label + default text). */}
        {!picking && (() => {
          const presets = DBX_ARCH_PRESETS.filter((p) => matchText(`${p.label} ${p.annotation.text ?? ""} ${p.annotation.title ?? ""}`));
          if (presets.length === 0) return null;
          return (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Databricks Architecture</div>
            {presets.map((p) => {
              const previewIcon = p.annotation.titleIcon ?? p.annotation.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("application/x-annotation-preset", p.id); e.dataTransfer.effectAllowed = "copy"; }}
                  onDoubleClick={() => onAddPreset(p.id)}
                  title={`Drag onto the canvas (or double-click to add): ${p.label}`}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
                >
                  <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                  {previewIcon ? (
                    <AnyIcon iconKey={previewIcon} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{p.label}</span>
                </button>
              );
            })}
          </div>
          );
        })()}
        {catalogBands().map((band) => {
          // Render from the RAW global catalog, never the override-merged
          // schema — the palette is a catalog browser, so a demo relabeling a
          // component (e.g. "AI/BI Genie") must not change what it's called
          // here. Always list the FULL catalog (don't hide placed ones — it's
          // confusing). Placed components are just dimmed + marked "on canvas".
          // Search matches label + sublabel + description + id + authoring
          // synonyms, so "warehouse", "rag", "postgres", etc. surface the right
          // tile even when the term isn't in the display label.
          const items = band.components.filter((c) =>
            matchText(`${c.label} ${c.sublabel ?? ""} ${c.desc ?? ""} ${c.id} ${c.authoring ?? ""}`),
          );
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
                    className={`ml-auto cursor-pointer rounded px-1.5 py-0.5 text-[8px] font-bold normal-case tracking-normal ${schema.enableTrademarkLogos ? "bg-primary/15 text-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}
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

        {/* Cloud — AWS / GCP / Azure logos (file icons), grouped by provider.
            Shown at rest only; while searching, cloud marks come through the
            unified Logos search-results block above (no duplication). */}
        {!picking && !ql && (() => {
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
