/**
 * File viewer component with collapsible sidebar.
 * Supports README and Architecture tabs when architecture.md exists.
 */

import React, { memo, useState, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Prose } from "../markdown-prose";
import { ProjectOverview } from "./project-overview";
import { Skeleton } from "../ui/skeleton";
import { ChevronRight, ChevronDown, ChevronLeft, Folder, FolderOpen, FileText, FileCode, Braces, Settings, File, Sparkles, RefreshCw, Network, BookOpen, Database, Eye, EyeOff, Code, Globe, Loader2, Server } from "lucide-react";
import { UnityCatalogIcon } from "../databricks-icons";
import { Button } from "../ui/button";
import type { ProjectFile, ProjectFileContent, DeployedResourceLink } from "../../lib/custom-api";
import { AppPreviewTab } from "../../preview";
import { cn } from "../../lib/utils";

// Lazy load the capability-layer platform diagram.
const PlatformDiagram = lazy(() => import("./platform-diagram"));

// Lazy load Monaco editor for code files
const CodeViewer = lazy(() => import("./code-viewer").then(m => ({ default: m.CodeViewer })));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Top-level sections. Each one is purposely single-job so the user
// always knows what they're looking at:
//   overview     → marketecture grid + status banner + story preview
//   story        → README rendered as prose
//   architecture → the diagram, full-bleed
//   app          → live preview of the generated Databricks App
//   files        → raw file tree + content viewer
type ViewTab = "overview" | "story" | "architecture" | "app" | "files";

interface ResourcesInfo {
  warehouseName?: string | null;
  catalog?: string | null;
  schema?: string | null;
}

interface FileViewerProps {
  projectId: string;
  /** Project description — used as the elevator pitch fallback when no
   *  README exists yet (otherwise we extract a paragraph from the README). */
  projectDescription?: string | null;
  /** LLM-generated 1-2 paragraph storytelling narrative — the primary
   *  source for the Overview hero. Distinct from `description`. */
  projectNarrative?: string | null;
  /** ISO project creation timestamp — anchors the build banner's
   *  "Started X ago" label so it survives page refresh. */
  projectCreatedAt?: string | null;
  /** True while the backend is generating a narrative — drives the
   *  shimmer/skeleton state on the hero. */
  isGeneratingNarrative?: boolean;
  /** Trigger a regenerate of the narrative from the current README. */
  onRegenerateNarrative?: () => void;
  /** Controlled active tab. Parent (route) owns this and syncs it to a
   *  URL search param so back/forward + bookmarks work. */
  activeTab?: ViewTab;
  /** Called when the user clicks a tab. Should update the URL so
   *  history records the navigation. */
  onTabChange?: (tab: ViewTab) => void;
  files: ProjectFile[];
  selectedFile: string | null;
  fileContent: ProjectFileContent | null;
  /** README.md content for the overview's "About this demo" expander.
   *  Loaded by the parent and passed through so we don't double-fetch. */
  readmeContent?: string | null;
  onSelectFile: (path: string) => void;
  onSkillsClick?: () => void;
  /** Click handler for the empty-state CTA on the overview ("Start with the
   *  assistant"). When chat is collapsed, this should expand it. */
  onOpenChat?: () => void;
  /** Opens the DescriptionEditDialog from the Overview hero. */
  onEditDescription?: () => void;
  /** Toggle for "show hidden files" in the file tree. Hidden files
   *  (`.databrickscfg`, `.claude/skills/`, `.preview.pgid`) are filtered
   *  out by default so the everyday user doesn't see them. SAs flip
   *  this to debug deployed-mode auth (e.g. confirm `.databrickscfg`
   *  is being written to the project dir on each request).
   *
   *  The toggle is bound to a small EyeOff icon at the bottom of the
   *  sidebar — discoverable but visually subtle. */
  showHidden?: boolean;
  onToggleShowHidden?: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  architectureContent?: string | null;
  onLoadArchitecture?: () => void;
  isCreatingArchitecture?: boolean;
  onCreateArchitecture?: () => void;
  isStreaming?: boolean; // Whether the agent is currently working
  resources?: ResourcesInfo;
  onResourcesClick?: () => void;
  deployedResources?: DeployedResourceLink[];
  deployedExtractionError?: string | null;
  /** Parsed from the project's `resources.json` — drives the marketecture
   *  grid on the Overview tab. ProjectOverview joins these slugs against
   *  deployedResources to flip widgets from pending → live. */
  capabilities?: { buildable: string[]; talking_track: string[] } | null;
  /** Wire auto-fix-from-logs on the App tab. Without this, the toggle is hidden. */
  onAutoFixSend?: (message: string) => void;
  autoFixApiRef?: import("../../preview").AutoFixApiRef;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  file?: ProjectFile;
  children: Map<string, TreeNode>;
}

