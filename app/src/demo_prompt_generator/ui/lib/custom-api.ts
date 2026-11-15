/**
 * Custom API client for the Databricks Asset Generator.
 *
 * Project-based architecture with file sync and Claude Code integration.
 */

import { apiUrl } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectStage =
  | "DRAFTING"
  | "SUMMARIZED"
  | "ARCHITECTED"
  | "SPECIFICATION"
  | "BUILT"
  | "BUNDLED";

export const PROJECT_STAGES: ProjectStage[] = [
  "DRAFTING",
  "SUMMARIZED",
  "ARCHITECTED",
  "SPECIFICATION",
  "BUILT",
  "BUNDLED",
];

/** The company brand a demo is personalized to — mirrors <project>/brand.json.
 *  The tiny on-disk contract the skill/app read (NOT the full resolver output). */
export interface ProjectBrand {
  company: string;
  palette: string[];
  website?: string | null;
  /** Project-root-relative filename of the company logo (company_logo.<ext>),
   *  present only when a logo was resolved. */
  company_logo?: string | null;
  /** Project-root-relative filename of the official-site screenshot
   *  (brand/website.png), present only when the capture succeeded. */
  company_official_website_screenshot?: string | null;
}

export interface Project {
  id: string;
  name: string;
  user_email: string;
  description: string | null;
  /** The company this demo is personalized to (seeded from the prompt,
   *  confirmed via the brand card). Null → show the "customize" CTA. */
  customer?: string | null;
  /** Resolved brand ({company, palette, website}) from <project>/brand.json.
   *  Populated by getProject so one load has the palette/mini-site to render.
   *  Null → no brand.json yet. */
  brand?: ProjectBrand | null;
  /** LLM-generated 1-2 paragraph storytelling summary used by the
   *  Overview hero. Distinct from `description` (the short one-liner). */
  narrative?: string | null;
  /** SHA-256 of the README that produced `narrative` — used to detect
   *  drift and auto-regenerate when the story changes substantially. */
  narrative_readme_hash?: string | null;
  project_type: string;
  stage: ProjectStage;
  /** Architecture-first project: opens on the Architecture tab and shows the
   *  "Build the solution" CTA until the build is kicked off (flag → false). */
  architecture_first?: boolean;
  /** Home-page entry mode: "story" | "architecture" | "workshop". */
  mode?: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  file_count: number;
  // Resource settings
  cluster_id: string | null;
  cluster_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  default_catalog: string | null;
  default_schema: string | null;
  /** Cross-workspace deploy target (Option A): the workspace URL this
   *  project's resources deploy INTO. Null = deploy to the app's own host
   *  workspace. Only effective when the deployer SP is configured server-side. */
  target_workspace_host?: string | null;
  // Template lineage
  source_template_id?: string | null;
  source_template_name?: string | null;
  /** Caller's access on this project: "owner" | "admin" | "editor" | "viewer".
   *  Populated by getProject; drives the read-only UI for shared viewers. */
  my_role?: string | null;
  /** "Anyone with the link" access: "none" | "viewer" | "editor". */
  link_access?: string | null;
  /** Conversation driver — the user whose PAT the agent's CLI runs as (null =
   *  unclaimed). `is_driver` = the caller currently holds it. A non-driver may
   *  STILL run the agent while `driver_token_expired` is false (they ride the
   *  driver's fresh token); once expired they must take over. */
  active_driver_email?: string | null;
  is_driver?: boolean | null;
  driver_token_age_seconds?: number | null;
  driver_token_expired?: boolean | null;
  /** SP mode: the agent runs as the deployer service principal (not a per-user
   *  OBO token), so the whole driver/take-over model is bypassed. When true the
   *  UI hides the driver banner + take-over control and never gates sending. */
  is_sp_mode?: boolean | null;
}

/** Light poll payload for the chat's driver banner (GET /driver-status). */
export interface DriverStatus {
  active_driver_email: string | null;
  is_driver: boolean;
  driver_token_age_seconds: number | null;
  driver_token_expired: boolean;
  /** SP mode — driver model bypassed; UI hides the banner + never gates sending. */
  is_sp_mode?: boolean;
}

