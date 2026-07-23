/**
 * ProjectOverview — the project's landing page.
 *
 * Designed around three jobs a glance has to do:
 *   1. Tell me what this demo is about       (Hero — LLM-generated narrative)
 *   2. Tell me if it's ready to show         (Status card — count + ETA + live)
 *   3. Tell me what's in it                  (Resource grid — one tile per
 *                                              Databricks capability)
 *
 * Typography rhythm:
 *   eyebrow  → 11px bold uppercase, tracked, muted          (section labels)
 *   body     → 15px/1.6, foreground 90%                     (narrative + tiles)
 *   numbers  → 32-40px tabular, foreground                  (status headline)
 *
 * Color rhythm:
 *   slate    → containers + body text
 *   primary  → one accent (CTAs, building progress, hero glow)
 *   emerald  → "ready" / live signals only
 *   amber    → "planning" / drafting signals only
 *
 * Live tiles are clickable; pending tiles stay legible but quiet. We
 * never use dashed borders to mean "pending" — that reads as broken.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  ExternalLink,
  ChevronRight,
  Loader2,
  Clock,
  BookOpen,
  Network,
  RefreshCw,
  MessageSquare,
  Play,
  Maximize2,
  Check,
} from "lucide-react";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { DATABRICKS_ICONS } from "../databricks-icons";
import { TIER_CONFIG, type TierType } from "@/lib/architecture-schema";
import {
  CAPABILITY_META,
  type CapabilityGroup,
  type CapabilityMeta,
} from "@/lib/capabilities";
import { estimateBuild, formatMinutes, formatElapsed, elapsedMinutes } from "@/lib/build-eta";
import type { CapabilityBuildStatus, DeployedResourceLink, ProjectFile, Project } from "@/lib/custom-api";
import { BrandCard } from "./brand-card";
import { detectStageFromFiles, getLifecycleStages } from "./build-stepper";
import { cn } from "@/lib/utils";
import { useAppPreview } from "../../preview";
import { StoryAdaptActions, type StoryAdaptMode } from "./story-adapt-dialog";

// ---------------------------------------------------------------------------
// Capability → display group mapping (kept stable across the redesign).
// ---------------------------------------------------------------------------

type DisplayGroup =
  | "Data Pipelines"
  | "AI"
  | "Data Analysis"
  | "Analyst Layer"
  | "Foundation";

const SOURCE_TO_DISPLAY: Record<CapabilityGroup, DisplayGroup> = {
  "Data Ingestion": "Data Pipelines",
  "Data Processing": "Data Pipelines",
  "AI": "AI",
  "Data Analysis": "Data Analysis",
  "Analyst Layer": "Analyst Layer",
  "Foundation": "Foundation",
};

/**
 * Per-capability tier override — colors each capability tile by tier so a
 * Knowledge Assistant tile reads as indigo, a dashboard as pink, etc.,
 * consistent with the rest of the app. Tier colors come from `TIER_CONFIG`
 * in architecture-schema.ts.
 *
 * Falls back to `CAPABILITY_GROUP_TIER` (group default) for slugs that
 * don't appear here — keeps new capabilities working without an edit.
 */
const CAPABILITY_TIER: Partial<Record<string, TierType>> = {
  // ── Data Ingestion / Processing ─────────────────────────────────────
  "sdp": "sdp",
  "lakeflow-connect": "ingest",
  "lakeflow-jobs": "orchestration",
  "zerobus-ingest": "ingest",
  "delta-sharing": "ingest",
  "marketplace": "ingest",
  "synthetic-data-gen": "ingest",
  "ai-functions": "ai",
  "metric-views": "analytics",

  // ── AI ──────────────────────────────────────────────────────────────
  // Every interactive AI capability in the diagram lives in the indigo
  // "ai" tier — KA, Genie, MAS all read the same.
  "knowledge-assistant": "ai",
  "supervisor-agent": "ai",
  "ml-training-serving": "ai",
  "vector-search": "ai",
  "information-extraction": "ai",
  "ai-gateway": "ai",
  "genie": "ai",
  "genie-code": "ai",

  // ── Data Analysis ───────────────────────────────────────────────────
  "aibi-dashboards": "analytics",
  "notebooks-eda": "analytics",

  // ── Analyst Layer / Interface ───────────────────────────────────────
  // Apps + Databricks One are interface-tier (rose) in the schema.
  "databricks-apps": "interface",
  "genie-one": "interface",
  // Lakebase is an OLTP datastore — typically rendered in the ingest tier.
  "lakebase": "ingest",

  // ── Foundation / Governance ─────────────────────────────────────────
  // Match the governance bar slate; the previous "ingest blue" override
  // looked nice in isolation but didn't match the diagram.
  "unity-catalog": "governance",
  "data-quality": "governance",
  "abac": "governance",
  "data-classification": "governance",
};

/** Last-resort fallback when a capability has no explicit CAPABILITY_TIER
 *  entry. Same group-based defaults the previous version used. */
const CAPABILITY_GROUP_TIER: Record<DisplayGroup, TierType> = {
  "Data Pipelines": "sdp",
  "AI": "ai",
  "Data Analysis": "analytics",
  "Analyst Layer": "interface",
  "Foundation": "governance",
};

function tierForWidget(widget: Widget): TierType {
  return CAPABILITY_TIER[widget.slug] ?? CAPABILITY_GROUP_TIER[widget.group];
}

/** Slugs that ship without a useful "live" signal AND don't make sense
 *  as user-facing resource tiles. Keep in sync with build-eta.ts. */
const HIDDEN_SLUGS = new Set(["synthetic-data-gen", "genie-one", "genie-code"]);

type WidgetState = "pending" | "live";

interface Widget {
  slug: string;
  meta: CapabilityMeta;
  group: DisplayGroup;
  state: WidgetState;
  url?: string;
}