// ---------------------------------------------------------------------------
// Story view — README rendered full-width as prose.
// ---------------------------------------------------------------------------

/** Strip leading YAML frontmatter (between `---` fences) from markdown.
 *  Otherwise the renderer treats the closing `---` as a horizontal rule
 *  and the first thing the user sees is a meaningless divider. */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const lines = markdown.split("\n");
  if (lines[0].trim() !== "---") return markdown;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1).join("\n").replace(/^\n+/, "");
    }
  }
  return markdown;
}

interface StoryViewProps {
  readmeContent: string | null;
  isStreaming: boolean;
}

const StoryView = memo(function StoryView({ readmeContent, isStreaming }: StoryViewProps) {
  if (!readmeContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground max-w-md px-4">
          {isStreaming ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-sm">Writing the story...</p>
            </>
          ) : (
            <>
              <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No story yet.</p>
              <p className="text-xs mt-1">
                Describe your solution to the assistant — it'll draft a story here.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }
  const body = stripFrontmatter(readmeContent);
  return (
    <ScrollArea className="flex-1">
      <div className="px-8 py-7 max-w-[1180px] mx-auto">
        <section className="rounded-2xl border border-border/60 bg-card p-8 lg:p-10">
          <div className="mb-6 pb-4 border-b border-border/50 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              The story
            </h2>
          </div>
          <Prose>{body}</Prose>
        </section>
      </div>
    </ScrollArea>
  );
});

// ---------------------------------------------------------------------------
// Architecture view — full-bleed diagram (heavy ReactFlow component).
// ---------------------------------------------------------------------------

interface ArchitectureViewProps {
  architectureContent: string | null;
  hasArchitecture: boolean;
  isCreatingArchitecture: boolean;
  isStreaming: boolean;
  capabilities?: { buildable: string[]; talking_track: string[] } | null;
  deployedResources?: DeployedResourceLink[];
  projectId: string;
}

const ArchitectureView = memo(function ArchitectureView({
  architectureContent,
  hasArchitecture,
  isCreatingArchitecture,
  isStreaming,
  capabilities,
  deployedResources,
  projectId,
}: ArchitectureViewProps) {
  if (isCreatingArchitecture) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm font-medium">Creating your architecture...</p>
          <p className="text-xs mt-1">The agent is generating the diagram schema</p>
        </div>
      </div>
    );
  }
  // The capability-layer diagram renders from the catalog + resources.json
  // even before architecture.md exists — so show it whenever we have either
  // an architecture file OR a capability set to seed component states.
  const hasContent = (hasArchitecture && architectureContent) || !!capabilities;
  if (hasContent) {
    return (
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <PlatformDiagram
          content={hasArchitecture ? architectureContent : null}
          capabilities={capabilities ?? null}
          deployedResources={deployedResources}
          projectId={projectId}
        />
      </Suspense>
    );
  }
  if (isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm font-medium">Please wait while the agent is working...</p>
          <p className="text-xs mt-1">The architecture will be generated once the current task completes</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Network className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No architecture diagram yet</p>
        <p className="text-xs mt-1">Generating automatically...</p>
      </div>
    </div>
  );
});

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
  // Folders start collapsed by default — keeps the tree compact on
  // first render. The user expands what they want; we still auto-show
  // children of any folder containing the currently-selected file
  // (see hasSelectedChild below) so deep-linking still surfaces it.
  defaultExpanded = false,
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
// Expanded Sidebar (Files tab only)
// ---------------------------------------------------------------------------

