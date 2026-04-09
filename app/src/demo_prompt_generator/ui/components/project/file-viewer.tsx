/**
 * File viewer component with collapsible sidebar.
 * Supports README and Architecture tabs when architecture.md exists.
 */

import { memo, useState, useMemo, useEffect, lazy, Suspense } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Prose } from "../markdown-prose";
import { Skeleton } from "../ui/skeleton";
import { ChevronRight, ChevronDown, ChevronLeft, Folder, FolderOpen, FileText, Sparkles, RefreshCw, Network } from "lucide-react";
import type { ProjectFile, ProjectFileContent } from "../../lib/custom-api";

// Lazy load the architecture diagram to avoid loading ReactFlow on every page
const ArchitectureDiagram = lazy(() => import("./architecture-diagram"));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewTab = "readme" | "architecture" | "files";

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
  isStreaming?: boolean; // Whether the agent is currently working
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

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-left rounded-md transition-colors cursor-pointer ${
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-muted/80 text-foreground/80"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      title={file.path}
    >
      <span className="text-muted-foreground shrink-0 text-xs">{icon}</span>
      <span className="truncate flex-1 text-[13px]">{file.name}</span>
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
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-left rounded-md transition-colors cursor-pointer hover:bg-muted/80 text-foreground/90"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
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
        <span className="truncate flex-1 text-[13px] font-medium">{name}</span>
        <span className="text-[10px] text-muted-foreground/60 shrink-0">
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
  const tabLabel = activeTab === "readme" ? "README.md" : activeTab === "architecture" ? "architecture.md" : "Files";

  return (
    <div className="w-10 h-full shrink-0 border-r border-border bg-muted/30 flex flex-col items-center pt-2 pb-2">
      {/* Expand area */}
      <div
        className="flex flex-col items-center cursor-pointer hover:bg-muted/50 transition-colors rounded px-1 py-1"
        onClick={onExpand}
      >
        {/* Vertical tab name text */}
        <div
          className="text-[10px] font-medium text-muted-foreground tracking-wider"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {tabLabel}
        </div>

        {/* File count */}
        <div className="flex flex-col items-center gap-0.5 mt-3">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground font-medium">
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
      <div className="flex flex-col items-center gap-1">
        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Refresh files"
          >
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <span className="text-[9px] text-muted-foreground font-medium">Refresh</span>
          </button>
        )}

        {/* Skills button */}
        {onSkillsClick && (
          <button
            onClick={onSkillsClick}
            className="flex flex-col items-center gap-0.5 p-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Skills"
          >
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-[9px] text-muted-foreground font-medium">Skills</span>
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
    <div className="w-56 h-full shrink-0 border-r border-border bg-muted/30 flex flex-col">
      {/* Header with collapse button - entire row is clickable */}
      <div
        className="p-2 border-b border-border flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onCollapse}
        title="Collapse sidebar"
      >
        <span className="text-xs text-muted-foreground font-medium">
          {files.length} files
        </span>
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
      <div className="p-2 border-t border-border flex items-center gap-2">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Refresh files"
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">Refresh</span>
          </button>
        )}
        {onSkillsClick && (
          <button
            onClick={onSkillsClick}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted/50 transition-colors cursor-pointer"
            title="Skills"
          >
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">Skills</span>
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
}

const TabBar = memo(function TabBar({
  activeTab,
  onTabChange,
}: TabBarProps) {
  return (
    <div className="shrink-0 border-b border-border bg-muted/30">
      <div className="flex items-center px-4 py-2 gap-1">

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
          <button
            onClick={() => onTabChange("readme")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
              activeTab === "readme"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            README
          </button>

          <button
            onClick={() => onTabChange("architecture")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
              activeTab === "architecture"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            Architecture
          </button>
        </div>
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
  isStreaming = false,
}: FileViewerProps) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("readme");

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

  const isMarkdown = selectedFile?.endsWith(".md");

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
      />

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Collapsible sidebar - only show in files tab or when explicitly expanded */}
        {(activeTab === "files" || isSidebarExpanded) && (
          <div
            className="shrink-0 transition-all duration-200 ease-in-out overflow-hidden"
            style={{ width: isSidebarExpanded ? "224px" : "40px" }}
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
          <ScrollArea className="flex-1">
            <div className="p-6">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : activeTab === "architecture" && isCreatingArchitecture ? (
                // Creating architecture - show spinner
                <div className="flex items-center justify-center h-[600px]">
                  <div className="text-center text-muted-foreground">
                    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="text-sm font-medium">Creating your architecture...</p>
                    <p className="text-xs mt-1">The agent is generating the diagram schema</p>
                  </div>
                </div>
              ) : activeTab === "architecture" && architectureContent ? (
                // Architecture tab content - visual diagram
                <Suspense fallback={
                  <div className="flex items-center justify-center h-[600px]">
                    <div className="text-center text-muted-foreground">
                      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                      <p className="text-sm">Loading architecture diagram...</p>
                    </div>
                  </div>
                }>
                  <ArchitectureDiagram content={architectureContent} />
                </Suspense>
              ) : activeTab === "architecture" && !hasArchitecture && isStreaming ? (
                // Agent is working on something - wait for it to finish
                <div className="flex items-center justify-center h-[600px]">
                  <div className="text-center text-muted-foreground">
                    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="text-sm font-medium">Please wait while your agent is working...</p>
                    <p className="text-xs mt-1">The architecture will be generated once the current task completes</p>
                  </div>
                </div>
              ) : activeTab === "architecture" && !hasArchitecture ? (
                // Architecture file doesn't exist and agent is idle - trigger creation
                <div className="flex items-center justify-center h-[600px]">
                  <div className="text-center text-muted-foreground">
                    <Network className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No architecture diagram yet</p>
                    <p className="text-xs mt-1">Generating automatically...</p>
                  </div>
                </div>
              ) : !selectedFile ? (
                <div className="text-center text-muted-foreground py-12">
                  <FileEmptyIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Select a file to view its contents</p>
                </div>
              ) : !fileContent ? (
                <div className="text-center text-muted-foreground py-12">
                  <p className="text-sm">File not found</p>
                </div>
              ) : isMarkdown ? (
                <Prose>{fileContent.content}</Prose>
              ) : (
                <pre className="text-sm font-mono whitespace-pre-wrap text-foreground/80 bg-muted/30 rounded-lg p-4 overflow-x-auto">
                  {fileContent.content}
                </pre>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getFileIcon(extension: string): string {
  switch (extension) {
    case "md":
      return "📝";
    case "py":
      return "🐍";
    case "sql":
      return "🗃️";
    case "json":
      return "📋";
    case "yaml":
    case "yml":
      return "⚙️";
    case "txt":
      return "📄";
    default:
      return "📄";
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
