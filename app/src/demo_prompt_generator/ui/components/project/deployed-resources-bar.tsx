/**
 * Deployed resources bar — shows clickable links to live Databricks resources.
 * Rendered below the FileViewer TabBar when resources.json contains deployed IDs.
 */

import { memo } from "react";
import {
  Workflow,
  BarChart3,
  MessageSquareText,
  Database,
  FolderOpen,
  Boxes,
  Bot,
  BrainCircuit,
  ExternalLink,
} from "lucide-react";
import type { DeployedResourceLink } from "@/lib/custom-api";

// Map resource_type to an icon component
const RESOURCE_ICONS: Record<string, React.ElementType> = {
  pipeline: Workflow,
  dashboard: BarChart3,
  genie_space: MessageSquareText,
  sql_warehouse: Database,
  workspace_folder: FolderOpen,
  catalog_explorer: Boxes,
  knowledge_assistant: Bot,
  multi_agent_supervisor: BrainCircuit,
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
