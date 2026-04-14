/**
 * File viewer component with collapsible sidebar.
 * Supports README and Architecture tabs when architecture.md exists.
 */

import React, { memo, useState, useMemo, useEffect, lazy, Suspense } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Prose } from "../markdown-prose";
import { Skeleton } from "../ui/skeleton";
import { ChevronRight, ChevronDown, ChevronLeft, Folder, FolderOpen, FileText, FileCode, Braces, Settings, File, Sparkles, RefreshCw, Network, Database, Eye, Code, Server, Boxes } from "lucide-react";
import { Button } from "../ui/button";
import type { ProjectFile, ProjectFileContent } from "../../lib/custom-api";

// Lazy load the architecture diagram to avoid loading ReactFlow on every page
const ArchitectureDiagram = lazy(() => import("./architecture-diagram"));

// Lazy load Monaco editor for code files
const CodeViewer = lazy(() => import("./code-viewer").then(m => ({ default: m.CodeViewer })));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewTab = "readme" | "architecture" | "files";

interface ResourcesInfo {
  warehouseName?: string | null;
  catalog?: string | null;
  schema?: string | null;
}

interface FileViewerProps {
  files: ProjectFile[];
  selectedFile: string | null;
  fileContent: ProjectFileContent | null;
  onSelectFile: (path: string) => void;
  onSkillsClick?: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  architectureContent?: string | null;
  onLoadArchitecture?: () => void;
  isCreatingArchitecture?: boolean;
  onCreateArchitecture?: () => void;
  onArchitectureConnectionCreated?: (from: string, to: string) => void;
  isStreaming?: boolean; // Whether the agent is currently working
  resources?: ResourcesInfo;
  onResourcesClick?: () => void;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  file?: ProjectFile;
  children: Map<string, TreeNode>;
}

// ---------------------------------------------------------------------------
// Tree Building
// ---------------------------------------------------------------------------

function buildFileTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    isFolder: true,
    children: new Map(),
  };

  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join("/");

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          file: isLast ? file : undefined,
          children: new Map(),
        });
      }

      current = current.children.get(part)!;
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// File Tree Item (File)
// ---------------------------------------------------------------------------

interface FileItemProps {
  file: ProjectFile;
  isSelected: boolean;
  onClick: () => void;
  depth: number;
}