function buildWidgets(
  buildable: string[],
  deployed: DeployedResourceLink[],
  /** Authoritative per-capability build status from the backend
   *  (`DeployedResources.capabilities`). When present it drives BOTH which
   *  tiles exist and their live/pending state — the backend already omits
   *  non-buildable / talking-track slugs. Each tile's deep-link URL (if any)
   *  still comes from the matching `DeployedResourceLink`; a built resource
   *  with no URL renders live but non-clickable (e.g. a preview-only app or a
   *  Lakebase DB with no recorded id). Absent on legacy payloads → fall back
   *  to the old `buildable` + URL-inference path. */
  capabilities?: CapabilityBuildStatus[],
): Widget[] {
  const byType = new Map<string, DeployedResourceLink>();
  for (const r of deployed) byType.set(r.resource_type, r);

  /** Resolve a capability's deep-link URL from the deployed links, if one
   *  exists for its `deployed_type`. Independent of readiness. */
  const urlFor = (meta: CapabilityMeta): string | undefined => {
    if (!meta.deployed_type) return undefined;
    const types = Array.isArray(meta.deployed_type) ? meta.deployed_type : [meta.deployed_type];
    for (const t of types) {
      const hit = byType.get(t);
      if (hit?.url) return hit.url;
    }
    return undefined;
  };

  const seen = new Set<string>();
  const widgets: Widget[] = [];

  // Preferred path: render exactly the capabilities the backend reports (built
  // or pending), reading readiness from `built` — NOT from URL presence.
  const source: Array<{ slug: string; built?: boolean }> =
    capabilities && capabilities.length > 0
      ? capabilities
      : buildable
          .filter((slug) => !HIDDEN_SLUGS.has(slug) && CAPABILITY_META[slug]?.deployed_type)
          .map((slug) => ({ slug, built: undefined }));

  for (const entry of source) {
    const slug = entry.slug;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const meta = CAPABILITY_META[slug];
    if (!meta) continue;
    const group = SOURCE_TO_DISPLAY[meta.group];
    const url = urlFor(meta);
    // `built` from the backend when present; else (legacy) infer from a URL.
    const isLive = entry.built !== undefined ? entry.built : !!url;
    widgets.push({ slug, meta, group, state: isLive ? "live" : "pending", url });
  }

  // Sort: live first (descending by group order so the rendering reads
  // top-down "what's done"), pending after.
  const groupOrder: DisplayGroup[] = [
    "Data Pipelines",
    "AI",
    "Data Analysis",
    "Analyst Layer",
    "Foundation",
  ];
  widgets.sort((a, b) => {
    if (a.state !== b.state) return a.state === "live" ? -1 : 1;
    return groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);
  });

  return widgets;
}

// ===========================================================================
// Resource tile — one Databricks capability. The eyebrow group label sits
// inside the tile (rather than as a column header) so the tile is self-
// describing and the grid stays clean.
// ===========================================================================

const ResourceTile = memo(function ResourceTile({ widget }: { widget: Widget }) {
  const tier = tierForWidget(widget);
  const cfg = TIER_CONFIG[tier];
  const Icon = DATABRICKS_ICONS[widget.meta.icon];
  const isLive = widget.state === "live";

  // Live tiles inherit the tier palette directly from the architecture
  // diagram (TIER_CONFIG.bg + TIER_CONFIG.border), so the same capability
  // reads as the same color whether you're looking at the marketecture
  // grid or the architecture diagram. Pending tiles go fully grayscale so
  // the live/pending distinction is unmistakable at a glance.
  const inner = (
    <div
      className={cn(
        "group relative h-full rounded-xl border transition-all",
        isLive
          ? cn(
              cfg.bg,
              cfg.border,
              "hover:-translate-y-px hover:shadow-[0_4px_20px_-8px_rgba(0,0,0,0.15)]",
            )
          : "bg-muted/30 border-border/40",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div
          className={cn(
            "shrink-0 flex items-center justify-center h-10 w-10 rounded-lg",
            isLive ? cn(cfg.bg, "border", cfg.border) : "bg-muted/60 border border-border/40",
          )}
        >
          <Icon
            className={cn(
              "h-[22px] w-[22px]",
              isLive ? cfg.color : "text-muted-foreground/50",
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "text-[13.5px] font-semibold leading-tight",
              isLive ? "text-foreground" : "text-muted-foreground/80",
            )}
          >
            {widget.meta.display}
          </div>
          <div className="mt-1 text-[11.5px]">
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground/60">
                <Clock className="h-3 w-3" />
                Not built yet
              </span>
            )}
          </div>
        </div>
        {isLive && widget.url && (
          <span
            className="shrink-0 inline-flex items-center gap-1 self-center px-2 py-1 rounded-md text-[11px] font-semibold tracking-wide text-white shadow-sm transition-transform group-hover:scale-[1.05]"
            style={{ backgroundColor: cfg.stripe }}
            aria-hidden
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );

  if (isLive && widget.url) {
    return (
      <a
        href={widget.url}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline block h-full"
        title={`${widget.meta.display} — open in workspace`}
      >
        {inner}
      </a>
    );
  }
  return <div className="h-full">{inner}</div>;
});

// ---------------------------------------------------------------------------
// Resource column — one display group's worth of tiles, with a colored
// eyebrow header. Color comes from the dominant tier in that column
// (most tiles share it within a group), so the column header signals
// what kind of capabilities live underneath.
// ---------------------------------------------------------------------------

const ResourceColumn = memo(function ResourceColumn({
  group,
  widgets,
}: {
  group: DisplayGroup;
  widgets: Widget[];
}) {
  // Tint the column header with the tier of the first tile in the
  // column — within a group, tiles overwhelmingly share a tier.
  const tier = widgets.length > 0 ? tierForWidget(widgets[0]) : "ingest";
  const cfg = TIER_CONFIG[tier];
  return (
    <div className="flex flex-col h-full">
      <div
        className={cn(
          "text-[10px] font-bold uppercase tracking-[0.14em] pb-2 mb-2.5 border-b-2",
          cfg.color,
        )}
        style={{ borderColor: cfg.stripe }}
      >
        {group}
      </div>
      <div className="flex flex-col gap-2.5">
        {widgets.map((w) => (
          <ResourceTile key={w.slug} widget={w} />
        ))}
      </div>
    </div>
  );
});

// ===========================================================================
// Header status pill — compact "Building 4/5" / "Ready" / "Drafting"
// chip designed to live next to the project title. Click opens the chat
// panel where live agent reasoning is visible.
// ===========================================================================

export interface HeaderStatusPillProps {
  buildable: string[];
  deployed: DeployedResourceLink[];
  hasStarted: boolean;
  isStreaming: boolean;
  /** Authoritative per-capability build status from the backend. Drives
   *  readiness + the N/N count; when all are built the pill reads "Ready"
   *  regardless of deep-link URLs, and a later chat turn can't revert it. */
  capabilities?: CapabilityBuildStatus[];
  onClick?: () => void;
}

export const HeaderStatusPill = memo(function HeaderStatusPill({
  buildable,
  deployed,
  hasStarted,
  isStreaming,
  capabilities,
  onClick,
}: HeaderStatusPillProps) {
  const est = useMemo(
    () => estimateBuild(buildable, deployed, hasStarted, capabilities),
    [buildable, deployed, hasStarted, capabilities],
  );

  // "ready" now comes from the backend's per-capability status (all built),
  // so it's stable across later chat turns and doesn't depend on deep-links.
  const isReady = est.phase === "ready";
  // "Building" = work is actively happening (agent streaming). If the
  // phase says "building" but nothing is streaming, the agent stopped
  // partway through — that's "In progress", not "Building".
  const isBuilding = isStreaming && !isReady && est.phase !== "idle";
  const isInProgress = !isBuilding && !isReady && est.phase === "building";
  const isDrafting = est.phase === "idle" && !isBuilding;
  const isPlanning = est.phase === "planning" && !isBuilding;

  const phaseLabel = isReady
    ? "Ready"
    : isBuilding
      ? "Building"
      : isInProgress
        ? "In progress"
        : isPlanning
          ? "Planning"
          : "Drafting";

  // Color palette — uses the shared TIER vocabulary so status reads as the
  // same accent everywhere.
  const palette = isReady
    ? {
        bg: "bg-emerald-500/[0.10]",
        border: "border-emerald-500/30",
        dot: "bg-emerald-500",
        text: "text-emerald-700 dark:text-emerald-400",
      }
    : isBuilding
      ? {
          bg: "bg-primary/10",
          border: "border-primary/30",
          dot: "bg-primary",
          text: "text-primary",
        }
      : isInProgress
        ? {
            // Partial progress, agent paused — muted slate so it doesn't
            // pretend to be live, but still distinct from "drafting".
            bg: "bg-slate-500/[0.10]",
            border: "border-slate-500/30",
            dot: "bg-slate-500",
            text: "text-slate-700 dark:text-slate-300",
          }
        : {
            bg: "bg-amber-500/[0.10]",
            border: "border-amber-500/30",
            dot: "bg-amber-500",
            text: "text-amber-700 dark:text-amber-500",
          };

  const showCount = !isDrafting && est.totalCount > 0;
  // liveCount is authoritative (from the backend's per-capability status), so
  // it already reads N/N when ready — no deep-link-vs-count contradiction.
  const displayLive = est.liveCount;

  const inner = (
    <>
      <span
        className={cn(
          "inline-flex h-2 w-2 rounded-full shrink-0",
          palette.dot,
          isBuilding && "shadow-[0_0_6px_currentColor]",
        )}
      />
      <span className={cn("text-[11px] font-semibold tracking-tight", palette.text)}>
        {phaseLabel}
      </span>
      {showCount && (
        <span className="tabular-nums text-[11px] font-medium text-foreground/80">
          {displayLive}<span className="text-muted-foreground/60">/</span>{est.totalCount}
        </span>
      )}
      {isBuilding && (
        <Loader2 className={cn("h-3 w-3 animate-spin", palette.text)} aria-hidden />
      )}
    </>
  );

  const baseClass = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
    palette.bg,
    palette.border,
  );

  if (onClick && (isBuilding || isInProgress || isReady)) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(baseClass, "hover:bg-opacity-80 transition-colors cursor-pointer")}
        title={
          isBuilding
            ? "See live activity"
            : isInProgress
              ? "Resume building"
              : "Solution is ready"
        }
      >
        {inner}
      </button>
    );
  }
  return <div className={baseClass}>{inner}</div>;
});

