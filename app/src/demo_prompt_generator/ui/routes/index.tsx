import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/layout/navbar";
import { BubbleBackground } from "@/components/backgrounds/bubble";
import { ProjectsWorkSection } from "@/components/project/projects-work-section";
import { TemplateGallerySheet } from "@/components/template/gallery/template-gallery-sheet";
import {
  CapabilitiesPanel,
  buildSimpleExplicit,
  buildSimpleSelected,
} from "@/components/capabilities-panel";
import { GroundingTablePicker } from "@/components/project/grounding-table-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { DatabricksAnimatedLogo } from "@/components/databricks-animated-logo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  Lightbulb,
  Loader2,
  Maximize2,
  HelpCircle,
  Library,
  Database,
  Table2,
  ChevronRight,
  Paperclip,
  Pencil,
  Send,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  getHomeProjects,
  createProject,
  toggleProjectStar,
  extractFiles,
  createProjectFromTemplate,
  getMe,
  getCapabilities,
  streamSuggestCapabilities,
  listTemplates,
  searchTemplates,
  templateScreenshotUrl,
  cloneProject,
  respondToShare,
  type ProjectListItem,
  type ProjectShareOut,
  type TemplateDetail,
  type TemplateListItem,
  type Capability,
  type CapabilityInput,
  scanGroundingTables,
  getWorkspaceInfo,
  ucExploreUrl,
  type WorkspaceInfo,
  type UseCaseIdea,
  type IdeaToRefine,
  type UploadedFile,
  type DiscoveryInput,
  type DiscoveryIdeaInput,
} from "@/lib/custom-api";
// Deploy-target control (Tier-2 "scale" feature) — a portable, self-contained
// module. All the target state + API calls live inside it; the home page just
// mounts it.
import { DeployTargetControl } from "@/components/remote-deploy/DeployTargetControl";
import { FileUploadChip } from "@/components/file-upload-chip";
import { clipboardHasText, clipboardImages } from "@/lib/pasted-images";
import {
  AUTO_BUILD_KICKOFF,
  BRAND_NOTE,
  buildArchitectureFirstPrompt,
  buildUploadsNote,
  DIAGRAM_STYLES,
  type DiagramStyle,
} from "@/lib/auto-build-prompt";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScanPromptDialog } from "@/components/scan-prompt-dialog";
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

// Seed prompts shown as "Try:" chips under the input when it's empty. Clicking
// one fills the box so a first-time user isn't staring at a blank prompt with no
// idea what "good" looks like. Kept short + industry-diverse on purpose.
// Example prompts shown under the input. Each is worded to MATCH a validated
// template in initial_templates/ (via the template search's name/industry
// tokens), so clicking one surfaces a demo we know works well as the lead card:
//   "customer support" → AI/BI Customer Support
//   "supply chain"     → AI/BI Supply Chain Optimization
//   "sales pipeline"   → AI/BI Sales Pipeline Review
//   "healthcare"       → Healthcare CFO — Budget Variance
const EXAMPLE_PROMPTS = [
  "Customer support AI efficiency",
  "Supply chain optimization",
  "Sales pipeline review",
  "Healthcare cost & budget variance",
];

// The Architecture tab's examples: one per diagram style, and clicking one also
// picks that style, so each chip shows what the style is for.
const ARCH_EXAMPLE_PROMPTS: { text: string; style: DiagramStyle }[] = [
  { text: "Real-time fraud detection for a bank", style: "marketing" },
  { text: "Redshift to Databricks migration, current vs proposed", style: "technical" },
  { text: "MLOps lifecycle for a churn model", style: "lifecycle" },
  { text: "Databricks on AWS with PrivateLink", style: "networking" },
];

/** Stable signature of an explicit-selection map (sorted, order-free). */
function explicitKey(m: Map<string, "selected" | "unselected">): string {
  return Array.from(m.entries())
    .map(([id, st]) => `${id}=${st}`)
    .sort()
    .join("|");
}

/** A UC table shown as a chip. Deep-links to Catalog Explorer when the
 *  workspace host is known; otherwise renders as plain text. Shows the table
 *  name (last segment) with the full catalog.schema.table on hover.
 *  `stopPropagation` so clicking inside a selectable idea card opens the link
 *  without also selecting the card. */
