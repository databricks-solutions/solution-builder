/**
 * Project tile component for displaying projects on the home page.
 */

import { memo } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { Badge } from "../ui/badge";
import type { ProjectListItem } from "../../lib/custom-api";

interface ProjectTileProps {
  project: ProjectListItem;
  onClick: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today";
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
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
    <Card
      className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-base line-clamp-2 group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {project.project_type.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <FileIcon className="h-3.5 w-3.5" />
            <span>{project.file_count} files</span>
          </div>
          <div className="flex items-center gap-1">
            <MessageIcon className="h-3.5 w-3.5" />
            <span>{project.message_count} messages</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="pt-2 border-t border-border/30">
        <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
          <span>Updated {formatDate(project.updated_at)}</span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary font-medium">
            Open →
          </span>
        </div>
      </CardFooter>
    </Card>
  );
});

// Simple icons
function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default ProjectTile;
