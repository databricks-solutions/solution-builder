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
import { DatabricksAnimatedLogo } from "@/components/databricks-animated-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  ArrowRight,
  Search,
  Lightbulb,
  Loader2,
  Library,
  FolderOpen,
  Database,
  Pencil,
  Send,
  X,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  listProjects,
  createProject,
  searchTemplates,
  getConfigStatus,
  getCapabilities,
  streamSuggestCapabilities,
  type ProjectListItem,
  type TemplateSearchResult,
  type Capability,
  type CapabilityInput,
  type UseCaseIdea,
  type IdeaToRefine,
} from "@/lib/custom-api";

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

// Default selected capabilities — talking-track only.
// Buildable capabilities are chosen by the LLM based on the user's prompt.
const DEFAULT_SELECTED_PRODUCTS = [
  "unity-catalog",       // Governance story
  "genie-code",          // AI coding assistant
  "databricks-one",      // Business user experience
  "lakeflow-connect",    // Data ingestion
];

function Index() {
  const [topic, setTopic] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set(DEFAULT_SELECTED_PRODUCTS)
  );
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track explicit user selections (manually toggled by clicking)
  // null = not explicitly set (LLM decides), "selected" = user added, "unselected" = user removed
  const [explicitSelections, setExplicitSelections] = useState<Map<string, "selected" | "unselected">>(new Map());
  const [isSuggestingCapabilities, setIsSuggestingCapabilities] = useState(false);
  const [capabilityReasoning, setCapabilityReasoning] = useState<string | null>(null);

  // Use-case ideas from LLM
  const [ideas, setIdeas] = useState<UseCaseIdea[]>([]);
  const [expectedIdeaCount, setExpectedIdeaCount] = useState<number>(0);

  // Refine state: which idea is being refined and the input text
  const [refiningIdeaIdx, setRefiningIdeaIdx] = useState<number | null>(null);
  const [refineText, setRefineText] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Template search state
  const [matchingTemplates, setMatchingTemplates] = useState<TemplateSearchResult[]>([]);
  const [isSearchingTemplates, setIsSearchingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Check if hero should be collapsed (user has typed something)
  const isHeroCollapsed = topic.trim().length >= 3;

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200; // Max height in pixels
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, []);

  // Toggle product selection and track explicit user choice
  const handleToggleProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      const isCurrentlySelected = next.has(productId);

      if (isCurrentlySelected) {
        next.delete(productId);
      } else {
        next.add(productId);
      }

      // Track this as an explicit user selection
      setExplicitSelections((prevExplicit) => {
        const nextExplicit = new Map(prevExplicit);
        nextExplicit.set(productId, isCurrentlySelected ? "unselected" : "selected");
        return nextExplicit;
      });

      return next;
    });
  }, []);

  // Load projects and capabilities on mount
  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setProjectsError(err.message || "Failed to load projects"))
      .finally(() => setIsLoadingProjects(false));

    getCapabilities()
      .then(setCapabilities)
      .catch(() => {});
  }, []);

  // Debounced template search (500ms)
  useEffect(() => {
    if (topic.trim().length < 3) {
      setMatchingTemplates([]);
      setIsSearchingTemplates(false);
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

  // Streaming suggestion helper.
  //
  // RACE NOTE: this callback used to depend on `capabilities` and
  // `explicitSelections`, which made its identity change whenever the user
  // toggled a capability checkbox. The debounced effect below depends on
  // it, so a checkbox toggle would re-run the effect's CLEANUP — and the
  // cleanup aborts the in-flight stream. Symptom: ideas start arriving,
  // user (or React's commit) bumps something, stream gets aborted
  // mid-content. Fix: read `capabilities` + `explicitSelections` through
  // refs so this callback's identity stays stable across those changes.
  const abortControllerRef = useRef<AbortController | null>(null);
  const capabilitiesRef = useRef(capabilities);
  const explicitSelectionsRef = useRef(explicitSelections);
  useEffect(() => { capabilitiesRef.current = capabilities; }, [capabilities]);
  useEffect(() => { explicitSelectionsRef.current = explicitSelections; }, [explicitSelections]);

  const runSuggestionStream = useCallback(async (
    promptText: string,
    refineIdea?: IdeaToRefine,
    refineComment?: string
  ) => {
    // Read latest values via refs (see RACE NOTE above).
    const caps = capabilitiesRef.current;
    const explicit = explicitSelectionsRef.current;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!promptText.trim() || caps.length === 0) {
      setIsSuggestingCapabilities(false);
      return;
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Clear previous ideas and show loading
    setIdeas([]);
    setExpectedIdeaCount(0);
    setIsSuggestingCapabilities(true);

    try {
      // Build capability inputs
      const capabilityInputs: CapabilityInput[] = caps.map((cap) => ({
        id: cap.id,
        status: explicit.get(cap.id) ?? null,
      }));

      // Stream events
      for await (const event of streamSuggestCapabilities(
        promptText.trim(),
        capabilityInputs,
        abortController.signal,
        refineIdea,
        refineComment
      )) {
        // Check if aborted
        if (abortController.signal.aborted) return;

        if (event.type === "count") {
          // Set expected count to show skeleton cards
          setExpectedIdeaCount(event.data.count);
        } else if (event.type === "idea") {
          // Append idea as it arrives
          setIdeas((prev) => [...prev, event.data]);
        } else if (event.type === "capabilities") {
          // Update capabilities with user overrides — read latest
          // explicit selections in case the user toggled mid-stream.
          const explicitNow = explicitSelectionsRef.current;
          setSelectedProducts(() => {
            const next = new Set<string>();
            for (const capId of event.data.capabilities) {
              next.add(capId);
            }
            for (const [capId, status] of explicitNow) {
              if (status === "selected") next.add(capId);
              else if (status === "unselected") next.delete(capId);
            }
            return next;
          });
        } else if (event.type === "reasoning") {
          // Set reasoning text from separate event
          setCapabilityReasoning(event.data.text || null);
        } else if (event.type === "error") {
          console.error("Suggestion error:", event.data.error);
          // Use fallback capabilities from error
          setSelectedProducts(new Set(event.data.capabilities));
        }
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to suggest capabilities:", err);
      setCapabilityReasoning(null);
    } finally {
      if (!abortController.signal.aborted) {
        setIsSuggestingCapabilities(false);
      }
    }
  }, []); // ← stable identity; deps are read via refs

  // Debounced capability suggestion (1000ms) — fires when the topic
  // changes. We deliberately depend ONLY on `topic` and a "capabilities
  // ready" boolean, NOT on the full capabilities array or
  // runSuggestionStream — otherwise the cleanup (which aborts the
  // in-flight stream) would fire on every checkbox toggle and kill
  // streams mid-way.
  const lastTopicRef = useRef("");
  const capabilitiesReady = capabilities.length > 0;
  useEffect(() => {
    // Only trigger when topic actually changes
    if (topic.trim() === lastTopicRef.current) {
      return;
    }
    lastTopicRef.current = topic.trim();

    if (topic.trim().length < 3 || !capabilitiesReady) {
      setIsSuggestingCapabilities(false);
      return;
    }

    // Show loading immediately
    setIsSuggestingCapabilities(true);

    // Debounce the actual API call
    const timer = setTimeout(() => {
      runSuggestionStream(topic.trim());
    }, 1000);

    return () => {
      clearTimeout(timer);
      // Don't abort the in-flight stream here — the next call to
      // runSuggestionStream() does it itself, and aborting here would
      // also fire on unmount/StrictMode-double-mount and look like a
      // mid-stream cancel to the user.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, capabilitiesReady]);

  // Manual regenerate handler
  const handleRegenerate = useCallback(() => {
    if (topic.trim().length >= 3) {
      runSuggestionStream(topic.trim());
    }
  }, [topic, runSuggestionStream]);

  // Create new project and navigate
  const handleCreateProject = async (e?: React.FormEvent, idea?: UseCaseIdea) => {
    e?.preventDefault();
    if (isCreating || !topic.trim()) return;

    // Capabilities are always from selectedProducts (shared across all ideas)
    const capabilityIds = Array.from(selectedProducts);

    setIsCreating(true);
    setCreateError(null);
    try {
      // Build description: if we have an idea, use it; otherwise use raw topic
      let description: string;

      if (idea) {
        // Use the idea's title + hook as description
        description = `${idea.title}\n\n${idea.hook}`;
        if (idea.datasources && idea.datasources.length > 0) {
          description += `\n\nData sources: ${idea.datasources.join(", ")}`;
        }
      } else {
        // Raw topic mode
        description = topic.trim();
      }

      if (capabilityIds.length > 0) {
        description += `\n\nSelected capabilities: ${capabilityIds.join(", ")}`;
      }

      // Build the initial prompt message.
      //
      // The capability list is AUTHORITATIVE — resources.json must contain exactly
      // these capability IDs. The idea hook / story text is narrative flavor and
      // may reference products by name (e.g. "Knowledge Assistant") that the user
      // did NOT select; those mentions must be treated as descriptive language,
      // NOT as a signal to add capabilities the user didn't pick.
      const authoritativeCapsLine = capabilityIds.length > 0
        ? `\n\nUse these capabilities within the demo: ${capabilityIds.join(", ")} (do not add extra unless it's a strict missing dependency)`
        : "";

      let initialPrompt: string;
      if (idea) {
        initialPrompt = `Help me build a databricks demo.\n\nUser request:\n${topic.trim()}\n\n**${idea.title}**\n\n${idea.hook}${authoritativeCapsLine}`;
      } else {
        initialPrompt = `Help me build a databricks demo.\n\nDemo description:\n${topic.trim()}${authoritativeCapsLine}`;
      }

      // Backend will generate name and schema from description using LLM.
      // Passing capabilityIds scopes which ai-dev-kit skills get copied into the project.
      // Passing initialPrompt persists the opening message as a real user Message so it
      // shows up as the first chat bubble on load — no URL-param round-trip, no race.
      const project = await createProject(description, capabilityIds, initialPrompt);

      navigate({
        to: "/project/$projectId",
        params: { projectId: project.id },
      });
    } catch (error) {
      console.error("Failed to create project:", error);
      setCreateError(error instanceof Error ? error.message : "Failed to create project. Please try again.");
      setIsCreating(false);
    }
  };

  // Handle refining an idea
  const handleRefineSubmit = async (idea: UseCaseIdea) => {
    if (!refineText.trim() || isRefining) return;

    setIsRefining(true);
    setRefiningIdeaIdx(null);

    try {
      await runSuggestionStream(
        topic.trim(),
        { title: idea.title, hook: idea.hook, datasources: idea.datasources },
        refineText.trim()
      );
      setRefineText("");
    } catch (err) {
      console.error("Failed to refine idea:", err);
    } finally {
      setIsRefining(false);
    }
  };

  // Handle clicking "Use this story" - directly create project
  const handleUseStory = (idea: UseCaseIdea) => {
    handleCreateProject(undefined, idea);
  };

  // Open existing project
  const handleOpenProject = (projectId: string) => {
    navigate({ to: "/project/$projectId", params: { projectId } });
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Full-page overlay while creating a project (or after a creation error) */}
      {(isCreating || createError) && (
        <CreateProjectOverlay
          creating={isCreating}
          error={createError}
          onDismiss={() => setCreateError(null)}
        />
      )}
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

        {/* Hero - collapses when user starts typing */}
        <div className={`relative z-10 mx-auto w-full space-y-6 text-center transition-all duration-300 ${
          isHeroCollapsed ? "max-w-6xl" : "max-w-4xl"
        }`}>
          {/* Collapsible header */}
          <div
            className={`space-y-4 transition-all duration-300 ease-out overflow-hidden ${
              isHeroCollapsed ? "max-h-0 opacity-0 mb-0" : "max-h-[300px] opacity-100"
            }`}
          >
            <div className="group mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-primary/15 backdrop-blur-sm border border-primary/20 shadow-lg shadow-primary/10 relative overflow-hidden">
              {/* Soft inner glow */}
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(255,120,80,0.18),transparent_60%)]" />
              <DatabricksAnimatedLogo className="h-12 w-12 relative" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Databricks
              </p>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                Asset Builder
              </h1>
            </div>
            <p className="mx-auto max-w-xl text-base text-muted-foreground leading-relaxed">
              Describe a use-case and the AI agent assembles a complete package
              — datasets, pipelines, dashboards...
              and build steps.
            </p>
          </div>

          {/* Input card */}
          <Card className="w-full text-left backdrop-blur-md bg-card/80 border-primary/10 shadow-lg shadow-primary/5">
            <CardContent className="p-4">
              <form onSubmit={(e) => handleCreateProject(e)} className="space-y-2.5">
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

                {/* Ideas section - shows when we have ideas or loading */}
                {isHeroCollapsed && (
                  <div className="pt-2 pb-1">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">
                          {isSuggestingCapabilities
                            ? "Generating story ideas..."
                            : ideas.length === 1
                              ? "Your demo story"
                              : "Choose a story direction"}
                        </span>
                      </div>
                      {/* Regenerate button */}
                      {ideas.length > 0 && !isSuggestingCapabilities && (
                        <button
                          type="button"
                          onClick={handleRegenerate}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                          title="Regenerate ideas"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {/* Initial loading state before count arrives */}
                    {isSuggestingCapabilities && expectedIdeaCount === 0 && ideas.length === 0 && (
                      <div className="flex items-center justify-center min-h-[180px] rounded-lg border border-border bg-card/50">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                          <span className="text-xs">Analyzing your request...</span>
                        </div>
                      </div>
                    )}
                    <div className={`grid gap-3 ${
                      expectedIdeaCount === 1 ? "grid-cols-1" : expectedIdeaCount === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"
                    } ${isSuggestingCapabilities && expectedIdeaCount === 0 && ideas.length === 0 ? "hidden" : ""}`}>
                      {/* Render cards: real ideas + skeleton placeholders for remaining */}
                      {(() => {
                        // Use expectedIdeaCount to determine total slots (once count event arrives)
                        const totalSlots = expectedIdeaCount > 0 ? expectedIdeaCount : ideas.length;
                        return Array.from({ length: totalSlots }, (_, idx) => {
                          const idea = ideas[idx];

                          // Skeleton card for slots without data yet
                          if (!idea) {
                            return (
                              <div
                                key={`skeleton-${idx}`}
                                className={`p-4 rounded-lg border border-border bg-card/50 space-y-3 ${
                                  totalSlots > 1 ? "min-h-[180px]" : ""
                                }`}
                              >
                                <div className="h-4 w-3/4 rounded-md bg-primary/10 animate-pulse" />
                                <div className="space-y-2">
                                  <div className="h-3 w-full rounded-md bg-muted-foreground/10 animate-pulse" />
                                  <div className="h-3 w-5/6 rounded-md bg-muted-foreground/10 animate-pulse" />
                                </div>
                                <div className="h-3 w-2/3 rounded-md bg-muted-foreground/10 animate-pulse" />
                                <div className="h-8 w-28 rounded-md bg-muted-foreground/10 animate-pulse mt-2" />
                              </div>
                            );
                          }

                          // Real idea card
                          const isRefiningThis = refiningIdeaIdx === idx;
                          return (
                            <div
                              key={idx}
                              className={`p-4 rounded-lg border transition-all flex flex-col h-full ${
                                totalSlots > 1 ? "min-h-[180px]" : ""
                              } border-border/50 hover:border-primary/30`}
                            >
                              <p className="text-sm font-medium text-foreground mb-1.5">
                                {idea.title}
                              </p>
                              <div className="text-xs text-muted-foreground leading-relaxed mb-3 flex-1">
                                {/* Render hook with markdown-like formatting for detailed cards */}
                                {idea.hook.includes("\n") ? (
                                  <div className="space-y-2">
                                    {idea.hook.split("\n\n").map((paragraph, pIdx) => (
                                      <p key={pIdx}>
                                        {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, partIdx) => {
                                          if (part.startsWith("**") && part.endsWith("**")) {
                                            return (
                                              <span key={partIdx} className="font-semibold text-foreground">
                                                {part.slice(2, -2)}
                                              </span>
                                            );
                                          }
                                          return <span key={partIdx}>{part}</span>;
                                        })}
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <p>{idea.hook}</p>
                                )}
                              </div>
                              {idea.datasources && idea.datasources.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                                  <Database className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                                  {idea.datasources.map((ds, dsIdx) => (
                                    <span
                                      key={dsIdx}
                                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/50 text-muted-foreground"
                                    >
                                      {ds}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Refine input - shows when refining this card */}
                              {isRefiningThis && (
                                <div className="mb-3 flex gap-2">
                                  <input
                                    type="text"
                                    value={refineText}
                                    onChange={(e) => setRefineText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleRefineSubmit(idea);
                                      }
                                      if (e.key === "Escape") {
                                        setRefiningIdeaIdx(null);
                                        setRefineText("");
                                      }
                                    }}
                                    placeholder="How should we adjust this story?"
                                    className="flex-1 text-xs px-2 py-1.5 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                                    autoFocus
                                    disabled={isRefining}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRefineSubmit(idea)}
                                    disabled={!refineText.trim() || isRefining}
                                    className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                                  >
                                    {isRefining ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Send className="h-3 w-3" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRefiningIdeaIdx(null);
                                      setRefineText("");
                                    }}
                                    className="p-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              )}

                              {/* Action buttons */}
                              <div className="flex gap-2 mt-auto">
                                <button
                                  type="button"
                                  onClick={() => handleUseStory(idea)}
                                  disabled={isCreating}
                                  className="text-xs font-medium px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  Use this story
                                </button>
                                {!isRefiningThis && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRefiningIdeaIdx(idx);
                                      setRefineText("");
                                    }}
                                    className="text-xs font-medium px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 cursor-pointer bg-muted text-muted-foreground hover:bg-muted/80"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Refine
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* Product selector - shows when collapsed OR when an idea is selected */}
                <ProductSelector
                  capabilities={capabilities}
                  selectedProducts={selectedProducts}
                  onToggleProduct={handleToggleProduct}
                  expanded={isHeroCollapsed}
                  isLoading={isSuggestingCapabilities}
                  explicitSelections={explicitSelections}
                />
                {/* Error message and reasoning tooltip */}
                <div className="flex items-center gap-2">
                  {createError && (
                    <p className="text-sm text-destructive">{createError}</p>
                  )}
                  {capabilityReasoning && isHeroCollapsed && (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-1 group"
                          >
                            <span className="italic">View implementation flow</span>
                            <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-md">
                          <p className="text-xs leading-relaxed">{capabilityReasoning}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Research agent callout - hidden when collapsed */}
          <div
            className={`mx-auto max-w-4xl transition-all duration-300 ease-out overflow-hidden ${
              isHeroCollapsed ? "max-h-0 opacity-0" : "max-h-[200px] opacity-100"
            }`}
          >
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
                  aria-label="Use example prompt: Build a demo for Acme Corp"
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

        {/* Loading / Empty / Error state */}
        {projects.length === 0 && (
          <div className="relative z-10 mx-auto mt-12 text-center">
            {isLoadingProjects ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading projects...</p>
              </div>
            ) : projectsError ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">Failed to load projects</p>
                <p className="text-xs text-muted-foreground">{projectsError}</p>
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

// ---------------------------------------------------------------------------
// Create-project overlay
// ---------------------------------------------------------------------------

function CreateProjectOverlay({
  creating,
  error,
  onDismiss,
}: {
  creating: boolean;
  error: string | null;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        {error ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="size-6 text-destructive shrink-0" />
              <h3 className="text-lg font-semibold">Project creation failed</h3>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-sm font-mono text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
              {error}
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Dismiss
            </button>
          </div>
        ) : creating ? (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <Loader2 className="size-10 text-primary animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">Creating your project…</h3>
              <p className="text-sm text-muted-foreground">
                Please wait a moment — this takes a little while as we set up your project, and load the relevant skills.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
