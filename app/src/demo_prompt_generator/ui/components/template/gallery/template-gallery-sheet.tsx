/**
 * Shared WIDE CENTERED MODAL showing a template's story, the solution
 * ARCHITECTURE (rendered read-only from architecture.md), the INCLUDED FILES
 * (tree + content viewer), and — when the demo is deployed in this app's
 * workspace (`detail.live_demo`) — a "Try it live" band with one button per
 * live asset (app, dashboard, Genie, pipeline, …).
 *
 * The content is organized into three tabs (Overview / Architecture / Files)
 * so a reader can click through a demo fast, and the header carries an
 * always-on animated "flow ribbon" (Data → Pipeline → Dashboard → Genie →
 * App/Agents) that lights up the stages this template actually builds — a
 * one-glance story of what the demo IS and why templates matter.
 *
 * Keyed off a template `id` (string) so any surface — the /templates list, the
 * home-page search results, the internal demos catalog — can open it without
 * needing a full list-item object. It fetches the full TemplateDetail + file
 * list on open and renders the header from that.
 *
 * The export name is kept as `TemplateGallerySheet` (and default) so existing
 * callers don't change — it's just a modal now, not a slide-over.
 *
 * "Use this template" forks AS-IS: the place to adapt a demo for your customer
 * is the "Make this demo yours" band on the forked project's overview
 * (StoryAdaptActions), so we don't ask for adaptation instructions here.
 */

import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Prose } from "@/components/markdown-prose";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  Download,
  Eye,
  FileText,
  Folder,
  GitFork,
  GraduationCap,
  Loader2,
  Network,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  AIBIBrandIcon,
  GenieBrandIcon,
  GenieOneBrandIcon,
  GenieCodeBrandIcon,
  DatabricksAppsBrandIcon,
  SDPBrandIcon,
  LakeflowConnectBrandIcon,
  LakeflowJobsBrandIcon,
  MultiAgentSupervisorIcon,
  KnowledgeAssistantIcon,
  AIFunctionsIcon,
  AIGatewayBrandIcon,
  MetricViewsIcon,
  NotebooksIcon,
  UnityCatalogBrandIcon,
  DeltaSharingIcon,
  VectorSearchBrandIcon,
  MLModelBrandIcon,
  LakebaseBrandIcon,
  DataIcon,
  InputDataIcon,
  UnstructuredDataIcon,
  BusinessUserIcon,
  ZerobusIcon,
  StreamingIcon,
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
} from "@/lib/custom-api";
import { LiveDemoPanel } from "./live-demo-panel";

// The read-only architecture preview reuses the full ReactFlow editor. Lazy so
// the heavy diagram chunk isn't pulled into the gallery's initial bundle.
const PlatformDiagram = lazy(() => import("@/components/project/platform-diagram"));

type ArchState = "idle" | "loading" | "ready" | "absent";
type TabKey = "overview" | "architecture" | "files";

// ────────────────────────────────────────────────────────────────────────────
// Product catalog — maps every capability id a template can carry to the
// Databricks PRODUCT it represents (proper name + brand icon), so the modal's
// "Products in this template" section shows real products, not prettified
// slugs. Coverage is exhaustive: every capability block id (under
// references/blocks/capabilities/) PLUS the extra ids templates use in
// resources.json (`databricks-one`) PLUS ingestion aliases
// (`zerobus`, `streaming`). Anything not mapped falls back to a titleized
// slug + a neutral icon, and we log it so the catalog can be extended.
// KA/MAS entries are legacy: existing templates still carry them.
//
// `order` groups products along the data journey (sources → pipeline →
// governance → BI → conversational → agents → app/serving) so the row reads
// left-to-right in a natural order.
// ────────────────────────────────────────────────────────────────────────────

interface ProductInfo {
  name: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  order: number;
}

