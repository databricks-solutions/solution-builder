/**
 * Templates browsing page for the template library.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Search,
} from "lucide-react";

function TemplatesWithLayout() {
  return <AppLayout><TemplatesPage /></AppLayout>;
}

export const Route = createFileRoute("/templates")({
  // ?template=<slug> deep-links a template's detail slide-over open (shareable +
  // survives reload). The slug is the template id (folder-name; URL-safe).
  validateSearch: (search: Record<string, unknown>): { template?: string } => ({
    template: typeof search.template === "string" ? search.template : undefined,
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

function TemplatesPage() {
  const navigate = useNavigate();
  const { template: templateParam } = Route.useSearch();
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
  // Semantic (pgvector) search over the template summaries. Empty = no search.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRank, setSearchRank] = useState<string[] | null>(null); // ordered template ids, or null

  // Debounced vector search: hit /templates/search, keep the ranked id order.
  // Falls back to text search server-side (PGLite). Clearing the box restores
  // the plain listing.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchRank(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchTemplates(q, 50)
        .then((results) => {
          if (!cancelled) setSearchRank(results.map((r) => r.id));
        })
        .catch((e) => {
          console.error("Template search failed:", e);
          if (!cancelled) setSearchRank(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery]);

  // Apply the search ranking to a template list: keep only matched ids, in
  // rank order. When no search is active, return the list unchanged.
  const applySearch = (list: TemplateListItem[]): TemplateListItem[] => {
    if (searchRank === null) return list;
    const byId = new Map(list.map((t) => [t.id, t]));
    return searchRank.map((id) => byId.get(id)).filter((t): t is TemplateListItem => Boolean(t));
  };

  // Fork a template into a new editable project (as-is — adapt happens post-fork
  // via the "Make this demo yours" band on the project overview).
  const handleFork = async (template: TemplateDetail) => {
    setIsForking(true);
    try {
      const project = await createProjectFromTemplate(template.id, template.name);
      navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    } catch (error) {
      console.error("Failed to fork template:", error);
      toast.error("Failed to fork template");
      setIsForking(false);
    }
  };

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

  // Compute "My Templates" - templates owned by the current user
  const myTemplates = useMemo(() => {
    if (!userEmail) return [];
    return applySearch(templates.filter((t) => t.owner_email === userEmail));
  }, [templates, userEmail, searchRank]);

  // Compute "Sponsored Templates" - all templates excluding the user's own
  const sponsoredTemplates = useMemo(() => {
    const base = userEmail ? templates.filter((t) => t.owner_email !== userEmail) : templates;
    return applySearch(base);
  }, [templates, userEmail, searchRank]);

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

  // Load templates when filters change
  useEffect(() => {
    setIsLoading(true);
    const status = statusFilter === "ALL" ? undefined : statusFilter;
    const industry = industryFilter === "ALL" ? undefined : industryFilter;

    listTemplates(status, industry)
      .then(setTemplates)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [statusFilter, industryFilter]);

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

  const handleDelete = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = templates.find((t) => t.id === templateId)?.name ?? "template";
    if (!confirm("Are you sure you want to delete this template?")) return;

    setActionLoading(templateId);
    try {
      await deleteTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      toast.success(`Deleted "${name}"`);
    } catch (error) {
      console.error("Failed to delete template:", error);
      toast.error("Failed to delete template");
    } finally {
      setActionLoading(null);
    }
  };

  // Filter tabs based on admin status
  const visibleTabs = isAdmin
    ? STATUS_TABS
    : STATUS_TABS.filter((t) => t.value === "APPROVED");

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-background p-6 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
        <div className="flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Library className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Template Library</h1>
            <p className="text-base text-muted-foreground sm:text-lg">
              Vetted solution blueprints for Databricks scenarios.
            </p>
            <p className="text-sm text-muted-foreground/80 sm:text-base">
              Fork one to get your own editable copy — then tell the AI what to change for your customer or industry.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Status tabs (hidden when only one tab visible) */}
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

        {/* Semantic search (pgvector over the template summaries) */}
        <div className="relative w-full sm:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates by meaning — e.g. 'forecast demand', 'churn'…"
            className="w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Industry filter */}
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-[180px] cursor-pointer">
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

        {/* Results count */}
        <span className="text-sm text-muted-foreground ml-auto">
          {searchRank !== null ? `${sponsoredTemplates.length + myTemplates.length} match` : `${sponsoredTemplates.length} sponsored${myTemplates.length > 0 ? `, ${myTemplates.length} mine` : ""}`}
        </span>
      </div>

      {/* My Templates section */}
      {myTemplates.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <User className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">My Templates</h2>
            <Badge variant="secondary" className="text-xs">
              {myTemplates.length}
            </Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
            {myTemplates.map((template) => (
              <div key={template.id} className="relative group h-full">
                <TemplateGalleryTile
                  template={template}
                  onOpen={() => openTemplate(template.id)}
                />

                {/* Owner action buttons */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isAdmin && template.status === "REVIEW_REQUESTED" && (
                    <>
                      <Button
                        size="icon"
                        variant="default"
                        className="h-7 w-7 bg-green-600 hover:bg-green-700"
                        onClick={(e) => handleApprove(template.id, e)}
                        disabled={actionLoading === template.id}
                        aria-label="Approve template"
                        title="Approve template"
                      >
                        {actionLoading === template.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-7 w-7"
                        onClick={(e) => handleReject(template.id, e)}
                        disabled={actionLoading === template.id}
                        aria-label="Reject template"
                        title="Reject template"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <Button
                    size="icon"
                    variant="default"
                    className="h-7 w-7"
                    onClick={(e) => handleEditTemplate(template.id, e)}
                    disabled={actionLoading === template.id}
                    title="Edit template"
                  >
                    {actionLoading === template.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Edit className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-7 w-7"
                    onClick={(e) => handleDelete(template.id, e)}
                    disabled={actionLoading === template.id}
                    title="Delete template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-b border-border mt-8" />
        </div>
      )}

      {/* Sponsored Templates grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sponsoredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Library className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No templates found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {statusFilter === "APPROVED"
              ? "No approved templates match your filters."
              : "No templates match your current filters."}
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Library className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Databricks Sponsored Templates</h2>
            <Badge variant="secondary" className="text-xs">
              {sponsoredTemplates.length}
            </Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
            {sponsoredTemplates.map((template) => (
              <div key={template.id} className="relative group h-full">
                <TemplateGalleryTile
                  template={template}
                  onOpen={() => openTemplate(template.id)}
                />

                {/* Admin actions overlay */}
                {isAdmin && template.status !== "APPROVED" && (
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {template.status === "REVIEW_REQUESTED" && (
                      <>
                        <Button
                          size="icon"
                          variant="default"
                          className="h-7 w-7 bg-green-600 hover:bg-green-700"
                          onClick={(e) => handleApprove(template.id, e)}
                          disabled={actionLoading === template.id}
                          aria-label="Approve template"
                          title="Approve template"
                        >
                          {actionLoading === template.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="destructive"
                          className="h-7 w-7"
                          onClick={(e) => handleReject(template.id, e)}
                          disabled={actionLoading === template.id}
                          aria-label="Reject template"
                          title="Reject template"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={(e) => handleDelete(template.id, e)}
                      disabled={actionLoading === template.id}
                      aria-label="Delete template"
                      title="Delete template"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template detail slide-over */}
      <TemplateGallerySheet
        templateId={selectedTemplateId}
        onClose={() => openTemplate(null)}
        onFork={handleFork}
      />

      {/* Full-screen forking overlay */}
      {isForking && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-semibold">Forking template…</p>
            <p className="text-sm text-muted-foreground">Setting up your editable copy</p>
          </div>
        </div>
      )}
    </div>
  );
}
