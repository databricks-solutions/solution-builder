/**
 * Home-page template showcase.
 *
 * Two modes, driven by the home page's top search input:
 *
 *  - **Default (no / short query):** a full-width GRID of small FEATURED
 *    (`official`) tiles — a compact hero image + title each. The "come browse
 *    the curated demos" surface.
 *
 *  - **Searching (query ≥ 3 chars):** the SAME semantic search as the
 *    `/templates` page (`searchTemplates` → ranked ids applied over the full
 *    template list), rendered as a grid of tiles. Search spans EVERYTHING
 *    (not just featured), matching /templates exactly.
 *
 * Loads the template list once on mount; search only re-ranks that list.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Library, Layers } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
import {
  listTemplates,
  searchTemplates,
  templateScreenshotUrl,
  type TemplateListItem,
} from "@/lib/custom-api";

interface HomeTemplateShowcaseProps {
  /** The home page's top-input text. Drives search vs. carousel. */
  query: string;
  /** Open the detail sheet for a template id. */
  onSelect: (templateId: string) => void;
  className?: string;
}

/** One small featured tile: a compact hero image + title. */
const FeaturedTile = memo(function FeaturedTile({
  template,
  onSelect,
}: {
  template: TemplateListItem;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template.id)}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {/* Small hero image. object-cover for a clean uniform thumbnail. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden border-b bg-muted/40">
        {template.has_screenshot ? (
          <img
            src={templateScreenshotUrl(template.id)}
            alt={`${template.name} screenshot`}
            loading="lazy"
            className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
            <Layers className="h-7 w-7" />
          </div>
        )}
      </div>

      {/* Title + industry. */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground group-hover:text-primary">
          {template.name}
        </h3>
        {template.industry && (
          <span className="text-[11px] text-muted-foreground">{template.industry}</span>
        )}
      </div>
    </button>
  );
});

export const HomeTemplateShowcase = memo(function HomeTemplateShowcase({
  query,
  onSelect,
  className,
}: HomeTemplateShowcaseProps) {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Semantic search ranking (ordered ids) — null = no active search.
  const [searchRank, setSearchRank] = useState<string[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const q = query.trim();
  const isSearchActive = q.length >= 3;

  // Load the approved template list once.
  useEffect(() => {
    listTemplates("APPROVED")
      .then(setTemplates)
      .catch((e) => console.error("Failed to load templates:", e))
      .finally(() => setIsLoading(false));
  }, []);

  // Debounced semantic search — identical call to the /templates page
  // (searchTemplates(q, 50)), spanning ALL templates. Clearing restores the
  // featured carousel.
  useEffect(() => {
    if (!isSearchActive) {
      setSearchRank(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const t = setTimeout(() => {
      searchTemplates(q, 10)
        .then((results) => {
          if (!cancelled) setSearchRank(results.map((r) => r.id));
        })
        .catch((e) => {
          console.error("Template search failed:", e);
          if (!cancelled) setSearchRank(null);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, isSearchActive]);

  // The one row of tiles, capped at 10. When searching → the ranked results
  // (over ALL templates). Otherwise → the featured (official) templates,
  // screenshot-bearing first so the image tiles lead. SAME tiles, SAME row,
  // SAME cap — search just swaps in a filtered set.
  const MAX_TILES = 10;
  const items = useMemo(() => {
    if (isSearchActive) {
      if (searchRank === null) return [];
      const byId = new Map(templates.map((t) => [t.id, t]));
      return searchRank
        .map((id) => byId.get(id))
        .filter((t): t is TemplateListItem => Boolean(t))
        .slice(0, MAX_TILES);
    }
    const official = templates.filter((t) => t.official === true);
    return [...official]
      .sort((a, b) => Number(b.has_screenshot === true) - Number(a.has_screenshot === true))
      .slice(0, MAX_TILES);
  }, [isSearchActive, searchRank, templates]);

  if (isLoading) return null;

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {isSearchActive ? "Matching Templates" : "Featured Templates"}
            </h2>
            {isSearching && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isSearchActive
              ? "Templates that match your topic"
              : "Bootstrap your project with a curated, ready-to-fork solution"}
          </p>
        </div>
        <Link
          to="/templates"
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          <Library className="h-3 w-3" />
          Browse All
        </Link>
      </div>

      {/* ONE row of tiles for both featured + search — same carousel, same
          tiles, capped at 10. Search just filters the set. */}
      {items.length > 0 ? (
        <Carousel opts={{ align: "start", loop: false }} className="w-full">
          <CarouselContent className="-ml-3">
            {items.map((template) => (
              <CarouselItem
                key={template.id}
                className="basis-1/2 pl-3 sm:basis-1/3 lg:basis-1/4 xl:basis-1/5"
              >
                <FeaturedTile template={template} onSelect={onSelect} />
              </CarouselItem>
            ))}
          </CarouselContent>
          {/* Arrows sit OUTSIDE the tile row (in the section's outer margin). */}
          <CarouselPrevious className="-left-11" />
          <CarouselNext className="-right-11" />
        </Carousel>
      ) : (
        !isSearching && (
          <div className="rounded-lg border border-dashed border-border/50 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {isSearchActive ? "No matching templates found" : "No featured templates yet"}
            </p>
            <Link to="/templates" className="mt-1 inline-block text-xs text-primary hover:underline">
              Explore all templates
            </Link>
          </div>
        )
      )}
    </div>
  );
});

export default HomeTemplateShowcase;