const PRODUCT_CATALOG: Record<string, ProductInfo> = {
  // ── Ingestion / data (0–9) ────────────────────────────────────────────────
  "synthetic-data-gen": { name: "Synthetic Data Generation", icon: DataIcon, order: 0 },
  "lakeflow-connect": { name: "Lakeflow Connect", icon: LakeflowConnectBrandIcon, order: 1 },
  "zerobus-ingest": { name: "Zerobus Ingest", icon: ZerobusIcon, order: 2 },
  zerobus: { name: "Zerobus Ingest", icon: ZerobusIcon, order: 2 },
  streaming: { name: "Structured Streaming", icon: StreamingIcon, order: 3 },
  marketplace: { name: "Databricks Marketplace", icon: InputDataIcon, order: 4 },
  "delta-sharing": { name: "Delta Sharing", icon: DeltaSharingIcon, order: 5 },

  // ── Pipeline / transform (10–19) ───────────────────────────────────────────
  sdp: { name: "Spark Declarative Pipelines", icon: SDPBrandIcon, order: 10 },
  "lakeflow-jobs": { name: "Lakeflow Jobs", icon: LakeflowJobsBrandIcon, order: 11 },
  "ai-functions": { name: "AI Functions", icon: AIFunctionsIcon, order: 12 },
  "information-extraction": { name: "Information Extraction", icon: UnstructuredDataIcon, order: 13 },
  "notebooks-eda": { name: "Notebooks & EDA", icon: NotebooksIcon, order: 14 },

  // ── Governance (20–29) ─────────────────────────────────────────────────────
  "unity-catalog": { name: "Unity Catalog", icon: UnityCatalogBrandIcon, order: 20 },
  "metric-views": { name: "Metric Views", icon: MetricViewsIcon, order: 21 },
  abac: { name: "Attribute-Based Access Control", icon: UnityCatalogBrandIcon, order: 22 },
  "data-classification": { name: "Data Classification", icon: UnityCatalogBrandIcon, order: 23 },
  "data-quality": { name: "Data Quality Monitoring", icon: UnityCatalogBrandIcon, order: 24 },

  // ── BI / analytics (30–39) ─────────────────────────────────────────────────
  "aibi-dashboards": { name: "AI/BI Dashboards", icon: AIBIBrandIcon, order: 30 },

  // ── Conversational / Genie (40–49) ─────────────────────────────────────────
  genie: { name: "Genie", icon: GenieBrandIcon, order: 40 },
  "genie-one": { name: "Genie One", icon: GenieOneBrandIcon, order: 41 },
  "genie-code": { name: "Genie Code", icon: GenieCodeBrandIcon, order: 42 },

  // ── Agents / AI (50–59) ────────────────────────────────────────────────────
  "unstructured-documents": { name: "Unstructured Documents (PDF)", icon: UnstructuredDataIcon, order: 50 },
  // Legacy KA/MAS: deprecated for new projects, kept so existing templates still render.
  "knowledge-assistant": { name: "Knowledge Assistant", icon: KnowledgeAssistantIcon, order: 51 },
  "supervisor-agent": { name: "Supervisor Agent", icon: MultiAgentSupervisorIcon, order: 52 },
  "vector-search": { name: "Vector Search", icon: VectorSearchBrandIcon, order: 53 },
  "ai-gateway": { name: "AI Gateway", icon: AIGatewayBrandIcon, order: 54 },
  "ml-training-serving": { name: "ML Training & Serving", icon: MLModelBrandIcon, order: 55 },

  // ── App / serving surface (60–69) ──────────────────────────────────────────
  lakebase: { name: "Lakebase", icon: LakebaseBrandIcon, order: 60 },
  "databricks-apps": { name: "Databricks Apps", icon: DatabricksAppsBrandIcon, order: 61 },
  "databricks-one": { name: "Databricks One", icon: BusinessUserIcon, order: 62 },
};

