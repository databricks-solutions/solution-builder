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
   *  0 when nothing is pending. */
  remainingMinutes: number;
  /** Wall-clock "ready by" timestamp (now + remainingMinutes). null when
   *  remainingMinutes is 0. */
  readyBy: Date | null;
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

  // Sum durations only for pending capabilities. Capabilities without a
  // deployed_type don't have a "live" signal, so we leave them in the
  // pending pile and they contribute to the estimate.
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

  const readyBy = remainingMinutes > 0
    ? new Date(Date.now() + remainingMinutes * 60_000)
    : null;

  return { phase, liveCount, totalCount, remainingMinutes, readyBy, pendingSlugs, liveSlugs };
}

/** Format minutes as "~45 min" or "~1h 15min" for compact display. */
export function formatMinutes(min: number): string {
  if (min <= 0) return "0 min";
  if (min < 60) return `~${Math.round(min)} min`;
  const hours = Math.floor(min / 60);
  const rem = Math.round(min - hours * 60);
  if (rem === 0) return `~${hours}h`;
  return `~${hours}h ${rem}min`;
}

/** Format a Date as a short wall-clock time like "3:20 PM". */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
