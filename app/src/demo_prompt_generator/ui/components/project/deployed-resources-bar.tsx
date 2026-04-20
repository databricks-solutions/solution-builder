/**
 * Deployed resources bar — shows clickable links to live Databricks resources.
 * Rendered below the FileViewer TabBar when resources.json contains deployed IDs.
 */

import { memo, type SVGProps } from "react";
import {
  Database,
  FolderOpen,
  Boxes,
  AppWindow,
  ExternalLink,
} from "lucide-react";
import type { DeployedResourceLink } from "@/lib/custom-api";

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
  app: AppWindow,
};

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
}

export const DeployedResourcesBar = memo(function DeployedResourcesBar({
  resources,
  deployedAt,
}: DeployedResourcesBarProps) {
  if (resources.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border bg-muted/20">
      <div className="flex items-center gap-2 px-4 py-1.5 overflow-x-auto">
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          Resources
        </span>
        <div className="h-3 w-px bg-border shrink-0" />
        <div className="flex items-center gap-1.5 flex-wrap">
          {resources.map((resource) => {
            const Icon = RESOURCE_ICONS[resource.resource_type] ?? ExternalLink;

            if (resource.url) {
              return (
                <a
                  key={resource.resource_type}
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
                  title={resource.label}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span>{resource.label}</span>
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                </a>
              );
            }

            return (
              <span
                key={resource.resource_type}
                className="inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2 py-1 text-muted-foreground"
                title={resource.resource_id ?? resource.label}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span>{resource.label}</span>
              </span>
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
