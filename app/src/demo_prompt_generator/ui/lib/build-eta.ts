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
import type { CapabilityBuildStatus, DeployedResourceLink } from "./custom-api";

/** Slugs that ship without a deployment signal AND aren't displayed as
 *  resource tiles (talking-track only). Only used by the LEGACY fallback
 *  path (payloads without `capabilities`); the backend now omits
 *  non-buildable slugs from `capabilities` directly. */
const HIDDEN_SLUGS = new Set(["synthetic-data-gen", "genie-one", "genie-code"]);

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
  "genie-one": 2,

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
 * @param buildable     The `capabilities.buildable` array from resources.json
 *                      (only used by the legacy fallback path).
 * @param deployed      Deployed resource links (legacy fallback only).
 * @param hasStarted    True once the build has clearly kicked off
 *                      (specifications/ files exist or any resource is live).
 *                      Drives the "planning" vs "building" phase.
 * @param capabilities  Authoritative per-capability status from the backend.
 *                      Preferred source; when present, `deployed`/`buildable`
 *                      are ignored for readiness.
 */
export function estimateBuild(
  buildable: string[],
  deployed: DeployedResourceLink[],
  hasStarted: boolean,
  /** Authoritative per-capability build status from the backend
   *  (`DeployedResources.capabilities`). When present, readiness + counts come
   *  straight from it — the backend already omits non-buildable / talking-track
   *  slugs, so no `deployed_type`/URL inference is needed here. Omit only for
   *  legacy payloads that predate the field (then we fall back to URL inference). */
  capabilities?: CapabilityBuildStatus[],
): BuildEstimate {
  const liveSlugs: string[] = [];
  const pendingSlugs: string[] = [];

  if (capabilities && capabilities.length > 0) {
    // Authoritative path: the backend told us which capabilities are built.
    for (const c of capabilities) {
      if (c.built) liveSlugs.push(c.slug);
      else pendingSlugs.push(c.slug);
    }
  } else {
    // Legacy fallback (payload predates `capabilities`): infer readiness from
    // deployed-resource URLs, mirroring the old behavior. Only count known,
    // non-hidden, deployable slugs.
    const deployedTypes = new Set(deployed.map((r) => r.resource_type));
    for (const slug of buildable) {
      if (HIDDEN_SLUGS.has(slug)) continue;
      const meta = CAPABILITY_META[slug];
      if (!meta || !meta.deployed_type) continue;
      const types = Array.isArray(meta.deployed_type) ? meta.deployed_type : [meta.deployed_type];
      if (types.some((t) => deployedTypes.has(t))) liveSlugs.push(slug);
      else pendingSlugs.push(slug);
    }
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

