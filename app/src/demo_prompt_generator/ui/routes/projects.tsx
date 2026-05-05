import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectTile } from "@/components/project/project-tile";
import { AppLayout } from "@/components/layout/app-layout";
import {
  listProjects,
  listSharedProjects,
  toggleProjectStar,
  shareProject,
  listProjectShares,
  unshareProject,
  getCurrentUser,
  type ProjectListItem,
  type ProjectShareOut,
} from "@/lib/custom-api";
import {
  Search,
  SlidersHorizontal,
  FolderOpen,
  Loader2,
  Star,
  Users,
  Share2,
  X,
  Trash2,
  Shield,
} from "lucide-react";

function ProjectsWithLayout() {
  return (
    <AppLayout>
      <ProjectsPage />
    </AppLayout>
  );
}

export const Route = createFileRoute("/projects")({
  component: ProjectsWithLayout,
});

type SortOption = "most-recent" | "oldest" | "most-files" | "most-messages";

function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [sharedProjects, setSharedProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("most-recent");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminViewAll, setAdminViewAll] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");

  // Share dialog state
  const [shareDialogProject, setShareDialogProject] =
    useState<ProjectListItem | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [existingShares, setExistingShares] = useState<ProjectShareOut[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);

  // Resolve current user once so we know if the admin toggle should appear.
  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setIsAdmin(user.is_admin);
        setCurrentUserEmail(user.email);
      })
      .catch(() => {
        // Non-fatal — the page still works for non-admins.
      });
  }, []);

  // Load projects (and shared) when mount or admin toggle flips.
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    Promise.all([
      listProjects({ includeAll: adminViewAll }),
      listSharedProjects(),
    ])
      .then(([own, shared]) => {
        setProjects(own);
        setSharedProjects(shared);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [adminViewAll]);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter and sort
  const filterAndSort = useCallback(
    (items: ProjectListItem[]) => {
      let result = items;
      if (debouncedQuery.trim()) {
        const query = debouncedQuery.trim().toLowerCase();
        result = result.filter((p) => p.name.toLowerCase().includes(query));
      }
      const sorted = [...result];
      switch (sortBy) {
        case "most-recent":
          sorted.sort(
            (a, b) =>
              new Date(b.updated_at).getTime() -
              new Date(a.updated_at).getTime()
          );
          break;
        case "oldest":
          sorted.sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
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
    },
    [debouncedQuery, sortBy]
  );

  const starredProjects = useMemo(
    () => filterAndSort(projects.filter((p) => p.is_starred)),
    [projects, filterAndSort]
  );

  const unstarredProjects = useMemo(
    () => filterAndSort(projects.filter((p) => !p.is_starred)),
    [projects, filterAndSort]
  );

  const filteredShared = useMemo(
    () => filterAndSort(sharedProjects),
    [sharedProjects, filterAndSort]
  );

  const handleOpenProject = (projectId: string) => {
    navigate({
      to: "/project/$projectId",
      params: { projectId },
    });
  };

  const handleToggleStar = async (project: ProjectListItem) => {
    try {
      const result = await toggleProjectStar(project.id);
      // Update local state
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, is_starred: result.starred } : p
        )
      );
      setSharedProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, is_starred: result.starred } : p
        )
      );
    } catch (err) {
      console.error("Failed to toggle star:", err);
    }
  };

  const handleOpenShareDialog = async (project: ProjectListItem) => {
    setShareDialogProject(project);
    setShareEmail("");
    setShareMessage("");
    setShareError(null);
    setIsLoadingShares(true);
    try {
      const shares = await listProjectShares(project.id);
      setExistingShares(shares);
    } catch {
      setExistingShares([]);
    } finally {
      setIsLoadingShares(false);
    }
  };

  const handleShare = async () => {
    if (!shareDialogProject || !shareEmail.trim()) return;
    setIsSharing(true);
    setShareError(null);
    try {
      const newShare = await shareProject(
        shareDialogProject.id,
        shareEmail.trim(),
        shareMessage.trim() || undefined
      );
      setExistingShares((prev) => [...prev, newShare]);
      setShareEmail("");
      setShareMessage("");
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Failed to share project"
      );
    } finally {
      setIsSharing(false);
    }
  };

  const handleUnshare = async (shareId: number) => {
    if (!shareDialogProject) return;
    try {
      await unshareProject(shareDialogProject.id, shareId);
      setExistingShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      console.error("Failed to unshare:", err);
    }
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
              Promise.all([
                listProjects({ includeAll: adminViewAll }),
                listSharedProjects(),
              ])
                .then(([own, shared]) => {
                  setProjects(own);
                  setSharedProjects(shared);
                })
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
  if (projects.length === 0 && sharedProjects.length === 0) {
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
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  const hasStarred = starredProjects.length > 0;
  const hasShared = filteredShared.length > 0;
  const totalCount = projects.length + sharedProjects.length;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-background p-6 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
        <div className="flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 ring-1 ring-blue-500/30">
            <FolderOpen className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="space-y-1.5 flex-1">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {adminViewAll ? "All Projects (Admin)" : "My Projects"}
            </h1>
            <p className="text-base text-muted-foreground sm:text-lg">
              {adminViewAll
                ? `Browsing every project in the system · ${totalCount} ${totalCount === 1 ? "project" : "projects"} total`
                : `Full custom demo packages generated per customer scenario · ${totalCount} ${totalCount === 1 ? "project" : "projects"} total`}
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setAdminViewAll((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                adminViewAll
                  ? "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300"
                  : "bg-background border-border hover:bg-muted"
              }`}
              title="Admin: toggle between My Projects and All Projects"
            >
              <Shield className="h-4 w-4" />
              {adminViewAll ? "Viewing all" : "View all (admin)"}
            </button>
          )}
        </div>
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
            aria-label="Search projects"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="sr-only">Clear search</span>
              <X className="h-4 w-4" />
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
            aria-label="Sort projects by"
          >
            <option value="most-recent">Most Recent</option>
            <option value="oldest">Oldest</option>
            <option value="most-files">Most Files</option>
            <option value="most-messages">Most Messages</option>
          </select>
        </div>
      </div>

      {/* Starred section */}
      {hasStarred && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-amber-500" fill="currentColor" />
            <h2 className="text-sm font-semibold text-foreground">Starred</h2>
            <span className="text-xs text-muted-foreground">
              ({starredProjects.length})
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {starredProjects.map((project) => (
              <ProjectTile
                key={project.id}
                project={project}
                onClick={() => handleOpenProject(project.id)}
                onToggleStar={() => handleToggleStar(project)}
                onShare={
                  project.owner_email === currentUserEmail
                    ? () => handleOpenShareDialog(project)
                    : undefined
                }
                showOwner={adminViewAll && project.owner_email !== currentUserEmail}
              />
            ))}
          </div>
        </section>
      )}

      {/* Shared with me section */}
      {hasShared && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Shared with Me
            </h2>
            <span className="text-xs text-muted-foreground">
              ({filteredShared.length})
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredShared.map((project) => (
              <ProjectTile
                key={project.id}
                project={project}
                onClick={() => handleOpenProject(project.id)}
                onToggleStar={() => handleToggleStar(project)}
                showOwner
              />
            ))}
          </div>
        </section>
      )}

      {/* All projects section */}
      <section>
        {(hasStarred || hasShared) && (
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              {hasStarred ? "Other Projects" : "All Projects"}
            </h2>
            <span className="text-xs text-muted-foreground">
              ({unstarredProjects.length})
            </span>
          </div>
        )}
        {unstarredProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {unstarredProjects.map((project) => (
              <ProjectTile
                key={project.id}
                project={project}
                onClick={() => handleOpenProject(project.id)}
                onToggleStar={() => handleToggleStar(project)}
                onShare={
                  project.owner_email === currentUserEmail
                    ? () => handleOpenShareDialog(project)
                    : undefined
                }
                showOwner={adminViewAll && project.owner_email !== currentUserEmail}
              />
            ))}
          </div>
        ) : debouncedQuery.trim() ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Search className="h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                No projects match &ldquo;{debouncedQuery}&rdquo;
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
        ) : null}
      </section>

      {/* Share Dialog */}
      <Dialog
        open={!!shareDialogProject}
        onOpenChange={(open) => {
          if (!open) setShareDialogProject(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share Project
            </DialogTitle>
            <DialogDescription>
              Share &ldquo;{shareDialogProject?.name}&rdquo; with a teammate via
              their email.
            </DialogDescription>
          </DialogHeader>

          {/* Share form */}
          <div className="space-y-3">
            <div>
              <label
                htmlFor="share-email"
                className="text-sm font-medium text-foreground"
              >
                Email address
              </label>
              <input
                id="share-email"
                type="email"
                placeholder="colleague@databricks.com"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleShare();
                }}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
            </div>
            <div>
              <label
                htmlFor="share-message"
                className="text-sm font-medium text-foreground"
              >
                Message{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <input
                id="share-message"
                type="text"
                placeholder="Check out this demo..."
                value={shareMessage}
                onChange={(e) => setShareMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleShare();
                }}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
            </div>

            {shareError && (
              <p className="text-sm text-destructive">{shareError}</p>
            )}

            <Button
              onClick={handleShare}
              disabled={!shareEmail.trim() || isSharing}
              className="w-full"
            >
              {isSharing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sharing...
                </>
              ) : (
                "Share"
              )}
            </Button>
          </div>

          {/* Existing shares */}
          {(existingShares.length > 0 || isLoadingShares) && (
            <div className="border-t border-border pt-4 mt-2">
              <h4 className="text-sm font-medium text-foreground mb-2">
                Shared with
              </h4>
              {isLoadingShares ? (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {existingShares.map((share) => (
                    <li
                      key={share.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-foreground truncate">
                        {share.shared_with_email}
                      </span>
                      <button
                        onClick={() => handleUnshare(share.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        title="Remove access"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
