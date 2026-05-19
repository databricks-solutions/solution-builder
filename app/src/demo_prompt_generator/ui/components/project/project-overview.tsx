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
import { estimateBuild } from "@/lib/build-eta";
import type { DeployedResourceLink } from "@/lib/custom-api";
import { cn } from "@/lib/utils";
import { useAppPreview } from "../../preview";

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
 * Per-capability tier override — picks the SAME tier the architecture
 * diagram assigns to that node, so a Knowledge Assistant tile reads as
 * the same indigo on the Overview as it does in the diagram. This map
 * is derived from how the demo-generator skill writes architecture.md
 * (cross-referenced with `MERIDIAN_BANK_SCHEMA` in architecture-schema.ts).
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
  "databricks-one": "interface",
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
const HIDDEN_SLUGS = new Set(["synthetic-data-gen", "databricks-one", "genie-code"]);

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
): Widget[] {
  const byType = new Map<string, DeployedResourceLink>();
  for (const r of deployed) byType.set(r.resource_type, r);

  const seen = new Set<string>();
  const widgets: Widget[] = [];

  // Only render tiles for slugs explicitly listed as buildable in
  // resources.json. Talking-track-only items (incl. Unity Catalog) are
  // discussed in the story, not surfaced as workspace links — anything
  // outside `buildable` would be misleading because we don't have a
  // deployment signal to mark it ready/pending.
  for (const slug of buildable) {
    if (seen.has(slug) || HIDDEN_SLUGS.has(slug)) continue;
    seen.add(slug);
    const meta = CAPABILITY_META[slug];
    if (!meta || !meta.deployed_type) continue;
    const group = SOURCE_TO_DISPLAY[meta.group];
    let state: WidgetState = "pending";
    let url: string | undefined;
    const live = byType.get(meta.deployed_type);
    if (live?.url) {
      state = "live";
      url = live.url;
    }
    widgets.push({ slug, meta, group, state, url });
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
        {isLive && (
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
  onClick?: () => void;
}

export const HeaderStatusPill = memo(function HeaderStatusPill({
  buildable,
  deployed,
  hasStarted,
  isStreaming,
  onClick,
}: HeaderStatusPillProps) {
  const est = useMemo(
    () => estimateBuild(buildable, deployed, hasStarted),
    [buildable, deployed, hasStarted],
  );

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

  // Color palette — matches the architecture-diagram tier vocabulary so
  // status reads as the same accent everywhere.
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
          {est.liveCount}<span className="text-muted-foreground/60">/</span>{est.totalCount}
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
              : "Demo is ready"
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
              Let's design your demo
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
// Drafting overview — full-width "what's coming" panel shown while the
// project is brand new (no README yet). Three numbered steps explain
// the flow, with a friendly ~2 min expectation set up front so users
// don't sit refreshing.
// ===========================================================================

interface DraftingOverviewProps {
  isStreaming: boolean;
  onOpenChat?: () => void;
}

const DraftingOverview = memo(function DraftingOverview({
  isStreaming,
  onOpenChat,
}: DraftingOverviewProps) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-8 lg:p-10 overflow-hidden relative">
      {/* Same primary glow the hero uses — gives the panel personality
          without competing with the prose. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/[0.07] blur-3xl"
      />

      <div className="relative max-w-2xl">
        <div className="flex items-center gap-3 mb-3">
          {isStreaming ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          ) : (
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
          )}
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
            {isStreaming
              ? "Your project is being crafted…"
              : "Let's design your demo"}
          </h2>
        </div>

        <p className="text-[14.5px] leading-relaxed text-muted-foreground mb-2">
          {isStreaming ? (
            <>
              The assistant is drafting a story, picking the right Databricks
              capabilities, and sketching the architecture. This usually takes
              about <span className="text-foreground font-medium">2 minutes</span> —
              hang tight.
            </>
          ) : (
            <>
              Tell the assistant about your customer — their industry, the
              problem they're trying to solve, what they care about. About
              two minutes after you hit send, your story and architecture
              will appear right here.
            </>
          )}
        </p>

        {!isStreaming && onOpenChat && (
          <Button onClick={onOpenChat} className="mt-5 gap-1.5">
            <Sparkles className="h-4 w-4" />
            Open the assistant
          </Button>
        )}
      </div>

      {/* Three-step roadmap — same shape as the original drafting screen.
          Step 1 is active (or first up), 2 and 3 stay muted so the eye
          knows what order to expect. */}
      <ol className="relative mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
        <DraftingStep
          n={1}
          active
          title="Review the story"
          body="The narrative will appear on this page once it's drafted. Iterate with the assistant until it fits your customer perfectly."
        />
        <DraftingStep
          n={2}
          title="Generate the resources"
          body="Pipelines, dashboards, Genie spaces, agents — the assistant builds them in your workspace and lights them up on the Overview."
        />
        <DraftingStep
          n={3}
          title="Show it off"
          body="Each resource gets an Open link straight into the Databricks workspace, plus a clean architecture diagram for your meeting."
        />
      </ol>

      <p className="relative mt-7 text-[12px] text-muted-foreground/80">
        Follow along in the floating chat in the bottom-right — the assistant
        may ask you a question or two along the way.
      </p>
    </section>
  );
});

const DraftingStep = memo(function DraftingStep({
  n,
  title,
  body,
  active = false,
}: {
  n: number;
  title: string;
  body: string;
  active?: boolean;
}) {
  return (
    <li className="flex gap-3.5">
      <span
        className={cn(
          "shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
          active
            ? "bg-primary/15 text-primary ring-2 ring-primary/30"
            : "bg-muted text-muted-foreground",
        )}
      >
        {n}
      </span>
      <div>
        <div
          className={cn(
            "text-[14px] font-semibold leading-tight",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {title}
        </div>
        <p
          className={cn(
            "mt-1 text-[12.5px] leading-relaxed",
            active ? "text-muted-foreground" : "text-muted-foreground/70",
          )}
        >
          {body}
        </p>
      </div>
    </li>
  );
});

// ===========================================================================
// Platform value-prop — quiet single-sentence footer for the resources
// card. Reinforces "everything's on one platform" without screaming.
// ===========================================================================

// ===========================================================================
// BuildingBanner — shown between hero and resources while the agent is
// streaming. The pulsing orb is the focal point: long agent runs (~30min)
// otherwise feel frozen, this signals "we're working, you can wait
// elsewhere." Clicking the CTA opens the chat so the user can see the
// live activity (thinking, tool calls, file writes).
// ===========================================================================

const BuildingBanner = memo(function BuildingBanner({
  onOpenChat,
}: {
  onOpenChat?: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-5 px-2 py-5">
      {/* Pulsing orb — solid primary core with two soft halo rings. */}
      <div className="relative shrink-0 flex items-center justify-center h-16 w-16">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/25 animate-ping"
        />
        <span
          aria-hidden
          className="absolute inset-1.5 rounded-full bg-primary/35 animate-pulse"
        />
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Sparkles className="h-5 w-5" strokeWidth={2.25} />
        </span>
      </div>

      <div className="max-w-xl">
        <h3 className="text-[15px] font-semibold text-foreground">
          The AI is working for you — please wait
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
          This can take a while. You can safely close this page and come back
          later — the build keeps running in the background.
        </p>
        {onOpenChat && (
          <Button
            size="sm"
            className="mt-3 h-8 gap-1.5 text-xs cursor-pointer"
            onClick={onOpenChat}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Open the chat to see the activity
          </Button>
        )}
      </div>
    </div>
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
  const appDeployed = appWidget?.state === "live";
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

  // App subline reflects the build/deploy hierarchy.
  const appSubline = !hasApp
    ? "Not built yet"
    : appDeployed
    ? "Deployed"
    : "App not deployed yet";

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
        Your demo app
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
                  Lakebase pending
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
  projectDescription?: string | null;
  projectNarrative?: string | null;
  isGeneratingNarrative?: boolean;
  onRegenerateNarrative?: () => void;
  capabilities: { buildable: string[]; talking_track?: string[] } | null;
  deployedResources?: DeployedResourceLink[];
  deployedExtractionError?: string | null;
  readmeContent?: string | null;
  hasReadme: boolean;
  hasArchitecture?: boolean;
  hasApp?: boolean;
  /** Currently unused on the Overview itself, but kept on the interface
   *  for parent symmetry with the FileViewer wiring. */
  hasSpecifications?: boolean;
  isStreaming: boolean;
  onOpenChat?: () => void;
  onShowFullStory?: () => void;
  onShowArchitecture?: () => void;
  onShowApp?: () => void;
  /** Kept for future re-introduction of a manual description editor. */
  onEditDescription?: () => void;
}

export const ProjectOverview = memo(function ProjectOverview({
  projectId,
  projectNarrative,
  isGeneratingNarrative = false,
  onRegenerateNarrative,
  capabilities,
  deployedResources,
  deployedExtractionError,
  hasReadme,
  hasArchitecture = false,
  hasApp = false,
  isStreaming,
  onOpenChat,
  onShowFullStory,
  onShowArchitecture,
  onShowApp,
}: ProjectOverviewProps) {
  const buildable = capabilities?.buildable ?? [];
  const deployed = deployedResources ?? [];

  const widgets = useMemo(
    () => buildWidgets(buildable, deployed),
    [buildable, deployed],
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

  // No README yet → show the 3-step "what's coming" drafting view. The
  // hero + status + resources grid would all be empty in this state and
  // the wait screen reads much better than three empty cards.
  if (!hasReadme) {
    return (
      <ScrollArea className="flex-1">
        <div className="px-8 py-7 max-w-[1180px] mx-auto">
          <DraftingOverview
            isStreaming={isStreaming}
            onOpenChat={onOpenChat}
          />
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-8 py-7 space-y-6 max-w-[1180px] mx-auto">
        {/* ────────────────────────────────────────────────────────────
            Hero — full-width pitch.
            ──────────────────────────────────────────────────────────── */}
        <HeroCard
          narrative={projectNarrative ?? null}
          isGenerating={isGeneratingNarrative}
          readmePresent={hasReadme}
          onShowFullStory={onShowFullStory}
          onRegenerateNarrative={onRegenerateNarrative}
          onOpenChat={onOpenChat}
        />

        {/* Live-build banner — only shown when the agent is streaming AND
            we still have resources left to build. Once everything is
            "ready" the banner would be misleading (the deploy is done,
            even if the agent is still e.g. writing follow-up docs). */}
        {isStreaming && liveCount < totalCount && (
          <BuildingBanner onOpenChat={onOpenChat} />
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
            ──────────────────────────────────────────────────────────── */}
        {hasAnyResources && (
          <section className="rounded-2xl border border-border/60 bg-card p-7">
            <header className="flex items-center justify-between gap-3 mb-5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Databricks resources
                </h2>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  <span className="text-foreground font-semibold">{liveCount}</span>
                  <span className="text-muted-foreground/70"> of {totalCount} ready</span>
                </span>
              </div>
              {/* "View architecture" — peer of the "Read the full story"
                  button in the hero. Same Button variant/size so the two
                  read as a consistent navigation language. */}
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
            </header>
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
          </section>
        )}

      </div>
    </ScrollArea>
  );
});

export default ProjectOverview;
