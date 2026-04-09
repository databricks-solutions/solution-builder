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
import { ChatPanel } from "@/components/project/chat-panel";
import { SkillsPopup } from "@/components/project/skills-popup";
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
  CheckCircle,
  Loader2,
  Pencil,
  Check,
  X,
  FileEdit,
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
  deleteProject,
  clearProjectSession,
  submitTemplateFromProject,
  updateProject,
  getTemplateByProject,
  updateTemplateFromProject,
  type Project,
  type ProjectFile,
  type ProjectFileContent,
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

  // Skills popup state
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);

  // Template submission state
  const [isSubmittingTemplate, setIsSubmittingTemplate] = useState(false);
  const [templateSubmitted, setTemplateSubmitted] = useState(false);
  const [linkedTemplate, setLinkedTemplate] = useState<TemplateDetail | null>(null);
  const [isUpdateTemplateDialogOpen, setIsUpdateTemplateDialogOpen] = useState(false);
  const [isUpdatingTemplate, setIsUpdatingTemplate] = useState(false);

  // Project name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

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

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Ref to capture reasoning during streaming (for saving in finally)
  const reasoningRef = useRef<{ thinking: string; tools: Map<string, { name: string; input: unknown; result?: string; isError?: boolean }> } | null>(null);

  // Load project data
  useEffect(() => {
    async function loadProject() {
      setIsLoadingMessages(true);
      try {
        // Load project details (also restores files from DB if needed)
        const proj = await getProject(projectId);
        setProject(proj);

        // Load files
        const fileList = await listProjectFiles(projectId);
        setFiles(fileList);

        // Select README.md by default if it exists
        const readme = fileList.find((f) => f.path === "README.md");
        if (readme) {
          setSelectedFile("README.md");
        } else if (fileList.length > 0) {
          setSelectedFile(fileList[0].path);
        }

        // Load messages
        const msgs = await listProjectMessages(projectId);
        setMessages(msgs);
      } catch (error) {
        console.error("Failed to load project:", error);
        // Check if it's a 404 error
        if (error instanceof Error && error.message.includes("404")) {
          setProjectNotFound(true);
        }
      } finally {
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

        // Refresh current file content
        if (selectedFile) {
          try {
            const content = await getProjectFile(projectId, selectedFile);
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
    [projectId, selectedFile, isStreaming]
  );

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

  // Handle delete project
  const handleDeleteConfirm = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteProject(projectId);
      setIsDeleteDialogOpen(false);
      navigate({ to: "/" });
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
    }
  }, [projectId, navigate]);

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

  // Handle submit as template
  const handleSubmitTemplate = useCallback(async () => {
    if (isSubmittingTemplate || templateSubmitted) return;

    setIsSubmittingTemplate(true);
    try {
      const template = await submitTemplateFromProject(projectId);
      setLinkedTemplate(template as TemplateDetail);
      setTemplateSubmitted(true);
      // Reset after 3 seconds
      setTimeout(() => setTemplateSubmitted(false), 3000);
    } catch (error) {
      console.error("Failed to submit template:", error);
    } finally {
      setIsSubmittingTemplate(false);
    }
  }, [projectId, isSubmittingTemplate, templateSubmitted]);

  // Handle update template
  const handleUpdateTemplate = useCallback(async () => {
    if (isUpdatingTemplate || !linkedTemplate) return;

    setIsUpdatingTemplate(true);
    try {
      const updated = await updateTemplateFromProject(linkedTemplate.id, projectId);
      setLinkedTemplate(updated);
      setIsUpdateTemplateDialogOpen(false);
      setTemplateSubmitted(true);
      // Reset after 3 seconds
      setTimeout(() => setTemplateSubmitted(false), 3000);
    } catch (error) {
      console.error("Failed to update template:", error);
    } finally {
      setIsUpdatingTemplate(false);
    }
  }, [projectId, linkedTemplate, isUpdatingTemplate]);

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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              {isEditingName ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") handleCancelEditName();
                    }}
                    className="h-7 w-48 text-sm"
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
                <div className="flex items-center gap-1.5 group">
                  <h1 className="font-semibold text-sm">
                    {project?.name || "Loading..."}
                  </h1>
                  <button
                    onClick={handleStartEditName}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
                    title="Edit project name"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {linkedTemplate ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsUpdateTemplateDialogOpen(true)}
                disabled={isUpdatingTemplate || templateSubmitted || files.length === 0}
                className={`gap-1.5 ${templateSubmitted ? "text-green-600" : ""}`}
              >
                {isUpdatingTemplate ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : templateSubmitted ? (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Updated
                  </>
                ) : (
                  <>
                    <FileEdit className="h-4 w-4" />
                    Update Template
                    <Badge
                      variant={linkedTemplate.status === "APPROVED" ? "default" : "secondary"}
                      className="ml-1 text-[10px] px-1.5 py-0"
                    >
                      {linkedTemplate.status === "REVIEW_REQUESTED" ? "Pending" : linkedTemplate.status.toLowerCase()}
                    </Badge>
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSubmitTemplate}
                disabled={isSubmittingTemplate || templateSubmitted || files.length === 0}
                className={`gap-1.5 ${templateSubmitted ? "text-green-600" : ""}`}
              >
                {isSubmittingTemplate ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : templateSubmitted ? (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Submitted
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Submit as Template
                  </>
                )}
              </Button>
            )}
            <div className="h-6 w-px bg-border" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
              className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* File viewer (left side) */}
        <div className="flex-1 min-w-0 overflow-hidden">
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
            isStreaming={isStreaming}
          />
        </div>

        {/* Chat panel (right side) */}
        <div className="w-[600px] shrink-0 h-full">
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
            resources={resources}
            onEditResources={() => setIsResourcesOpen(true)}
          />
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
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
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {project?.name}
              </span>
              ? All files, messages, and project data will be permanently removed.
            </p>
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

      {/* Update Template Confirmation Dialog */}
      <Dialog open={isUpdateTemplateDialogOpen} onOpenChange={setIsUpdateTemplateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <FileEdit className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle>Update Template</DialogTitle>
                <DialogDescription className="mt-1">
                  Sync template with project files
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              The template content will be replaced with the current project files.
              {linkedTemplate && (
                <span className="block mt-2">
                  Status will remain{" "}
                  <Badge
                    variant={linkedTemplate.status === "APPROVED" ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {linkedTemplate.status === "REVIEW_REQUESTED" ? "pending" : linkedTemplate.status.toLowerCase()}
                  </Badge>
                </span>
              )}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsUpdateTemplateDialogOpen(false)}
              disabled={isUpdatingTemplate}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateTemplate}
              disabled={isUpdatingTemplate}
              className="gap-2"
            >
              {isUpdatingTemplate ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <FileEdit className="h-4 w-4" />
                  Update Template
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
