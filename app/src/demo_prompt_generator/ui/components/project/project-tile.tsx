/**
 * Project tile component for displaying projects in grid views.
 * Supports starring, sharing indicators, and owner display.
 */

import { memo } from "react";
import { ArrowUpRight, Star, Share2, User, LayoutTemplate, Check, FileText, MessageSquare, Building2, Copy, Eye, Pencil } from "lucide-react";
import type { ProjectListItem } from "../../lib/custom-api";
import { projectStatusFromStage, STATUS_META } from "../../lib/project-status";

interface ProjectTileProps {
  project: ProjectListItem;
  onClick: () => void;
  onToggleStar?: (e: React.MouseEvent) => void;
  onShare?: (e: React.MouseEvent) => void;
  onClone?: (e: React.MouseEvent) => void;
  cloning?: boolean;
  showOwner?: boolean;
  /** Show the "Customer: …" line. Default true (Projects list). The home page
   *  passes false to keep its tiles lighter. */
  showCustomer?: boolean;
  selectable?: boolean;
  selected?: boolean;
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

export const ProjectTile = memo(function ProjectTile({
  project,
  onClick,
  onToggleStar,
  onShare,
  onClone,
  cloning = false,
  showOwner = false,
  showCustomer = true,
  selectable = false,
  selected = false,
}: ProjectTileProps) {
  const status = projectStatusFromStage(project.stage);
  const statusMeta = STATUS_META[status];
  const role = project.shared_role;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative text-left w-full rounded-xl border bg-card/60 backdrop-blur-lg shadow-sm overflow-hidden transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${
        selected
          ? "border-primary/60 shadow-primary/20 ring-2 ring-primary/40"
          : status === "ready"
          ? "border-green-500/20 shadow-green-500/[0.03] hover:shadow-lg hover:shadow-green-500/[0.08] hover:border-green-500/30"
          : "border-primary/[0.08] shadow-primary/[0.03] hover:shadow-lg hover:shadow-primary/[0.08] hover:border-primary/20"
      }`}
    >
      {selectable && (
        <div
          className={`absolute top-2 left-2 z-10 flex h-5 w-5 items-center justify-center rounded border transition-colors ${
            selected
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-background/80 border-border group-hover:border-primary/50"
          }`}
          aria-hidden="true"
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </div>
      )}
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
            {onClone && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!cloning) onClone(e);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    if (!cloning) onClone(e as unknown as React.MouseEvent);
                  }
                }}
                className="p-1 rounded-md text-muted-foreground/40 hover:text-primary transition-colors"
                aria-label="Make a copy"
                title="Make my own editable copy"
              >
                <Copy className={`h-3.5 w-3.5 ${cloning ? "animate-pulse" : ""}`} />
              </span>
            )}
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-primary transition-all mt-0.5" />
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
          {project.description || "No description"}
        </p>

        {/* Customer — shown on the Projects list so reviewers can see who each
            project is for at a glance. Hidden on the home page (showCustomer
            false) to keep those tiles lighter. */}
        {showCustomer && (
          <div className="flex items-center gap-1.5 mt-2">
            <Building2 className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <span className="text-xs truncate">
              <span className="text-muted-foreground/70">Customer: </span>
              <span className={project.customer ? "text-foreground/80 font-medium" : "text-muted-foreground/60 italic"}>
                {project.customer || "Not specified"}
              </span>
            </span>
          </div>
        )}

        {/* Owner (shared OR admin-browsing-other-people's-projects) */}
        {showOwner && (project.shared_by || project.owner_email) && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <User className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground">
              {project.shared_by
                ? `Shared by ${formatEmail(project.shared_by)}`
                : `Owned by ${formatEmail(project.owner_email!)}`}
            </span>
            {role && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  role === "editor"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
                title={
                  role === "editor"
                    ? "You can edit this project"
                    : "You have read-only access — make a copy to edit"
                }
              >
                {role === "editor" ? (
                  <><Pencil className="h-2.5 w-2.5" /> Can edit</>
                ) : (
                  <><Eye className="h-2.5 w-2.5" /> View only</>
                )}
              </span>
            )}
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

      {/* Footer: status pill + counts on the left, date on the right.
          Counts use the same filtering as the file viewer
          (.databrickscfg / .claude/skills/ excluded) so they match what
          the user sees inside the project. */}
      <div className={`px-4 py-2.5 border-t flex items-center justify-between gap-2 ${
        status === "ready"
          ? "border-green-500/[0.08] bg-green-500/[0.02]"
          : "border-primary/[0.06] bg-primary/[0.02]"
      }`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${statusMeta.pill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
            {statusMeta.label}
          </span>
          {project.file_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 shrink-0">
              <FileText className="h-3 w-3" />
              {project.file_count}
            </span>
          )}
          {project.message_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 shrink-0">
              <MessageSquare className="h-3 w-3" />
              {project.message_count}
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground/70 shrink-0">
          {formatDate(project.updated_at)}
        </span>
      </div>
    </button>
  );
});

export default ProjectTile;