const FileItem = memo(function FileItem({
  file,
  isSelected,
  onClick,
  depth,
}: FileItemProps) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const icon = getFileIcon(extension);

  // Extra padding to align with folder icon (accounts for missing chevron: 14px icon + 6px gap)
  const chevronOffset = depth > 0 ? 20 : 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-1.5 py-1 text-sm text-left rounded transition-colors cursor-pointer ${
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-muted/80 text-foreground/80"
      }`}
      style={{ paddingLeft: `${depth * 10 + 6 + chevronOffset}px` }}
      title={file.path}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{file.name}</span>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Folder Item
// ---------------------------------------------------------------------------

interface FolderItemProps {
  name: string;
  node: TreeNode;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
  defaultExpanded?: boolean;
}

const FolderItem = memo(function FolderItem({
  name,
  node,
  selectedFile,
  onSelectFile,
  depth,
  defaultExpanded = true,
}: FolderItemProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const hasSelectedChild = useMemo(() => {
    if (!selectedFile) return false;
    return selectedFile.startsWith(node.path + "/");
  }, [selectedFile, node.path]);

  const childNodes = Array.from(node.children.values());
  const folders = childNodes.filter(n => n.isFolder);
  const files = childNodes.filter(n => !n.isFolder);

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-1.5 px-1.5 py-1 text-sm text-left rounded transition-colors cursor-pointer hover:bg-muted/80 text-foreground/90"
        style={{ paddingLeft: `${depth * 10 + 6}px` }}
      >
        <span className="shrink-0 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="shrink-0 text-amber-500/80">
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5" />
          ) : (
            <Folder className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="truncate flex-1 font-medium">{name}</span>
        <span className="text-xs text-muted-foreground/60 shrink-0">
          {childNodes.length}
        </span>
      </button>

      {(isExpanded || hasSelectedChild) && (
        <div>
          {folders.map((child) => (
            <FolderItem
              key={child.path}
              name={child.name}
              node={child}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
          {files.map((child) => (
            <FileItem
              key={child.path}
              file={child.file!}
              isSelected={selectedFile === child.path}
              onClick={() => onSelectFile(child.path)}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// File Tree
// ---------------------------------------------------------------------------

interface FileTreeProps {
  files: ProjectFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

const FileTree = memo(function FileTree({
  files,
  selectedFile,
  onSelectFile,
}: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  const childNodes = Array.from(tree.children.values());
  const folders = childNodes.filter(n => n.isFolder);
  const rootFiles = childNodes.filter(n => !n.isFolder);

  return (
    <div className="space-y-0.5">
      {rootFiles.map((node) => (
        <FileItem
          key={node.path}
          file={node.file!}
          isSelected={selectedFile === node.path}
          onClick={() => onSelectFile(node.path)}
          depth={0}
        />
      ))}
      {folders.map((node) => (
        <FolderItem
          key={node.path}
          name={node.name}
          node={node}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          depth={0}
        />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Collapsed Sidebar
// ---------------------------------------------------------------------------

interface CollapsedSidebarProps {
  fileCount: number;
  onExpand: () => void;
  onSkillsClick?: () => void;
  onRefresh?: () => void;
  activeTab: ViewTab;
}

const CollapsedSidebar = memo(function CollapsedSidebar({
  fileCount,
  onExpand,
  onSkillsClick,
  onRefresh,
  activeTab,
}: CollapsedSidebarProps) {
  // Get label based on active tab
  const tabLabel = activeTab === "readme" ? "Summary" : activeTab === "architecture" ? "Architecture" : "Files";

  return (
    <div className="w-12 h-full shrink-0 border-r border-border bg-muted/30 flex flex-col items-center pt-2 pb-2">
      {/* Expand area */}
      <div
        className="flex flex-col items-center cursor-pointer hover:bg-muted/50 transition-colors rounded px-1 py-1"
        onClick={onExpand}
      >
        {/* Vertical tab name text */}
        <div
          className="text-xs font-medium text-muted-foreground tracking-wider"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {tabLabel}
        </div>

        {/* File count */}
        <div className="flex flex-col items-center gap-0.5 mt-3">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">
            {fileCount}
          </span>
        </div>

        {/* Expand arrow */}
        <div className="mt-1">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom buttons */}
      <div className="flex flex-col items-center gap-1.5">
        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Refresh files"
          >
            <RefreshCw className="h-4 w-4 text-foreground/70" />
            <span className="text-xs text-foreground/70 font-medium">Refresh</span>
          </button>
        )}

        {/* Skills button */}
        {onSkillsClick && (
          <button
            onClick={onSkillsClick}
            className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Skills"
          >
            <Sparkles className="h-4 w-4 text-foreground/70" />
            <span className="text-xs text-foreground/70 font-medium">Skills</span>
          </button>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Expanded Sidebar
// ---------------------------------------------------------------------------

interface ExpandedSidebarProps {
  files: ProjectFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onCollapse: () => void;
  onSkillsClick?: () => void;
  onRefresh?: () => void;
}

const ExpandedSidebar = memo(function ExpandedSidebar({
  files,
  selectedFile,
  onSelectFile,
  onCollapse,
  onSkillsClick,
  onRefresh,
}: ExpandedSidebarProps) {
  return (
    <div className="w-64 h-full shrink-0 border-r border-border bg-muted/30 flex flex-col">
      {/* Header with collapse button - entire row is clickable */}
      <div
        className="p-2.5 border-b border-border flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onCollapse}
        title="Collapse sidebar"
      >
        <div>
          <span className="text-sm font-medium text-foreground/80">Project Files</span>
          <span className="text-xs text-muted-foreground ml-2">{files.length} files</span>
        </div>
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="p-1.5">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No files yet
            </p>
          ) : (
            <FileTree
              files={files}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          )}
        </div>
      </ScrollArea>

      {/* Bottom buttons */}
      <div className="p-2.5 border-t border-border flex items-center gap-2">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Refresh files"
          >
            <RefreshCw className="h-4 w-4 text-foreground/70" />
            <span className="text-xs text-foreground/70 font-medium">Refresh</span>
          </button>
        )}
        {onSkillsClick && (
          <button
            onClick={onSkillsClick}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Skills"
          >
            <Sparkles className="h-4 w-4 text-foreground/70" />
            <span className="text-xs text-foreground/70 font-medium">Skills</span>
          </button>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// File Viewer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tab Bar Component
// ---------------------------------------------------------------------------

interface TabBarProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  resources?: ResourcesInfo;
  onResourcesClick?: () => void;
}

const TabBar = memo(function TabBar({
  activeTab,
  onTabChange,
  resources,
  onResourcesClick,
}: TabBarProps) {
  return (
    <div className="shrink-0 border-b border-border bg-muted/30">
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left side: Tabs */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5" role="tablist" aria-label="File viewer tabs">
          <button
            role="tab"
            aria-selected={activeTab === "readme"}
            onClick={() => onTabChange("readme")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
              activeTab === "readme"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-4 w-4" />
            Summary
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "architecture"}
            onClick={() => onTabChange("architecture")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
              activeTab === "architecture"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Network className="h-4 w-4" />
            Architecture
          </button>
        </div>

        {/* Right side: Resource pills */}
        {resources && (
          <div className="flex items-center gap-2">
            {resources.warehouseName && (
              <button
                onClick={onResourcesClick}
                className="flex items-center gap-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md px-2.5 py-1 transition-colors cursor-pointer"
                title={`Warehouse: ${resources.warehouseName}`}
              >
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate max-w-[150px]">{resources.warehouseName}</span>
              </button>
            )}
            {(resources.catalog || resources.schema) && (
              <button
                onClick={onResourcesClick}
                className="flex items-center gap-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md px-2.5 py-1 transition-colors cursor-pointer"
                title={`${resources.catalog || "default"}.${resources.schema || "default"}`}
              >
                <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate max-w-[200px]">
                  {resources.catalog || "default"}.{resources.schema || "default"}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// File Viewer
// ---------------------------------------------------------------------------

export const FileViewer = memo(function FileViewer({
  files,
  selectedFile,
  fileContent,
  onSelectFile,
  onSkillsClick,
  onRefresh,
  isLoading = false,
  architectureContent,
  onLoadArchitecture,
  isCreatingArchitecture = false,
  onCreateArchitecture,
  onArchitectureConnectionCreated,
  isStreaming = false,
  resources,
  onResourcesClick,
}: FileViewerProps) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("readme");
  const [showRaw, setShowRaw] = useState(false);

  // Check if architecture.md exists
  const hasArchitecture = useMemo(
    () => files.some((f) => f.path === "architecture.md"),
    [files]
  );

  // Load architecture content when tab changes (if file exists)
  useEffect(() => {
    if (activeTab === "architecture" && hasArchitecture && onLoadArchitecture) {
      onLoadArchitecture();
    }
  }, [activeTab, hasArchitecture, onLoadArchitecture]);

  // Trigger architecture creation when tab is selected but file doesn't exist
  // Only trigger if not already streaming (agent might be working on something else)
  useEffect(() => {
    if (activeTab === "architecture" && !hasArchitecture && !isCreatingArchitecture && !isStreaming && onCreateArchitecture) {
      onCreateArchitecture();
    }
  }, [activeTab, hasArchitecture, isCreatingArchitecture, isStreaming, onCreateArchitecture]);

  // Auto-select README.md when switching to readme tab
  useEffect(() => {
    if (activeTab === "readme" && selectedFile !== "README.md") {
      const hasReadme = files.some((f) => f.path === "README.md");
      if (hasReadme) {
        onSelectFile("README.md");
      }
    }
  }, [activeTab, files, selectedFile, onSelectFile]);

  // Check if file is renderable (markdown, HTML, or PDF)
  const isMarkdown = selectedFile?.endsWith(".md");
  const isHtml = selectedFile?.endsWith(".html") || selectedFile?.endsWith(".htm");
  const isPdf = selectedFile?.endsWith(".pdf");
  const isRenderable = isMarkdown || isHtml || isPdf;

  // Reset showRaw when changing files (default to preview mode)
  useEffect(() => {
    setShowRaw(false);
  }, [selectedFile]);

  // Handle tab change
  const handleTabChange = (tab: ViewTab) => {
    setActiveTab(tab);
    if (tab === "readme") {
      onSelectFile("README.md");
    } else if (tab === "architecture") {
      onSelectFile("architecture.md");
    } else if (tab === "files") {
      setIsSidebarExpanded(true);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <TabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        resources={resources}
        onResourcesClick={onResourcesClick}
      />

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Collapsible sidebar - only show in files tab or when explicitly expanded */}
        {(activeTab === "files" || isSidebarExpanded) && (
          <div
            className="shrink-0 transition-all duration-200 ease-in-out overflow-hidden"
            style={{ width: isSidebarExpanded ? "256px" : "48px" }}
          >
            {isSidebarExpanded ? (
              <ExpandedSidebar
                files={files}
                selectedFile={selectedFile}
                onSelectFile={(path) => {
                  onSelectFile(path);
                  // If selecting a file directly, switch to files tab
                  if (activeTab !== "files") {
                    setActiveTab("files");
                  }
                }}
                onCollapse={() => setIsSidebarExpanded(false)}
                onSkillsClick={onSkillsClick}
                onRefresh={onRefresh}
              />
            ) : (
              <CollapsedSidebar
                fileCount={files.length}
                onExpand={() => setIsSidebarExpanded(true)}
                onSkillsClick={onSkillsClick}
                onRefresh={onRefresh}
                activeTab={activeTab}
              />
            )}
          </div>
        )}

        {/* Collapsed sidebar for non-files tabs */}
        {activeTab !== "files" && !isSidebarExpanded && (
          <CollapsedSidebar
            fileCount={files.length}
            onExpand={() => setIsSidebarExpanded(true)}
            onSkillsClick={onSkillsClick}
            onRefresh={onRefresh}
            activeTab={activeTab}
          />
        )}

        {/* File content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Architecture tab — full-height, no scroll wrapper */}
          {activeTab === "architecture" && isCreatingArchitecture ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm font-medium">Creating your architecture...</p>
                <p className="text-xs mt-1">The agent is generating the diagram schema</p>
              </div>
            </div>
          ) : activeTab === "architecture" && architectureContent ? (
            <Suspense fallback={
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm">Loading architecture diagram...</p>
                </div>
              </div>
            }>
              <ArchitectureDiagram content={architectureContent} onConnectionCreated={onArchitectureConnectionCreated} />
            </Suspense>
          ) : activeTab === "architecture" && !hasArchitecture && isStreaming ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm font-medium">Please wait while your agent is working...</p>
                <p className="text-xs mt-1">The architecture will be generated once the current task completes</p>
              </div>
            </div>
          ) : activeTab === "architecture" && !hasArchitecture ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Network className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No architecture diagram yet</p>
                <p className="text-xs mt-1">Generating automatically...</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex-1 p-6">
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ) : !selectedFile ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground py-12">
                <FileEmptyIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Select a file to view its contents</p>
              </div>
            </div>
          ) : !fileContent ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground py-12">
                <p className="text-sm">File not found</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Header with Preview/Raw toggle for renderable files (not PDF) */}
              {isRenderable && !isPdf && (
                <div className="shrink-0 px-4 py-2 border-b border-border flex items-center justify-between bg-muted/20">
                  <span className="text-sm text-muted-foreground truncate">{selectedFile}</span>
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
                </div>
              )}

              {/* Content area */}
              {isRenderable && !showRaw ? (
                isPdf ? (
                  <iframe
                    src={`data:application/pdf;base64,${fileContent.content}`}
                    className="flex-1 w-full border-0"
                    title={selectedFile || "PDF Preview"}
                  />
                ) : isHtml ? (
                  <iframe
                    srcDoc={fileContent.content}
                    className="flex-1 w-full border-0 bg-white"
                    title={selectedFile || "HTML Preview"}
                    sandbox="allow-scripts allow-same-origin"
                  />
                ) : (
                  <ScrollArea className="flex-1">
                    <div className="p-6">
                      <Prose>{fileContent.content}</Prose>
                    </div>
                  </ScrollArea>
                )
              ) : (
                <div className="flex-1 flex flex-col p-4 min-h-0">
                  <Suspense fallback={
                    <div className="flex-1 flex items-center justify-center bg-muted/30 rounded-lg">
                      <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  }>
                    <CodeViewer content={fileContent.content} filename={selectedFile || "file.txt"} fullHeight />
                  </Suspense>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getFileIcon(extension: string): React.ReactNode {
  switch (extension) {
    case "md":
      return <FileText className="h-3.5 w-3.5 text-blue-500/70" />;
    case "py":
      return <FileCode className="h-3.5 w-3.5 text-green-500/70" />;
    case "sql":
      return <Database className="h-3.5 w-3.5 text-orange-500/70" />;
    case "json":
      return <Braces className="h-3.5 w-3.5 text-yellow-500/70" />;
    case "yaml":
    case "yml":
      return <Settings className="h-3.5 w-3.5 text-gray-500/70" />;
    case "txt":
      return <File className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <File className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function FileEmptyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

export default FileViewer;
