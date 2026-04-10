import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectTile } from "@/components/project/project-tile";
import { AppLayout } from "@/components/layout/app-layout";
import { listProjects, type ProjectListItem } from "@/lib/custom-api";
import { Search, SlidersHorizontal, FolderOpen, Loader2 } from "lucide-react";

function ProjectsWithLayout() {
  return <AppLayout><ProjectsPage /></AppLayout>;
}

export const Route = createFileRoute("/projects")({
  component: ProjectsWithLayout,
});

type SortOption = "most-recent" | "oldest" | "most-files" | "most-messages";

function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("most-recent");

  // Load projects on mount
  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    let result = projects;

    // Filter by search query
    if (debouncedQuery.trim()) {
      const query = debouncedQuery.trim().toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(query));
    }

    // Sort
    const sorted = [...result];
    switch (sortBy) {
      case "most-recent":
        sorted.sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        break;
      case "oldest":
        sorted.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        break;
      case "most-files":
        sorted.sort((a, b) => b.file_count - a.file_count);
        break;
      case "most-messages":
        sorted.sort((a, b) => b.message_count - a.message_count);
        break;
    }

    return sorted;
  }, [projects, debouncedQuery, sortBy]);

  const handleOpenProject = (projectId: string) => {
    navigate({
      to: "/project/$projectId",
      params: { projectId },
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-32">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading projects...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center py-32">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive">Failed to load projects</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setIsLoading(true);
              listProjects()
                .then(setProjects)
                .catch((err) => setError(err.message))
                .finally(() => setIsLoading(false));
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Empty state: no projects at all
  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-32">
        <div className="text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <FolderOpen className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">No projects yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Create your first project from the home page to get started.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/" })}
          >
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {projects.length} {projects.length === 1 ? "project" : "projects"} total
        </p>
      </div>

      {/* Search and sort controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-10 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="sr-only">Clear search</span>
              <svg
                className="h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow cursor-pointer"
          >
            <option value="most-recent">Most Recent</option>
            <option value="oldest">Oldest</option>
            <option value="most-files">Most Files</option>
            <option value="most-messages">Most Messages</option>
          </select>
        </div>
      </div>

      {/* Project grid */}
      {filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <ProjectTile
              key={project.id}
              project={project}
              onClick={() => handleOpenProject(project.id)}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Search className="h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              No projects match "{debouncedQuery}"
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Try adjusting your search term
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setSearchQuery("")}
            >
              Clear search
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