export async function getDriverStatus(projectId: string): Promise<DriverStatus> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/driver-status`));
  if (!resp.ok) throw new Error(`Failed to get driver status: ${resp.status}`);
  return resp.json();
}

// --- /internal live runtime metrics -----------------------------------------
export interface InternalMetricsSample {
  t: number;                        // unix seconds
  // Memory breakdown (see the /internal Memory chart). RSS is per-process; the
  // container total is the cgroup number (the OOM signal).
  rss_mb: number | null;            // alias of main_rss_mb (back-compat)
  main_rss_mb: number | null;       // the uvicorn app process
  children_rss_mb: number | null;   // sum of ALL child processes
  total_rss_mb: number | null;      // main + children (summed RSS; overcounts shared)
  claude_rss_mb: number | null;     // Claude Code session subprocesses
  preview_rss_mb: number | null;    // live preview-app subprocess trees
  other_rss_mb: number | null;      // bash / databricks CLI / uv children
  children: number | null;          // child process count
  cgroup_used_mb: number | null;    // container memory charged (authoritative)
  cgroup_limit_mb: number | null;   // container memory limit (OOM boundary)
  cgroup_percent: number | null;
  mem_percent: number | null;
  agent_sessions: number | null;
  agent_sessions_busy: number | null;
  active_streams: number | null;
  live_streams: number | null;
  collab_rooms: number | null;
  collab_members: number | null;
  preview_states: number | null;
  preview_running: number | null;
  // Wedge-diagnosis gauges: threadpool saturation, DB-pool exhaustion, loop lag.
  threadpool_total: number | null;
  threadpool_borrowed: number | null;
  threadpool_waiting: number | null;
  db_pool_checked_out: number | null;
  db_pool_size: number | null;
  db_pool_overflow: number | null;
  loop_lag_ms: number | null;
  uptime_s: number;
  [k: string]: number | null;
}
export interface InternalMetrics {
  gauges: InternalMetricsSample;
  counters: Record<string, number>;
  history: InternalMetricsSample[];
  sample_interval_s: number;
}

export async function getInternalMetrics(): Promise<InternalMetrics> {
  const resp = await fetch(apiUrl("/api/internal/metrics"));
  if (!resp.ok) {
    const e = new Error(`Failed to get metrics: ${resp.status}`) as Error & { status?: number };
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

/** One project currently holding a live Claude Code agent session. Admin-only. */
export interface ActiveSession {
  project_id: string;
  project_name: string | null;
  owner_email: string | null;
  is_busy: boolean;
  has_live_stream: boolean;
  idle_seconds: number;
  age_seconds: number;
  project_url: string;
}

export interface ActiveSessionsResponse {
  is_admin: boolean;
  sessions: ActiveSession[];
}

/** Admin-only. Returns 403 for non-admins (caller should catch and hide the section). */
export async function getActiveSessions(): Promise<ActiveSessionsResponse> {
  const resp = await fetch(apiUrl("/api/internal/active-sessions"));
  if (resp.status === 403) return { is_admin: false, sessions: [] };
  if (!resp.ok) throw new Error(`Failed to get active sessions: ${resp.status}`);
  return resp.json();
}

export interface ProjectListItem {
  id: string;
  name: string;
  description?: string | null;
  /** Customer/account this project is for (null → "Not specified"). */
  customer?: string | null;
  project_type: string;
  stage: ProjectStage;
  /** Home entry mode: a full solution ("story"), an architecture or a workshop. */
  mode?: "story" | "architecture" | "workshop";
  created_at: string;
  updated_at: string;
  message_count: number;
  file_count: number;
  is_starred: boolean;
  shared_by?: string | null;
  shared_message?: string | null;
  // Caller's access on a shared project: "viewer" | "editor" (null if owner).
  shared_role?: ShareRole | null;
  owner_email?: string | null;
  // Template lineage
  source_template_id?: string | null;
  source_template_name?: string | null;
}

export type ShareRole = "viewer" | "editor";
export type ShareStatus = "pending" | "accepted" | "declined";

export interface ProjectShareOut {
  id: number;
  project_id: string;
  owner_email: string;
  shared_with_email: string;
  message: string | null;
  role: ShareRole;
  status: ShareStatus;
  created_at: string;
  responded_at?: string | null;
  // Populated on the recipient's invitations feed.
  project_name?: string | null;
}

export interface ProjectFile {
  path: string;
  name: string;
  size: number;
  last_modified: string;
  synced_at: string;
  /** True when the standard listing would normally hide this file
   *  (.databrickscfg, .claude/skills/, hidden tempfiles). Only ever
   *  present when listProjectFiles was called with includeHidden=true. */
  is_hidden?: boolean;
}

export interface ProjectFileContent {
  path: string;
  content: string;
  size: number;
  last_modified: string;
}

export interface DeployedResourceLink {
  resource_type: string;
  label: string;
  url: string | null;
  resource_id: string | null;
}

/** Per-capability build status, computed once in the backend from
 *  resources.json (the authoritative signal — NOT re-inferred from URLs). */
export interface CapabilityBuildStatus {
  slug: string;
  built: boolean;
}

export interface DeployedResources {
  resources: DeployedResourceLink[];
  deployed_at: string | null;
  /** Non-null when the LLM-based resources.json extractor failed (auth,
   *  model unavailable, malformed response). Surface this so users don't
   *  see an empty list and assume nothing was deployed. */
  extraction_error?: string | null;
  /** Authoritative per-buildable-capability status from resources.json. The
   *  UI's live "N of N ready" meter + tile live/pending state read this
   *  directly instead of inferring readiness from deep-link URLs. Absent on
   *  older payloads (frontend falls back to URL inference then). */
  capabilities?: CapabilityBuildStatus[];
  /** True when every buildable capability is built — the "done" latch. */
  all_built?: boolean;
}

// Reasoning entry types for ordered thinking/tool display
export interface ThinkingEntry {
  type: "thinking";
  content: string;
  /** Wall-clock timestamps for the underlying ThinkingBlock. Optional —
   *  legacy entries persisted before the timeline rewrite lack these,
   *  in which case the UI falls back to inferring duration from the
   *  surrounding tool calls (or just renders "Thought" without one). */
  started_at?: string;
  completed_at?: string;
}

export interface ToolEntry {
  type: "tool";
  id: string;
  name: string;
  input: unknown;
  started_at?: string;
}

export interface ToolResultEntry {
  type: "tool_result";
  tool_id: string;
  content: string;
  is_error: boolean;
  completed_at?: string;
}

export type ReasoningEntry = ThinkingEntry | ToolEntry | ToolResultEntry;

export interface MessageReasoningData {
  reasoning?: ReasoningEntry[];
}

export interface Message {
  id: number;
  project_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** What the user had open in the UI when they sent this message (e.g. "the
   *  architecture diagram"). Shown as a small "C" badge on the user bubble.
   *  Null/absent when no context applied (overview/story) or for non-user roles. */
  context_hint?: string | null;
  is_error: boolean;
  is_cancelled?: boolean;
  /** True when the server has compressed reasoning bytes for this message.
   *  The UI uses this to decide whether to render the Reasoning toggle.
   *  Actual payload is fetched lazily via getMessageReasoning(id). */
  has_reasoning?: boolean;
  /** Only populated after a lazy fetch from getMessageReasoning(id). */
  reasoning_data?: MessageReasoningData | null;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface InvokeAgentResponse {
  execution_id: string;
  project_id: string;
}

export interface Execution {
  id: string;
  project_id: string;
  status: "running" | "completed" | "cancelled" | "error";
  session_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncStats {
  restored: number;
  synced: number;
  conflicts: number;
}

// Agent streaming events
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "text"; text: string }
  | { type: "text_block_start" }
  | { type: "thinking"; thinking: string }
  | { type: "thinking_delta"; thinking: string; timestamp?: string }
  | { type: "tool_use"; tool_id: string; tool_name: string; tool_input: unknown; timestamp?: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean; timestamp?: string }
  | { type: "result"; session_id: string | null; duration_ms: number; total_cost_usd?: number; is_error?: boolean; num_turns?: number }
  | { type: "system"; subtype: string; data: unknown }
  | { type: "file_changed"; path: string }
  | { type: "narrative_updated"; narrative: string; narrative_readme_hash: string }
  | { type: "error"; error: string }
  | { type: "cancelled" }
  | { type: "stream.completed"; is_error: boolean; is_cancelled: boolean }
  | { type: "stream.reconnect"; execution_id: string; last_timestamp: number }
  | { type: "keepalive"; elapsed_since_last_event: number }
  | { type: "unknown"; message_type: string; data: string };

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

export async function listProjects(
  options?: { includeAll?: boolean }
): Promise<ProjectListItem[]> {
  const path = options?.includeAll
    ? "/api/projects?include_all=true"
    : "/api/projects";
  const resp = await fetch(apiUrl(path));
  if (!resp.ok) throw new Error(`Failed to list projects: ${resp.status}`);
  return resp.json();
}

/**
 * One file the user uploaded on the home page. Round-tripped through
 * the frontend: backend extracts text → frontend holds → posted back to
 * createProject so the originals land in the new project's
 * context/uploads/ dir alongside `.extracted.md` siblings.
 */
export interface UploadedFile {
  filename: string;
  content_type: string;
  size_bytes: number;
  text: string;
  truncated: boolean;
  original_b64: string | null;
}

// Reject obviously-too-big uploads before we even POST them. This is
// rough on purpose — the goal is "don't try to push a 1GB CSV through",
// not a strict accounting. Backend re-checks.
const MAX_TOTAL_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Send files to /api/uploads/extract for text extraction. Pure stateless
 * call — no project ID, nothing persisted server-side. The caller holds
 * the returned array in component state and ships it back to createProject.
 *
 * Hard caps enforced by the backend: 10 MB per file, 5 files per request,
 * ~50 MB total, 30 KB extracted text per file. Errors come back as 4xx
 * with a readable detail string we surface verbatim.
 */
export async function extractFiles(files: File[]): Promise<UploadedFile[]> {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_UPLOAD_BYTES) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Upload too large: ${mb(total)} MB total. Max is ${mb(MAX_TOTAL_UPLOAD_BYTES)} MB across all attached files.`,
    );
  }
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const resp = await fetch(apiUrl("/api/uploads/extract"), {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    let detail = `Upload failed: ${resp.status}`;
    try {
      const j = (await resp.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* non-JSON body — keep the status-line fallback */
    }
    throw new Error(detail);
  }
  return resp.json();
}

// --- Company brand (logo + palette) -----------------------------------------

export interface BrandLogoCandidate {
  source: string; // jsonld / inline-svg / header-img / og:image / favicon
  url: string;
  data_url: string;
  content_type: string | null;
  chosen: boolean;
  dims?: { w: number; h: number; aspect: number } | null;
}

export interface BrandTraceStep {
  t_ms?: number;
  kind: string; // tool | decision | reasoning | warning | phase
  tool?: string;
  args?: unknown;
  summary?: unknown;
  reasoning?: string;
  detail?: string;
}

export interface BrandLogoProvenance {
  n: number;
  type?: string;
  source?: string;
  host?: string;
  official?: boolean;
  verdict?: string; // chosen | alternate | rejected | candidate
  image?: string;
}

export interface BrandOut {
  name: string;
  /** Official registrable domain (databricks.com). */
  domain: string | null;
  /** Where the logo/palette were harvested (brand.databricks.com / a CDN) —
   *  informational, distinct from the official domain. */
  asset_source?: string | null;
  confidence: number;
  logo_url: string | null;
  logo_data_url: string | null;
  logos: BrandLogoCandidate[];
  palette: string[];
  /** Square symbol without the name, SVG data URL (fresh resolves only). */
  symbol_data_url?: string | null;
  symbol_source?: string | null; // "bimi" | "simpleicons"
  source: string | null;
  warnings: string[];
  // debug / "see reasoning" surfaces
  logo_contact_sheet?: string | null; // data URL of the grading grid the model saw
  logo_provenance?: BrandLogoProvenance[];
  site_screenshot?: string | null; // data URL of the official-site screenshot
  trace?: BrandTraceStep[];
  /** Server log lines from this resolve (empty on a cache hit). */
  logs?: string[];
}

export interface BrandDiagnostics {
  playwright_browsers_path: string | null;
  installed_browsers: string[];
  /** Tail of start.sh's Playwright browser install output. */
  install_log: string | null;
  packages: Record<string, string | null>;
  /** Shared libs the headless shell can't load (ldd "not found"). */
  missing_libs: string[];
  os: string | null;
}

export async function getBrandDiagnostics(): Promise<BrandDiagnostics> {
  const resp = await fetch(apiUrl("/api/brands/diagnostics"));
  if (!resp.ok) throw new Error(`Brand diagnostics failed: ${resp.status}`);
  return resp.json();
}

/**
 * Resolve a company's brand (official domain + logo candidates + color palette)
 * from just its name. Best-effort + slow (the backend runs an agent loop that
 * searches, fetches, and extracts) — expect ~15–40s. Always resolves to a
 * BrandOut; missing pieces come back empty with `warnings`.
 */
export async function resolveBrand(name: string, opts?: { noCache?: boolean }): Promise<BrandOut> {
  const q = new URLSearchParams({ name });
  if (opts?.noCache) q.set("no_cache", "true");
  const resp = await fetch(apiUrl(`/api/brands/resolve?${q.toString()}`));
  if (!resp.ok) {
    let detail = `Brand lookup failed: ${resp.status}`;
    try {
      const j = (await resp.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* non-JSON body — keep the status-line fallback */
    }
    throw new Error(detail);
  }
  return resp.json();
}

/**
 * Personalize a project to a real company: resolve (or save) its brand and write
 * <project>/brand.json. `search: true` runs the brand service (slow, ~15-40s);
 * `search: false` saves the given palette/website as-is (a manual edit). Returns
 * the refreshed Project (with `brand` populated).
 */
export async function setProjectBrand(
  projectId: string,
  body: { company: string; search: boolean; palette?: string[]; website?: string | null; no_cache?: boolean },
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/brand`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = `Brand update failed: ${resp.status}`;
    try {
      const j = (await resp.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* keep status-line fallback */
    }
    throw new Error(detail);
  }
  return resp.json();
}

/** A single idea in the discovery payload (chosen or alternative). Mirrors the
 *  backend DiscoveryIdea — a subset of UseCaseIdea persisted to
 *  specifications/data-discovery.md. */
export interface DiscoveryIdeaInput {
  title: string;
  hook?: string;
  why?: string;
  fit?: IdeaFit;
}

/** The "Use existing data" discovery analysis carried into project creation so
 *  the build agent inherits what the LLM learned. Mirrors backend
 *  DiscoveryAnalysis. */
export interface DiscoveryInput {
  chosen?: DiscoveryIdeaInput;
  alternatives?: DiscoveryIdeaInput[];
  reasoning?: string | null;
}

export async function createProject(
  description: string,
  capabilities: string[] = [],
  initialPrompt?: string,
  contextFiles?: UploadedFile[],
  architectureFirst = false,
  mode: "story" | "architecture" | "workshop" = "story",
  blankArchitecture = false,
  // The user's RAW typed/pasted brief, verbatim (no "Help me build…"
  // wrapper, no capability line, no brand/kickoff appendix). When it's a
  // substantial pasted spec the backend saves it to context/source-brief.md
  // so the build agent has a durable, lossless copy of the user's intent.
  sourceBrief?: string,
  // "Use existing data": fully-qualified real UC tables (catalog.schema.table)
  // the demo is built ON. When non-empty the backend writes their schema +
  // sample rows to specifications/source-tables.md.
  groundingTables?: string[],
  // "Use existing data" opt-in: when false (default) the grounded demo is
  // read-only analytics on the real tables; when true it may create its OWN
  // auxiliary data (real tables stay read-only). Only meaningful when
  // groundingTables is non-empty.
  allowDataWrite = false,
  // "Use existing data": the analysis the discovery step produced (chosen
  // use-case + its data-fit rationale, the alternatives it surfaced, the
  // capability reasoning). When present the backend writes it to
  // specifications/data-discovery.md so the build agent inherits what the LLM
  // already learned instead of re-deriving it. Only meaningful when grounded.
  discovery?: DiscoveryInput,
): Promise<Project> {
  const resp = await fetch(apiUrl("/api/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      capabilities,
      initial_prompt: initialPrompt,
      context_files: contextFiles ?? [],
      architecture_first: architectureFirst,
      blank_architecture: blankArchitecture,
      mode,
      source_brief: sourceBrief,
      grounding_tables: groundingTables ?? [],
      allow_data_write: allowDataWrite,
      discovery,
    }),
  });
  if (!resp.ok) throw new Error(`Failed to create project: ${resp.status}`);
  return resp.json();
}

/** The standalone architecture editor HTML template (the skill's renderer).
 *  Callers inject the current diagram JSON into its inline block to produce a
 *  self-contained, shareable + editable architecture page. */
export async function getArchitectureStandaloneTemplate(): Promise<string> {
  const resp = await fetch(apiUrl("/api/constants/architecture-standalone-template"));
  if (!resp.ok) throw new Error(`Standalone template unavailable: ${resp.status}`);
  return resp.text();
}

export async function getProject(projectId: string): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`));
  if (!resp.ok) throw new Error(`Failed to get project: ${resp.status}`);
  return resp.json();
}

