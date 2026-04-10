import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/layout/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import { ProjectTile } from "@/components/project/project-tile";
import { TemplateTile } from "@/components/template/template-tile";
import { TemplateDetailPopup } from "@/components/template/template-detail-popup";
import { ProductSelector } from "@/components/product-selector";
import { assetUrl } from "@/lib/config";
import {
  Sparkles,
  ArrowRight,
  Search,
  Lightbulb,
  Loader2,
  Library,
  FolderOpen,
} from "lucide-react";
import {
  listProjects,
  createProject,
  searchTemplates,
  getConfigStatus,
  type ProjectListItem,
  type TemplateSearchResult,
} from "@/lib/custom-api";
import { getCapabilities, type Capability } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: Index,
  beforeLoad: async () => {
    try {
      const status = await getConfigStatus();
      if (!status.is_configured) {
        throw redirect({ to: "/setup" });
      }
    } catch (error) {
      // If it's a redirect, re-throw it
      if (error instanceof Error && "to" in error) {
        throw error;
      }
      // On error (e.g., backend down), don't redirect - let the page handle it
      console.warn("Failed to check config status:", error);
    }
  },
});

// Default selected capabilities
const DEFAULT_SELECTED_PRODUCTS = [
  "lakeflow-connect",    // Ingestion
  "sdp",                 // Processing
  "databricks-sql",      // Analytics
  "dashboards",          // Analytics
  "genie",               // NL Queries
  "supervisor-agent",    // AI Agents (MAS)
  "knowledge-assistant", // AI Agents (KA)
];

