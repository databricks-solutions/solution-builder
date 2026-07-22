/**
 * Shared right slide-over showing a template's screenshot, story, capabilities,
 * the solution ARCHITECTURE (rendered read-only from architecture.md), the
 * INCLUDED FILES (collapsible tree + content viewer with markdown preview/raw),
 * and — when the internal gallery passes `links` — the live-resource buttons
 * (Dashboard / Ask Genie / Open App / Data).
 *
 * Keyed off a template `id` (string) so any surface — the /templates list, the
 * home-page search results, the internal demos catalog — can open it without
 * needing a full list-item object. It fetches the full TemplateDetail + file
 * list on open and renders the header from that.
 *
 * "Use this template" forks AS-IS: the place to adapt a demo for your customer
 * is the "Make this demo yours" band on the forked project's overview
 * (StoryAdaptActions), so we don't ask for adaptation instructions here.
 */

import { useState, useEffect, lazy, Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Prose } from "@/components/markdown-prose";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  GitFork,
  Loader2,
  Network,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  AIBIBrandIcon,
  GenieBrandIcon,
  DatabricksAppsBrandIcon,
} from "@/components/databricks-icons";
import {
  getTemplate,
  listTemplateFiles,
  getTemplateFileContent,
  templateScreenshotUrl,
  templateScreenshotAtUrl,
  exportTemplate,
  getConfigStatus,
  type TemplateDetail,
  type TemplateFile,
  type DemoResourceLinks,
} from "@/lib/custom-api";

// The read-only architecture preview reuses the full ReactFlow editor. Lazy so
// the heavy diagram chunk isn't pulled into the gallery's initial bundle.
const PlatformDiagram = lazy(() => import("@/components/project/platform-diagram"));

type ArchState = "idle" | "loading" | "ready" | "absent";

/** A big primary-action link button (Dashboard / Ask Genie / App). */
function LinkButton({
  href,
  icon: Icon,
  label,
  tone,
}: {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tone: "dashboard" | "genie" | "app";
}) {
  const toneCls =
    tone === "genie"
      ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
      : tone === "app"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15"
        : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/15";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold transition-colors no-underline",
        toneCls,
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-60" />
    </a>
  );
}

