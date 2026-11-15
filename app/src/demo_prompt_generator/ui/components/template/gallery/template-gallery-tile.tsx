/**
 * Shared gallery tile for a template.
 *
 * The visual target is the (former) internal demo-catalog tile: a hero
 * screenshot, an industry badge, name, a description blurb, hover lift, and a
 * "Live" pill when the demo is deployed in this workspace (the detail sheet then
 * shows the "Try it live" buttons).
 *
 * The whole tile opens the detail sheet. It's a div[role=button] (NOT a
 * <button>) so it can nest the real <button> "Use template" action.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Layers, GraduationCap, Code2, LayoutTemplate } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  AIBIBrandIcon,
  GenieBrandIcon,
  DatabricksAppsBrandIcon,
  SDPBrandIcon,
} from "@/components/databricks-icons";

/** Non-SOLUTION template kinds → a small tag shown on the tile (label + icon).
 *  SOLUTION (the default) gets NO tag — it renders exactly as before. */
export const TEMPLATE_TYPE_TAG: Record<
  string,
  { label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  WORKSHOP: { label: "Workshop", icon: GraduationCap },
  GENIE_WORKSHOP: { label: "Genie Workshop", icon: Code2 },
  ARCHITECTURE: { label: "Architecture", icon: LayoutTemplate },
};

/** The headline capabilities we surface as brand-icon chips on a tile, in a
 *  fixed order (data → BI → conversational → app). Keyed by capability id. */
const CAPABILITY_LOGOS: Array<{
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { id: "sdp", label: "SDP pipeline", icon: SDPBrandIcon },
  { id: "aibi-dashboards", label: "AI/BI Dashboard", icon: AIBIBrandIcon },
  { id: "genie", label: "Genie", icon: GenieBrandIcon },
  { id: "databricks-apps", label: "Databricks App", icon: DatabricksAppsBrandIcon },
];

/** Row of brand-icon chips for the demo's headline capabilities (SDP / Dashboard
 *  / Genie / App), shown when the template's capabilities include them. */
function CapabilityLogos({ capabilities }: { capabilities: string[] | null | undefined }) {
  if (!capabilities || capabilities.length === 0) return null;
  const present = CAPABILITY_LOGOS.filter((c) => capabilities.includes(c.id));
  if (present.length === 0) return null;
  // Icon-only chips (labels are in the `title` tooltip) — a compact, low-noise
  // row so the card stays short and scannable.
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {present.map(({ id, label, icon: Icon }) => (
        <span
          key={id}
          title={label}
          className="inline-flex items-center justify-center rounded-md border border-border/60 bg-muted/40 p-1 text-muted-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      ))}
    </div>
  );
}
import {
  templateScreenshotUrl,
  type TemplateListItem,
} from "@/lib/custom-api";

/** Deterministically map an industry to one of the theme's chart color tokens,
 *  so screenshot-less tiles get a stable, distinct tint instead of a flat gray
 *  placeholder. Returns a CSS custom-property name (e.g. "--chart-3"). */
const CHART_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];
function industryTint(industry?: string | null): string {
  if (!industry) return CHART_VARS[0];
  let h = 0;
  for (let i = 0; i < industry.length; i++) h = (h * 31 + industry.charCodeAt(i)) >>> 0;
  return CHART_VARS[h % CHART_VARS.length];
}

export const TemplateGalleryTile = memo(function TemplateGalleryTile({
  template,
  onOpen,
  onUse,
}: {
  template: TemplateListItem;
  onOpen: (t: TemplateListItem) => void;
  /** Fork the template straight from the tile (the primary action). Only wired
   *  on the public gallery; omit it to keep the plain open-details behavior. */
  onUse?: (t: TemplateListItem) => void;
}) {
  const open = () => onOpen(template);
  const official = template.official === true;
  const hasScreenshot = template.has_screenshot === true;
  const tintVar = industryTint(template.industry);
  // Forking requires an APPROVED template (the backend rejects others), so the
  // primary "Use" action only shows for approved tiles.
  const canUse = !!onUse && template.status === "APPROVED";
  // Non-SOLUTION templates get a tag (Workshop / Genie Workshop / Architecture);
  // SOLUTION renders with no tag, exactly as before.
  const typeTag = template.template_type ? TEMPLATE_TYPE_TAG[template.template_type] : undefined;

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
      {/* Hero screenshot (shorter 16/9 for a scannable grid). object-contain so
          wide dashboard/app screenshots downscale UNIFORMLY; industry-tinted
          placeholder when there's no screenshot. */}
      <div className="relative aspect-[16/9] w-full overflow-hidden border-b bg-muted/40">
        {hasScreenshot ? (
          <img
            src={templateScreenshotUrl(template.id)}
            alt={`${template.name} screenshot`}
            loading="lazy"
            className="h-full w-full object-contain object-top"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-foreground/70"
            style={{
              background: `linear-gradient(135deg, color-mix(in oklch, var(${tintVar}) 26%, var(--card)), var(--card))`,
            }}
          >
            <Layers className="h-7 w-7 opacity-70" />
            {template.industry && (
              <span className="text-xs font-semibold tracking-tight">{template.industry}</span>
            )}
          </div>
        )}
        {/* One badge slot (top-right). Featured wins for official templates;
            otherwise a status pill for non-approved ones. */}
        {official ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow">
            <Sparkles className="h-3 w-3" /> Featured
          </span>
        ) : template.status && template.status !== "APPROVED" ? (
          <span
            className={cn(
              "absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow",
              template.status === "REJECTED"
                ? "bg-destructive text-destructive-foreground"
                : "bg-amber-500 text-white",
            )}
          >
            {template.status === "REJECTED" ? "Rejected" : "Pending review"}
          </span>
        ) : null}
        {/* Primary action — revealed on hover over the image, so the resting
            card stays clean and short. Card body click still opens details. */}
        {canUse && (
          <div className="absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/55 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="sm"
              className="h-7 gap-1 text-xs shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                onUse!(template);
              }}
              title={`Use "${template.name}" as a starting point`}
            >
              Use template <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {typeTag && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
            <typeTag.icon className="h-3 w-3" /> {typeTag.label}
          </span>
        )}
        {/* Deployed in this workspace → the detail sheet has "Try it live" buttons. */}
        {template.has_live_demo && (
          <span
            title="Deployed live in this workspace — open to try it"
            className={cn(
              "absolute left-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow",
              typeTag ? "top-10" : "top-3",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white" /> Live
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          {template.industry && (
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {template.industry}
            </span>
          )}
        </div>
        <h3 className="mt-1 text-sm font-semibold leading-snug text-foreground">
          {template.name}
        </h3>
        {template.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {template.description}
          </p>
        )}

        <CapabilityLogos capabilities={template.capabilities} />
      </div>
    </div>
  );
});

export default TemplateGalleryTile;
