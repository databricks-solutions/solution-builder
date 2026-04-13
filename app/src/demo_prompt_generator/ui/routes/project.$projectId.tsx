/**
 * Project page route - displays file viewer on left, chat panel on right.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
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
import { BuildStepper } from "@/components/project/build-stepper";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatPanel } from "@/components/project/chat-panel";
import { SkillsPopup } from "@/components/project/skills-popup";
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
  Server,
  Database,
  Boxes,
  MessageSquare,
  PanelLeft,
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
  type Project,
  type ProjectFile,
  type ProjectFileContent,
  type ProjectStage,
  type Message,
  type TemplateDetail,
} from "@/lib/custom-api";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  }),
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { prompt: initialPrompt } = Route.useSearch();
  const navigate = useNavigate();

  // Track if initial prompt has been sent
  const initialPromptSentRef = useRef(false);

  // Project state
  const [project, setProject] = useState<Project | null>(null);
  const [projectNotFound, setProjectNotFound] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<ProjectFileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [architectureContent, setArchitectureContent] = useState<string | null>(null);
  const [isCreatingArchitecture, setIsCreatingArchitecture] = useState(false);
  const [dabInstructions, setDabInstructions] = useState<string | null>(null);
  const [isPackagingDAB, setIsPackagingDAB] = useState(false);
  const [dabValidationError, setDabValidationError] = useState<string | null>(null);

  // Stage pipeline state
  const [projectStage, setProjectStage] = useState<ProjectStage>("DRAFTING");
  const [stageRefreshTrigger, setStageRefreshTrigger] = useState(0);

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

  // Template state
  const [linkedTemplate, setLinkedTemplate] = useState<TemplateDetail | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);

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
  const [chatWidth, setChatWidth] = useState(520);
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
  useEffect(() => {
    if (project?.stage) {
      setProjectStage(project.stage);
    }
  }, [project?.stage]);

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

  // Ref to track selectedFile without causing handleSendMessage to recreate
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Ref to capture reasoning during streaming (for saving in finally)
  const reasoningRef = useRef<{ thinking: string; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean }> } | null>(null);

  // Loading state for the entire page
  const [isLoadingProject, setIsLoadingProject] = useState(true);

  // Load project data - all calls in parallel
  useEffect(() => {
    async function loadProject() {
      setIsLoadingProject(true);
      setIsLoadingMessages(true);
      try {
        // Load all data in parallel
        const [proj, fileList, msgs] = await Promise.all([
          getProject(projectId),
          listProjectFiles(projectId),
          listProjectMessages(projectId),
        ]);

        setProject(proj);
        setFiles(fileList);
        setMessages(msgs);

        // Select README.md by default if it exists
        const readme = fileList.find((f) => f.path === "README.md");
        if (readme) {
          setSelectedFile("README.md");
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

  // Load file content when selected file changes
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
  }, [projectId, selectedFile]);

  // Handle sending a message to the agent
  const handleSendMessage = useCallback(
    async (message: string) => {
      if (isStreaming) return;

      // Show user message immediately
      setPendingUserMessage(message);
      setLastReasoning(null);
      reasoningRef.current = null;
      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setStreamingTools(new Map());

      try {
        // Start agent
        const response = await invokeAgent(projectId, message);
        setExecutionId(response.execution_id);

        // Create abort controller
        abortControllerRef.current = new AbortController();

        // Stream progress
        let fullContent = "";
        let fullThinking = "";
        const toolsMap = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean }>();

        for await (const event of streamAgentProgress(
          response.execution_id,
          abortControllerRef.current.signal
        )) {
          if (event.type === "text_delta") {
            fullContent += event.text;
            setStreamingContent(fullContent);
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
              });
              setStreamingTools(new Map(toolsMap));
              // Update ref for use in finally
              reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
            }
          } else if (event.type === "error") {
            console.error("Agent error:", event.error);
          } else if (event.type === "stream.completed") {
            break;
          }
        }

        // Add new messages locally (no re-fetch to avoid flash)
        // The backend saves these, we just add them to local state
        const now = new Date().toISOString();
        const userMsg: Message = {
          id: Date.now(), // Temporary ID, will be replaced on reload
          project_id: projectId,
          role: "user",
          content: message,
          is_error: false,
          created_at: now,
        };
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
                { type: "tool" as const, id, name: tool.name, input: tool.input },
                ...(tool.result !== undefined ? [{ type: "tool_result" as const, tool_id: id, content: tool.result, is_error: tool.isError ?? false }] : []),
              ]),
            ],
          } : null,
          created_at: now,
        };
        setMessages(prev => [...prev, userMsg, assistantMsg]);

        // Refresh files (agent may have created new files)
        const fileList = await listProjectFiles(projectId);
        setFiles(fileList);
        setStageRefreshTrigger((n) => n + 1);

        // Refresh current file content
        const currentFile = selectedFileRef.current;
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
        }
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
      }
    },
    [projectId, isStreaming]
  );

  // Reconnect to an in-flight agent execution on mount (e.g. after page
  // refresh or navigating back). The agent task runs server-side regardless
  // of client connection, so we just need to resume the SSE consumer.
  const reconnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (
      reconnectAttemptedRef.current ||
      isLoadingProject ||
      isStreaming ||
      initialPrompt // Let the initial-prompt effect handle this case
    ) return;
    reconnectAttemptedRef.current = true;

    (async () => {
      try {
        const execution = await getActiveExecution(projectId) as { execution_id: string; project_id: string; is_running: boolean } | null;
        if (!execution || !execution.is_running) return;

        // There's an active execution — resume streaming
        setIsStreaming(true);
        setExecutionId(execution.execution_id);
        abortControllerRef.current = new AbortController();

        let fullContent = "";
        let fullThinking = "";
        const toolsMap = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean }>();

        for await (const event of streamAgentProgress(
          execution.execution_id,
          abortControllerRef.current.signal
        )) {
          if (event.type === "text_delta") {
            fullContent += event.text;
            setStreamingContent(fullContent);
          } else if (event.type === "thinking_delta") {
            fullThinking += event.thinking;
            setStreamingThinking(fullThinking);
            reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
          } else if (event.type === "tool_use") {
            toolsMap.set(event.tool_id, { name: event.tool_name, input: event.tool_input });
            setStreamingTools(new Map(toolsMap));
            reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
          } else if (event.type === "tool_result") {
            const existing = toolsMap.get(event.tool_use_id);
            if (existing) {
              toolsMap.set(event.tool_use_id, { ...existing, result: event.content, isError: event.is_error ?? false });
              setStreamingTools(new Map(toolsMap));
              reasoningRef.current = { thinking: fullThinking, tools: new Map(toolsMap) };
            }
          } else if (event.type === "stream.completed") {
            break;
          }
        }

        // Refresh messages and files from DB after agent completion
        const [msgs, fileList] = await Promise.all([
          listProjectMessages(projectId),
          listProjectFiles(projectId),
        ]);
        setMessages(msgs);
        setFiles(fileList);
        setStageRefreshTrigger((n) => n + 1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Failed to reconnect to agent:", error);
        }
      } finally {
        if (reasoningRef.current) setLastReasoning(reasoningRef.current);
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
        setStreamingTools(new Map());
        setExecutionId(null);
        abortControllerRef.current = null;
      }
    })();
  }, [projectId, isLoadingProject, isStreaming, initialPrompt]);


  // Auto-send initial prompt if provided (from project creation)
  useEffect(() => {
    if (
      initialPrompt &&
      !initialPromptSentRef.current &&
      !isLoadingMessages &&
      messages.length === 0 &&
      project
    ) {
      initialPromptSentRef.current = true;
      // Clear the prompt from URL to prevent re-sending on refresh
      navigate({
        to: "/project/$projectId",
        params: { projectId },
        search: { prompt: undefined },
        replace: true,
      });
      // Send the message
      handleSendMessage(initialPrompt);
    }
  }, [initialPrompt, isLoadingMessages, messages.length, project, projectId, navigate, handleSendMessage]);

  // Handle stopping the stream
  const handleStop = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (executionId) {
      try {
        await stopAgentStream(executionId);
      } catch (error) {
        console.error("Failed to stop stream:", error);
      }
    }
  }, [executionId]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    try {
      const fileList = await listProjectFiles(projectId);
      setFiles(fileList);

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
    setDabValidationError(null);
    handleSendMessage(
      "Package this project as a Databricks Asset Bundle (DAB). Follow these steps:\n\n" +
      "1. **Load the `databricks-bundles` skill** for DAB syntax, resource types, and best practices.\n" +
      "2. **Read the dab.md reference** at `.claude/skills/databricks-demo-generator/references/dab.md` for the demo-specific DAB workflow.\n" +
      "3. **Analyze all project files** to identify components (SQL files, Python scripts, notebooks, dashboards, pipelines, Genie spaces, KAs, etc.).\n" +
      "4. **Restructure into DAB layout** with proper `resources/*.yml` files and `src/` directory structure as described in the skill.\n" +
      "5. **Create `databricks.yml`** at the project root with:\n" +
      "   - `bundle.name` derived from the project\n" +
      "   - `include: [resources/*.yml]`\n" +
      "   - Variables for `catalog`, `schema`, and `warehouse_id` (using lookup)\n" +
      "   - `dev` and `prod` targets\n" +
      "6. **Create resource YAML files** in `resources/` (jobs.yml, pipelines.yml, dashboards.yml, etc.) mapping each project component to the correct DAB resource type.\n" +
      "7. **Create deployment scripts** in `src/deploy/` for components not natively supported by DAB (Genie Spaces, Knowledge Assistants, Multi-Agent Supervisors) using the patterns from dab.md.\n" +
      "8. **Validate the bundle** by reading back the `databricks.yml` and all `resources/*.yml` files to confirm they have valid YAML syntax and correct path references (`../src/` from resources/).\n" +
      "9. **Create `dab_instructions.md`** with deployment commands, variable descriptions, and a list of resources created.\n\n" +
      "Do NOT skip the validation step — confirm the DAB is structurally correct before finishing."
    );
  }, [isPackagingDAB, isStreaming, handleSendMessage]);

  // Handle Update DAB button click - sends message to agent to review and update
  const handleUpdateDAB = useCallback(() => {
    if (isStreaming) return;
    setDabValidationError(null);
    handleSendMessage(
      "Update the existing DAB to include any new or changed project assets:\n\n" +
      "1. **Load the `databricks-bundles` skill** for current DAB syntax and resource types.\n" +
      "2. **Read the dab.md reference** at `.claude/skills/databricks-demo-generator/references/dab.md`.\n" +
      "3. **Compare project files against `databricks.yml` and `resources/*.yml`** — identify any components not yet included in the bundle.\n" +
      "4. **Update resource YAML files** and add any missing deployment scripts.\n" +
      "5. **Validate** by reading back all YAML files to confirm valid syntax and correct path references.\n" +
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

  // After DAB packaging streaming completes, validate the output
  useEffect(() => {
    if (isPackagingDAB && !isStreaming) {
      const hasDAB = files.some((f) => f.path === "databricks.yml");
      if (hasDAB) {
        // Validate the DAB by reading and checking databricks.yml
        getProjectFile(projectId, "databricks.yml")
          .then((content) => {
            const yml = content.content;
            // Basic structural validation
            const hasBundle = /^bundle:/m.test(yml);
            const hasVariables = /^variables:/m.test(yml);
            const hasTargets = /^targets:/m.test(yml);
            if (!hasBundle) {
              setDabValidationError("databricks.yml is missing the 'bundle:' section");
            } else if (!hasVariables) {
              setDabValidationError("databricks.yml is missing the 'variables:' section");
            } else if (!hasTargets) {
              setDabValidationError("databricks.yml is missing the 'targets:' section");
            } else {
              setDabValidationError(null);
            }
          })
          .catch((error) => {
            console.error("Failed to validate DAB:", error);
            setDabValidationError("Could not read databricks.yml for validation");
          })
          .finally(() => {
            setIsPackagingDAB(false);
          });
      } else {
        setDabValidationError("Agent did not create databricks.yml");
        setIsPackagingDAB(false);
      }
    }
  }, [isPackagingDAB, isStreaming, files, projectId]);

  // Load dab_instructions.md when it exists in files
  useEffect(() => {
    const hasDabInstructions = files.some((f) => f.path === "dab_instructions.md");
    if (hasDabInstructions) {
      getProjectFile(projectId, "dab_instructions.md")
        .then((content) => {
          setDabInstructions(content.content);
        })
        .catch((error) => {
          console.error("Failed to load DAB instructions:", error);
          setDabInstructions(null);
        });
    } else {
      setDabInstructions(null);
    }
  }, [files, projectId]);


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
      {/* Header */}
      <div className="shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-5 py-4 border-b border-border">
          {/* Top line: back + actions */}
          <div className="flex items-center justify-between mb-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="outline"
                size="default"
                onClick={() => setIsTemplateDialogOpen(true)}
                disabled={files.length === 0}
                className="gap-2"
                title={linkedTemplate ? "Update Template" : "Save as Template"}
              >
                {linkedTemplate ? (
                  <>
                    <FileEdit className="h-4 w-4" />
                    <span className="hidden sm:inline">Update Template</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span className="hidden sm:inline">Save as Template</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="default"
                onClick={() => setIsDeleteDialogOpen(true)}
                className="gap-2 text-destructive border-destructive/30 hover:text-destructive hover:bg-destructive/10"
                title="Delete project"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          </div>

          {/* Project name — large and prominent */}
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") handleCancelEditName();
                  }}
                  className="h-10 w-full max-w-96 text-2xl font-bold"
                  autoFocus
                  disabled={isSavingName}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleSaveName}
                  disabled={isSavingName || !editedName.trim()}
                >
                  {isSavingName ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-green-600" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleCancelEditName}
                  disabled={isSavingName}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-2xl tracking-tight">
                  {project?.name || "Loading..."}
                </h1>
                <button
                  onClick={handleStartEditName}
                  className="opacity-50 hover:opacity-100 transition-opacity p-1.5 hover:bg-muted rounded"
                  title="Edit project name"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </button>
                {linkedTemplate && (
                  <Badge
                    variant={linkedTemplate.status === "APPROVED" ? "default" : "secondary"}
                    className="text-xs px-2 py-0.5 ml-1"
                  >
                    Template: {linkedTemplate.status === "REVIEW_REQUESTED" ? "Pending" : linkedTemplate.status.toLowerCase()}
                  </Badge>
                )}
              </div>
            )}
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
                className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Click to edit description"
              >
                {project.description}
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

            {(project?.description || isEditingDescription) && <div className="h-4 w-px bg-border" />}

            {/* Resource pills */}
            {resources.clusterName && (
              <button
                onClick={() => setIsResourcesOpen(true)}
                className="flex items-center gap-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md px-2.5 py-1 transition-colors cursor-pointer"
                title={`Cluster: ${resources.clusterName}`}
              >
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate max-w-[150px]">{resources.clusterName}</span>
              </button>
            )}
            {resources.warehouseName && (
              <button
                onClick={() => setIsResourcesOpen(true)}
                className="flex items-center gap-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md px-2.5 py-1 transition-colors cursor-pointer"
                title={`Warehouse: ${resources.warehouseName}`}
              >
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate max-w-[150px]">{resources.warehouseName}</span>
              </button>
            )}
            {(resources.catalog || resources.schema) && (
              <button
                onClick={() => setIsResourcesOpen(true)}
                className="flex items-center gap-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md px-2.5 py-1 transition-colors cursor-pointer"
                title={`${resources.catalog || "default"}.${resources.schema || "default"}`}
              >
                <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate max-w-[180px]">
                  {resources.catalog || "default"}.{resources.schema || "default"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Build pipeline stepper */}
      <BuildStepper
        projectId={projectId}
        currentStage={projectStage}
        isStreaming={isStreaming}
        onStageChange={(newStage) => {
          setProjectStage(newStage);
          // Re-fetch project to get updated stage from backend
          getProject(projectId).then(setProject).catch(() => {});
        }}
        onSendMessage={handleSendMessage}
        onDownloadDAB={handleDownloadDAB}
        onPublishTemplate={() => setIsTemplateDialogOpen(true)}
        refreshTrigger={stageRefreshTrigger}
      />

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

      {/* Main content */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        {/* File viewer (left side) */}
        <div className={`flex-1 min-w-0 overflow-hidden ${mobilePanel === "chat" ? "hidden md:flex" : "flex"} flex-col`}>
          <FileViewer
            files={files}
            selectedFile={selectedFile}
            fileContent={fileContent}
            onSelectFile={setSelectedFile}
            onSkillsClick={() => setIsSkillsOpen(true)}
            onRefresh={handleRefresh}
            isLoading={isLoadingFile}
            architectureContent={architectureContent}
            onLoadArchitecture={handleLoadArchitecture}
            isCreatingArchitecture={isCreatingArchitecture}
            onCreateArchitecture={handleCreateArchitecture}
            onArchitectureConnectionCreated={handleArchitectureConnection}
            isStreaming={isStreaming}
            onPackageAsDAB={handlePackageAsDAB}
            onUpdateDAB={handleUpdateDAB}
            dabInstructions={dabInstructions}
            onDownloadDAB={handleDownloadDAB}
            isPackagingDAB={isPackagingDAB}
            dabValidationError={dabValidationError}
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
          className={`h-full ${
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
