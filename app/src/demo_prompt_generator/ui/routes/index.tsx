import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/layout/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import { ProjectTile } from "@/components/project/project-tile";
import { ProjectInvitations } from "@/components/project/project-invitations";
import { SharedWithMe } from "@/components/project/shared-with-me";
import { TemplateTile } from "@/components/template/template-tile";
import { TemplateDetailPopup } from "@/components/template/template-detail-popup";
import { CapabilitiesPanel, SIMPLE_BASELINE, WORKSHOP_BASELINE } from "@/components/capabilities-panel";
import { ProductSelector } from "@/components/product-selector";
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
  Paperclip,
  Pencil,
  Send,
  X,
  RefreshCw,
  AlertCircle,
  Zap,
  Check,
} from "lucide-react";
import {
  getHomeProjects,
  createProject,
  toggleProjectStar,
  extractFiles,
  searchTemplates,
  getMe,
  getCapabilities,
  streamSuggestCapabilities,
  type ProjectListItem,
  type ProjectShareOut,
  type TemplateSearchResult,
  type Capability,
  type CapabilityInput,
  type UseCaseIdea,
  type IdeaToRefine,
  type UploadedFile,
} from "@/lib/custom-api";
import { FileUploadChip } from "@/components/file-upload-chip";
import { AUTO_BUILD_KICKOFF } from "@/lib/auto-build-prompt";
import { cn } from "@/lib/utils";
export const Route = createFileRoute("/")({
  component: Index,
  // NOTE: the "is configured?" gate used to live in a blocking `beforeLoad`,
  // which awaited a backend round-trip on every navigation to "/" — so on a
  // slow DB, clicking "Home" from a project hung ~1s before anything rendered.
  // It now runs as a non-blocking effect in the component (see below): the
  // page paints instantly and redirects to /setup only if truly unconfigured.
});

// Default selected capabilities — talking-track only.
// Buildable capabilities are chosen by the LLM based on the user's prompt.
const DEFAULT_SELECTED_PRODUCTS = [
  "unity-catalog",       // Governance story
  "genie-code",          // AI coding assistant
  "genie-one",      // Business user experience
  "lakeflow-connect",    // Data ingestion
];