// ===========================================================================
// Hero — magazine-style. The LLM-generated narrative is the focal point.
// We don't show a title (the page header has it) so the eye lands straight
// on the prose.
// ===========================================================================

interface HeroCardProps {
  narrative: string | null;
  isGenerating: boolean;
  readmePresent: boolean;
  onShowFullStory?: () => void;
  onRegenerateNarrative?: () => void;
  onOpenChat?: () => void;
}

const HeroCard = memo(function HeroCard({
  narrative,
  isGenerating,
  readmePresent,
  onShowFullStory,
  onRegenerateNarrative,
  onOpenChat,
}: HeroCardProps) {
  const trimmed = narrative?.trim() ?? "";
  const hasNarrative = trimmed.length > 0;

  // ── Generating state (shimmer) ────────────────────────────────────────
  if (isGenerating && !hasNarrative) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 h-full">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Writing the pitch
          </span>
        </div>
        <div className="space-y-3 max-w-2xl">
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[92%]" />
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[88%]" />
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[75%]" />
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[60%]" />
        </div>
      </div>
    );
  }

  // ── Empty (no README yet) ─────────────────────────────────────────────
  if (!hasNarrative && !readmePresent) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-card/50 p-8 h-full flex flex-col justify-center">
        <div className="flex items-start gap-4 max-w-2xl">
          <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-[17px] font-semibold text-foreground">
              Let's design your solution
            </h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              Tell the assistant about your customer — their industry, what
              they're trying to solve, what they care about. Once there's a
              story drafted, an elevator pitch will appear right here.
            </p>
            {onOpenChat && (
              <Button size="sm" className="mt-4 h-8 gap-1.5 text-xs" onClick={onOpenChat}>
                <Sparkles className="h-3.5 w-3.5" />
                Open the assistant
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Empty (README exists but narrative not yet generated) ─────────────
  // The backend auto-fires a regen on GET when this state is reached, so
  // we show the shimmer rather than a manual button — the SSE
  // `narrative_updated` event will fill us in.
  if (!hasNarrative && readmePresent) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 h-full">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Writing the pitch
          </span>
        </div>
        <div className="space-y-3 max-w-2xl">
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[92%]" />
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[88%]" />
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[75%]" />
          <div className="h-4 rounded bg-muted/60 animate-pulse w-[60%]" />
        </div>
      </div>
    );
  }

  // ── Filled — magazine-style layout ────────────────────────────────────
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-8 h-full flex flex-col">
      {/* Soft primary glow in the top-right corner. Just enough to give
          the card visual weight without competing with the prose. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-primary/[0.07] blur-3xl"
      />

      <div className="relative">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            The pitch
          </div>
          {/* "Read the full story" — moved up here so the card stays
              compact and aligns vertically with the App preview tile on
              the right. */}
          {readmePresent && onShowFullStory && (
            <Button
              variant="outline"
              size="sm"
              onClick={onShowFullStory}
              className="h-8 gap-1.5 text-[12px] font-medium"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Read the full story
              <ChevronRight className="h-3.5 w-3.5 opacity-60" />
            </Button>
          )}
        </div>

        {/* The narrative fills the card width — no artificial max-width.
            17px / 1.65 keeps the long lines readable while letting the
            pitch take the visual presence of a hero. */}
        <div className="space-y-4 text-[17px] leading-[1.65] text-foreground/90">
          {trimmed.split(/\n\n+/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </div>

      {/* Regenerate affordance — hover-only, top-right corner. */}
      {onRegenerateNarrative && (
        <button
          type="button"
          onClick={onRegenerateNarrative}
          disabled={isGenerating}
          className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
          title="Regenerate the pitch from the latest README"
        >
          {isGenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isGenerating ? "Writing..." : "Regenerate"}
        </button>
      )}
    </article>
  );
});