interface ExpandedSidebarProps {
  files: ProjectFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onCollapse: () => void;
  onSkillsClick?: () => void;
  showHidden?: boolean;
  onToggleShowHidden?: () => void;
  onRefresh?: () => void;
  resources?: ResourcesInfo;
  onResourcesClick?: () => void;
}

const ExpandedSidebar = memo(function ExpandedSidebar({
  files,
  selectedFile,
  onSelectFile,
  onCollapse,
  onSkillsClick,
  showHidden,
  onToggleShowHidden,
  onRefresh,
  resources,
  onResourcesClick,
}: ExpandedSidebarProps) {
  const hasUC = !!(resources?.catalog || resources?.schema);
  const hasWarehouse = !!resources?.warehouseName;

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

      {/* Workspace section — catalog/schema/warehouse defaults. Tucked at
          the top of the Files sidebar (advanced view) since this is
          technical context AEs/SAs check when debugging deployments. */}
      {(hasUC || hasWarehouse) && (
        <div className="px-2.5 py-2 border-b border-border space-y-1.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 px-1">
            Workspace resources
          </div>
          {hasUC && (
            <button
              onClick={onResourcesClick}
              className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[12px] text-foreground/80 hover:bg-muted/60 transition-colors text-left cursor-pointer"
              title="Edit workspace defaults"
            >
              <UnityCatalogIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-mono truncate">
                {resources?.catalog || "default"}.{resources?.schema || "default"}
              </span>
            </button>
          )}
          {hasWarehouse && (
            <button
              onClick={onResourcesClick}
              className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[12px] text-foreground/80 hover:bg-muted/60 transition-colors text-left cursor-pointer"
              title="Edit workspace defaults"
            >
              <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{resources?.warehouseName}</span>
            </button>
          )}
        </div>
      )}

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="px-2.5 pt-2 pb-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 px-1">
            Files
          </div>
        </div>
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
        {/* Show hidden files toggle — see CollapsedSidebar comment. */}
        {onToggleShowHidden && (
          <button
            onClick={onToggleShowHidden}
            className={cn(
              "ml-auto flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer",
              showHidden ? "opacity-100 text-amber-600 dark:text-amber-400" : "opacity-60 hover:opacity-100",
            )}
            title={showHidden ? "Hide system files" : "Show all files (incl. hidden)"}
            aria-label="Toggle hidden files"
            aria-pressed={!!showHidden}
          >
            <EyeOff className="h-3.5 w-3.5" />
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
  hasReadme: boolean;
  hasArchitecture: boolean;
  hasApp: boolean;
  showAppTab: boolean;
}

function tabClasses(isActive: boolean, isAvailable: boolean): string {
  return cn(
    "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer",
    isActive
      ? "bg-background text-foreground shadow-sm"
      : isAvailable
        ? "text-foreground hover:text-foreground"
        : "text-muted-foreground hover:text-foreground",
  );
}

interface TabIconProps {
  Icon: React.ComponentType<{ className?: string }>;
  showDot: boolean;
}

function TabIcon({ Icon, showDot }: TabIconProps) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <Icon className="h-4 w-4" />
      {showDot && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary"
        />
      )}
    </span>
  );
}

