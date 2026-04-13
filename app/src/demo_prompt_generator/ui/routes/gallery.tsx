/**
 * Template Gallery page — nested under the _app pathless layout route.
 * Provides browsable, filterable grid of templates with admin actions.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TemplateTile } from "@/components/template/template-tile";
import { TemplateDetailPopup } from "@/components/template/template-detail-popup";
import { AppLayout } from "@/components/layout/app-layout";
import {
  listTemplates,
  getIndustries,
  getCurrentUser,
  updateTemplateStatus,
  deleteTemplate,
  type TemplateListItem,
  type CurrentUser,
} from "@/lib/custom-api";
import {
  Library,
  Filter,
  Loader2,
  Check,
  X,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";

function GalleryWithLayout() {
  return <AppLayout><GalleryPage /></AppLayout>;
}

export const Route = createFileRoute("/gallery")({
  component: GalleryWithLayout,
});

type StatusFilter = "ALL" | "APPROVED" | "REVIEW_REQUESTED" | "REJECTED";

const STATUS_TABS: {
  value: StatusFilter;
  label: string;
  icon: React.ReactNode;
  adminOnly: boolean;
}[] = [
  { value: "ALL", label: "All", icon: null, adminOnly: false },
  {
    value: "APPROVED",
    label: "Approved",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    adminOnly: false,
  },
  {
    value: "REVIEW_REQUESTED",
    label: "Pending Review",
    icon: <Clock className="h-3.5 w-3.5" />,
    adminOnly: true,
  },
  {
    value: "REJECTED",
    label: "Rejected",
    icon: <XCircle className="h-3.5 w-3.5" />,
    adminOnly: true,
  },
];

function GalleryPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("APPROVED");
  const [industryFilter, setIndustryFilter] = useState<string>("ALL");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isAdmin = user?.is_template_admin ?? false;

  // Load user and industries on mount
  useEffect(() => {
    Promise.all([getIndustries(), getCurrentUser()])
      .then(([industriesData, userData]) => {
        setIndustries(industriesData);
        setUser(userData);
        // Admins default to "ALL" so they see pending items; others see approved
        if (userData.is_template_admin) {
          setStatusFilter("ALL");
        }
      })
      .catch(console.error);
  }, []);

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

  // Refresh the current template list with the active filters
  const refreshTemplates = async () => {
    const status = statusFilter === "ALL" ? undefined : statusFilter;
    const industry = industryFilter === "ALL" ? undefined : industryFilter;
    const updated = await listTemplates(status, industry);
    setTemplates(updated);
  };

  // Admin actions
  const handleApprove = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(templateId);
    try {
      await updateTemplateStatus(templateId, "APPROVED");
      await refreshTemplates();
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
      await refreshTemplates();
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

  // Filter visible status tabs based on admin role
  const visibleTabs = STATUS_TABS.filter(
    (tab) => !tab.adminOnly || isAdmin
  );

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Library className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Template Gallery</h1>
              <p className="text-sm text-muted-foreground">
                Browse, preview, and customize pre-built demo templates
              </p>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          {/* Status filter tabs */}
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

          {/* Industry dropdown filter */}
          <Select value={industryFilter} onValueChange={setIndustryFilter}>
            <SelectTrigger className="w-[200px]">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="All Industries" />
              </div>
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
          <span className="ml-auto text-sm text-muted-foreground">
            {templates.length} template{templates.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Template grid / loading / empty states */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Loading templates...
            </p>
          </div>
        ) : templates.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Library className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No templates found</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                {statusFilter === "APPROVED"
                  ? "No approved templates match your filters. Try changing the industry or check back later."
                  : "No templates match your current filters."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
            {templates.map((template) => (
              <div key={template.id} className="relative group h-full">
                <TemplateTile
                  template={template}
                  showStatus={isAdmin && statusFilter === "ALL"}
                  onClick={() => setSelectedTemplateId(template.id)}
                />

                {/* Admin action buttons on hover */}
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
        )}
      </div>

      {/* Template detail popup */}
      <TemplateDetailPopup
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