export async function updateProject(
  projectId: string,
  updates: {
    name?: string;
    description?: string;
    customer?: string;
    architecture_first?: boolean;
    /** Workspace URL to deploy this project's resources into (Option A).
     *  Empty string clears it (→ deploy to the app's own workspace). */
    target_workspace_host?: string;
  }
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!resp.ok) throw new Error(`Failed to update project: ${resp.status}`);
  return resp.json();
}

export interface UserSettings {
  target_workspace_host?: string | null;
  /** What deploys actually use = user setting or the server default. */
  effective_target_workspace_host?: string | null;
  /** Whether the deployer SP is configured (cross-workspace deploy is live).
   *  When false the deploy-target control is inert, so the UI hides it. */
  cross_workspace_deploy_enabled?: boolean;
  /** The server's shared-default host — lets the UI label a saved target that
   *  equals the default as "shared default" instead of its raw name.
   *  (`cross_workspace_deploy_enabled` above is the deployer-SP tier gate.) */
  default_target_workspace_host?: string | null;
}

/** Per-user account settings (cross-workspace deploy target — applies to ALL
 *  the user's projects). Set once via the home-page control. */
export async function getMySettings(): Promise<UserSettings> {
  const resp = await fetch(apiUrl("/api/me/settings"));
  if (!resp.ok) throw new Error(`Failed to load settings: ${resp.status}`);
  return resp.json();
}

export async function updateMySettings(
  targetWorkspaceHost: string | null,
): Promise<UserSettings> {
  const resp = await fetch(apiUrl("/api/me/settings"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_workspace_host: targetWorkspaceHost }),
  });
  if (!resp.ok) throw new Error(`Failed to save settings: ${resp.status}`);
  return resp.json();
}

export interface TargetValidation {
  host: string;
  reachable: boolean;
  is_admin: boolean;
  region?: string | null;
  catalog?: string | null;
  /** ready | out_of_account | needs_admin | region_unsupported | region_unknown */
  status: string;
  can_deploy: boolean;
  message: string;
  deployer_sp_name?: string | null;
  /** Application (client) ID the workspace "Add service principal" UI needs. */
  deployer_sp_application_id?: string | null;
  admin_settings_url?: string | null;
  /** Ready-to-show steps (incl. "you must be a workspace admin") when needs_admin. */
  admin_instructions?: string | null;
}

/** Validate a candidate cross-workspace deploy target as the deployer SP
 *  (project-independent — used by the home-page account-level target control).
 *  Does NOT save it — call updateMySettings once status === "ready". */
export async function validateMyTarget(
  targetWorkspaceHost: string,
): Promise<TargetValidation> {
  const resp = await fetch(apiUrl(`/api/me/validate-target`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_workspace_host: targetWorkspaceHost }),
  });
  if (!resp.ok) throw new Error(`Failed to validate target: ${resp.status}`);
  return resp.json();
}

/** Provision the workspace scaffolding an architecture-first project deferred at
 *  creation (LLM name/schema, warehouse discovery, CREATE SCHEMA, resources.json).
 *  Does NOT run the build — the "Build the solution" dialog calls it right before
 *  sending the build prompt. Idempotent. */
export async function provisionArchitectureProject(
  projectId: string,
  body: { description?: string; capabilities?: string[] },
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/provision-architecture`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Failed to provision project: ${resp.status}`);
  return resp.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`), { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete project: ${resp.status}`);
}

export async function aiEditProjectDescription(
  projectId: string,
  currentDescription: string | null,
  instruction: string,
): Promise<{ description: string }> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/description/ai-edit`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_description: currentDescription,
        instruction,
      }),
    },
  );
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(detail || `AI edit failed: ${resp.status}`);
  }
  return resp.json();
}

/** Generate (or regenerate) the LLM-driven storytelling narrative shown
 *  on the Overview hero. Reads README.md server-side and saves the result
 *  to `project.narrative`. Returns the updated project. */
export async function generateProjectNarrative(projectId: string): Promise<Project> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/narrative/generate`),
    { method: "POST" },
  );
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(detail || `Narrative generation failed: ${resp.status}`);
  }
  return resp.json();
}

export async function syncProject(projectId: string): Promise<SyncStats> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/sync`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to sync project: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Starring
// ---------------------------------------------------------------------------

export async function toggleProjectStar(
  projectId: string
): Promise<{ starred: boolean; project_id: string }> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/star`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to toggle star: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export async function shareProject(
  projectId: string,
  email: string,
  role: ShareRole = "viewer",
  message?: string
): Promise<ProjectShareOut> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/share`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role, message }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to share project: ${resp.status}`);
  }
  return resp.json();
}

/** "Anyone with the link" access level. "none" turns it off. */
export type LinkAccess = "none" | "viewer" | "editor";

export async function setProjectLinkAccess(
  projectId: string,
  linkAccess: LinkAccess,
): Promise<{ link_access: LinkAccess }> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/link-access`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ link_access: linkAccess }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to set link access: ${resp.status}`);
  }
  return resp.json();
}

export async function updateProjectShare(
  projectId: string,
  shareId: number,
  role: ShareRole
): Promise<ProjectShareOut> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/share/${shareId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update share: ${resp.status}`);
  }
  return resp.json();
}

export async function listProjectShares(
  projectId: string
): Promise<ProjectShareOut[]> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/shares`));
  if (!resp.ok) throw new Error(`Failed to list shares: ${resp.status}`);
  return resp.json();
}

