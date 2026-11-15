/**
 * platform-diagram/panels/library-palette — the left-hand component library.
 * Drag (or double-click) a catalog component, annotation, or cloud logo onto
 * the canvas to add it; also hosts the trademark-logo toggle, the search box,
 * the "+ more data sources" entry, and the "pick a replacement type" mode.
 */
import { memo, useMemo, useState } from "react";
import { BAND_COLOR, catalogBands, DBX_ARCH_PRESETS, type PlatformSchema } from "@/lib/platform-architecture";
import {
  X,
  GripVertical,
  Type,
  Square,
  LayoutGrid,
  Code,
  Circle,
  Shapes,
  Image as ImageIcon,
  StickyNote,
  Search,
  Check,
} from "lucide-react";
import { BrandMark } from "../brand-mark";
import { AnyIcon, buildPickIndex, type PickItem } from "../annotations";
import { type AnnotationVariant } from "@/lib/platform-architecture";
import { SHAPE_KINDS, SHAPE_LABEL, shapePath, type ShapeKind } from "../shape-geometry";
import { FILE_ICONS, type FileIcon, logoLabel, logoAliases, logoMetaForKey } from "../../../file-icons";

/** A 14×11 preview of a flowchart shape for the palette row. Built from the SAME
 *  `shapePath` the canvas draws, so a palette icon can never drift from the shape
 *  it places (a hand-drawn set of 9 glyphs would). */
function ShapeGlyph({ kind }: { kind: ShapeKind }) {
  const w = 14, h = 11, stroke = 1.25;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <path d={shapePath(kind, { w, h, stroke })} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
    </svg>
  );
}