// ===========================================================================
// StageSteps — the 4-step build journey (Generate Story → Generate
// Specifications → Build resources → Distribute), full width, one card each.
// The ACTIVE step plays a themed illustration; done = check, pending = quiet.
// Shown during a build; the heavy per-check detail lives in the top BuildStepper.
// ===========================================================================
// Per-step copy, mode-aware. The Genie Code workshop doesn't provision
// resources — it generates notebooks + prompts and loads them into the
// workspace — so the Build + Distribute steps read differently there.
function stepCopy(mode?: string): Record<string, { title: string; desc: string }> {
  const workshop = mode === "workshop";
  return {
    STORY_AND_ARCH: { title: "Generate Story", desc: "Draft the customer narrative & pitch" },
    SPECIFICATION: { title: "Generate Specifications", desc: "Detailed plans for each resource" },
    RESOURCES: workshop
      ? { title: "Create Genie Code Prompts", desc: "Author the notebooks + prompts to build it live" }
      : { title: "Build resources", desc: "Create the Databricks resources in your workspace" },
    DAB: workshop
      ? { title: "Load on workspace", desc: "Load the Genie workshop in your workspace" }
      : { title: "Distribute (optional)", desc: "Package as a DAB for repeatable deployment" },
  };
}

/** Themed illustration per step. `active` triggers the CSS animation; otherwise
 *  the same art renders static (dimmed via the parent). Pure inline SVG/CSS. */
function StepArt({ stepKey, active }: { stepKey: string; active: boolean }) {
  const stroke = "currentColor";
  if (stepKey === "STORY_AND_ARCH") {
    // three writing lines sweeping in
    return (
      <svg viewBox="0 0 40 28" className="h-7 w-10" fill="none" aria-hidden>
        <rect x="6" y="6" width="22" height="2.4" rx="1.2" fill={stroke}
          className={active ? "animate-step-write-1" : ""} opacity="0.9" />
        <rect x="6" y="13" width="28" height="2.4" rx="1.2" fill={stroke}
          className={active ? "animate-step-write-2" : ""} opacity="0.7" />
        <rect x="6" y="20" width="18" height="2.4" rx="1.2" fill={stroke}
          className={active ? "animate-step-write-3" : ""} opacity="0.55" />
      </svg>
    );
  }
  if (stepKey === "SPECIFICATION") {
    // checklist rows ticking on
    return (
      <svg viewBox="0 0 40 28" className="h-7 w-10" fill="none" aria-hidden>
        {[6, 14, 22].map((y, i) => (
          <g key={y} className={active ? `animate-step-tick-${i + 1}` : ""}>
            <path d={`M6 ${y + 1.5} l2 2 l3.5 -3.5`} stroke={stroke} strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
            <rect x="15" y={y} width="19" height="2.2" rx="1.1" fill={stroke} opacity="0.7" />
          </g>
        ))}
      </svg>
    );
  }
  if (stepKey === "RESOURCES") {
    // blocks dropping into place / stacking
    return (
      <svg viewBox="0 0 40 28" className="h-7 w-10" fill="none" aria-hidden>
        <rect x="6" y="16" width="8" height="8" rx="1.5" fill={stroke} opacity="0.9"
          className={active ? "animate-step-drop-1" : ""} />
        <rect x="16" y="16" width="8" height="8" rx="1.5" fill={stroke} opacity="0.75"
          className={active ? "animate-step-drop-2" : ""} />
        <rect x="26" y="16" width="8" height="8" rx="1.5" fill={stroke} opacity="0.6"
          className={active ? "animate-step-drop-3" : ""} />
        <rect x="16" y="6" width="8" height="8" rx="1.5" fill={stroke} opacity="0.9"
          className={active ? "animate-step-drop-4" : ""} />
      </svg>
    );
  }
  // DAB — a package/box lifting off (shipping)
  return (
    <svg viewBox="0 0 40 28" className="h-7 w-10" fill="none" aria-hidden>
      <g className={active ? "animate-step-ship" : ""}>
        <path d="M20 4 L32 10 L20 16 L8 10 Z" fill={stroke} opacity="0.9" />
        <path d="M8 10 V19 L20 25 V16 Z" fill={stroke} opacity="0.6" />
        <path d="M32 10 V19 L20 25 V16 Z" fill={stroke} opacity="0.75" />
      </g>
    </svg>
  );
}

// Workshop mode: the deliverable is a set of notebooks (Genie Code prompts),
// not provisioned resources. List the generated notebooks; while the agent is
// still streaming and none exist yet, show a "generating" placeholder.
const WORKSHOP_NB_LABELS: Record<string, string> = {
  "00_introduction": "Introduction",
  "01_setup_and_explore": "Setup & Explore",
  "02_build_pipeline": "Build the pipeline",
  "03_dashboard_and_genie": "Dashboard & Genie",
  "04_governance": "Governance",
  "05_ml": "ML",
};

