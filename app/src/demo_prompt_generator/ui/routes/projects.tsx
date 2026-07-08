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
import { ShareDialog } from "@/components/project/share-dialog";
import { AppLayout } from "@/components/layout/app-layout";
import {
  listProjects,
  listSharedProjects,
  listShareInvitations,
  respondToShare,
  cloneProject,
  toggleProjectStar,
  deleteProject,
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
  X,
  Trash2,
  Shield,
  CheckSquare,
  Check,
  Mail,
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

type SortOption = "most-recent" | "oldest";

function formatEmailShort(email: string): string {
  const name = email.split("@")[0];
  return name.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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

  // Which project the <ShareDialog> is open for (null = closed).
  const [shareDialogProject, setShareDialogProject] =
    useState<ProjectListItem | null>(null);

  // Incoming share invitations (pending) + clone-in-flight tracking.
  const [invitations, setInvitations] = useState<ProjectShareOut[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  // Multi-select / bulk delete state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      listShareInvitations().catch(() => [] as ProjectShareOut[]),
    ])
      .then(([own, shared, invites]) => {
        setProjects(own);
        setSharedProjects(shared);
        setInvitations(invites);
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

  // In selection mode, tile click toggles selection instead of navigating.
  // Only owned projects (current user or admin override) can be selected.
  const canSelect = useCallback(
    (project: ProjectListItem) =>
      adminViewAll || project.owner_email === currentUserEmail,
    [adminViewAll, currentUserEmail]
  );

  const handleTileClick = (project: ProjectListItem) => {
    if (selectionMode) {
      if (!canSelect(project)) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(project.id)) next.delete(project.id);
        else next.add(project.id);
        return next;
      });
      return;
    }
    handleOpenProject(project.id);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setDeleteError(null);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    setDeleteError(null);
    const ids = Array.from(selectedIds);
    const failed: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          await deleteProject(id);
        } catch (err) {
          console.error(`Failed to delete project ${id}:`, err);
          failed.push(id);
        }
      })
    );
    const succeeded = ids.filter((id) => !failed.includes(id));
    if (succeeded.length > 0) {
      setProjects((prev) => prev.filter((p) => !succeeded.includes(p.id)));
      setSharedProjects((prev) => prev.filter((p) => !succeeded.includes(p.id)));
    }
    setIsDeleting(false);
    if (failed.length > 0) {
      setDeleteError(
        `Failed to delete ${failed.length} of ${ids.length} project${ids.length === 1 ? "" : "s"}.`
      );
      setSelectedIds(new Set(failed));
    } else {
      setConfirmDeleteOpen(false);
      exitSelectionMode();
    }
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

  // The share form + existing-shares management now live in <ShareDialog>;
  // this page just picks which project to open it for.
  const handleOpenShareDialog = (project: ProjectListItem) => {
    setShareDialogProject(project);
  };

  const handleRespondInvitation = async (
    projectId: string,
    accept: boolean
  ) => {
    setRespondingId(projectId);
    try {
      await respondToShare(projectId, accept);
      // Drop the invite; on accept, pull it into the shared-with-me list.
      setInvitations((prev) => prev.filter((i) => i.project_id !== projectId));
      if (accept) {
        const shared = await listSharedProjects();
        setSharedProjects(shared);
      }
    } catch (err) {
      console.error("Failed to respond to invitation:", err);
    } finally {
      setRespondingId(null);
    }
  };

  const handleClone = async (projectId: string) => {
    setCloningId(projectId);
    try {
      const clone = await cloneProject(projectId);
      navigate({ to: "/project/$projectId", params: { projectId: clone.id } });
    } catch (err) {
      console.error("Failed to clone project:", err);
      setCloningId(null);
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

  // Empty state: no projects at all. Pending invitations still count — a brand
  // new user whose only item is an invite must be able to see and accept it.
  if (
    projects.length === 0 &&
    sharedProjects.length === 0 &&
    invitations.length === 0
  ) {
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
                : `Full custom solution packages generated per customer scenario · ${totalCount} ${totalCount === 1 ? "project" : "projects"} total`}
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

      {/* Search, sort, and selection controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
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
          </select>
        </div>

        {/* Selection controls */}
        {!selectionMode ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectionMode(true)}
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Select
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {selectedIds.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={() => {
                setDeleteError(null);
                setConfirmDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>
            <Button variant="outline" size="sm" onClick={exitSelectionMode}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        )}
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
                onClick={() => handleTileClick(project)}
                onToggleStar={() => handleToggleStar(project)}
                onShare={
                  project.owner_email === currentUserEmail
                    ? () => handleOpenShareDialog(project)
                    : undefined
                }
                showOwner={adminViewAll && project.owner_email !== currentUserEmail}
                selectable={selectionMode && canSelect(project)}
                selected={selectedIds.has(project.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Pending share invitations */}
      {invitations.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Mail className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Invitations
            </h2>
            <span className="text-xs text-muted-foreground">
              ({invitations.length})
            </span>
          </div>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {inv.project_name || "A project"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatEmailShort(inv.owner_email)} shared this with you as{" "}
                    <span className="font-medium">
                      {inv.role === "editor" ? "an editor" : "a viewer"}
                    </span>
                    {inv.message ? ` — “${inv.message}”` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={respondingId === inv.project_id}
                    onClick={() =>
                      handleRespondInvitation(inv.project_id, false)
                    }
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    disabled={respondingId === inv.project_id}
                    onClick={() => handleRespondInvitation(inv.project_id, true)}
                  >
                    {respondingId === inv.project_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1" /> Accept
                      </>
                    )}
                  </Button>
                </div>
              </div>
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
                onClick={() => handleTileClick(project)}
                onToggleStar={() => handleToggleStar(project)}
                onClone={() => handleClone(project.id)}
                cloning={cloningId === project.id}
                showOwner
                selectable={selectionMode && canSelect(project)}
                selected={selectedIds.has(project.id)}
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
                onClick={() => handleTileClick(project)}
                onToggleStar={() => handleToggleStar(project)}
                onShare={
                  project.owner_email === currentUserEmail
                    ? () => handleOpenShareDialog(project)
                    : undefined
                }
                showOwner={adminViewAll && project.owner_email !== currentUserEmail}
                selectable={selectionMode && canSelect(project)}
                selected={selectedIds.has(project.id)}
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
      {shareDialogProject && (
        <ShareDialog
          projectId={shareDialogProject.id}
          projectName={shareDialogProject.name}
          open={!!shareDialogProject}
          onOpenChange={(open) => {
            if (!open) setShareDialogProject(null);
          }}
        />
      )}

      {/* Bulk delete confirmation */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setConfirmDeleteOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete {selectedIds.size}{" "}
              {selectedIds.size === 1 ? "project" : "projects"}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the selected{" "}
              {selectedIds.size === 1 ? "project" : "projects"}, including all
              messages and on-disk project files. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBulkDelete}
              disabled={isDeleting || selectedIds.size === 0}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {selectedIds.size}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
