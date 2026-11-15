/**
 * "Try it live" band for a template that is deployed in THIS app's workspace.
 *
 * The backend only returns `live_demo` when the manifest's deployment is in the
 * same workspace as the app (see backend/services/live_demo.py), so this never
 * links a user into a workspace that isn't theirs.
 *
 * Layout: a header row (live status + ONE primary action — the app, or the
 * dashboard when there is no app), then a regular grid of equal-size resource
 * cards (brand icon + name + what it is), then the demo's opening questions.
 */

import type { ComponentType, SVGProps } from "react";
import { ArrowUpRight, ExternalLink, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AIBIBrandIcon,
  DatabricksAppsBrandIcon,
  GenieBrandIcon,
  LakeflowJobsBrandIcon,
  MLModelBrandIcon,
  SDPBrandIcon,
  UnityCatalogBrandIcon,
} from "@/components/databricks-icons";
import type { LiveDemo, LiveDemoAsset } from "@/lib/custom-api";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** Per-kind icon, card title and one-line "what is it" caption. */
const KIND: Record<string, { icon: Icon; title: string; caption: string }> = {
  app: { icon: DatabricksAppsBrandIcon, title: "App", caption: "Databricks App" },
  dashboard: { icon: AIBIBrandIcon, title: "Dashboard", caption: "AI/BI dashboard" },
  genie: { icon: GenieBrandIcon, title: "Genie", caption: "Ask your data" },
  pipeline: { icon: SDPBrandIcon, title: "Pipeline", caption: "Lakeflow pipeline" },
  job: { icon: LakeflowJobsBrandIcon, title: "Setup job", caption: "Builds the demo" },
  documents: { icon: UnityCatalogBrandIcon, title: "Documents", caption: "Volume searched by Genie" },
  model: { icon: MLModelBrandIcon, title: "ML model", caption: "Unity Catalog model" },
  data: { icon: UnityCatalogBrandIcon, title: "Data", caption: "Unity Catalog" },
  folder: { icon: Folder, title: "Workspace folder", caption: "Bundle & assets" },
};

function kindOf(a: LiveDemoAsset) {
  return KIND[a.kind] ?? { icon: ExternalLink, title: a.label, caption: "" };
}

function PrimaryButton({ asset }: { asset: LiveDemoAsset }) {
  const { icon: Icon } = kindOf(asset);
  const label = asset.kind === "app" ? "Open the app" : `Open the ${kindOf(asset).title.toLowerCase()}`;
  return (
    <a
      href={asset.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-2.5 rounded-lg bg-primary py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold text-primary-foreground no-underline shadow-sm transition-all hover:shadow-md hover:brightness-110"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white p-1.5 shadow-sm ring-1 ring-black/5">
        <Icon className="h-full w-full" />
      </span>
      {label}
      <ArrowUpRight className="h-4 w-4 opacity-80" />
    </a>
  );
}

function ResourceCard({ asset }: { asset: LiveDemoAsset }) {
  const { icon: Icon, title, caption } = kindOf(asset);
  return (
    <a
      href={asset.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${title} in a new tab`}
      className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-2 no-underline transition-colors hover:border-primary/40 hover:bg-background"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60 p-1.5">
        <Icon className="h-full w-full" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight text-foreground">{title}</span>
        {caption && (
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">{caption}</span>
        )}
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </a>
  );
}

export function LiveDemoPanel({ live, className }: { live: LiveDemo; className?: string }) {
  if (!live.assets.length) return null;
  const primary = live.assets.find((a) => a.kind === "app") ?? live.assets.find((a) => a.kind === "dashboard") ?? live.assets[0];
  const rest = live.assets.filter((a) => a !== primary);

  return (
    <section
      aria-label="Try this demo live"
      className={cn("rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3.5", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live in this workspace
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Everything below is deployed and ready — open any piece in a new tab.
          </p>
        </div>
        <PrimaryButton asset={primary} />
      </div>

      {rest.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((a) => (
            <ResourceCard key={a.kind} asset={a} />
          ))}
        </div>
      )}

      {live.demo_questions.length > 0 && (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">Try asking: </span>
          {live.demo_questions.map((q, i) => (
            <span key={q}>
              {i > 0 && <span className="mx-1.5 text-muted-foreground/50">·</span>}
              <span className="italic">“{q}”</span>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
