/**
 * Shared WIDE CENTERED MODAL showing a template's story, the solution
 * ARCHITECTURE (rendered read-only from architecture.md), the INCLUDED FILES
 * (tree + content viewer), and — when the internal gallery passes `links` —
 * the live-resource buttons (Dashboard / Ask Genie / Open App / Data).
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Prose } from "@/components/markdown-prose";
import {
  Check,
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
  AgentsIcon,
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
  type DemoResourceLinks,
} from "@/lib/custom-api";

// The read-only architecture preview reuses the full ReactFlow editor. Lazy so
// the heavy diagram chunk isn't pulled into the gallery's initial bundle.
const PlatformDiagram = lazy(() => import("@/components/project/platform-diagram"));

type ArchState = "idle" | "loading" | "ready" | "absent";
type TabKey = "overview" | "architecture" | "files";

// ────────────────────────────────────────────────────────────────────────────
// Product catalog — maps every capability id a template can carry to the
// Databricks PRODUCT it represents (proper name + brand icon), so the modal's
// "Products in this template" section shows real products, not prettified
// slugs. Coverage is exhaustive: every capability block id (the 26 under
// references/blocks/capabilities/) PLUS the extra ids templates use in
// resources.json (`agent-bricks`, `databricks-one`) PLUS ingestion aliases
// (`zerobus`, `streaming`). Anything not mapped falls back to a titleized
// slug + a neutral icon, and we log it so the catalog can be extended.
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
  "agent-bricks": { name: "Agent Bricks", icon: AgentsIcon, order: 50 },
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
  isAdmin = false,
  onStatusChange,
  onToggleOfficial,
  onDelete,
}: {
  /** null → closed. Keyed off the id so any caller can open it. */
  templateId: string | null;
  onClose: () => void;
  links?: DemoResourceLinks;
  /** Fork into a new project (as-is — adapt happens post-fork on the overview). */
  onFork?: (t: TemplateDetail) => void;
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

  useEffect(() => {
    if (!templateId) {
      setDetail(null);
      setArchMd(null);
      setArchState("idle");
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

          {templateId && (
            <div className="flex h-full min-h-0 flex-col">
              {/* ── Header: industry + title ─────────────────────────────────── */}
              <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/40 to-background px-6 pb-4 pt-5">
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
                </div>
                <h2 className="mt-1.5 text-xl font-semibold leading-tight">
                  {detail?.name ?? "Loading…"}
                </h2>
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
                    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
                      {/* Narrative — the story summary, at the very top. */}
                      {detail?.narrative && (
                        <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/90">
                          {detail.narrative}
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
                                className="w-full object-contain"
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

                      {/* Description — fallback Overview only when there's no narrative. */}
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

                      {/* Quick jumps to the other tabs so the story keeps moving. */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {hasArch && (
                          <button
                            type="button"
                            onClick={() => setTab("architecture")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[13px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary cursor-pointer"
                          >
                            <Network className="h-3.5 w-3.5" /> View architecture
                            <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                          </button>
                        )}
                        {files.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setTab("files")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[13px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary cursor-pointer"
                          >
                            <Folder className="h-3.5 w-3.5" /> Browse {files.length} files
                            <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                          </button>
                        )}
                      </div>
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

              {/* Footer — download the DAB + (optional) fork */}
              <div className="flex shrink-0 items-center gap-3 border-t bg-muted/10 px-6 py-4">
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