function Index() {
  const [topic, setTopic] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set(DEFAULT_SELECTED_PRODUCTS)
  );
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Template search state
  const [matchingTemplates, setMatchingTemplates] = useState<TemplateSearchResult[]>([]);
  const [isSearchingTemplates, setIsSearchingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200; // Max height in pixels
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, []);

  // Toggle product selection
  const handleToggleProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  // Load projects and capabilities on mount
  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setIsLoadingProjects(false));

    getCapabilities()
      .then((result) => setCapabilities(result.data))
      .catch(() => {});
  }, []);

  // Debounced template search (500ms)
  useEffect(() => {
    if (topic.trim().length < 3) {
      setMatchingTemplates([]);
      return;
    }

    setIsSearchingTemplates(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchTemplates(topic.trim(), 3);
        setMatchingTemplates(results);
      } catch {
        setMatchingTemplates([]);
      } finally {
        setIsSearchingTemplates(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [topic]);

  // Create new project and navigate
  const handleCreateProject = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const fullTopic = topic.trim() || "Untitled Project";
    if (isCreating) return;

    setIsCreating(true);
    try {
      // Build description with full topic and selected products
      let description = fullTopic;
      if (selectedProducts.size > 0) {
        description += `\n\nSelected capabilities: ${Array.from(selectedProducts).join(", ")}`;
      }
      // Backend will generate name and schema from description using LLM
      const project = await createProject(description);

      // Build the initial prompt message with full user description
      const selectedProductNames = capabilities
        .filter(cap => selectedProducts.has(cap.id))
        .map(cap => cap.name);

      let initialPrompt = `Help me build a databricks demo.\n\nDemo description:\n${fullTopic}\n\nSkip templates.`;
      if (selectedProductNames.length > 0) {
        initialPrompt += `\n\nCapabilities to showcase: ${selectedProductNames.join(", ")}`;
      }

      navigate({
        to: "/project/$projectId",
        params: { projectId: project.id },
        search: { prompt: initialPrompt },
      });
    } catch (error) {
      console.error("Failed to create project:", error);
      setIsCreating(false);
    }
  };

  // Open existing project
  const handleOpenProject = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId }, search: { prompt: undefined } });
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Navbar />
      <main className="flex flex-1 flex-col items-center px-4 pt-12 pb-20">
        <BubbleBackground
          interactive
          className="!absolute inset-0 -z-10 opacity-30"
          colors={{
            first: "255,54,33",
            second: "255,120,80",
            third: "255,85,50",
            fourth: "200,40,25",
            fifth: "255,160,100",
            sixth: "255,100,60",
          }}
        />

        {/* Hero */}
        <div className="relative z-10 mx-auto max-w-4xl space-y-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm border border-primary/20">
              <img src={assetUrl("/logo.svg")} alt="Databricks" className="h-10 w-10" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Databricks
              </p>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                Asset Generator
              </h1>
            </div>
            <p className="mx-auto max-w-xl text-base text-muted-foreground leading-relaxed">
              Describe a use-case and the AI architect builds a complete demo
              package with datasets, pipelines, dashboards, and build steps.
            </p>
          </div>

          {/* Input card */}
          <Card className="mx-auto w-full max-w-3xl text-left backdrop-blur-md bg-card/80 border-primary/10 shadow-lg shadow-primary/5">
            <CardContent className="p-4">
              <form onSubmit={handleCreateProject} className="space-y-2.5">
                <Textarea
                  ref={textareaRef}
                  placeholder='Describe your project... e.g. "predictive maintenance for wind turbines"'
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    adjustTextareaHeight();
                  }}
                  className="min-h-12 text-base bg-background/60 resize-none overflow-hidden"
                  rows={1}
                  autoFocus
                />
                <ProductSelector
                  capabilities={capabilities}
                  selectedProducts={selectedProducts}
                  onToggleProduct={handleToggleProduct}
                  expanded={topic.length >= 3}
                />
                <div className="flex items-center justify-end">
                  <Button
                    type="submit"
                    disabled={isCreating}
                    className="gap-2 px-5"
                  >
                    {isCreating ? (
                      <>Creating...</>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Build Asset
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Research agent callout */}
          <div className="mx-auto max-w-3xl">
            <div className="rounded-xl border border-primary/10 bg-primary/[0.03] backdrop-blur-sm px-4 py-3 text-left">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Search className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Tailoring for a specific customer?
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    Before building a demo, ask a research agent (Claude,
                    Genie, Glean) to summarize the customer's industry, current
                    tech stack, pain points, and Databricks usage. Paste that
                    context into the input above for a proposal that speaks
                    directly to their world.
                  </p>
                </div>
              </div>
              <div className="mt-2.5 ml-11 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Lightbulb className="h-3 w-3 text-primary/60" />
                  <span className="font-medium text-foreground/70">
                    Example prompt:
                  </span>
                </span>
                <button
                  onClick={() => {
                    setTopic(
                      "Build a demo for Acme Corp (Fortune 500 retailer, heavy on Snowflake today, interested in real-time ML). They struggle with demand forecasting accuracy across 2,000+ stores."
                    );
                    setTimeout(adjustTextareaHeight, 0);
                  }}
                  className="italic hover:text-foreground transition-colors cursor-pointer underline underline-offset-2 decoration-primary/20 hover:decoration-primary/40"
                >
                  "Build a demo for Acme Corp, a Fortune 500 retailer struggling
                  with demand forecasting across 2,000+ stores..."
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Matching templates section */}
        {topic.trim().length >= 3 && (
          <div className="relative z-10 mx-auto mt-12 w-full max-w-5xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">
                    Matching Templates
                  </h2>
                  {isSearchingTemplates && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Templates that match your topic
                </p>
              </div>
              <Link
                to="/templates"
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
              >
                <Library className="h-3 w-3" />
                Browse All
              </Link>
            </div>
            {matchingTemplates.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {matchingTemplates.map((template) => (
                  <TemplateTile
                    key={template.id}
                    template={template}
                    showSimilarity
                    onClick={() => setSelectedTemplateId(template.id)}
                  />
                ))}
              </div>
            ) : !isSearchingTemplates && (
              <div className="text-center py-6 border border-dashed border-border/50 rounded-lg">
                <p className="text-sm text-muted-foreground">No matching templates found</p>
                <Link
                  to="/templates"
                  className="text-xs text-primary hover:underline mt-1 inline-block"
                >
                  Explore all templates
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Recent projects */}
        {projects.length > 0 && (
          <div className="relative z-10 mx-auto mt-12 w-full max-w-5xl">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Recent Projects
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Continue working on recent projects
                </p>
              </div>
              {projects.length > 3 && (
                <Link
                  to={"/projects"}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  View all ({projects.length})
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.slice(0, 3).map((project) => (
                <ProjectTile
                  key={project.id}
                  project={project}
                  onClick={() => handleOpenProject(project.id)}
                />
              ))}
            </div>

            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => navigate({ to: "/projects" })}
              >
                <FolderOpen className="h-4 w-4" />
                View All Projects
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Loading / Empty state */}
        {projects.length === 0 && (
          <div className="relative z-10 mx-auto mt-12 text-center">
            {isLoadingProjects ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading projects...</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No projects yet. Create your first project above!
              </p>
            )}
          </div>
        )}

        <div className="h-12" />
      </main>
      <div className="absolute inset-0 -z-20 h-full w-full bg-background" />

      {/* Template detail popup */}
      <TemplateDetailPopup
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
