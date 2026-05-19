/**
 * Project page route - displays file viewer on left, chat panel on right.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileViewer } from "@/components/project/file-viewer";
import type { AutoFixApi } from "@/preview";
import { BuildStepper } from "@/components/project/build-stepper";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatPanel, type ThinkingBlock } from "@/components/project/chat-panel";
import { HeaderStatusPill } from "@/components/project/project-overview";
import { SkillsPopup } from "@/components/project/skills-popup";
import { UserMenu } from "@/components/layout/user-menu";
import { TemplatePublishDialog } from "@/components/project/template-publish-dialog";
import { DescriptionEditDialog } from "@/components/project/description-edit-dialog";
import {
  ResourcesPopover,
  type ProjectResources,
} from "@/components/project/resources-popover";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Upload,
  Loader2,
  Pencil,
  Check,
  X,
  FileEdit,
  GitFork,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  LayoutTemplate,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  getProject,
  listProjectFiles,
  getProjectFile,
  listProjectMessages,
  invokeAgent,
  streamAgentProgress,
  stopAgentStream,
  getActiveExecution,
  deleteProject,
  clearProjectSession,
  updateProject,
  getTemplateByProject,
  downloadProjectAsZip,
  getDeployedResources,
  generateProjectNarrative,
  type Project,
  type ProjectFile,
  type ProjectFileContent,
  type Message,
  type TemplateDetail,
  type DeployedResources,
  type ReasoningEntry,
} from "@/lib/custom-api";
import { AUTO_BUILD_KICKOFF } from "@/lib/auto-build-prompt";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
});

// Tool names that change files on disk — trigger a sidebar refresh on their tool_result.
const FILE_MUTATING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Build the persisted reasoning_data array (the same shape the backend
 *  emits via collect_reasoning) from the structured streaming state.
 *  Interleaves thinking blocks and tool calls in chronological order so a
 *  page reload — or any consumer reading reasoning_data — sees the same
 *  timeline the user just watched stream in. */
function buildChronologicalReasoning(
  thinkingBlocks: ThinkingBlock[],
  tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>,
): ReasoningEntry[] {
  type Row =
    | { kind: "thinking"; t: number; block: ThinkingBlock }
    | { kind: "tool"; t: number; id: string; tool: { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string } };
  const rows: Row[] = [];
  for (const b of thinkingBlocks) {
    const t = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    rows.push({ kind: "thinking", t: isNaN(t) ? 0 : t, block: b });
  }
  for (const [id, tool] of tools.entries()) {
    const t = tool.startedAt ? new Date(tool.startedAt).getTime() : 0;
    rows.push({ kind: "tool", t: isNaN(t) ? 0 : t, id, tool });
  }
  rows.sort((a, b) => a.t - b.t);
  const out: ReasoningEntry[] = [];
  for (const r of rows) {
    if (r.kind === "thinking") {
      const entry: ReasoningEntry = { type: "thinking", content: r.block.content };
      if (r.block.startedAt) entry.started_at = r.block.startedAt;
      if (r.block.completedAt) entry.completed_at = r.block.completedAt;
      out.push(entry);
    } else {
      out.push({ type: "tool", id: r.id, name: r.tool.name, input: r.tool.input, started_at: r.tool.startedAt });
      if (r.tool.result !== undefined) {
        out.push({
          type: "tool_result",
          tool_id: r.id,
          content: r.tool.result,
          is_error: r.tool.isError ?? false,
          completed_at: r.tool.completedAt,
        });
      }
    }
  }
  return out;
}