function Index() {
  const [topic, setTopic] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [sharedProjects, setSharedProjects] = useState<ProjectListItem[]>([]);
  const [invitations, setInvitations] = useState<ProjectShareOut[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(true);
  // Pro mode: skip the story-suggestion UX entirely. The user types what they
  // want, picks capabilities manually, and the agent gets only that as the
  // initial prompt — no auto-generated story ideas, no idea hook prepended.
  // Always resets on successful project creation (per-session preference,
  // not sticky).
  const [proMode, setProMode] = useState(false);
  // Top-level entry mode. "story" = the current story-suggestion flow.
  // "architecture" = lead-with-architecture flow: the prompt + the capability
  // picker (Simple-demo baseline by default — the agent draws exactly the
  // selection) + a "Create my architecture" button (no story ideas, no
  // templates). "workshop" = Genie Code workshop: same capability/story picker
  // as story mode, but genie_code_workshop-unready capabilities are hidden, and
  // the agent generates a notebook workshop (build-it-live via Genie Code)
  // instead of provisioning resources. Defaults to "story" to preserve today's landing.
  const [mode, setMode] = useState<"story" | "architecture" | "workshop">("story");
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

  // Home-page file upload — drag-drop or paperclip-pick. The backend
  // extracts text once; we hold the result here and ship it BOTH to the
  // suggest stream (as `context_text`) and to createProject (as
  // `context_files`). Reset cleanly when the user starts a new project.
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if hero should be collapsed (user has typed something OR a file
  // was uploaded). Either signal is enough to surface ideas — a user who
  // drops a PRD without typing should still see suggestions.
  const isHeroCollapsed = topic.trim().length >= 3 || uploadedFiles.length > 0;

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200; // Max height in pixels
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, []);

  // Total-context cap (~50 KB) for what we ship to the suggest endpoint.
  // The backend re-caps as belt-and-braces; this saves bandwidth.
  const SUGGEST_CONTEXT_MAX = 50_000;

  // Join all extracted files into one prompt-ready blob with filename
  // headers between each. Truncates the whole thing at SUGGEST_CONTEXT_MAX
  // characters so a single large file can't blow the budget.
  const buildContextText = useCallback((): string | undefined => {
    if (uploadedFiles.length === 0) return undefined;
    const parts: string[] = [];
    for (const f of uploadedFiles) {
      parts.push(`=== FILE: ${f.filename} ===\n${f.text}`);
    }
    const joined = parts.join("\n\n");
    if (joined.length > SUGGEST_CONTEXT_MAX) {
      return joined.slice(0, SUGGEST_CONTEXT_MAX) + "\n\n[... truncated ...]";
    }
    return joined;
  }, [uploadedFiles]);

  // Send picked / dropped files to /api/uploads/extract and append to
  // state. Errors come back as a human-readable detail string from the
  // backend (size/count/type violations) which we show inline below the
  // textarea. We do NOT replace the existing chips on partial failure —
  // the user's previously uploaded files stay put.
  const handleFiles = useCallback(async (incoming: FileList | File[]) => {
    const files = Array.from(incoming);
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const extracted = await extractFiles(files);
      setUploadedFiles((prev) => [...prev, ...extracted]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }, []);

  // Drag/drop on the card — we accept anything droppable but the upload
  // endpoint enforces the extension allowlist, so unsupported drops
  // surface as a 400 with a readable detail.
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleRemoveFile = useCallback((idx: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
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

  // Architecture mode shows the FULL picker (no Simple/Custom tabs) with the
  // simple-demo baseline pre-selected. Seed ONCE on first entry — after that
  // the user's toggles are theirs (switching story↔architecture doesn't wipe).
  // The baseline is a SOFT default: the explicit map stays EMPTY so the
  // capabilities-only LLM pass may adjust the whole selection as the user
  // types; only actual user clicks pin ids (handleToggleProduct records them).
  const archSeededRef = useRef(false);
  useEffect(() => {
    if (mode !== "architecture" || archSeededRef.current) return;
    archSeededRef.current = true;
    handleReplaceSelection(
      new Set<string>(SIMPLE_BASELINE),
      new Map<string, "selected" | "unselected">(),
    );
  }, [mode, handleReplaceSelection]);

  // Workshop mode seed: start from the workshop baseline (synthetic data → SDP →
  // dashboard → Genie; no app/lakebase). The suggest LLM may still refine it,
  // but sanitizeSelection guarantees the hidden caps never come back.
  const workshopSeededRef = useRef(false);
  useEffect(() => {
    if (mode !== "workshop" || workshopSeededRef.current) return;
    workshopSeededRef.current = true;
    handleReplaceSelection(
      new Set<string>(WORKSHOP_BASELINE),
      new Map<string, "selected" | "unselected">(),
    );
  }, [mode, handleReplaceSelection]);

  // Load projects and capabilities on mount
  useEffect(() => {
    // One call feeds Recent Projects + Shared with Me + Invitations so they
    // resolve together (no staggered pop-in).
    getHomeProjects()
      .then((home) => {
        setProjects(home.owned);
        setSharedProjects(home.shared);
        setInvitations(home.invitations);
      })
      .catch((err) => setProjectsError(err.message || "Failed to load projects"))
      .finally(() => setIsLoadingProjects(false));

    getCapabilities()
      .then(setCapabilities)
      .catch(() => {});
  }, []);

  // Non-blocking setup gate: send first-run (unconfigured) users to /setup,
  // but don't block rendering — the home page paints immediately either way.
  //
  // Gate on /api/me (whoami), NOT /api/config/status: whoami's `is_configured`
  // is mode-aware (always true in deployed mode — the header IS the auth),
  // whereas config-status only checks for a local User row, which never exists
  // in deployed mode. Using config-status here caused a /setup ⇄ / flash loop:
  // home bounced deployed users to /setup, and setup.tsx bounced them back.
  useEffect(() => {
    getMe()
      .then((me) => {
        if (!me.is_configured) navigate({ to: "/setup" });
      })
      .catch((err) => console.warn("Failed to check identity:", err));
  }, [navigate]);

  // Debounced template search (500ms). Story-tab only — the architecture
  // tab doesn't surface templates, so skip the search there.
  useEffect(() => {
    if (mode !== "story" || topic.trim().length < 3) {
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
  }, [topic, mode]);

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
  // Workshop mode: hide capabilities the Genie Code workshop can't co-build
  // (genie_code_workshop === false: lakebase, apps, KA, MAS). It also SURFACES a
  // few capabilities that are globally `disabled` (hidden from story) but make
  // sense to build live with Genie Code — e.g. Notebooks & EDA — by clearing
  // their disabled flag for this mode only. Story + architecture see the raw list.
  const WORKSHOP_FORCE_ENABLE = ["notebooks-eda"];
  const visibleCapabilities = useMemo(
    () =>
      mode === "workshop"
        ? capabilities
            .filter((c) => c.genie_code_workshop !== false)
            .map((c) =>
              WORKSHOP_FORCE_ENABLE.includes(c.id) && c.disabled
                ? { ...c, disabled: false }
                : c,
            )
        : capabilities,
    [capabilities, mode],
  );
  // Ids the Genie Code workshop can't build (genie_code_workshop === false —
  // apps, lakebase, KA, MAS). Derived from the loaded capabilities so it tracks
  // the block frontmatter. Load-bearing: hiding a tile in the picker does NOT
  // remove it from the selection, so we must actively strip these from any
  // selection while in workshop mode (LLM suggestions + create payload).
  const workshopHiddenIds = useMemo(
    () => new Set(capabilities.filter((c) => c.genie_code_workshop === false).map((c) => c.id)),
    [capabilities],
  );
  // Strip workshop-hidden ids from a selection when in workshop mode.
  const sanitizeSelection = useCallback(
    (ids: Iterable<string>): Set<string> => {
      const s = new Set(ids);
      if (mode === "workshop") for (const id of workshopHiddenIds) s.delete(id);
      return s;
    },
    [mode, workshopHiddenIds],
  );
  const capabilitiesRef = useRef(capabilities);
  const explicitSelectionsRef = useRef(explicitSelections);
  const selectedProductsRef = useRef(selectedProducts);
  // Refs so runSuggestionStream (stable identity) can constrain the LLM to the
  // workshop-allowed capabilities without depending on `mode`/`workshopHiddenIds`.
  const modeRef = useRef(mode);
  const workshopHiddenIdsRef = useRef(workshopHiddenIds);
  useEffect(() => { capabilitiesRef.current = capabilities; }, [capabilities]);
  useEffect(() => { explicitSelectionsRef.current = explicitSelections; }, [explicitSelections]);
  useEffect(() => { selectedProductsRef.current = selectedProducts; }, [selectedProducts]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { workshopHiddenIdsRef.current = workshopHiddenIds; }, [workshopHiddenIds]);
  // Same ref-trick so runSuggestionStream keeps its stable identity even
  // though buildContextText changes whenever uploadedFiles does.
  const buildContextTextRef = useRef(buildContextText);
  useEffect(() => { buildContextTextRef.current = buildContextText; }, [buildContextText]);

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
    /** Architecture mode: LLM selects matching capabilities only — no
     *  use-case ideas. Story state (ideas/skeletons) is left untouched. */
    capabilitiesOnly?: boolean,
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
    // Capabilities-only (architecture mode) never touches story state.
    const isCapabilityChangeRefresh = !!previousIdeas && previousIdeas.length > 0;
    if (capabilitiesOnly) {
      // No idea skeletons — the only visible effect is the picker's loading dim.
    } else if (!isCapabilityChangeRefresh) {
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
      // Build capability inputs. In workshop mode, exclude the caps the
      // workshop can't build so the suggest LLM never proposes them.
      const hidden = modeRef.current === "workshop" ? workshopHiddenIdsRef.current : null;
      const capabilityInputs: CapabilityInput[] = caps
        .filter((cap) => !hidden || !hidden.has(cap.id))
        .map((cap) => ({
          id: cap.id,
          status: explicit.get(cap.id) ?? null,
        }));

      // Stream events. Read context text via ref so this function keeps
      // its stable identity (see the deps-via-refs note at the bottom).
      for await (const event of streamSuggestCapabilities(
        promptText.trim(),
        capabilityInputs,
        abortController.signal,
        refineIdea,
        refineComment,
        previousIdeas,
        previousCapabilities,
        buildContextTextRef.current(),
        undefined, // datasources — home page has no diagram yet
        capabilitiesOnly,
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
            // In workshop mode, drop anything the workshop can't build even if
            // the LLM suggested it (apps, lakebase, KA, MAS).
            return sanitizeSelection(next);
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
  // Re-fire the suggestion when files change too — `lastTopicRef` alone
  // would early-return if the user only dropped a file. We hash the
  // filename list so identity changes only when the file SET changes
  // (not on every re-render where uploadedFiles is the same array).
  const uploadedFilesKey = uploadedFiles.map((f) => f.filename).join("|");
  const lastUploadKeyRef = useRef("");
  const capabilitiesReady = capabilities.length > 0;
  const lastModeRef = useRef<string>("");
  useEffect(() => {
    const trimmedTopic = topic.trim();
    // Trigger if the topic, the file set, OR the entry mode changed (switching
    // story ↔ architecture reruns the stream in the right shape — e.g. text
    // typed in story mode should auto-select components on the arch tab).
    if (
      trimmedTopic === lastTopicRef.current
      && uploadedFilesKey === lastUploadKeyRef.current
      && mode === lastModeRef.current
    ) {
      return;
    }
    lastTopicRef.current = trimmedTopic;
    lastUploadKeyRef.current = uploadedFilesKey;
    lastModeRef.current = mode;

    const hasFiles = uploadedFiles.length > 0;
    // Need EITHER 3+ chars of topic OR at least one file. A file with no
    // typed text gets a generic prompt — the backend sees the file
    // content via context_text and picks ideas from it.
    // Pro mode skips suggestion entirely (story tab only). The ARCHITECTURE
    // tab streams too — but in capabilities-only mode: the LLM auto-selects
    // the matching components in the picker, no story ideas.
    const archMode = mode === "architecture";
    if ((trimmedTopic.length < 3 && !hasFiles) || !capabilitiesReady || (!archMode && proMode)) {
      setIsSuggestingCapabilities(false);
      return;
    }

    setIsSuggestingCapabilities(true);

    const effectivePrompt = trimmedTopic.length >= 3
      ? trimmedTopic
      : archMode
        ? "Suggest architecture components based on the uploaded files."
        : "Suggest demos based on the uploaded files.";

    const timer = setTimeout(() => {
      runSuggestionStream(
        effectivePrompt,
        undefined,
        undefined,
        undefined,
        undefined,
        archMode, // capabilities-only in architecture mode
      );
    }, 1000);

    return () => {
      clearTimeout(timer);
      // Don't abort the in-flight stream here — the next call to
      // runSuggestionStream() does it itself, and aborting here would
      // also fire on unmount/StrictMode-double-mount and look like a
      // mid-stream cancel to the user.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, capabilitiesReady, uploadedFilesKey, proMode, mode]);

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

    // Story + workshop modes: refresh story ideas on selection change. In
    // architecture mode there are no stories to refresh — a toggle just pins
    // the user's choice locally (the LLM already ran).
    if (topic.trim().length < 3 || !capabilitiesReady || proMode || (mode !== "story" && mode !== "workshop")) {
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
  }, [explicitSelections, capabilitiesReady, selectedProducts, mode]);

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
    architectureFirst = false,
  ) => {
    e?.preventDefault();
    // In Pro mode the suggestion stream never ran, so there's no `idea` to
    // bind — the user's typed prompt + their picked capabilities are the
    // entire contract. Caller still passes `undefined` for `idea`; we just
    // ignore it explicitly below to keep the flow obvious.
    const effectiveIdea = proMode ? undefined : idea;
    // Allow creating with only files (no typed text) — the description
    // falls back to the picked idea's hook (which was generated from the
    // file content) or to a file-only summary string. Pro mode REQUIRES
    // typed text (or files) since there's no idea fallback.
    if (isCreating || (!topic.trim() && !effectiveIdea && uploadedFiles.length === 0)) return;

    // Capabilities are always from selectedProducts (shared across all ideas).
    // Sanitize for workshop mode — never ship apps/lakebase/KA/MAS into a
    // Genie Code workshop even if the LLM or a stale selection included them.
    const capabilityIds = Array.from(sanitizeSelection(selectedProducts));

    setIsCreating(true);
    setCreateError(null);
    try {
      // Build description: if we have an idea, use it; otherwise use raw topic
      let description: string;

      if (effectiveIdea) {
        // Use the idea's title + hook as description
        description = `${effectiveIdea.title}\n\n${effectiveIdea.hook}`;
        if (effectiveIdea.datasources && effectiveIdea.datasources.length > 0) {
          description += `\n\nData sources: ${effectiveIdea.datasources.join(", ")}`;
        }
      } else if (topic.trim().length > 0) {
        // Raw topic mode
        description = topic.trim();
      } else {
        // File-only mode — synthesize a placeholder from the filenames.
        // The backend's name/schema LLM call needs SOMETHING in description;
        // the agent gets the actual content via the context/uploads files.
        description = `Solution from uploaded files: ${uploadedFiles.map((f) => f.filename).join(", ")}`;
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
      if (architectureFirst) {
        // Architecture-first entry: the user wants to START by laying out an
        // architecture diagram — NOT a story. Their text can be anything
        // (a tidy prompt, pasted meeting notes, a transcript). The agent
        // should extract the platform components it implies and write ONLY
        // `architecture.md`, then stop. SKILL.md has the matching path.
        // The capability picker IS shown in architecture mode (defaulting to
        // the Simple-demo baseline), so the selection is deliberate — the
        // diagram must reflect exactly it, not resources.json defaults.
        const archCapsLine = capabilityIds.length > 0
          ? `\n\nThe user explicitly selected these capabilities for the diagram: ${capabilityIds.join(", ")}. The architecture must show exactly these (plus the data sources their text implies) — do not add other capabilities.`
          : "";
        initialPrompt =
          `The user wants to START by creating an architecture diagram (architecture-first flow) — not a story yet.\n\n` +
          `What they wrote (may be a tidy brief OR pasted notes / a transcript — extract intent from it):\n${topic.trim() || description}` +
          archCapsLine +
          `\n\nFollow the architecture-first path in SKILL.md: read the databricks-architecture skill (\`.claude/skills/databricks-architecture/SKILL.md\`), extract the main components, and write ONLY \`architecture.md\` at the project root. Do not design a story, write specs, or build resources yet — produce the diagram and stop so the user can review/edit it on the Architecture tab.`;
      } else if (mode === "workshop") {
        // Workshop (Genie Code) mode: same story + spec design as a normal
        // build, but the BUILD stage forks — instead of provisioning Databricks
        // resources, the agent generates a hands-on notebook workshop the SA
        // hands to a customer (build-it-live via Genie Code prompts). SKILL.md's
        // workshop path + references/example-luxebeauty-workshop are the guide.
        const ideaHeader = effectiveIdea
          ? `\n\n**${effectiveIdea.title}**\n\n${effectiveIdea.hook}`
          : "";
        initialPrompt =
          `Help me prepare a Genie Code WORKSHOP (not a standard built demo).\n\n` +
          `User request:\n${topic.trim() || description}${ideaHeader}${authoritativeCapsLine}\n\n` +
          `Follow the WORKSHOP path in SKILL.md: design the story + write the specs as usual, ` +
          `but at the Build stage take the workshop fork — generate a clean set of Databricks ` +
          `notebooks whose cells are Genie Code prompts the SA pastes to build the demo live ` +
          `(raw data → SDP → dashboard → Genie), plus the data-generation script and the Genie ` +
          `context. Use \`references/example-luxebeauty-workshop\` as the pattern. Do NOT provision ` +
          `Databricks resources — the deliverable is the downloadable notebook package.`;
      } else if (effectiveIdea) {
        initialPrompt = `Help me build a databricks solution.\n\nUser request:\n${topic.trim()}\n\n**${effectiveIdea.title}**\n\n${effectiveIdea.hook}${authoritativeCapsLine}`;
      } else {
        // Pro mode (or auto mode with no idea picked yet): just the user's
        // typed text. The agent receives the prompt as-is — no auto-generated
        // story narrative inserted on top.
        initialPrompt = `Help me build a databricks solution.\n\nSolution description:\n${topic.trim() || description}${authoritativeCapsLine}`;
      }

      // File context — call out the uploads so the agent knows to read them
      // from `context/uploads/` on its first investigation pass. The
      // backend wrote both the raw original AND a `.extracted.md` sibling
      // for each file; the agent can pick whichever is more useful.
      if (uploadedFiles.length > 0) {
        const fileList = uploadedFiles
          .map((f) => `- ${f.filename}${f.truncated ? " (truncated)" : ""}`)
          .join("\n");
        initialPrompt +=
          `\n\nThe user uploaded ${uploadedFiles.length} file(s) as ` +
          `context — they live at \`context/uploads/\` in the project. ` +
          `Read the \`.extracted.md\` siblings (already text-extracted) ` +
          `before designing the story so it fits what's actually in them:\n${fileList}`;
      }

      // Auto mode: append the kickoff directive so the agent runs every stage
      // (DRAFTING → DEPLOYED) without prompting. The topic/idea header above
      // gives the agent its build subject — AUTO_BUILD_KICKOFF alone would
      // tell it to inspect existing project files, but on a fresh project
      // nothing exists yet.
      // Architecture-first stops after the diagram, so never append the
      // full build kickoff there.
      if (autoMode && !architectureFirst) {
        initialPrompt += `\n\n---\n\n${AUTO_BUILD_KICKOFF}`;
      }

      // Backend will generate name and schema from description using LLM.
      // Passing capabilityIds scopes which ai-dev-kit skills get copied into the project.
      // Passing initialPrompt persists the opening message as a real user Message so it
      // shows up as the first chat bubble on load — no URL-param round-trip, no race.
      // Passing contextFiles writes the originals + .extracted.md siblings
      // under context/uploads/ in the new project's dir.
      const project = await createProject(
        description,
        capabilityIds,
        initialPrompt,
        uploadedFiles.length > 0 ? uploadedFiles : undefined,
        // Persisted flag: the workspace opens on the Architecture tab and shows
        // the "Build the solution" CTA until the build is kicked off there.
        architectureFirst,
        // Entry mode — drives the agent's Build fork (workshop → notebooks).
        mode,
      );

      // Per-session preference: Pro mode resets after each create so the
      // next project starts in the default Auto flow with story ideas.
      setProMode(false);

      navigate({
        to: "/project/$projectId",
        params: { projectId: project.id },
        // Architecture-first: land straight on the Architecture tab so the
        // user watches the diagram build there — not the "writing the pitch"
        // overview waiting view.
        search: architectureFirst ? { tab: "architecture" } : undefined,
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

  const handleToggleStar = async (
    e: React.MouseEvent,
    project: ProjectListItem
  ) => {
    e.stopPropagation();
    try {
      const result = await toggleProjectStar(project.id);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, is_starred: result.starred } : p
        )
      );
    } catch (err) {
      console.error("Failed to toggle star:", err);
    }
  };

  // Starred projects float to the top of the recent list (stable otherwise).
  const sortedProjects = [...projects].sort(
    (a, b) => Number(b.is_starred) - Number(a.is_starred)
  );

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

          {/* Tabs + input card as ONE unit (own wrapper) so the parent's
              space-y-6 doesn't open a gap between the folder tabs and the card.
              Real folder tabs on the top-left: the active tab shares the card's
              surface + border with no bottom edge, so it reads as one connected
              panel. "story" (current flow) vs "architecture" (lead-with-
              architecture: prompt + button). */}
          <div className="w-full">
          <div className="flex w-full items-end pl-3">
            {([
              { v: "story" as const, label: "Describe your story" },
              { v: "architecture" as const, label: "Describe your architecture" },
              { v: "workshop" as const, label: "Genie Code workshop" },
            ]).map((t) => {
              const active = mode === t.v;
              return (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setMode(t.v)}
                  className={cn(
                    "relative -mb-px cursor-pointer rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition-colors",
                    active
                      ? "z-10 border-primary/10 bg-card/80 text-foreground backdrop-blur-md"
                      : "border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Input card. Drag-drop wraps the whole card so the user can
              drop files anywhere over the textarea / chip area. The
              isDragOver state pulses the border so the drop target is
              obvious. */}
          <Card
            className={cn(
              "w-full text-left backdrop-blur-md bg-card/80 shadow-lg shadow-primary/5 transition-colors",
              isDragOver
                ? "border-primary/60 ring-2 ring-primary/30"
                : "border-primary/10",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              // Only flip off when the drag actually leaves the card
              // (not when crossing internal element boundaries).
              if (e.currentTarget === e.target) setIsDragOver(false);
            }}
            onDrop={handleDrop}
          >
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
                {/* Textarea + attach button on a single row. The button
                    is `items-end` so it stays aligned to the bottom of
                    the textarea as it auto-grows (otherwise it'd drift
                    upward and stop reading as "attached to the input"). */}
                <div className="flex items-end gap-2">
                  <Textarea
                    ref={textareaRef}
                    placeholder={
                      mode === "architecture"
                        ? 'Describe your architecture... e.g. "ingest ERP data to a final business application"'
                        : 'Describe your project... e.g. "predictive maintenance for wind turbines"'
                    }
                    value={topic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      adjustTextareaHeight();
                    }}
                    className="min-h-12 text-lg md:text-lg bg-background/60 resize-none overflow-hidden flex-1"
                    rows={1}
                    autoFocus
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.csv,.xlsx,.docx,.md,.txt,.json,.yaml,.yml,.html,.xml,.log"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void handleFiles(e.target.files);
                      // Reset so the same file can be re-picked after remove.
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center size-12 rounded-md border border-border bg-background/60 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer",
                      isUploading && "opacity-60 cursor-wait",
                    )}
                    title="Attach files (PDF, CSV, XLSX, DOCX, MD, TXT)"
                    aria-label="Attach files"
                  >
                    {isUploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </button>
                </div>

                {/* Per-mode tip — the input accepts anything, not just a tidy
                    brief. Sets expectations for what the agent produces. */}
                {mode === "architecture" && (
                  <p className="text-xs text-muted-foreground">
                    💡 Paste anything — a rough idea, meeting notes, or a
                    transcript. We'll pull out the components and lay out a
                    starting architecture you can edit.
                  </p>
                )}
                {mode === "story" && (
                  <p className="text-xs text-muted-foreground">
                    💡 Paste anything and refine the story — the agent will build
                    all the Databricks resources for you.
                  </p>
                )}
                {mode === "workshop" && (
                  <p className="text-xs text-muted-foreground">
                    💡 Paste anything and refine the story — the agent will
                    prepare the Genie Code prompts for you to build the resources.
                  </p>
                )}

                {/* Chips row — only renders when files are attached or an
                    upload error occurred, so the layout stays compact
                    on cold start. */}
                {(uploadedFiles.length > 0 || uploadError) && (
                  <div className="space-y-1.5">
                    {uploadedFiles.length > 0 && (
                      <div className="flex items-start gap-2 flex-wrap">
                        {uploadedFiles.map((f, i) => (
                          <FileUploadChip
                            key={`${f.filename}-${i}`}
                            file={f}
                            onRemove={() => handleRemoveFile(i)}
                          />
                        ))}
                      </div>
                    )}
                    {uploadError && (
                      <div className="flex items-start gap-1.5 text-xs text-destructive">
                        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                        <span>{uploadError}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Ideas section header — toggles row renders whenever the
                    hero is collapsed (user has typed or attached files).
                    In Pro mode the ideas grid below is skipped entirely
                    and the header label switches to a "manual mode" hint.
                    Story-tab only — the architecture tab shows just the
                    prompt + a single "Create my architecture" button. */}
                {isHeroCollapsed && (mode === "story" || mode === "workshop") && (
                  <div className="pt-2 pb-1">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">
                          {proMode
                            ? "Pro mode — pick your capabilities below"
                            : isSuggestingCapabilities
                              ? "Generating story ideas..."
                              : ideas.length === 1
                                ? "Your solution story"
                                : "Choose a story direction"}
                        </span>
                        {/* Regenerate stories — paired with the title so it
                            reads as part of the "your stories" header.
                            Hidden in Pro mode (no stories to regenerate). */}
                        {!proMode && ideas.length > 0 && !isSuggestingCapabilities && (
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
                      {/* Auto-build toggle + Pro mode link.
                          - Auto mode (checkbox): when on, the agent runs
                            every build stage end-to-end without prompts.
                          - Pro mode (link): skips story-suggestion UX. User
                            picks capabilities by hand, agent gets the typed
                            prompt as-is. Resets after each create. */}
                      <div className="flex items-center gap-3">
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
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setProMode((v) => !v)}
                                className={cn(
                                  "text-xs underline-offset-2 hover:underline transition-colors cursor-pointer",
                                  proMode
                                    ? "text-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                                aria-pressed={proMode}
                              >
                                {proMode ? "Pro mode · on" : "Pro mode"}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="end" className="max-w-xs">
                              <p className="text-xs leading-relaxed">
                                <strong>Pro mode</strong> skips the auto-generated
                                story ideas. Type exactly what you want, pick the
                                capabilities below, and the agent gets your prompt
                                as-is. Resets after each create.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    {/* Initial loading state before count arrives — hidden
                        in Pro mode (no suggestion stream runs). */}
                    {!proMode && isSuggestingCapabilities && expectedIdeaCount === 0 && ideas.length === 0 && (
                      <div className="flex items-center justify-center min-h-[180px] rounded-lg border border-border bg-card/50">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                          <span className="text-xs">Analyzing your request...</span>
                        </div>
                      </div>
                    )}
                    {/* Story-ideas grid — entirely skipped in Pro mode.
                        The CapabilitiesPanel below becomes the source of
                        truth for what gets built; the typed prompt is what
                        the agent receives. */}
                    {!proMode && (
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
                    )}
                  </div>
                )}

                {/* Capabilities panel — tabs between a curated "Simple
                    Databricks demo" baseline and the full "Custom solution"
                    selector. Both tabs write to the same selectedProducts
                    set so the downstream build CTA / confirm dialog are
                    unchanged. Story-tab only. */}
                {(mode === "story" || mode === "workshop") && (
                  <CapabilitiesPanel
                    capabilities={visibleCapabilities}
                    selectedProducts={selectedProducts}
                    onToggleProduct={handleToggleProduct}
                    onReplaceSelection={handleReplaceSelection}
                    expanded={isHeroCollapsed}
                    isLoading={isSuggestingCapabilities}
                    explicitSelections={explicitSelections}
                    hideAppBundle={mode === "workshop"}
                  />
                )}

                {/* Architecture mode — the FULL component picker (no
                    Simple/Custom tabs), with the simple-demo baseline
                    pre-selected (see the seed effect). The selection is what
                    the agent draws in the initial architecture.md. */}
                {mode === "architecture" && (
                  <ProductSelector
                    capabilities={capabilities}
                    selectedProducts={selectedProducts}
                    onToggleProduct={handleToggleProduct}
                    expanded={isHeroCollapsed}
                    // Dim the tiles while the capabilities-only LLM pass is
                    // auto-selecting components from the typed description.
                    isLoading={isSuggestingCapabilities}
                    explicitSelections={explicitSelections}
                    title="Select the architecture components you want to see"
                  />
                )}

                {/* Architecture tab — once the user has typed (or attached
                    files), show the "Create my architecture" button below the
                    capability picker. No story ideas, no templates. */}
                {mode === "architecture" && isHeroCollapsed && (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleCreateProject(undefined, undefined, true)}
                      disabled={
                        isCreating ||
                        (!topic.trim() && uploadedFiles.length === 0)
                      }
                      className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold transition-all bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                    >
                      <Sparkles className="h-4 w-4" />
                      Create my architecture
                    </button>
                  </div>
                )}

                {/* Primary CTA — direct create. Capability set is fully
                    user-visible (locked baseline in Simple, granular tile
                    in Custom), so no confirm dialog is needed.
                    Shows in Auto mode once at least one idea has streamed
                    in, OR in Pro mode as soon as the user has typed (no
                    ideas exist in Pro). Story-tab only. */}
                {(mode === "story" || mode === "workshop") && isHeroCollapsed && (proMode || ideas.length > 0) && (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCreateProject(undefined, ideas[selectedIdeaIdx])
                      }
                      disabled={
                        isCreating
                        // Auto-mode-only: don't allow create while the
                        // suggestion stream is still resolving (the user
                        // hasn't seen what they're picking yet). Pro mode
                        // never runs the suggestion stream, so skip this.
                        || (!proMode && isSuggestingCapabilities)
                        // Pro mode requires typed text (or files) since
                        // there's no idea fallback. Auto mode accepts any
                        // of typed text / picked idea / uploaded files.
                        || (
                          proMode
                            ? !topic.trim() && uploadedFiles.length === 0
                            : !topic.trim() && !ideas[selectedIdeaIdx] && uploadedFiles.length === 0
                        )
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
                        : proMode
                          ? "Build this solution"
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
          </div>

          {/* Research agent callout - hidden when collapsed */}
        </div>

        {/* Matching templates section — story-tab only (the architecture
            tab leads with a single create button, no templates). */}
        {mode === "story" && topic.trim().length >= 3 && (
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

        {/* Pending share invitations — above Recent Projects. Renders nothing
            when there are none. Data comes from the single getHomeProjects call. */}
        <ProjectInvitations
          className="relative z-10 mx-auto mt-12 w-full max-w-5xl"
          invitations={invitations}
          onResponded={(projectId, accepted) => {
            setInvitations((prev) => prev.filter((i) => i.project_id !== projectId));
            if (accepted) {
              // Pull the newly-accepted project into "Shared with Me".
              getHomeProjects()
                .then((home) => setSharedProjects(home.shared))
                .catch(() => {});
            }
          }}
        />

        {/* Recent projects (starred first) */}
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
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => navigate({ to: "/projects" })}
                >
                  <FolderOpen className="h-4 w-4" />
                  View all ({projects.length})
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedProjects.slice(0, 3).map((project) => (
                <ProjectTile
                  key={project.id}
                  project={project}
                  onClick={() => handleOpenProject(project.id)}
                  onToggleStar={(e) => handleToggleStar(e, project)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Shared with Me — below Recent Projects. Renders nothing when empty. */}
        <SharedWithMe
          className="relative z-10 mx-auto mt-12 w-full max-w-5xl"
          projects={sharedProjects}
        />

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
