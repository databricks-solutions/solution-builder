/**
 * File viewer component for displaying project files.
 */

import { memo, useState, useMemo } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Prose } from "../markdown-prose";
import { Skeleton } from "../ui/skeleton";
import { Badge } from "../ui/badge";
import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { ProjectFile, ProjectFileContent } from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileViewerProps {
  files: ProjectFile[];
  selectedFile: string | null;
  fileContent: ProjectFileContent | null;
  onSelectFile: (path: string) => void;
  isLoading?: boolean;
  projectName?: string;
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

  // Sort files alphabetically
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

  // Check if any child is selected (to keep folder expanded)
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
          {/* Render folders first */}
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
          {/* Then files */}
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
      {/* Root files first (like README.md, META-PROMPT.md) */}
      {rootFiles.map((node) => (
        <FileItem
          key={node.path}
          file={node.file!}
          isSelected={selectedFile === node.path}
          onClick={() => onSelectFile(node.path)}
          depth={0}
        />
      ))}
      {/* Then folders */}
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
// File Viewer
// ---------------------------------------------------------------------------

export const FileViewer = memo(function FileViewer({
  files,
  selectedFile,
  fileContent,
  onSelectFile,
  isLoading = false,
  projectName,
}: FileViewerProps) {
  const isMarkdown = selectedFile?.endsWith(".md");

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/30">
        <div className="p-3 border-b border-border">
          <h3 className="font-semibold text-sm truncate">
            {projectName || "Project Files"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {files.length} files
          </p>
        </div>
        <ScrollArea className="h-[calc(100%-60px)]">
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
      </div>

      {/* File content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* File header */}
        {selectedFile && (
          <div className="shrink-0 px-4 py-2 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground">
                {getFileIcon(selectedFile.split(".").pop() || "")}
              </span>
              <span className="font-medium text-sm truncate">{selectedFile}</span>
            </div>
            {fileContent && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                {formatFileSize(fileContent.size)}
              </Badge>
            )}
          </div>
        )}

        {/* Content area */}
        <ScrollArea className="flex-1">
          <div className="p-6">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
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
  );
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
