/**
 * File viewer component for displaying project files.
 */

import { memo } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Prose } from "../markdown-prose";
import { Skeleton } from "../ui/skeleton";
import { Badge } from "../ui/badge";
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

// ---------------------------------------------------------------------------
// File Tree Item
// ---------------------------------------------------------------------------

interface FileTreeItemProps {
  file: ProjectFile;
  isSelected: boolean;
  onClick: () => void;
}

const FileTreeItem = memo(function FileTreeItem({
  file,
  isSelected,
  onClick,
}: FileTreeItemProps) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const icon = getFileIcon(extension);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md transition-colors ${
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-muted text-foreground/80"
      }`}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate flex-1">{file.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatFileSize(file.size)}
      </span>
    </button>
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
          <div className="p-2 space-y-0.5">
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No files yet
              </p>
            ) : (
              files.map((file) => (
                <FileTreeItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onClick={() => onSelectFile(file.path)}
                />
              ))
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
      return "📁";
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
