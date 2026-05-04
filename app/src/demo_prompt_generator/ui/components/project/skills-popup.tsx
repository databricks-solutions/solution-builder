/**
 * Skills popup component - displays available skills in a sheet panel.
 */

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Code,
  Eye,
  Terminal,
  KeyRound,
} from "lucide-react";
import { Prose } from "@/components/markdown-prose";
import {
  getProjectSkills,
  getSkillFiles,
  getSkillFileContent,
  refreshProjectSkills,
  getProjectSystemPrompt,
  getProjectAgentEnv,
  type Skill,
  type SkillFile,
  type AgentEnvSnapshot,
} from "@/lib/custom-api";
import { cn } from "@/lib/utils";

// Lazy load Monaco editor for code files
const CodeViewer = lazy(() => import("./code-viewer").then(m => ({ default: m.CodeViewer })));

interface SkillsPopupProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface FileTreeItemProps {
  item: SkillFile;
  skillName: string;
  depth: number;
  selectedFile: { skill: string; path: string } | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (skillName: string, filePath: string) => void;
}

function FileTreeItem({
  item,
  skillName,
  depth,
  selectedFile,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
}: FileTreeItemProps) {
  const folderKey = `${skillName}:${item.path}`;
  const isExpanded = expandedFolders.has(folderKey);
  const isSelected =
    selectedFile?.skill === skillName && selectedFile?.path === item.path;

  if (item.is_dir) {
    return (
      <div>
        <button
          onClick={() => onToggleFolder(folderKey)}
          className={cn(
            "w-full flex items-center gap-1.5 py-1 px-1 rounded text-left hover:bg-accent/50 transition-colors text-sm cursor-pointer"
          )}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          )}
          <span className="truncate">{item.name}</span>
        </button>
        {isExpanded && item.children && (
          <div>
            {item.children.map((child) => (
              <FileTreeItem
                key={child.path}
                item={child}
                skillName={skillName}
                depth={depth + 1}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(skillName, item.path)}
      className={cn(
        "w-full flex items-center gap-1.5 py-1 px-1 rounded text-left hover:bg-accent/50 transition-colors text-sm cursor-pointer",
        isSelected && "bg-accent"
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <span className="w-3.5" /> {/* Spacer for alignment */}
      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="truncate">{item.name}</span>
    </button>
  );
}

// Special markers for non-skill entries in the left tree.
const SYSTEM_PROMPT_MARKER = "__SYSTEM_PROMPT__";
const AGENT_ENV_MARKER = "__AGENT_ENV__";

export function SkillsPopup({ projectId, isOpen, onClose }: SkillsPopupProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [skillFiles, setSkillFiles] = useState<Record<string, SkillFile[]>>({});
  const [selectedFile, setSelectedFile] = useState<{
    skill: string;
    path: string;
  } | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  // Agent env snapshot — what env we'd hand to the next Claude Agent SDK
  // subprocess. Useful for debugging deployed-mode auth (Claude LLM uses
  // app SP, Databricks CLI uses user PAT — two identities at once). See
  // backend/AUTH.md for the full model.
  const [agentEnv, setAgentEnv] = useState<AgentEnvSnapshot | null>(null);
  const [isLoadingEnv, setIsLoadingEnv] = useState(false);

  // Check what's selected in the left tree.
  const isSystemPromptSelected = selectedFile?.skill === SYSTEM_PROMPT_MARKER;
  const isAgentEnvSelected = selectedFile?.skill === AGENT_ENV_MARKER;

  // Check if current file is markdown (including system prompt which is markdown)
  const isMarkdownFile = useMemo(() => {
    if (!selectedFile) return false;
    // System prompt is always markdown
    if (isSystemPromptSelected) return true;
    return selectedFile.path.endsWith(".md");
  }, [selectedFile, isSystemPromptSelected]);

  // Load skills, system prompt, and agent env when popup opens.
  useEffect(() => {
    if (isOpen && projectId) {
      loadSkills();
      loadSystemPrompt();
      loadAgentEnv();
      // Default to system prompt selected
      setSelectedFile({ skill: SYSTEM_PROMPT_MARKER, path: "SYSTEM_PROMPT" });
    }
  }, [isOpen, projectId]);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getProjectSkills(projectId);
      setSkills(data);
    } catch (error) {
      console.error("Failed to load skills:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const loadSystemPrompt = useCallback(async () => {
    setIsLoadingPrompt(true);
    try {
      const prompt = await getProjectSystemPrompt(projectId);
      setSystemPrompt(prompt);
    } catch (error) {
      console.error("Failed to load system prompt:", error);
      setSystemPrompt("Failed to load system prompt");
    } finally {
      setIsLoadingPrompt(false);
    }
  }, [projectId]);

  const loadAgentEnv = useCallback(async () => {
    setIsLoadingEnv(true);
    try {
      const snap = await getProjectAgentEnv(projectId);
      setAgentEnv(snap);
    } catch (error) {
      console.error("Failed to load agent env:", error);
      setAgentEnv(null);
    } finally {
      setIsLoadingEnv(false);
    }
  }, [projectId]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await refreshProjectSkills(projectId);
      setSkills(result.skills);
      // Reset expansion and selection
      setExpandedSkills(new Set());
      setExpandedFolders(new Set());
      setSkillFiles({});
      setSelectedFile({ skill: SYSTEM_PROMPT_MARKER, path: "SYSTEM_PROMPT" });
      setFileContent("");
      // Reload system prompt too
      loadSystemPrompt();
    } catch (error) {
      console.error("Failed to refresh skills:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, loadSystemPrompt]);

  const toggleSkillExpansion = useCallback(
    async (skillName: string) => {
      const newExpanded = new Set(expandedSkills);

      if (newExpanded.has(skillName)) {
        newExpanded.delete(skillName);
      } else {
        newExpanded.add(skillName);

        // Load files if not already loaded
        if (!skillFiles[skillName]) {
          try {
            const files = await getSkillFiles(projectId, skillName);
            setSkillFiles((prev) => ({ ...prev, [skillName]: files }));
          } catch (error) {
            console.error("Failed to load skill files:", error);
          }
        }
      }

      setExpandedSkills(newExpanded);
    },
    [projectId, expandedSkills, skillFiles]
  );

  const toggleFolderExpansion = useCallback((folderKey: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderKey)) {
        newSet.delete(folderKey);
      } else {
        newSet.add(folderKey);
      }
      return newSet;
    });
  }, []);

  const handleFileSelect = useCallback(
    async (skillName: string, filePath: string) => {
      setSelectedFile({ skill: skillName, path: filePath });

      // If selecting system prompt, no need to fetch
      if (skillName === SYSTEM_PROMPT_MARKER) {
        return;
      }

      setIsLoadingFile(true);

      try {
        const data = await getSkillFileContent(projectId, skillName, filePath);
        setFileContent(data.content);
      } catch (error) {
        console.error("Failed to load file content:", error);
        setFileContent("Failed to load file content");
      } finally {
        setIsLoadingFile(false);
      }
    },
    [projectId]
  );

  const handleSelectSystemPrompt = useCallback(() => {
    setSelectedFile({ skill: SYSTEM_PROMPT_MARKER, path: "SYSTEM_PROMPT" });
  }, []);

  const handleSelectAgentEnv = useCallback(() => {
    setSelectedFile({ skill: AGENT_ENV_MARKER, path: "AGENT_ENV" });
  }, []);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[1100px] sm:max-w-[1100px] flex flex-col"
      >
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Agent Configuration</SheetTitle>
              <SheetDescription>
                System prompt and skills for the Claude Code agent
              </SheetDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5 mr-8"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </SheetHeader>

        <div className="flex flex-1 gap-4 min-h-0 mt-4">
          {/* Tree panel (left) */}
          <div className="w-[300px] flex-shrink-0">
            <ScrollArea className="h-full pr-4">
              {/* System Prompt entry */}
              <button
                onClick={handleSelectSystemPrompt}
                className={cn(
                  "w-full flex items-center gap-2 p-2 rounded-md text-left hover:bg-accent transition-colors cursor-pointer mb-1",
                  isSystemPromptSelected && "bg-accent"
                )}
              >
                <Terminal className="h-4 w-4 flex-shrink-0 text-primary" />
                <span className="text-sm font-medium">SYSTEM_PROMPT</span>
              </button>

              {/* Agent env vars — debug surface for the SDK subprocess
                   identity. Shows which Databricks/Anthropic env actually
                   reaches the Claude SDK process. See AUTH.md. */}
              <button
                onClick={handleSelectAgentEnv}
                className={cn(
                  "w-full flex items-center gap-2 p-2 rounded-md text-left hover:bg-accent transition-colors cursor-pointer mb-2",
                  isAgentEnvSelected && "bg-accent"
                )}
                title="Env vars passed to the Claude Agent SDK subprocess"
              >
                <KeyRound className="h-4 w-4 flex-shrink-0 text-primary" />
                <span className="text-sm font-medium">AGENT_ENV</span>
              </button>

              <Separator className="my-2" />

              {/* Skills list */}
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : skills.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No skills found</p>
                  <p className="text-xs mt-1">
                    Click refresh to copy skills from ai-dev-kit
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {skills.map((skill) => (
                    <div key={skill.dir_name}>
                      {/* Skill header */}
                      <button
                        onClick={() => toggleSkillExpansion(skill.dir_name)}
                        className={cn(
                          "w-full flex items-start gap-2 p-2 rounded-md text-left hover:bg-accent transition-colors cursor-pointer"
                        )}
                      >
                        {expandedSkills.has(skill.dir_name) ? (
                          <ChevronDown className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        )}
                        {expandedSkills.has(skill.dir_name) ? (
                          <FolderOpen className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
                        ) : (
                          <Folder className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {skill.name}
                          </p>
                          {skill.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {skill.description}
                            </p>
                          )}
                        </div>
                      </button>

                      {/* Skill file tree */}
                      {expandedSkills.has(skill.dir_name) &&
                        skillFiles[skill.dir_name] && (
                          <div className="ml-4 border-l border-border">
                            {skillFiles[skill.dir_name].map((item) => (
                              <FileTreeItem
                                key={item.path}
                                item={item}
                                skillName={skill.dir_name}
                                depth={1}
                                selectedFile={selectedFile}
                                expandedFolders={expandedFolders}
                                onToggleFolder={toggleFolderExpansion}
                                onSelectFile={handleFileSelect}
                              />
                            ))}
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <Separator orientation="vertical" />

          {/* Content panel (right) */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Header with file path and toggle */}
            {selectedFile && (
              <div className="mb-3 pb-2 border-b flex items-center justify-between flex-shrink-0">
                <p className="text-sm font-medium truncate">
                  {isSystemPromptSelected
                    ? "SYSTEM_PROMPT"
                    : isAgentEnvSelected
                      ? "AGENT_ENV"
                      : `${selectedFile.skill}/${selectedFile.path}`}
                </p>
                {/* Show toggle for all markdown files including system prompt */}
                {isMarkdownFile && !isAgentEnvSelected && (
                  <div className="flex items-center gap-1 bg-muted rounded-md p-0.5 flex-shrink-0 ml-2">
                    <Button
                      variant={!showRaw ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setShowRaw(false)}
                      className="h-7 px-2 gap-1"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="text-xs">Preview</span>
                    </Button>
                    <Button
                      variant={showRaw ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setShowRaw(true)}
                      className="h-7 px-2 gap-1"
                    >
                      <Code className="h-3.5 w-3.5" />
                      <span className="text-xs">Raw</span>
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Scrollable content area */}
            <ScrollArea className="flex-1">
              {isAgentEnvSelected ? (
                <AgentEnvView snapshot={agentEnv} loading={isLoadingEnv} onRefresh={loadAgentEnv} />
              ) : isSystemPromptSelected ? (
                // System prompt content - supports Preview/Raw toggle
                isLoadingPrompt ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : !showRaw ? (
                  <Prose>{systemPrompt}</Prose>
                ) : (
                  <Suspense fallback={
                    <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg">
                      <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  }>
                    <CodeViewer content={systemPrompt} filename="SYSTEM_PROMPT.md" />
                  </Suspense>
                )
              ) : isLoadingFile ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : selectedFile ? (
                <div>
                  {isMarkdownFile && !showRaw ? (
                    <Prose>{fileContent}</Prose>
                  ) : (
                    <Suspense fallback={
                      <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg">
                        <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                      </div>
                    }>
                      <CodeViewer content={fileContent} filename={selectedFile.path} />
                    </Suspense>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Select a file to view its content</p>
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// AgentEnvView — renders the env-snapshot returned by /api/projects/:id/agent-env
//
// Goal: let an SA debugging "the agent's databricks call 401d but the UI
// works fine" see EXACTLY which identity the SDK subprocess will use.
// In deployed mode there are TWO identities at once (Claude LLM = app
// SP, Databricks CLI = user PAT in <project>/.databrickscfg) and the
// notes line spells that out so people stop assuming.
//
// Token-shaped values are server-side redacted to first4…last4 — never
// echo the full string here.
// ---------------------------------------------------------------------------

interface AgentEnvViewProps {
  snapshot: AgentEnvSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}

function AgentEnvView({ snapshot, loading, onRefresh }: AgentEnvViewProps) {
  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Failed to load agent env snapshot.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-xs font-medium",
            snapshot.mode === "deployed"
              ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
          )}
        >
          mode: {snapshot.mode}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="h-7 px-2 ml-auto"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="text-xs text-muted-foreground leading-relaxed border-l-2 border-muted pl-3">
        {snapshot.notes}
      </div>

      <div className="rounded-md border bg-muted/20 divide-y">
        {snapshot.vars.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground italic">
            (no env vars set — the agent inherits the parent process env)
          </div>
        ) : (
          snapshot.vars.map((v) => (
            <div
              key={v.name}
              className="grid grid-cols-[180px_1fr] gap-3 p-2 text-xs font-mono"
            >
              <div className="font-semibold text-foreground/80">
                {v.name}
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="break-all text-muted-foreground select-text flex-1">
                  {v.value}
                </span>
                {v.redacted && (
                  <span
                    className="shrink-0 px-1 py-0 text-[9px] uppercase rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-sans not-italic"
                    title="Token-shaped value — only first/last 4 chars shown"
                  >
                    redacted
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-[11px] text-muted-foreground italic">
        See <code>backend/AUTH.md</code> for the full identity model.
      </div>
    </div>
  );
}