/** Titleize an unknown capability slug for the fallback label. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Resolve a template's capability id list to the ordered, de-duplicated set of
 *  PRODUCTS it's built from. Unknown ids get a titleized fallback (+ a dev
 *  warning) so nothing silently disappears — coverage stays honest. */
function resolveProducts(
  capabilities: string[] | null | undefined,
): Array<{ id: string } & ProductInfo> {
  if (!capabilities || capabilities.length === 0) return [];
  const seenNames = new Set<string>();
  const out: Array<{ id: string } & ProductInfo> = [];
  for (const id of capabilities) {
    const info =
      PRODUCT_CATALOG[id] ??
      (() => {
        if (import.meta.env.DEV) {
          console.warn(`[template modal] no product mapping for capability "${id}" — using fallback`);
        }
        return { name: titleizeSlug(id), icon: DataIcon, order: 999 };
      })();
    // De-dupe by product NAME (several ids can map to the same product, e.g.
    // zerobus / zerobus-ingest) so a product shows at most once.
    if (seenNames.has(info.name)) continue;
    seenNames.add(info.name);
    out.push({ id, ...info });
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function TemplateGallerySheet({
  templateId,
  onClose,
  onFork,
  workshopDownloadOnly = false,
  isAdmin = false,
  onStatusChange,
  onToggleOfficial,
  onDelete,
}: {
  /** null → closed. Keyed off the id so any caller can open it. */
  templateId: string | null;
  onClose: () => void;
  /** Fork into a new project (as-is — adapt happens post-fork on the overview). */
  onFork?: (t: TemplateDetail) => void;
  /** On the workshop landing (/templates?type=WORKSHOP) a workshop's footer is
   *  download-only — the "Use this template" fork dropdown is hidden. Workshops
   *  opened from any other view keep the fork option. No effect on non-workshops. */
  workshopDownloadOnly?: boolean;
  /** Admin controls (approve/reject, feature, delete) render only when true. */
  isAdmin?: boolean;
  /** Set the template's status (APPROVED / REJECTED). Parent refreshes its list. */
  onStatusChange?: (id: string, status: "APPROVED" | "REJECTED") => Promise<void>;
  /** Toggle the featured/official flag. Parent refreshes its list. */
  onToggleOfficial?: (id: string, official: boolean) => Promise<void>;
  /** Delete the template. Parent refreshes its list; sheet closes on success. */
  onDelete?: (id: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [archMd, setArchMd] = useState<string | null>(null);
  const [archState, setArchState] = useState<ArchState>("idle");
  const [isDownloading, setIsDownloading] = useState(false);
  // Workshop download takeover: on "Download a copy of this workshop" the whole
  // sheet swaps to a preparing → done flow (import + Genie-Code instructions).
  const [workshopFlow, setWorkshopFlow] = useState<"idle" | "preparing" | "done">("idle");
  const [tab, setTab] = useState<TabKey>("overview");
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

  // Included files (tree + content viewer).
  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const isMarkdownFile = selectedFile?.endsWith(".md") ?? false;

  // Admin action state (approve/reject, feature toggle, delete confirm).
  const [adminBusy, setAdminBusy] = useState<null | "status" | "official" | "delete">(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleStatusChange = async (status: "APPROVED" | "REJECTED") => {
    if (!templateId || !onStatusChange) return;
    setAdminBusy("status");
    try {
      await onStatusChange(templateId, status);
      // Reflect the new status locally so the header badge + fork button update.
      setDetail((prev) => (prev ? { ...prev, status } : prev));
    } catch (e) {
      console.error("Failed to change template status:", e);
    } finally {
      setAdminBusy(null);
    }
  };

  const handleToggleOfficial = async () => {
    if (!templateId || !onToggleOfficial || !detail) return;
    const next = !(detail.official === true);
    setAdminBusy("official");
    try {
      await onToggleOfficial(templateId, next);
      setDetail((prev) => (prev ? { ...prev, official: next } : prev));
    } catch (e) {
      console.error("Failed to toggle featured:", e);
    } finally {
      setAdminBusy(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!templateId || !onDelete) return;
    setAdminBusy("delete");
    try {
      await onDelete(templateId);
      setDeleteConfirmOpen(false);
      onClose(); // template's gone — close the modal
    } catch (e) {
      console.error("Failed to delete template:", e);
    } finally {
      setAdminBusy(null);
    }
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

  // Workshop-only: take over the whole sheet with a "getting it ready" state,
  // trigger the same zip export, then show import + Genie-Code instructions.
  const handleDownloadWorkshop = async () => {
    if (!templateId) return;
    setWorkshopFlow("preparing");
    try {
      await exportTemplate(templateId);
      setWorkshopFlow("done");
    } catch (e) {
      console.error("Failed to download workshop:", e);
      setWorkshopFlow("idle"); // fall back to the normal sheet on failure
    }
  };

  useEffect(() => {
    if (!templateId) {
      setDetail(null);
      setArchMd(null);
      setArchState("idle");
      setWorkshopFlow("idle");
      setFiles([]);
      setSelectedFile(null);
      setFileContent("");
      setShowRaw(false);
      setShotIndex(0);
      setTab("overview");
      return;
    }

    setIsLoading(true);
    setDetail(null);
    setArchMd(null);
    setArchState("loading");
    setFiles([]);
    setSelectedFile(null);
    setFileContent("");
    setShotIndex(0);
    setTab("overview");

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
  // Files tab is open).
  useEffect(() => {
    if (!templateId || !selectedFile || tab !== "files") {
      return;
    }
    setIsLoadingFile(true);
    getTemplateFileContent(templateId, selectedFile)
      .then((data) => setFileContent(data.content))
      .catch(() => setFileContent("// Failed to load file content"))
      .finally(() => setIsLoadingFile(false));
  }, [templateId, selectedFile, tab]);

  const isApproved = detail?.status === "APPROVED";
  // Workshop templates get a download-primary split-button (Download +
  // fork-in-dropdown) instead of the standard side-by-side Download DAB + "Use
  // this template". On the workshop landing (workshopDownloadOnly) the dropdown
  // is dropped, leaving download as the only action.
  const isWorkshop = detail?.template_type === "WORKSHOP";
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const hasArch = archState !== "absent";
  // The Databricks products this template is actually built from (resolved from
  // its capability ids), ordered along the data journey.
  const products = useMemo(() => resolveProducts(detail?.capabilities), [detail?.capabilities]);

  return (
    <>
    <DialogPrimitive.Root open={templateId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 flex w-[95vw] max-w-[1100px] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl duration-200",
            "h-[88vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Radix requires an accessible title + description even when we
              render our own header. */}
          <DialogPrimitive.Title className="sr-only">
            {detail?.name ?? "Template details"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {detail?.narrative ??
              detail?.description ??
              "Template details: story, architecture, and included files."}
          </DialogPrimitive.Description>

          {/* While the detail is loading, show ONE big centered spinner instead
              of the half-built chrome (tabs/buttons that pop in piecemeal). */}
          {templateId && (isLoading || !detail) && (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 opacity-60 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading template…</p>
            </div>
          )}

          {/* ── Workshop download takeover — replaces the whole sheet ──────── */}
          {templateId && !isLoading && detail && workshopFlow !== "idle" && (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 opacity-60 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>

              {workshopFlow === "preparing" ? (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-base font-medium">Getting the workshop ready for you…</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Packaging {detail.name} — the data generator, specs, and bootstrap app — into a
                    zip you can import into your workspace.
                  </p>
                </div>
              ) : (
                <div className="flex max-w-lg flex-col items-center gap-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                    <Check className="h-6 w-6" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">Your workshop is downloaded 🎉</h3>
                    <p className="text-sm text-muted-foreground">
                      Import the zip into your Databricks workspace, then open a{" "}
                      <span className="font-medium text-foreground">Genie Code</span> session in the
                      folder and let it build the workshop with you — start from the kickoff prompt in
                      the README and work through the milestones.
                    </p>
                  </div>

                  <div className="w-full rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-left text-[13px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-semibold">Tip:</span> for the app, reach for your favorite
                    coding harness to build it now — the Genie App Builder is coming soon.
                  </div>

                  <div className="w-full rounded-lg border bg-muted/30 px-4 py-3 text-left text-[13px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Why build it yourself?</span> Yes,
                    Solution Builder could one-shot most of this template — but the whole point of the
                    workshop is <em>you</em> learning to drive Genie Code and seeing how these
                    components fit together under the hood.
                  </div>

                  <DialogPrimitive.Close asChild>
                    <Button variant="outline" className="mt-1">Done</Button>
                  </DialogPrimitive.Close>
                </div>
              )}
            </div>
          )}

          {templateId && !isLoading && detail && workshopFlow === "idle" && (
            <div className="flex h-full min-h-0 flex-col">
              {/* ── Header: badges + title + one-line summary ────────────────── */}
              <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/40 to-background px-6 pb-5 pt-6">
                <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 opacity-60 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>

                <div className="flex flex-wrap items-center gap-2 pr-10">
                  {detail?.official === true && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow">
                      <Sparkles className="h-3 w-3" /> Featured
                    </span>
                  )}
                  {detail?.industry && (
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      {detail.industry}
                    </Badge>
                  )}
                  {detail?.status && detail.status !== "APPROVED" && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        detail.status === "REJECTED"
                          ? "bg-destructive text-destructive-foreground"
                          : "bg-amber-500 text-white",
                      )}
                    >
                      {detail.status === "REJECTED" ? "Rejected" : "Pending review"}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">
                  {detail?.name ?? "Loading…"}
                </h2>
                {/* Short description as a header subtitle — only when there's a
                    narrative below to carry the full story. Without a narrative
                    the full description is shown in the Overview body instead (so
                    it's never truncated with no way to read the rest). */}
                {detail?.description && detail?.narrative && (
                  <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {detail.description}
                  </p>
                )}
                {/* Deployed in this workspace → one-click access to every live asset.
                    In the header so it's visible from every tab. */}
                {detail?.live_demo && <LiveDemoPanel live={detail.live_demo} className="mt-4" />}
              </div>

              {/* ── Tabs ─────────────────────────────────────────────────────── */}
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as TabKey)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="shrink-0 border-b bg-muted/10 px-6 py-2">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="architecture" disabled={!hasArch}>
                      <Network className="mr-1.5 h-3.5 w-3.5" />
                      Architecture
                    </TabsTrigger>
                    <TabsTrigger value="files" disabled={files.length === 0}>
                      <Folder className="mr-1.5 h-3.5 w-3.5" />
                      Files
                      {files.length > 0 && (
                        <span className="ml-1 font-normal opacity-70">({files.length})</span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Overview */}
                <TabsContent
                  value="overview"
                  className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
                >
                  <ScrollArea className="h-full">
                    <div className="w-full space-y-6 px-6 py-6">
                      {/* Workshop note — a template that isn't a full SOLUTION is a
                          starting point the trainee builds out, so set expectations
                          right above the story. */}
                      {(detail?.template_type === "WORKSHOP" ||
                        detail?.template_type === "GENIE_WORKSHOP") && (
                        <div className="flex items-start gap-2.5 rounded-lg border-l-2 border-amber-500 bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            <span className="font-semibold">Workshop template.</span>{" "}
                            This is a hands-on training starting point — it ships the data
                            generator, specs, and a bootstrap app, and <em>you build</em> the
                            solution across the milestones. Not everything is pre-implemented.
                            <span className="mt-1.5 block">
                              <span className="font-semibold">How to start:</span> download
                              this project, import it into your Databricks workspace, and have
                              Genie Code build the solution with you.
                            </span>
                          </span>
                        </div>
                      )}
                      {/* Narrative — the story summary, at the very top. */}
                      {detail?.narrative && (
                        <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/90">
                          {detail.narrative}
                        </p>
                      )}

                      {/* No narrative → the full description is the overview text
                          (the header omits it in this case to avoid truncation). */}
                      {!detail?.narrative && detail?.description && (
                        <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/90">
                          {detail.description}
                        </p>
                      )}

                      {/* Screenshot(s) — hero, or a small carousel when there are extras. */}
                      {detail && (detail.screenshot_count ?? 0) > 0 && (() => {
                        const count = detail.screenshot_count ?? 0;
                        const idx = Math.min(shotIndex, count - 1);
                        return (
                          <div className="space-y-2">
                            <div className="relative overflow-hidden rounded-xl border bg-muted/30 shadow-sm">
                              <img
                                src={
                                  idx === 0
                                    ? templateScreenshotUrl(detail.id)
                                    : templateScreenshotAtUrl(detail.id, idx)
                                }
                                alt={`${detail.name} screenshot ${idx + 1}`}
                                loading="lazy"
                                className="mx-auto max-h-[440px] w-full object-contain"
                              />
                              {count > 1 && (
                                <>
                                  <button
                                    type="button"
                                    aria-label="Previous screenshot"
                                    onClick={() => setShotIndex((i) => (i - 1 + count) % count)}
                                    className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-background cursor-pointer"
                                  >
                                    <ChevronLeft className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Next screenshot"
                                    onClick={() => setShotIndex((i) => (i + 1) % count)}
                                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-background cursor-pointer"
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

                      {/* Products — the Databricks products this template is
                          built from (resolved from its capability ids). Only
                          the products that make up THIS demo, in flow order. */}
                      {products.length > 0 && (
                        <section className="space-y-2">
                          <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            Products in this template
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {products.map((p) => {
                              const Icon = p.icon;
                              return (
                                <span
                                  key={p.id}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[12px] font-medium text-foreground/85"
                                >
                                  <Icon className="h-3.5 w-3.5 shrink-0" />
                                  {p.name}
                                </span>
                              );
                            })}
                          </div>
                        </section>
                      )}

                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Architecture */}
                <TabsContent
                  value="architecture"
                  className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
                >
                  <div className="h-full p-4">
                    <div className="h-full overflow-hidden rounded-xl border bg-card">
                      {archState === "ready" && archMd ? (
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
                      ) : (
                        <DiagramFallback />
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* Files */}
                <TabsContent
                  value="files"
                  className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
                >
                  <div className="flex h-full min-h-0">
                    {/* File tree sidebar */}
                    <div className="flex w-[260px] shrink-0 flex-col border-r">
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
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-sm text-muted-foreground">
                            {selectedFile ?? "Select a file"}
                          </span>
                          {isLoadingFile && (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        {isMarkdownFile && (
                          <div className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-0.5">
                            <Button
                              variant={!showRaw ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => setShowRaw(false)}
                              className="h-7 gap-1 px-2"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span className="text-xs">Preview</span>
                            </Button>
                            <Button
                              variant={showRaw ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => setShowRaw(true)}
                              className="h-7 gap-1 px-2"
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
                            <pre className="whitespace-pre-wrap break-words font-mono text-sm">
                              {fileContent}
                            </pre>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Admin action bar — status, feature toggle, delete. */}
              {isAdmin && (onStatusChange || onToggleOfficial || onDelete) && (
                <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-6 py-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Admin
                  </span>
                  <Badge
                    variant={detail?.status === "APPROVED" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {detail?.status === "REVIEW_REQUESTED"
                      ? "Pending review"
                      : (detail?.status ?? "").toLowerCase() || "—"}
                  </Badge>

                  {/* Approve / Reject */}
                  {onStatusChange && detail && detail.status !== "APPROVED" && (
                    <Button
                      size="sm"
                      className="h-7 bg-green-600 text-white hover:bg-green-700"
                      onClick={() => handleStatusChange("APPROVED")}
                      disabled={adminBusy !== null}
                    >
                      {adminBusy === "status" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Approve
                    </Button>
                  )}
                  {onStatusChange && detail && detail.status !== "REJECTED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => handleStatusChange("REJECTED")}
                      disabled={adminBusy !== null}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Reject
                    </Button>
                  )}

                  {/* Featured / official toggle */}
                  {onToggleOfficial && detail && (
                    <Button
                      size="sm"
                      variant={detail.official === true ? "default" : "outline"}
                      className={cn(
                        "h-7",
                        detail.official === true &&
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                      onClick={handleToggleOfficial}
                      disabled={adminBusy !== null}
                      title={
                        detail.official === true
                          ? "Remove the Featured flag"
                          : "Mark as Featured (surfaces on the home carousel + internal demos)"
                      }
                    >
                      {adminBusy === "official" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {detail.official === true ? "Featured" : "Make featured"}
                    </Button>
                  )}

                  {/* Delete (with confirm popup) */}
                  {onDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteConfirmOpen(true)}
                      disabled={adminBusy !== null}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  )}
                </div>
              )}

              {/* Footer — download the DAB + (optional) fork.
                  Workshops collapse to ONE split-button on the right: primary =
                  "Download a copy of this workshop", chevron dropdown = "Use this
                  template" (fork). On the workshop landing (workshopDownloadOnly)
                  the dropdown is dropped → download-only. Non-workshops keep the
                  side-by-side layout. */}
              <div className="flex shrink-0 items-center gap-3 border-t bg-muted/10 px-6 py-4">
                {isWorkshop ? (
                  <div className="ml-auto inline-flex items-center">
                    {/* Primary: download the workshop → full-sheet takeover flow.
                        On the workshop landing (?type=WORKSHOP) this is the ONLY
                        action — the point of that view is building it yourself
                        from the downloaded copy. Elsewhere it keeps the fork
                        dropdown. */}
                    <Button
                      onClick={handleDownloadWorkshop}
                      disabled={isLoading || !detail}
                      title="Download this workshop as a zip you can import into your workspace"
                      className={onFork && !workshopDownloadOnly ? "rounded-r-none" : undefined}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download a copy of this workshop
                    </Button>
                    {/* Secondary (dropdown): fork into an editable project.
                        Hidden on the workshop landing. */}
                    {onFork && !workshopDownloadOnly && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            className="rounded-l-none border-l border-primary-foreground/20 px-2"
                            disabled={isLoading || !detail}
                            title="More options"
                            aria-label="More options"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => detail && onFork(detail)}
                            disabled={isLoading || !detail || !isApproved}
                          >
                            {!isApproved && detail ? (
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
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                ) : (
                  <>
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
                      <div className="ml-auto flex items-center gap-3">
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          or get a private editable copy
                        </span>
                        <Button
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
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>

    <ConfirmDialog
      open={deleteConfirmOpen}
      onOpenChange={(o) => { if (!adminBusy) setDeleteConfirmOpen(o); }}
      title="Delete this template?"
      description={
        <>
          <span className="font-medium text-foreground">{detail?.name}</span> and all
          its files will be permanently removed. This can't be undone.
        </>
      }
      confirmLabel="Delete"
      destructive
      loading={adminBusy === "delete"}
      onConfirm={handleDeleteConfirmed}
    />
    </>
  );
}

function DiagramFallback() {
  return (
    <div className="flex h-full min-h-[300px] items-center justify-center">
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
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted/50 cursor-pointer"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
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
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted/50 cursor-pointer",
        isSelected && "bg-primary/10 text-primary",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default TemplateGallerySheet;