export const LibraryPalette = memo(function LibraryPalette({
  schema,
  placedIds,
  onAdd,
  picking = false,
  onPick,
  onCancelPick,
  onAddAnnotation,
  onAddShape,
  onAddPreset,
  onAddLogo,
  onAddSource,
  onToggleTrademark,
  onMoreSources,
  onMoreLogos,
}: {
  schema: PlatformSchema;
  placedIds: Set<string>;
  onAdd: (componentId: string) => void;
  onAddAnnotation: (variant: AnnotationVariant) => void;
  /** Add a flowchart `shape` annotation of the given kind (Process flow list). */
  onAddShape?: (kind: ShapeKind) => void;
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
  /** Open the full logo picker (from the "see more logos" search affordance),
   *  pre-filtered with the current search term. */
  onMoreLogos?: (query: string) => void;
  /** When set, the palette is in "select a replacement type" mode: clicking a
   *  component calls onPick instead of dragging/adding. */
  picking?: boolean;
  onPick?: (componentId: string) => void;
  onCancelPick?: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matchText = (s: string) => !ql || s.toLowerCase().includes(ql);
  // Full logo index (Databricks bank + file-icon vendor/cloud marks), built
  // once — the search-results Logos block filters this so terms like "genie"
  // (many Databricks matches) surface instead of only file-icon hits.
  const pickItems = useMemo(() => buildPickIndex().items, []);
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
      {/* `overscroll-contain` keeps a two-finger / wheel scroll from CHAINING to
          the diagram canvas when the list hits its top/bottom (the scroll would
          otherwise bubble out and pan/zoom the ReactFlow pane). `onWheel` stops
          the event propagating past the palette entirely, so a scroll here never
          reaches the canvas's wheel handler regardless of boundary state. */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-2" onWheel={(e) => e.stopPropagation()}>
        {/* When searching, surface matching LOGOS + SOURCES.
            LOGOS come from the WHOLE pick index (Databricks marks — Genie,
            Genie Code, Genie One, … — AND file-icon vendor/cloud marks), so a
            term like "genie" (many matches) surfaces properly. Show the first 4
            then a "see more logos" link that opens the full picker pre-filtered
            with the same term. SOURCES come from the file-icon bank and list
            ALL matches (no cap). */}
        {!picking && ql && (() => {
          const LOGO_TOP = 4;
          // LOGOS — union of Databricks bank + file icons, matched by the pick
          // index's precomputed search string. Dedup by display label, keeping
          // the brand mark over the mono glyph (e.g. `genieBrand` "Genie" wins
          // over the `genie` glyph that pretty-labels to the same thing).
          const seenLabels = new Map<string, PickItem>();
          for (const i of pickItems) {
            if (!i.search.includes(ql)) continue;
            const prev = seenLabels.get(i.label);
            if (!prev || (!/(Brand|Logo)$/.test(prev.key) && /(Brand|Logo)$/.test(i.key)))
              seenLabels.set(i.label, i);
          }
          const logoMatches = [...seenLabels.values()];
          const shownLogos = logoMatches.slice(0, LOGO_TOP);
          const moreLogos = logoMatches.length - shownLogos.length;
          // SOURCES: matched file-icon marks flagged as data sources, EXCLUDING
          // any already offered by the catalog Sources band below (keyed by
          // their file-icon). That kills the old duplicate "Source / Kafka"
          // while keeping vendors NOT in the catalog (salesforce, snowflake, …)
          // addable as a source. List ALL matches — no cap.
          const catalogSourceIcons = new Set(
            catalogBands().find((b) => b.id === "sources")?.components.map((c) => c.icon) ?? [],
          );
          const srcMatches = FILE_ICONS.filter(
            (f) =>
              matchText(`${f.name} ${f.category} ${f.group} ${logoAliases(f.name).join(" ")}`) &&
              logoMetaForKey(f.key).source &&
              !catalogSourceIcons.has(f.key),
          );
          if (shownLogos.length === 0 && srcMatches.length === 0) return null;
          const LogoRow = ({ i }: { i: PickItem }) => (
            <button
              key={`logo-${i.key}`}
              type="button"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/x-logo", i.key); e.dataTransfer.effectAllowed = "copy"; }}
              onDoubleClick={() => onAddLogo(i.key)}
              title={`Add logo: ${i.label}`}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
            >
              <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              <AnyIcon iconKey={i.key} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
              <span className="min-w-0 leading-snug">{i.label}</span>
            </button>
          );
          const SourceRow = ({ f }: { f: FileIcon }) => (
            <button
              key={`source-${f.key}`}
              type="button"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/x-source", f.key); e.dataTransfer.effectAllowed = "copy"; }}
              onDoubleClick={() => onAddSource?.(f.key)}
              title={`Add data source: ${logoLabel(f.name)}`}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
            >
              <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              <AnyIcon iconKey={f.key} className="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" />
              <span className="min-w-0 leading-snug">{logoLabel(f.name)}</span>
            </button>
          );
          return (
            <>
              {shownLogos.length > 0 && (
                <div className="mb-3">
                  <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Logos</div>
                  {shownLogos.map((i) => <LogoRow key={`logo-${i.key}`} i={i} />)}
                  {moreLogos > 0 && onMoreLogos && (
                    <button type="button" onClick={() => onMoreLogos(q.trim())}
                      className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-primary hover:bg-muted">
                      <span className="grid h-4 w-4 shrink-0 place-items-center text-primary">+</span>
                      <span className="truncate">See more logos…</span>
                    </button>
                  )}
                </div>
              )}
              {srcMatches.length > 0 && onAddSource && (
                <div className="mb-3">
                  <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: BAND_COLOR.sources }}>Sources</div>
                  {srcMatches.map((f) => <SourceRow key={`source-${f.key}`} f={f} />)}
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
            { v: "note" as const, icon: <StickyNote className="h-4 w-4" />, label: "Note" },
            { v: "box" as const, icon: <Square className="h-4 w-4" />, label: "Box" },
            // A content card: header (icon + title), summary, description, chips,
            // tags and a corner badge. Height is measured from its text.
            { v: "card" as const, icon: <LayoutGrid className="h-4 w-4" />, label: "Card" },
            // Free-form HTML: anything no component covers (KPI strip, table, timeline…).
            // Starts as a small KPI strip; transparent unless framed.
            { v: "html" as const, icon: <Code className="h-4 w-4" />, label: "HTML" },
            // The big numbered circle that keys a spot on the diagram to a
            // legend line (see LegendSpec / the `callout` variant).
            { v: "callout" as const, icon: <Circle className="h-4 w-4" />, label: "Step number" },
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
                <span className="min-w-0 leading-snug">{it.label}</span>
              </button>
            ))}
          </div>
          );
        })()}
        {/* Databricks Architecture — ready-made presets: titled container boxes
            (Workspace / Metastore) + logo+label tiles (Catalog / Schema / Table).
            Filtered by the search box (matches label + default text). */}
        {!picking && (() => {
          // The "note" preset duplicates the Annotations "Note" (same variant) → skipped.
          const presets = DBX_ARCH_PRESETS.filter((p) => p.id !== "note" && matchText(`${p.label} ${p.annotation.text ?? ""} ${p.annotation.title ?? ""}`));
          const sections = [
            { key: "containers", title: "Containers & governance", items: presets.filter((p) => !p.id.startsWith("cloud-")) },
            { key: "cloud", title: "Cloud boundaries", items: presets.filter((p) => p.id.startsWith("cloud-")) },
          ].filter((s) => s.items.length > 0);
          if (sections.length === 0) return null;
          return sections.map((s) => (
          <div key={s.key} className="mb-3">
            <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{s.title}</div>
            {s.items.map((p) => {
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
                  <span className="min-w-0 leading-snug">{p.label}</span>
                </button>
              );
            })}
          </div>
          ));
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
          // Deprecated components (replacedBy) are not offered for NEW placement;
          // they still render on existing diagrams.
          const items = band.components.filter((c) => !c.deprecated &&
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
                    <span className="min-w-0 leading-snug text-foreground">{c.label}</span>
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

        {/* Process flow — the flowchart shape vocabulary (`variant:"shape"`).
            Separate from Annotations because these are FLOW STEPS you wire
            together with edges, not decoration: each is connectable, so
            shape → shape → shape draws a process. Searchable by both the
            flowchart role ("Decision") and the geometry ("diamond"). Placed
            BELOW the Databricks Architecture bands (incl. Unified Governance),
            since the Databricks vocabulary is the primary set. */}
        {!picking && onAddShape && (() => {
          const shapes = SHAPE_KINDS.filter((k) => matchText(`${SHAPE_LABEL[k]} ${k}`));
          if (shapes.length === 0) return null;
          return (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Process flow</div>
            {shapes.map((k) => (
              <button
                key={k}
                type="button"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/x-shape", k); e.dataTransfer.effectAllowed = "copy"; }}
                onDoubleClick={() => onAddShape(k)}
                title={`Drag onto the canvas (or double-click to add): ${SHAPE_LABEL[k]} (${k})`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
              >
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span className="grid h-4 w-4 shrink-0 place-items-center text-muted-foreground">
                  <ShapeGlyph kind={k} />
                </span>
                <span className="min-w-0 leading-snug">{SHAPE_LABEL[k]}</span>
              </button>
            ))}
          </div>
          );
        })()}

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
                      <span className="min-w-0 leading-snug">{f.name}</span>
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
