/**
 * DemoOverviewCard — capability grid at the top of the Summary tab.
 *
 * Only renders the demo's **buildable** capabilities, plus Unity Catalog
 * if it appears in the capabilities (talking_track or buildable) or has
 * been deployed. Non-buildable talking-track items are intentionally
 * hidden so the card stays focused on assets the user can actually click
 * through to.
 *
 * Pill states:
 *   - LIVE    — `deployed_type` matches an entry in the deployed list →
 *               clickable; renders with a prominent primary "Open" button.
 *   - PENDING — declared as buildable but not yet built → muted,
 *               non-clickable.
 *
 * Visual: horizontal columns (Data Ingestion / Data Processing / AI / Data
 * Analysis / Analyst Layer), Foundation row at the bottom.
 */

/** Slugs that are intentionally never shown — implementation-only or
 *  workspace surfaces that don't map to a clickable demo asset. */
const HIDDEN_SLUGS = new Set([
  "synthetic-data-gen",
  "databricks-one",
  "genie-code",
]);

/** Slugs that we surface even if they're talking-track-only (i.e. not
 *  in `buildable`). Currently just Unity Catalog — it's foundational
 *  enough that users expect to see it on the card, and the deployed
 *  `catalog_explorer` link makes it clickable. */
const TALKING_TRACK_ALLOWLIST = new Set(["unity-catalog"]);
import { memo, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { DATABRICKS_ICONS } from "@/components/databricks-icons";
import { TIER_CONFIG, type TierType } from "@/lib/architecture-schema";
import {
  CAPABILITY_META,
  type CapabilityGroup,
  type CapabilityMeta,
} from "@/lib/capabilities";
import type { DeployedResourceLink } from "@/lib/custom-api";

// Display groups — what we actually render on the card. We merge the
// capabilities.ts "Data Ingestion" + "Data Processing" groups into one
// "Data Pipelines" column since both are pipeline-shaped concerns to a
// presales audience and a separate column for each was cluttering the
// card.
type DisplayGroup =
  | "Data Pipelines"
  | "AI"
  | "Data Analysis"
  | "Analyst Layer"
  | "Foundation";

const DISPLAY_GROUP_ORDER: DisplayGroup[] = [
  "Data Pipelines",
  "AI",
  "Data Analysis",
  "Analyst Layer",
];

const SOURCE_TO_DISPLAY: Record<CapabilityGroup, DisplayGroup> = {
  "Data Ingestion": "Data Pipelines",
  "Data Processing": "Data Pipelines",
  "AI": "AI",
  "Data Analysis": "Data Analysis",
  "Analyst Layer": "Analyst Layer",
  "Foundation": "Foundation",
};

// Tier palette for each display group. Reused by both the column header
// and the per-pill "Open" button so the visual hierarchy stays coherent.
const DISPLAY_GROUP_TIER: Record<DisplayGroup, TierType> = {
  "Data Pipelines": "sdp",
  "AI": "ai",
  "Data Analysis": "analytics",
  "Analyst Layer": "consumer",
  // Unity Catalog reads as the "blue" platform spine in the corporate
  // deck — use the ingest blue palette here so the UC Open button stands
  // out instead of getting the muted slate "governance" treatment.
  "Foundation": "ingest",
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
): { groups: Record<DisplayGroup, Pill[]>; foundation: Pill[] } {
  const byType = new Map<string, DeployedResourceLink>();
  for (const r of deployed) byType.set(r.resource_type, r);

  const groups: Record<DisplayGroup, Pill[]> = {
    "Data Pipelines": [],
    "AI": [],
    "Data Analysis": [],
    "Analyst Layer": [],
    "Foundation": [],
  };
  const foundation: Pill[] = [];
  const seen = new Set<string>();

  // Render buildable first, then any allowlisted talking-track slugs
  // (currently just Unity Catalog) that weren't already in buildable.
  // Non-buildable, non-allowlisted talking-track items are skipped — the
  // user can't click anything on them and they clutter the card.
  const allowedFromTalking = talkingTrack.filter((s) => TALKING_TRACK_ALLOWLIST.has(s));
  for (const slug of [...buildable, ...allowedFromTalking]) {
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
    const display = SOURCE_TO_DISPLAY[meta.group];
    if (display === "Foundation") foundation.push(pill);
    else groups[display].push(pill);
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

  const row = (
    <span className="group flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] font-medium">
      {/* live indicator dot (or invisible spacer to keep icon columns aligned) */}
      <span
        className={`inline-flex h-1.5 w-1.5 rounded-full shrink-0 ${
          isLive
            ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
            : "bg-transparent"
        }`}
        aria-hidden
      />
      <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
      <span className="text-foreground/85 truncate flex-1 min-w-0">
        {pill.meta.display}
      </span>
      {isLive && (
        <span
          className="
            shrink-0 inline-flex items-center gap-1
            px-2 py-0.5 rounded-full
            text-[11px] font-semibold tracking-wide text-white
            shadow-sm
            transition-transform
            group-hover:scale-[1.03]
          "
          style={{
            backgroundColor: cfg.stripe,
            boxShadow: `0 1px 2px ${cfg.stripe}33`,
          }}
          aria-hidden
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </span>
      )}
    </span>
  );

  if (isLive && pill.url) {
    return (
      <a
        href={pill.url}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline block rounded-md transition-colors"
        style={{ ['--tier' as string]: cfg.stripe }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = `${cfg.stripe}14`)
        }
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
        title={`${pill.meta.display} — open in workspace`}
      >
        {row}
      </a>
    );
  }
  // Pending: decorative, no link.
  return <div>{row}</div>;
});

const GroupColumn = memo(function GroupColumn({
  group,
  pills,
}: {
  group: DisplayGroup;
  pills: Pill[];
}) {
  const tier = DISPLAY_GROUP_TIER[group];
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
  const cfg = TIER_CONFIG[DISPLAY_GROUP_TIER.Foundation];
  return (
    <div className="mt-5 pt-3 border-t border-dashed border-border/50 flex flex-wrap items-center gap-x-1 gap-y-1">
      <div
        className={`text-[10px] font-bold uppercase tracking-[0.12em] ${cfg.color} shrink-0 mr-3`}
      >
        Foundation
      </div>
      {pills.map((pill) => (
        <PillItem key={pill.slug} pill={pill} tier={DISPLAY_GROUP_TIER.Foundation} />
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

  const populatedGroups = DISPLAY_GROUP_ORDER.filter((g) => groups[g].length > 0);

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
