/**
 * Deployed resources bar — shows clickable links to live Databricks resources.
 * Rendered below the FileViewer TabBar when resources.json contains deployed IDs.
 */

import { memo, useEffect, useRef, type SVGProps } from "react";
import { motion } from "motion/react";
import {
  Database,
  FolderOpen,
  Boxes,
  AppWindow,
  ExternalLink,
  FlaskConical,
} from "lucide-react";
import type { DeployedResourceLink } from "@/lib/custom-api";
import { cn } from "@/lib/utils";
import { getPillPalette, MEDALLION } from "@/lib/resource-palette";

// Databricks-native SVG icons for resource types
function PipelineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 16 16" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M3.75 4a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5m2.646-.5a2.751 2.751 0 1 1 0-1.5h5.229a3.375 3.375 0 0 1 .118 6.748L8.436 11.11a.75.75 0 0 1-.872 0l-3.3-2.357a1.875 1.875 0 0 0 .111 3.747h5.229a2.751 2.751 0 1 1 0 1.5H4.375a3.375 3.375 0 0 1-.118-6.748L7.564 4.89a.75.75 0 0 1 .872 0l3.3 2.357a1.875 1.875 0 0 0-.111-3.747zm7.104 9.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0M8 6.422 5.79 8 8 9.578 10.21 8z" clipRule="evenodd" />
    </svg>
  );
}

function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 16 16" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75zm1.5 8.75v3h4.75v-3zm0-1.5h4.75V2.5H2.5zm6.25-6.5v3h4.75v-3zm0 11V7h4.75v6.5z" clipRule="evenodd" />
    </svg>
  );
}

function GenieIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 16 16" {...props}>
      <path fill="currentColor" fillRule="evenodd" d="M0 2.75A.75.75 0 0 1 .75 2H8v1.5H1.5v9h13V10H16v3.25a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1-.75-.75zm12.987-.14a.75.75 0 0 0-1.474 0l-.137.728a1.93 1.93 0 0 1-1.538 1.538l-.727.137a.75.75 0 0 0 0 1.474l.727.137c.78.147 1.39.758 1.538 1.538l.137.727a.75.75 0 0 0 1.474 0l.137-.727c.147-.78.758-1.39 1.538-1.538l.727-.137a.75.75 0 0 0 0-1.474l-.727-.137a1.93 1.93 0 0 1-1.538-1.538z" clipRule="evenodd" />
    </svg>
  );
}

function AgentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 16 16" {...props}>
      <path fill="currentColor" d="M8 1c.664 0 1.282.2 1.797.542l-.014.072-.062.357-.357.062c-.402.07-.765.245-1.06.493a1.75 1.75 0 1 0 0 3.447c.295.25.658.424 1.06.494l.357.062.062.357.014.072A3.25 3.25 0 1 1 8 1" />
      <path fill="currentColor" d="M9.59 4.983A.75.75 0 0 1 9.62 3.51l.877-.152a.75.75 0 0 0 .61-.61l.153-.878a.75.75 0 0 1 1.478 0l.152.877a.75.75 0 0 0 .61.61l.878.153a.75.75 0 0 1 0 1.478l-.877.152a.75.75 0 0 0-.61.61l-.153.878a.75.75 0 0 1-1.478 0l-.152-.877a.75.75 0 0 0-.61-.61l-.878-.153z" />
      <path fill="currentColor" fillRule="evenodd" d="M1.164 12.287A8.74 8.74 0 0 1 8 9a8.74 8.74 0 0 1 6.836 3.287.75.75 0 0 1 .164.469v1.494a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-1.494a.75.75 0 0 1 .164-.469m1.336.74v.473h11v-.474A7.23 7.23 0 0 0 8 10.5c-2.2 0-4.17.978-5.5 2.526" clipRule="evenodd" />
    </svg>
  );
}

// Map resource_type to an icon component
const RESOURCE_ICONS: Record<string, React.ElementType> = {
  pipeline: PipelineIcon,
  dashboard: DashboardIcon,
  genie_space: GenieIcon,
  sql_warehouse: Database,
  workspace_folder: FolderOpen,
  catalog_explorer: Boxes,
  knowledge_assistant: AgentIcon,
  multi_agent_supervisor: AgentIcon,
  mlflow_experiment: FlaskConical,
  app: AppWindow,
};

interface PillStyle {
  pillBg: string;
  pillHover: string;
  iconClass: string;
}