export async function unshareProject(
  projectId: string,
  shareId: number
): Promise<void> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/share/${shareId}`),
    { method: "DELETE" }
  );
  if (!resp.ok) throw new Error(`Failed to unshare: ${resp.status}`);
}

export async function listSharedProjects(): Promise<ProjectListItem[]> {
  const resp = await fetch(apiUrl("/api/shared-projects"));
  if (!resp.ok) throw new Error(`Failed to list shared projects: ${resp.status}`);
  return resp.json();
}

/** Everything the home page needs in one call — owned + shared + invitations —
 *  so all three sections render together instead of popping in separately. */
export interface HomeProjects {
  owned: ProjectListItem[];
  shared: ProjectListItem[];
  invitations: ProjectShareOut[];
}

export async function getHomeProjects(): Promise<HomeProjects> {
  const resp = await fetch(apiUrl("/api/projects/home"));
  if (!resp.ok) throw new Error(`Failed to load home projects: ${resp.status}`);
  return resp.json();
}

/** Pending share invitations addressed to the current user (notifications). */
export async function listShareInvitations(): Promise<ProjectShareOut[]> {
  const resp = await fetch(apiUrl("/api/share-invitations"));
  if (!resp.ok) throw new Error(`Failed to list invitations: ${resp.status}`);
  return resp.json();
}

/** Accept or decline a pending share invitation. */
export async function respondToShare(
  projectId: string,
  accept: boolean
): Promise<ProjectShareOut> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/share/respond`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to respond: ${resp.status}`);
  }
  return resp.json();
}

/** Clone any project the caller can read into a new project they own. */
export async function cloneProject(projectId: string): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/clone`), {
    method: "POST",
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to clone project: ${resp.status}`);
  }
  return resp.json();
}

/** Become the conversation driver (the identity the agent's CLI runs as).
 *  Rejects (409) while a run is in progress. Returns the updated project. */
export async function takeOverProject(projectId: string): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/take-over`), {
    method: "POST",
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to take over project: ${resp.status}`);
  }
  return resp.json();
}

export interface ProjectResourcesUpdate {
  cluster_id?: string | null;
  cluster_name?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  default_catalog?: string | null;
  default_schema?: string | null;
}

export async function updateProjectResources(
  projectId: string,
  resources: ProjectResourcesUpdate
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/resources`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resources),
  });
  if (!resp.ok) throw new Error(`Failed to update resources: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Project Files API
// ---------------------------------------------------------------------------

export async function listProjectFiles(
  projectId: string,
  opts: { force?: boolean; includeHidden?: boolean } = {}
): Promise<ProjectFile[]> {
  const params = new URLSearchParams();
  if (opts.force) params.set("force", "true");
  if (opts.includeHidden) params.set("include_hidden", "true");
  const qs = params.toString();
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/files${qs ? "?" + qs : ""}`),
  );
  if (!resp.ok) throw new Error(`Failed to list files: ${resp.status}`);
  return resp.json();
}

export async function getProjectFile(
  projectId: string,
  filePath: string
): Promise<ProjectFileContent> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/files/${filePath}`));
  if (!resp.ok) throw new Error(`Failed to get file: ${resp.status}`);
  return resp.json();
}

/** Write text content to a project file (architecture.md only, per backend
 *  allowlist). Used by the architecture canvas to persist layout. */
export async function saveProjectFile(
  projectId: string,
  filePath: string,
  content: string
): Promise<ProjectFileContent> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/files/${filePath}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const e = new Error(`Failed to save file: ${resp.status}`) as Error & { status?: number };
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

/** One architecture-history snapshot (metadata only — content fetched lazily). */
export interface ArchitectureHistoryEntry {
  id: number;
  created_at: string;
  /** True when this snapshot was created by restoring an earlier version. */
  is_restore: boolean;
}

/** A history snapshot's decompressed `architecture.md` markdown. */
export interface ArchitectureHistoryContent {
  id: number;
  created_at: string;
  content: string;
}

/** List a project's architecture-history snapshots, newest first (metadata only). */
export async function listArchitectureHistory(
  projectId: string,
  limit = 50
): Promise<ArchitectureHistoryEntry[]> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/architecture-history?limit=${limit}`),
  );
  if (!resp.ok) throw new Error(`Failed to list architecture history: ${resp.status}`);
  return resp.json();
}

/** Fetch the decompressed markdown for one architecture-history snapshot. */
export async function getArchitectureHistoryContent(
  projectId: string,
  historyId: number
): Promise<ArchitectureHistoryContent> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/architecture-history/${historyId}/content`),
  );
  if (!resp.ok) throw new Error(`Failed to get architecture history: ${resp.status}`);
  return resp.json();
}

/** Restore a snapshot: the backend writes it to architecture.md and records a
 *  new PROTECTED restore entry (never compacted, alongside its source). Returns
 *  the restored content so the caller re-seeds the canvas. */
export async function restoreArchitectureHistory(
  projectId: string,
  historyId: number
): Promise<ArchitectureHistoryContent> {
  const resp = await fetch(
    apiUrl(`/api/projects/${projectId}/architecture-history/${historyId}/restore`),
    { method: "POST" },
  );
  if (!resp.ok) throw new Error(`Failed to restore architecture history: ${resp.status}`);
  return resp.json();
}

/** POST a PNG snapshot of the live architecture canvas so the backend saves it
 *  as `architecture.png` (the agent can then read a rendered image). Best-effort:
 *  callers ignore failures — a missing snapshot just means the agent doesn't
 *  "see" this render. */
export async function saveArchitectureSnapshot(
  projectId: string,
  dataUrl: string,
): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/architecture-snapshot`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl }),
  });
  if (!resp.ok) throw new Error(`Failed to save architecture snapshot: ${resp.status}`);
}

export async function getDeployedResources(projectId: string): Promise<DeployedResources> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/deployed-resources`));
  if (!resp.ok) {
    if (resp.status === 404) return { resources: [], deployed_at: null };
    throw new Error(`Failed to get deployed resources: ${resp.status}`);
  }
  return resp.json();
}

/** Save a zip response to disk, named by its Content-Disposition (or fallback). */
async function saveZipResponse(resp: Response, fallbackName: string): Promise<void> {
  const contentDisposition = resp.headers.get("Content-Disposition");
  let filename = fallbackName;
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/);
    if (match) filename = match[1];
  }

  const blob = await resp.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke later: revoking right after click() can cancel the download.
  setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
}

export async function downloadProjectAsZip(projectId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/download`));
  if (!resp.ok) throw new Error(`Failed to download project: ${resp.status}`);
  await saveZipResponse(resp, "project.zip");
}

/** Genie Code workshop attendee kit (workshop page + CONTEXT + specs + data gen). */
export async function downloadWorkshopKit(projectId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/workshop-kit`));
  if (!resp.ok) throw new Error(`Failed to download workshop kit: ${resp.status}`);
  await saveZipResponse(resp, "workshop-kit.zip");
}


// ---------------------------------------------------------------------------
// Messages API
// ---------------------------------------------------------------------------

export async function listProjectMessages(projectId: string): Promise<Message[]> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/messages`));
  if (!resp.ok) throw new Error(`Failed to list messages: ${resp.status}`);
  return resp.json();
}

export async function addProjectMessage(
  projectId: string,
  message: { role: string; content: string; is_error?: boolean }
): Promise<Message> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/messages`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!resp.ok) throw new Error(`Failed to add message: ${resp.status}`);
  return resp.json();
}

export async function clearProjectMessages(projectId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/messages`), {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`Failed to clear messages: ${resp.status}`);
}

/** Lazy-fetch the decompressed reasoning for a single message. Returns `null`
 *  when the server has no reasoning stored for that message. */
export async function getMessageReasoning(
  messageId: number
): Promise<MessageReasoningData | null> {
  const resp = await fetch(apiUrl(`/api/messages/${messageId}/reasoning`));
  if (!resp.ok) throw new Error(`Failed to fetch reasoning: ${resp.status}`);
  const data = await resp.json();
  return data.reasoning_data ?? null;
}

/** Token totals + list-price cost. `cache_write_tokens` = 5-minute + 1-hour writes. */
export interface UsageTotals {
  responses: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  /** Responses from a model with no known price — not included in cost_usd. */
  unpriced_responses: number;
}

export interface ProjectUsage {
  totals: UsageTotals;
  conversations: {
    session_id: string;
    started_at: string;
    ended_at: string;
    totals: UsageTotals;
    /** "main" first, then one entry per subagent type. */
    agents: { agent: string; subagents: number; totals: UsageTotals }[];
  }[];
  models: { model: string; priced_as: string | null; estimated: boolean; totals: UsageTotals }[];
}

