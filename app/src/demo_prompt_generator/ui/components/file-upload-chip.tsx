/**
 * One uploaded-file chip displayed under the home-page textarea.
 *
 * Renders: a format-aware icon, the filename, the byte size, a small
 * "truncated" badge when the original was bigger than the per-file cap,
 * and a × remove button. Keeping this isolated so the home page route
 * file doesn't bloat with chip-render logic.
 */
import { File, FileSpreadsheet, FileText, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UploadedFile } from "@/lib/custom-api";

interface Props {
  file: UploadedFile;
  onRemove: () => void;
}

/** Pick an icon that matches the file family so the chip is glanceable. */
function pickIcon(filename: string) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || ext === "docx" || ext === "md" || ext === "txt") return FileText;
  if (ext === "csv" || ext === "xlsx") return FileSpreadsheet;
  return File;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadChip({ file, onRemove }: Props) {
  const Icon = pickIcon(file.filename);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border bg-background/70",
        "px-2.5 py-1.5 text-xs max-w-full",
      )}
    >
      <Icon className="size-3.5 text-muted-foreground shrink-0" />
      <span className="truncate font-medium" title={file.filename}>
        {file.filename}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {formatBytes(file.size_bytes)}
      </span>
      {file.truncated && (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          truncated
        </Badge>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        aria-label={`Remove ${file.filename}`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
