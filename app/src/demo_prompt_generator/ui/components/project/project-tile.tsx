/**
 * Project tile component for displaying projects on the home page.
 */

import { memo } from "react";
import { FileText, MessageSquare, ArrowUpRight } from "lucide-react";
import type { ProjectListItem } from "../../lib/custom-api";

interface ProjectTileProps {
  project: ProjectListItem;
  onClick: () => void;
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

export const ProjectTile = memo(function ProjectTile({
  project,
  onClick,
}: ProjectTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left w-full rounded-xl border border-primary/[0.08] bg-card/60 backdrop-blur-lg shadow-sm shadow-primary/[0.03] overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-primary/[0.08] hover:border-primary/20 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Gradient accent bar */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/40 via-primary/20 to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

      <div className="p-4 pb-3">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-primary transition-all mt-0.5" />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3 opacity-50" />
            {project.file_count}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3 opacity-50" />
            {project.message_count}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-primary/[0.06] bg-primary/[0.02]">
        <span className="text-[11px] text-muted-foreground/70">
          {formatDate(project.updated_at)}
        </span>
      </div>
    </button>
  );
});

export default ProjectTile;