export function TemplateGallerySheet({
  templateId,
  onClose,
  links,
  onFork,
}: {
  /** null → closed. Keyed off the id so any caller can open it. */
  templateId: string | null;
  onClose: () => void;
  links?: DemoResourceLinks;
  /** Fork into a new project (as-is — adapt happens post-fork on the overview). */
  onFork?: (t: TemplateDetail) => void;
}) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [archMd, setArchMd] = useState<string | null>(null);
  const [archState, setArchState] = useState<ArchState>("idle");
  const [isDownloading, setIsDownloading] = useState(false);
  // Screenshot carousel index (0 = hero). Only meaningful when screenshot_count > 1.
  const [shotIndex, setShotIndex] = useState(0);
  // Vendor-logo default for the read-only architecture preview (env
  // ENABLE_LOGO_BY_DEFAULT): off in the public build, on internally.
  const [defaultLogosOn, setDefaultLogosOn] = useState(false);
  useEffect(() => {
    let alive = true;
    getConfigStatus()
      .then((c) => { if (alive) setDefaultLogosOn(!!c.enable_logo_by_default); })
      .catch(() => { /* best-effort; stays false */ });
    return () => { alive = false; };
  }, []);

  // Included files (collapsible tree + content viewer).
  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const isMarkdownFile = selectedFile?.endsWith(".md") ?? false;

  const handleDownloadDab = async () => {
    if (!templateId) return;
    setIsDownloading(true);
    try {
      await exportTemplate(templateId); // streams a .zip = the deployable DAB bundle
    } catch (e) {
      console.error("Failed to download template DAB:", e);
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (!templateId) {
      setDetail(null);
      setArchMd(null);
      setArchState("idle");
      setFiles([]);
      setFilesOpen(false);
      setSelectedFile(null);
      setFileContent("");
      setShowRaw(false);
      setShotIndex(0);
      return;
    }

    setIsLoading(true);
    setDetail(null);
    setArchMd(null);
    setArchState("loading");
    setFiles([]);
    setFilesOpen(false);
    setSelectedFile(null);
    setFileContent("");
    setShotIndex(0);

    Promise.all([getTemplate(templateId), listTemplateFiles(templateId)])
      .then(([templateData, filesData]: [TemplateDetail, TemplateFile[]]) => {
        setDetail(templateData);
        setFiles(filesData);

        // Default the file viewer's selection to README.md (or the first file).
        const readme = filesData.find((f) => f.name.toLowerCase() === "readme.md");
        setSelectedFile(readme?.path ?? filesData[0]?.path ?? null);

        const arch = filesData.find(
          (f) => f.name.toLowerCase() === "architecture.md",
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
      .catch(() => setArchState("absent"))
      .finally(() => setIsLoading(false));
  }, [templateId]);

  // Load file content when the selected file changes (only worth it once the
  // Files section has been expanded).
  useEffect(() => {
    if (!templateId || !selectedFile || !filesOpen) {
      return;
    }
    setIsLoadingFile(true);
    getTemplateFileContent(templateId, selectedFile)
      .then((data) => setFileContent(data.content))
      .catch(() => setFileContent("// Failed to load file content"))
      .finally(() => setIsLoadingFile(false));
  }, [templateId, selectedFile, filesOpen]);

  const isApproved = detail?.status === "APPROVED";
  const fileTree = buildFileTree(files);

  return (
    <Sheet open={templateId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        {templateId && (
          <div className="flex h-full flex-col">
            <SheetHeader className="space-y-2 border-b bg-muted/20 px-6 pb-5 pt-6 text-left">
              {detail?.industry && (
                <Badge variant="secondary" className="w-fit text-[10px] font-medium">
                  {detail.industry}
                </Badge>
              )}
              <SheetTitle className="pr-8 text-xl font-semibold leading-tight">
                {detail?.name ?? "Loading…"}
              </SheetTitle>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-6 px-6 py-6">
                {/* Narrative — the story summary, at the very top (above the image). */}
                {detail?.narrative && (
                  <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground/90">
                    {detail.narrative}
                  </p>
                )}

                {/* Screenshot(s) — hero, or a small carousel when there are extras. */}
                {detail && (detail.screenshot_count ?? 0) > 0 && (() => {
                  const count = detail.screenshot_count ?? 0;
                  const idx = Math.min(shotIndex, count - 1);
                  return (
                    <div className="space-y-2">
                      <div className="relative overflow-hidden rounded-lg border bg-muted/30">
                        <img
                          src={
                            idx === 0
                              ? templateScreenshotUrl(detail.id)
                              : templateScreenshotAtUrl(detail.id, idx)
                          }
                          alt={`${detail.name} screenshot ${idx + 1}`}
                          loading="lazy"
                          className="w-full object-contain"
                        />
                        {count > 1 && (
                          <>
                            <button
                              type="button"
                              aria-label="Previous screenshot"
                              onClick={() => setShotIndex((i) => (i - 1 + count) % count)}
                              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-background cursor-pointer"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Next screenshot"
                              onClick={() => setShotIndex((i) => (i + 1) % count)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-background cursor-pointer"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                      {count > 1 && (
                        <div className="flex items-center justify-center gap-1.5">
                          {Array.from({ length: count }).map((_, i) => (
                            <button
                              key={i}
                              type="button"
                              aria-label={`Go to screenshot ${i + 1}`}
                              onClick={() => setShotIndex(i)}
                              className={cn(
                                "h-1.5 rounded-full transition-all cursor-pointer",
                                i === idx ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
                              )}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Live-resource links (internal gallery only) */}
                {links && (links.dashboard || links.genie || links.app || links.data) && (
                  <div className="flex flex-wrap gap-2">
                    {links.dashboard && (
                      <LinkButton href={links.dashboard} icon={AIBIBrandIcon} label="Dashboard" tone="dashboard" />
                    )}
                    {links.genie && (
                      <LinkButton href={links.genie} icon={GenieBrandIcon} label="Ask Genie" tone="genie" />
                    )}
                    {links.app && (
                      <LinkButton href={links.app} icon={DatabricksAppsBrandIcon} label="Open App" tone="app" />
                    )}
                    {links.data && (
                      <a
                        href={links.data}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3.5 py-2.5 text-[13px] font-medium text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Database className="h-4 w-4" /> Data
                        <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                      </a>
                    )}
                  </div>
                )}

                {/* Description — fallback Overview only when there's no narrative
                    (the narrative up top already tells the story). */}
                {!detail?.narrative && detail?.description && (
                  <section className="space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Overview
                    </h4>
                    <p className="text-[13.5px] leading-relaxed text-foreground/90">
                      {detail.description}
                    </p>
                  </section>
                )}

                {/* Capabilities */}
                {detail?.capabilities && detail.capabilities.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Capabilities
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-xs">
                          {cap.replace(/-/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </section>
                )}

                {/* Architecture */}
                {archState !== "absent" && (
                  <section className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      <Network className="h-3.5 w-3.5" /> Architecture
                    </h4>
                    <div className="overflow-hidden rounded-xl border bg-card">
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
                              defaultLogosOn={defaultLogosOn}
                            />
                          </Suspense>
                        </div>
                      ) : (
                        <DiagramFallback />
                      )}
                    </div>
                  </section>
                )}

                {/* Included files (collapsible tree + content viewer) */}
                {files.length > 0 && (
                  <section className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setFilesOpen((o) => !o)}
                      className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-expanded={filesOpen}
                    >
                      {filesOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      <Folder className="h-3.5 w-3.5" />
                      Included files
                      <span className="font-normal normal-case tracking-normal">
                        ({files.length})
                      </span>
                    </button>

                    {filesOpen && (
                      <div className="flex h-[440px] rounded-xl border overflow-hidden">
                        {/* File tree sidebar */}
                        <div className="w-[240px] border-r flex flex-col min-h-0">
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
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-mono text-muted-foreground truncate">
                                {selectedFile ?? "Select a file"}
                              </span>
                              {isLoadingFile && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                              )}
                            </div>
                            {isMarkdownFile && (
                              <div className="flex items-center gap-1 bg-muted rounded-md p-0.5 shrink-0">
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
                )}
              </div>
            </ScrollArea>

            {/* Footer — download the DAB + (optional) fork */}
            <div className="flex items-center gap-3 border-t px-6 py-4">
              {/* Download as a deployable DAB bundle (zip). Available for every
                  template that has files — official demos unzip into a ready-to
                  `databricks bundle deploy` project. */}
              <Button
                variant="outline"
                onClick={handleDownloadDab}
                disabled={isLoading || isDownloading || !detail}
                title="Download this template as a Databricks Asset Bundle (databricks bundle deploy)"
              >
                {isDownloading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Download DAB
              </Button>

              {onFork && (
                <>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    or get a private editable copy
                  </span>
                  <Button
                    className="ml-auto"
                    onClick={() => detail && onFork(detail)}
                    disabled={isLoading || !detail || !isApproved}
                    title={
                      !isApproved && detail
                        ? "This template is pending approval and cannot be forked yet"
                        : "Fork this template into a new project"
                    }
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : !isApproved && detail ? (
                      <>
                        <Clock className="mr-2 h-4 w-4" />
                        Pending approval
                      </>
                    ) : (
                      <>
                        <GitFork className="mr-2 h-4 w-4" />
                        Use this template
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DiagramFallback() {
  return (
    <div className="flex h-[440px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// File tree (ported from the former template-detail-popup).
// ---------------------------------------------------------------------------

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNode[];
}

function buildFileTree(files: TemplateFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirs: Record<string, FileTreeNode> = {};
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
        currentLevel.push({ name: part, path: file.path, isDir: false, children: [] });
      } else {
        if (!dirs[currentPath]) {
          const dirNode: FileTreeNode = { name: part, path: currentPath, isDir: true, children: [] };
          dirs[currentPath] = dirNode;
          currentLevel.push(dirNode);
        }
        currentLevel = dirs[currentPath].children;
      }
    }
  }

  return root;
}

function FileTreeView({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
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

function FileTreeItem({
  node,
  selectedPath,
  onSelect,
  depth,
}: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-left hover:bg-muted/50 cursor-pointer"
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
        isSelected && "bg-primary/10 text-primary",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default TemplateGallerySheet;