const TabBar = memo(function TabBar({
  activeTab,
  onTabChange,
  hasReadme,
  hasArchitecture,
  hasApp,
  showAppTab,
}: TabBarProps) {
  return (
    <div className="shrink-0 border-b border-border bg-muted/30">
      <div className="flex items-center px-4 py-2">
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5" role="tablist" aria-label="View tabs">
          <button
            role="tab"
            aria-selected={activeTab === "overview"}
            onClick={() => onTabChange("overview")}
            title="Project overview"
            className={tabClasses(activeTab === "overview", true)}
          >
            <TabIcon Icon={Sparkles} showDot={false} />
            Overview
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "story"}
            onClick={() => onTabChange("story")}
            title={hasReadme ? "Solution story (README)" : "Story (no README yet)"}
            className={tabClasses(activeTab === "story", hasReadme)}
          >
            <TabIcon Icon={BookOpen} showDot={hasReadme && activeTab !== "story"} />
            Story
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "architecture"}
            onClick={() => onTabChange("architecture")}
            title={hasArchitecture ? "Architecture diagram" : "Architecture (not yet generated)"}
            className={tabClasses(activeTab === "architecture", hasArchitecture)}
          >
            <TabIcon Icon={Network} showDot={hasArchitecture && activeTab !== "architecture"} />
            Architecture
          </button>

          {showAppTab && (
            <button
              role="tab"
              aria-selected={activeTab === "app"}
              onClick={() => onTabChange("app")}
              title={hasApp ? "App (generated)" : "App"}
              className={tabClasses(activeTab === "app", hasApp)}
            >
              <TabIcon Icon={Globe} showDot={hasApp && activeTab !== "app"} />
              App
            </button>
          )}

          <button
            role="tab"
            aria-selected={activeTab === "files"}
            onClick={() => onTabChange("files")}
            title="Project files"
            className={tabClasses(activeTab === "files", true)}
          >
            <TabIcon Icon={FileText} showDot={false} />
            Files
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
  projectId,
  projectDescription,
  projectNarrative,
  projectCreatedAt,
  isGeneratingNarrative,
  onRegenerateNarrative,
  activeTab: activeTabProp,
  onTabChange,
  files,
  selectedFile,
  fileContent,
  readmeContent,
  onSelectFile,
  onSkillsClick,
  onOpenChat,
  onEditDescription,
  showHidden,
  onToggleShowHidden,
  onRefresh,
  isLoading = false,
  architectureContent,
  onLoadArchitecture,
  isCreatingArchitecture = false,
  onCreateArchitecture,
  isStreaming = false,
  resources,
  onResourcesClick,
  deployedResources,
  deployedExtractionError,
  capabilities,
  onAutoFixSend,
  autoFixApiRef,
}: FileViewerProps) {
  // The tab is controlled by the parent route when `activeTabProp` is
  // supplied (URL-synced for back/forward). Local state is kept as a
  // fallback for any standalone usage so this component still works
  // without a router wrapper.
  const [activeTabLocal, setActiveTabLocal] = useState<ViewTab>("overview");
  const activeTab: ViewTab = activeTabProp ?? activeTabLocal;
  const setActiveTab = useCallback(
    (next: ViewTab) => {
      if (onTabChange) onTabChange(next);
      else setActiveTabLocal(next);
    },
    [onTabChange],
  );
  const [showRaw, setShowRaw] = useState(false);

  const hasReadme = useMemo(() => files.some((f) => f.path === "README.md"), [files]);
  const hasArchitecture = useMemo(() => files.some((f) => f.path === "architecture.md"), [files]);
  const hasSpecifications = useMemo(
    () => files.some((f) => f.path.startsWith("specifications/")),
    [files],
  );

  // Check if a runnable local app exists. Mirrors the backend's
  // `has_start_script` rule (backend/preview/registry.py).
  const hasApp = useMemo(
    () => files.some((f) => f.path === "app/start.sh"),
    [files]
  );

  // Only surface the App tab when an app is part of this project — either
  // selected as a capability in resources.json, or already generated on disk.
  const showAppTab = useMemo(
    () => hasApp || (capabilities?.buildable ?? []).includes("databricks-apps"),
    [hasApp, capabilities],
  );

  // If the app is deselected while the App tab is active, fall back to Overview.
  useEffect(() => {
    if (!showAppTab && activeTab === "app") {
      setActiveTab("overview");
    }
  }, [showAppTab, activeTab]);

  // Lazy-load architecture content when the Architecture tab is opened.
  useEffect(() => {
    if (activeTab === "architecture" && hasArchitecture && onLoadArchitecture) {
      onLoadArchitecture();
    }
  }, [activeTab, hasArchitecture, onLoadArchitecture]);

  // Auto-trigger generation if the user opens the Architecture tab and
  // no diagram exists yet (and the agent is idle so we don't stomp work).
  useEffect(() => {
    if (
      activeTab === "architecture" &&
      !hasArchitecture &&
      !isCreatingArchitecture &&
      !isStreaming &&
      onCreateArchitecture
    ) {
      onCreateArchitecture();
    }
  }, [activeTab, hasArchitecture, isCreatingArchitecture, isStreaming, onCreateArchitecture]);

  // Check if file is renderable (markdown, HTML, or PDF)
  const isMarkdown = selectedFile?.endsWith(".md");
  const isHtml = selectedFile?.endsWith(".html") || selectedFile?.endsWith(".htm");
  const isPdf = selectedFile?.endsWith(".pdf");
  const isRenderable = isMarkdown || isHtml || isPdf;

  // Reset showRaw when changing files (default to preview mode)
  useEffect(() => {
    setShowRaw(false);
  }, [selectedFile]);

  const handleTabChange = (tab: ViewTab) => {
    setActiveTab(tab);
  };

  return (
    <div className="flex flex-col h-full">
      <TabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasReadme={hasReadme}
        hasArchitecture={hasArchitecture}
        hasApp={hasApp}
        showAppTab={showAppTab}
      />

      <div className="flex flex-1 min-h-0">
        {/* Files-tab-only sidebar (kept simple — files tab shows tree + content) */}
        {activeTab === "files" && (
          <div className="shrink-0 overflow-hidden" style={{ width: "256px" }}>
            <ExpandedSidebar
              files={files}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onCollapse={() => setActiveTab("overview")}
              onSkillsClick={onSkillsClick}
              showHidden={showHidden}
              onToggleShowHidden={onToggleShowHidden}
              onRefresh={onRefresh}
              resources={resources}
              onResourcesClick={onResourcesClick}
            />
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeTab === "overview" ? (
            <ProjectOverview
              projectId={projectId}
              projectDescription={projectDescription ?? null}
              projectNarrative={projectNarrative ?? null}
              isGeneratingNarrative={isGeneratingNarrative ?? false}
              onRegenerateNarrative={onRegenerateNarrative}
              capabilities={capabilities ?? null}
              deployedResources={deployedResources}
              deployedExtractionError={deployedExtractionError}
              readmeContent={readmeContent ?? null}
              hasReadme={hasReadme}
              hasArchitecture={hasArchitecture}
              hasApp={hasApp}
              hasSpecifications={hasSpecifications}
              files={files}
              createdAt={projectCreatedAt}
              isStreaming={isStreaming}
              onOpenChat={onOpenChat}
              onShowFullStory={() => setActiveTab("story")}
              onShowArchitecture={() => setActiveTab("architecture")}
              onShowApp={() => setActiveTab("app")}
              onEditDescription={onEditDescription}
            />
          ) : activeTab === "story" ? (
            <StoryView
              readmeContent={readmeContent ?? null}
              isStreaming={isStreaming}
            />
          ) : activeTab === "architecture" ? (
            <ArchitectureView
              architectureContent={architectureContent ?? null}
              hasArchitecture={hasArchitecture}
              isCreatingArchitecture={isCreatingArchitecture}
              isStreaming={isStreaming}
              capabilities={capabilities}
              deployedResources={deployedResources}
              projectId={projectId}
            />
          ) : activeTab === "app" ? (
            <AppPreviewTab
              projectId={projectId}
              onAutoFixSend={onAutoFixSend}
              isStreaming={isStreaming}
              autoFixApiRef={autoFixApiRef}
            />
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
