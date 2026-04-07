/**
 * Project page route - displays file viewer on left, chat panel on right.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
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
  Sparkles,
} from "lucide-react";
import {
  getProject,
  listProjectFiles,
  getProjectFile,
  listProjectMessages,
  invokeAgent,
  streamAgentProgress,
  stopAgentStream,
  deleteProject,
  type Project,
  type ProjectFile,
  type ProjectFileContent,
  type Message,
} from "@/lib/custom-api";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();

  // Project state
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<ProjectFileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
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
            <div>
              <h1 className="font-semibold text-sm">
                {project?.name || "Loading..."}
              </h1>
              {project?.description && (
                <p className="text-xs text-muted-foreground truncate max-w-md">
                  {project.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSkillsOpen(true)}
              className="gap-1.5"
            >
              <Sparkles className="h-4 w-4" />
              Skills
            </Button>
            <div className="h-6 w-px bg-border" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
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
            isLoading={isLoadingFile}
            projectName={project?.name}
          />
        </div>

        {/* Chat panel (right side) */}
        <div className="w-[600px] shrink-0 h-full">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
            isLoadingMessages={isLoadingMessages}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
            streamingTools={streamingTools}
            pendingUserMessage={pendingUserMessage}
            lastReasoning={lastReasoning}
            onStop={handleStop}
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
    </div>
  );
}
