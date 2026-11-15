/**
 * Templates browsing page for the template library.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppLayout } from "@/components/layout/app-layout";
import { TemplateGalleryTile } from "@/components/template/gallery/template-gallery-tile";
import { TemplateGallerySheet } from "@/components/template/gallery/template-gallery-sheet";
import {
  listTemplates,
  searchTemplates,
  getIndustries,
  getCurrentUser,
  updateTemplateStatus,
  setTemplateOfficial,
  deleteTemplate,
  openTemplateProject,
  createProjectFromTemplate,
  type TemplateListItem,
  type TemplateDetail,
} from "@/lib/custom-api";
import {
  Library,
  Loader2,
  Check,
  X,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  Edit,
  User,
  Users,
  Search,
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

function TemplatesWithLayout() {
  return <AppLayout><TemplatesPage /></AppLayout>;
}

export const Route = createFileRoute("/templates")({
  // ?template=<slug> deep-links a template's detail slide-over open (shareable +
  // survives reload). The slug is the template id (folder-name; URL-safe).
  // ?type=<TYPE> (optional) filters the gallery to one kind (e.g. WORKSHOP) —
  // used for a workshop-only landing link; unset = all types.
  validateSearch: (search: Record<string, unknown>): { template?: string; type?: string } => ({
    template: typeof search.template === "string" ? search.template : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
  }),
  component: TemplatesWithLayout,
});

type StatusFilter = "ALL" | "APPROVED" | "REVIEW_REQUESTED" | "REJECTED";

const STATUS_TABS: { value: StatusFilter; label: string; icon: React.ReactNode }[] = [
  { value: "ALL", label: "All", icon: null },
  { value: "APPROVED", label: "Approved", icon: <CheckCircle className="h-3.5 w-3.5" /> },
  { value: "REJECTED", label: "Rejected", icon: <XCircle className="h-3.5 w-3.5" /> },
  { value: "REVIEW_REQUESTED", label: "Pending Review", icon: <Clock className="h-3.5 w-3.5" /> },
];

// Cosmetic reassurance labels shown (in sequence) while a fork runs. Not real
// telemetry — createProjectFromTemplate is a single request.
const FORK_STEPS = [
  "Creating your project…",
  "Copying the demo files…",
  "Setting up your workspace…",
];

function TemplatesPage() {
  const navigate = useNavigate();
  const { template: templateParam, type: typeParam } = Route.useSearch();
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("APPROVED");
  const [industryFilter, setIndustryFilter] = useState<string>("ALL");
  // The open template's slug is driven by the URL (?template=<slug>) so it's
  // deep-linkable + shareable. openTemplate() writes the param; the sheet's
  // onClose clears it.
  const selectedTemplateId = templateParam ?? null;
  const openTemplate = (id: string | null) =>
    navigate({ to: "/templates", search: (prev) => ({ ...prev, template: id ?? undefined }), replace: true });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isForking, setIsForking] = useState(false);
  // Template pending a delete-confirmation popup (tile quick-delete). null = closed.
  const [pendingDelete, setPendingDelete] = useState<TemplateListItem | null>(null);
  // Semantic (pgvector) search over the template summaries. Empty = no search.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRank, setSearchRank] = useState<string[] | null>(null); // ordered template ids, or null
  const [isSearching, setIsSearching] = useState(false); // a search request is in flight
  const [searchFocused, setSearchFocused] = useState(false); // widen the box while focused
  // Cosmetic staged-label index for the fork overlay (createProjectFromTemplate
  // is a single request, so this is reassurance, not real progress).
  const [forkStep, setForkStep] = useState(0);
  // Section keys that are collapsed (empty map = everything expanded). Toggled
  // from each section's header.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) =>
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  // Id of the tile whose "Manage" advanced-controls panel is expanded (only one
  // open at a time — opening another closes the previous).
  const [manageOpen, setManageOpen] = useState<string | null>(null);

  // Debounced vector search: hit /templates/search, keep the ranked id order.
  // Falls back to text search server-side (PGLite). Clearing the box restores
  // the plain listing.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchRank(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const t = setTimeout(() => {
      searchTemplates(q, 50)
        .then((results) => {
          if (!cancelled) setSearchRank(results.map((r) => r.id));
        })
        .catch((e) => {
          console.error("Template search failed:", e);
          if (!cancelled) setSearchRank(null);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery]);

  // Advance the fork overlay's cosmetic step labels while a fork is running.
  useEffect(() => {
    if (!isForking) {
      setForkStep(0);
      return;
    }
    const id = setInterval(() => setForkStep((s) => Math.min(s + 1, FORK_STEPS.length - 1)), 1100);
    return () => clearInterval(id);
  }, [isForking]);

  // Apply the SERVER search ranking to a template list: keep only matched ids,
  // in rank order. When no search is active, return the list unchanged. Used for
  // the public browse sections (Sponsored / Community), which are APPROVED-only
  // — the same status the /templates/search endpoint ranks over.
  const applySearch = (list: TemplateListItem[]): TemplateListItem[] => {
    if (searchRank === null) return list;
    const byId = new Map(list.map((t) => [t.id, t]));
    return searchRank.map((id) => byId.get(id)).filter((t): t is TemplateListItem => Boolean(t));
  };

  // Local substring filter — used for sections that can contain NON-approved
  // templates (My Templates, and the admin Pending/Rejected review grids). The
  // server search only ranks APPROVED ids, so intersecting those sections with
  // `searchRank` would always yield nothing (pending ∩ approved = ∅) and hide
  // matching pending/rejected entries. A local match keeps them searchable.
  const localSearch = (list: TemplateListItem[]): TemplateListItem[] => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      [t.name, t.description ?? "", t.industry ?? "", ...(t.capabilities ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  };

  // Fork a template into a new editable project (as-is — adapt happens post-fork
  // via the "Make this demo yours" band on the project overview). Shared by the
  // detail-sheet fork button and the tile's primary "Use template" action.
  const forkInto = async (id: string, name: string) => {
    setIsForking(true);
    try {
      const project = await createProjectFromTemplate(id, name);
      navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    } catch (error) {
      console.error("Failed to fork template:", error);
      toast.error("Failed to use template");
      setIsForking(false);
    }
  };
  const handleFork = (template: TemplateDetail) => forkInto(template.id, template.name);
  const handleUseTemplate = (template: TemplateListItem) => forkInto(template.id, template.name);

  // Load initial data
  useEffect(() => {
    Promise.all([
      getIndustries(),
      getCurrentUser(),
    ]).then(([industriesData, user]) => {
      setIndustries(industriesData);
      setIsAdmin(user.is_template_admin);
      setUserEmail(user.email);
      // Non-admins default to APPROVED, admins default to ALL
      if (!user.is_template_admin) {
        setStatusFilter("APPROVED");
      } else {
        setStatusFilter("ALL");
      }
    }).catch(console.error);
  }, []);

  // Compute "My Templates" - templates owned by the current user (any status,
  // so local text search — not the approved-only server rank — is applied).
  const myTemplates = useMemo(() => {
    if (!userEmail) return [];
    return localSearch(templates.filter((t) => t.owner_email === userEmail));
  }, [templates, userEmail, searchQuery]);

  // "Databricks Sponsored" = curated (`official`) templates, and ONLY those.
  // Gated to APPROVED (official ones always are) and excluding the user's own
  // (those live under "My Templates"). This is the fix: the old code put EVERY
  // not-mine template — community submissions AND, for admins under the ALL
  // filter, not-yet-approved ones — under this heading, so nothing was
  // differentiated from a real Databricks-sponsored demo.
  const sponsoredTemplates = useMemo(
    () =>
      applySearch(
        templates.filter(
          (t) =>
            t.official === true &&
            t.status === "APPROVED" &&
            (!userEmail || t.owner_email !== userEmail),
        ),
      ),
    [templates, userEmail, searchRank],
  );

  // "Community Templates" = APPROVED, NON-official templates authored by other
  // users. Broadly browseable, but clearly separated from sponsored ones.
  const communityTemplates = useMemo(
    () =>
      applySearch(
        templates.filter(
          (t) =>
            t.official !== true &&
            t.status === "APPROVED" &&
            (!userEmail || t.owner_email !== userEmail),
        ),
      ),
    [templates, userEmail, searchRank],
  );

  // Admin review surface: the Pending Review / Rejected tabs render a single
  // flat grid of exactly that status. Because the public Sponsored/Community
  // sections are gated to APPROVED, not-yet-approved templates NEVER leak into
  // the browse view — they're only reachable here.
  const isReviewFilter =
    statusFilter === "REVIEW_REQUESTED" || statusFilter === "REJECTED";
  const reviewTemplates = useMemo(
    () => localSearch(templates.filter((t) => t.status === statusFilter)),
    [templates, statusFilter, searchQuery],
  );

  // Edit template handler - opens the source project
  const handleEditTemplate = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(templateId);
    try {
      const project = await openTemplateProject(templateId);
      navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    } catch (error) {
      console.error("Failed to open template project:", error);
    } finally {
      setActionLoading(null);
    }
  };

  // Load templates when filters change. An optional ?type= URL param scopes the
  // gallery to one kind (e.g. WORKSHOP); unset = all types.
  useEffect(() => {
    setIsLoading(true);
    const status = statusFilter === "ALL" ? undefined : statusFilter;
    const industry = industryFilter === "ALL" ? undefined : industryFilter;

    listTemplates(status, industry, typeParam)
      .then(setTemplates)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [statusFilter, industryFilter, typeParam]);

  // Admin actions
  const handleApprove = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = templates.find((t) => t.id === templateId)?.name ?? "template";
    setActionLoading(templateId);
    try {
      await updateTemplateStatus(templateId, "APPROVED");
      const status = statusFilter === "ALL" ? undefined : statusFilter;
      const industry = industryFilter === "ALL" ? undefined : industryFilter;
      const updated = await listTemplates(status, industry);
      setTemplates(updated);
      toast.success(`Approved "${name}"`);
    } catch (error) {
      console.error("Failed to approve template:", error);
      toast.error("Failed to approve template");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = templates.find((t) => t.id === templateId)?.name ?? "template";
    setActionLoading(templateId);
    try {
      await updateTemplateStatus(templateId, "REJECTED");
      const status = statusFilter === "ALL" ? undefined : statusFilter;
      const industry = industryFilter === "ALL" ? undefined : industryFilter;
      const updated = await listTemplates(status, industry);
      setTemplates(updated);
      toast.success(`Rejected "${name}"`);
    } catch (error) {
      console.error("Failed to reject template:", error);
      toast.error("Failed to reject template");
    } finally {
      setActionLoading(null);
    }
  };

  // Tile quick-delete: open the confirmation popup (actual delete in confirmDelete).
  const handleDelete = (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const template = templates.find((t) => t.id === templateId) ?? null;
    setPendingDelete(template);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id, name } = pendingDelete;
    setActionLoading(id);
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success(`Deleted "${name}"`);
      setPendingDelete(null);
    } catch (error) {
      console.error("Failed to delete template:", error);
      toast.error("Failed to delete template");
    } finally {
      setActionLoading(null);
    }
  };

  // Reload the current listing (respecting the active filters).
  const reloadTemplates = async () => {
    const status = statusFilter === "ALL" ? undefined : statusFilter;
    const industry = industryFilter === "ALL" ? undefined : industryFilter;
    setTemplates(await listTemplates(status, industry));
  };

  // Sheet admin handlers (no MouseEvent — the sheet owns its own busy state and
  // surfaces errors; here we just call the API + refresh the list).
  const handleSheetStatusChange = async (id: string, status: "APPROVED" | "REJECTED") => {
    const name = templates.find((t) => t.id === id)?.name ?? "template";
    await updateTemplateStatus(id, status);
    await reloadTemplates();
    toast.success(`${status === "APPROVED" ? "Approved" : "Rejected"} "${name}"`);
  };

  const handleSheetToggleOfficial = async (id: string, official: boolean) => {
    const name = templates.find((t) => t.id === id)?.name ?? "template";
    await setTemplateOfficial(id, official);
    await reloadTemplates();
    toast.success(official ? `Featured "${name}"` : `Removed featured from "${name}"`);
  };

  const handleSheetDelete = async (id: string) => {
    const name = templates.find((t) => t.id === id)?.name ?? "template";
    await deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    toast.success(`Deleted "${name}"`);
  };

  // Feature / un-feature a template (toggle `official`) from a tile's advanced
  // controls — lets an admin promote a Community template to Databricks
  // Sponsored (or demote one) right in the gallery. Admin-only (server enforces).
  const handleToggleOfficialTile = async (templateId: string, next: boolean) => {
    const name = templates.find((t) => t.id === templateId)?.name ?? "template";
    setActionLoading(templateId);
    try {
      await setTemplateOfficial(templateId, next);
      await reloadTemplates();
      toast.success(next ? `Featured "${name}"` : `Unfeatured "${name}"`);
    } catch (error) {
      console.error("Failed to toggle featured status:", error);
      toast.error("Failed to update featured status");
    } finally {
      setActionLoading(null);
    }
  };

  // Filter tabs based on admin status
  const visibleTabs = isAdmin
    ? STATUS_TABS
    : STATUS_TABS.filter((t) => t.value === "APPROVED");

  // One gallery tile + its "Manage" advanced-controls panel, shared by every
  // section. Rather than always-on hover icons, admin/owner actions live behind
  // a deliberate Manage button (bottom-right) that expands a labeled panel
  // UPWARD, grouped as a workflow:
  //   • Review — Approve / Reject   (admin, pending only)
  //   • Curate — Feature / Unfeature (admin — promote to/from Sponsored)
  //   • Manage — Edit (owner) / Delete (owner or admin)
  const renderTile = (template: TemplateListItem) => {
    const owner = !!userEmail && template.owner_email === userEmail;
    const pending = template.status === "REVIEW_REQUESTED";
    const official = template.official === true;
    const busy = actionLoading === template.id;
    const open = manageOpen === template.id;
    const canManage = isAdmin || owner;

    return (
      <div key={template.id} className="relative group h-full">
        <TemplateGalleryTile
          template={template}
          onOpen={() => openTemplate(template.id)}
          onUse={handleUseTemplate}
        />

        {canManage && (
          <>
            {/* Advanced-controls panel — anchored to the bottom, expands upward. */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "absolute inset-x-2 bottom-12 z-20 origin-bottom rounded-lg border bg-popover/95 p-2.5 shadow-xl backdrop-blur transition-all duration-150",
                open
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-2 opacity-0",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Advanced controls
                </span>
                <button
                  type="button"
                  onClick={() => setManageOpen(null)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close controls"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {isAdmin && pending && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Review
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 flex-1 gap-1 bg-green-600 text-xs hover:bg-green-700"
                      onClick={(e) => handleApprove(template.id, e)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 flex-1 gap-1 text-xs"
                      onClick={(e) => handleReject(template.id, e)}
                      disabled={busy}
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Curate
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-full gap-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleOfficialTile(template.id, !official);
                    }}
                    disabled={busy}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {official ? "Remove Featured" : "Mark as Featured"}
                  </Button>
                </div>
              )}

              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Manage
                </p>
                <div className="flex gap-1.5">
                  {owner && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 flex-1 gap-1 text-xs"
                      onClick={(e) => handleEditTemplate(template.id, e)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Edit className="h-3.5 w-3.5" />}
                      Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 gap-1 text-xs text-destructive hover:text-destructive"
                    onClick={(e) => handleDelete(template.id, e)}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>

            {/* Manage toggle (bottom-right). Shows on hover, or stays while open. */}
            <Button
              size="sm"
              variant={open ? "default" : "secondary"}
              className={cn(
                "absolute bottom-2 right-2 z-30 h-8 gap-1 text-xs shadow-sm transition-opacity",
                open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setManageOpen(open ? null : template.id);
              }}
              aria-expanded={open}
              title="Advanced controls"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Manage
              <ChevronUp className={cn("h-3.5 w-3.5 transition-transform", open ? "" : "rotate-180")} />
            </Button>

            {/* Attention dot: an admin has something to review here (collapsed). */}
            {isAdmin && pending && !open && (
              <span className="pointer-events-none absolute left-2 top-2 z-10 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  // A collapsible titled section: a header button (chevron + icon + heading +
  // count) toggles the tile grid open/closed. Rendered once per bucket (mine /
  // sponsored / community / review).
  const renderSection = (
    key: string,
    icon: React.ReactNode,
    title: string,
    list: TemplateListItem[],
    subtitle?: string,
  ) => {
    const collapsed = !!collapsedSections[key];
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={!collapsed}
          className="mb-4 flex w-full items-start gap-2 rounded-md text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              collapsed && "-rotate-90",
            )}
          />
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span className="flex flex-col">
            <span className="flex items-center gap-2">
              <h2 className="text-lg font-semibold leading-none">{title}</h2>
              <Badge variant="secondary" className="text-xs">{list.length}</Badge>
            </span>
            {subtitle && (
              <span className="mt-1 text-xs text-muted-foreground">{subtitle}</span>
            )}
          </span>
        </button>
        {!collapsed && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
            {list.map(renderTile)}
          </div>
        )}
      </div>
    );
  };

  const browseEmpty =
    myTemplates.length + sponsoredTemplates.length + communityTemplates.length === 0;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header — compact and calm; the grid is what matters. */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Template Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fork a vetted Databricks solution blueprint, then tell the AI what to change for your customer or industry.
        </p>
      </div>

      {/* Toolbar: a modest search + filters on one clean, wrapping row. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search (semantic, debounced). Widens while focused, shrinks on blur. */}
          <div
            className={cn(
              "relative min-w-[200px] flex-1 transition-[max-width] duration-200 ease-out",
              searchFocused ? "sm:max-w-lg" : "sm:max-w-xs",
            )}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search templates…"
              className="w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/30"
            />
            {isSearching ? (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Status tabs (admin only; hidden when just one tab is visible) */}
          {visibleTabs.length > 1 && (
            <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Template status filter">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.value}
                  role="tab"
                  aria-selected={statusFilter === tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === tab.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Industry filter */}
          <Select value={industryFilter} onValueChange={setIndustryFilter}>
            <SelectTrigger className="w-[170px] cursor-pointer">
              <SelectValue placeholder="All Industries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Industries</SelectItem>
              {industries.map((industry) => (
                <SelectItem key={industry} value={industry}>
                  {industry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Plain result count. */}
          <span className="ml-auto text-sm text-muted-foreground">
            {isReviewFilter
              ? `${reviewTemplates.length} ${statusFilter === "REVIEW_REQUESTED" ? "pending" : "rejected"}`
              : (() => {
                  const n = sponsoredTemplates.length + communityTemplates.length + myTemplates.length;
                  return `${n} template${n === 1 ? "" : "s"}`;
                })()}
          </span>
        </div>

        {/* Active-search feedback + a quick way back to browse. */}
        {searchRank !== null && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing matches for{" "}
              <span className="font-medium text-foreground">"{searchQuery.trim()}"</span>
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}
      </div>

      {/* Sections. Two layouts:
          • Review tabs (admin: Pending Review / Rejected) → one flat grid of
            exactly that status — the ONLY place not-yet-approved templates show.
          • Browse (All / Approved) → up to three gated sections: the user's own
            (any status), Databricks Sponsored (official + approved), and
            Community (approved, non-official). */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isReviewFilter ? (
        reviewTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Library className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">
              {statusFilter === "REVIEW_REQUESTED" ? "Nothing awaiting review" : "No rejected templates"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {statusFilter === "REVIEW_REQUESTED"
                ? "Submitted templates awaiting approval will appear here."
                : "Rejected templates will appear here."}
            </p>
          </div>
        ) : (
          renderSection(
            `review-${statusFilter}`,
            statusFilter === "REVIEW_REQUESTED" ? (
              <Clock className="h-5 w-5 text-amber-500" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            ),
            statusFilter === "REVIEW_REQUESTED" ? "Pending Review" : "Rejected",
            reviewTemplates,
          )
        )
      ) : browseEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Library className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No templates found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            No approved templates match your filters.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {myTemplates.length > 0 &&
            renderSection("mine", <User className="h-5 w-5 text-primary" />, "My Templates", myTemplates)}
          {sponsoredTemplates.length > 0 &&
            renderSection(
              "sponsored",
              <Library className="h-5 w-5 text-primary" />,
              "Databricks Sponsored",
              sponsoredTemplates,
            )}
          {communityTemplates.length > 0 &&
            renderSection(
              "community",
              <Users className="h-5 w-5 text-muted-foreground" />,
              "Community Templates",
              communityTemplates,
            )}
        </div>
      )}

      {/* Template detail slide-over */}
      <TemplateGallerySheet
        templateId={selectedTemplateId}
        onClose={() => openTemplate(null)}
        onFork={handleFork}
        workshopDownloadOnly={typeParam === "WORKSHOP"}
        isAdmin={isAdmin}
        onStatusChange={handleSheetStatusChange}
        onToggleOfficial={handleSheetToggleOfficial}
        onDelete={handleSheetDelete}
      />

      {/* Tile quick-delete confirmation popup */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o && actionLoading === null) setPendingDelete(null); }}
        title="Delete this template?"
        description={
          <>
            <span className="font-medium text-foreground">{pendingDelete?.name}</span> and
            all its files will be permanently removed. This can't be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={pendingDelete !== null && actionLoading === pendingDelete.id}
        onConfirm={confirmDelete}
      />

      {/* Full-screen forking overlay — a reassuring, branded wait. The step
          labels are cosmetic (a single request runs underneath) and advance on
          a timer; the overlay clears when we navigate to the new project. */}
      {isForking && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="relative flex w-[min(90vw,380px)] flex-col items-center gap-4 overflow-hidden rounded-2xl border border-border/60 bg-card p-8 shadow-2xl">
            {/* Soft shimmer sweep behind the content. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-primary/5 to-transparent"
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-lg font-semibold">Setting up your copy</p>
              <p className="min-h-[1.25rem] text-sm text-muted-foreground transition-all">
                {FORK_STEPS[forkStep]}
              </p>
            </div>
            {/* Step progress dots. */}
            <div className="flex items-center gap-1.5">
              {FORK_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i <= forkStep ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
