/**
 * Templates browsing page for the template library.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Navbar from "@/components/apx/navbar";
import { TemplateTile } from "@/components/template/template-tile";
import { TemplateDetailPopup } from "@/components/template/template-detail-popup";
import {
  listTemplates,
  getIndustries,
  getTemplateAdminStatus,
  updateTemplateStatus,
  deleteTemplate,
  type TemplateListItem,
} from "@/lib/custom-api";
import {
  Library,
  Loader2,
  ArrowLeft,
  Check,
  X,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/templates")(({
  component: TemplatesPage,
}));

type StatusFilter = "ALL" | "APPROVED" | "REVIEW_REQUESTED" | "REJECTED";

const STATUS_TABS: { value: StatusFilter; label: string; icon: React.ReactNode }[] = [
  { value: "ALL", label: "All", icon: null },
  { value: "APPROVED", label: "Approved", icon: <CheckCircle className="h-3.5 w-3.5" /> },
  { value: "REVIEW_REQUESTED", label: "Pending Review", icon: <Clock className="h-3.5 w-3.5" /> },
  { value: "REJECTED", label: "Rejected", icon: <XCircle className="h-3.5 w-3.5" /> },
];

function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("APPROVED");
  const [industryFilter, setIndustryFilter] = useState<string>("ALL");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    Promise.all([
      getIndustries(),
      getTemplateAdminStatus(),
    ]).then(([industriesData, adminStatus]) => {
      setIndustries(industriesData);
      setIsAdmin(adminStatus.is_admin);
      // Non-admins default to APPROVED, admins default to ALL
      if (!adminStatus.is_admin) {
        setStatusFilter("APPROVED");
      } else {
        setStatusFilter("ALL");
      }
    }).catch(console.error);
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

  // Admin actions
  const handleApprove = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(templateId);
    try {
      await updateTemplateStatus(templateId, "APPROVED");
      // Refresh templates
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
      // Refresh templates
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return <Badge variant="default" className="bg-green-600">Approved</Badge>;
      case "REVIEW_REQUESTED":
        return <Badge variant="secondary">Pending Review</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Filter tabs based on admin status
  const visibleTabs = isAdmin
    ? STATUS_TABS
    : STATUS_TABS.filter((t) => t.value === "APPROVED");

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-8">
            <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
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
          </div>

          {/* Filters */}
          <div className="mb-6 flex flex-wrap items-center gap-4">
            {/* Status tabs */}
            <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.value}
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
              {templates.length} template{templates.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Templates grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
              {templates.map((template) => (
                <div key={template.id} className="relative group h-full">
                  <TemplateTile
                    template={template}
                    onClick={() => setSelectedTemplateId(template.id)}
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
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}

                  {/* Status badge for admin view */}
                  {isAdmin && statusFilter === "ALL" && (
                    <div className="absolute top-2 left-2">
                      {getStatusBadge(template.status)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Template detail popup */}
      <TemplateDetailPopup
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