// First H1 of a markdown doc, skipping any leading YAML frontmatter block.
function extractReadmeTitle(markdown: string): string | null {
  const lines = markdown.split("\n");
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

function ProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();

  // Project state
  const [project, setProject] = useState<Project | null>(null);
  const [projectNotFound, setProjectNotFound] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<ProjectFileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileContentKey, setFileContentKey] = useState(0);
  const [architectureContent, setArchitectureContent] = useState<string | null>(null);
  const [isCreatingArchitecture, setIsCreatingArchitecture] = useState(false);
  const [isPackagingDAB, setIsPackagingDAB] = useState(false);
  const [deployedResources, setDeployedResources] = useState<DeployedResources | null>(null);
  // Capabilities parsed from `resources.json` — drives the DemoOverviewCard.
  // We can't pull this off `project.capabilities` because that's a flat
  // list without the buildable/talking_track split.
  const [capabilities, setCapabilities] = useState<{ buildable: string[]; talking_track: string[] } | null>(null);

  const applyDeployedResources = useCallback((deployed: DeployedResources | null) => {
    setDeployedResources(deployed);
  }, []);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isClearingSession, setIsClearingSession] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinkingBlocks, setStreamingThinkingBlocks] = useState<ThinkingBlock[]>([]);
  const [streamingTools, setStreamingTools] = useState<Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>>(new Map());
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [lastReasoning, setLastReasoning] = useState<{ thinking: string; thinkingBlocks: ThinkingBlock[]; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean }> } | null>(null);

  // Delete dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteComplete, setIsDeleteComplete] = useState(false);

  // Skills popup state
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  // "Show hidden files" toggle — when true, the file tree includes
  // .databrickscfg, .claude/skills/, .preview.pgid, etc. Triggered by
  // the small EyeOff icon on the file viewer sidebar. Off by default
  // because the everyday user doesn't need them; SAs use them to debug
  // deployed-mode auth shape.
  const [showHidden, setShowHidden] = useState(false);

  // Template state
  const [linkedTemplate, setLinkedTemplate] = useState<TemplateDetail | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [forkBannerDismissed, setForkBannerDismissed] = useState(true);

  // Project name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  // Project description editing state — opens a modal that supports both
  // manual edits and an AI-assist rewrite.
  const [isDescriptionDialogOpen, setIsDescriptionDialogOpen] = useState(false);

  // Resources popover state
  const [isResourcesOpen, setIsResourcesOpen] = useState(false);
  const [resources, setResources] = useState<ProjectResources>({
    clusterId: null,
    clusterName: null,
    warehouseId: null,
    warehouseName: null,
    catalog: null,
    schema: null,
  });

  // Mobile panel toggle (files vs chat)
  const isMobile = useIsMobile();
  const [mobilePanel, setMobilePanel] = useState<"files" | "chat">("chat");

  // Chat panel resize + collapse state.
  // Chat starts COLLAPSED — non-technical users land on the Overview and
  // only open chat when they want to interact. New empty projects (no
  // README yet) auto-expand once below so the agent prompt is visible
  // for the very first interaction.
  const DEFAULT_CHAT_WIDTH = 520;
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const hasReadmeRef = useRef(false);
  const isResizingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const MIN_CHAT_WIDTH = 360;
  const MAX_CHAT_WIDTH = 800;

  // README content state — drives the "About this demo" expander on the
  // overview. Kept separate from `fileContent` so it doesn't shadow
  // whatever file the user has open in the Files tab.
  const [readmeContent, setReadmeContent] = useState<string | null>(null);

  const handleToggleChat = useCallback(() => {
    setIsChatOpen((open) => {
      const next = !open;
      // Re-expanding restores the user's preferred width if they had
      // already shrunk it. Otherwise default.
      if (next && chatWidth < MIN_CHAT_WIDTH) setChatWidth(DEFAULT_CHAT_WIDTH);
      return next;
    });
  }, [chatWidth]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - moveEvent.clientX;
      setChatWidth(Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Sync stage and resources from project when it loads
  // Load resources from project when it loads (names now come from project directly)
  useEffect(() => {
    if (project) {
      setResources({
        clusterId: project.cluster_id,
        clusterName: project.cluster_name,
        warehouseId: project.warehouse_id,
        warehouseName: project.warehouse_name,
        catalog: project.default_catalog,
        schema: project.default_schema,
      });
    }
  }, [project]);

  // Check if this project has a linked template
  useEffect(() => {
    getTemplateByProject(projectId)
      .then(setLinkedTemplate)
      .catch(() => setLinkedTemplate(null));
  }, [projectId]);

  // Chat stays collapsed by default — even for brand-new projects. The
  // floating FAB in the bottom-right is the entry point. When the project
  // is empty the FAB pulses to draw attention (see ChatFab below).

  // Once a README appears for the first time, snap the chat width back to
  // the default in case the user happens to have it open and oversized.
  useEffect(() => {
    const hasReadme = files.some((f) => f.path === "README.md");
    if (hasReadme && !hasReadmeRef.current) {
      hasReadmeRef.current = true;
      setChatWidth((w) => (w > DEFAULT_CHAT_WIDTH ? DEFAULT_CHAT_WIDTH : w));
    } else if (!hasReadme) {
      hasReadmeRef.current = false;
    }
  }, [files]);

  // Load README.md content for the overview's "About this demo" expander.
  // Refetches on fileContentKey bumps (agent edits) so the expander stays
  // current after iterating on the story.
  const hasReadmeFile = useMemo(
    () => files.some((f) => f.path === "README.md"),
    [files],
  );
  useEffect(() => {
    if (!hasReadmeFile) {
      setReadmeContent(null);
      return;
    }
    let cancelled = false;
    getProjectFile(projectId, "README.md")
      .then((file) => {
        if (!cancelled) setReadmeContent(file.content);
      })
      .catch(() => {
        if (!cancelled) setReadmeContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, hasReadmeFile, fileContentKey]);

  // ---------------------------------------------------------------------
  // LLM-generated narrative for the Overview hero.
  //
  // We auto-generate a 1-2 paragraph storytelling summary from the README
  // whenever it drifts from the cached version (sha256(README) recorded
  // on the project row). Guards against thrashing: skips while the agent
  // is streaming, debounces re-runs, and ignores generation errors so
  // the hero falls back to a friendly empty state.
  // ---------------------------------------------------------------------
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const narrativeAttemptRef = useRef<string | null>(null);

  const handleRegenerateNarrative = useCallback(async () => {
    if (!project || isGeneratingNarrative) return;
    setIsGeneratingNarrative(true);
    try {
      const updated = await generateProjectNarrative(projectId);
      setProject(updated);
    } catch (e) {
      console.error("Narrative generation failed:", e);
    } finally {
      setIsGeneratingNarrative(false);
    }
  }, [project, projectId, isGeneratingNarrative]);

  useEffect(() => {
    if (!project || !readmeContent || isStreaming || isGeneratingNarrative) return;
    let cancelled = false;
    (async () => {
      const trimmed = readmeContent.trim();
      if (!trimmed) return;
      // Hash matches backend `_readme_hash` (sha256 of stripped README).
      const buf = new TextEncoder().encode(trimmed);
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (cancelled) return;
      const isStale =
        !project.narrative || project.narrative_readme_hash !== hash;
      // Avoid retrying the same hash twice if the LLM call fails — the
      // user can still manually retry via the regenerate button.
      if (!isStale || narrativeAttemptRef.current === hash) return;
      narrativeAttemptRef.current = hash;
      handleRegenerateNarrative();
    })();
    return () => {
      cancelled = true;
    };
  }, [project, readmeContent, isStreaming, isGeneratingNarrative, handleRegenerateNarrative]);

  // Ref to track selectedFile without causing handleSendMessage to recreate
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Wall-clock timestamp of the most recent event drained from the SSE
  // stream (any event — text/thinking/tool/keepalive/etc). Used by the
  // visibility-change handler to decide if the stream has gone silent
  // (e.g. browser dropped the streaming body in a backgrounded tab) and
  // needs to be force-aborted + resumed. 0 = no event yet.
  const lastEventReceivedAtRef = useRef<number>(0);

  // Ref to capture reasoning during streaming (for saving in finally)
  const reasoningRef = useRef<{ thinking: string; thinkingBlocks: ThinkingBlock[]; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }> } | null>(null);

  // Debounced file list refresh — avoids N parallel /files calls when
  // the agent writes multiple files in quick succession. Reads
  // `showHidden` via a ref so toggling the flag doesn't recreate the
  // debouncer; the existing useEffect below covers the toggle case.
  const fileRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHiddenRef = useRef(false);
  const debouncedRefreshFiles = useCallback(() => {
    if (fileRefreshTimerRef.current) clearTimeout(fileRefreshTimerRef.current);
    fileRefreshTimerRef.current = setTimeout(() => {
      listProjectFiles(projectId, { includeHidden: showHiddenRef.current })
        .then(setFiles)
        .catch(() => {});
    }, 500);
  }, [projectId]);

  // Keep the ref in sync, and re-fetch whenever the user toggles
  // "show hidden" so the file tree picks up .databrickscfg / .claude/
  // immediately. The hidden walk is uncached on the server, so this
  // always reflects current disk state.
  useEffect(() => {
    showHiddenRef.current = showHidden;
    listProjectFiles(projectId, { includeHidden: showHidden })
      .then(setFiles)
      .catch(() => {});
  }, [showHidden, projectId]);

  // Loading state for the entire page
  const [isLoadingProject, setIsLoadingProject] = useState(true);

  // Load project data - all calls in parallel
  useEffect(() => {
    async function loadProject() {
      setIsLoadingProject(true);
      setIsLoadingMessages(true);
      try {
        // Load all data in parallel
        const [proj, fileList, msgs, deployed] = await Promise.all([
          getProject(projectId),
          listProjectFiles(projectId, { includeHidden: showHidden }),
          listProjectMessages(projectId),
          getDeployedResources(projectId).catch(() => null),
        ]);

        setProject(proj);
        setFiles(fileList);
        setMessages(msgs);
        applyDeployedResources(deployed);

        // Surface the "this is your editable copy" banner on forked projects
        // until the user dismisses it (per-project, persisted in localStorage).
        if (proj?.source_template_name) {
          const dismissed = localStorage.getItem(`forkBannerDismissed:${projectId}`) === "1";
          setForkBannerDismissed(dismissed);
        }

        // Select README.md by default if it exists
        const readme = fileList.find((f) => f.path === "README.md");
        if (readme) {
          setSelectedFile("README.md");
          // README already exists — use default chat width
          hasReadmeRef.current = true;
          setChatWidth(DEFAULT_CHAT_WIDTH);
        } else if (fileList.length > 0) {
          setSelectedFile(fileList[0].path);
        }
      } catch (error) {
        console.error("Failed to load project:", error);
        // Check if it's a 404 error
        if (error instanceof Error && error.message.includes("404")) {
          setProjectNotFound(true);
        }
      } finally {
        setIsLoadingProject(false);
        setIsLoadingMessages(false);
      }
    }

    loadProject();
  }, [projectId]);

  // Load file content when selected file changes or after agent completion
  useEffect(() => {
    async function loadFileContent() {
      if (!selectedFile) {
        setFileContent(null);
        return;
      }

      setIsLoadingFile(true);
      try {
        const content = await getProjectFile(projectId, selectedFile);
        setFileContent(content);
      } catch (error) {
        console.error("Failed to load file:", error);
        setFileContent(null);
      } finally {
        setIsLoadingFile(false);
      }
    }

    loadFileContent();
  }, [projectId, selectedFile, fileContentKey]);

  // Ref to reach into the AppPreviewTab's auto-fix API (for budget reset).
  const autoFixApiRef = useRef<AutoFixApi | null>(null);

  // Handle sending a message to the agent
  const handleSendMessage = useCallback(
    async (
      message: string,
      options: { skipOptimisticUserMessage?: boolean; isAutoFix?: boolean } = {},
    ) => {
      if (isStreaming) return;

      const skipOptimistic = options.skipOptimisticUserMessage ?? false;
      const isAutoFix = options.isAutoFix ?? false;

      // A manual user message resets the auto-fix budget back to the full
      // allowance — the user has taken the wheel, so we can auto-fix again
      // if new errors appear later. Auto-fix sends themselves don't reset.
      if (!isAutoFix && !skipOptimistic) {
        autoFixApiRef.current?.resetBudget();
      }

      // Show user message immediately (unless it's already in `messages` from
      // the DB, e.g. auto-kicking the project's opening prompt).
      if (!skipOptimistic) {
        setPendingUserMessage(message);
      }
      setLastReasoning(null);
      reasoningRef.current = null;
      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinkingBlocks([]);
      setStreamingTools(new Map());

      try {
        if (!skipOptimistic) {
          // Add user message to local state immediately so it's visible
          // even if the stream fails or the backend restarts
          const userMsg: Message = {
            id: Date.now(),
            project_id: projectId,
            role: "user",
            content: message,
            is_error: false,
            created_at: new Date().toISOString(),
          };
          setMessages(prev => [...prev, userMsg]);
          setPendingUserMessage(null);
        }

        // Start agent. When skipOptimistic is true, the user message is already
        // persisted in the DB — tell the backend not to save it again.
        const response = await invokeAgent(projectId, message, {
          saveUserMessage: !skipOptimistic,
        });
        setExecutionId(response.execution_id);

        // Create abort controller
        abortControllerRef.current = new AbortController();

        // Stream progress
        let fullContent = "";
        // Thinking is tracked as a list of discrete blocks (one per
        // ThinkingBlock the model emits) so each "Thought for Xs" can be
        // rendered inline at the spot it actually happened in the
        // timeline. Any non-thinking event closes the open block.
        const thinkingBlocks: ThinkingBlock[] = [];
        let openBlockId: string | null = null;
        let openBlockLastDeltaAt: string | null = null;
        let blockCounter = 0;
        const closeOpenThinking = () => {
          if (openBlockId === null) return;
          const idx = thinkingBlocks.findIndex((b) => b.id === openBlockId);
          if (idx !== -1 && !thinkingBlocks[idx].completedAt) {
            thinkingBlocks[idx] = {
              ...thinkingBlocks[idx],
              completedAt: openBlockLastDeltaAt ?? new Date().toISOString(),
            };
          }
          openBlockId = null;
          openBlockLastDeltaAt = null;
        };
        const snapshotThinking = () => thinkingBlocks.map((b) => ({ ...b }));
        let streamErrorMessage: string | null = null;
        let streamWasCancelled = false;
        let sawStreamCompleted = false;
        const toolsMap = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>();
        const updateRef = () => {
          reasoningRef.current = {
            thinking: thinkingBlocks.map((b) => b.content).join("\n\n"),
            thinkingBlocks: snapshotThinking(),
            tools: new Map(toolsMap),
          };
        };

        for await (const event of streamAgentProgress(
          response.execution_id,
          abortControllerRef.current.signal
        )) {
          // Heartbeat for the visibility-recovery handler — any event
          // (incl. ones we don't render) proves the stream is alive.
          lastEventReceivedAtRef.current = Date.now();
          if (event.type === "text_delta") {
            closeOpenThinking();
            fullContent += event.text;
            setStreamingContent(fullContent);
          } else if (event.type === "text_block_start") {
            closeOpenThinking();
            // Insert a paragraph break between consecutive text blocks
            // within a turn so they don't render as one wall of text.
            if (fullContent.length > 0 && !fullContent.endsWith("\n\n")) {
              fullContent += "\n\n";
              setStreamingContent(fullContent);
            }
          } else if (event.type === "text") {
            // Final aggregated text event. In the normal streaming case the
            // deltas already gave us the same content — skip. But when the
            // backend short-circuits (e.g. "Not logged in" before streaming
            // starts) this event arrives with no preceding deltas, so we
            // must render it; otherwise the user only sees the error after
            // a page refresh (DB has it, live UI doesn't).
            if (fullContent.length === 0) {
              closeOpenThinking();
              fullContent += event.text;
              setStreamingContent(fullContent);
            }
          } else if (event.type === "thinking_delta") {
            const ts = event.timestamp || new Date().toISOString();
            if (openBlockId === null) {
              const id = `tb-${++blockCounter}`;
              thinkingBlocks.push({ id, content: event.thinking, startedAt: ts });
              openBlockId = id;
            } else {
              const idx = thinkingBlocks.findIndex((b) => b.id === openBlockId);
              if (idx !== -1) {
                thinkingBlocks[idx] = { ...thinkingBlocks[idx], content: thinkingBlocks[idx].content + event.thinking };
              }
            }
            openBlockLastDeltaAt = ts;
            setStreamingThinkingBlocks(snapshotThinking());
            updateRef();
          } else if (event.type === "thinking") {
            // Final aggregated thinking block — close the current open one.
            closeOpenThinking();
            setStreamingThinkingBlocks(snapshotThinking());
            updateRef();
          } else if (event.type === "tool_use") {
            closeOpenThinking();
            setStreamingThinkingBlocks(snapshotThinking());
            // Tool started - add with pending state. Fall back to client clock
            // if the backend didn't stamp the event (older streams, replays).
            toolsMap.set(event.tool_id, {
              name: event.tool_name,
              input: event.tool_input,
              startedAt: event.timestamp || new Date().toISOString(),
            });
            setStreamingTools(new Map(toolsMap));
            updateRef();
          } else if (event.type === "tool_result") {
            closeOpenThinking();
            // Tool completed - update with result
            const existing = toolsMap.get(event.tool_use_id);
            if (existing) {
              toolsMap.set(event.tool_use_id, {
                ...existing,
                result: event.content,
                isError: event.is_error ?? false,
                completedAt: event.timestamp || new Date().toISOString(),
              });
              setStreamingTools(new Map(toolsMap));
              updateRef();
              // Live-refresh the sidebar when a file-modifying tool succeeds
              if (!event.is_error && FILE_MUTATING_TOOLS.has(existing.name)) {
                debouncedRefreshFiles();
              }
            }
          } else if (event.type === "file_changed") {
            // Watchdog detected a file change — refresh file list and content
            debouncedRefreshFiles();
            if (selectedFileRef.current === event.path) {
              setFileContentKey((k) => k + 1);
            }
          } else if (event.type === "error") {
            // The agent failed (typically: Claude Code subprocess died,
            // FMAPI 4xx, etc.). Stash the message so we can surface it
            // as an error-styled assistant bubble instead of just
            // disappearing into the console.
            console.error("Agent error:", event.error);
            streamErrorMessage = event.error || "Agent error (no details)";
          } else if (event.type === "stream.completed") {
            // Backend includes the terminal status here. Capture cancel
            // too so a stream that was cancelled mid-flight (e.g. via
            // /stop_stream) renders with the warning style.
            if (event.is_error && !streamErrorMessage) {
              streamErrorMessage = "Agent error (no details)";
            }
            if (event.is_cancelled) {
              streamWasCancelled = true;
            }
            sawStreamCompleted = true;
            break;
          }
        }

        // If the loop ended without an explicit `stream.completed` (the
        // SSE generator gave up retrying, network died, etc.), the agent
        // may still be running server-side. Don't append a fake assistant
        // bubble — kick the resume path so we re-attach and keep going.
        if (!sawStreamCompleted && !streamErrorMessage) {
          abortControllerRef.current = null;
          setExecutionId(null);
          setTimeout(() => { void tryResumeActiveExecution(); }, 0);
          return;
        }

        // Close any still-open thinking block (e.g. loop ended on
        // stream.completed without a trailing tool/text).
        closeOpenThinking();
        updateRef();

        // Add assistant message locally (user message already added above).
        // Tear down the streaming UI state in the SAME React batch as
        // appending the message — otherwise the streaming bubble (still
        // rendered because isStreaming=true) and the new persisted
        // bubble both render for one frame, producing a visible
        // duplicate-then-flicker. The `finally` block keeps the same
        // resets as a safety net for the error path.
        // Compose the message body. Three cases:
        //   - happy path: fullContent (the streamed text)
        //   - error: prepend the error so the bubble has visible body
        //     (the bubble's red `is_error` style needs content to render)
        //   - cancel: fullContent (whatever streamed before /stop_stream
        //     fired) is enough; the bubble appends "Canceled by user"
        const messageContent = streamErrorMessage
          ? (fullContent
              ? `${fullContent}\n\n---\n\n**Agent error:** ${streamErrorMessage}`
              : `**Agent error:** ${streamErrorMessage}`)
          : fullContent;
        const finalReasoning = reasoningRef.current as null | { thinking: string; thinkingBlocks: ThinkingBlock[]; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }> };
        const assistantMsg: Message = {
          id: Date.now() + 1,
          project_id: projectId,
          role: "assistant",
          content: messageContent,
          is_error: streamErrorMessage !== null,
          is_cancelled: streamWasCancelled,
          reasoning_data: finalReasoning
            ? { reasoning: buildChronologicalReasoning(finalReasoning.thinkingBlocks, finalReasoning.tools) }
            : null,
          created_at: new Date().toISOString(),
        };
        if (reasoningRef.current) {
          setLastReasoning(reasoningRef.current);
        }
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinkingBlocks([]);
        setStreamingTools(new Map());
        setPendingUserMessage(null);
        setMessages(prev => [...prev, assistantMsg]);

        // Refresh files + deployed resources lists — agent may have created
        // new files or new resources (Genie spaces, dashboards, etc.).
        // We deliberately don't re-fetch the currently-selected file here:
        // the file watcher fires `file_changed` events during the stream
        // for any file the agent wrote, which already bumps fileContentKey
        // and triggers loadFileContent. The unconditional refetch we used
        // to do here was producing a duplicate GET after every chat turn.
        const [fileList, deployed] = await Promise.all([
          listProjectFiles(projectId, { includeHidden: showHidden }),
          getDeployedResources(projectId).catch(() => null),
        ]);
        setFiles(fileList);
        applyDeployedResources(deployed);

        // Auto-select README.md if no file is currently selected
        if (!selectedFileRef.current) {
          const readme = fileList.find((f) => f.path === "README.md");
          if (readme) {
            setSelectedFile("README.md");
          } else if (fileList.length > 0) {
            setSelectedFile(fileList[0].path);
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Failed to send message:", error);
          toast.error((error as Error).message || "Stream disconnected");
        }
        // Re-fetch messages and files from DB — the agent may still be
        // running server-side even though our SSE stream dropped, or
        // this was an abort after stop (backend saved the response).
        try {
          const [msgs, fileList, deployed] = await Promise.all([
            listProjectMessages(projectId),
            listProjectFiles(projectId, { includeHidden: showHidden }),
            getDeployedResources(projectId).catch(() => null),
          ]);
          setMessages(msgs);
          setFiles(fileList);
          applyDeployedResources(deployed);

          // Auto-select README.md if no file is selected
          let fileToLoad = selectedFileRef.current;
          if (!fileToLoad) {
            const readme = fileList.find((f) => f.path === "README.md");
            if (readme) {
              fileToLoad = "README.md";
              setSelectedFile("README.md");
            } else if (fileList.length > 0) {
              fileToLoad = fileList[0].path;
              setSelectedFile(fileList[0].path);
            }
          }

          // Refresh file content — agent may have written files before the stream dropped
          if (fileToLoad) {
            try {
              const content = await getProjectFile(projectId, fileToLoad);
              setFileContent(content);
            } catch { /* file may not exist yet */ }
          }
        } catch { /* ignore fetch errors during recovery */ }
      } finally {
        // Safety net for the error path. The success path already cleared
        // these in the try block (in the same batch as appending the
        // assistant message, to avoid a flicker). Calling again here is a
        // no-op when state is already empty.
        if (reasoningRef.current) {
          setLastReasoning(reasoningRef.current);
        }
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinkingBlocks([]);
        setStreamingTools(new Map());
        setPendingUserMessage(null);
        setExecutionId(null);
        abortControllerRef.current = null;
      }
    },
    // tryResumeActiveExecution is defined below in the same component
    // scope — it's in the closure by the time this callback ever runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, isStreaming]
  );

  // Resume an in-flight server-side execution by attaching a fresh SSE
  // consumer. Safe to call repeatedly — bails out if a stream is already
  // live (`abortControllerRef.current` non-null) or if the server has no
  // active execution. Used by:
  //   1. The on-mount reconnect (after page refresh / nav-back)
  //   2. The visibility-change recovery (tab came back, our reader died)
  const tryResumeActiveExecution = useCallback(async () => {
    // Already streaming on this client — nothing to do.
    if (abortControllerRef.current) return;

    type ExecutionInfo = { execution_id: string; project_id: string; is_running: boolean };
    let execution: ExecutionInfo | null = null;
    try {
      execution = (await getActiveExecution(projectId)) as ExecutionInfo | null;
    } catch {
      return;
    }
    if (!execution || !execution.is_running) return;
    // Re-check guard — we awaited an HTTP call, another path may have
    // started a stream in the meantime.
    if (abortControllerRef.current) return;
    const exec = execution;

    // There's an active execution — resume streaming
    setIsStreaming(true);
    setExecutionId(exec.execution_id);
    abortControllerRef.current = new AbortController();
    lastEventReceivedAtRef.current = Date.now();

    try {
      let fullContent = "";
      const thinkingBlocks: ThinkingBlock[] = [];
      let openBlockId: string | null = null;
      let openBlockLastDeltaAt: string | null = null;
      let blockCounter = 0;
      const closeOpenThinking = () => {
        if (openBlockId === null) return;
        const idx = thinkingBlocks.findIndex((b) => b.id === openBlockId);
        if (idx !== -1 && !thinkingBlocks[idx].completedAt) {
          thinkingBlocks[idx] = {
            ...thinkingBlocks[idx],
            completedAt: openBlockLastDeltaAt ?? new Date().toISOString(),
          };
        }
        openBlockId = null;
        openBlockLastDeltaAt = null;
      };
      const snapshotThinking = () => thinkingBlocks.map((b) => ({ ...b }));
      const toolsMap = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>();
      const updateRef = () => {
        reasoningRef.current = {
          thinking: thinkingBlocks.map((b) => b.content).join("\n\n"),
          thinkingBlocks: snapshotThinking(),
          tools: new Map(toolsMap),
        };
      };
      let sawStreamCompleted = false;

      for await (const event of streamAgentProgress(
        exec.execution_id,
        abortControllerRef.current.signal
      )) {
        // Heartbeat for the visibility-recovery handler.
        lastEventReceivedAtRef.current = Date.now();
        if (event.type === "text_delta") {
          closeOpenThinking();
          fullContent += event.text;
          setStreamingContent(fullContent);
        } else if (event.type === "text_block_start") {
          closeOpenThinking();
          if (fullContent.length > 0 && !fullContent.endsWith("\n\n")) {
            fullContent += "\n\n";
            setStreamingContent(fullContent);
          }
        } else if (event.type === "text") {
          // See live-stream path: render the aggregated text only when no
          // deltas preceded it (short-circuit / error cases).
          if (fullContent.length === 0) {
            closeOpenThinking();
            fullContent += event.text;
            setStreamingContent(fullContent);
          }
        } else if (event.type === "thinking_delta") {
          const ts = event.timestamp || new Date().toISOString();
          if (openBlockId === null) {
            const id = `tb-${++blockCounter}`;
            thinkingBlocks.push({ id, content: event.thinking, startedAt: ts });
            openBlockId = id;
          } else {
            const idx = thinkingBlocks.findIndex((b) => b.id === openBlockId);
            if (idx !== -1) {
              thinkingBlocks[idx] = { ...thinkingBlocks[idx], content: thinkingBlocks[idx].content + event.thinking };
            }
          }
          openBlockLastDeltaAt = ts;
          setStreamingThinkingBlocks(snapshotThinking());
          updateRef();
        } else if (event.type === "thinking") {
          closeOpenThinking();
          setStreamingThinkingBlocks(snapshotThinking());
          updateRef();
        } else if (event.type === "tool_use") {
          closeOpenThinking();
          setStreamingThinkingBlocks(snapshotThinking());
          toolsMap.set(event.tool_id, { name: event.tool_name, input: event.tool_input, startedAt: event.timestamp || new Date().toISOString() });
          setStreamingTools(new Map(toolsMap));
          updateRef();
        } else if (event.type === "tool_result") {
          closeOpenThinking();
          const existing = toolsMap.get(event.tool_use_id);
          if (existing) {
            toolsMap.set(event.tool_use_id, { ...existing, result: event.content, isError: event.is_error ?? false, completedAt: event.timestamp || new Date().toISOString() });
            setStreamingTools(new Map(toolsMap));
            updateRef();
            if (!event.is_error && FILE_MUTATING_TOOLS.has(existing.name)) {
              debouncedRefreshFiles();
            }
          }
        } else if (event.type === "file_changed") {
          debouncedRefreshFiles();
          if (selectedFileRef.current === event.path) {
            setFileContentKey((k) => k + 1);
          }
        } else if (event.type === "stream.completed") {
          sawStreamCompleted = true;
          break;
        }
      }

      // Same defensive check as handleSendMessage: if the generator gave
      // up retrying without a real terminator, the agent may still be
      // running on the server. Re-attach instead of declaring it done.
      if (!sawStreamCompleted) {
        abortControllerRef.current = null;
        setExecutionId(null);
        setTimeout(() => { void tryResumeActiveExecution(); }, 0);
        return;
      }

      closeOpenThinking();
      updateRef();

      // Refresh messages, files, and deployed resources from DB after agent
      // completion. Tear down streaming UI in the SAME React batch as
      // applying messages so the streaming bubble doesn't co-render with
      // the persisted bubble for a frame (= the duplicate-then-flicker).
      // No unconditional getProjectFile here either: file_changed events
      // during the stream already refreshed the selected file's content.
      const [msgs, fileList, deployed] = await Promise.all([
        listProjectMessages(projectId),
        listProjectFiles(projectId),
        getDeployedResources(projectId).catch(() => null),
      ]);
      if (reasoningRef.current) setLastReasoning(reasoningRef.current);
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingThinkingBlocks([]);
      setStreamingTools(new Map());
      setMessages(msgs);
      setFiles(fileList);
      applyDeployedResources(deployed);

      // Auto-select README.md if no file is selected
      if (!selectedFileRef.current) {
        const readme = fileList.find((f) => f.path === "README.md");
        if (readme) {
          setSelectedFile("README.md");
        } else if (fileList.length > 0) {
          setSelectedFile(fileList[0].path);
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Failed to reconnect to agent:", error);
        toast.error((error as Error).message || "Lost connection to agent");
      }
    } finally {
      // Safety net — success path already cleared these.
      if (reasoningRef.current) setLastReasoning(reasoningRef.current);
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingThinkingBlocks([]);
      setStreamingTools(new Map());
      setExecutionId(null);
      abortControllerRef.current = null;
    }
  }, [projectId, debouncedRefreshFiles]);

  // On-mount reconnect: if the server has an in-flight execution for this
  // project (e.g. after page refresh or nav-back), resume the SSE consumer.
  // The agent task runs server-side regardless of client connection.
  const reconnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (reconnectAttemptedRef.current || isLoadingProject) return;
    reconnectAttemptedRef.current = true;
    void tryResumeActiveExecution();
  }, [isLoadingProject, tryResumeActiveExecution]);

  // Stream-health recovery: while we think we're streaming, watch for the
  // underlying fetch body going silent — either because the browser dropped
  // the streaming response (common in backgrounded tabs after long throttling
  // in Chrome) or because a proxy/network blip killed it without surfacing
  // an error. Two triggers, same recovery path:
  //   (a) `visibilitychange` → tab just came back to the foreground
  //   (b) polling watchdog → tab stayed visible the whole time, but the
  //       stream hasn't produced an event in too long
  // In both cases: abort the stale reader, then ask the server if anything
  // is still running and re-attach via tryResumeActiveExecution.
  useEffect(() => {
    // Server's SSE window is ~50s before it sends `stream.reconnect`.
    // Background tabs can be throttled to 1 event/min by Chrome, so the
    // visibility trigger is more forgiving (~5s) since the tab is now
    // foregrounded — events should be flowing. The polling watchdog uses
    // a larger window to avoid false positives during legitimate quiet
    // periods (a slow tool call, a long thinking block with no deltas).
    const VISIBLE_SILENT_THRESHOLD_MS = 5_000;
    const POLL_SILENT_THRESHOLD_MS = 90_000;
    const POLL_INTERVAL_MS = 15_000;

    const tryRecover = (silentThresholdMs: number) => {
      // Not streaming, or no controller — nothing to recover.
      if (!abortControllerRef.current) return;
      const lastEvent = lastEventReceivedAtRef.current;
      const silentMs = lastEvent === 0 ? Infinity : Date.now() - lastEvent;
      if (silentMs < silentThresholdMs) return;

      // Stream looks dead — abort it and let the for-await catch+finally
      // run (clears `abortControllerRef.current`, refreshes the DB).
      // Then ask the server if anything is still running and re-attach.
      const controller = abortControllerRef.current;
      controller.abort();
      // Wait one macrotask so the for-await's finally has a chance to run
      // and clear `abortControllerRef.current` before we try to resume.
      setTimeout(() => {
        void tryResumeActiveExecution();
      }, 0);
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      tryRecover(VISIBLE_SILENT_THRESHOLD_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);

    const pollId = setInterval(() => {
      tryRecover(POLL_SILENT_THRESHOLD_MS);
    }, POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(pollId);
    };
  }, [tryResumeActiveExecution]);


  // Auto-kick the agent when we land on a freshly created project that has
  // exactly one persisted user message (the opening prompt) and no assistant
  // reply yet. The user message is already in `messages` from `loadProject`,
  // so we pass skipOptimisticUserMessage to avoid adding a duplicate, and
  // tell the backend to skip saving it.
  const autoKickAttemptedRef = useRef(false);
  useEffect(() => {
    if (
      autoKickAttemptedRef.current ||
      isLoadingProject ||
      isLoadingMessages ||
      isStreaming ||
      !project
    ) return;
    if (messages.length !== 1 || messages[0].role !== "user") return;

    autoKickAttemptedRef.current = true;
    const opener = messages[0].content;

    (async () => {
      // If the server already has an active execution (e.g. a refresh during
      // the very first run), the reconnect effect will pick it up — don't
      // double-kick.
      const active = await getActiveExecution(projectId).catch(() => null) as
        | { execution_id: string; project_id: string; is_running: boolean }
        | null;
      if (active && active.is_running) return;

      handleSendMessage(opener, { skipOptimisticUserMessage: true });
    })();
  }, [projectId, isLoadingProject, isLoadingMessages, isStreaming, project, messages, handleSendMessage]);

  // Kick off the canned auto-build directive as a normal chat turn. The
  // confirmation modal lives inside ChatPanel — by the time we get here
  // the user has already opted in.
  const handleAutoBuild = useCallback(async () => {
    if (isStreaming) return;
    await handleSendMessage(AUTO_BUILD_KICKOFF);
  }, [handleSendMessage, isStreaming]);

  const handleDismissForkBanner = useCallback(() => {
    setForkBannerDismissed(true);
    try {
      localStorage.setItem(`forkBannerDismissed:${projectId}`, "1");
    } catch {
      // localStorage unavailable (private browsing); banner stays dismissed for the session
    }
  }, [projectId]);

  // Handle stopping the stream — tell the backend to cancel, then let the
  // SSE loop receive "stream.completed" naturally so the partial response
  // is saved. Only force-abort after a timeout as a safety net.
  const handleStop = useCallback(async () => {
    if (executionId) {
      try {
        await stopAgentStream(executionId);
      } catch (error) {
        console.error("Failed to stop stream:", error);
      }
      // Give the SSE loop up to 3s to receive "stream.completed" from the
      // backend. If it hasn't finished by then, force-abort as a fallback.
      setTimeout(() => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      }, 3000);
    } else if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, [executionId]);

  // Handle refresh — force=true bypasses and rebuilds the server-side cache.
  // User-initiated action, so paying the full re-walk is expected behavior.
  const handleRefresh = useCallback(async () => {
    try {
      const [fileList, deployed] = await Promise.all([
        listProjectFiles(projectId, { force: true, includeHidden: showHidden }),
        getDeployedResources(projectId).catch(() => null),
      ]);
      setFiles(fileList);
      applyDeployedResources(deployed);

      if (selectedFile) {
        const content = await getProjectFile(projectId, selectedFile);
        setFileContent(content);
      }
    } catch (error) {
      console.error("Failed to refresh:", error);
    }
  }, [projectId, selectedFile]);

  // Handle loading architecture content
  const handleLoadArchitecture = useCallback(async () => {
    if (architectureContent) return; // Already loaded
    try {
      const content = await getProjectFile(projectId, "architecture.md");
      setArchitectureContent(content.content);
    } catch (error) {
      console.error("Failed to load architecture:", error);
    }
  }, [projectId, architectureContent]);

  // Handle creating architecture - send message to agent
  const handleCreateArchitecture = useCallback(() => {
    if (isCreatingArchitecture || isStreaming) return;
    setIsCreatingArchitecture(true);
    handleSendMessage("Create an /architecture.md file at the project root level with the architecture diagram - read the demo generator skill architecture reference");
  }, [isCreatingArchitecture, isStreaming, handleSendMessage]);

  // Handle manual connection in architecture diagram — ask LLM to update the schema
  const handleArchitectureConnection = useCallback(
    (from: string, to: string) => {
      if (isStreaming) return;
      handleSendMessage(
        `The user just connected node "${from}" to node "${to}" in the architecture diagram. ` +
        `Update the architecture.md file to add this new edge: { "from": "${from}", "to": "${to}" }. ` +
        `Keep all existing nodes and edges. Only add the new edge to the edges array.`
      );
    },
    [isStreaming, handleSendMessage]
  );

  // Handle Package as DAB button click - sends message to agent
  const handlePackageAsDAB = useCallback(() => {
    if (isPackagingDAB || isStreaming) return;
    setIsPackagingDAB(true);
    handleSendMessage(
      "Package this project as a Databricks Asset Bundle. Follow these steps:\n\n" +
      "1. **Read `.claude/skills/databricks-demo-generator/references/dab/dab.md`** for the authoring rules, then **mirror the layout of `.claude/skills/databricks-demo-generator/references/dab/example_databricks.yml`** — it's the canonical single-file shape (bundle / sync / variables / one `resources:` block / `dev` + `prod` targets).\n" +
      "2. **Scan the project files** and map each one to a resource in `databricks.yml`: pipelines, dashboards, jobs (for SQL/notebooks), apps, UC schemas/volumes. Don't split into multiple yaml files.\n" +
      "3. **For components not declarable in the bundle** (Genie Spaces, Knowledge Assistants, Multi-Agent Supervisors, PDF uploads): copy the matching reference script from `.claude/skills/databricks-demo-generator/references/dab/scripts/` into `src/deploy/` and wire it as a `notebook_task` (or `python_wheel_task`) in the bundle job.\n" +
      "4. **If the project has a Databricks App + Lakebase**: the `app/scripts/` Lakebase scripts already ship — reference them in `dab_instructions.md` (run before/after `bundle deploy`). Do NOT declare `postgres_*` resources in `databricks.yml`.\n" +
      "5. **Validate** with `databricks bundle validate`.\n" +
      "6. **Write a short `dab_instructions.md`** — just the commands to run (setup script if needed → `databricks bundle deploy` → grant script if needed → `bundle run`). Don't restate what's already in `databricks.yml`.\n\n"
    );
  }, [isPackagingDAB, isStreaming, handleSendMessage]);

  // Handle Update DAB button click - sends message to agent to review and update
  const handleUpdateDAB = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Update the existing `databricks.yml` to cover any new or changed project assets:\n\n" +
      "1. **Re-read `.claude/skills/databricks-demo-generator/references/dab/dab.md`** and skim `example_databricks.yml` for the resource shapes.\n" +
      "2. **Diff the project tree against `databricks.yml`** — find any pipelines, dashboards, jobs, apps, or volumes that exist on disk but aren't declared.\n" +
      "3. **Edit `databricks.yml` in place** (one file, one `resources:` block — don't split). For Genie/KA/MAS additions, drop the corresponding `references/dab/scripts/deploy_*.py` into `src/deploy/` and wire a new `notebook_task`.\n" +
      "4. **Validate** with `databricks bundle validate`.\n" +
      "5. **Update `dab_instructions.md`** only if the commands changed."
    );
  }, [isStreaming, handleSendMessage]);

  // Handle download DAB as zip
  const handleDownloadDAB = useCallback(async () => {
    try {
      await downloadProjectAsZip(projectId);
    } catch (error) {
      console.error("Failed to download project:", error);
    }
  }, [projectId]);

  // Handle update architecture - send message to agent
  const handleUpdateArchitecture = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Review and update the architecture.md file based on the current project state and recent discussions. " +
      "Read the demo generator skill architecture reference for proper formatting."
    );
  }, [isStreaming, handleSendMessage]);

  // Handle create specifications - send message to agent
  const handleCreateSpec = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Generate the detailed specification files. Follow the demo generator skill's Phase 6 workflow:\n\n" +
      "1. Read `resources.json` to see which capabilities are selected (buildable vs talking_track)\n" +
      "2. Batch-read ALL capability blocks for the buildable capabilities in one turn\n" +
      "3. Also read the example specification files from the skill's references for format/style\n" +
      "4. Write specification files in dependency order — one stage per turn:\n" +
      "   - **Stage A** (parallel): `META-PROMPT.md`, `01-lakeflow.md`\n" +
      "   - **Stage B** (after reading Stage A): `02-uc-governance.md` (if needed)\n" +
      "   - **Stage C** (after reading Stage B): `03-ai-bi.md`, `04-agent-bricks.md` (parallel within stage)\n" +
      "   - **Stage D** (after reading Stage C): `05-apps-infra.md` (if needed)\n" +
      "5. Only generate files for capabilities in resources.json — skip any not selected\n" +
      "6. Run a coherence check after all files are written"
    );
  }, [isStreaming, handleSendMessage]);

  // Handle update specifications - send message to agent
  const handleUpdateSpec = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Review and update the specification files in the specifications/ folder based on the current project state and recent discussions."
    );
  }, [isStreaming, handleSendMessage]);

  // Handle build resources - send message to agent
  const handleBuildResources = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Build the Databricks resources. Follow the demo generator skill's Part 2 workflow:\n\n" +
      "1. Read `META-PROMPT.md` for build order, catalog/schema, and validation checklist\n" +
      "2. Read `resources.json` to see which capabilities need building and what's already created\n" +
      "3. For EACH buildable capability in order:\n" +
      "   a. Load the relevant skill (e.g. `databricks-synthetic-data-gen`, `databricks-spark-declarative-pipelines`, `databricks-aibi-dashboards`)\n" +
      "   b. Read the matching specification file\n" +
      "   c. Build the resource following the skill's guidance\n" +
      "   d. Validate the result\n" +
      "   e. Update `resources.json` created_resources with the new resource ID\n" +
      "4. After ALL resources are built, run the validation checklist from META-PROMPT.md"
    );
  }, [isStreaming, handleSendMessage]);

  // Handle update resources - send message to agent
  const handleUpdateResources = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Review and update the Databricks resources based on the latest discussions and any specification changes. " +
      "Ensure all code files are consistent with the current architecture and specifications."
    );
  }, [isStreaming, handleSendMessage]);

  // Fetch + parse resources.json whenever it appears in or changes on the
  // file list. Drives the DemoOverviewCard in the Summary tab. `fileContentKey`
  // bumps after any file_changed event so a resources.json rewrite during
  // build flips pending pills to live without a refresh.
  const hasResourcesJson = useMemo(
    () => files.some((f) => f.path === "resources.json"),
    [files],
  );
  useEffect(() => {
    if (!hasResourcesJson) {
      setCapabilities(null);
      return;
    }
    let cancelled = false;
    getProjectFile(projectId, "resources.json")
      .then((file) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(file.content) as {
            capabilities?: { buildable?: string[]; talking_track?: string[] };
          };
          const caps = parsed.capabilities;
          if (caps && (Array.isArray(caps.buildable) || Array.isArray(caps.talking_track))) {
            setCapabilities({
              buildable: caps.buildable ?? [],
              talking_track: caps.talking_track ?? [],
            });
          } else {
            setCapabilities(null);
          }
        } catch {
          setCapabilities(null);
        }
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, hasResourcesJson, fileContentKey]);

  // After streaming completes when creating architecture, load the content
  useEffect(() => {
    if (isCreatingArchitecture && !isStreaming) {
      // Streaming finished, check if architecture was created
      const hasArchitecture = files.some((f) => f.path === "architecture.md");
      if (hasArchitecture) {
        // Load the architecture content
        getProjectFile(projectId, "architecture.md")
          .then((content) => {
            setArchitectureContent(content.content);
          })
          .catch((error) => {
            console.error("Failed to load architecture:", error);
          })
          .finally(() => {
            setIsCreatingArchitecture(false);
          });
      } else {
        // File wasn't created, reset state
        setIsCreatingArchitecture(false);
      }
    }
  }, [isCreatingArchitecture, isStreaming, files, projectId]);

  // Reset DAB packaging state when streaming completes
  useEffect(() => {
    if (isPackagingDAB && !isStreaming) {
      setIsPackagingDAB(false);
    }
  }, [isPackagingDAB, isStreaming]);

  // After each stream completes, surface a one-time rename prompt if the
  // README's H1 has drifted from the project name. The agent can rewrite
  // README.md but has no way to mutate the project row — this closes the gap.
  const prevIsStreamingRef = useRef(isStreaming);
  const promptedTitlesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;
    if (!wasStreaming || isStreaming) return;
    if (!project) return;
    if (!files.some((f) => f.path === "README.md")) return;

    let cancelled = false;
    (async () => {
      try {
        const { content } = await getProjectFile(projectId, "README.md");
        if (cancelled) return;
        const h1 = extractReadmeTitle(content);
        if (!h1 || h1 === project.name) return;
        if (promptedTitlesRef.current.has(h1)) return;
        promptedTitlesRef.current.add(h1);

        toast("README title differs from project name", {
          description: `Rename project to "${h1}"?`,
          duration: 12000,
          action: {
            label: "Rename",
            onClick: async () => {
              try {
                const updated = await updateProject(projectId, { name: h1 });
                setProject(updated);
                toast.success(`Renamed to "${h1}"`);
              } catch (e) {
                console.error("Failed to rename project:", e);
                toast.error("Failed to rename project");
              }
            },
          },
        });
      } catch (e) {
        console.error("Failed to check README title:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [isStreaming, project, files, projectId]);

  // Handle delete project
  const handleDeleteConfirm = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      if (isStreaming) {
        try {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
          if (executionId) {
            await stopAgentStream(executionId);
          }
        } catch {
          // Stream stop failure should not block deletion
        }
      }
      await deleteProject(projectId);
      setIsDeleteDialogOpen(false);
      setIsDeleteComplete(true);
      setTimeout(() => {
        navigate({ to: "/" });
      }, 1200);
    } catch (error) {
      console.error("Failed to delete project:", error);
      setDeleteError(error instanceof Error ? error.message : "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  }, [projectId, navigate, isStreaming, executionId]);

  // Handle clear session (delete all messages and reset agent)
  const handleClearSession = useCallback(async () => {
    setIsClearingSession(true);
    try {
      await clearProjectSession(projectId);
      // Clear local state
      setMessages([]);
      setLastReasoning(null);
    } catch (error) {
      console.error("Failed to clear session:", error);
    } finally {
      setIsClearingSession(false);
    }
  }, [projectId]);

  // Handle project name editing
  const handleStartEditName = useCallback(() => {
    setEditedName(project?.name || "");
    setIsEditingName(true);
  }, [project?.name]);

  const handleSaveName = useCallback(async () => {
    if (!editedName.trim() || isSavingName) return;

    setIsSavingName(true);
    try {
      const updated = await updateProject(projectId, { name: editedName.trim() });
      setProject(updated);
      setIsEditingName(false);
    } catch (error) {
      console.error("Failed to update project name:", error);
    } finally {
      setIsSavingName(false);
    }
  }, [projectId, editedName, isSavingName]);

  const handleCancelEditName = useCallback(() => {
    setIsEditingName(false);
    setEditedName("");
  }, []);

  // Handle project description save (called from the modal). The modal
  // owns the textarea state; we only need the persisted side here.
  const handleSaveDescription = useCallback(
    async (newDescription: string) => {
      const updated = await updateProject(projectId, { description: newDescription });
      setProject(updated);
    },
    [projectId],
  );

  // Show error page if project not found
  if (projectNotFound) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="mb-6">
            <AlertTriangle className="h-16 w-16 text-destructive mx-auto" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Project Not Found</h1>
          <p className="text-muted-foreground mb-6">
            This project may have been deleted or you don't have access to it.
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate({ to: "/" })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
            <Button onClick={() => navigate({ to: "/templates" })}>
              Browse Templates
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while project data is being fetched
  if (isLoadingProject) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (isDeleteComplete) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
            <Check className="h-10 w-10 text-green-500" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold">Project Deleted</h2>
            <p className="text-muted-foreground">
              Redirecting to home...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header — single dense row */}
      <div className="shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 -ml-2 h-8 px-2">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            </Link>

            <div className="h-5 w-px bg-border" />

            {/* Project name */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isEditingName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") handleCancelEditName();
                    }}
                    className="h-8 w-full max-w-64 text-lg font-bold"
                    autoFocus
                    disabled={isSavingName}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleSaveName}
                    disabled={isSavingName || !editedName.trim()}
                  >
                    {isSavingName ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCancelEditName}
                    disabled={isSavingName}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <div className="group/title flex items-center gap-2 min-w-0">
                  <h1 className="font-bold text-xl tracking-tight truncate leading-tight">
                    {project?.name || "Loading..."}
                  </h1>
                  <button
                    onClick={handleStartEditName}
                    className="opacity-0 group-hover/title:opacity-100 hover:bg-muted transition-opacity p-1 rounded shrink-0"
                    title="Edit project name"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {/* Compact status pill — Drafting / Planning / Building 4/5 / Ready.
                      Clicking opens the assistant when there's live activity. */}
                  <HeaderStatusPill
                    buildable={capabilities?.buildable ?? []}
                    deployed={deployedResources?.resources ?? []}
                    hasStarted={
                      files.some((f) => f.path.startsWith("specifications/")) ||
                      (deployedResources?.resources.length ?? 0) > 0
                    }
                    isStreaming={isStreaming}
                    onClick={() => {
                      if (!isChatOpen) handleToggleChat();
                    }}
                  />
                  {linkedTemplate && (
                    <Badge
                      variant={linkedTemplate.status === "APPROVED" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0 shrink-0"
                    >
                      {linkedTemplate.status === "REVIEW_REQUESTED" ? "Pending" : linkedTemplate.status.toLowerCase()}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Build stepper with action dropdown */}
            <BuildStepper
              isStreaming={isStreaming}
              files={files}
              deployedResourceCount={deployedResources?.resources.length ?? 0}
              onCreateArchitecture={handleCreateArchitecture}
              onUpdateArchitecture={handleUpdateArchitecture}
              onCreateSpec={handleCreateSpec}
              onUpdateSpec={handleUpdateSpec}
              onBuildResources={handleBuildResources}
              onUpdateResources={handleUpdateResources}
              onPackageDAB={handlePackageAsDAB}
              onUpdateDAB={handleUpdateDAB}
              onDownloadDAB={handleDownloadDAB}
              onPublishTemplate={() => setIsTemplateDialogOpen(true)}
            />

            <div className="h-5 w-px bg-border" />

            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              {/* Chat lives in a floating action button at the bottom-right
                  of the page (see ChatFab below). Header stays clean. */}

              {/* Admin / power-user actions tucked into an overflow menu.
                  Save-as-template + Delete were previously top-level — they
                  cluttered the header for the typical user flow (just
                  building a demo). */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground/70 hover:text-foreground"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => setIsTemplateDialogOpen(true)}
                    disabled={files.length === 0}
                  >
                    {linkedTemplate ? (
                      <FileEdit className="h-4 w-4 mr-2" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    {linkedTemplate ? "Update template" : "Save as template"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* User menu — keeps the avatar + profile link reachable from
                the project page (this header doesn't use <Navbar>). */}
            <UserMenu />
          </div>

          {/* Metadata row — kept minimal. The Overview hero owns the
              full description; here we only surface the lineage chip when
              this project was forked from a template. */}
          {project?.source_template_name && (
            <div className="flex items-center gap-2 mt-1">
              <span
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 shrink-0"
                title={`Based on template: ${project.source_template_name}`}
              >
                <LayoutTemplate className="h-3 w-3" />
                <span className="truncate max-w-[18rem]">Based on {project.source_template_name}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mobile panel toggle */}
      <div className="md:hidden shrink-0 flex border-b border-border bg-muted/30">
        <button
          onClick={() => setMobilePanel("files")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
            mobilePanel === "files"
              ? "bg-background text-foreground border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
          aria-label="Show files panel"
        >
          <PanelLeft className="h-4 w-4" />
          Files
        </button>
        <button
          onClick={() => setMobilePanel("chat")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
            mobilePanel === "chat"
              ? "bg-background text-foreground border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
          aria-label="Show chat panel"
        >
          <MessageSquare className="h-4 w-4" />
          Chat
        </button>
      </div>

      {/* Fork lineage banner — surfaces the "this is your editable copy" framing
          until the user dismisses it (persisted per-project in localStorage). */}
      {project?.source_template_name && !forkBannerDismissed && (
        <div className="shrink-0 border-b border-border bg-primary/5">
          <div className="flex items-center gap-3 px-5 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
              <GitFork className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <span className="font-medium">Forked from {project.source_template_name}</span>
              <span className="text-muted-foreground">
                {" "}— this is your editable copy. Tell the AI in the chat what to change for your scenario.
              </span>
            </div>
            <Link
              to="/templates"
              className="hidden sm:inline text-xs text-primary hover:underline shrink-0"
              title="Browse the template library"
            >
              View templates
            </Link>
            <button
              onClick={handleDismissForkBanner}
              className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss banner"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        {/* File viewer (left side) */}
        <div className={`flex-1 min-w-0 overflow-hidden ${mobilePanel === "chat" ? "hidden md:flex" : "flex"} flex-col`}>
          <FileViewer
            projectId={projectId}
            projectDescription={project?.description}
            projectNarrative={project?.narrative ?? null}
            isGeneratingNarrative={isGeneratingNarrative}
            onRegenerateNarrative={handleRegenerateNarrative}
            files={files}
            selectedFile={selectedFile}
            fileContent={fileContent}
            readmeContent={readmeContent}
            onSelectFile={setSelectedFile}
            onSkillsClick={() => setIsSkillsOpen(true)}
            onOpenChat={() => {
              if (!isChatOpen) handleToggleChat();
            }}
            onEditDescription={() => setIsDescriptionDialogOpen(true)}
            showHidden={showHidden}
            onToggleShowHidden={() => setShowHidden((v) => !v)}
            onRefresh={handleRefresh}
            isLoading={isLoadingFile}
            architectureContent={architectureContent}
            onLoadArchitecture={handleLoadArchitecture}
            isCreatingArchitecture={isCreatingArchitecture}
            onCreateArchitecture={handleCreateArchitecture}
            onArchitectureConnectionCreated={handleArchitectureConnection}
            isStreaming={isStreaming}
            resources={{
              warehouseName: resources.warehouseName,
              catalog: resources.catalog,
              schema: resources.schema,
            }}
            onResourcesClick={() => setIsResourcesOpen(true)}
            deployedResources={deployedResources?.resources}
            deployedExtractionError={deployedResources?.extraction_error}
            capabilities={capabilities}
            onAutoFixSend={(msg) => handleSendMessage(msg, { isAutoFix: true })}
            autoFixApiRef={autoFixApiRef}
          />
        </div>

        {/* Resize handle — desktop only, and only when chat is open. */}
        {isChatOpen && (
          <div
            onMouseDown={handleResizeStart}
            className="hidden md:block shrink-0 w-1 cursor-col-resize relative group hover:bg-primary/20 active:bg-primary/30 transition-colors"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-border group-hover:bg-primary/40 group-active:bg-primary/60 transition-colors" />
          </div>
        )}

        {/* Chat panel — hidden on desktop unless toggled open.
            Mobile still uses the mobilePanel switch (panel toggle bar). */}
        {(isChatOpen || isMobile) && (
          <div
            className={`h-full transition-[width] duration-300 ease-in-out ${
              mobilePanel === "files"
                ? "hidden md:block md:shrink-0"
                : "w-full md:w-auto md:shrink-0"
            }`}
            style={isMobile && mobilePanel === "chat" ? undefined : { width: chatWidth }}
          >
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              isStreaming={isStreaming}
              isLoadingMessages={isLoadingMessages}
              isClearingSession={isClearingSession}
              streamingContent={streamingContent}
              streamingThinkingBlocks={streamingThinkingBlocks}
              streamingTools={streamingTools}
              pendingUserMessage={pendingUserMessage}
              lastReasoning={lastReasoning}
              onStop={handleStop}
              onClearSession={handleClearSession}
              onAutoBuild={handleAutoBuild}
              canAutoBuild={!isStreaming}
            />
          </div>
        )}
      </div>

      {/* Floating chat FAB — bottom-right, toggles the assistant panel.
          When closed, it's a wide labelled pill so it reads as a
          dedicated action; when open, it shrinks to a circular X. The
          ambient pulse runs whenever the project has no README yet so
          first-time visitors are nudged toward the entry point. */}
      {(() => {
        const hasReadme = files.some((f) => f.path === "README.md");
        const showPulse = !isChatOpen && (!hasReadme || isStreaming);
        const pulseColor = isStreaming
          ? "bg-emerald-400"
          : "bg-primary";
        return (
          <div className="hidden md:block fixed bottom-6 right-6 z-50">
            {/* Ambient pulse ring — sits behind the button. Only visible
                when there's something the user should notice. */}
            {showPulse && (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-0 rounded-full animate-ping opacity-60",
                  pulseColor,
                )}
              />
            )}
            <button
              type="button"
              onClick={handleToggleChat}
              className={cn(
                "relative flex items-center gap-2 shadow-xl shadow-primary/20 transition-all hover:scale-[1.03] active:scale-95",
                isChatOpen
                  ? "h-12 w-12 justify-center rounded-full bg-card border border-border text-foreground hover:bg-muted"
                  : "h-14 pl-4 pr-5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90",
              )}
              title={isChatOpen ? "Hide assistant" : "Open assistant"}
              aria-pressed={isChatOpen}
              aria-label={isChatOpen ? "Hide assistant" : "Open assistant"}
            >
              {isChatOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <>
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
                    <MessageSquare className="h-5 w-5" />
                  </span>
                  <span className="text-[14px] font-semibold tracking-tight pr-1">
                    {isStreaming ? "See live activity" : "Ask the assistant"}
                  </span>
                </>
              )}
              {/* Streaming dot for the closed circular state when open
                  isn't an option (mirrors prior behavior on smaller
                  layouts — kept for parity with the open icon-only state). */}
              {!isChatOpen && isStreaming && (
                <span
                  aria-hidden
                  className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 shadow ring-2 ring-background"
                />
              )}
            </button>
          </div>
        );
      })()}

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => { setIsDeleteDialogOpen(open); if (open) setDeleteError(null); }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <DialogTitle>Delete Project</DialogTitle>
                <DialogDescription className="mt-1">
                  This action cannot be undone.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {project?.name}
              </span>
              ? All files, messages, and project data will be permanently removed.
            </p>
            {linkedTemplate && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                This project is linked to template "{linkedTemplate.name}". The template will not be deleted, but it will no longer be linked to this project.
              </p>
            )}
            {deleteError && (
              <p className="text-sm text-destructive">{deleteError}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="gap-2"
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Project
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Skills Popup */}
      <SkillsPopup
        projectId={projectId}
        isOpen={isSkillsOpen}
        onClose={() => setIsSkillsOpen(false)}
      />

      {/* Resources Popover */}
      <ResourcesPopover
        projectId={projectId}
        isOpen={isResourcesOpen}
        onClose={() => setIsResourcesOpen(false)}
        resources={resources}
        onResourcesChange={setResources}
      />

      {/* Description Edit Dialog */}
      <DescriptionEditDialog
        projectId={projectId}
        isOpen={isDescriptionDialogOpen}
        initialDescription={project?.description || ""}
        onClose={() => setIsDescriptionDialogOpen(false)}
        onSave={handleSaveDescription}
      />

      {/* Template Publish Dialog */}
      <TemplatePublishDialog
        projectId={projectId}
        projectName={project?.name || ""}
        projectDescription={project?.description || null}
        fileCount={files.filter((f) => f.path.toLowerCase().endsWith(".md") && !f.path.startsWith(".claude/")).length}
        linkedTemplate={linkedTemplate}
        isOpen={isTemplateDialogOpen}
        onClose={() => setIsTemplateDialogOpen(false)}
        onSubmitted={(template) => {
          setLinkedTemplate(template);
        }}
      />
    </div>
  );
}
