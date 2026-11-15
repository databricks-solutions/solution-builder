/**
 * ProjectsWorkSection — "Your work" on the home page: the only project list (the
 * separate /projects page was removed). Recent | Shared | Invites, a search box,
 * dense rows and pagination.
 *
 * The home page owns the data (one getHomeProjects call) and the open / star /
 * clone / invite handlers. This component adds what the old page had: share,
 * delete (owner only, confirmed), and for admins an "All users" view, which it
 * fetches itself.
 */
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Copy, Layers, Loader2, Network, Search, Share2, Shield, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShareDialog } from "@/components/project/share-dialog";
import { deleteProject, getCurrentUser, listProjects, type ProjectListItem, type ProjectShareOut } from "@/lib/custom-api";

const PAGE_SIZE = 15;

/** The project's kind, from the home entry it was created with. */
const KIND = {
  story: { label: "Solution", icon: Layers, className: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  architecture: { label: "Architecture", icon: Network, className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  workshop: { label: "Workshop", icon: BookOpen, className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
} as const;

function shortEmail(email: string): string {
  return email.split("@")[0] ?? email;
}

function formatDate(dateStr: string): string {
  const iso = dateStr.endsWith("Z") || dateStr.includes("+") || dateStr.includes("-", 10) ? dateStr : dateStr + "Z";
  const date = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

interface ProjectsWorkSectionProps {
  projects: ProjectListItem[];
  sharedProjects: ProjectListItem[];
  invitations: ProjectShareOut[];
  isLoadingProjects: boolean;
  projectsError: string | null;
  onOpenProject: (projectId: string) => void;
  onToggleStar: (e: React.MouseEvent, project: ProjectListItem) => void;
  onCloneShared: (projectId: string) => void;
  cloningId: string | null;
  /** Performs the accept/decline API call, then updates parent state. */
  onInvitationRespond: (projectId: string, accepted: boolean) => Promise<void>;
  /** A project was deleted here: drop it from the parent's lists. */
  onProjectDeleted?: (projectId: string) => void;
  className?: string;
}

type WorkTab = "recent" | "shared" | "invites";

export function ProjectsWorkSection({
  projects,
  sharedProjects,
  invitations,
  isLoadingProjects,
  projectsError,
  onOpenProject,
  onToggleStar,
  onCloneShared,
  cloningId,
  onInvitationRespond,
  onProjectDeleted,
  className,
}: ProjectsWorkSectionProps) {
  const defaultTab: WorkTab =
    invitations.length > 0 ? "invites" : sharedProjects.length > 0 && projects.length === 0 ? "shared" : "recent";
  const [tab, setTab] = useState<WorkTab>(defaultTab);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<ProjectListItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<ProjectListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [me, setMe] = useState<{ email: string; isAdmin: boolean } | null>(null);
  const [allUsers, setAllUsers] = useState(false);
  const [allProjects, setAllProjects] = useState<ProjectListItem[] | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getCurrentUser().then((u) => setMe({ email: u.email, isAdmin: u.is_admin })).catch(() => {});
  }, []);

  // Admin "All users": every project, fetched here (the home call returns only the user's).
  useEffect(() => {
    if (!allUsers || allProjects) return;
    listProjects({ includeAll: true }).then(setAllProjects).catch(() => setAllUsers(false));
  }, [allUsers, allProjects]);

  useEffect(() => setPage(0), [tab, query, allUsers]);

  const recent = useMemo(() => {
    const base = allUsers && allProjects ? allProjects : projects;
    // Starred first, then most recently updated.
    return [...base].sort((a, b) => Number(b.is_starred) - Number(a.is_starred) || +new Date(b.updated_at) - +new Date(a.updated_at));
  }, [allUsers, allProjects, projects]);

  const q = query.trim().toLowerCase();
  const matches = (p: ProjectListItem) =>
    !deletedIds.has(p.id) &&
    (!q || [p.name, p.customer, p.description, p.owner_email].some((v) => v?.toLowerCase().includes(q)));
  const rows = (tab === "recent" ? recent : tab === "shared" ? sharedProjects : []).filter(matches);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (!isLoadingProjects && !projectsError && projects.length === 0 && sharedProjects.length === 0 && invitations.length === 0) {
    return (
      <section className={className}>
        <p className="text-center text-sm text-muted-foreground">No projects yet. Describe a use case above to create your first.</p>
      </section>
    );
  }

  const handleRespond = async (projectId: string, accept: boolean) => {
    setRespondingId(projectId);
    try {
      await onInvitationRespond(projectId, accept);
    } catch (err) {
      console.error("Failed to respond to invitation:", err);
    } finally {
      setRespondingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      await deleteProject(deleteFor.id);
      setDeletedIds((s) => new Set(s).add(deleteFor.id));
      onProjectDeleted?.(deleteFor.id);
      setDeleteFor(null);
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      setDeleting(false);
    }
  };

  const isOwner = (p: ProjectListItem) => !p.shared_role && (!p.owner_email || !me || p.owner_email === me.email || me.isAdmin);

  const list = (empty: string) =>
    isLoadingProjects ? (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      </div>
    ) : projectsError ? (
      <div className="space-y-1 py-8 text-center">
        <p className="text-sm text-destructive">Failed to load projects</p>
        <p className="text-xs text-muted-foreground">{projectsError}</p>
      </div>
    ) : rows.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">{q ? `No project matches “${query.trim()}”.` : empty}</p>
    ) : (
      <>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/60 shadow-sm backdrop-blur-lg">
          {shown.map((p) => {
            const kind = KIND[p.mode ?? "story"] ?? KIND.story;
            const shared = tab === "shared";
            const owner = shared ? p.shared_by || p.owner_email : allUsers && p.owner_email !== me?.email ? p.owner_email : null;
            return (
              <li key={p.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenProject(p.id)}
                  onKeyDown={(e) => (e.key === "Enter" ? onOpenProject(p.id) : undefined)}
                  className="group flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  {!shared ? (
                    <button
                      type="button"
                      aria-label={p.is_starred ? "Unstar" : "Star"}
                      onClick={(e) => { e.stopPropagation(); onToggleStar(e, p); }}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-amber-500"
                    >
                      <Star className={`h-3.5 w-3.5 ${p.is_starred ? "fill-amber-400 text-amber-400" : ""}`} />
                    </button>
                  ) : (
                    <span className="w-[22px] shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.customer, owner && `${shared ? "from" : "by"} ${shortEmail(owner)}`, shared && p.shared_role].filter(Boolean).join(" · ") || p.description || " "}
                    </p>
                  </div>
                  <span className={`hidden w-[104px] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${kind.className}`}>
                    <kind.icon className="h-3 w-3" />
                    {kind.label}
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatDate(p.updated_at)}</span>
                  <div className="flex w-16 shrink-0 justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {shared ? (
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Make a copy" title="Make a copy"
                        disabled={cloningId === p.id} onClick={(e) => { e.stopPropagation(); onCloneShared(p.id); }}>
                        {cloningId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    ) : isOwner(p) ? (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Share" title="Share"
                          onClick={(e) => { e.stopPropagation(); setShareFor(p); }}>
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" aria-label="Delete" title="Delete"
                          onClick={(e) => { e.stopPropagation(); setDeleteFor(p); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {pages > 1 && (
          <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </>
    );

  return (
    <section className={className}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as WorkTab)}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Your work</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Pick up where you left off</p>
          </div>
          <TabsList>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="shared">Shared</TabsTrigger>
            <TabsTrigger value="invites" className="gap-1.5">
              Invites
              {invitations.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {invitations.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {tab !== "invites" && (
          <div className="mb-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, customer or owner"
                aria-label="Search projects"
                className="h-8 w-full rounded-md border border-border bg-background/60 pl-8 pr-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {me?.isAdmin && tab === "recent" && (
              <Button variant={allUsers ? "secondary" : "outline"} size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAllUsers((v) => !v)}>
                {allUsers && !allProjects ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                {allUsers ? "All users" : "Mine"}
              </Button>
            )}
          </div>
        )}

        <TabsContent value="recent" className="mt-0">{list("No projects yet. Describe a use case above to create your first.")}</TabsContent>
        <TabsContent value="shared" className="mt-0">{list("Nothing shared with you yet.")}</TabsContent>

        <TabsContent value="invites" className="mt-0">
          {invitations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{inv.project_name || "A project"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {shortEmail(inv.owner_email)} shared this with you as{" "}
                      <span className="font-medium">{inv.role === "editor" ? "an editor" : "a viewer"}</span>
                      {inv.message ? ` — “${inv.message}”` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="outline" disabled={respondingId === inv.project_id} onClick={() => handleRespond(inv.project_id, false)}>
                      Decline
                    </Button>
                    <Button size="sm" disabled={respondingId === inv.project_id} onClick={() => handleRespond(inv.project_id, true)}>
                      {respondingId === inv.project_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="mr-1 h-3.5 w-3.5" /> Accept</>}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {shareFor && (
        <ShareDialog projectId={shareFor.id} projectName={shareFor.name} open onOpenChange={(o) => !o && setShareFor(null)} />
      )}
      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title="Delete this project?"
        description={deleteFor ? `“${deleteFor.name}” and its files and chat are deleted. Resources it deployed in a workspace stay there.` : ""}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </section>
  );
}

export default ProjectsWorkSection;
