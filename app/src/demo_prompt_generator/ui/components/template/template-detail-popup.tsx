/**
 * Template detail popup (sheet).
 *
 * A "glance before you fork" view: a single scrolling page that leads with the
 * solution ARCHITECTURE (rendered read-only from the template's architecture.md
 * using the same ReactFlow editor as the workspace) and the STORY (the README),
 * with the full file tree tucked into a collapsible section for power users.
 */

import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
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
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Download,
  Eye,
  FileText,
  Folder,
  GitFork,
  Info,
  Loader2,
  Network,
  Sparkles,
  UserCircle,
} from "lucide-react";

// The read-only architecture preview reuses the full ReactFlow editor. Lazy so
// the heavy diagram chunk isn't pulled into the gallery's initial bundle.
const PlatformDiagram = lazy(() => import("../project/platform-diagram"));

interface TemplateDetailPopupProps {
  templateId: string | null;
  onClose: () => void;
}

// Which state the architecture preview is in.
type ArchState = "idle" | "loading" | "ready" | "absent";

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

  // Architecture preview (rendered from the template's architecture.md).
  const [archMd, setArchMd] = useState<string | null>(null);
  const [archState, setArchState] = useState<ArchState>("idle");
  // The full file tree is secondary — collapsed by default.
  const [filesOpen, setFilesOpen] = useState(false);

  // Check if current file is markdown
  const isMarkdownFile = selectedFile?.endsWith(".md") ?? false;

  // Load template details and files when opened
  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      setFiles([]);
      setSelectedFile(null);
      setFileContent("");
      setArchMd(null);
      setArchState("idle");
      setFilesOpen(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setArchMd(null);
    setArchState("loading");
    setFilesOpen(false);

    Promise.all([
      getTemplate(templateId),
      listTemplateFiles(templateId),
    ])
      .then(([templateData, filesData]) => {
        setTemplate(templateData);
        setFiles(filesData);
        // Auto-select README.md for the (collapsible) file viewer
        const readme = filesData.find(
          (f) => f.name.toLowerCase() === "readme.md"
        );
        if (readme) {
          setSelectedFile(readme.path);
        } else if (filesData.length > 0) {
          setSelectedFile(filesData[0].path);
        }

        // Fetch architecture.md for the read-only diagram preview (if present).
        const arch = filesData.find(
          (f) => f.name.toLowerCase() === "architecture.md"
        );
        if (arch) {
          getTemplateFileContent(templateId, arch.path)
            .then((data) => {
              setArchMd(data.content);
              setArchState("ready");
            })
            .catch(() => setArchState("absent"));
        } else {
          setArchState("absent");
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
    <Dialog open={!!templateId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(1200px,95vw)] w-[95vw] h-[88vh] p-0 flex flex-col gap-0">
        {/* Glanceable header: customer, creator, short summary — NOT the full
            README (that stays reachable in the Files section below). */}
        <DialogHeader className="px-6 py-4 border-b space-y-3 text-left">
          <DialogTitle className="text-xl pr-8">
            {template?.name || "Loading..."}
          </DialogTitle>
          {template && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-primary/70 shrink-0" />
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-medium">
                    {template.customer || "Not specified"}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <UserCircle className="h-4 w-4 text-primary/70 shrink-0" />
                  <span className="text-muted-foreground">Created by:</span>
                  <span className="font-medium">{template.owner_email}</span>
                </span>
                {template.industry && (
                  <Badge variant="outline">{template.industry}</Badge>
                )}
              </div>
              {template.description && (
                <p className="text-sm text-muted-foreground">
                  {template.description}
                </p>
              )}
              {template.capabilities && template.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {template.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary" className="text-xs">
                      {cap.replace(/-/g, " ")}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </DialogHeader>

        {/* Adaptation explainer strip */}
        <div className="flex items-start gap-2 px-6 py-2.5 border-b bg-muted/30 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
          <span>
            Get a feel for the solution below — its architecture and story. When you fork, you'll get your own
            editable copy of this project; adapt the industry, data model, and capabilities by chatting with the AI.
          </span>
        </div>

        {/* Single scrolling page: Architecture → Story → Files (collapsible) */}
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            {isLoading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive p-6">{error}</p>
            ) : (
              <div className="pb-8">
                {/* Architecture */}
                <section className="px-6 pt-5">
                  <SectionHeading
                    icon={Network}
                    title="Architecture"
                    subtitle="How this solution fits together on Databricks"
                  />
                  <div className="mt-3 rounded-xl border bg-card overflow-hidden">
                    {archState === "ready" && archMd ? (
                      <div className="h-[440px]">
                        <Suspense fallback={<DiagramFallback />}>
                          <PlatformDiagram
                            content={archMd}
                            capabilities={null}
                            projectId={`tpl-${templateId}`}
                            defaultEditMode={false}
                            readOnly
                            hideChrome
                            onSave={() => {}}
                          />
                        </Suspense>
                      </div>
                    ) : archState === "loading" ? (
                      <DiagramFallback />
                    ) : (
                      <div className="flex h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Network className="h-4 w-4" />
                        No architecture diagram included in this template.
                      </div>
                    )}
                  </div>
                </section>

                {/* Files (collapsible, secondary). The full README lives here
                    (README.md) — the header carries only the short summary. */}
                <section className="px-6 pt-8">
                  <button
                    type="button"
                    onClick={() => setFilesOpen((o) => !o)}
                    className="flex items-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground cursor-pointer"
                    aria-expanded={filesOpen}
                  >
                    {filesOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    Included files
                    <span className="text-muted-foreground font-normal">
                      ({files.length})
                    </span>
                  </button>

                  {filesOpen && (
                    <div className="mt-3 flex h-[440px] rounded-xl border overflow-hidden">
                      {/* File tree sidebar */}
                      <div className="w-[260px] border-r flex flex-col min-h-0">
                        <ScrollArea className="flex-1">
                          <div className="p-2">
                            <FileTreeView
                              nodes={fileTree}
                              selectedPath={selectedFile}
                              onSelect={setSelectedFile}
                            />
                          </div>
                        </ScrollArea>
                      </div>

                      {/* File content viewer */}
                      <div className="flex-1 flex flex-col min-w-0">
                        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono text-muted-foreground truncate">
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
                  )}
                </section>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A small labelled section heading (icon + title + subtitle).
function SectionHeading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// Loading placeholder for the (fixed-height) architecture preview.
function DiagramFallback() {
  return (
    <div className="flex h-[440px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
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