function pillStyle(resourceType: string): PillStyle {
  const p = getPillPalette(resourceType);
  if (p.kind === "medallion") {
    return {
      pillBg: MEDALLION.pillBg,
      pillHover: MEDALLION.pillHover,
      iconClass: MEDALLION.iconClass,
    };
  }
  return {
    pillBg: p.color.pillBg,
    pillHover: p.color.pillHover,
    iconClass: p.color.iconClass,
  };
}

function resourceKey(r: DeployedResourceLink): string {
  return `${r.resource_type}:${r.resource_id ?? r.label}`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface DeployedResourcesBarProps {
  resources: DeployedResourceLink[];
  deployedAt?: string | null;
  newResourceIds?: Set<string>;
}

interface PillProps {
  resource: DeployedResourceLink;
  isNew: boolean;
  staggerIndex: number;
  pillRef?: (el: HTMLElement | null) => void;
}

function ResourcePill({ resource, isNew, staggerIndex, pillRef }: PillProps) {
  const Icon = RESOURCE_ICONS[resource.resource_type] ?? ExternalLink;
  const style = pillStyle(resource.resource_type);
  const isLink = !!resource.url;

  const innerClass = cn(
    "relative inline-flex items-center gap-2 text-sm font-medium rounded-md px-3 py-2 border group transition-colors",
    style.pillBg,
    isLink ? style.pillHover : "opacity-80",
  );

  const inner = isLink ? (
    <a
      href={resource.url!}
      target="_blank"
      rel="noopener noreferrer"
      className={innerClass}
      title={resource.label}
    >
      <Icon className={cn("h-4 w-4 shrink-0", style.iconClass)} />
      <span>{resource.label}</span>
      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
      {isNew && (
        <span className="absolute -top-1 -right-1 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
    </a>
  ) : (
    <span
      className={innerClass}
      title={resource.resource_id ?? resource.label}
    >
      <Icon className={cn("h-4 w-4 shrink-0", style.iconClass)} />
      <span className="font-medium">{resource.label}</span>
      {isNew && (
        <span className="absolute -top-1 -right-1 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
    </span>
  );

  return (
    <motion.div
      ref={(el) => pillRef?.(el)}
      initial={isNew ? { scale: 0.85, opacity: 0, y: -4 } : false}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ delay: isNew ? staggerIndex * 0.06 : 0, duration: 0.25, ease: "easeOut" }}
      className="relative shrink-0"
    >
      {isNew ? (
        // Gradient ring — 1.5px padding acts as a moving border around the pill
        <div className="rounded-[8px] p-[1.5px] bg-gradient-to-r from-primary/70 via-primary/20 to-primary/70 animate-resource-shimmer">
          {inner}
        </div>
      ) : (
        inner
      )}
    </motion.div>
  );
}

export const DeployedResourcesBar = memo(function DeployedResourcesBar({
  resources,
  deployedAt,
  newResourceIds,
}: DeployedResourcesBarProps) {
  const newPillRef = useRef<HTMLElement | null>(null);
  const newCount = newResourceIds?.size ?? 0;

  // Auto-scroll the first new pill into view when newResourceIds changes.
  useEffect(() => {
    if (newCount === 0) return;
    const el = newPillRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [newCount]);

  if (resources.length === 0) return null;

  let staggerCounter = 0;
  let firstNewSeen = false;

  return (
    <div className="shrink-0 border-b border-primary/20 bg-gradient-to-r from-primary/[0.06] via-primary/[0.02] to-primary/[0.06]">
      <div className="flex items-center gap-3 px-4 py-3 overflow-x-auto">
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
            aria-hidden
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Live in workspace
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            · {resources.length}
          </span>
        </div>
        {newCount > 0 && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs font-semibold text-primary shrink-0 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30"
          >
            +{newCount} new
          </motion.span>
        )}
        <div className="h-4 w-px bg-primary/20 shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          {resources.map((resource) => {
            const key = resourceKey(resource);
            const isNew = newResourceIds?.has(key) ?? false;
            const stagger = isNew ? staggerCounter++ : 0;
            const captureRef = isNew && !firstNewSeen;
            if (captureRef) firstNewSeen = true;

            return (
              <ResourcePill
                key={key}
                resource={resource}
                isNew={isNew}
                staggerIndex={stagger}
                pillRef={captureRef ? (el) => { newPillRef.current = el; } : undefined}
              />
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Deployed timestamp */}
        {deployedAt && (
          <span
            className="text-[11px] text-muted-foreground/70 shrink-0"
            title={new Date(deployedAt).toLocaleString()}
          >
            Deployed {formatRelativeTime(deployedAt)}
          </span>
        )}
      </div>
    </div>
  );
});

export default DeployedResourcesBar;

export { resourceKey };
