/**
 * INTERNAL — do NOT sync to the public repo (databricks-solutions/solution-builder).
 * See .publicignore. Unlisted page (no nav link) — reachable at /internal-demos.
 *
 * A standalone (no app chrome), mobile-friendly catalog of the live Demo-West
 * demos. It reuses the SHARED template gallery (tile + slide-over), but is
 * DB-driven: it fetches APPROVED templates, filters to the curated/official
 * ones, and overlays a slug→live-resource-links map (below) so each tile/sheet
 * shows quick links to the running Dashboard / Genie / App / Data on
 * e2-demo-west. The links map is the only internal-only content here — it lives
 * inline in this file (never stored in the DB).
 *
 * Source: "DAIS - Demo West App & AI/BI" Google Doc. Live demos on e2-demo-west.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  listTemplates,
  createProjectFromTemplate,
  type TemplateListItem,
  type TemplateDetail,
  type DemoResourceLinks,
} from "@/lib/custom-api";
import { TemplateGalleryTile } from "@/components/template/gallery/template-gallery-tile";
import { TemplateGallerySheet } from "@/components/template/gallery/template-gallery-sheet";
import { IndustryCombobox } from "@/components/internal/demo-catalog/industry-combobox";
import { useGalleryFilter } from "@/components/template/gallery/use-gallery-filter";
import { Sparkles, ArrowRight, Search, Loader2 } from "lucide-react";

/**
 * Live-resource links per official template, keyed by the template's slug (the
 * template id = its folder name). INTERNAL-ONLY. Extracted from the former
 * hardcoded demo catalog; the old ids (customer-support, …) gained an `aibi-`
 * prefix when the demos became first-class templates.
 */
const DEMO_LINKS: Record<string, DemoResourceLinks> = {
  "aibi-app-luxebeauty-returns": {
    app: "https://sln-builder-luxebeauty-demo-2556758628403379.aws.databricksapps.com",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c3f19e19968a1e180ff8fd5e94",
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c28bfd13a79fb66a71c49d56ca",
  },
  "aibi-customer-support": {
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c957fd11589ace985143959694/published",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c955431950ac32f001b6a66cc9",
    data: "https://e2-demo-west.cloud.databricks.com/explore/data/demos_genie/dbdemos_v2_customer_support",
  },
  "aibi-marketing-campaign": {
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c867751f939a7e164775c8c53d/published",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c864ef140394ed3ba65349dc40",
    data: "https://e2-demo-west.cloud.databricks.com/explore/data/demos_genie/dbdemos_v2_marketing_campaign",
  },
  "aibi-portfolio-assistant": {
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c89dcf1dcdbe8a0b328dd44d98/published",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c89a1210c0aa9bbadcff5981bd",
    data: "https://e2-demo-west.cloud.databricks.com/explore/data/demos_genie/dbdemos_v2_portfolio_assistant",
  },
  "aibi-supply-chain": {
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c8d572183fa7599e983858a43e/published",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c8d21a1cbc998bcb06903d7945",
    data: "https://e2-demo-west.cloud.databricks.com/explore/data/demos_genie/dbdemos_v2_supply_chain_forecasting",
  },
  "aibi-sales-pipeline": {
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c90af01178af1b748b0b5df223/published",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c908791f59a4e4513c3cabef7c",
    data: "https://e2-demo-west.cloud.databricks.com/explore/data/demos_genie/dbdemos_v2_sales_pipeline_review",
  },
  "aibi-patient-genomics": {
    dashboard: "https://e2-demo-west.cloud.databricks.com/dashboardsv3/01f165c932d41741b814a0889ce12f5e/published",
    genie: "https://e2-demo-west.cloud.databricks.com/genie/rooms/01f165c92fc91f7281e8b542edea9043",
    data: "https://e2-demo-west.cloud.databricks.com/explore/data/demos_genie/dbdemos_v2_patient_genomics",
  },
};

function InternalDemosPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<TemplateListItem | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isForking, setIsForking] = useState(false);

  // Fetch APPROVED templates and keep only the curated/official ones.
  useEffect(() => {
    listTemplates("APPROVED")
      .then((all) => setTemplates(all.filter((t) => t.official === true)))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const industries = useMemo(
    () =>
      Array.from(
        new Set(templates.map((t) => t.industry).filter((i): i is string => Boolean(i))),
      ).sort(),
    [templates],
  );

  const filtered = useGalleryFilter(templates, industry, search);

  const handleFork = async (template: TemplateDetail) => {
    setIsForking(true);
    try {
      const project = await createProjectFromTemplate(template.id, template.name);
      navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    } catch (error) {
      console.error("Failed to fork template:", error);
      setIsForking(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
        {/* Title */}
        <header className="mb-6 text-center sm:text-left">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Genie / AI Demos ready to go, from your phone!
          </h1>
        </header>

        {/* Callout — build your own */}
        <a
          href="http://go/solution-builder"
          className="group mb-6 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/[0.08] to-transparent px-5 py-4 no-underline transition-colors hover:border-primary/50 hover:from-primary/[0.12]"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold text-foreground">
                Don't see the demo you want?
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                Ask the AI to build yours — go/solution-builder
              </div>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
        </a>

        {/* Filters — industry autocomplete + free-text search. */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <IndustryCombobox industries={industries} value={industry} onChange={setIndustry} />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search demos — try 'returns', 'ROI', 'forecast'…"
              className="w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
        </div>

        {/* Tile grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <TemplateGalleryTile
                key={t.id}
                template={t}
                onOpen={setSelected}
                links={DEMO_LINKS[t.id]}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 py-16 text-center text-[13.5px] text-muted-foreground">
            No demos match — try clearing the filters.
          </div>
        )}
      </div>

      <TemplateGallerySheet
        templateId={selected?.id ?? null}
        onClose={() => setSelected(null)}
        links={selected ? DEMO_LINKS[selected.id] : undefined}
        onFork={handleFork}
      />

      {/* Full-screen forking overlay */}
      {isForking && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-semibold">Forking template…</p>
            <p className="text-sm text-muted-foreground">Setting up your editable copy</p>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/internal-demos")({
  component: InternalDemosPage,
});
