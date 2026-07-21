/**
 * Shared gallery tile for a template.
 *
 * The visual target is the (former) internal demo-catalog tile: a hero
 * screenshot, an industry badge, name, a description blurb, hover lift, and
 * optional quick-link chips (Dashboard / Ask Genie / Open App / Data) for the
 * live-resource overlay used on the internal gallery.
 *
 * The whole tile opens the detail sheet. It's a div[role=button] (NOT a
 * <button>) so it can nest real <a> quick-links — those open the resource in a
 * new tab and stopPropagation so the click doesn't bubble to the open handler.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, Sparkles, Database, Layers } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  AIBIBrandIcon,
  GenieBrandIcon,
  DatabricksAppsBrandIcon,
} from "@/components/databricks-icons";
import {
  templateScreenshotUrl,
  type TemplateListItem,
  type DemoResourceLinks,
} from "@/lib/custom-api";

/** Small quick-link chip that opens in a new tab without triggering the tile's
 *  open handler. `accent` gives the primary "Open App" chip a filled look. */
function QuickLink({
  href,
  icon: Icon,
  label,
  accent,
}: {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  accent?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium no-underline transition-colors",
        accent
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
          : "border-border/60 bg-background/70 text-foreground/80 hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}

export const TemplateGalleryTile = memo(function TemplateGalleryTile({
  template,
  onOpen,
  links,
}: {
  template: TemplateListItem;
  onOpen: (t: TemplateListItem) => void;
  links?: DemoResourceLinks;
}) {
  const open = () => onOpen(template);
  const official = template.official === true;
  const hasScreenshot = template.has_screenshot === true;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left transition-all",
        "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        official
          ? "border-primary/50 ring-1 ring-primary/25 shadow-[0_6px_24px_-6px_rgba(0,0,0,0.28)] hover:shadow-[0_16px_40px_-10px_rgba(0,0,0,0.36)]"
          : "border-border/60 shadow-[0_4px_16px_-6px_rgba(0,0,0,0.18)] hover:border-border hover:shadow-[0_14px_36px_-10px_rgba(0,0,0,0.32)]",
      )}
    >
      {/* Hero screenshot. object-contain (not cover) so wide dashboard/app
          screenshots downscale UNIFORMLY and stay crisp. Falls back to a
          neutral placeholder (industry glyph) when there's no screenshot. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden border-b bg-muted/40">
        {hasScreenshot ? (
          <img
            src={templateScreenshotUrl(template.id)}
            alt={`${template.name} screenshot`}
            loading="lazy"
            className="h-full w-full object-contain object-top"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
            <Layers className="h-8 w-8" />
            {template.industry && (
              <span className="text-[11px] font-medium">{template.industry}</span>
            )}
          </div>
        )}
        {official && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow">
            <Sparkles className="h-3 w-3" /> Featured
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        {template.industry && (
          <Badge variant="secondary" className="mb-3 w-fit text-[10px] font-medium">
            {template.industry}
          </Badge>
        )}
        <h3 className="text-[15px] font-semibold leading-tight text-foreground">
          {template.name}
        </h3>
        {template.description && (
          <p className="mt-2 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {template.description}
          </p>
        )}

        {/* Quick links (internal gallery only) — open app / dashboard / Genie /
            data directly from the tile. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {links?.app && (
            <QuickLink href={links.app} icon={DatabricksAppsBrandIcon} label="Open App" accent />
          )}
          {links?.dashboard && (
            <QuickLink href={links.dashboard} icon={AIBIBrandIcon} label="Dashboard" />
          )}
          {links?.genie && (
            <QuickLink href={links.genie} icon={GenieBrandIcon} label="Ask Genie" />
          )}
          {links?.data && (
            <QuickLink href={links.data} icon={Database} label="Data" />
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Details <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
});

export default TemplateGalleryTile;
