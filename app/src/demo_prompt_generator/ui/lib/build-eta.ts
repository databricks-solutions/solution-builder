/**
 * Build ETA estimator for the project overview.
 *
 * Maps each buildable capability to a rough build duration (minutes) and
 * exposes a single `estimateBuild` helper that returns the user-facing
 * status: how many resources are live vs pending, an estimated minutes
 * remaining, and a "ready by" wall-clock timestamp.
 *
 * Durations are intentionally rough — agent builds aren't deterministic
 * (LLM latency, retries, parallel vs serial). We show the result as
 * "estimated" in the UI, and the estimate refreshes naturally as pills
 * flip from pending → live, so it self-corrects.
 */

import { CAPABILITY_META } from "./capabilities";
import type { DeployedResourceLink } from "./custom-api";

/** Slugs that ship without a deployment signal AND aren't displayed as
 *  resource tiles (talking-track only). Excluded from the build
 *  estimate so they never gate the "Ready" phase. Keep in sync with
 *  the HIDDEN_SLUGS set in project-overview.tsx. */
const HIDDEN_SLUGS = new Set(["synthetic-data-gen", "databricks-one", "genie-code"]);

/** Rough build duration (minutes) per capability slug. Tuned for typical
 *  agent latency on a warm workspace — actual times will vary. */
const CAPABILITY_DURATION_MIN: Record<string, number> = {
  // Ingestion / processing
  "sdp": 15,
  "lakeflow-connect": 8,
  "lakeflow-jobs": 5,
  "zerobus-ingest": 8,
  "delta-sharing": 3,
  "marketplace": 2,
  "synthetic-data-gen": 5,

  // Data processing
  "ai-functions": 4,
  "metric-views": 3,

  // AI
  "knowledge-assistant": 10,
  "supervisor-agent": 6,
  "ml-training-serving": 15,
  "vector-search": 6,
  "information-extraction": 8,
  "ai-gateway": 3,

  // Analysis
  "aibi-dashboards": 4,
  "genie": 5,
  "notebooks-eda": 3,
  "genie-code": 4,

  // Analyst Layer
  "databricks-apps": 12,
  "lakebase": 6,
  "databricks-one": 2,

  // Foundation (lightweight)
  "unity-catalog": 1,
  "data-quality": 2,
  "abac": 2,
  "data-classification": 2,
};

const DEFAULT_DURATION_MIN = 5;

export type BuildPhase = "idle" | "planning" | "building" | "ready";

export interface BuildEstimate {
  phase: BuildPhase;
  /** How many buildable capabilities have flipped to live. */
  liveCount: number;
  /** Total buildable capabilities (excluding talking-track-only items). */
  totalCount: number;
  /** Rough minutes remaining until all buildable capabilities are live.
   *  Sum of the per-capability durations for slugs that haven't flipped
   *  to "live" yet. 0 when nothing is pending. Intentionally NOT paired
   *  with a wall-clock "ready by" — that pattern reads as false
   *  precision and walks forward every render. Combine with the
   *  project's createdAt in the consumer for an honest "started X ago,
   *  ~Y to go" framing. */
  remainingMinutes: number;
  /** Slugs still pending — used by the marketecture grid to render the
   *  "building..." vs "pending" distinction (any pending slug is treated
   *  as not-yet-started in this minimal version). */
  pendingSlugs: string[];
  /** Slugs that are live (matched against deployedResources). */
  liveSlugs: string[];
}

/**
 * Compute the build estimate for a project.
 *
 * @param buildable     The `capabilities.buildable` array from resources.json.
 * @param deployed      Deployed resource links from /deployed-resources.
 * @param hasStarted    True once the build has clearly kicked off
 *                      (specifications/ files exist or any resource is live).
 *                      Drives the "planning" vs "building" phase.
 */
export function estimateBuild(
  buildable: string[],
  deployed: DeployedResourceLink[],
  hasStarted: boolean,
): BuildEstimate {
  const deployedTypes = new Set(deployed.map((r) => r.resource_type));

  // Only count capabilities that:
  //   1. Are known (have a CAPABILITY_META entry)
  //   2. Aren't hidden talking-track-only slugs
  //   3. Have a `deployed_type` we can flip to "live" — otherwise the
  //      build can never reach "Ready" because the slug stays pending
  //      forever (bug: status read "Building" even after every visible
  //      tile was complete).
  const liveSlugs: string[] = [];
  const pendingSlugs: string[] = [];
  for (const slug of buildable) {
    if (HIDDEN_SLUGS.has(slug)) continue;
    const meta = CAPABILITY_META[slug];
    if (!meta || !meta.deployed_type) continue;
    const isLive = deployedTypes.has(meta.deployed_type);
    if (isLive) liveSlugs.push(slug);
    else pendingSlugs.push(slug);
  }

  const totalCount = liveSlugs.length + pendingSlugs.length;
  const liveCount = liveSlugs.length;

  // Sum durations only for buildable, deployable, still-pending slugs.
  // Hidden + non-deployable + talking-track capabilities were already
  // dropped by the filter above, so they never inflate this estimate.
  const remainingMinutes = pendingSlugs.reduce(
    (sum, slug) => sum + (CAPABILITY_DURATION_MIN[slug] ?? DEFAULT_DURATION_MIN),
    0,
  );

  let phase: BuildPhase;
  if (totalCount === 0) {
    phase = "idle";
  } else if (liveCount === totalCount) {
    phase = "ready";
  } else if (hasStarted) {
    phase = "building";
  } else {
    phase = "planning";
  }

  return { phase, liveCount, totalCount, remainingMinutes, pendingSlugs, liveSlugs };
}

/** Round minutes to a 5-min bucket so the UI never reads as fake precision
 *  ("~32 min" → "~30 min"). 0 stays 0. */
function bucket5(min: number): number {
  if (min <= 0) return 0;
  return Math.max(5, Math.round(min / 5) * 5);
}

/** Format minutes as "~30 min" or "~1h 15min" for compact display.
 *  Always 5-min-bucketed — the per-capability durations are themselves
 *  rough so single-minute precision would be a lie. */
export function formatMinutes(min: number): string {
  const m = bucket5(min);
  if (m <= 0) return "0 min";
  if (m < 60) return `~${m} min`;
  const hours = Math.floor(m / 60);
  const rem = m - hours * 60;
  if (rem === 0) return `~${hours}h`;
  return `~${hours}h ${rem}min`;
}

/** Minutes elapsed since `createdAt`. Clamps negative drift to 0. */
export function elapsedMinutes(createdAt: string | Date | null | undefined): number {
  if (!createdAt) return 0;
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

/** Human "started X ago" — minute granularity under 1h, hour+min above. */
export function formatElapsed(min: number): string {
  if (min <= 0) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  const rem = min - hours * 60;
  if (rem === 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return `${hours}h ${rem}min ago`;
}