/** What the project's agent conversations cost so far (main agent + subagents, cleared chats included). */
export async function getProjectUsage(projectId: string): Promise<ProjectUsage> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/usage`));
  if (!resp.ok) throw new Error(`Failed to fetch usage: ${resp.status}`);
  return resp.json();
}

export async function clearProjectSession(projectId: string): Promise<{ success: boolean; deleted_count: number }> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/session/clear`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to clear session: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Agent API
// ---------------------------------------------------------------------------

/** An image pasted into the chat composer (base64 without the data: prefix). */
export interface ChatImage {
  filename: string;
  media_type: string;
  data_b64: string;
}

export async function invokeAgent(
  projectId: string,
  message: string,
  options: { saveUserMessage?: boolean; contextHint?: string; images?: ChatImage[] } = {},
): Promise<InvokeAgentResponse> {
  const resp = await fetch(apiUrl("/api/invoke_agent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      message,
      save_user_message: options.saveUserMessage ?? true,
      // Only send when set — omitted on overview/story tabs.
      ...(options.contextHint ? { context_hint: options.contextHint } : {}),
      // Saved under context/uploads/ and sent to the model as image blocks.
      ...(options.images?.length ? { images: options.images } : {}),
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    // Surface the HTTP status so callers can special-case (e.g. 409 = another
    // user is driving this conversation → show the "take over" banner).
    const e = new Error(err.detail || `Failed to invoke agent: ${resp.status}`) as Error & { status?: number };
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

export async function* streamAgentProgress(
  executionId: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  let cursor = 0;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  // Server's SSE window is ~50s + small grace. If a fetch stays silent past this,
  // the backend event loop is probably blocked — abort so we can retry.
  const STREAM_FETCH_TIMEOUT_MS = 75_000;

  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), STREAM_FETCH_TIMEOUT_MS);
    // Combine user-provided signal with the timeout signal
    const combinedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const resp = await fetch(apiUrl(`/api/stream_progress/${executionId}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_timestamp: cursor }),
        signal: combinedSignal,
      });

      if (!resp.ok) {
        const e = new Error(`Stream failed: ${resp.status}`) as Error & { status?: number };
        e.status = resp.status;
        throw e;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let shouldReconnect = false;
      // Did we observe an explicit terminator from the server?
      // - `[DONE]` sentinel
      // - `stream.completed` event
      // - `stream.reconnect` event
      // If `reader.read()` returns `done: true` WITHOUT one of these, the
      // browser silently dropped the streaming body (common in backgrounded
      // tabs after long throttling). Treat that as a reconnect, not a clean
      // exit — otherwise the consumer thinks the agent finished when it
      // didn't, and we never resume.
      let sawTerminator = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Data arrived, so the connection is healthy: the retry budget is for
        // consecutive failures, not a lifetime cap on a long-running turn.
        reconnectAttempts = 0;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const payload = part.slice(6);
          if (payload === "[DONE]") {
            sawTerminator = true;
            return;
          }

          try {
            const event = JSON.parse(payload) as AgentEvent;

            // Update cursor for reconnection
            if ("_cursor" in event) {
              cursor = (event as { _cursor: number })._cursor;
            }

            // Handle reconnect signal
            if (event.type === "stream.reconnect") {
              sawTerminator = true;
              shouldReconnect = true;
              break;
            }

            // Handle completion
            if (event.type === "stream.completed") {
              sawTerminator = true;
              yield event;
              return;
            }

            yield event;
          } catch {
            // Skip malformed events
          }
        }

        if (shouldReconnect) break;
      }

      if (shouldReconnect) {
        // Small delay before reconnecting
        await new Promise(r => setTimeout(r, 100));
        reconnectAttempts++;
        continue;
      }

      // Stream ended without an explicit terminator — the body was dropped
      // (backgrounded tab, proxy idle close, network blip). Reconnect with
      // the last cursor instead of declaring the run finished.
      if (!sawTerminator) {
        reconnectAttempts++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Normal end of stream (terminator received).
      return;
    } catch (error) {
      // User-initiated abort — stop entirely.
      if ((error as Error).name === "AbortError" && signal?.aborted) {
        return;
      }
      // Auth / not-found won't heal on retry. After a backend restart the
      // execution is gone (404), and retrying 10x in lockstep from every open
      // tab just hammers the server. Surface it now, like exhausted retries.
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) {
        throw new Error(
          `Stream failed (${status}). The run may have ended — try reloading the page.`
        );
      }
      // Timeout or connection error — retry with full-jitter backoff so tabs
      // that lost the same connection don't reconnect in lockstep.
      reconnectAttempts++;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        throw new Error(
          `Stream failed after ${MAX_RECONNECT_ATTEMPTS} retries. The backend may be unresponsive — try reloading the page.`
        );
      }
      await new Promise(r => setTimeout(r, Math.random() * 1000 * reconnectAttempts));
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export async function stopAgentStream(executionId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/stop_stream/${executionId}`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to stop stream: ${resp.status}`);
}

export async function getActiveExecution(projectId: string): Promise<Execution | null> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/execution`));
  if (!resp.ok) throw new Error(`Failed to get execution: ${resp.status}`);
  const data = await resp.json();
  return data || null;
}

// ---------------------------------------------------------------------------
// Skills API
// ---------------------------------------------------------------------------

export interface Skill {
  name: string;
  description: string;
  dir_name: string;
}

export interface SkillFile {
  path: string;
  name: string;
  is_dir: boolean;
  children?: SkillFile[];
}

export interface SkillFileContent {
  path: string;
  content: string;
}

export async function getProjectSkills(projectId: string): Promise<Skill[]> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/skills`));
  if (!resp.ok) throw new Error(`Failed to get skills: ${resp.status}`);
  return resp.json();
}

export async function getSkillFiles(projectId: string, skillName: string): Promise<SkillFile[]> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/skills/${skillName}/files`));
  if (!resp.ok) throw new Error(`Failed to get skill files: ${resp.status}`);
  return resp.json();
}

export async function getSkillFileContent(
  projectId: string,
  skillName: string,
  filePath: string
): Promise<SkillFileContent> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/skills/${skillName}/files/${filePath}`));
  if (!resp.ok) throw new Error(`Failed to get skill file: ${resp.status}`);
  return resp.json();
}

export async function refreshProjectSkills(projectId: string): Promise<{ success: boolean; skills: Skill[] }> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/skills/refresh`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to refresh skills: ${resp.status}`);
  return resp.json();
}

export async function getProjectSystemPrompt(projectId: string): Promise<string> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/system-prompt`));
  if (!resp.ok) throw new Error(`Failed to get system prompt: ${resp.status}`);
  const data = await resp.json();
  return data.prompt;
}

/** A single env var that would be passed to the next Claude Agent SDK
 *  subprocess run for this project. Token-shaped values are server-side
 *  redacted (first4 + last4 only) — never echo `value` back to a place
 *  where it could leak the token. */
export interface AgentEnvVar {
  name: string;
  value: string;
  redacted: boolean;
}

export interface AgentEnvSnapshot {
  /** Deployment mode. "deployed" = Databricks Apps (multi-user, SP for
   *  Claude, user PAT for `databricks ...` CLI). "local" = single-user
   *  laptop. See backend/AUTH.md. */
  mode: "local" | "deployed";
  /** Human-readable summary of which identities the agent uses. */
  notes: string;
  vars: AgentEnvVar[];
}

export async function getProjectAgentEnv(projectId: string): Promise<AgentEnvSnapshot> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/agent-env`));
  if (!resp.ok) throw new Error(`Failed to get agent env: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Resources API
// ---------------------------------------------------------------------------

export interface Cluster {
  id: string;
  name: string;
  state: string | null;
  spark_version: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  state: string | null;
  size: string | null;
}

export async function listClusters(): Promise<Cluster[]> {
  const resp = await fetch(apiUrl("/api/resources/clusters"));
  if (!resp.ok) throw new Error(`Failed to list clusters: ${resp.status}`);
  return resp.json();
}

export async function listWarehouses(): Promise<Warehouse[]> {
  const resp = await fetch(apiUrl("/api/resources/warehouses"));
  if (!resp.ok) throw new Error(`Failed to list warehouses: ${resp.status}`);
  return resp.json();
}

/** `browse` returns the capped full list when no query is given — for a
 *  click-to-browse dropdown. Omit it for type-to-search behavior. */
/** `selectableOnly` filters to objects the CURRENT USER can build on (effective
 *  USE/SELECT), for the "use existing data" picker — see the backend endpoint. */
export async function listCatalogs(
  query?: string,
  browse?: boolean,
  selectableOnly?: boolean,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (browse) params.set("browse", "true");
  if (selectableOnly) params.set("selectable_only", "true");
  const qs = params.toString();
  const resp = await fetch(apiUrl(`/api/resources/catalogs${qs ? `?${qs}` : ""}`));
  if (!resp.ok) throw new Error(`Failed to list catalogs: ${resp.status}`);
  return resp.json();
}