const WorkshopNotebooks = memo(function WorkshopNotebooks({
  files,
  isStreaming,
  workspaceUrl,
}: {
  files: ProjectFile[];
  isStreaming: boolean;
  /** Deep-link to the workspace folder the notebooks were uploaded to
   *  (from resources.json → created_resources.workspace_folder). Null until
   *  the agent has loaded the workshop into the workspace. */
  workspaceUrl?: string | null;
}) {
  const notebooks = useMemo(
    () =>
      files
        .filter((f) => f.path.startsWith("notebooks/") && f.path.endsWith(".py"))
        .map((f) => f.path.slice("notebooks/".length).replace(/\.py$/, ""))
        .sort(),
    [files],
  );

  if (notebooks.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-[13px] text-muted-foreground">
        {isStreaming ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Generating the workshop notebooks…
          </>
        ) : (
          <>
            <BookOpen className="h-4 w-4" />
            The workshop notebooks will appear here once generated.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Run-it band — the notebooks live in the workspace; this is the one
          obvious "go here to run the workshop" affordance. Only rendered once
          the folder link is available (agent has uploaded + recorded it). */}
      {workspaceUrl && !isStreaming && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-foreground">
              Your workshop is loaded in Databricks
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Open the folder, start with{" "}
              <span className="font-medium text-foreground">00_introduction</span>, prime
              the Assistant (✨) with <span className="font-medium text-foreground">CONTEXT.md</span>,
              then work each notebook top-to-bottom — pasting its prompts to build the demo live.
            </p>
          </div>
          <Button
            asChild
            size="default"
            className="h-9 shrink-0 gap-1.5 text-[13px] font-medium"
          >
            <a href={workspaceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open in workspace
            </a>
          </Button>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {notebooks.map((nb) => (
          <div
            key={nb}
            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {WORKSHOP_NB_LABELS[nb] ?? nb}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{nb}.py</div>
            </div>
            <Check className="ml-auto h-4 w-4 shrink-0 text-primary/70" />
          </div>
        ))}
      </div>
    </div>
  );
});

const StageSteps = memo(function StageSteps({
  files,
  liveResourceCount,
  expectedResourceCount,
  isStreaming,
  mode,
}: {
  files: ProjectFile[];
  liveResourceCount: number;
  expectedResourceCount: number;
  isStreaming: boolean;
  mode?: string;
}) {
  const stages = useMemo(() => {
    const info = detectStageFromFiles(files, liveResourceCount);
    // Workshop mode: the build stage is "done" by notebook count, not resources.
    const workshopNotebooks =
      mode === "workshop"
        ? files.filter((f) => f.path.startsWith("notebooks/") && f.path.endsWith(".py")).length
        : null;
    return getLifecycleStages(info, liveResourceCount, expectedResourceCount, isStreaming, workshopNotebooks);
  }, [files, liveResourceCount, expectedResourceCount, isStreaming, mode]);
  const copyMap = useMemo(() => stepCopy(mode), [mode]);

  return (
    <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stages.map((s, i) => {
        const status = s.status;
        const copy = copyMap[s.key] ?? { title: s.label, desc: s.blurb };
        const done = status === "done";
        const active = status === "active";
        const optional = status === "optional";
        return (
          <li
            key={s.key}
            className={cn(
              "relative flex items-center gap-3 rounded-xl border p-3 transition-colors",
              active && "border-primary/40 bg-primary/[0.05]",
              done && "border-emerald-500/25 bg-emerald-500/[0.05]",
              (status === "pending" || optional) && "border-border/60 bg-muted/20",
            )}
          >
            {/* Left column: the themed icon (the single status element — check
                badge on its top-right when done, animates when active) with the
                "Step N" label stacked directly below it. */}
            <div className="flex shrink-0 flex-col items-center gap-1">
              <div
                className={cn(
                  "relative",
                  active ? "text-primary" : done
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground/40",
                )}
              >
                <StepArt stepKey={s.key} active={active} />
                {done && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-card">
                    <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-[9.5px] font-bold uppercase tracking-[0.12em]",
                  active && "text-primary",
                  done && "text-emerald-600 dark:text-emerald-400",
                  (status === "pending" || optional) && "text-muted-foreground/50",
                )}
              >
                Step {i + 1}
              </span>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "text-[13px] font-semibold leading-tight",
                    status === "pending" || optional ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {copy.title}
                </div>
                {optional && (
                  <span className="rounded bg-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    optional
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{copy.desc}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
});


// BuildTimer — the elapsed / countdown pill ("Started 3m ago · 5m to go").
// Self-contained live ticker so the label updates without re-rendering the
// whole overview. Budget = static sum of remaining capability durations;
// countdown = budget − elapsed wall-time.
const BuildTimer = memo(function BuildTimer({
  buildable,
  deployed,
  capabilities,
  createdAt,
}: {
  buildable: string[];
  deployed: DeployedResourceLink[];
  capabilities?: CapabilityBuildStatus[];
  createdAt?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const est = useMemo(
    () => estimateBuild(buildable, deployed, true, capabilities),
    [buildable, deployed, capabilities],
  );
  const budget = est.remainingMinutes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elapsed = useMemo(() => elapsedMinutes(createdAt), [createdAt, now]);
  const remaining = Math.max(0, budget - elapsed);
  const aboutToLandThreshold = Math.max(5, Math.ceil(budget * 0.2));
  const isOverdue = createdAt != null && elapsed > 0 && budget > 0 && elapsed >= budget;
  const isAboutToLand =
    createdAt != null && elapsed > 0 && budget > 0 && !isOverdue && remaining <= aboutToLandThreshold;

  if (!(createdAt || budget > 0)) return null;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] text-muted-foreground">
      <Clock className="h-3.5 w-3.5 text-primary" />
      {createdAt && (
        <span>
          Started <span className="font-medium text-foreground tabular-nums">{formatElapsed(elapsed)}</span>
        </span>
      )}
      {createdAt && budget > 0 && <span className="text-muted-foreground/70">·</span>}
      {budget > 0 && !isOverdue && !isAboutToLand && (
        <span className="font-semibold text-foreground tabular-nums">{formatMinutes(remaining)} to go</span>
      )}
      {isAboutToLand && <span className="font-medium text-foreground">almost there</span>}
      {isOverdue && <span>taking a bit longer</span>}
    </span>
  );
});


// ===========================================================================
// AppShowcaseCard — shown on the overview when the project has an app/
// folder with start.sh. Two big affordances: (1) Start the preview, which
// runs the app locally on the backend so we can demo without deploying;
// (2) Open full-screen, which opens the proxied preview URL in a new tab.
// Start is gated on `isStreaming` so we don't race the agent's file writes.
// Once the preview transitions to ready, we surface a "ready to demo" toast
// and briefly flash the Open Full-Screen button.
// ===========================================================================

// AnalystLayerBlock — replaces the "Analyst Layer" column in the resources
// grid with a dedicated dark-blue surface. The Databricks App is the hero
// (preview lifecycle, deploy state, big CTAs) and Lakebase sits alongside
// as a secondary link. Purpose: make the demo-able artifact visually
// distinct from "ingredient" capabilities like pipelines/dashboards.
const AnalystLayerBlock = memo(function AnalystLayerBlock({
  appWidget,
  lakebaseWidget,
  projectId,
  hasApp,
  isStreaming,
  onShowApp,
}: {
  appWidget?: Widget;
  lakebaseWidget?: Widget;
  projectId: string;
  hasApp: boolean;
  isStreaming: boolean;
  onShowApp?: () => void;
}) {
  // "Deployed" means there's a Databricks Apps deployment URL — NOT
  // merely that the widget is "live" (buildWidgets marks the App widget
  // live whenever `app/start.sh` exists on disk so the resources counter
  // hits N/N for local-preview-only builds; that fallback path has no
  // URL). Gate on `url` so the badge + subline only say "Deployed" when
  // we can actually link to the deployed app.
  const appDeployed = appWidget?.state === "live" && !!appWidget.url;
  const { state, isStarting, start } = useAppPreview(projectId);
  const previewStatus = state?.status ?? "stopped";
  const previewReady = previewStatus === "ready";
  const previewStarting = isStarting || previewStatus === "starting";
  const previewDisabled =
    isStreaming || previewStarting || previewReady || !hasApp;

  const [glowOpen, setGlowOpen] = useState(false);
  const prevReadyRef = useRef(false);
  useEffect(() => {
    if (previewReady && !prevReadyRef.current) {
      setGlowOpen(true);
      const t = window.setTimeout(() => setGlowOpen(false), 2400);
      return () => window.clearTimeout(t);
    }
    prevReadyRef.current = previewReady;
  }, [previewReady]);

  // App subline reflects the build/deploy hierarchy. The undeployed-but-
  // locally-runnable state isn't a failure — the user can demo via the
  // Preview button without a Databricks Apps deployment — so the copy
  // leads with what they CAN do.
  const appSubline = !hasApp
    ? "Not built yet"
    : appDeployed
    ? "Deployed"
    : "Ready to preview locally — not deployed yet";

  const previewTip = isStreaming
    ? "Wait for the assistant to finish before starting"
    : previewStarting
    ? "The app is starting…"
    : previewReady
    ? "The app is already running"
    : !hasApp
    ? "App not built yet"
    : "Run the app locally — no deployment needed";

  const livePillBg = previewReady
    ? "bg-emerald-400/15 text-emerald-300"
    : previewStarting
    ? "bg-amber-400/15 text-amber-200"
    : "bg-white/10 text-white/70";
  const livePillDot = previewReady
    ? "bg-emerald-400"
    : previewStarting
    ? "bg-amber-300 animate-pulse"
    : "bg-white/40";
  const livePillLabel = previewReady
    ? "Running"
    : previewStarting
    ? "Starting…"
    : "Stopped";

  const AppIcon = appWidget
    ? DATABRICKS_ICONS[appWidget.meta.icon]
    : DATABRICKS_ICONS.databricksApps;
  const LakebaseIcon = lakebaseWidget
    ? DATABRICKS_ICONS[lakebaseWidget.meta.icon]
    : DATABRICKS_ICONS.lakebase;
  const lakebaseDeployed = lakebaseWidget?.state === "live";

  return (
    <div className="flex flex-col h-full">
      {/* Column header — same rhythm as ResourceColumn but blue accent. */}
      <div
        className="text-[10px] font-bold uppercase tracking-[0.14em] pb-2 mb-2.5 border-b-2 text-blue-600 dark:text-blue-300"
        style={{ borderColor: "rgb(96, 165, 250)" }}
      >
        Your solution app
      </div>
      <section className="relative overflow-hidden rounded-xl border border-blue-400/30 bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900 text-white p-3.5 flex flex-col gap-3 h-full justify-between">
        {/* Soft glow accent */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 h-32 w-32 rounded-full bg-blue-400/20 blur-2xl"
        />

        {/* App hero — icon + name + state + pill */}
        {appWidget && (
          <div className="relative flex items-start gap-2.5">
            <div className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg bg-blue-400/15 border border-blue-300/20">
              <AppIcon className="h-5 w-5 text-blue-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[13px] font-semibold leading-tight text-white truncate">
                  {appWidget.meta.display}
                </div>
                {hasApp && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap",
                      livePillBg,
                    )}
                  >
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", livePillDot)}
                    />
                    {livePillLabel}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-blue-100/80">
                {appSubline}
              </div>
            </div>
          </div>
        )}

        {/* Single action row — Preview / Open Preview on the left, the
            deployed-app link (if any) and Lakebase pill on the right. The
            row wraps on very narrow columns but most of the time it sits
            in a single line. */}
        <div className="relative flex flex-wrap items-center gap-1.5">
          {hasApp && (
            <button
              type="button"
              disabled={previewDisabled && !previewReady}
              onClick={() => {
                onShowApp?.();
                if (!previewReady && !previewStarting) {
                  void start();
                }
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer",
                "bg-blue-400 text-blue-950 hover:bg-blue-300",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                previewReady &&
                  glowOpen &&
                  "ring-2 ring-emerald-300 ring-offset-2 ring-offset-blue-950 animate-pulse",
              )}
              title={previewReady ? "Open the running preview" : previewTip}
              aria-label={previewReady ? "Open the running preview" : previewTip}
            >
              {previewStarting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : previewReady ? (
                <Maximize2 className="h-3 w-3" strokeWidth={2.5} />
              ) : (
                <Play className="h-3 w-3" strokeWidth={2.5} />
              )}
              {previewStarting
                ? "Starting…"
                : previewReady
                ? "Open Preview"
                : "Preview"}
            </button>
          )}
          {appDeployed && appWidget?.url && (
            <a
              href={appWidget.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-semibold bg-white/10 text-white hover:bg-white/15 transition-colors cursor-pointer"
              title="Open the deployed app on Databricks"
            >
              <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
              Open
            </a>
          )}
          {/* Lakebase pushed to the right end of the row. */}
          {lakebaseWidget && (
            <div className="ml-auto">
              {lakebaseDeployed && lakebaseWidget.url ? (
                <a
                  href={lakebaseWidget.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold bg-white/10 text-white hover:bg-white/15 transition-colors cursor-pointer"
                  title="Open Lakebase project"
                >
                  <LakebaseIcon className="h-3.5 w-3.5 text-blue-200" />
                  Open Lakebase
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-100/60">
                  <LakebaseIcon className="h-3.5 w-3.5" />
                  {/* Live but no deep-link URL (build done, id not recorded):
                      say it's ready without a click-through. Truly pending
                      (not yet built) still reads "pending". */}
                  {lakebaseDeployed ? "Lakebase ready" : "Lakebase pending"}
                </span>
              )}
            </div>
          )}
        </div>

        {hasApp && isStreaming && !previewReady && (
          <p className="relative text-[10.5px] text-blue-200/70 -mt-1">
            Wait for the assistant to finish.
          </p>
        )}
      </section>
    </div>
  );
});

const PlatformValueProp = memo(function PlatformValueProp({
  catalogUrl,
}: {
  catalogUrl?: string | null;
}) {
  return (
    <div className="mt-6 pt-5 border-t border-border/50 flex items-center justify-between gap-4">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground/80">Unity Catalog</span>{" "}
        — the unified governance layer, unifying Data + AI on the Databricks platform.
      </p>
      {catalogUrl && (
        <a
          href={catalogUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 hover:border-primary/30 transition-colors cursor-pointer"
        >
          <DATABRICKS_ICONS.unityCatalog className="h-3.5 w-3.5" />
          Access Data in Unity Catalog
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
});

// ===========================================================================
// Main component
// ===========================================================================

export interface ProjectOverviewProps {
  projectId: string;
  /** Full project — powers the brand card (company + brand.json). */
  project?: Project | null;
  /** Called after the brand card resolves/saves a brand (returns refreshed project). */
  onBrandUpdated?: (p: Project) => void;
  projectDescription?: string | null;
  projectNarrative?: string | null;
  isGeneratingNarrative?: boolean;
  onRegenerateNarrative?: () => void;
  capabilities: { buildable: string[]; talking_track?: string[] } | null;
  deployedResources?: DeployedResourceLink[];
  /** Authoritative per-capability build status from the backend — drives the
   *  grid tiles' live/pending state + the "N of N ready" count. */
  deployedCapabilities?: CapabilityBuildStatus[];
  deployedExtractionError?: string | null;
  readmeContent?: string | null;
  hasReadme: boolean;
  hasArchitecture?: boolean;
  hasApp?: boolean;
  /** Project creation timestamp (ISO). Anchors the "Started X ago" label
   *  in the build banner. Optional — without it the banner just shows the
   *  static "to go" estimate. */
  createdAt?: string | null;
  /** Currently unused on the Overview itself, but kept on the interface
   *  for parent symmetry with the FileViewer wiring. */
  hasSpecifications?: boolean;
  /** Project files — used by BuildingBanner to derive the 4-stage
   *  lifecycle strip (same source the top stepper reads). */
  files?: ProjectFile[];
  isStreaming: boolean;
  onOpenChat?: () => void;
  onShowFullStory?: () => void;
  onShowArchitecture?: () => void;
  onShowApp?: () => void;
  /** Kept for future re-introduction of a manual description editor. */
  onEditDescription?: () => void;
  /** True for a project forked from a template — surfaces the "Make it yours"
   *  adapt shortcuts right under the hero (the fork's first action). */
  isForkedProject?: boolean;
  /** Kick off an agent-driven story adaptation from those shortcuts. */
  onAdaptStory?: (mode: StoryAdaptMode, instructions: string) => Promise<void> | void;
  /** Build the forked demo as-is (the default "just generate" action). */
  onForkBuildAsIs?: () => void;
}

export const ProjectOverview = memo(function ProjectOverview({
  projectId,
  project,
  onBrandUpdated,
  projectNarrative,
  isGeneratingNarrative = false,
  onRegenerateNarrative,
  capabilities,
  deployedResources,
  deployedCapabilities,
  deployedExtractionError,
  hasReadme,
  hasArchitecture = false,
  hasApp = false,
  createdAt,
  files = [],
  isStreaming,
  onOpenChat,
  onShowFullStory,
  onShowArchitecture,
  onShowApp,
  isForkedProject,
  onAdaptStory,
  onForkBuildAsIs,
}: ProjectOverviewProps) {
  const buildable = capabilities?.buildable ?? [];
  const deployed = deployedResources ?? [];

  // The demo is "built" once the backend settled its stage on BUILT/BUNDLED
  // (all resources ready AND a prior turn finished). Once built we never show
  // the build journey again — a follow-up chat streams but must not resurrect
  // the "AI is working" banner + steps. `buildActive` = the initial-build view.
  // Workshop mode: we don't provision Databricks resources — the deliverable is
  // a set of notebooks. So the "resources ready" panel doesn't apply; instead
  // we track how many workshop notebooks have been generated. The backend's
  // BUILT stage keys off resource IDs (which never populate here), so workshop
  // "done" is its own signal: at least one notebook exists AND we're idle.
  const isWorkshop = project?.mode === "workshop";
  const notebookCount = useMemo(
    () => files.filter((f) => f.path.startsWith("notebooks/") && f.path.endsWith(".py")).length,
    [files],
  );
  // Workshop deliverable link: the workspace folder the notebooks were
  // uploaded to (backend builds this from resources.json.workspace_folder).
  const workshopWorkspaceUrl = useMemo(
    () =>
      (deployedResources ?? []).find((r) => r.resource_type === "workspace_folder")?.url ?? null,
    [deployedResources],
  );

  const buildComplete = isWorkshop
    ? notebookCount > 0 && !isStreaming
    : project?.stage === "BUILT" || project?.stage === "BUNDLED";
  const buildActive = isStreaming && !buildComplete;

  // Tile live/pending comes straight from the backend's per-capability status
  // (resources.json-derived) — a built resource reads live even with no
  // deep-link URL (preview-only app, Lakebase DB with no recorded id). No
  // BUILT/BUNDLED promotion needed; the backend already reports each as built.
  const widgets = useMemo(
    () => buildWidgets(buildable, deployed, deployedCapabilities),
    [buildable, deployed, deployedCapabilities],
  );
  const hasAnyResources = widgets.length > 0;
  const liveCount = widgets.filter((w) => w.state === "live").length;
  const totalCount = widgets.length;

  // Group widgets by their display group for the column layout. Empty
  // groups are dropped, and group order matches the original platform
  // hierarchy so the page reads left-to-right (pipelines → AI →
  // analysis → analyst → foundation).
  const widgetsByGroup = useMemo(() => {
    // Analyst Layer (App + Lakebase) is rendered as a separate dark-blue
    // hero block, NOT a column in the grid. Drop it from the column list
    // so we don't show the App/Lakebase widgets twice.
    const order: DisplayGroup[] = [
      "Data Pipelines",
      "AI",
      "Data Analysis",
      "Foundation",
    ];
    const grouped: Array<{ group: DisplayGroup; widgets: Widget[] }> = [];
    for (const g of order) {
      const list = widgets.filter((w) => w.group === g);
      if (list.length > 0) grouped.push({ group: g, widgets: list });
    }
    return grouped;
  }, [widgets]);

  // Analyst Layer widgets — extracted for the dedicated app+lakebase block.
  const appWidget = useMemo(
    () => widgets.find((w) => w.slug === "databricks-apps"),
    [widgets],
  );
  const lakebaseWidget = useMemo(
    () => widgets.find((w) => w.slug === "lakebase"),
    [widgets],
  );
  const hasAnalystBlock = !!(appWidget || lakebaseWidget);


  return (
    <ScrollArea className="flex-1">
      <div className="px-8 py-7 space-y-6 max-w-[1180px] mx-auto">
        {/* ────────────────────────────────────────────────────────────
            Hero — full-width pitch. During the t=0 streaming wait the
            HeroCard renders its own "Writing the pitch" skeleton +
            spinner state, so we don't need a separate drafting screen.
            ──────────────────────────────────────────────────────────── */}
        <HeroCard
          narrative={projectNarrative ?? null}
          // Force the skeleton when streaming + no README yet, so the
          // hero slot reads as "we're working on this" instead of an
          // empty CTA. The HeroCard's no-README + not-generating
          // branch only renders when we're idle.
          isGenerating={isGeneratingNarrative || (isStreaming && !hasReadme)}
          readmePresent={hasReadme}
          onShowFullStory={onShowFullStory}
          onRegenerateNarrative={onRegenerateNarrative}
          onOpenChat={onOpenChat}
        />

        {/* Fork "start here" band — the first, most obvious action on a freshly
            forked project: build it as-is, or tell the agent how to make this
            copy yours. Only for forks, and only until the build has produced
            live resources (after that it recedes — the job's done). */}
        {isForkedProject && onAdaptStory && onForkBuildAsIs && deployed.length === 0 && (
          <StoryAdaptActions
            isStreaming={isStreaming}
            onUseAsIs={onForkBuildAsIs}
            onAdaptStory={onAdaptStory}
            capabilities={[...buildable, ...(capabilities?.talking_track ?? [])]}
          />
        )}

        {/* Extraction-error notice (rare) */}
        {deployedExtractionError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px]">
            <span className="font-semibold text-amber-700 dark:text-amber-300">
              Resource extraction failed
            </span>
            <span className="ml-2 text-muted-foreground" title={deployedExtractionError}>
              workspace links unavailable
            </span>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────────
            Resources — column-per-category layout (full width like the pitch).
            While the agent is still picking capabilities (resources.json
            hasn't materialized yet), render a placeholder card where the
            grid will eventually land so the page doesn't visually collapse
            between the hero and the build banner.
            ──────────────────────────────────────────────────────────── */}
        {!hasAnyResources && buildActive && (
          <section className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-7 relative overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-primary/[0.05] blur-3xl"
            />
            <div className="relative flex items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div>
                <h2 className="text-[14px] font-semibold text-foreground">
                  Writing your story
                </h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  The assistant is picking the Databricks capabilities for
                  your solution. Once the story is ready, the resources grid
                  will appear here.
                </p>
              </div>
            </div>
            <div className="relative mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 rounded-xl border border-border/40 bg-muted/30 animate-pulse"
                />
              ))}
            </div>
          </section>
        )}

        {hasAnyResources && (
          <section className="rounded-2xl border border-border/60 bg-card p-7">
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {isWorkshop ? "Genie Code workshop" : "Databricks resources"}
                </h2>
                {isWorkshop ? (
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    <span className="text-foreground font-semibold">{notebookCount}</span>
                    <span className="text-muted-foreground/70"> notebook{notebookCount === 1 ? "" : "s"} generated</span>
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    <span className="text-foreground font-semibold">{liveCount}</span>
                    <span className="text-muted-foreground/70"> of {totalCount} ready</span>
                  </span>
                )}
              </div>
              {/* Right cluster: while building, the timer + "AI is working" +
                  Open-chat sit on the SAME row as the title (saves a row); the
                  View-architecture button follows. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {buildActive && (
                  <>
                    <BuildTimer buildable={buildable} deployed={deployed} capabilities={deployedCapabilities} createdAt={createdAt} />
                    <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground xl:inline-flex">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      The AI is working for you — please wait.
                    </span>
                    {onOpenChat && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onOpenChat}
                        className="h-8 shrink-0 gap-1.5 text-[12px] font-medium"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Open the chat to see the activity
                      </Button>
                    )}
                  </>
                )}
                {hasArchitecture && onShowArchitecture && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={onShowArchitecture}
                    className="h-9 gap-1.5 text-[13px] font-medium"
                  >
                    <Network className="h-4 w-4" />
                    View architecture
                    <ChevronRight className="h-4 w-4 opacity-60" />
                  </Button>
                )}
              </div>
            </header>

            {/* The 4-step build journey (Generate Story → Generate Specifications
                → Build resources → Distribute), full width. Active step animates.
                Only during the INITIAL build — hidden once the demo is built, so a
                follow-up chat doesn't resurrect it. */}
            {buildActive && (
              <div className="mb-5">
                <StageSteps
                  files={files}
                  liveResourceCount={deployed.length}
                  expectedResourceCount={buildable.length}
                  isStreaming={isStreaming}
                  mode={project?.mode}
                />
              </div>
            )}
            {/* Personalize-for-a-real-company — slim blue strip under the header. */}
            {project && onBrandUpdated && (
              <BrandCard project={project} onUpdated={onBrandUpdated} className="mb-5" />
            )}
            {isWorkshop ? (
              /* Workshop mode: the deliverable is notebooks, not provisioned
                 resources — list the generated notebooks instead of resource tiles. */
              <WorkshopNotebooks
                files={files}
                isStreaming={isStreaming}
                workspaceUrl={workshopWorkspaceUrl}
              />
            ) : (
              <>
                <div
                  className="grid gap-x-5 gap-y-6"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(
                      widgetsByGroup.length + (hasAnalystBlock ? 1 : 0),
                      5,
                    )}, minmax(220px, 1fr))`,
                  }}
                >
                  {widgetsByGroup.map(({ group, widgets: groupWidgets }) => (
                    <ResourceColumn
                      key={group}
                      group={group}
                      widgets={groupWidgets}
                    />
                  ))}
                  {hasAnalystBlock && (
                    <AnalystLayerBlock
                      appWidget={appWidget}
                      lakebaseWidget={lakebaseWidget}
                      projectId={projectId}
                      hasApp={hasApp}
                      isStreaming={isStreaming}
                      onShowApp={onShowApp}
                    />
                  )}
                </div>
                <PlatformValueProp
                  catalogUrl={
                    deployed.find((r) => r.resource_type === "catalog_explorer")
                      ?.url ?? null
                  }
                />
              </>
            )}
          </section>
        )}

      </div>
    </ScrollArea>
  );
});

export default ProjectOverview;
