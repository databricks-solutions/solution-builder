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
import { CapabilitiesPanel } from "@/components/capabilities-panel";
import { DatabricksAnimatedLogo } from "@/components/databricks-animated-logo";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  ArrowRight,
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
  Zap,
  Check,
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
import { AUTO_BUILD_KICKOFF } from "@/lib/auto-build-prompt";
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
  const [autoMode, setAutoMode] = useState(true);
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
  // Lighter-weight signal than isSuggestingCapabilities: true from the
  // moment a capability is toggled until the resulting minimal-rewrite
  // stream finishes. The story cards stay visible and get a "refining…"
  // overlay/pulse so the user knows their click registered, instead of
  // a 2-second debounce gap with no UI feedback.
  const [isRefiningStories, setIsRefiningStories] = useState(false);
  const [capabilityReasoning, setCapabilityReasoning] = useState<string | null>(null);

  // Use-case ideas from LLM
  const [ideas, setIdeas] = useState<UseCaseIdea[]>([]);
  const [expectedIdeaCount, setExpectedIdeaCount] = useState<number>(0);
  // Which idea the user has picked. Defaults to 0 when ideas first arrive
  // so the bottom CTA always has a target — reset to 0 on each new stream
  // (in the regen path below) and bumped if the user clicks another card.
  const [selectedIdeaIdx, setSelectedIdeaIdx] = useState<number>(0);
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

  // Replace the entire capability selection in one shot. The caller (the
  // panel) decides both the live set AND the explicit-status map:
  //   - Simple tab → every id in selected = "selected"; every non-baseline
  //     id = "unselected" (hard lock so the LLM can't suggest extras).
  //   - Custom tab → every id the user actually toggled has explicit
  //     "selected"/"unselected"; every other id is OMITTED from explicit
  //     (so the suggest endpoint treats it as `null` = LLM may decide).
  // Two callers means two semantics, so we let the caller build the map
  // rather than trying to be clever about it here.
  const handleReplaceSelection = useCallback(
    (
      nextSelected: Set<string>,
      nextExplicit: Map<string, "selected" | "unselected">,
    ) => {
      setSelectedProducts(nextSelected);
      setExplicitSelections(nextExplicit);
    },
    [],
  );

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
  const selectedProductsRef = useRef(selectedProducts);
  useEffect(() => { capabilitiesRef.current = capabilities; }, [capabilities]);
  useEffect(() => { explicitSelectionsRef.current = explicitSelections; }, [explicitSelections]);
  useEffect(() => { selectedProductsRef.current = selectedProducts; }, [selectedProducts]);

  // Snapshot of `selectedProducts` at the moment the LAST successful
  // suggestion stream finished — i.e. the capability set the current
  // ideas were generated for. Compared against the live selectedProducts
  // to (a) decide whether a re-suggest is needed at all and (b) feed the
  // "delta refresh" prompt so the LLM rewrites stories minimally rather
  // than replacing them.
  const ideasCapabilitySnapshotRef = useRef<string[]>([]);

  const runSuggestionStream = useCallback(async (
    promptText: string,
    refineIdea?: IdeaToRefine,
    refineComment?: string,
    /** When set, ask the backend to MINIMALLY rewrite these existing
     *  stories to fit the new capability set instead of regenerating
     *  from scratch. Pass the current `ideas` array. */
    previousIdeas?: IdeaToRefine[],
    /** The capability set the previousIdeas were generated against —
     *  needed so the prompt can describe the diff in plain English. */
    previousCapabilities?: string[],
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

    // Clear previous ideas and show loading. For a capability-change
    // refresh we DON'T clear — the user is mid-decision, blanking the
    // panel to skeletons would defeat the whole point of the minimal
    // rewrite path. Ideas get replaced in-place as the LLM streams them.
    const isCapabilityChangeRefresh = !!previousIdeas && previousIdeas.length > 0;
    if (!isCapabilityChangeRefresh) {
      setIdeas([]);
      setExpectedIdeaCount(0);
      setSelectedIdeaIdx(0);
    } else {
      // Pre-fill skeletons with the right count so layout doesn't shift.
      setExpectedIdeaCount(previousIdeas!.length);
    }
    setIsSuggestingCapabilities(true);

    // Reset accumulator BEFORE the stream starts (for the refresh path);
    // we replace ideas in-place as `idea` events arrive.
    let nextIdeas: UseCaseIdea[] = [];

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
        refineComment,
        previousIdeas,
        previousCapabilities,
      )) {
        // Check if aborted
        if (abortController.signal.aborted) return;

        if (event.type === "count") {
          // Set expected count to show skeleton cards
          setExpectedIdeaCount(event.data.count);
        } else if (event.type === "idea") {
          if (isCapabilityChangeRefresh) {
            // Accumulate locally; swap atomically when the stream ends
            // so the user never sees a half-replaced list.
            nextIdeas.push(event.data);
          } else {
            // Cold-start path — stream into the UI live so the user gets
            // immediate feedback.
            setIdeas((prev) => [...prev, event.data]);
          }
        } else if (event.type === "capabilities") {
          if (isCapabilityChangeRefresh) {
            // Refresh mode — IGNORE the LLM's capability event. The user
            // just told us what they want; overwriting that with whatever
            // the LLM happens to spit back would undo their click.
            continue;
          }
          // Cold-start: take the LLM's set + apply user overrides.
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
          if (!isCapabilityChangeRefresh) {
            // Use fallback capabilities from error (cold-start only).
            setSelectedProducts(new Set(event.data.capabilities));
          }
        }
      }

      // Stream completed cleanly. Atomic-swap the refresh-mode ideas
      // and snapshot the capability set the ideas were generated for.
      if (isCapabilityChangeRefresh && nextIdeas.length > 0) {
        setIdeas(nextIdeas);
        // Selected idea index might point at a stale slot — clamp it.
        setSelectedIdeaIdx((idx) => Math.min(idx, nextIdeas.length - 1));
      }
      // Snapshot the capability set the current ideas correspond to,
      // so the NEXT toggle knows what diff to feed the prompt. We read
      // the LIVE selectedProducts via a ref (set further down) to avoid
      // a stale closure — by the time the stream finishes, the user may
      // have toggled again and we want the snapshot to reflect what's
      // actually on screen now.
      ideasCapabilitySnapshotRef.current = Array.from(
        selectedProductsRef.current,
      );
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to suggest capabilities:", err);
      setCapabilityReasoning(null);
    } finally {
      if (!abortController.signal.aborted) {
        setIsSuggestingCapabilities(false);
        // Clear the lightweight refining flag too — set by the toggle
        // effect at click time, cleared here when the stream finishes
        // (whether it ran cold-start or capability-change-refresh).
        setIsRefiningStories(false);
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

  // Re-suggest when the user explicitly toggles a capability — so the
  // story/ideas regenerate to reflect what they want included. Skipped on
  // the first render (no toggles yet) and only fires when the user has
  // actually interacted with at least one checkbox. Debounced 2000ms so
  // a burst of product clicks coalesces into a single regeneration —
  // users typically (de)select several products in a row, and firing
  // after each click made the experience feel slow and limiting.
  const lastExplicitKeyRef = useRef<string>("");
  useEffect(() => {
    // Stable signature of the user's explicit overrides — sorted so the
    // ordering of Map iteration doesn't cause spurious diffs.
    const key = Array.from(explicitSelections.entries())
      .map(([id, st]) => `${id}=${st}`)
      .sort()
      .join("|");

    // Initial mount: capture the baseline (usually empty) and don't fire.
    if (lastExplicitKeyRef.current === "" && key === "") {
      return;
    }
    if (key === lastExplicitKeyRef.current) {
      return;
    }
    lastExplicitKeyRef.current = key;

    if (topic.trim().length < 3 || !capabilitiesReady) {
      return;
    }

    // IMPORTANT: do NOT flip isSuggestingCapabilities here. The UI hides
    // existing ideas the moment that flag goes true, so setting it on every
    // click would make the panel snap to skeletons on each toggle — looking
    // identical to an instant regen even though the actual API call is
    // debounced. Keep the current ideas visible during the debounce window;
    // runSuggestionStream() will flip the flag when it actually fires.
    //
    // We DO flip the lighter-weight `isRefiningStories` flag immediately
    // so the cards get a visible "refining…" overlay during the debounce
    // window. The flag clears either (a) when the resulting stream
    // finishes, or (b) below in the equality-skip branch when we decide
    // nothing actually needs re-fetching.
    const liveCapsImmediate = Array.from(selectedProductsRef.current).sort();
    const snapshotCapsImmediate = [...ideasCapabilitySnapshotRef.current].sort();
    if (liveCapsImmediate.join("|") !== snapshotCapsImmediate.join("|")) {
      setIsRefiningStories(true);
    }

    const timer = setTimeout(() => {
      // Re-check the live capability set against the snapshot — the user
      // may have toggled back to the original state during the debounce
      // window, in which case we skip the (expensive) re-suggest entirely.
      const liveCaps = Array.from(selectedProductsRef.current).sort();
      const snapshotCaps = [...ideasCapabilitySnapshotRef.current].sort();
      if (liveCaps.join("|") === snapshotCaps.join("|")) {
        setIsRefiningStories(false);
        return;
      }
      // If we have existing ideas, ask for a minimal in-place rewrite
      // (preserves titles + narrative). Otherwise fall through to a
      // cold-start ideation pass.
      const currentIdeas = ideas.length > 0
        ? ideas.map((i) => ({ title: i.title, hook: i.hook, datasources: i.datasources }))
        : undefined;
      runSuggestionStream(
        topic.trim(),
        undefined,
        undefined,
        currentIdeas,
        currentIdeas ? snapshotCaps : undefined,
      );
    }, 2000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicitSelections, capabilitiesReady, selectedProducts]);

  // Manual regenerate handler
  const handleRegenerate = useCallback(() => {
    if (topic.trim().length >= 3) {
      runSuggestionStream(topic.trim());
    }
  }, [topic, runSuggestionStream]);

  // Create new project and navigate. When the auto-mode toggle is on, the
  // agent's first message is the standard topic header + AUTO_BUILD_KICKOFF, so
  // it drives every stage end-to-end without pausing for confirmation. The
  // toggle's own tooltip already explains the ~30 min commitment, so we
  // skip the confirm dialog and just create the project.
  const handleCreateProject = async (
    e?: React.FormEvent,
    idea?: UseCaseIdea,
  ) => {
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
        ? `\n\nUse these capabilities within the solution: ${capabilityIds.join(", ")} (do not add extra unless it's a strict missing dependency)`
        : "";

      let initialPrompt: string;
      if (idea) {
        initialPrompt = `Help me build a databricks solution.\n\nUser request:\n${topic.trim()}\n\n**${idea.title}**\n\n${idea.hook}${authoritativeCapsLine}`;
      } else {
        initialPrompt = `Help me build a databricks solution.\n\nSolution description:\n${topic.trim()}${authoritativeCapsLine}`;
      }

      // Auto mode: append the kickoff directive so the agent runs every stage
      // (DRAFTING → DEPLOYED) without prompting. The topic/idea header above
      // gives the agent its build subject — AUTO_BUILD_KICKOFF alone would
      // tell it to inspect existing project files, but on a fresh project
      // nothing exists yet.
      if (autoMode) {
        initialPrompt += `\n\n---\n\n${AUTO_BUILD_KICKOFF}`;
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
                Solution Builder
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
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Direct create — pass the picked idea (if any) so the
                  // build uses the highlighted story; otherwise raw topic.
                  handleCreateProject(undefined, ideas[selectedIdeaIdx]);
                }}
                className="space-y-2.5"
              >
                <Textarea
                  ref={textareaRef}
                  placeholder='Describe your project... e.g. "predictive maintenance for wind turbines"'
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    adjustTextareaHeight();
                  }}
                  className="min-h-12 text-lg md:text-lg bg-background/60 resize-none overflow-hidden"
                  rows={1}
                  autoFocus
                />

                {/* Ideas section - shows when we have ideas or loading */}
                {isHeroCollapsed && (
                  <div className="pt-2 pb-1">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">
                          {isSuggestingCapabilities
                            ? "Generating story ideas..."
                            : ideas.length === 1
                              ? "Your solution story"
                              : "Choose a story direction"}
                        </span>
                        {/* Regenerate stories — paired with the title so it
                            reads as part of the "your stories" header. */}
                        {ideas.length > 0 && !isSuggestingCapabilities && (
                          <button
                            type="button"
                            onClick={handleRegenerate}
                            className="ml-1 flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                            title="Regenerate stories from scratch"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Regenerate stories
                          </button>
                        )}
                      </div>
                      {/* Auto-build toggle — when on, picking a use case
                          runs every stage end-to-end without prompts.
                          Uses the shadcn Tooltip so the explanation shows
                          on hover (the bare `title` attr was too slow). */}
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label
                              className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Checkbox
                                checked={autoMode}
                                onCheckedChange={(v) => setAutoMode(v === true)}
                                aria-label="Enable auto build mode"
                              />
                              <Zap className="h-3 w-3 text-primary" strokeWidth={2.5} />
                              <span className="font-medium">Auto mode</span>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="end" className="max-w-xs">
                            <p className="text-xs leading-relaxed">
                              <strong>Auto mode</strong> runs every build stage
                              end-to-end (story → specs → resources → deploy)
                              without pausing for confirmation. Takes ~30 min.
                              Turn it off if you want to review each step
                              manually as the assistant works.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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

                          // Real idea card — clickable to select. Selection
                          // is wired to a single primary CTA below the
                          // capability picker; per-card buttons no longer
                          // create the project (avoids the "press here then
                          // there" disjoint flow).
                          const isRefiningThis = refiningIdeaIdx === idx;
                          const isSelectedIdea = selectedIdeaIdx === idx;
                          return (
                            <div
                              key={idx}
                              onClick={() => setSelectedIdeaIdx(idx)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedIdeaIdx(idx);
                                }
                              }}
                              className={`relative p-4 rounded-lg border transition-all flex flex-col h-full bg-white dark:bg-card ${
                                totalSlots > 1 ? "min-h-[180px]" : ""
                              } ${
                                isSelectedIdea
                                  ? "border-primary/60 ring-1 ring-primary/40 shadow-sm"
                                  : "border-slate-200 dark:border-border/50 hover:border-primary/40"
                              } ${
                                isRefiningStories ? "pointer-events-none" : "cursor-pointer"
                              }`}
                            >
                              {/* Refining overlay — covers the card while
                                  the AI is rewriting the stories. The inner
                                  content stays in place (no layout shift)
                                  but reads as ghosted via the overlay's
                                  backdrop. */}
                              {isRefiningStories && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 dark:bg-card/70 backdrop-blur-[1px]">
                                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                                  <span className="text-xs text-muted-foreground">
                                    Refining…
                                  </span>
                                </div>
                              )}
                              <p className="text-sm font-medium text-slate-900 dark:text-foreground mb-1.5">
                                {idea.title}
                              </p>
                              <div className="text-xs text-slate-600 dark:text-muted-foreground leading-relaxed mb-3 flex-1">
                                {/* Render hook with markdown-like formatting for detailed cards */}
                                {idea.hook.includes("\n") ? (
                                  <div className="space-y-2">
                                    {idea.hook.split("\n\n").map((paragraph, pIdx) => (
                                      <p key={pIdx}>
                                        {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, partIdx) => {
                                          if (part.startsWith("**") && part.endsWith("**")) {
                                            return (
                                              <span key={partIdx} className="font-semibold text-slate-900 dark:text-foreground">
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
                                <div
                                  className="mb-3 flex gap-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    value={refineText}
                                    onChange={(e) => setRefineText(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      // Stop EVERY keydown from bubbling to
                                      // the card's onKeyDown — that handler
                                      // preventDefault()s Space (because the
                                      // card is role="button"), which would
                                      // otherwise eat spaces typed in here.
                                      e.stopPropagation();
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRefineSubmit(idea);
                                    }}
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRefiningIdeaIdx(null);
                                      setRefineText("");
                                    }}
                                    className="p-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              )}

                              {/* Card actions — only Refine remains as a per-card
                                  button. Selection is conveyed by the card's
                                  border/ring AND by the destructive-accent
                                  pill below (matches the build CTA color)
                                  so it reads as a primary affordance, not
                                  another neutral chip next to Refine/data
                                  source pills. */}
                              <div className="flex items-center gap-2 mt-auto">
                                <span
                                  className={`text-xs font-semibold py-1.5 rounded-md flex items-center justify-center gap-1.5 border w-[128px] ${
                                    isSelectedIdea
                                      ? "bg-destructive text-destructive-foreground border-destructive shadow-sm"
                                      : "bg-transparent text-destructive border-destructive/40 hover:bg-destructive/5"
                                  }`}
                                >
                                  {isSelectedIdea ? (
                                    <>
                                      <Check className="h-3 w-3" strokeWidth={2.5} />
                                      Picked
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="h-3 w-3" />
                                      Click to pick
                                    </>
                                  )}
                                </span>
                                {!isRefiningThis && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Refining a card implicitly picks it
                                      // too — the user is signaling this is
                                      // the story they want, just with a
                                      // tweak. Stops the user from having
                                      // to click twice (pick → refine).
                                      setSelectedIdeaIdx(idx);
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

                {/* Capabilities panel — tabs between a curated "Simple
                    Databricks demo" baseline and the full "Custom solution"
                    selector. Both tabs write to the same selectedProducts
                    set so the downstream build CTA / confirm dialog are
                    unchanged. */}
                <CapabilitiesPanel
                  capabilities={capabilities}
                  selectedProducts={selectedProducts}
                  onToggleProduct={handleToggleProduct}
                  onReplaceSelection={handleReplaceSelection}
                  expanded={isHeroCollapsed}
                  isLoading={isSuggestingCapabilities}
                  explicitSelections={explicitSelections}
                />

                {/* Primary CTA — direct create. Capability set is fully
                    user-visible (locked baseline in Simple, granular tile
                    in Custom), so no confirm dialog is needed. */}
                {isHeroCollapsed && ideas.length > 0 && (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCreateProject(undefined, ideas[selectedIdeaIdx])
                      }
                      disabled={
                        isCreating || isSuggestingCapabilities || !topic.trim()
                      }
                      className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold transition-all bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                    >
                      {isCreating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {isCreating
                        ? "Creating…"
                        : ideas[selectedIdeaIdx]
                          ? `Build with "${ideas[selectedIdeaIdx].title}"`
                          : "Build this solution"}
                    </button>
                  </div>
                )}

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