export async function listSchemas(
  catalog: string,
  query?: string,
  browse?: boolean,
  selectableOnly?: boolean,
): Promise<string[]> {
  const params = new URLSearchParams({ catalog });
  if (query) params.set("q", query);
  if (browse) params.set("browse", "true");
  if (selectableOnly) params.set("selectable_only", "true");
  const resp = await fetch(apiUrl(`/api/resources/schemas?${params}`));
  if (!resp.ok) throw new Error(`Failed to list schemas: ${resp.status}`);
  return resp.json();
}

export async function listTables(
  catalog: string,
  schema: string,
  query?: string,
  selectableOnly?: boolean,
): Promise<string[]> {
  const params = new URLSearchParams({ catalog, schema });
  if (query) params.set("q", query);
  if (selectableOnly) params.set("selectable_only", "true");
  const resp = await fetch(apiUrl(`/api/resources/tables?${params}`));
  if (!resp.ok) throw new Error(`Failed to list tables: ${resp.status}`);
  return resp.json();
}

export interface ColumnMetadata {
  name: string;
  type_text: string | null;
  type_name: string | null;
  nullable: boolean | null;
  comment: string | null;
}

export interface TableMetadata {
  full_name: string;
  name: string | null;
  comment: string | null;
  table_type: string | null;
  columns: ColumnMetadata[];
}

/** Fetch column-level metadata (schema only, never data) for the given
 *  fully-qualified tables (catalog.schema.table). */
export async function getTableMetadata(tables: string[]): Promise<TableMetadata[]> {
  if (tables.length === 0) return [];
  const params = new URLSearchParams({ tables: tables.join(",") });
  const resp = await fetch(apiUrl(`/api/resources/table-metadata?${params}`));
  if (!resp.ok) throw new Error(`Failed to get table metadata: ${resp.status}`);
  return resp.json();
}

export interface WorkspaceInfo {
  host: string | null;
  workspace_id: string | null;
}

/** The connected workspace's host + id, for building Catalog Explorer links. */
export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  const resp = await fetch(apiUrl("/api/resources/workspace-info"));
  if (!resp.ok) throw new Error(`Failed to get workspace info: ${resp.status}`);
  return resp.json();
}

/** One table's light scan summary (the full stats stay server-side). */
export interface GroundingScannedTable {
  full_name: string;
  row_count: number | null;
  column_count: number;
  sampled: number;
  error: string | null;
}

export interface GroundingScanResult {
  scanned: GroundingScannedTable[];
  warehouse_id: string | null;
  warehouse_name: string | null;
}

/** Live progress from a grounding scan (SSE). `warehouse` fires once (with
 *  whether the warehouse is cold-starting), then `scanning` fires per completed
 *  table (tables scan in parallel, so `done` climbs as each finishes). */
export interface ScanProgress {
  phase: "warehouse" | "scanning";
  /** warehouse phase: the resolved warehouse isn't RUNNING (paying a cold start). */
  warehouseStarting?: boolean;
  warehouseName?: string | null;
  /** scanning phase: k of N tables done, and the one that just finished. */
  done?: number;
  total?: number;
  table?: string | null;
}

/** Scan picked real UC tables (schema + light stats + a few sample rows) to warm
 *  the server-side cache the suggest stream reads from. This is what
 *  "Generate a story" triggers before requesting grounded ideas. Reads real DATA
 *  server-side; only a light summary comes back. Streams progress (SSE) so the
 *  caller can show what's happening (starting the warehouse vs reading tables);
 *  resolves with the final summary once the `done` event arrives. */
export async function scanGroundingTables(
  tables: string[],
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<GroundingScanResult> {
  const resp = await fetch(apiUrl("/api/grounding/scan"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tables }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    let detail = `Scan failed: ${resp.status}`;
    try {
      const body = await resp.json();
      if (body && typeof body === "object" && "detail" in body) detail = String((body as { detail: unknown }).detail);
    } catch {
      // non-JSON / streamed error body — keep the status-code message
    }
    throw new Error(detail);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: GroundingScanResult = { scanned: [], warehouse_id: null, warehouse_name: null };
  let errorDetail: string | null = null;

  const handleFrame = (frame: string) => {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "warehouse") {
      onProgress?.({
        phase: "warehouse",
        warehouseStarting: Boolean(payload.starting),
        warehouseName: (payload.name as string) ?? null,
      });
    } else if (event === "scanning") {
      onProgress?.({
        phase: "scanning",
        done: payload.done as number,
        total: payload.total as number,
        table: (payload.table as string) ?? null,
      });
    } else if (event === "done") {
      result = {
        scanned: (payload.scanned as GroundingScannedTable[]) ?? [],
        warehouse_id: null,
        warehouse_name: (payload.warehouse_name as string) ?? null,
      };
    } else if (event === "error") {
      errorDetail = String(payload.detail ?? "Scan failed");
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);
  if (errorDetail) throw new Error(errorDetail);
  return result;
}

/** Build a Catalog Explorer deep link for a UC asset. `parts` is the dotted
 *  path (["catalog"], ["catalog","schema"], or ["catalog","schema","table"]).
 *  Returns null when the workspace host is unknown, so callers can hide the
 *  link rather than render a broken one. */
export function ucExploreUrl(
  info: WorkspaceInfo | null,
  parts: string[],
): string | null {
  if (!info?.host || parts.length === 0) return null;
  const path = parts.map(encodeURIComponent).join("/");
  const o = info.workspace_id ? `?o=${info.workspace_id}` : "";
  return `${info.host}/explore/data/${path}${o}`;
}

export interface ResourceDefaults {
  catalog: string;
  schema_prefix: string;
}

export async function getResourceDefaults(): Promise<ResourceDefaults> {
  const resp = await fetch(apiUrl("/api/resources/defaults"));
  if (!resp.ok) throw new Error(`Failed to get resource defaults: ${resp.status}`);
  return resp.json();
}

export async function refreshResources(
  resourceType?: string,
  catalog?: string
): Promise<void> {
  const params = new URLSearchParams();
  if (resourceType) params.set("resource_type", resourceType);
  if (catalog) params.set("catalog", catalog);

  const url = apiUrl(`/api/resources/refresh${params.toString() ? `?${params}` : ""}`);
  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok) throw new Error(`Failed to refresh resources: ${resp.status}`);
}

// ---------------------------------------------------------------------------
// Utility: Parse SSE stream (generic)
// ---------------------------------------------------------------------------

export async function* parseSSEStream<T>(
  resp: Response,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";

      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const payload = part.slice(6);
        if (payload === "[DONE]") return;

        try {
          yield JSON.parse(payload) as T;
        } catch {
          // Skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Legacy workspace API (kept for compatibility during transition)
// ---------------------------------------------------------------------------

export type WorkspaceEvent =
  | { type: "skill"; content: string }
  | { type: "section_start"; title: string }
  | { type: "complete"; id: number; demo_name: string; industry?: string }
  | { type: "error"; content: string }
  | { type: "proposal"; content: string }
  | { type: "file_start"; filename: string }
  | { type: "file_content"; filename: string; content: string }
  | { type: "file_complete"; filename: string; content?: string }
  | { type: "agent_thinking"; content: string }
  | { type: "agent_reading"; filename: string }
  | { type: "agent_message"; content: string }
  | { type: "all_complete"; files: Record<string, string>; id?: number; demo_name?: string };

export async function* streamWorkspaceGenerate(
  topic: string,
  signal?: AbortSignal
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch(apiUrl("/api/workspace/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!resp.ok) throw new Error(`Generation failed: ${resp.status}`);
  yield* parseSSEStream<WorkspaceEvent>(resp, signal);
}

// ---------------------------------------------------------------------------
// Templates API
// ---------------------------------------------------------------------------

/** What kind of template — drives the gallery tag + the ?type= filter. */
export type TemplateType = "SOLUTION" | "WORKSHOP" | "GENIE_WORKSHOP" | "ARCHITECTURE";

export interface TemplateListItem {
  id: string;
  name: string;
  status: string;
  owner_email: string;
  industry: string | null;
  description: string | null;
  /** Customer the source demo was built for (null → "Not specified"). */
  customer?: string | null;
  capabilities: string[] | null;
  /** Curated/seeded template — featured treatment + surfaced on /internal-demos. */
  official?: boolean;
  /** SOLUTION (default, full demo) / WORKSHOP / GENIE_WORKSHOP / ARCHITECTURE. */
  template_type?: TemplateType;
  /** Whether a hero screenshot exists (fetch via templateScreenshotUrl). */
  has_screenshot?: boolean;
  /** Total gallery images (hero + extras). >1 → the sheet shows a carousel. */
  screenshot_count?: number;
  /** Deployed live in THIS app's workspace → "Live" badge + "Try it live" buttons. */
  has_live_demo?: boolean;
  submitted_at: string;
  reviewed_at: string | null;
}

/** Kind of a live-demo resource (drives the button icon + tone). */
export type LiveDemoAssetKind =
  | "app"
  | "dashboard"
  | "genie"
  | "pipeline"
  | "job"
  | "knowledge_assistant"
  | "model"
  | "data"
  | "folder";

export interface LiveDemoAsset {
  kind: LiveDemoAssetKind | string;
  label: string;
  url: string;
}

/** Where a seed template is deployed live. Only returned when that deployment is
 *  in the SAME workspace as this app (the seeder drops it everywhere else). */
export interface LiveDemo {
  workspace: string;
  assets: LiveDemoAsset[];
  demo_questions: string[];
}

/** URL for a template's hero screenshot (PNG). Use as an <img src>. */
export function templateScreenshotUrl(templateId: string): string {
  return apiUrl(`/api/templates/${templateId}/screenshot`);
}

/** URL for the Nth gallery image (0 = hero, ≥1 = extras). Use as an <img src>. */
export function templateScreenshotAtUrl(templateId: string, index: number): string {
  return apiUrl(`/api/templates/${templateId}/screenshot/${index}`);
}

/** Admin-only: toggle a template's `official` (curated) flag. */
export async function setTemplateOfficial(
  templateId: string,
  official: boolean,
): Promise<TemplateListItem> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/official`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ official }),
  });
  if (!resp.ok) throw new Error(`Failed to set official: ${resp.status}`);
  return resp.json();
}

export interface TemplateDetail extends TemplateListItem {
  /** 1-2 paragraph storytelling summary shown atop the gallery sheet. */
  narrative: string | null;
  full_description: string | null;
  reviewed_by: string | null;
  source_project_id: string | null;
  file_count: number;
  /** "Try it live" links — null unless deployed in this app's workspace. */
  live_demo?: LiveDemo | null;
}

export interface TemplateFile {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
}

export interface TemplateFileContent {
  path: string;
  content: string;
  size: number;
}

export interface TemplateSearchResult {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  capabilities: string[] | null;
  similarity: number;
}

export async function listTemplates(
  status?: string,
  industry?: string,
  type?: TemplateType | string
): Promise<TemplateListItem[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (industry) params.set("industry", industry);
  if (type) params.set("type", type);

  const url = apiUrl(`/api/templates${params.toString() ? `?${params}` : ""}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to list templates: ${resp.status}`);
  return resp.json();
}

export async function getTemplate(templateId: string): Promise<TemplateDetail> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}`));
  if (!resp.ok) throw new Error(`Failed to get template: ${resp.status}`);
  return resp.json();
}

export async function listTemplateFiles(templateId: string): Promise<TemplateFile[]> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/files`));
  if (!resp.ok) throw new Error(`Failed to list template files: ${resp.status}`);
  return resp.json();
}

export async function getTemplateFileContent(
  templateId: string,
  filePath: string
): Promise<TemplateFileContent> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/files/${filePath}`));
  if (!resp.ok) throw new Error(`Failed to get template file: ${resp.status}`);
  return resp.json();
}

