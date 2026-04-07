/**
 * Skills popup component - displays available skills in a sheet panel.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getProjectSkills,
  getSkillFiles,
  getSkillFileContent,
  refreshProjectSkills,
  getProjectSystemPrompt,
  type Skill,
  type SkillFile,
} from "@/lib/custom-api";
import { cn } from "@/lib/utils";

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
            "w-full flex items-center gap-1.5 py-1 px-1 rounded text-left hover:bg-accent/50 transition-colors text-sm"
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
        "w-full flex items-center gap-1.5 py-1 px-1 rounded text-left hover:bg-accent/50 transition-colors text-sm",
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

type ViewMode = "skills" | "system-prompt";

export function SkillsPopup({ projectId, isOpen, onClose }: SkillsPopupProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("system-prompt");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
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

  // Check if current file is markdown
  const isMarkdownFile = useMemo(() => {
    if (!selectedFile) return false;
    return selectedFile.path.endsWith(".md");
  }, [selectedFile]);

  // Load skills and system prompt when popup opens
  useEffect(() => {
    if (isOpen && projectId) {
      loadSkills();
      loadSystemPrompt();
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

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await refreshProjectSkills(projectId);
      setSkills(result.skills);
      // Reset expansion and selection
      setExpandedSkills(new Set());
      setExpandedFolders(new Set());
      setSkillFiles({});
      setSelectedSkill(null);
      setSelectedFile(null);
      setFileContent("");
    } catch (error) {
      console.error("Failed to refresh skills:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId]);

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
      setSelectedSkill(skillName);
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
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </SheetHeader>

        {/* Tab buttons */}
        <div className="flex gap-2 mt-4 mb-2">
          <Button
            variant={viewMode === "system-prompt" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("system-prompt")}
            className="gap-1.5"
          >
            <Terminal className="h-4 w-4" />
            System Prompt
          </Button>
          <Button
            variant={viewMode === "skills" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("skills")}
            className="gap-1.5"
          >
            <Folder className="h-4 w-4" />
            Skills ({skills.length})
          </Button>
        </div>

        <Separator className="my-2" />

        {/* System Prompt View */}
        {viewMode === "system-prompt" && (
          <div className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              {isLoadingPrompt ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <pre className="text-xs bg-muted/50 p-4 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
                  {systemPrompt}
                </pre>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Skills View */}
        {viewMode === "skills" && (
        <div className="flex flex-1 gap-4 min-h-0">
          {/* Skills list (left panel) */}
          <div className="w-[300px] flex-shrink-0">
            <ScrollArea className="h-full pr-4">
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
                          "w-full flex items-start gap-2 p-2 rounded-md text-left hover:bg-accent transition-colors",
                          selectedSkill === skill.dir_name && "bg-accent"
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

          {/* File content (right panel) */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Header with file path and toggle - always visible */}
            {selectedFile && (
              <div className="mb-3 pb-2 border-b flex items-center justify-between flex-shrink-0">
                <p className="text-sm font-medium truncate">
                  {selectedFile.skill}/{selectedFile.path}
                </p>
                {isMarkdownFile && (
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
              {isLoadingFile ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : selectedFile ? (
                <div>
                  {isMarkdownFile && !showRaw ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-pre:bg-muted prose-pre:text-xs prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                      <Markdown remarkPlugins={[remarkGfm]}>{fileContent}</Markdown>
                    </div>
                  ) : (
                    <pre className="text-xs bg-muted/50 p-4 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
                      {fileContent}
                    </pre>
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
        )}
      </SheetContent>
    </Sheet>
  );
}
