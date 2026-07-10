/**
 * SharedWithMe — the "Shared with Me" grid of projects another user shared with
 * the current user (accepted shares only). Self-contained: fetches
 * listSharedProjects, renders ProjectTile cards, and handles open + clone.
 * Renders nothing when there are none. Used on the home page below Recent
 * Projects (the Projects page has its own inline version with extra controls).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Users, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ProjectTile } from "@/components/project/project-tile";
import {
  listSharedProjects,
  cloneProject,
  type ProjectListItem,
} from "@/lib/custom-api";

interface SharedWithMeProps {
  className?: string;
  /** Max tiles to show (home page keeps it compact). */
  limit?: number;
  /** Controlled: when provided, the parent owns the list (home page loads it
   *  via one combined call). When omitted, the component self-fetches. */
  projects?: ProjectListItem[];
}

export function SharedWithMe({ className, limit = 3, projects: projectsProp }: SharedWithMeProps) {
  const navigate = useNavigate();
  const [selfShared, setSelfShared] = useState<ProjectListItem[]>([]);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const controlled = projectsProp !== undefined;
  const shared = controlled ? projectsProp : selfShared;

  useEffect(() => {
    if (controlled) return;
    listSharedProjects()
      .then(setSelfShared)
      .catch(() => setSelfShared([]));
  }, [controlled]);

  const handleClone = async (projectId: string) => {
    setCloningId(projectId);
    try {
      const clone = await cloneProject(projectId);
      navigate({ to: "/project/$projectId", params: { projectId: clone.id } });
    } catch (err) {
      console.error("Failed to clone project:", err);
    } finally {
      setCloningId(null);
    }
  };

  if (shared.length === 0) return null;

  return (
    <section className={className}>
      <div className="mb-4 flex items-end justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-500" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Shared with Me</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Projects teammates shared with you
            </p>
          </div>
        </div>
        {shared.length > limit && (
          <Link
            to={"/projects"}
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            View all ({shared.length})
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shared.slice(0, limit).map((project) => (
          <ProjectTile
            key={project.id}
            project={project}
            onClick={() => navigate({ to: "/project/$projectId", params: { projectId: project.id } })}
            onClone={() => handleClone(project.id)}
            cloning={cloningId === project.id}
            showOwner
            showCustomer={false}
          />
        ))}
      </div>
    </section>
  );
}

export default SharedWithMe;