export async function searchTemplates(
  query: string,
  limit: number = 3
): Promise<TemplateSearchResult[]> {
  const resp = await fetch(apiUrl("/api/templates/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!resp.ok) throw new Error(`Failed to search templates: ${resp.status}`);
  return resp.json();
}

export async function submitTemplateFromProject(
  projectId: string
): Promise<TemplateDetail> {
  const resp = await fetch(apiUrl(`/api/templates/from-project/${projectId}`), {
    method: "POST",
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.detail || `Failed to submit template: ${resp.status}`);
  }
  return resp.json();
}

export async function updateTemplateStatus(
  templateId: string,
  status: "APPROVED" | "REJECTED"
): Promise<TemplateListItem> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/status`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error(`Failed to update template status: ${resp.status}`);
  return resp.json();
}

export async function createProjectFromTemplate(
  templateId: string,
  name: string,
  adaptInstructions?: string,
): Promise<Project> {
  const body: { name: string; adapt_instructions?: string } = { name };
  if (adaptInstructions && adaptInstructions.trim()) {
    body.adapt_instructions = adaptInstructions.trim();
  }
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/create-project`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Failed to create project from template: ${resp.status}`);
  return resp.json();
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}`), { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete template: ${resp.status}`);
}

export async function exportTemplate(templateId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/export`));
  if (!resp.ok) throw new Error(`Failed to export template: ${resp.status}`);

  const contentDisposition = resp.headers.get("Content-Disposition");
  let filename = "template.zip";
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/);
    if (match) filename = match[1];
  }

  const blob = await resp.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export async function getTemplateByProject(projectId: string): Promise<TemplateDetail> {
  const resp = await fetch(apiUrl(`/api/templates/by-project/${projectId}`));
  if (!resp.ok) throw new Error(`Failed to get template: ${resp.status}`);
  return resp.json();
}

export async function updateTemplateFromProject(
  templateId: string,
  projectId: string
): Promise<TemplateDetail> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/update-from-project/${projectId}`), {
    method: "PUT",
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.detail || `Failed to update template: ${resp.status}`);
  }
  return resp.json();
}

export async function openTemplateProject(templateId: string): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/open-project`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to open template project: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Constants API
// ---------------------------------------------------------------------------

export interface Capability {
  id: string;
  name: string;
  category: string;
  disabled?: boolean;
  /** In the Genie Code workshop pool? Backend allowlist (WORKSHOP_CAPABILITIES):
   *  the workshop mode shows only capabilities where this is true. */
  genie_code_workshop?: boolean;
}

export async function getIndustries(): Promise<string[]> {
  const resp = await fetch(apiUrl("/api/constants/industries"));
  if (!resp.ok) throw new Error(`Failed to get industries: ${resp.status}`);
  return resp.json();
}

export async function getCapabilities(): Promise<Capability[]> {
  const resp = await fetch(apiUrl("/api/constants/capabilities"));
  if (!resp.ok) throw new Error(`Failed to get capabilities: ${resp.status}`);
  return resp.json();
}

export interface CapabilityInput {
  id: string;
  status: "selected" | "unselected" | null;
}

/** Consultation signal (grounded "Use existing data" flow only): how well the
 *  user's REAL selected tables support this idea. Absent in synthetic mode. */
export interface IdeaFit {
  tier: "Great" | "Good" | "Possible";
  reason: string;
}

export interface UseCaseIdea {
  title: string;
  hook: string;
  datasources: string[];
  fit?: IdeaFit;
  /** Longer "why this demo is compelling" rationale, shown when the idea is
   *  expanded (grounded flow fills it; optional elsewhere). */
  why?: string;
}

export interface IdeaToRefine {
  title: string;
  hook: string;
  datasources: string[];
}

export interface SuggestCapabilitiesResponse {
  capabilities: string[];
  reasoning?: string | null;
  ideas: UseCaseIdea[];
}

// SSE event types for streaming capability suggestions
export type SuggestEvent =
  | { type: "count"; data: { count: number } }
  | { type: "idea"; data: UseCaseIdea }
  | { type: "capabilities"; data: { capabilities: string[] } }
  | { type: "reasoning"; data: { text: string } }
  | { type: "error"; data: { error: string; capabilities: string[] } };

/**
 * Stream capability suggestions and use-case ideas via SSE.
 * Yields events as they arrive from the server.
 *
 * Three modes (mutually exclusive — first one whose args are set wins):
 *   1. **Capability-change refresh** — pass `previousIdeas` + `previousCapabilities`
 *      when the user toggled the capability picker. The backend rewrites
 *      the existing stories minimally to fit the new capability set
 *      rather than generating brand-new ones. Preserves titles + narrative.
 *   2. **Single-idea refinement** — pass `refineIdea` + `refineComment` to
 *      rewrite ONE idea per the user's free-text instructions and upgrade
 *      the detail tier.
 *   3. **Cold start** — neither set. Full ideation from the topic.
 */
