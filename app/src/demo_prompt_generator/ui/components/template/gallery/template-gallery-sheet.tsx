/**
 * Shared right slide-over showing a template's screenshot, story, capabilities,
 * the solution ARCHITECTURE (rendered read-only from architecture.md), and —
 * when the internal gallery passes `links` — the live-resource buttons
 * (Dashboard / Ask Genie / Open App / Data).
 *
 * Fetches the full TemplateDetail + file list on open. Optional `onFork` wires
 * the create-project-from-template flow.
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Clock,
  Database,
  Download,
  ExternalLink,
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
  exportTemplate,
  type TemplateListItem,
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
  template,
  onClose,
  links,
  onFork,
}: {
  template: TemplateListItem | null;
  onClose: () => void;
  links?: DemoResourceLinks;
  /** Fork into a new project. `adaptInstructions` (from the "tune it" dialog)
   *  is empty for "use as is". */
  onFork?: (t: TemplateDetail, adaptInstructions?: string) => void;
}) {
  const templateId = template?.id ?? null;
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [archMd, setArchMd] = useState<string | null>(null);
  const [archState, setArchState] = useState<ArchState>("idle");
  const [isDownloading, setIsDownloading] = useState(false);
  // "Use this template" dialog: choose use-as-is vs tune-it + describe the change.
  const [useDialogOpen, setUseDialogOpen] = useState(false);
  const [useMode, setUseMode] = useState<"as-is" | "tune">("as-is");
  const [adaptText, setAdaptText] = useState("");

  const confirmUseTemplate = () => {
    if (!detail || !onFork) return;
    const instructions = useMode === "tune" ? adaptText.trim() : "";
    setUseDialogOpen(false);
    onFork(detail, instructions || undefined);
  };

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
      return;
    }

    setIsLoading(true);
    setDetail(null);
    setArchMd(null);
    setArchState("loading");

    Promise.all([getTemplate(templateId), listTemplateFiles(templateId)])
      .then(([templateData, filesData]: [TemplateDetail, TemplateFile[]]) => {
        setDetail(templateData);

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

  const isApproved = detail?.status === "APPROVED";

  return (
    <Sheet open={template !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        {template && (
          <div className="flex h-full flex-col">
            <SheetHeader className="space-y-2 border-b bg-muted/20 px-6 pb-5 pt-6 text-left">
              {template.industry && (
                <Badge variant="secondary" className="w-fit text-[10px] font-medium">
                  {template.industry}
                </Badge>
              )}
              <SheetTitle className="pr-8 text-xl font-semibold leading-tight">
                {template.name}
              </SheetTitle>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-6 px-6 py-6">
                {/* Screenshot */}
                {template.has_screenshot && (
                  <div className="overflow-hidden rounded-lg border bg-muted/30">
                    <img
                      src={templateScreenshotUrl(template.id)}
                      alt={`${template.name} screenshot`}
                      loading="lazy"
                      className="w-full object-contain"
                    />
                  </div>
                )}

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

                {/* Description */}
                {template.description && (
                  <section className="space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Overview
                    </h4>
                    <p className="text-[13.5px] leading-relaxed text-foreground/90">
                      {template.description}
                    </p>
                  </section>
                )}

                {/* Capabilities */}
                {template.capabilities && template.capabilities.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Capabilities
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {template.capabilities.map((cap) => (
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
                        <div className="h-[380px]">
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
                      ) : (
                        <DiagramFallback />
                      )}
                    </div>
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
                    onClick={() => { setUseMode("as-is"); setAdaptText(""); setUseDialogOpen(true); }}
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

      {/* "Use this template" — pick use-as-is vs tune, then fork. */}
      <Dialog open={useDialogOpen} onOpenChange={setUseDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Use “{template?.name}”</DialogTitle>
            <DialogDescription>
              You'll get your own editable copy. Start from the demo as-is, or tell the
              AI how to adapt it and it'll get to work right away.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <button
              type="button"
              onClick={() => setUseMode("as-is")}
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                useMode === "as-is" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border/70 hover:border-border",
              )}
            >
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", useMode === "as-is" ? "border-primary" : "border-muted-foreground/50")}>
                {useMode === "as-is" && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span>
                <span className="block text-sm font-medium">Use this template as is</span>
                <span className="block text-xs text-muted-foreground">Clone it unchanged — you can ask for edits later.</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setUseMode("tune")}
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                useMode === "tune" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border/70 hover:border-border",
              )}
            >
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", useMode === "tune" ? "border-primary" : "border-muted-foreground/50")}>
                {useMode === "tune" && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">Tune this template for your use case</span>
                <span className="block text-xs text-muted-foreground">Describe what to adapt — industry, customer, data, capabilities, branding…</span>
              </span>
            </button>

            {useMode === "tune" && (
              <Textarea
                autoFocus
                value={adaptText}
                onChange={(e) => setAdaptText(e.target.value)}
                placeholder={'e.g. "Rebrand from LuxeBeauty to Acme Pharma, switch the story to medication returns, and drop the ML model."'}
                className="min-h-[110px] text-sm"
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setUseDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={confirmUseTemplate}
              disabled={useMode === "tune" && !adaptText.trim()}
            >
              <GitFork className="mr-2 h-4 w-4" />
              {useMode === "tune" ? "Create & adapt" : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function DiagramFallback() {
  return (
    <div className="flex h-[380px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export default TemplateGallerySheet;
