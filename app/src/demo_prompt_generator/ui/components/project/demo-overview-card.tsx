/**
 * DemoOverviewCard — capability grid at the top of the Summary tab.
 *
 * Renders every capability declared in `resources.json` (buildable +
 * talking_track) EXCEPT pure implementation details (synthetic-data-gen
 * is the only one today) — it's always present, has no story value to
 * the audience.
 *
 * Pill states:
 *   - LIVE    — `deployed_type` matches an entry in the deployed list →
 *               primary tint, clickable, opens the workspace URL.
 *   - PENDING — declared in capabilities but not yet built (or has no
 *               clickable workspace surface, e.g. Lakeflow Connect /
 *               Databricks One) → muted, non-clickable, hover tooltip.
 *
 * Visual: horizontal columns (Data Ingestion / Data Processing / AI / Data
 * Analysis / Analyst Layer), Foundation row at the bottom.
 */

/** Capabilities that exist in resources.json but we don't render in the
 *  overview card. Either implementation-only (synthetic-data-gen) or
 *  workspace-surfaces that don't produce a per-demo resource and just
 *  add noise to the card (databricks-one, genie-code). */
const HIDDEN_SLUGS = new Set([
  "synthetic-data-gen",
  "databricks-one",
  "genie-code",
]);
import { memo, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { DATABRICKS_ICONS } from "@/components/databricks-icons";
import { TIER_CONFIG, type TierType } from "@/lib/architecture-schema";
import {
  CAPABILITY_META,
  GROUP_ORDER,
  type CapabilityGroup,
  type CapabilityMeta,
} from "@/lib/capabilities";
import type { DeployedResourceLink } from "@/lib/custom-api";

// Map our display-group names to the architecture-schema tier palette so
// the column headers reuse the same color vocabulary as the detailed
// ReactFlow architecture diagram.
const GROUP_TIER: Record<CapabilityGroup, TierType> = {
  "Data Ingestion": "sdp",
  "Data Processing": "gold",
  "AI": "ai",
  "Data Analysis": "analytics",
  "Analyst Layer": "consumer",
  "Foundation": "governance",
};

type PillKind = "live" | "pending";

interface Pill {
  slug: string;
  meta: CapabilityMeta;
  kind: PillKind;
  /** Workspace deep-link, only present when kind="live". */
  url?: string;
}

interface DemoOverviewCardProps {
  capabilities: {
    buildable: string[];
    talking_track?: string[];
  };
  deployed: DeployedResourceLink[];
  extractionError?: string | null;
}

function buildPills(
  buildable: string[],
  talkingTrack: string[],
  deployed: DeployedResourceLink[],
): { groups: Record<CapabilityGroup, Pill[]>; foundation: Pill[] } {
  const byType = new Map<string, DeployedResourceLink>();
  for (const r of deployed) byType.set(r.resource_type, r);

  const groups: Record<CapabilityGroup, Pill[]> = {
    "Data Ingestion": [],
    "Data Processing": [],
    "AI": [],
    "Data Analysis": [],
    "Analyst Layer": [],
    "Foundation": [],
  };
  const foundation: Pill[] = [];
  const seen = new Set<string>();

  // Render buildable + talking_track in declared order. Dedupe in case a
  // slug shows up in both (shouldn't happen but cheap to guard).
  for (const slug of [...buildable, ...talkingTrack]) {
    if (seen.has(slug) || HIDDEN_SLUGS.has(slug)) continue;
    seen.add(slug);
    const meta = CAPABILITY_META[slug];
    if (!meta) continue; // unknown slug → skip silently (don't crash on drift)
    let pill: Pill = { slug, meta, kind: "pending" };
    if (meta.deployed_type) {
      const live = byType.get(meta.deployed_type);
      if (live && live.url) {
        pill = { slug, meta, kind: "live", url: live.url };
      }
    }
    if (meta.group === "Foundation") foundation.push(pill);
    else groups[meta.group].push(pill);
  }

  return { groups, foundation };
}

// ---------------------------------------------------------------------------
// Pill rendering
// ---------------------------------------------------------------------------

const PillItem = memo(function PillItem({ pill, tier }: { pill: Pill; tier: TierType }) {
  const cfg = TIER_CONFIG[tier];
  const Icon = DATABRICKS_ICONS[pill.meta.icon];
  const isLive = pill.kind === "live";

  const inner = (
    <span
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-[13px] font-medium ${
        isLive ? "hover:bg-primary/10" : ""
      }`}
    >
      {/* 1.5px dot for live pills; invisible spacer of the same width on
          non-live pills so every icon column aligns at the same x. */}
      <span
        className={`inline-flex h-1.5 w-1.5 rounded-full shrink-0 ${
          isLive
            ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
            : "bg-transparent"
        }`}
        aria-hidden
      />
      <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
      <span className="text-foreground/85 group-hover:text-foreground truncate flex-1 min-w-0">
        {pill.meta.display}
      </span>
      {isLive && (
        <ExternalLink className="h-3 w-3 text-muted-foreground/60 shrink-0 group-hover:text-foreground/70" />
      )}
    </span>
  );

  if (isLive && pill.url) {
    return (
      <a
        href={pill.url}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline block"
        title={`${pill.meta.display} — open in workspace`}
      >
        {inner}
      </a>
    );
  }
  // Non-live: decorative, no link, no tooltip. The user reads it as
  // "this capability is part of the demo" — that's all we claim.
  return <div>{inner}</div>;
});

const GroupColumn = memo(function GroupColumn({
  group,
  pills,
}: {
  group: CapabilityGroup;
  pills: Pill[];
}) {
  const tier = GROUP_TIER[group];
  const cfg = TIER_CONFIG[tier];

  return (
    <div className="flex flex-col min-w-[140px]">
      <div
        className={`text-[10px] font-bold uppercase tracking-[0.12em] ${cfg.color} pb-2 mb-1.5 border-b-2`}
        style={{ borderColor: cfg.stripe }}
      >
        {group}
      </div>
      <div className="space-y-0.5">
        {pills.map((pill) => (
          <PillItem key={pill.slug} pill={pill} tier={tier} />
        ))}
      </div>
    </div>
  );
});

const FoundationRow = memo(function FoundationRow({ pills }: { pills: Pill[] }) {
  const cfg = TIER_CONFIG[GROUP_TIER.Foundation];
  return (
    <div className="mt-5 pt-3 border-t border-dashed border-border/50 flex flex-wrap items-center gap-x-1 gap-y-1">
      <div
        className={`text-[10px] font-bold uppercase tracking-[0.12em] ${cfg.color} shrink-0 mr-3`}
      >
        Foundation
      </div>
      {pills.map((pill) => (
        <PillItem key={pill.slug} pill={pill} tier={GROUP_TIER.Foundation} />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const DemoOverviewCard = memo(function DemoOverviewCard({
  capabilities,
  deployed,
  extractionError,
}: DemoOverviewCardProps) {
  const { groups, foundation } = useMemo(
    () =>
      buildPills(
        capabilities.buildable ?? [],
        capabilities.talking_track ?? [],
        deployed,
      ),
    [capabilities.buildable, capabilities.talking_track, deployed],
  );

  const populatedGroups = GROUP_ORDER.filter((g) => groups[g].length > 0);

  // If everything is empty (no capabilities, no resources, no error) render
  // nothing. The Summary tab can flow without us.
  if (populatedGroups.length === 0 && foundation.length === 0 && !extractionError) {
    return null;
  }

  const liveCount = [
    ...populatedGroups.flatMap((g) => groups[g]),
    ...foundation,
  ].filter((p) => p.kind === "live").length;

  return (
    <>
      {/* float-right + not-prose so the README's H1 + "The Story" table
          wrap around us on the right. Fixed compact width — groups stack
          vertically inside so the card stays narrow and the surrounding
          markdown stays readable. On narrow viewports the float drops
          and the card stacks above. */}
      <div className="not-prose mb-4 w-full md:float-right md:ml-6 md:mb-2 md:w-[320px] md:max-w-[45%] rounded-2xl border border-border/50 bg-card shadow-sm">
        {extractionError && (
          <div className="border-b border-amber-500/30 bg-amber-500/[0.06] px-3 py-1.5 text-[11px]">
            <span className="font-semibold text-amber-700 dark:text-amber-300">
              ⚠ Resource extraction failed
            </span>
            <span className="ml-2 text-muted-foreground" title={extractionError}>
              workspace links unavailable
            </span>
          </div>
        )}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Products
            </h3>
            {liveCount > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1 shadow-[0_0_4px_rgba(16,185,129,0.6)]" />
                {liveCount} live
              </span>
            )}
          </div>
          {populatedGroups.length > 0 && (
            <div className="flex flex-col gap-3">
              {populatedGroups.map((group) => (
                <GroupColumn key={group} group={group} pills={groups[group]} />
              ))}
            </div>
          )}
          {foundation.length > 0 && <FoundationRow pills={foundation} />}
        </div>
      </div>
    </>
  );
});

export default DemoOverviewCard;
