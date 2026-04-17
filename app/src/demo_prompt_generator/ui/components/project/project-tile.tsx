/**
 * Project tile component for displaying projects in grid views.
 * Supports starring, sharing indicators, and owner display.
 */

import { memo } from "react";
import { FileText, MessageSquare, ArrowUpRight, Star, Share2, User, LayoutTemplate, CheckCircle2 } from "lucide-react";
import type { ProjectListItem } from "../../lib/custom-api";

interface ProjectTileProps {
  project: ProjectListItem;
  onClick: () => void;
  onToggleStar?: (e: React.MouseEvent) => void;
  onShare?: (e: React.MouseEvent) => void;
  showOwner?: boolean;
}

function formatDate(dateStr: string): string {
  const normalizedDateStr = dateStr.endsWith("Z") || dateStr.includes("+") || dateStr.includes("-", 10)
    ? dateStr
    : dateStr + "Z";
  const date = new Date(normalizedDateStr);
  const now = new Date();

  const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = nowLocal.getTime() - dateLocal.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today";
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }
}

function formatEmail(email: string): string {
  const name = email.split("@")[0];
  return name
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Returns a color class for how stale a completed project is. */
function stalenessColor(dateStr: string): string {
  const normalizedDateStr = dateStr.endsWith("Z") || dateStr.includes("+") || dateStr.includes("-", 10)
    ? dateStr
    : dateStr + "Z";
  const date = new Date(normalizedDateStr);
  const diffDays = Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return "text-green-600 dark:text-green-400";
  if (diffDays <= 30) return "text-amber-600 dark:text-amber-400";
  return "text-orange-600 dark:text-orange-400";
}

export const ProjectTile = memo(function ProjectTile({
  project,
  onClick,
  onToggleStar,
  onShare,
  showOwner = false,
}: ProjectTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative text-left w-full rounded-xl border bg-card/60 backdrop-blur-lg shadow-sm overflow-hidden transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${
        project.stage === "BUNDLED"
          ? "border-green-500/20 shadow-green-500/[0.03] hover:shadow-lg hover:shadow-green-500/[0.08] hover:border-green-500/30"
          : "border-primary/[0.08] shadow-primary/[0.03] hover:shadow-lg hover:shadow-primary/[0.08] hover:border-primary/20"
      }`}
    >
      <div className="p-4 pb-3">
        {/* Title row with star */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors flex-1">
            {project.name}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {onToggleStar && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(e);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onToggleStar(e as unknown as React.MouseEvent);
                  }
                }}
                className={`p-1 rounded-md transition-colors ${
                  project.is_starred
                    ? "text-amber-500"
                    : "text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:text-amber-500"
                }`}
                aria-label={project.is_starred ? "Unstar project" : "Star project"}
              >
                <Star
                  className="h-3.5 w-3.5"
                  fill={project.is_starred ? "currentColor" : "none"}
                />
              </span>
            )}
            {onShare && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onShare(e);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onShare(e as unknown as React.MouseEvent);
                  }
                }}
                className="p-1 rounded-md text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:text-primary transition-colors"
                aria-label="Share project"
              >
                <Share2 className="h-3.5 w-3.5" />
              </span>
            )}
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-primary transition-all mt-0.5" />
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
          {project.description || "No description"}
        </p>

        {/* Owner (for shared projects) */}
        {showOwner && project.shared_by && (
          <div className="flex items-center gap-1.5 mt-2">
            <User className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground">
              Shared by {formatEmail(project.shared_by)}
            </span>
          </div>
        )}

        {/* Template lineage */}
        {project.source_template_name && (
          <div className="flex items-center gap-1.5 mt-2">
            <LayoutTemplate className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              From: {project.source_template_name}
            </span>
          </div>
        )}
      </div>

      {/* Footer: stats + date on same line */}
      <div className={`px-4 py-2.5 border-t flex items-center justify-between ${
        project.stage === "BUNDLED"
          ? "border-green-500/[0.08] bg-green-500/[0.02]"
          : "border-primary/[0.06] bg-primary/[0.02]"
      }`}>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3 opacity-50" />
            {project.file_count}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3 opacity-50" />
            {project.message_count}
          </span>
        </div>
        {project.stage === "BUNDLED" ? (
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${stalenessColor(project.updated_at)}`}>
            <CheckCircle2 className="h-3 w-3" />
            Ready &middot; {formatDate(project.updated_at)}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">
            {formatDate(project.updated_at)}
          </span>
        )}
      </div>
    </button>
  );
});

export default ProjectTile;
