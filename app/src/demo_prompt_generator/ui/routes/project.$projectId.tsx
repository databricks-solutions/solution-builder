/**
 * Project page route - displays file viewer on left, chat panel on right.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
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
import { ChatPanel } from "@/components/project/chat-panel";
import { SkillsPopup } from "@/components/project/skills-popup";
import { UserMenu } from "@/components/layout/user-menu";
import { TemplatePublishDialog } from "@/components/project/template-publish-dialog";
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
  PanelLeft,
  LayoutTemplate,
} from "lucide-react";
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
  type Project,
  type ProjectFile,
  type ProjectFileContent,
  type Message,
  type TemplateDetail,
  type DeployedResources,
} from "@/lib/custom-api";
import { AUTO_BUILD_KICKOFF } from "@/lib/auto-build-prompt";
import { resourceKey } from "@/components/project/deployed-resources-bar";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
});

// Tool names that change files on disk — trigger a sidebar refresh on their tool_result.
const FILE_MUTATING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

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
  const [newResourceIds, setNewResourceIds] = useState<Set<string>>(new Set());
  // Tracks resource keys we've already shown. `null` means we haven't seen the
  // first server response yet — used to avoid flashing every pill as "new" on
  // initial mount.
  const prevResourceKeysRef = useRef<Set<string> | null>(null);
  const newResourceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDeployedResources = useCallback((deployed: DeployedResources | null) => {
    setDeployedResources(deployed);
    const currentKeys = new Set((deployed?.resources ?? []).map(resourceKey));
    if (prevResourceKeysRef.current === null) {
      // Seed baseline on first response — no "new" highlighting on cold load.
      prevResourceKeysRef.current = currentKeys;
      return;
    }
    const fresh = new Set<string>();
    for (const k of currentKeys) {
      if (!prevResourceKeysRef.current.has(k)) fresh.add(k);
    }
    prevResourceKeysRef.current = currentKeys;
    if (fresh.size === 0) return;
    setNewResourceIds(fresh);
    if (newResourceTimerRef.current) clearTimeout(newResourceTimerRef.current);
    newResourceTimerRef.current = setTimeout(() => {
      setNewResourceIds(new Set());
      newResourceTimerRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => () => {
    if (newResourceTimerRef.current) clearTimeout(newResourceTimerRef.current);
  }, []);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isClearingSession, setIsClearingSession] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingTools, setStreamingTools] = useState<Map<string, { name: string; input: unknown; result?: string; isError?: boolean }>>(new Map());
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [lastReasoning, setLastReasoning] = useState<{ thinking: string; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean }> } | null>(null);

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

  // Project description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);

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

  // Chat panel resize state
  // Start wider (650px) when no README exists, shrink to default (520px) once README is created
  const DEFAULT_CHAT_WIDTH = 520;
  const INITIAL_CHAT_WIDTH = 650; // Wider for initial ideation phase
  const [chatWidth, setChatWidth] = useState(INITIAL_CHAT_WIDTH);
  const hasReadmeRef = useRef(false);
  const isResizingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const MIN_CHAT_WIDTH = 360;
  const MAX_CHAT_WIDTH = 800;

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

  // Auto-shrink chat panel when README is created (transition from ideation to normal)
  useEffect(() => {
    const hasReadme = files.some((f) => f.path === "README.md");
    if (hasReadme && !hasReadmeRef.current) {
      // README just appeared — shrink chat panel to default width
      hasReadmeRef.current = true;
      setChatWidth(DEFAULT_CHAT_WIDTH);
    } else if (!hasReadme) {
      hasReadmeRef.current = false;
    }
  }, [files]);

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
  const reasoningRef = useRef<{ thinking: string; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }> } | null>(null);

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
      setStreamingThinking("");
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
        let fullThinking = "";
        const toolsMap = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>();

        for await (const event of streamAgentProgress(
          response.execution_id,
          abortControllerRef.current.signal
        )) {
          // Heartbeat for the visibility-recovery handler — any event
          // (incl. ones we don't render) proves the stream is alive.
          lastEventReceivedAtRef.current = Date.now();
          if (event.type === "text_delta") {
            fullContent += event.text;
            setStreamingContent(fullContent);
          } else if (event.type === "text_block_start") {
            // Insert a paragraph break between consecutive text blocks
            // within a turn so they don't render as one wall of text.
            if (fullContent.length > 0 && !fullContent.endsWith("\n\n")) {
              fullContent += "\n\n";
              setStreamingContent(fullContent);
            }
          } else if (event.type === "text") {
            // Ignore final text event - we already have content from deltas
          } else if (event.type === "thinking_delta") {
            fullThinking += event.thinking;
            setStreamingThinking(fullThinking);
            // Update ref for use in finally
            reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
          } else if (event.type === "thinking") {
            // Ignore final thinking event - we already have content from deltas
          } else if (event.type === "tool_use") {
            // Tool started - add with pending state
            toolsMap.set(event.tool_id, {
              name: event.tool_name,
              input: event.tool_input,
              startedAt: event.timestamp,
            });
            setStreamingTools(new Map(toolsMap));
            // Update ref for use in finally
            reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
          } else if (event.type === "tool_result") {
            // Tool completed - update with result
            const existing = toolsMap.get(event.tool_use_id);
            if (existing) {
              toolsMap.set(event.tool_use_id, {
                ...existing,
                result: event.content,
                isError: event.is_error ?? false,
                completedAt: event.timestamp,
              });
              setStreamingTools(new Map(toolsMap));
              // Update ref for use in finally
              reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
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
            console.error("Agent error:", event.error);
          } else if (event.type === "stream.completed") {
            break;
          }
        }

        // Add assistant message locally (user message already added above)
        const assistantMsg: Message = {
          id: Date.now() + 1,
          project_id: projectId,
          role: "assistant",
          content: fullContent,
          is_error: false,
          reasoning_data: reasoningRef.current ? {
            reasoning: [
              ...(reasoningRef.current.thinking ? [{ type: "thinking" as const, content: reasoningRef.current.thinking }] : []),
              ...Array.from(reasoningRef.current.tools.entries()).flatMap(([id, tool]) => [
                { type: "tool" as const, id, name: tool.name, input: tool.input, started_at: tool.startedAt },
                ...(tool.result !== undefined ? [{ type: "tool_result" as const, tool_id: id, content: tool.result, is_error: tool.isError ?? false, completed_at: tool.completedAt }] : []),
              ]),
            ],
          } : null,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);

        // Refresh files and deployed resources (agent may have created new ones)
        const [fileList, deployed] = await Promise.all([
          listProjectFiles(projectId, { includeHidden: showHidden }),
          getDeployedResources(projectId).catch(() => null),
        ]);
        setFiles(fileList);
        applyDeployedResources(deployed);

        // Auto-select README.md if no file is currently selected
        let currentFile = selectedFileRef.current;
        if (!currentFile) {
          const readme = fileList.find((f) => f.path === "README.md");
          if (readme) {
            currentFile = "README.md";
            setSelectedFile("README.md");
          } else if (fileList.length > 0) {
            currentFile = fileList[0].path;
            setSelectedFile(fileList[0].path);
          }
        }

        // Refresh current file content
        if (currentFile) {
          try {
            const content = await getProjectFile(projectId, currentFile);
            setFileContent(content);
          } catch {
            // File may have been deleted
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
        // Save reasoning from ref BEFORE clearing streaming state
        if (reasoningRef.current) {
          setLastReasoning(reasoningRef.current);
        }
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
        setStreamingTools(new Map());
        setPendingUserMessage(null);
        setExecutionId(null);
        abortControllerRef.current = null;
        // Bump key to force loadFileContent effect to re-fire, ensuring
        // the file viewer always reflects what the agent wrote to disk.
        setFileContentKey((k) => k + 1);
      }
    },
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
      let fullThinking = "";
      const toolsMap = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean; startedAt?: string; completedAt?: string }>();

      for await (const event of streamAgentProgress(
        exec.execution_id,
        abortControllerRef.current.signal
      )) {
        // Heartbeat for the visibility-recovery handler.
        lastEventReceivedAtRef.current = Date.now();
        if (event.type === "text_delta") {
          fullContent += event.text;
          setStreamingContent(fullContent);
        } else if (event.type === "text_block_start") {
          if (fullContent.length > 0 && !fullContent.endsWith("\n\n")) {
            fullContent += "\n\n";
            setStreamingContent(fullContent);
          }
        } else if (event.type === "thinking_delta") {
          fullThinking += event.thinking;
          setStreamingThinking(fullThinking);
          reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
        } else if (event.type === "tool_use") {
          toolsMap.set(event.tool_id, { name: event.tool_name, input: event.tool_input, startedAt: event.timestamp });
          setStreamingTools(new Map(toolsMap));
          reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
        } else if (event.type === "tool_result") {
          const existing = toolsMap.get(event.tool_use_id);
          if (existing) {
            toolsMap.set(event.tool_use_id, { ...existing, result: event.content, isError: event.is_error ?? false, completedAt: event.timestamp });
            setStreamingTools(new Map(toolsMap));
            reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
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
          break;
        }
      }

      // Refresh messages, files, and deployed resources from DB after agent completion
      const [msgs, fileList, deployed] = await Promise.all([
        listProjectMessages(projectId),
        listProjectFiles(projectId),
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

      // Refresh selected file content
      if (fileToLoad) {
        try {
          const content = await getProjectFile(projectId, fileToLoad);
          setFileContent(content);
        } catch { /* ignore */ }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Failed to reconnect to agent:", error);
        toast.error((error as Error).message || "Lost connection to agent");
      }
    } finally {
      if (reasoningRef.current) setLastReasoning(reasoningRef.current);
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingThinking("");
      setStreamingTools(new Map());
      setExecutionId(null);
      abortControllerRef.current = null;
      setFileContentKey((k) => k + 1);
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

  // Visibility-recovery: when the tab comes back to the foreground while we
  // think we're streaming, the underlying fetch body may have been silently
  // dropped by the browser (Chrome throttles backgrounded tabs aggressively
  // and can abandon streaming responses after long inactivity). Detect that
  // by checking whether we've received an event in the last few seconds; if
  // not, abort the stale reader and re-attach via tryResumeActiveExecution.
  useEffect(() => {
    const SILENT_THRESHOLD_MS = 5_000;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Not streaming, or no controller — nothing to recover.
      if (!abortControllerRef.current) return;
      const lastEvent = lastEventReceivedAtRef.current;
      const silentMs = lastEvent === 0 ? Infinity : Date.now() - lastEvent;
      if (silentMs < SILENT_THRESHOLD_MS) return;

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
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
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
      "Package this project as a Databricks Asset Bundle (DAB). Follow these steps:\n\n" +
      "1. **Load the `databricks-bundles` skill** for DAB syntax, resource types, and best practices.\n" +
      "2. **Read the dab.md reference** at `.claude/skills/databricks-demo-generator/references/dab/dab.md` and the complete working example at `.claude/skills/databricks-demo-generator/references/dab/example_databricks.yml` — the example shows the exact single-file layout to mirror.\n" +
      "3. **Analyze all project files** to identify components (SQL files, Python scripts, notebooks, dashboards, pipelines, Genie spaces, KAs, etc.).\n" +
      "4. **Create a single `databricks.yml`** at the project root containing everything (bundle, sync, variables, targets, AND all resources in one `resources:` block — do NOT split into multiple files):\n" +
      "   - `bundle.name` derived from the project\n" +
      "   - `sync.include` for code and static-file paths\n" +
      "   - Variables for `catalog`, `schema`, and `warehouse_id`\n" +
      "   - `dev` and `prod` targets\n" +
      "   - All resources (schemas, volumes, pipelines, dashboards, jobs) under one top-level `resources:` key, mirroring example_databricks.yml.\n" +
      "6. **Create deployment scripts** in `src/deploy/` for components not natively supported by DAB (Genie Spaces, Knowledge Assistants, Multi-Agent Supervisors) using the patterns from dab.md.\n" +
      "7. **Validate** with `databricks bundle validate` command.\n" +
      "8. **Create `dab_instructions.md`** with deployment commands, variable descriptions, and a list of resources created.\n\n"
    );
  }, [isPackagingDAB, isStreaming, handleSendMessage]);

  // Handle Update DAB button click - sends message to agent to review and update
  const handleUpdateDAB = useCallback(() => {
    if (isStreaming) return;
    handleSendMessage(
      "Update the existing DAB to include any new or changed project assets:\n\n" +
      "1. **Load the `databricks-bundles` skill** for current DAB syntax and resource types.\n" +
      "2. **Read the dab.md reference** at `.claude/skills/databricks-demo-generator/references/dab/dab.md` and the complete working example at `.claude/skills/databricks-demo-generator/references/dab/example_databricks.yml`\n" +
      "3. **Compare project files against `databricks.yml`** — identify any components not yet included in the bundle. The bundle is a single `databricks.yml` at the project root with all resources under one `resources:` block.\n" +
      "4. **Update `databricks.yml`** in place (add/modify entries under `resources:`) and add any missing deployment scripts in `src/deploy/`.\n" +
      "5. **Validate** with `databricks bundle validate` command.\n" +
      "6. **Update `dab_instructions.md`** to reflect any changes."
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

  // Handle project description editing
  const handleStartEditDescription = useCallback(() => {
    setEditedDescription(project?.description || "");
    setIsEditingDescription(true);
  }, [project?.description]);

  const handleSaveDescription = useCallback(async () => {
    if (isSavingDescription) return;

    setIsSavingDescription(true);
    try {
      const updated = await updateProject(projectId, { description: editedDescription.trim() });
      setProject(updated);
      setIsEditingDescription(false);
    } catch (error) {
      console.error("Failed to update project description:", error);
    } finally {
      setIsSavingDescription(false);
    }
  }, [projectId, editedDescription, isSavingDescription]);

  const handleCancelEditDescription = useCallback(() => {
    setIsEditingDescription(false);
    setEditedDescription("");
  }, []);

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
                <div className="flex items-center gap-1.5 min-w-0">
                  <h1 className="font-bold text-lg tracking-tight truncate">
                    {project?.name || "Loading..."}
                  </h1>
                  <button
                    onClick={handleStartEditName}
                    className="opacity-40 hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded shrink-0"
                    title="Edit project name"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                  {linkedTemplate && (
                    <Badge
                      variant={linkedTemplate.status === "APPROVED" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0 shrink-0"
                    >
                      {linkedTemplate.status === "REVIEW_REQUESTED" ? "Pending" : linkedTemplate.status.toLowerCase()}
                    </Badge>
                  )}
                  {project?.source_template_name && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 shrink-0 gap-1 font-normal text-muted-foreground"
                    >
                      <LayoutTemplate className="h-2.5 w-2.5" />
                      Based on: {project.source_template_name}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Build stepper with action dropdown */}
            <BuildStepper
              isStreaming={isStreaming}
              files={files}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsTemplateDialogOpen(true)}
                disabled={files.length === 0}
                className="h-7 gap-1.5 text-xs"
                title={linkedTemplate ? "Update Template" : "Save as Template"}
              >
                {linkedTemplate ? (
                  <FileEdit className="h-3.5 w-3.5" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{linkedTemplate ? "Update Template" : "Save as Template"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDeleteDialogOpen(true)}
                className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete project"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* User menu — keeps the avatar + profile link reachable from
                the project page (this header doesn't use <Navbar>). */}
            <UserMenu />
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {/* Description */}
            {isEditingDescription ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveDescription();
                    if (e.key === "Escape") handleCancelEditDescription();
                  }}
                  className="h-8 w-full max-w-80 text-sm"
                  placeholder="Enter a description"
                  autoFocus
                  disabled={isSavingDescription}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleSaveDescription}
                  disabled={isSavingDescription}
                >
                  {isSavingDescription ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-green-600" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCancelEditDescription}
                  disabled={isSavingDescription}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ) : project?.description ? (
              <button
                onClick={handleStartEditDescription}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer truncate max-w-md"
                title={project.description}
              >
                {project.description.length > 150 ? `${project.description.slice(0, 150)}...` : project.description}
              </button>
            ) : (
              <button
                onClick={handleStartEditDescription}
                className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer italic"
                title="Add a description"
              >
                Add description...
              </button>
            )}

          </div>
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
            files={files}
            selectedFile={selectedFile}
            fileContent={fileContent}
            onSelectFile={setSelectedFile}
            onSkillsClick={() => setIsSkillsOpen(true)}
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
            deployedAt={deployedResources?.deployed_at}
            newResourceIds={newResourceIds}
            onAutoFixSend={(msg) => handleSendMessage(msg, { isAutoFix: true })}
            autoFixApiRef={autoFixApiRef}
          />
        </div>

        {/* Resize handle (desktop only) */}
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

        {/* Chat panel (right side, full-width on mobile when active) */}
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
            streamingThinking={streamingThinking}
            streamingTools={streamingTools}
            pendingUserMessage={pendingUserMessage}
            lastReasoning={lastReasoning}
            onStop={handleStop}
            onClearSession={handleClearSession}
            onAutoBuild={handleAutoBuild}
            canAutoBuild={!isStreaming}
          />
        </div>
      </div>

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

      {/* Template Publish Dialog */}
      <TemplatePublishDialog
        projectId={projectId}
        projectName={project?.name || ""}
        projectDescription={project?.description || null}
        fileCount={files.length}
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
