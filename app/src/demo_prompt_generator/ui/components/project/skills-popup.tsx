/**
 * Skills popup component - displays available skills in a sheet panel.
 */

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import {
  getProjectSkills,
  getSkillFiles,
  getSkillFileContent,
  refreshProjectSkills,
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

export function SkillsPopup({ projectId, isOpen, onClose }: SkillsPopupProps) {
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

  // Load skills when popup opens
  useEffect(() => {
    if (isOpen && projectId) {
      loadSkills();
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
        className="w-[800px] sm:max-w-[800px] flex flex-col"
      >
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Project Skills</SheetTitle>
              <SheetDescription>
                Skills available in this project's .claude/skills folder
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

        <Separator className="my-4" />

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
          <div className="flex-1 min-w-0">
            <ScrollArea className="h-full">
              {isLoadingFile ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : selectedFile ? (
                <div>
                  <div className="mb-2 pb-2 border-b">
                    <p className="text-sm font-medium">
                      {selectedFile.skill}/{selectedFile.path}
                    </p>
                  </div>
                  <pre className="text-xs bg-muted/50 p-4 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
                    {fileContent}
                  </pre>
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
