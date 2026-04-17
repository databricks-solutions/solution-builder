/**
 * Templates browsing page for the template library.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
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
import { TemplateTile } from "@/components/template/template-tile";
import { TemplateDetailPopup } from "@/components/template/template-detail-popup";
import {
  listTemplates,
  getIndustries,
  getCurrentUser,
  updateTemplateStatus,
  deleteTemplate,
  openTemplateProject,
  type TemplateListItem,
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
} from "lucide-react";

function TemplatesWithLayout() {
  return <AppLayout><TemplatesPage /></AppLayout>;
}

export const Route = createFileRoute("/templates")({
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
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("APPROVED");
  const [industryFilter, setIndustryFilter] = useState<string>("ALL");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
    return templates.filter((t) => t.owner_email === userEmail);
  }, [templates, userEmail]);

  // Compute "Sponsored Templates" - all templates excluding the user's own
  const sponsoredTemplates = useMemo(() => {
    if (!userEmail) return templates;
    return templates.filter((t) => t.owner_email !== userEmail);
  }, [templates, userEmail]);

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
    setActionLoading(templateId);
    try {
      await updateTemplateStatus(templateId, "APPROVED");
      const status = statusFilter === "ALL" ? undefined : statusFilter;
      const industry = industryFilter === "ALL" ? undefined : industryFilter;
      const updated = await listTemplates(status, industry);
      setTemplates(updated);
    } catch (error) {
      console.error("Failed to approve template:", error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(templateId);
    try {
      await updateTemplateStatus(templateId, "REJECTED");
      const status = statusFilter === "ALL" ? undefined : statusFilter;
      const industry = industryFilter === "ALL" ? undefined : industryFilter;
      const updated = await listTemplates(status, industry);
      setTemplates(updated);
    } catch (error) {
      console.error("Failed to reject template:", error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this template?")) return;

    setActionLoading(templateId);
    try {
      await deleteTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (error) {
      console.error("Failed to delete template:", error);
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
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Library className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Template Library</h1>
          <p className="text-sm text-muted-foreground">
            Browse and use pre-built demo templates
          </p>
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

        {/* Industry filter */}
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-[180px]">
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
          {sponsoredTemplates.length} sponsored{myTemplates.length > 0 ? `, ${myTemplates.length} mine` : ""}
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
                <TemplateTile
                  template={template}
                  onClick={() => setSelectedTemplateId(template.id)}
                  showStatus={true}
                />

                {/* Owner action buttons */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                <TemplateTile
                  template={template}
                  onClick={() => setSelectedTemplateId(template.id)}
                  showStatus={isAdmin && statusFilter === "ALL"}
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

      {/* Template detail popup */}
      <TemplateDetailPopup
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
