/**
 * Template detail popup (sheet) for viewing template contents and creating projects.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "../ui/sheet";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import {
  getTemplate,
  listTemplateFiles,
  getTemplateFileContent,
  createProjectFromTemplate,
  exportTemplate,
  type TemplateDetail,
  type TemplateFile,
} from "../../lib/custom-api";
import { Prose } from "../markdown-prose";
import { Code, Clock, Download, Eye, FileText, Folder, GitFork, Info, Loader2, Sparkles } from "lucide-react";

interface TemplateDetailPopupProps {
  templateId: string | null;
  onClose: () => void;
}

export function TemplateDetailPopup({ templateId, onClose }: TemplateDetailPopupProps) {
  const navigate = useNavigate();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Check if current file is markdown
  const isMarkdownFile = selectedFile?.endsWith(".md") ?? false;

  // Load template details and files when opened
  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      setFiles([]);
      setSelectedFile(null);
      setFileContent("");
      return;
    }

    setIsLoading(true);
    setError(null);

    Promise.all([
      getTemplate(templateId),
      listTemplateFiles(templateId),
    ])
      .then(([templateData, filesData]) => {
        setTemplate(templateData);
        setFiles(filesData);
        // Auto-select README.md if exists
        const readme = filesData.find(
          (f) => f.name.toLowerCase() === "readme.md"
        );
        if (readme) {
          setSelectedFile(readme.path);
        } else if (filesData.length > 0) {
          setSelectedFile(filesData[0].path);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [templateId]);

  // Load file content when selected
  useEffect(() => {
    if (!templateId || !selectedFile) {
      setFileContent("");
      return;
    }

    setIsLoadingFile(true);
    getTemplateFileContent(templateId, selectedFile)
      .then((data) => setFileContent(data.content))
      .catch(() => setFileContent("// Failed to load file content"))
      .finally(() => setIsLoadingFile(false));
  }, [templateId, selectedFile]);

  const handleCustomize = async () => {
    if (!template) return;

    setIsCreating(true);
    try {
      const project = await createProjectFromTemplate(
        template.id,
        template.name,
      );
      onClose();
      navigate({
        to: "/project/$projectId",
        params: { projectId: project.id },
      });
    } catch (e) {
      setError((e as Error).message);
      setIsCreating(false);
    }
    // Note: Don't reset isCreating on success - let it stay true until navigation completes
  };

  const handleExport = async () => {
    if (!template) return;
    setIsExporting(true);
    try {
      await exportTemplate(template.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const isApproved = template?.status === "APPROVED";

  // Build file tree structure
  const fileTree = buildFileTree(files);

  // Full-screen cloning overlay
  if (isCreating) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <Sparkles className="absolute inset-0 m-auto h-8 w-8 text-primary animate-pulse" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold">Forking template…</h2>
            <p className="text-muted-foreground">
              Setting up your editable copy of "{template?.name}".
            </p>
            <p className="text-sm text-muted-foreground/70">
              This may take a moment
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Sheet open={!!templateId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[1600px] max-w-[95vw] sm:max-w-[95vw] p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <SheetTitle className="text-xl">
                {template?.name || "Loading..."}
              </SheetTitle>
              {template && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {template.industry && (
                    <Badge variant="outline">{template.industry}</Badge>
                  )}
                  {template.file_count > 0 && (
                    <span className="text-xs">
                      {template.file_count} files
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {template?.description && (
            <p className="text-sm text-muted-foreground mt-2">
              {template.description}
            </p>
          )}
          {template?.capabilities && template.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {template.capabilities.map((cap) => (
                <Badge key={cap} variant="secondary" className="text-xs">
                  {cap.replace(/-/g, " ")}
                </Badge>
              ))}
            </div>
          )}
        </SheetHeader>

        {/* Adaptation explainer strip */}
        <div className="flex items-start gap-2 px-6 py-2.5 border-b bg-muted/30 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
          <span>
            Preview the files below. When you fork, you'll get your own copy of this project — adapt the industry,
            data model, and capabilities by chatting with the AI.
          </span>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* File tree sidebar */}
          <div className="w-[280px] border-r flex flex-col">
            <div className="px-3 py-2 border-b">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Files
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : error ? (
                  <p className="text-sm text-destructive p-2">{error}</p>
                ) : (
                  <FileTreeView
                    nodes={fileTree}
                    selectedPath={selectedFile}
                    onSelect={setSelectedFile}
                  />
                )}
              </div>
            </ScrollArea>
          </div>

          {/* File content viewer */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">
                  {selectedFile || "Select a file"}
                </span>
                {isLoadingFile && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {isMarkdownFile && (
                <div className="flex items-center gap-1 bg-muted rounded-md p-0.5 flex-shrink-0">
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
            <ScrollArea className="flex-1">
              <div className="p-4">
                {isLoadingFile ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : isMarkdownFile && !showRaw ? (
                  <Prose>{fileContent}</Prose>
                ) : (
                  <pre className="text-sm font-mono whitespace-pre-wrap break-words">
                    {fileContent}
                  </pre>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <SheetFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting || !template}
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export
              </>
            )}
          </Button>
          <div className="flex items-center gap-3 ml-auto sm:ml-0">
            <span className="hidden sm:inline text-xs text-muted-foreground">
              You'll get a private editable copy
            </span>
            <Button
              onClick={handleCustomize}
              disabled={isCreating || !template || !isApproved}
              title={!isApproved && template ? "This template is pending approval and cannot be forked yet" : "Fork this template into a new project"}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Forking…
                </>
              ) : !isApproved && template ? (
                <>
                  <Clock className="mr-2 h-4 w-4" />
                  Template pending approval
                </>
              ) : (
                <>
                  <GitFork className="mr-2 h-4 w-4" />
                  Fork & adapt
                </>
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// File tree types and components
interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNode[];
}

function buildFileTree(files: TemplateFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirs: Record<string, FileTreeNode> = {};

  // Sort files to ensure directories come first
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split("/");
    let currentPath = "";
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isLast) {
        // File
        currentLevel.push({
          name: part,
          path: file.path,
          isDir: false,
          children: [],
        });
      } else {
        // Directory
        if (!dirs[currentPath]) {
          const dirNode: FileTreeNode = {
            name: part,
            path: currentPath,
            isDir: true,
            children: [],
          };
          dirs[currentPath] = dirNode;
          currentLevel.push(dirNode);
        }
        currentLevel = dirs[currentPath].children;
      }
    }
  }

  return root;
}

interface FileTreeViewProps {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}

function FileTreeView({ nodes, selectedPath, onSelect, depth = 0 }: FileTreeViewProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </div>
  );
}

interface FileTreeItemProps {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}

function FileTreeItem({ node, selectedPath, onSelect, depth }: FileTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-left hover:bg-muted/50 cursor-pointer",
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children.length > 0 && (
          <FileTreeView
            nodes={node.children}
            selectedPath={selectedPath}
            onSelect={onSelect}
            depth={depth + 1}
          />
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-left hover:bg-muted/50 cursor-pointer",
        isSelected && "bg-primary/10 text-primary"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default TemplateDetailPopup;