export async function* streamSuggestCapabilities(
  prompt: string,
  capabilities: CapabilityInput[],
  signal?: AbortSignal,
  refineIdea?: IdeaToRefine,
  refineComment?: string,
  previousIdeas?: IdeaToRefine[],
  previousCapabilities?: string[],
  /** Joined extraction of any files the user uploaded on the home page.
   *  When set, the backend injects it as a ground-truth context block in
   *  the suggester prompt. Capped to 50 KB by the caller. */
  contextText?: string,
  /** Architecture-first: data-source names from the user's diagram. The
   *  backend tells the LLM to anchor each idea in these exact systems. */
  datasources?: string[],
  /** Capabilities-only mode (architecture tab): the LLM selects matching
   *  capabilities from the text — NO use-case ideas. The stream emits only
   *  `capabilities` (+ `reasoning`); never `count`/`idea`. */
  capabilitiesOnly?: boolean,
  /** "Use existing data": fully-qualified UC tables (catalog.schema.table) the
   *  user picked. When set, the backend injects their scanned schema + stats +
   *  sample rows and REQUIRES the story to be built on ONLY these tables.
   *  Warm the server cache first via `scanGroundingTables`. */
  groundingTables?: string[],
  /** "Use existing data" opt-in: when false (default) suggested use-cases are
   *  read-only analytics; when true the demo may create its own auxiliary data
   *  so write-needing capabilities are proposed too. */
  allowDataWrite = false,
  /** Home-page entry mode. "workshop" pins the capability pool to the
   *  workshop-buildable set and always yields 3 stories. */
  mode?: "story" | "architecture" | "workshop",
): AsyncGenerator<SuggestEvent> {
  const body: Record<string, unknown> = { prompt, capabilities };
  if (mode) {
    body.mode = mode;
  }
  if (previousIdeas && previousIdeas.length > 0) {
    body.previous_ideas = previousIdeas;
    body.previous_capabilities = previousCapabilities ?? [];
  } else if (refineIdea && refineComment) {
    body.refine_idea = refineIdea;
    body.refine_comment = refineComment;
  }
  if (contextText && contextText.length > 0) {
    body.context_text = contextText;
  }
  if (datasources && datasources.length > 0) {
    body.datasources = datasources;
  }
  if (capabilitiesOnly) {
    body.capabilities_only = true;
  }
  if (groundingTables && groundingTables.length > 0) {
    body.grounding_tables = groundingTables;
    if (allowDataWrite) body.allow_data_write = true;
  }

  const resp = await fetch(apiUrl("/api/capabilities/suggest"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    throw new Error(`Failed to suggest capabilities: ${resp.status}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "" && currentEvent && currentData) {
          // End of event, emit it
          try {
            const parsed = JSON.parse(currentData);
            if (currentEvent === "count") {
              yield { type: "count", data: parsed };
            } else if (currentEvent === "idea") {
              yield { type: "idea", data: parsed as UseCaseIdea };
            } else if (currentEvent === "capabilities") {
              yield { type: "capabilities", data: parsed };
            } else if (currentEvent === "reasoning") {
              yield { type: "reasoning", data: parsed };
            } else if (currentEvent === "error") {
              yield { type: "error", data: parsed };
            }
          } catch {
            console.warn("Failed to parse SSE data:", currentData);
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface CurrentUser {
  email: string;
  user_name: string | null;
  is_template_admin: boolean;
  is_admin: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const resp = await fetch(apiUrl("/api/current-user"));
  if (!resp.ok) throw new Error(`Failed to get current user: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Stats API
// ---------------------------------------------------------------------------

export interface StatsDayCount {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface StatsOwnerCount {
  user_email: string;
  project_count: number;
  last_active: string | null;
}

export interface StatsStageCount {
  stage: string;
  count: number;
}

export interface StatsModeCount {
  mode: string;
  count: number;
}

export interface StatsProjectRow {
  id: string;
  name: string;
  user_email: string;
  stage: string;
  project_type: string;
  mode: string;
  message_count: number;
  has_active_execution: boolean;
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export type StatsGranularity = "day" | "week" | "month";

export interface Stats {
  total_projects: number;
  total_users: number;
  total_messages: number;
  projects_last_7d: number;
  projects_last_30d: number;
  active_executions: number;
  range_start: string;
  range_end: string;
  granularity: StatsGranularity;
  projects_per_day: StatsDayCount[];
  messages_per_day: StatsDayCount[];
  by_stage: StatsStageCount[];
  by_mode: StatsModeCount[];
  top_owners: StatsOwnerCount[];
  projects: StatsProjectRow[];
  total_filtered: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface StatsQuery {
  days?: number;
  start?: string; // ISO YYYY-MM-DD (overrides days)
  end?: string; // ISO YYYY-MM-DD (overrides days)
  granularity?: StatsGranularity;
  page?: number;
  page_size?: number;
  owner_filter?: string;
  stage_filter?: string;
  mode_filter?: string;
  top_owners_limit?: number;
}

function statsParams(query: StatsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.days != null) params.set("days", String(query.days));
  if (query.start) params.set("start", query.start);
  if (query.end) params.set("end", query.end);
  if (query.granularity) params.set("granularity", query.granularity);
  if (query.page != null) params.set("page", String(query.page));
  if (query.page_size != null) params.set("page_size", String(query.page_size));
  if (query.owner_filter) params.set("owner_filter", query.owner_filter);
  if (query.stage_filter) params.set("stage_filter", query.stage_filter);
  if (query.mode_filter) params.set("mode_filter", query.mode_filter);
  if (query.top_owners_limit != null) params.set("top_owners_limit", String(query.top_owners_limit));
  return params;
}

export async function getStats(query: StatsQuery = {}): Promise<Stats> {
  const qs = statsParams(query).toString();
  const resp = await fetch(apiUrl(`/api/stats${qs ? `?${qs}` : ""}`));
  if (!resp.ok) throw new Error(`Failed to load stats: ${resp.status}`);
  return resp.json();
}

/**
 * Fetch the full (filter-respecting, un-paginated) project list as CSV text.
 * Only the table filters matter here; range/granularity/pagination are ignored
 * by the export endpoint.
 */
export async function exportStatsProjectsCsv(
  query: Pick<StatsQuery, "owner_filter" | "stage_filter" | "mode_filter"> = {},
): Promise<{ csv: string; truncated: boolean }> {
  const params = new URLSearchParams();
  if (query.owner_filter) params.set("owner_filter", query.owner_filter);
  if (query.stage_filter) params.set("stage_filter", query.stage_filter);
  if (query.mode_filter) params.set("mode_filter", query.mode_filter);
  const qs = params.toString();
  const resp = await fetch(apiUrl(`/api/stats/projects/export${qs ? `?${qs}` : ""}`));
  if (!resp.ok) throw new Error(`Failed to export projects: ${resp.status}`);
  return {
    csv: await resp.text(),
    truncated: resp.headers.get("X-Export-Truncated") === "true",
  };
}

// ---------------------------------------------------------------------------
// Configuration API
// ---------------------------------------------------------------------------

export interface DatabaseStatus {
  connected: boolean;
  type: "local" | "remote";
  error: string | null;
}

export interface DatabricksProfile {
  name: string;
  host: string | null;
  is_default: boolean;
}

export interface DatabricksConnectionStatus {
  connected: boolean;
  profile: string;
  host: string | null;
  user_email: string | null;
  error: string | null;
}

export interface ConfigUser {
  id: string;
  email: string;
  databricks_profile: string;
  created_at: string;
  updated_at: string;
}

export interface ConfigStatus {
  database: DatabaseStatus;
  databricks_profiles: DatabricksProfile[];
  current_user: ConfigUser | null;
  is_configured: boolean;
  /** Recommended Unity Catalog for new projects. Sourced from the backend's
   *  AppConfig.default_catalog (env: DEFAULT_CATALOG); the resources popover
   *  uses this to mark the right entry as "(default)". */
  default_catalog: string;
  /** Whether the architecture diagram shows vendor LOGOS by default (initial
   *  state of the "logos on" toggle for a diagram that hasn't set it). Sourced
   *  from ENABLE_LOGO_BY_DEFAULT — false in the public build, true on internal
   *  Databricks deploys. */
  enable_logo_by_default: boolean;
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  const resp = await fetch(apiUrl("/api/config/status"));
  if (!resp.ok) throw new Error(`Failed to get config status: ${resp.status}`);
  return resp.json();
}

/**
 * Unified identity — see backend/AUTH.md. The ONLY way UI should read
 * "who is the user". Do not reach for `ConfigStatus.current_user` (deprecated).
 */
export type IdentityMode = "local" | "deployed";

export interface WhoAmI {
  email: string | null;
  databricks_profile: string | null;
  mode: IdentityMode;
  is_configured: boolean;
}

export async function getMe(): Promise<WhoAmI> {
  const resp = await fetch(apiUrl("/api/me"));
  if (!resp.ok) throw new Error(`Failed to get identity: ${resp.status}`);
  return resp.json();
}

export async function getDatabricksProfiles(): Promise<DatabricksProfile[]> {
  const resp = await fetch(apiUrl("/api/config/databricks/profiles"));
  if (!resp.ok) throw new Error(`Failed to get Databricks profiles: ${resp.status}`);
  return resp.json();
}

export async function testDatabricksConnection(
  profile: string
): Promise<DatabricksConnectionStatus> {
  const resp = await fetch(apiUrl(`/api/config/databricks/test?profile=${encodeURIComponent(profile)}`), {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to test Databricks connection: ${resp.status}`);
  return resp.json();
}

export async function saveUserConfig(databricksProfile: string): Promise<ConfigUser> {
  const resp = await fetch(apiUrl("/api/config/user"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ databricks_profile: databricksProfile }),
  });
  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(error.detail || `Failed to save user config: ${resp.status}`);
  }
  return resp.json();
}

export async function getConfigUser(): Promise<ConfigUser> {
  const resp = await fetch(apiUrl("/api/config/user"));
  if (!resp.ok) throw new Error(`Failed to get config user: ${resp.status}`);
  return resp.json();
}