function TableChip({
  fullName,
  info,
  className,
  full = false,
}: {
  fullName: string;
  info: WorkspaceInfo | null;
  className?: string;
  /** Show the full catalog.schema.table (detail views) instead of just the
   *  table name. */
  full?: boolean;
}) {
  const href = ucExploreUrl(info, fullName.split("."));
  const text = full || !fullName.includes(".") ? fullName : fullName.split(".").pop();
  const base = cn(
    "inline-flex items-center truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
    !full && "max-w-[10rem]",
    className,
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open ${fullName} in Catalog Explorer`}
        onClick={(e) => e.stopPropagation()}
        className={cn(base, "underline-offset-2 hover:underline")}
      >
        {text}
      </a>
    );
  }
  return (
    <span title={fullName} className={base}>
      {text}
    </span>
  );
}

function Index() {
  const [topic, setTopic] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [sharedProjects, setSharedProjects] = useState<ProjectListItem[]>([]);
  const [invitations, setInvitations] = useState<ProjectShareOut[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Builds always run end-to-end now (the "pace"/review-each-step control was
  // removed from the home page). Kept as a constant so the create path reads
  // the same flag; reintroduce a setter if a review-mode toggle comes back.
  const autoMode = true;
  // Pro mode: skip the story-suggestion UX entirely. The user types what they
  // want, picks capabilities manually, and the agent gets only that as the
  // initial prompt — no auto-generated story ideas, no idea hook prepended.
  // Always resets on successful project creation (per-session preference,
  // not sticky).
  const [proMode, setProMode] = useState(false);
  // The full-vs-diagram choice. Kept for the deep-link handling
  // (`?start=architecture` sets mode, and this tracks it for consistency).
  // Not used in the UI after the shape dialog removal. Can be repurposed
  // for future output-preference logic.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_outputKind, setOutputKind] = useState<"full" | "diagram">("full");
  // "Use synthetic data" (story tab only). ON (default) = today's flow: the
  // agent invents a use case and generates fully synthetic data. OFF = build the
  // demo DIRECTLY on real Unity Catalog tables, READ-ONLY: the user picks
  // catalogs/schemas/tables below, the agent derives one use case that runs on
  // them, confirms it, then points every component at those exact tables in place
  // (no synthetic data, no copies, never written to).
  // Catalogs and schemas are multi-select; schemas are catalog-qualified
  // ("catalog.schema") so same-named schemas across catalogs stay distinct.
  const [useSyntheticData, setUseSyntheticData] = useState(true);
  const [groundingCatalogs, setGroundingCatalogs] = useState<string[]>([]);
  const [groundingSchemas, setGroundingSchemas] = useState<string[]>([]);
  const [groundingTables, setGroundingTables] = useState<string[]>([]);
  // "Use existing data" opt-in. OFF (default) → the demo is READ-ONLY analytics
  // on the real tables (no data generated). ON → the demo may create its OWN
  // auxiliary data so write-needing capabilities work; the real tables stay
  // read-only regardless. Threaded into the suggest stream + createProject.
  const [allowDataWrite, setAllowDataWrite] = useState(false);
  const allowDataWriteRef = useRef(allowDataWrite);
  useEffect(() => {
    allowDataWriteRef.current = allowDataWrite;
  }, [allowDataWrite]);
  // The "Use existing data" popup (opened from the top-right data toggle on the
  // input card). Holds the GroundingTablePicker; "Generate a story" scans the
  // picked tables + grounds the suggestion stream in them.
  const [groundingOpen, setGroundingOpen] = useState(false);
  // True while POST /grounding/scan is warming the server-side stats cache.
  const [isScanningTables, setIsScanningTables] = useState(false);
  // Live status shown on the "Analyze data" button while scanning — reflects what
  // the backend is actually doing (starting the SQL warehouse vs reading tables,
  // k of N done) instead of a blank spinner.
  const [scanStatus, setScanStatus] = useState<string>("");
  // Connected workspace host + id → Catalog Explorer deep links for table
  // names (grounded flow). Best-effort: null → chips render as plain text.
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getWorkspaceInfo()
      .then((info) => {
        if (!cancelled) setWorkspaceInfo(info);
      })
      .catch(() => {
        /* no workspace host → links just won't render */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Entry mode, driven by the 3 top tabs (restored): "story" = the normal
  // build fork + story-suggestion path, "architecture" = diagram-first,
  // "workshop" = Genie Code workshop (a private-preview story flow: 3 ideas,
  // the workshop capability pool, and the agent writes one HTML workshop page
  // the attendee builds live). The full-vs-diagram output choice for the story
  // flow is still tracked by `outputKind` and routed through
  // handleCreateProject's `architectureFirst`.
  // `?mode=architecture` opens the Architecture tab (the showcase's "Try it yourself").
  const [scanOpen, setScanOpen] = useState(false);
  const [mode, setMode] = useState<"story" | "architecture" | "workshop">(() =>
    new URLSearchParams(window.location.search).get("mode") === "architecture" ? "architecture" : "story");
  // Simple vs Custom tab of the capability panel — Custom stacks the layout.
  const [capabilityTab, setCapabilityTab] = useState<"simple" | "custom">("simple");
  // Story-idea modes (story + workshop) share the idea grid, capability picker
  // and create CTA. Architecture has none of them.
  const hasStories = mode === "story" || mode === "workshop";
  // Deep-link from the welcome guide's start cards: `?start=architecture`
  // selects the Architecture tab (+ the diagram output preference),
  // `?start=workshop` the Genie Code workshop tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const start = new URLSearchParams(window.location.search).get("start");
      if (start === "architecture") {
        setMode("architecture");
        setOutputKind("diagram");
      } else if (start === "workshop") {
        setMode("workshop");
      }
    } catch {
      // URL unavailable — leave the defaults.
    }
  }, []);
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
  // Index of the card whose single-idea refine is streaming. Drives the
  // per-card "Refining…" overlay: on submit `refiningIdeaIdx` is cleared (the
  // inline input + its send spinner disappear), and single-refine deliberately
  // never flips the global `isRefiningStories`/`isSuggestingCapabilities`
  // skeletons — so without this the card would sit static for the whole stream.
  const [refineActiveIdx, setRefineActiveIdx] = useState<number | null>(null);
  // Expanded-idea modal: which idea (by index) is open full-screen for reading
  // + iterating on. Null = closed. The modal reuses the same refine plumbing
  // (handleRefineSubmit) so edits stream back into the shared `ideas` array and
  // the expanded view updates live.
  const [expandedIdeaIdx, setExpandedIdeaIdx] = useState<number | null>(null);
  const [expandRefineText, setExpandRefineText] = useState("");
  // Snapshot of the expanded idea's content. Single-idea refine now replaces
  // `ideas[expandedIdeaIdx]` in place (never empties the array), so the modal
  // no longer flickers out mid-refine. The snapshot is kept as a stable render
  // source: it survives a whole-grid re-stream (capability-change refresh does
  // atomic-swap the array) and lets the modal render under the loading overlay
  // without indexing into a transiently-shorter `ideas`.
  const [expandedIdeaSnapshot, setExpandedIdeaSnapshot] = useState<UseCaseIdea | null>(null);

  // Template detail sheet + fork state.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isForking, setIsForking] = useState(false);

  // Templates surfaced INTO the "choose a starting point" carousel alongside AI
  // ideas. We load the full approved list once (it carries has_screenshot etc.)
  // then semantic-search returns ranked ids we resolve back against that list —
  // so thumbnails survive (TemplateSearchResult itself has no screenshot flag).
  const [allTemplates, setAllTemplates] = useState<TemplateListItem[]>([]);
  const [matchedTemplateIds, setMatchedTemplateIds] = useState<string[] | null>(null);
  // True while the (independent, debounced) template search is in flight — the
  // grid shows a template-shaped skeleton in the lead slot until it resolves.
  const [isSearchingTemplates, setIsSearchingTemplates] = useState(false);

  // Fork a template into a new editable project (as-is — adapt happens post-fork
  // via the "Make this demo yours" band on the project overview).
  const handleForkTemplate = async (template: TemplateDetail) => {
    setIsForking(true);
    try {
      const project = await createProjectFromTemplate(template.id, template.name);
      navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    } catch (error) {
      console.error("Failed to fork template:", error);
      setIsForking(false);
    }
  };

  // Home-page file upload — drag-drop or paperclip-pick. The backend
  // extracts text once; we hold the result here and ship it BOTH to the
  // suggest stream (as `context_text`) and to createProject (as
  // `context_files`). Reset cleanly when the user starts a new project.
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  // Architecture-tab diagram style. `null` = the user hasn't picked one yet, so it
  // follows the default: "match" when an image is attached, else "marketing".
  const [archStyleChoice, setArchStyleChoice] = useState<DiagramStyle | null>(null);
  const hasImageUpload = uploadedFiles.some((f) => f.content_type.startsWith("image/"));
  // "match" is only offered (and only honoured) when an image is attached.
  const archStyleOptions = DIAGRAM_STYLES.filter((s) => s.id !== "match" || hasImageUpload);
  const archStyle: DiagramStyle =
    archStyleChoice && archStyleOptions.some((s) => s.id === archStyleChoice)
      ? archStyleChoice
      : hasImageUpload ? "match" : "marketing";
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  // Check if hero should be collapsed (→ surface the ideas/carousel). Any of:
  // the user typed something, dropped a file, OR ran the "use existing schema"
  // flow (picked tables / a grounded suggestion is running/streamed). The last
  // one matters because a grounded story needs NO typed text — the schema
  // carries it — so without this the carousel would stay hidden with an empty box.
  const isHeroCollapsed =
    topic.trim().length >= 3
    || uploadedFiles.length > 0
    || (!useSyntheticData && groundingTables.length > 0)
    || ideas.length > 0
    || isSuggestingCapabilities;

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      const maxHeight = 200; // Max height in pixels before the box scrolls
      textarea.style.height = "auto";
      const next = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${next}px`;
      // Once we've hit the cap, let the box SCROLL its own content instead of
      // clipping it (overflow-hidden made long prompts un-scrollable). Toggling
      // overflow only at the boundary also kills the auto↔max height flicker
      // that jittered the page while typing near the cap.
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
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
      setUploadedFiles((prev) => {
        // The same image pasted (or picked) twice is skipped.
        const seen = new Set(prev.map((f) => f.original_b64).filter(Boolean));
        return [
          ...prev,
          ...extracted.filter((f) => {
            if (!f.original_b64 || !f.content_type.startsWith("image/")) return true;
            if (seen.has(f.original_b64)) return false;
            seen.add(f.original_b64);
            return true;
          }),
        ];
      });
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
  // (Architecture mode no longer seeds/uses a capability selection — the diagram
  // is inferred from the user's words, not a preset picker. See the suggest
  // effect + the architecture-first prompt.)

  // Workshop mode seed: every entry into the workshop tab starts on the Simple
  // workshop (the locked baseline, same as the panel's Simple tab — this effect runs
  // after the panel's own lock, so it must agree). Custom workshop re-seeds from
  // WORKSHOP_BASELINE, explicitly selected (see CapabilitiesPanel).
  useEffect(() => {
    if (mode !== "workshop") return;
    setProMode(false);
    const pool = capabilities.filter((c) => c.genie_code_workshop === true).map((c) => c.id);
    handleReplaceSelection(
      buildSimpleSelected(false, true),
      buildSimpleExplicit(pool, false, true),
    );
  }, [mode, handleReplaceSelection, capabilities]);

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

    // Approved template list — loaded once so the "start from a template" row
    // (and the below-fold featured carousel) have screenshot-bearing items to
    // resolve semantic-search rankings against.
    listTemplates("APPROVED")
      .then(setAllTemplates)
      // A silent failure here leaves allTemplates empty forever → template
      // matches never resolve. Log it (and retry once) so it's diagnosable.
      .catch((err) => {
        console.error("Failed to load templates:", err);
        setTimeout(() => {
          listTemplates("APPROVED")
            .then(setAllTemplates)
            .catch((e) => console.error("Template reload failed:", e));
        }, 3000);
      });
  }, []);

  // Debounced semantic search for the "start from a template" row. Fires off
  // the same `topic` as the idea stream but is fully independent (its own
  // debounce + cancel flag) — a slow/failed search never blocks ideas, and a
  // topic change clears stale matches. Ranked ids resolve against allTemplates.
  useEffect(() => {
    const q = topic.trim();
    if (q.length < 3) {
      setMatchedTemplateIds(null);
      setIsSearchingTemplates(false);
      return;
    }
    let cancelled = false;
    // Mark searching immediately (before the debounce) so the grid can show
    // a template skeleton in the lead slot while this independent call resolves.
    setIsSearchingTemplates(true);
    const timer = setTimeout(() => {
      // Only need the single best match.
      searchTemplates(q, 1)
        .then((results) => {
          if (cancelled) return;
          setMatchedTemplateIds(results.map((r) => r.id));
        })
        .catch(() => {
          if (!cancelled) {
            setMatchedTemplateIds(null);
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearchingTemplates(false);
        });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [topic]);

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
  // Workshop mode: the picker shows only the workshop pool (genie_code_workshop,
  // the backend allowlist). Pool caps are offered even where globally `disabled`
  // (story hides e.g. Notebooks & EDA, data-quality, abac). Story + architecture
  // see the raw list.
  const visibleCapabilities = useMemo(
    () =>
      mode === "workshop"
        ? capabilities
            .filter((c) => c.genie_code_workshop === true)
            .map((c) => (c.disabled ? { ...c, disabled: false } : c))
        : capabilities,
    [capabilities, mode],
  );
  // Ids outside the workshop pool (apps, lakebase, unstructured documents).
  // Load-bearing: hiding a tile in the picker does NOT remove it from the
  // selection, so we must actively strip these from any selection while in
  // workshop mode (LLM suggestions + create payload).
  const workshopHiddenIds = useMemo(
    () => new Set(capabilities.filter((c) => c.genie_code_workshop !== true).map((c) => c.id)),
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
    /** "Use existing data": fully-qualified UC tables to ground the ideas in.
     *  When set, the backend requires the story to use ONLY these tables. */
    groundingTables?: string[],
    /** Single-idea refine: the index in `ideas` to REPLACE with the one refined
     *  idea the backend returns. When set (alongside refineIdea), we update ONLY
     *  that idea in place and leave the OTHER ideas — and the capability set —
     *  untouched. Refining one story must never rewrite the rest. */
    refineIndex?: number,
  ) => {
    // Read latest values via refs (see RACE NOTE above).
    const caps = capabilitiesRef.current;
    const explicit = explicitSelectionsRef.current;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // The grounded flow ("Generate a story" on picked tables) is valid with an
    // EMPTY prompt — the tables carry the story. Only require typed text for the
    // ungrounded flows.
    const grounded = !!groundingTables && groundingTables.length > 0;
    if ((!promptText.trim() && !grounded) || caps.length === 0) {
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
    // Single-idea refine (from a card or the expanded modal): replace ONLY the
    // idea at refineIndex; never clear/re-skeleton the grid or touch the others.
    const isSingleRefine =
      !!refineIdea && refineIndex !== undefined && refineIndex >= 0;
    if (capabilitiesOnly) {
      // No idea skeletons — the only visible effect is the picker's loading dim.
    } else if (isSingleRefine) {
      // Keep the whole grid intact; the refined idea is swapped in place below.
      // The caller sets `refineActiveIdx` to this index, which drives the
      // target card's "Refining…" overlay while the stream runs.
    } else if (!isCapabilityChangeRefresh) {
      setIdeas([]);
      setExpectedIdeaCount(0);
      setSelectedIdeaIdx(0);
    } else {
      // Pre-fill skeletons with the right count so layout doesn't shift.
      setExpectedIdeaCount(previousIdeas!.length);
    }
    // Don't flip the global "suggesting" flag for a single refine — it would
    // skeleton/dim the other cards. The caller's `refineActiveIdx` overlay
    // gives the one target card its loading feedback instead.
    if (!isSingleRefine) setIsSuggestingCapabilities(true);

    // Reset accumulator BEFORE the stream starts (for the refresh path);
    // we replace ideas in-place as `idea` events arrive.
    let nextIdeas: UseCaseIdea[] = [];
    // Single-refine: apply ONLY the first idea event (best-fit-first) and ignore
    // any extras. The backend now returns exactly 1 for a grounded refine, but a
    // non-compliant model could still stream several — taking the first keeps the
    // refined idea deterministic instead of letting the last one win.
    let singleRefineApplied = false;

    try {
      // Build capability inputs. In workshop mode, drop the caps outside the
      // workshop pool so the suggest LLM never proposes them. Only explicit
      // toggles are locked: the workshop baseline is a DEFAULT selection, not a
      // lock, so the LLM can trim it to what the brief needs and add pool caps.
      const isWorkshop = modeRef.current === "workshop";
      const hidden = isWorkshop ? workshopHiddenIdsRef.current : null;
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
        groundingTables,
        grounded ? allowDataWriteRef.current : false,
        modeRef.current,
      )) {
        // Check if aborted
        if (abortController.signal.aborted) return;

        if (event.type === "count") {
          // Set expected count to show skeleton cards — but NOT for a single
          // refine (count=1 there would collapse the grid to one skeleton).
          if (!isSingleRefine) setExpectedIdeaCount(event.data.count);
        } else if (event.type === "idea") {
          if (isCapabilityChangeRefresh) {
            // Accumulate locally; swap atomically when the stream ends
            // so the user never sees a half-replaced list.
            nextIdeas.push(event.data);
          } else if (isSingleRefine) {
            // Replace ONLY the refined idea in place; the others stay exactly
            // as they were (this is the whole point — refining one story must
            // not rewrite the rest). The expanded-modal snapshot re-syncs from
            // ideas[expandedIdeaIdx], so the open popup shows the update too.
            // Take only the FIRST idea event (see singleRefineApplied above).
            if (!singleRefineApplied) {
              singleRefineApplied = true;
              setIdeas((prev) =>
                prev.map((it, i) => (i === refineIndex ? event.data : it)),
              );
            }
          } else {
            // Cold-start path — stream into the UI live so the user gets
            // immediate feedback.
            setIdeas((prev) => [...prev, event.data]);
          }
        } else if (event.type === "capabilities") {
          if (isCapabilityChangeRefresh || isSingleRefine) {
            // Refresh OR single-idea refine — IGNORE the LLM's capability event.
            // The user's current capability set stands; refining one story's
            // wording (or a capability toggle) must not silently re-pick products.
            continue;
          }
          // Cold-start: take the LLM's set + apply user overrides — unless the
          // user changed their explicit choices while this stream ran (e.g.
          // switched Simple → Custom): its pick was made for the old ones, and
          // applying it would overwrite what they just chose.
          const explicitNow = explicitSelectionsRef.current;
          if (explicitKey(explicitNow) !== explicitKey(explicit)) continue;
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
            // the LLM suggested it (apps, lakebase, unstructured-documents).
            return sanitizeSelection(next);
          });
        } else if (event.type === "reasoning") {
          // Set reasoning text from separate event
          setCapabilityReasoning(event.data.text || null);
        } else if (event.type === "error") {
          console.error("Suggestion error:", event.data.error);
          if (!isCapabilityChangeRefresh && !isSingleRefine
              && explicitKey(explicitSelectionsRef.current) === explicitKey(explicit)) {
            // Use fallback capabilities from error (cold-start only).
            setSelectedProducts(new Set(event.data.capabilities));
          }
        }
      }

      // Stream completed cleanly. Atomic-swap the refresh-mode ideas
      // and snapshot the capability set the ideas were generated for.
      if (isCapabilityChangeRefresh && nextIdeas.length > 0) {
        setIdeas(nextIdeas);
        // Selected idea index might point at a stale slot — clamp into range
        // (never below 0, which would make ideas[selectedIdeaIdx] undefined).
        setSelectedIdeaIdx((idx) => Math.max(0, Math.min(idx, nextIdeas.length - 1)));
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

  // Debounced capability suggestion (1500ms) — fires when the topic
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
  // Grounded selection key — so picking/removing tables (in "Use existing data")
  // re-fires the suggestion stream, not just typing.
  const groundingTablesKey = groundingTables.join("|");
  const lastGroundingKeyRef = useRef("");
  useEffect(() => {
    const trimmedTopic = topic.trim();
    // Trigger if the topic, the file set, the entry mode, OR the grounded table
    // selection changed (switching story ↔ architecture reruns the stream in
    // the right shape; picking real tables re-runs it grounded).
    if (
      trimmedTopic === lastTopicRef.current
      && uploadedFilesKey === lastUploadKeyRef.current
      && mode === lastModeRef.current
      && groundingTablesKey === lastGroundingKeyRef.current
    ) {
      return;
    }
    lastTopicRef.current = trimmedTopic;
    lastUploadKeyRef.current = uploadedFilesKey;
    lastModeRef.current = mode;
    lastGroundingKeyRef.current = groundingTablesKey;

    const hasFiles = uploadedFiles.length > 0;
    // Need EITHER 3+ chars of topic OR at least one file. A file with no
    // typed text gets a generic prompt — the backend sees the file
    // content via context_text and picks ideas from it.
    // Pro mode skips suggestion entirely (story tab only). The ARCHITECTURE
    // flow ALSO skips it: we no longer pre-select a capability set for the
    // diagram — auto-suggesting one over-constrained the architecture to a
    // single preset shape. The agent infers the right components from the
    // user's words instead (see the architecture-first prompt + SKILL.md).
    const archMode = mode === "architecture";
    // "Use existing schema": the grounded /suggest is fired ONLY by the popup's
    // "Analyze data and generate a story" button (commitGrounding) — NOT by this
    // debounced typing effect. Auto-firing it here raced the button (each
    // runSuggestionStream aborts the previous one), which canceled the commit's
    // /suggest mid-flight. So skip the grounded flow entirely here.
    const grounded = mode === "story" && !useSyntheticData;

    // Skip conditions:
    //  - pro mode / architecture: never auto-suggest.
    //  - grounded ("use existing schema"): button-driven only (see above).
    //  - no prompt/files: nothing to suggest from.
    if (
      proMode
      || archMode
      || grounded
      || !capabilitiesReady
      || (trimmedTopic.length < 3 && !hasFiles)
    ) {
      setIsSuggestingCapabilities(false);
      // Input emptied (no prompt + no files) while NOT in the grounded
      // table flow → drop the stale suggestions so the hero re-expands and
      // the starting-point grid disappears (it only made sense for the text
      // the user just removed). Grounded stories come from picked tables, not
      // typed text, so leave those alone.
      const groundedWithTables = !useSyntheticData && groundingTables.length > 0;
      if (trimmedTopic.length < 3 && !hasFiles && !groundedWithTables) {
        setIdeas([]);
        setExpectedIdeaCount(0);
        setSelectedIdeaIdx(0);
        setMatchedTemplateIds(null);
      }
      return;
    }

    setIsSuggestingCapabilities(true);

    const effectivePrompt =
      trimmedTopic.length >= 3
        ? trimmedTopic
        : "Suggest solutions based on the uploaded files.";

    const timer = setTimeout(() => {
      runSuggestionStream(effectivePrompt);
    }, 1500);

    return () => {
      clearTimeout(timer);
      // Don't abort the in-flight stream here — the next call to
      // runSuggestionStream() does it itself, and aborting here would
      // also fire on unmount/StrictMode-double-mount and look like a
      // mid-stream cancel to the user.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, capabilitiesReady, uploadedFilesKey, proMode, mode, useSyntheticData]);

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
    const key = explicitKey(explicitSelections);

    // Initial mount: capture the baseline (usually empty) and don't fire.
    if (lastExplicitKeyRef.current === "" && key === "") {
      return;
    }
    if (key === lastExplicitKeyRef.current) {
      return;
    }
    const prevKey = lastExplicitKeyRef.current;
    lastExplicitKeyRef.current = key;

    // Story + workshop modes: refresh story ideas on selection change. In
    // architecture mode there are no stories to refresh — a toggle just pins
    // the user's choice locally (the LLM already ran).
    if (topic.trim().length < 3 || !capabilitiesReady || proMode || (mode !== "story" && mode !== "workshop")) {
      setIsRefiningStories(false);
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

    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
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
      // In the "Use existing data" flow, this refresh MUST stay grounded — pass
      // the selected tables so the re-suggest keeps using the real data instead
      // of drifting to ungrounded random stories.
      const groundedTablesArg =
        mode === "story" && !useSyntheticData && groundingTables.length > 0
          ? groundingTables
          : undefined;
      runSuggestionStream(
        topic.trim(),
        undefined,
        undefined,
        currentIdeas,
        currentIdeas ? snapshotCaps : undefined,
        false,
        groundedTablesArg,
      );
    }, 2000);

    return () => {
      clearTimeout(timer);
      // Re-run before the refresh fired (e.g. a stream's capability pick
      // changed selectedProducts): restore the old key so the re-run sees the
      // change and reschedules. Otherwise it returns early on the same key,
      // the refresh never runs, and isRefiningStories stays on forever (the
      // "Generating stories for you…" hang).
      if (!fired) lastExplicitKeyRef.current = prevKey;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicitSelections, capabilitiesReady, selectedProducts, mode, useSyntheticData, groundingTablesKey]);

  // Manual regenerate handler — stays grounded in "Use existing data" mode.
  const handleRegenerate = useCallback(() => {
    const grounded = mode === "story" && !useSyntheticData && groundingTables.length > 0;
    // Grounded regenerate is valid with an empty topic (tables carry the story).
    if (topic.trim().length >= 3 || grounded) {
      runSuggestionStream(
        topic.trim(), undefined, undefined, undefined, undefined, false,
        grounded ? groundingTables : undefined,
      );
    }
  }, [topic, runSuggestionStream, mode, useSyntheticData, groundingTables]);

  // Commit the "Use existing schema" selection (the popup's primary action):
  //   1. scan the picked tables (analyze schema + stats, warm the cache) — the
  //      popup stays open showing "Analyzing…" so the user sees progress;
  //   2. close the popup;
  //   3. run the suggestion stream GROUNDED in those tables → stories appear.
  const commitGrounding = useCallback(async (tables: string[]) => {
    if (tables.length === 0) return;
    setIsScanningTables(true);
    setScanStatus("Preparing…");
    try {
      // Best-effort scan; the suggest endpoint lazily scans any cache miss, so
      // a scan failure here still degrades to a (possibly slower) grounded run.
      // Progress (SSE) drives the button label so the user sees what's happening.
      await scanGroundingTables(tables, (p) => {
        if (p.phase === "warehouse") {
          setScanStatus(p.warehouseStarting ? "Starting the SQL warehouse…" : "Reading your tables…");
        } else if (p.phase === "scanning") {
          setScanStatus(
            p.total && p.total > 1
              ? `Reading your tables — ${p.done ?? 0} of ${p.total}…`
              : "Reading your tables…",
          );
        }
      }).catch((e) => {
        console.error("Table scan failed:", e);
      });
    } finally {
      setIsScanningTables(false);
      setScanStatus("");
    }
    setGroundingOpen(false);
    // A topic isn't required — the schema carries the story. Pass the typed text
    // as-is (empty is fine: the grounded prompt tells the LLM to let the schema
    // lead). The grounded run is allowed through even with empty text.
    runSuggestionStream(topic.trim(), undefined, undefined, undefined, undefined, false, tables);
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
    // "Start with a blank architecture" — architecture-first with NO prompt.
    // Seeds an empty architecture.md and primes the agent to await edits instead
    // of drawing a full diagram. Implies architectureFirst.
    blank = false,
    // Architecture-first only: the diagram style picked on the Architecture tab.
    diagramStyle?: DiagramStyle,
  ) => {
    e?.preventDefault();
    // In Pro mode the suggestion stream never ran, so there's no `idea` to
    // bind — the user's typed prompt + their picked capabilities are the
    // entire contract. Caller still passes `undefined` for `idea`; we just
    // ignore it explicitly below to keep the flow obvious.
    const effectiveIdea = proMode ? undefined : idea;
    // Grounded demo: story tab, synthetic-data toggle OFF, with real UC tables
    // picked. The agent grounds the use case in those tables' metadata (written
    // to specifications/source-tables.md by the backend) — no story-idea picker.
    const grounded = mode === "story" && !useSyntheticData && groundingTables.length > 0;
    // Allow creating with only files (no typed text) — the description
    // falls back to the picked idea's hook (which was generated from the
    // file content) or to a file-only summary string. Pro mode REQUIRES
    // typed text (or files) since there's no idea fallback.
    // Blank architecture is the one path that's allowed with NO input.
    if (isCreating || (!blank && !topic.trim() && !effectiveIdea && !grounded && uploadedFiles.length === 0)) return;

    // Synthetic-off but no tables picked yet — tell the user rather than
    // silently falling back to the invent-a-story flow.
    if (mode === "story" && !useSyntheticData && groundingTables.length === 0) {
      setCreateError(
        "Pick at least one table to ground the demo in, or turn “Use synthetic data” back on.",
      );
      return;
    }

    // Capabilities are from selectedProducts (shared across ideas), sanitized
    // for workshop mode. Architecture-first sends NONE: the architecture tab has
    // no product picker, so selectedProducts there is just the story tab's
    // default set — sending it as "authoritative" forced UC/Genie Code/Genie One
    // into every diagram, even one redrawn from an uploaded image that has none
    // of them. The agent infers the components from the user's words / uploads.
    const capabilityIds = blank || architectureFirst
      ? []
      : Array.from(sanitizeSelection(selectedProducts));

    setIsCreating(true);
    setCreateError(null);
    try {
      // Build description: if we have an idea, use it; otherwise use raw topic
      let description: string;

      if (blank) {
        // Blank architecture: no prompt. Give the project a neutral name/desc
        // (the backend derives the display name from this) — the user renames
        // it or it gets one once they describe the diagram.
        description = "Blank architecture";
      } else if (effectiveIdea) {
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
      // may reference products by name (e.g. "Unstructured documents (PDF)") that the user
      // did NOT select; those mentions must be treated as descriptive language,
      // NOT as a signal to add capabilities the user didn't pick.
      const authoritativeCapsLine = capabilityIds.length > 0
        ? `\n\nUse these capabilities within the solution: ${capabilityIds.join(", ")} (do not add extra unless it's a strict missing dependency)`
        : "";

      // Shared grounding note — when the user picked real UC tables to build on
      // (READ-ONLY), the backend wrote their schema + stats to
      // specifications/source-tables.md. Both the story build AND the
      // architecture-first flow build DIRECTLY on those real tables.
      // Opt-in state for the grounded flow — steers the skill's read-only fork.
      const dataWriteNote = grounded
        ? allowDataWrite
          ? ` The user OPTED IN to letting the demo add its own supporting data: you MAY create ` +
            `AUXILIARY tables in the demo's OWN catalog/schema for write-needing capabilities, but ` +
            `the user's real tables stay strictly read-only.`
          : ` The user did NOT opt into data-write: build read-only analytics only (dashboards, ` +
            `Genie, metric views) and create no tables.`
        : "";
      const groundingNote = grounded
        ? `\n\nThe user picked real Unity Catalog tables to build this solution on, READ-ONLY. ` +
          `Their schema + light stats are saved at \`specifications/source-tables.md\` — read it ` +
          `FIRST. Build every component DIRECTLY on these exact tables (reuse the fully-qualified ` +
          `\`catalog.schema.table\` names; the diagram's data sources ARE these tables). Do NOT ` +
          `generate synthetic data, do NOT copy the tables, and NEVER write to or modify them — ` +
          `the demo queries the user's real data in place.${dataWriteNote}`
        : "";

      let initialPrompt: string;
      if (blank) {
        // Blank-architecture entry: the user clicked "Start with a blank
        // architecture" with no prompt. The empty architecture.md is already
        // seeded by the backend; the agent should NOT draw anything yet — just
        // read the skill and stand by for the user's edits/requests.
        initialPrompt =
          `The user just created a BLANK architecture diagram — they want to start from an empty canvas and build it up themselves (or ask you for specific additions).\n\n` +
          `Read the databricks-architecture skill (\`.claude/skills/databricks-architecture/SKILL.md\`) so you understand the flat \`architecture.md\` format, the component catalog, and the positioning system. \`architecture.md\` already exists at the project root with one empty tab — do NOT populate it or draw a full end-to-end diagram now. Just confirm you're ready, and wait for the user to tell you what to add or change; then make targeted edits to \`architecture.md\`.`;
      } else if (architectureFirst) {
        // Architecture-first entry: the user wants to START by laying out an
        // architecture diagram to review/edit BEFORE building. No capability
        // list (see capabilityIds above) — the components come from the user's
        // words and uploads, optionally grounded in real tables (groundingNote).
        // The agent draws the diagram, then stops for review.
        initialPrompt = buildArchitectureFirstPrompt(topic.trim() || description, diagramStyle) + groundingNote;
      } else if (grounded) {
        // "Use existing data": the user picked real UC tables to build on,
        // READ-ONLY — every component queries those exact tables in place (no
        // synthetic data, no copies). The backend wrote the picked tables'
        // schema + stats/sample rows to specifications/source-tables.md. The
        // typed text (if any) + the picked idea steer the use case.
        const userAsk = topic.trim()
          ? `\n\nWhat the user wrote (use it to steer the use case):\n${topic.trim()}`
          : "";
        // Carry the idea's data-fit rating into the prompt — it names the real
        // columns/joins the use-case runs on, grounding the agent's Stage-1 design.
        const fitNote = effectiveIdea?.fit
          ? `\n(Data fit — ${effectiveIdea.fit.tier}: ${effectiveIdea.fit.reason})`
          : "";
        const ideaBlock = effectiveIdea
          ? `\n\n**The user picked this use case — build it:**\n**${effectiveIdea.title}**\n${effectiveIdea.hook}${fitNote}`
          : "";
        // When the discovery step produced an analysis (chosen use-case + fit +
        // alternatives + reasoning) it's saved to specifications/data-discovery.md
        // so the agent inherits it as AGREED scope rather than re-deriving it.
        const discoveryNote = effectiveIdea || capabilityReasoning
          ? ` The full discovery analysis (the chosen use case, its data-fit ` +
            `rationale, the alternatives considered, and the capability reasoning) ` +
            `is saved at \`specifications/data-discovery.md\` — read it too and ` +
            `treat the chosen use case as already decided (build it; don't re-pitch ` +
            `or contradict the fit findings).`
          : "";
        initialPrompt =
          `Help me build a databricks solution DIRECTLY on the user's existing ` +
          `Unity Catalog tables — READ-ONLY.\n\n` +
          `The user picked some of their real tables to build on. Their schema + ` +
          `light stats/sample rows are saved at \`specifications/source-tables.md\`. ` +
          `Read that file FIRST.${discoveryNote}${ideaBlock}${userAsk}\n\n` +
          `Follow the story flow in SKILL.md with this hard grounding constraint: derive ONE ` +
          `coherent use case that runs on these exact tables, then PAUSE and confirm it with ` +
          `the user before writing specs or building. Then build the dashboards, Genie space, ` +
          `metric views, etc. DIRECTLY on the real tables — point every query at their ` +
          `fully-qualified \`catalog.schema.table\` names and read them in place. Do NOT ` +
          `generate synthetic data, do NOT copy or re-create the tables in another ` +
          `catalog/schema, and NEVER write to or modify them. Build only what read-only ` +
          `queries over the listed columns support.${dataWriteNote}` +
          `${authoritativeCapsLine}`;
      } else if (mode === "workshop") {
        // Workshop (Genie Code) mode: the agent writes a Genie Code workshop page
        // (one HTML file) the attendee builds live. SKILL.md flow B → stages/genie-workshop.md is the guide.
        const ideaHeader = effectiveIdea
          ? `\n\n**${effectiveIdea.title}**\n\n${effectiveIdea.hook}`
          : "";
        initialPrompt =
          `Build a Genie Code workshop for this story (not a standard built demo).\n\n` +
          `User request:\n${topic.trim() || description}${ideaHeader}${authoritativeCapsLine}\n\n` +
          `Read \`DEMO_SKILL\` and follow flow B (Genie Code workshop → ` +
          `\`DEMO_SKILL_DIR/stages/genie-workshop.md\`) end to end instead of the stages: ` +
          `write the story (README.md), the specifications and CONTEXT.md, ` +
          `the data generation and its test, and finally \`notebooks_html/workshop.html\`. ` +
          `Run straight through with NO approval gates — choose sensible defaults instead of asking. ` +
          `Do NOT provision the demo's Databricks resources (no pipelines, dashboards, Genie spaces, ` +
          `apps or jobs); the only workspace action allowed is the data-generation test into the ` +
          `project's default schema described there.`;
      } else if (effectiveIdea) {
        initialPrompt = `Help me build a databricks solution.\n\nUser request:\n${topic.trim()}\n\n**${effectiveIdea.title}**\n\n${effectiveIdea.hook}${authoritativeCapsLine}`;
      } else {
        // Pro mode (or auto mode with no idea picked yet): just the user's
        // typed text. The agent receives the prompt as-is — no auto-generated
        // story narrative inserted on top.
        initialPrompt = `Help me build a databricks solution.\n\nSolution description:\n${topic.trim() || description}${authoritativeCapsLine}`;
      }

      // Substantial pasted brief — the backend saved it verbatim to
      // `context/source-brief.md`. Point the agent at that file and tell it
      // to honor the spec faithfully. The threshold mirrors the backend's
      // (>= 280 chars ≈ a real spec, not a one-line topic); below it there's
      // no file and this note is skipped. Without the note the agent has the
      // brief in the opening message but loses it after context compaction —
      // the on-disk file is what makes intake durable, so we must name it.
      if (topic.trim().length >= 280) {
        initialPrompt +=
          `\n\nThe user's full brief is saved verbatim at ` +
          `\`context/source-brief.md\`. It is the authoritative statement of ` +
          `intent — read it first and preserve its specifics (names, numbers, ` +
          `entities, requirements, phrasing) end-to-end. Do NOT dilute it into ` +
          `a shorter summary; whatever you produce should reflect everything the ` +
          `user actually asked for.`;
        if (mode === "workshop") {
          initialPrompt +=
            ` For the workshop pages this means the brief's names, numbers and steps; ` +
            `the page copy itself stays short (a line or two per step).`;
        }
      }

      // File context — call out the uploads so the agent knows to read them
      // from `context/uploads/` on its first investigation pass. The
      // backend wrote both the raw original AND a `.extracted.md` sibling
      // for each file; the agent can pick whichever is more useful. Images
      // have no text layer, so they get no sibling — the agent opens the image.
      initialPrompt += buildUploadsNote(uploadedFiles);

      // Brand: the app resolves it + writes brand/brand.json, so tell the agent
      // not to web-search for it. Applies to every entry (architecture-first,
      // idea, pro) since the brand is populated out-of-band — EXCEPT the blank
      // architecture kickoff, where no demo is being built yet (the agent just
      // stands by), so a brand note there is irrelevant noise.
      if (!blank) {
        initialPrompt += `\n\n${BRAND_NOTE}`;
      }

      // Auto mode: append the kickoff directive so the agent runs every stage
      // (DRAFTING → DEPLOYED) without prompting. The topic/idea header above
      // gives the agent its build subject — AUTO_BUILD_KICKOFF alone would
      // tell it to inspect existing project files, but on a fresh project
      // nothing exists yet.
      // Architecture-first stops after the diagram, so never append the
      // full build kickoff there.
      if (autoMode && !architectureFirst && mode !== "workshop") {
        initialPrompt += `\n\n---\n\n${AUTO_BUILD_KICKOFF}`;
      }

      // Carry the discovery step's analysis into the project (grounded only) so
      // the build agent inherits what the suggest LLM learned — the chosen
      // use-case + its data-fit rationale, the alternatives it surfaced, and the
      // capability reasoning. The backend persists it to
      // specifications/data-discovery.md; without it the agent re-derives the
      // fit/joins and can contradict what was decided during discovery.
      const toDiscoveryIdea = (i: UseCaseIdea): DiscoveryIdeaInput => ({
        title: i.title,
        hook: i.hook,
        why: i.why,
        fit: i.fit,
      });
      // Gate on there being something real to carry: a CHOSEN use case, or (Pro
      // mode grounded — no idea) the capability reasoning. NOT `ideas.length > 0`
      // — without a chosen idea, sending every idea as an "alternative (not
      // chosen — do not re-explore)" would steer the agent away from ALL of them
      // while giving it no direction. Alternatives are only meaningful relative
      // to a chosen idea, so they're only included when one is picked. This keeps
      // the payload gate, the discoveryNote gate, and the backend file-write gate
      // (chosen || alternatives || reasoning) in agreement.
      const discovery: DiscoveryInput | undefined =
        grounded && (effectiveIdea || capabilityReasoning)
          ? {
              chosen: effectiveIdea ? toDiscoveryIdea(effectiveIdea) : undefined,
              // Everything the user did NOT pick (identity match — the chosen
              // idea is the same object reference from `ideas`). Only when a
              // chosen idea exists to be the contrast.
              alternatives: effectiveIdea
                ? ideas.filter((i) => i !== effectiveIdea).map(toDiscoveryIdea)
                : [],
              reasoning: capabilityReasoning ?? undefined,
            }
          : undefined;

      // Backend will generate name and schema from description using LLM.
      // Passing capabilityIds scopes which DAS skills get copied into the project.
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
        // Entry mode — drives the agent's Build fork (workshop → workshop page).
        mode,
        // Blank canvas: backend seeds an empty architecture.md; agent stands by.
        blank,
        // Raw brief, verbatim — the user's own words with none of the prompt
        // scaffolding above. A substantial paste (a real spec) gets saved to
        // context/source-brief.md so the agent honors it losslessly.
        topic.trim() || undefined,
        // "Use existing data": the real UC tables the demo is built on. The
        // backend writes their schema + sample rows to specifications/source-tables.md
        // (empty unless the user chose existing-data + picked tables).
        grounded ? groundingTables : undefined,
        // Opt-in: let the grounded demo create its OWN auxiliary data (real
        // tables stay read-only). Only meaningful when grounded.
        grounded ? allowDataWrite : false,
        // Discovery analysis → specifications/data-discovery.md (grounded only).
        discovery,
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

    // Index of the card being refined, so ONLY that idea is replaced (identity
    // match — `idea` is the exact element from the current `ideas` array).
    const refineIndex = ideas.findIndex((i) => i === idea);
    // Bail on a stale click (idea no longer in the array). Without this the
    // -1 would make isSingleRefine false and fall into the cold-start branch,
    // which runs setIdeas([]) and destroys the whole grid — a safe no-op is
    // far better than wiping every story over a lost identity match.
    if (refineIndex < 0) return;
    setIsRefining(true);
    setRefineActiveIdx(refineIndex);
    setRefiningIdeaIdx(null);

    // Stay grounded when refining a "Use existing data" story.
    const groundedTablesArg =
      mode === "story" && !useSyntheticData && groundingTables.length > 0
        ? groundingTables
        : undefined;
    try {
      await runSuggestionStream(
        topic.trim(),
        { title: idea.title, hook: idea.hook, datasources: idea.datasources },
        refineText.trim(),
        undefined,
        undefined,
        false,
        groundedTablesArg,
        refineIndex,
      );
      setRefineText("");
    } catch (err) {
      console.error("Failed to refine idea:", err);
    } finally {
      setIsRefining(false);
      setRefineActiveIdx(null);
    }
  };

  // Keep the expanded-idea snapshot in sync with the live idea whenever it's
  // present. We only ever OVERWRITE with a live value, never clear on absence —
  // so if `ideas` is ever transiently shorter (e.g. a whole-grid re-stream),
  // the modal keeps showing the last-known content under the loading overlay,
  // then this re-syncs once ideas repopulate.
  useEffect(() => {
    if (expandedIdeaIdx === null) return;
    const live = ideas[expandedIdeaIdx];
    if (live) setExpandedIdeaSnapshot(live);
  }, [expandedIdeaIdx, ideas]);

  // Refine from the EXPANDED modal — same stream as handleRefineSubmit, but
  // keeps the modal open + clears the modal's own input so the user can watch
  // the idea update in place and keep iterating. The idea at expandedIdeaIdx
  // re-populates as the stream returns (a loading overlay covers the gap).
  const handleExpandRefine = async () => {
    if (expandedIdeaIdx === null || isRefining || isSuggestingCapabilities) return;
    const idea = ideas[expandedIdeaIdx];
    if (!idea || !expandRefineText.trim()) return;
    setIsRefining(true);
    setRefineActiveIdx(expandedIdeaIdx);
    // Stay grounded when refining a "Use existing data" story.
    const groundedTablesArg =
      mode === "story" && !useSyntheticData && groundingTables.length > 0
        ? groundingTables
        : undefined;
    try {
      await runSuggestionStream(
        topic.trim(),
        { title: idea.title, hook: idea.hook, datasources: idea.datasources },
        expandRefineText.trim(),
        undefined,
        undefined,
        false,
        groundedTablesArg,
        expandedIdeaIdx,
      );
      setExpandRefineText("");
    } catch (err) {
      console.error("Failed to refine idea:", err);
    } finally {
      setIsRefining(false);
      setRefineActiveIdx(null);
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

  // Clone a shared project into the user's own workspace (from the "Your work"
  // → Shared tab). Mirrors the handler SharedWithMe used to own internally.
  const [cloningSharedId, setCloningSharedId] = useState<string | null>(null);
  const handleCloneShared = async (projectId: string) => {
    setCloningSharedId(projectId);
    try {
      const clone = await cloneProject(projectId);
      navigate({ to: "/project/$projectId", params: { projectId: clone.id } });
    } catch (err) {
      console.error("Failed to clone project:", err);
      setCloningSharedId(null);
    }
  };

  // Accept/decline a pending share invitation. Calls the API, then lets the
  // parent callback drop the invite + refresh Shared. Returns the promise so
  // the tab row can show an in-flight spinner.
  const handleInvitationRespond = async (projectId: string, accepted: boolean) => {
    await respondToShare(projectId, accepted);
    setInvitations((prev) => prev.filter((i) => i.project_id !== projectId));
    if (accepted) {
      getHomeProjects()
        .then((home) => setSharedProjects(home.shared))
        .catch(() => {});
    }
  };

  // Resolve the semantic-search ranking to full template items (preserving
  // screenshots). The best match becomes the LEAD card in the starting-point
  // grid; only [0] is used today, but resolving the full list keeps it cheap
  // to surface more later.
  const matchedTemplates = useMemo(() => {
    if (!matchedTemplateIds) return [];
    const byId = new Map(allTemplates.map((t) => [t.id, t]));
    return matchedTemplateIds
      .map((id) => byId.get(id))
      .filter((t): t is TemplateListItem => Boolean(t));
  }, [matchedTemplateIds, allTemplates]);

  // Decide whether the matched template earns a spot in the starting-point grid
  // and where. A raw semantic hit isn't enough — we cross-check word overlap
  // between the user's ask and the template's name/industry so a one-word
  // coincidence doesn't hijack the lead slot. lead (card #1) vs after (appended)
  // vs null (no template card).
  // The backend now does the relevance judgment (semantic search + a mini LLM
  // re-rank that drops clearly-irrelevant matches and weights official ones up).
  // So we TRUST its order: the top match is the lead card. The old client-side
  // word-overlap confidence gate is gone — it did exact token matching and
  // wrongly hid good matches ("health care" ≠ "Healthcare" as tokens).
  const templateFit = useMemo<{ template: TemplateListItem; placement: "lead" } | null>(() => {
    const t = matchedTemplates[0];
    if (!t) return null;
    if (topic.trim().length < 3) return null;
    return { template: t, placement: "lead" };
  }, [matchedTemplates, topic]);


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

        {/* Hero - collapses when user starts typing.
            z-20 (not z-10): the sections below it are also z-10 and come later
            in the DOM, so they'd paint over any dropdown the hero opens (the
            grounding catalog/schema/table pickers). */}
        <div className={`relative z-20 mx-auto w-full space-y-6 text-center transition-all duration-300 ${
          isHeroCollapsed ? "max-w-6xl" : "max-w-4xl"
        }`}>
          {/* Header — always visible. It used to collapse once the user typed
              (to reclaim vertical space), but with the template carousel gone
              there's room to keep the logo + title present throughout. */}
          <div className="space-y-4">
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

          <div className="w-full">

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
              {/* Top toolbar (same line): entry-MODE toggle on the LEFT
                  (rendered in EVERY mode so the user can always switch back out
                  of workshop), data-source toggle on the RIGHT (story mode only). */}
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-4 text-xs">
                  {([
                    { v: "story" as const, label: "Solution" },
                    { v: "architecture" as const, label: "Architecture" },
                    // Always shown; the flow is in beta (badge).
                    { v: "workshop" as const, label: "Genie Code workshop", badge: "Beta" },
                  ]).map((t) => {
                    const active = mode === t.v;
                    return (
                      <button
                        key={t.v}
                        type="button"
                        onClick={() => setMode(t.v)}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 border-b-2 py-1 font-medium transition-colors",
                          active
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t.label}
                        {"badge" in t && t.badge && (
                          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                            {t.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Data-source toggle (right) — "Generate data" (synthetic) vs
                    "Use existing data" (opens the real-UC-tables popup). Story
                    mode only; hidden in architecture/workshop. */}
                {/* "Use existing data" — opens the popup to pick real UC tables
                    the demo is built on DIRECTLY (read-only; no synthetic data).
                    Not a mode toggle, a single button. Active styling when real
                    tables are in use. */}
                {mode === "story" && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseSyntheticData(false);
                      setGroundingOpen(true);
                    }}
                    aria-pressed={!useSyntheticData}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                      !useSyntheticData && groundingTables.length > 0
                        ? "text-primary hover:text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Table2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Use existing data
                    {!useSyntheticData && groundingTables.length > 0 && (
                      <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {groundingTables.length}
                      </span>
                    )}
                  </button>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Direct create. In architecture mode, submit follows the
                  // architecture-first path (blank when nothing's typed) so
                  // Enter matches the CTA button; otherwise pass the picked
                  // idea so the build uses the highlighted story.
                  if (mode === "architecture") {
                    const isBlank = !topic.trim() && uploadedFiles.length === 0;
                    handleCreateProject(undefined, undefined, true, isBlank, archStyle);
                  } else {
                    handleCreateProject(undefined, ideas[selectedIdeaIdx]);
                  }
                }}
                className="space-y-2.5"
              >
                {/* Attachments row, right above the input it belongs to —
                    only renders when files are attached (picked, dropped or
                    pasted) or an upload error occurred, so the layout stays
                    compact on cold start. */}
                {(uploadedFiles.length > 0 || uploadError) && (
                  <div className="space-y-1.5">
                    {uploadedFiles.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
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

                {/* Textarea + attach button on a single row. The button
                    is `items-end` so it stays aligned to the bottom of
                    the textarea as it auto-grows (otherwise it'd drift
                    upward and stop reading as "attached to the input"). */}
                <div className="flex items-end gap-2">
                  <Textarea
                    ref={textareaRef}
                    placeholder={
                      mode === "architecture"
                        ? "Describe the architecture you want to build…"
                        : mode === "workshop"
                          ? 'Describe the workshop... e.g. "returns analysis for a luxury beauty brand"'
                          : proMode
                            ? "Describe your use-case in your own words — the agent builds exactly this, no suggested stories…"
                            : "Describe what you want to build…"
                    }
                    value={topic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      adjustTextareaHeight();
                    }}
                    // Bigger free-type box in Custom/Pro mode (write your own
                    // use-case); compact in Simple (the guided/suggest flow).
                    className={cn(
                      "text-lg md:text-lg bg-background/60 resize-none overflow-y-hidden flex-1",
                      proMode ? "min-h-32" : "min-h-12",
                    )}
                    rows={1}
                    autoFocus
                    onPaste={(e) => {
                      const images = clipboardImages(e);
                      if (images.length === 0) return;
                      if (!clipboardHasText(e)) e.preventDefault();
                      void handleFiles(images);
                    }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.csv,.xlsx,.docx,.md,.txt,.json,.yaml,.yml,.html,.xml,.log,.png,.jpg,.jpeg,.webp,.gif"
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
                    title="Attach files (PDF, CSV, XLSX, DOCX, MD, TXT, images) — or paste an image"
                    aria-label="Attach files"
                  >
                    {isUploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </button>
                </div>

                {/* Diagram style picker — a radio group of cards (preview, label,
                    one line). Hidden-radio + label pattern keeps native radio
                    semantics and keyboard arrows; "Match my image" only when an
                    image is attached. */}
                {mode === "architecture" && (
                  <div className="space-y-1.5">
                  <p id="arch-style-heading" className="text-xs font-medium text-muted-foreground">
                    Select the diagram style
                  </p>
                  <TooltipProvider delayDuration={600}>
                  <RadioGroup
                    aria-labelledby="arch-style-heading"
                    value={archStyle}
                    onValueChange={(v) => setArchStyleChoice(v as DiagramStyle)}
                    className={cn(
                      "grid grid-cols-2 gap-2",
                      archStyleOptions.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4",
                    )}
                  >
                    {archStyleOptions.map((s) => {
                      const id = `arch-style-${s.id}`;
                      return (
                        <div key={s.id} className="relative">
                          <RadioGroupItem value={s.id} id={id} className="peer sr-only" />
                          {/* Short thumbnail; the full preview opens on a deliberate hover
                              (600ms) so skimming across the row doesn't flash popups. */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Label
                                htmlFor={id}
                                className="flex h-full cursor-pointer flex-col overflow-hidden rounded-md border border-border bg-background/60 text-left transition-colors hover:border-foreground/30 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-data-[state=checked]:border-destructive peer-data-[state=checked]:ring-1 peer-data-[state=checked]:ring-destructive"
                              >
                                {/* Full-bleed preview with a divider: the crop reads as deliberate. */}
                                <img
                                  src={`/arch-styles/${s.id}.png`}
                                  alt=""
                                  loading="lazy"
                                  className="h-16 w-full border-b border-border bg-white object-cover object-top"
                                />
                                <span className="flex flex-col gap-0.5 px-2 py-1.5">
                                  <span className="text-sm font-medium text-foreground">{s.label}</span>
                                  <span className="text-xs leading-snug text-muted-foreground">{s.blurb}</span>
                                </span>
                              </Label>
                            </TooltipTrigger>
                            <TooltipContent
                              side="bottom"
                              sideOffset={8}
                              className="w-[560px] max-w-[90vw] border border-border bg-background p-2 text-foreground shadow-lg"
                            >
                              <img
                                src={`/arch-styles/${s.id}.png`}
                                alt={`${s.label} diagram style example`}
                                className="w-full rounded bg-white object-contain"
                              />
                              <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{s.label}</span> — {s.blurb}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </RadioGroup>
                  </TooltipProvider>
                  </div>
                )}

                {/* Architecture CTA — one button. Empty prompt (no text, no uploads)
                    → it starts a blank canvas; once the user types or attaches
                    something it becomes "Create my architecture". */}
                {mode === "architecture" && (() => {
                  const isBlank = !topic.trim() && uploadedFiles.length === 0;
                  return (
                    <div className="relative flex items-center justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => handleCreateProject(undefined, undefined, true, isBlank, isBlank ? undefined : archStyle)}
                        disabled={isCreating}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-6 py-2.5 text-sm font-semibold text-destructive-foreground transition-all hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        {isCreating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        {isCreating ? "Creating…" : isBlank ? "Start from a blank canvas" : "Create my architecture"}
                      </button>
                      {/* An agent with the CLI explores a running project and writes the brief. */}
                      <button
                        type="button"
                        onClick={() => setScanOpen(true)}
                        className="absolute left-0 bottom-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline cursor-pointer"
                      >
                        From an existing project…
                      </button>
                      <ScanPromptDialog open={scanOpen} onOpenChange={setScanOpen} />
                      {/* Showcase: real prompts next to the diagrams the agent drew from them. */}
                      <Link
                        to="/architecture-showcase"
                        className="absolute right-0 bottom-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        See what I can do →
                      </Link>
                    </div>
                  );
                })()}

                {/* Deploy-target control (Tier-2 "scale" feature) — a
                    portable, self-contained module. Renders the collapsed
                    one-liner + a paste-URL editor, or nothing when the
                    feature is off. See
                    components/remote-deploy/DeployTargetControl. */}
                <DeployTargetControl />

                {mode === "workshop" && (
                  <p className="text-xs text-muted-foreground">
                    💡 Pick a story — the agent writes a Genie Code workshop your
                    team builds live, prompt by prompt, from one HTML page.
                  </p>
                )}

                {/* Grounded selection strip — the real UC tables the demo is
                    built on, READ-ONLY. Leads with the catalog(s) as clickable
                    Catalog Explorer links, then the tables (name on hover, capped
                    + "+N more"). Only in the "Use existing data" flow. */}
                {mode === "story" && !useSyntheticData && groundingTables.length > 0 && (() => {
                  const catalogs = Array.from(
                    new Set(groundingTables.map((t) => t.split(".")[0]).filter(Boolean)),
                  );
                  return (
                    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
                      {/* Read-only summary + clickable catalog(s) */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Table2 className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
                        <span className="text-[11px] font-medium text-muted-foreground">
                          Building read-only on {groundingTables.length}{" "}
                          {groundingTables.length === 1 ? "table" : "tables"}
                          {catalogs.length > 0 && (
                            <> across {catalogs.length === 1 ? "catalog" : `${catalogs.length} catalogs`}</>
                          )}
                          :
                        </span>
                        {catalogs.map((c) => {
                          const href = ucExploreUrl(workspaceInfo, [c]);
                          const cls =
                            "inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary";
                          return href ? (
                            <a
                              key={c}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open catalog ${c} in Catalog Explorer`}
                              className={cn(cls, "underline-offset-2 hover:underline")}
                            >
                              <Database className="h-3 w-3" />
                              {c}
                            </a>
                          ) : (
                            <span key={c} className={cls}>
                              <Database className="h-3 w-3" />
                              {c}
                            </span>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setGroundingOpen(true)}
                          className="ml-auto shrink-0 cursor-pointer text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                      {/* The tables themselves */}
                      <div className="flex flex-wrap items-center gap-1.5 pl-5">
                        {groundingTables.slice(0, 6).map((t) => (
                          <TableChip
                            key={t}
                            fullName={t}
                            info={workspaceInfo}
                            className="border border-border/60 bg-background text-foreground/80"
                          />
                        ))}
                        {groundingTables.length > 6 && (
                          <span
                            title={groundingTables.slice(6).join("\n")}
                            className="inline-flex items-center rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            +{groundingTables.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Pro-mode re-enable link — in Pro mode there's no ideas
                    header to host the toggle, so offer a way back to guided
                    stories here. */}
                {isHeroCollapsed && mode === "story" && proMode && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setProMode(false)}
                      className="text-xs underline-offset-2 hover:underline transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      Generate story ideas instead
                    </button>
                  </div>
                )}

                {/* Story ideas grid. Shown in story mode once the user has
                    engaged, UNLESS Pro mode is on (then the user writes their own
                    use-case and no stories are suggested). Renders for BOTH the
                    synthetic (guided) flow AND the "Use existing data" grounded
                    flow — both stream ideas into `ideas` via /suggest (the
                    grounded flow via "Generate a story"). */}
                {isHeroCollapsed && hasStories && !proMode && (
                  <div className="pt-2 pb-1">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">
                          {isSuggestingCapabilities
                            ? "Generating ideas…"
                            : "Stories generated for you"}
                        </span>
                        {/* Regenerate — icon only; the label reveals on hover to
                            keep the header light. Hidden in Pro mode. */}
                        {!proMode && ideas.length > 0 && !isSuggestingCapabilities && (
                          <button
                            type="button"
                            onClick={handleRegenerate}
                            aria-label="Regenerate stories from scratch"
                            className="group ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[8rem] group-hover:opacity-100">
                              Regenerate stories
                            </span>
                          </button>
                        )}
                        {/* "?" — hover shows the agent's rationale for the picked
                            set. Icon only (no "Why these?" label). */}
                        {!proMode && capabilityReasoning && ideas.length > 0 && !isSuggestingCapabilities && (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Why these stories?"
                                  className="flex items-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-help"
                                >
                                  <HelpCircle className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" align="start" className="max-w-md">
                                <p className="text-xs leading-relaxed">{capabilityReasoning}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      {/* "Don't generate stories" — right side of the header.
                          Switches to Pro mode (write your own use-case; no
                          stories + no /suggest call). */}
                      {mode === "story" && (
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setProMode(true)}
                              className="shrink-0 text-xs underline-offset-2 hover:underline transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                            >
                              Don't generate stories
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="end" className="max-w-xs">
                            <p className="text-xs leading-relaxed">
                              Skip the auto-generated story ideas. Type your
                              use-case in your own words and the agent builds
                              exactly that — no suggestions are fetched.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      )}
                    </div>
                    {/* NOTE: the old standalone "Analyzing your request…" box was
                        removed — the carousel below now renders story skeletons
                        while the stream spins up, so it IS the loading state. */}
                    {/* Story-ideas grid — entirely skipped in Pro mode.
                        The CapabilitiesPanel below becomes the source of
                        truth for what gets built; the typed prompt is what
                        the agent receives. */}
                    {!proMode && (() => {
                      // Starting-point cards = AI ideas + (optionally) a single
                      // matching template, placed by a mini confidence check
                      // (templateFit): lead → template is card #1; after → template
                      // appended; null → no template card. The whole set is a
                      // static GRID capped at 3 cards (no scrolling carousel), so
                      // the user sees a few strong options, not a long scroll.
                      // Templates only in the SYNTHETIC flow (grounded "use
                      // existing data" shows stories only). One template max.
                      const showTemplates = useSyntheticData && mode === "story";
                      const tpl = showTemplates ? (templateFit?.template ?? null) : null;
                      const leads = showTemplates && templateFit?.placement === "lead";
                      // Hold a template skeleton in the lead slot while the match
                      // is still resolving, so the real card swaps IN PLACE. This
                      // covers a RACE: `matchedTemplateIds` (from /search) can
                      // arrive BEFORE `allTemplates` (from listTemplates) loads, so
                      // `matchedTemplates` resolves the ids against an empty list →
                      // `tpl` is momentarily null even though a match exists. The
                      // last clause keeps the slot reserved (skeleton) in that
                      // window instead of collapsing it and letting stories take
                      // the lead — once allTemplates loads, `tpl` resolves and the
                      // skeleton swaps to the real card.
                      const templateIdsUnresolved =
                        !!matchedTemplateIds
                        && matchedTemplateIds.length > 0
                        && allTemplates.length === 0;
                      const templateSearchPending =
                        showTemplates
                        && !tpl
                        && topic.trim().length >= 3
                        && (isSearchingTemplates || matchedTemplateIds === null || templateIdsUnresolved);
                      const leadTemplateLoading = templateSearchPending;
                      const hasLeadSlot = (!!tpl && leads) || leadTemplateLoading;

                      // Show the grid as soon as we have ANYTHING to show — a
                      // (resolved OR loading) template, OR the suggest stream
                      // spinning up — so the template card + story skeletons
                      // appear the moment either async source lands, WITHOUT
                      // waiting for the suggest stream to finish. `count` sets
                      // expectedIdeaCount → the right number of story skeletons.
                      const streamStarting =
                        isSuggestingCapabilities || hasLeadSlot;
                      const totalSlots =
                        expectedIdeaCount > 0
                          ? expectedIdeaCount
                          : ideas.length > 0
                            ? ideas.length
                            : streamStarting
                              ? 3
                              : 0;

                      // Grid holds at most 3 cards. If a template takes the lead
                      // slot it displaces one story so the row stays capped.
                      const MAX_CARDS = 3;
                      const storyCap = hasLeadSlot ? MAX_CARDS - 1 : MAX_CARDS;
                      const ideaCount = Math.min(totalSlots, storyCap);
                      const cardCount =
                        (hasLeadSlot ? 1 : 0)
                        + ideaCount
                        + (tpl && !leads ? 1 : 0);

                      const gridHidden = cardCount === 0;

                      const templateCardEl = tpl ? (
                        <div
                          key={`tpl-${tpl.id}`}
                          onClick={() => setSelectedTemplateId(tpl.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedTemplateId(tpl.id);
                            }
                          }}
                          className="group relative p-4 rounded-lg border transition-all flex flex-col h-full cursor-pointer border-slate-200 dark:border-border/50 hover:border-destructive/40 bg-destructive/[0.04] dark:bg-destructive/10 min-h-[160px]"
                        >
                          <div className="relative mb-3 -mx-1 h-24 overflow-hidden rounded-md border border-border/50 bg-muted/40">
                            {tpl.has_screenshot ? (
                              <img
                                src={templateScreenshotUrl(tpl.id)}
                                alt={`${tpl.name} preview`}
                                loading="lazy"
                                className="h-full w-full object-cover object-top"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-destructive/15 via-destructive/5 to-destructive/15">
                                <Library className="h-8 w-8 text-destructive/40" />
                              </div>
                            )}
                            {/* "Ready-to-use template" — a small translucent label
                                ON the image (top-left) so it doesn't add card
                                height. Purely informative (not a button). */}
                            <span className="absolute left-1.5 top-1.5 z-[16] inline-flex items-center gap-1 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
                              <Library className="h-3 w-3" />
                              Ready-to-use template
                            </span>
                          </div>
                          <p className="text-center text-base font-semibold text-slate-900 dark:text-foreground mb-2">
                            {tpl.name}
                          </p>
                          {tpl.description && (
                            <p className="line-clamp-3 flex-1 text-xs leading-relaxed text-slate-600 dark:text-muted-foreground mb-3">
                              {tpl.description}
                            </p>
                          )}
                          {/* Footer carries `data-card-actions` so hovering
                              ANYWHERE in it (not just the button) suppresses the
                              "Use this template" overlay — like the story card's
                              Expand/Refine row. */}
                          <div data-card-actions className="relative z-20 mt-auto -mb-1 flex items-center justify-between gap-2">
                            {tpl.industry ? (
                              <span className="inline-flex items-center rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {tpl.industry}
                              </span>
                            ) : <span />}
                            {/* Jump to the full template library. stopPropagation
                                so clicking it doesn't open the detail sheet. */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate({ to: "/templates" });
                              }}
                              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1 text-[11px] font-semibold text-destructive/90 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/50 transition-colors cursor-pointer"
                            >
                              <Library className="h-3.5 w-3.5" />
                              See more templates
                            </button>
                          </div>
                          {/* Full-tile hover overlay — uniform with "Use this
                              story" but RED, so the template pops. Clicking it
                              (or the card) opens the detail sheet. Suppressed while
                              hovering "See more templates" so that stays clickable. */}
                          <div className="absolute inset-x-0 top-0 bottom-10 z-[15] flex items-center justify-center rounded-t-lg bg-destructive/10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[[data-card-actions]:hover]:!opacity-0">
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow-md">
                              <Library className="h-4 w-4" />
                              Use this template
                            </span>
                          </div>
                        </div>
                      ) : null;

                      return (
                    <div className={gridHidden ? "hidden" : ""}>
                      <div className={`grid gap-3 ${
                        cardCount === 1 ? "grid-cols-1" : cardCount === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"
                      }`}>
                          {/* Lead template (card #1) */}
                          {leadTemplateLoading && !tpl && (
                            <div className="p-4 rounded-lg border border-border bg-card/50 min-h-[160px] flex flex-col">
                              <div className="mb-3 -mx-1 h-24 rounded-md bg-muted-foreground/10 animate-pulse" />
                              <div className="h-4 w-2/3 mx-auto rounded-md bg-primary/10 animate-pulse mb-2" />
                              <div className="space-y-2 flex-1">
                                <div className="h-3 w-full rounded-md bg-muted-foreground/10 animate-pulse" />
                                <div className="h-3 w-5/6 rounded-md bg-muted-foreground/10 animate-pulse" />
                              </div>
                              <div className="mt-auto h-3 w-24 rounded-md bg-muted-foreground/10 animate-pulse" />
                            </div>
                          )}
                          {tpl && leads && templateCardEl}
                          {Array.from({ length: ideaCount }, (_, idx) => idx).map((idx) => {
                              const idea = ideas[idx];
                              if (!idea) {
                                return (
                                  <div
                                    key={`skeleton-${idx}`}
                                  >
                                    {/* Matches the TEMPLATE skeleton's shape/height
                                        (image area on top + title + text + footer)
                                        so template and story skeletons line up. */}
                                    <div className="p-4 rounded-lg border border-border bg-card/50 min-h-[160px] flex flex-col">
                                      <div className="mb-3 -mx-1 h-24 rounded-md bg-muted-foreground/10 animate-pulse" />
                                      <div className="h-4 w-2/3 mx-auto rounded-md bg-primary/10 animate-pulse mb-2" />
                                      <div className="space-y-2 flex-1">
                                        <div className="h-3 w-full rounded-md bg-muted-foreground/10 animate-pulse" />
                                        <div className="h-3 w-5/6 rounded-md bg-muted-foreground/10 animate-pulse" />
                                      </div>
                                      <div className="mt-auto h-3 w-24 rounded-md bg-muted-foreground/10 animate-pulse" />
                                    </div>
                                  </div>
                                );
                              }

                              const isRefiningThis = refiningIdeaIdx === idx;
                              const isSelectedIdea = selectedIdeaIdx === idx;
                              const pickIdea = () => setSelectedIdeaIdx(idx);

                              return (
                                <div
                                  key={`idea-${idx}`}
                                >
                                  <div
                                    onClick={pickIdea}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        pickIdea();
                                      }
                                    }}
                                    className={`group relative p-4 rounded-lg border transition-all flex flex-col h-full min-h-[160px] ${
                                      isSelectedIdea
                                        ? "border-primary ring-2 ring-primary/50 shadow-md bg-primary/[0.04] dark:bg-primary/10"
                                        : "border-slate-200 dark:border-border/50 hover:border-primary/40 bg-white dark:bg-card"
                                    } ${
                                      isRefiningStories || refineActiveIdx === idx
                                        ? "pointer-events-none"
                                        : "cursor-pointer"
                                    }`}
                                  >
                                    {/* Selected-card check badge — the primary
                                        "this is chosen" signal, top-right corner. */}
                                    {isSelectedIdea && (
                                      <div className="absolute -right-2 -top-2 z-20 rounded-full bg-background">
                                        <CheckCircle2 className="h-5 w-5 text-primary fill-background" strokeWidth={2.5} />
                                      </div>
                                    )}
                                    {(isRefiningStories || refineActiveIdx === idx) && (
                                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 dark:bg-card/70 backdrop-blur-[1px]">
                                        <Loader2 className="h-5 w-5 text-primary animate-spin" />
                                        <span className="text-xs text-muted-foreground">Refining…</span>
                                      </div>
                                    )}
                                    <p className="text-center text-base font-semibold text-slate-900 dark:text-foreground mb-2">
                                      {idea.title}
                                    </p>
                                    {/* Fit signal (grounded "Use existing data" flow only —
                                        the backend emits `fit` only when the story is rated
                                        against the user's real tables). Card shows just the
                                        tier badge; the column/join detail (`fit.reason`)
                                        lives in the expanded view. A hint, never a gate. */}
                                    {idea.fit && (
                                      <div className="mb-2 flex justify-center">
                                        <span
                                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                            idea.fit.tier === "Great"
                                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                              : idea.fit.tier === "Good"
                                                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                                                : "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground"
                                          }`}
                                        >
                                          <span aria-hidden className="text-[9px] leading-none">
                                            {idea.fit.tier === "Great" ? "★" : idea.fit.tier === "Good" ? "●" : "○"}
                                          </span>
                                          {idea.fit.tier} fit
                                        </span>
                                      </div>
                                    )}
                                    <div className="text-xs text-slate-600 dark:text-muted-foreground leading-relaxed mb-3 flex-1 overflow-hidden">
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
                                        {/* Show the table name (last segment); the full
                                            catalog.schema.table is on hover. Cap the visible
                                            count so a multi-table story stays tidy. */}
                                        {idea.datasources.slice(0, 4).map((ds, dsIdx) => (
                                          <TableChip
                                            key={dsIdx}
                                            fullName={ds}
                                            info={workspaceInfo}
                                            className="bg-muted/50 text-muted-foreground"
                                          />
                                        ))}
                                        {idea.datasources.length > 4 && (
                                          <span
                                            title={idea.datasources.slice(4).join(", ")}
                                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/50 text-muted-foreground"
                                          >
                                            +{idea.datasources.length - 4} more
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {isRefiningThis && (
                                      <div className="mb-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                                        <input
                                          type="text"
                                          value={refineText}
                                          onChange={(e) => setRefineText(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => {
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
                                          {isRefining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
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
                                    {!isRefiningThis && (
                                      <div data-card-actions className="relative z-20 mt-auto flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedIdeaIdx(idx);
                                            setExpandedIdeaIdx(idx);
                                            setExpandedIdeaSnapshot(idea);
                                            setExpandRefineText("");
                                          }}
                                          className={cn(
                                            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground cursor-pointer",
                                            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                                            isSelectedIdea && "opacity-100",
                                          )}
                                        >
                                          <Maximize2 className="h-3 w-3" />
                                          Expand
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedIdeaIdx(idx);
                                            setRefiningIdeaIdx(idx);
                                            setRefineText("");
                                          }}
                                          className={cn(
                                            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground cursor-pointer",
                                            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                                            isSelectedIdea && "opacity-100",
                                          )}
                                        >
                                          <Pencil className="h-3 w-3" />
                                          Refine
                                        </button>
                                      </div>
                                    )}
                                    {/* "Use this story" — a centered overlay that
                                        fades in on hover of the card body. Hidden
                                        when the tile is already SELECTED, and
                                        suppressed while hovering the Expand/Refine
                                        actions (group-has …[data-card-actions]) so
                                        those stay clickable. Clicking it SELECTS
                                        the idea; build happens via the Build
                                        button below. */}
                                    {!isRefiningStories && !isRefiningThis && !isSelectedIdea && (
                                      <div
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          pickIdea();
                                        }}
                                        className="absolute inset-x-0 top-0 bottom-10 z-[15] flex items-center justify-center rounded-t-lg bg-primary/10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[[data-card-actions]:hover]:!opacity-0 cursor-pointer"
                                      >
                                        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md">
                                          <Sparkles className="h-4 w-4" />
                                          Use this story
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                          })}
                          {/* Trailing template (lower-confidence "after" match) */}
                          {tpl && !leads && templateCardEl}
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                )}

                {/* Error message. (The implementation-flow rationale moved up
                    to the "Why these?" hover in the ideas header.) */}
                {createError && (
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-destructive">{createError}</p>
                  </div>
                )}

                {/* Products panel + Build action. The layout is STABLE: the
                    Simple/Custom panel always hugs the LEFT and the Build button
                    always blocks to the RIGHT — no center-then-shift on load.
                    While stories are still streaming, the button shows a
                    greyed-out "Generating stories for you…" state instead of
                    appearing/disappearing (which caused the jarring reflow). */}
                {isHeroCollapsed && hasStories && (() => {
                  // `ready` = we have something to build with (a story picked, or
                  // pro mode). While NOT ready we still render the button, but
                  // disabled + in its "generating" state.
                  const ready =
                    proMode
                    || (ideas.length > 0 && !isSuggestingCapabilities && !isRefiningStories);
                  const buildButton = (
                    <button
                      type="button"
                      onClick={() =>
                        handleCreateProject(undefined, proMode ? undefined : ideas[selectedIdeaIdx])
                      }
                      disabled={
                        !ready
                        || isCreating
                        || (proMode && !topic.trim() && uploadedFiles.length === 0)
                      }
                      className={cn(
                        "group relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-md px-6 py-2.5 text-sm font-semibold transition-all shadow-sm",
                        ready
                          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                          : "cursor-wait bg-muted text-muted-foreground",
                      )}
                    >
                      {/* Generating: a soft shimmer sweep behind the label. */}
                      {!ready && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
                        />
                      )}
                      {isCreating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : ready ? (
                        <Sparkles className="h-4 w-4" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      <span className="relative">
                        {isCreating
                          ? "Creating…"
                          : !ready
                            ? ideas.length > 0
                              ? "Updating stories…"
                              : "Generating stories for you…"
                            : mode === "workshop"
                              ? ideas[selectedIdeaIdx]
                                ? `Create workshop with "${ideas[selectedIdeaIdx].title}"`
                                : "Create workshop"
                              : proMode
                                ? "Build solution"
                                : `Build "${ideas[selectedIdeaIdx]?.title ?? "this story"}"`}
                      </span>
                    </button>
                  );
                  const panel = (
                    <CapabilitiesPanel
                      // Remount per mode so each entry starts on its Simple tab.
                      key={mode}
                      onTabChange={setCapabilityTab}
                      workshop={mode === "workshop"}
                      capabilities={visibleCapabilities}
                      selectedProducts={selectedProducts}
                      onToggleProduct={handleToggleProduct}
                      onReplaceSelection={handleReplaceSelection}
                      expanded
                      isLoading={isSuggestingCapabilities}
                      explicitSelections={explicitSelections}
                      hideAppBundle={false}
                      align="left"
                    />
                  );
                  // ONE stable tree across the whole lifecycle — the panel + button
                  // never change position (the button only swaps its internal
                  // state), so nothing reflows when stories finish streaming. Only
                  // the wrapper classes change: the Custom tab renders the full
                  // grid inline, too wide to share a row, so it stacks with the
                  // button under the grid on the right. (Swapping the tree would
                  // remount the panel and snap it back to its Simple tab.)
                  const stacked = capabilityTab === "custom";
                  return (
                    <div
                      className={cn(
                        "flex flex-col items-stretch gap-3 pt-1 text-left",
                        !stacked && "sm:flex-row sm:items-end sm:justify-between",
                      )}
                    >
                      <div className="min-w-0 flex-1">{panel}</div>
                      <div className={cn("flex sm:pb-0.5", stacked ? "justify-end" : "justify-center")}>
                        {buildButton}
                      </div>
                    </div>
                  );
                })()}
              </form>
            </CardContent>
          </Card>

          {/* Example prompt chips — only when the input is empty. Clicking one
              fills the box (and triggers the same suggest stream a keystroke
              would). The old front-door "Build it / Diagram it / Workshop"
              toggle is GONE — output shape (full build vs diagram) is now a
              choice inside the Shape-it dialog, not an entry mode. */}
          {!isHeroCollapsed && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground">Try:</span>
              {(mode === "architecture"
                ? ARCH_EXAMPLE_PROMPTS
                : EXAMPLE_PROMPTS.map((text) => ({ text, style: null }))
              ).map(({ text: ex, style }) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setTopic(ex);
                    if (style) setArchStyleChoice(style);
                    // Defer height adjust to after the value commits.
                    requestAnimationFrame(adjustTextareaHeight);
                    textareaRef.current?.focus();
                  }}
                  className="rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          </div>

          {/* Research agent callout - hidden when collapsed */}
        </div>

        {/* Unified "Your work" — Recent / Shared / Invites in one calm tabbed
            surface (replaces four separately-stacked sections). Templates no
            longer live on the home page: matching templates surface as the
            lead card in the "choose a starting point" grid above (see the
            starting-point cards), and the full library lives at /templates. */}
        <ProjectsWorkSection
          className="relative z-10 mx-auto mt-12 w-full max-w-5xl"
          projects={projects}
          sharedProjects={sharedProjects}
          invitations={invitations}
          isLoadingProjects={isLoadingProjects}
          projectsError={projectsError}
          onOpenProject={handleOpenProject}
          onToggleStar={handleToggleStar}
          onCloneShared={handleCloneShared}
          cloningId={cloningSharedId}
          onInvitationRespond={handleInvitationRespond}
          onProjectDeleted={(id) => {
            setProjects((prev) => prev.filter((p) => p.id !== id));
            setSharedProjects((prev) => prev.filter((p) => p.id !== id));
          }}
        />

        <div className="h-12" />
      </main>
      <div className="absolute inset-0 -z-20 h-full w-full bg-background" />

      {/* Template detail slide-over */}
      <TemplateGallerySheet
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
        onFork={handleForkTemplate}
      />

      {/* ── Expanded-idea modal ────────────────────────────────────────────
          Opens from a card's Expand button. Shows the full idea and lets the
          user iterate on it in a chat-like input — edits stream back into the
          shared `ideas` array (handleExpandRefine) so the idea updates live in
          the modal. "Use this idea" hands off to the Shape dialog. */}
      <Dialog
        open={expandedIdeaIdx !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedIdeaIdx(null);
            setExpandRefineText("");
            setExpandedIdeaSnapshot(null);
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-3rem)] max-w-2xl max-h-[85vh] overflow-y-auto p-6 sm:p-7">
          {expandedIdeaIdx !== null && expandedIdeaSnapshot && (() => {
            // Render from the snapshot, NOT ideas[expandedIdeaIdx] directly, so
            // the modal body has a stable source even if `ideas` is transiently
            // shorter during a whole-grid re-stream. The sync effect keeps the
            // snapshot fresh; single-refine replaces the idea in place, so the
            // modal now updates live without ever blanking.
            const idea = expandedIdeaSnapshot;
            const busy = isRefining || isSuggestingCapabilities || isRefiningStories;
            return (
              <>
                <DialogHeader>
                  {/* The "Why this use-case works with your data" section below
                      already covers the rationale, so no separate "Why this?"
                      hover here. */}
                  <DialogTitle className="text-lg">{idea.title}</DialogTitle>
                </DialogHeader>

                {/* Fit signal (grounded flow only) — how well the user's real
                    tables support this idea. */}
                {idea.fit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        idea.fit.tier === "Great"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : idea.fit.tier === "Good"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                            : "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground"
                      }`}
                    >
                      <span aria-hidden className="text-[10px] leading-none">
                        {idea.fit.tier === "Great" ? "★" : idea.fit.tier === "Good" ? "●" : "○"}
                      </span>
                      {idea.fit.tier} fit
                    </span>
                    {/* The raw column/join clause (fit.reason, e.g. "trends
                        orders.total_amount over order_date by customers.segment")
                        is developer shorthand — too cryptic for the card. The
                        badge conveys the signal; the reason still rides into the
                        agent's context (data-discovery.md + build prompt). */}
                  </div>
                )}

                {/* Full hook — the modal shows the WHOLE narrative (cards clamp
                    it). Loading overlay covers it while an iteration streams. */}
                <div className="relative">
                  {busy && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-[1px]">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-xs">Updating the idea…</span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
                    {idea.hook.split("\n\n").map((paragraph, pIdx) => (
                      <p key={pIdx}>
                        {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, partIdx) =>
                          part.startsWith("**") && part.endsWith("**") ? (
                            <span key={partIdx} className="font-semibold text-foreground">
                              {part.slice(2, -2)}
                            </span>
                          ) : (
                            <span key={partIdx}>{part}</span>
                          ),
                        )}
                      </p>
                    ))}
                  </div>
                  {/* "Why this use-case works" — the LLM's conversational,
                      value-first take on what you'd get from this use-case on
                      your data. Only on expand. */}
                  {idea.why && (
                    <div className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.03] p-3 dark:bg-primary/10">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        Why this use-case works with your data
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90">{idea.why}</p>
                    </div>
                  )}
                  {/* Tables — collapsible, since a use-case can span many.
                      Collapsed by default; the summary shows the count. */}
                  {idea.datasources && idea.datasources.length > 0 && (
                    <details className="group mt-3">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
                        <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        {idea.datasources.length}{" "}
                        {idea.datasources.length === 1 ? "table" : "tables"}
                      </summary>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
                        {idea.datasources.map((ds, dsIdx) => (
                          <TableChip
                            key={dsIdx}
                            fullName={ds}
                            info={workspaceInfo}
                            full
                            className="bg-muted/50 text-[11px] text-muted-foreground"
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {/* Iterate — type an adjustment, watch the idea change above. */}
                <div className="mt-2 space-y-1.5 border-t border-border/50 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Iterate on this idea
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={expandRefineText}
                      onChange={(e) => setExpandRefineText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleExpandRefine();
                        }
                      }}
                      placeholder="e.g. make it more finance-focused, add a churn angle, raise the stakes…"
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={handleExpandRefine}
                      disabled={busy || !expandRefineText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Update
                    </button>
                  </div>
                </div>

                {/* Footer — commit this idea (hand to Shape dialog) or close. */}
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/50 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedIdeaIdx(null);
                      setExpandRefineText("");
                    }}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // Select this idea and RETURN to the home page — don't build
                      // yet. The user can still tweak capabilities/products there
                      // before creating; the home-page create button builds from
                      // ideas[selectedIdeaIdx] (which this sets). Any in-modal
                      // refinements persist because they were written back into
                      // `ideas` at this index.
                      setSelectedIdeaIdx(expandedIdeaIdx);
                      setExpandedIdeaIdx(null);
                      setExpandRefineText("");
                    }}
                    className="inline-flex items-center gap-2 rounded-md bg-destructive px-5 py-2 text-sm font-semibold text-destructive-foreground transition-all hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-sm"
                  >
                    <Sparkles className="h-4 w-4" />
                    Use this idea
                  </button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── "Use existing data" popup ──────────────────────────────────────
          Opened from the input's top-right data toggle. Pick catalogs / schemas
          / tables, then "Generate a story" scans them + runs the suggestion
          stream grounded in those tables.
          NOTE: no `overflow-*` on DialogContent — the picker's dropdown menus
          portal INTO this content node, and an overflow container here would
          clip them. The inner body scrolls instead. */}
      <Dialog
        open={groundingOpen}
        onOpenChange={(open) => {
          // Don't scan/suggest on a plain dismiss — the "Analyze data and
          // generate a story" button is the explicit commit. A dismiss reverts
          // to the default (nothing selected) state when no tables are picked.
          if (!open && !isScanningTables) {
            setGroundingOpen(false);
            if (groundingTables.length === 0) setUseSyntheticData(true);
          }
                }}
      >
        {/* Grid rows: header (auto) · picker (minmax(0,1fr) — absorbs slack and
            SCROLLS when the selection is tall) · opt-in (auto) · footer (auto).
            This keeps the footer button on-screen no matter how many tables are
            selected (repro: 38 tables), while still sizing to content when the
            selection is small. NO overflow on DialogContent itself — the picker's
            dropdown menus portal INTO this node as position:fixed and an overflow
            container here would clip them; the picker row scrolls instead. */}
        <DialogContent className="w-[calc(100vw-3rem)] max-w-3xl sm:max-w-3xl max-h-[88vh] grid-rows-[auto_minmax(0,1fr)_auto_auto] p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>Build on your existing data</DialogTitle>
            <DialogDescription>
              Pick the tables to build the solution on. The dashboards, Genie space,
              and metric views run <strong>directly on your real tables</strong>,{" "}
              <strong>read-only</strong> — nothing is generated or copied, and your
              tables are never written to.
            </DialogDescription>
          </DialogHeader>

          {/* Fills its grid row (minmax(0,1fr)) and scrolls when the selection
              grows tall — so the footer below stays visible. `min-h-0` lets it
              shrink below content height so the overflow actually kicks in. The
              picker's dropdown menus portal to the DialogContent (OUTSIDE this
              box) so they aren't clipped by this overflow. */}
          <div className="min-h-0 overflow-y-auto py-1">
            <GroundingTablePicker
              catalogs={groundingCatalogs}
              schemas={groundingSchemas}
              selectedTables={groundingTables}
              onCatalogsChange={setGroundingCatalogs}
              onSchemasChange={setGroundingSchemas}
              onSelectedTablesChange={setGroundingTables}
            />
          </div>

          {/* Opt-in: by default a grounded demo is read-only analytics on the
              real tables. Checking this lets the demo create its OWN supporting
              data (for apps, ML, write-back) — the real tables stay read-only. */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={allowDataWrite}
              onCheckedChange={(v) => setAllowDataWrite(v === true)}
              className="mt-0.5"
            />
            <span className="text-[12.5px] leading-snug">
              <span className="font-medium text-foreground">
                Let the demo add its own supporting data
              </span>
              <span className="block text-muted-foreground">
                Off by default — the demo reads your tables only. Turn on to let it
                create extra tables (in its own catalog) for apps, ML, or write-back.
                Your selected tables stay read-only either way.
              </span>
            </span>
          </label>

          <div className="border-t border-border/50 pt-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setGroundingOpen(false);
                  if (groundingTables.length === 0) setUseSyntheticData(true);
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                // Explicit commit: scan the tables (warm the cache), close the
                // popup, then run the grounded /suggest so stories appear below.
                onClick={() => commitGrounding(groundingTables)}
                disabled={groundingTables.length === 0 || isScanningTables}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {isScanningTables ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isScanningTables ? (scanStatus || "Analyzing data…") : "Analyze data & suggest use-cases"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>


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
