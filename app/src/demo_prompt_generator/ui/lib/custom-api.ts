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

export interface Project {
  id: string;
  name: string;
  user_email: string;
  description: string | null;
  /** Real customer/account this demo is for (chat-inferred, editable).
   *  Null → render "Not specified". */
  customer?: string | null;
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
  // Template lineage
  source_template_id?: string | null;
  source_template_name?: string | null;
  /** Caller's access on this project: "owner" | "admin" | "editor" | "viewer".
   *  Populated by getProject; drives the read-only UI for shared viewers. */
  my_role?: string | null;
  /** Conversation driver — the user whose PAT the agent's CLI runs as (null =
   *  unclaimed). `is_driver` = the caller currently holds it. A non-driver may
   *  STILL run the agent while `driver_token_expired` is false (they ride the
   *  driver's fresh token); once expired they must take over. */
  active_driver_email?: string | null;
  is_driver?: boolean | null;
  driver_token_age_seconds?: number | null;
  driver_token_expired?: boolean | null;
}

/** Light poll payload for the chat's driver banner (GET /driver-status). */
export interface DriverStatus {
  active_driver_email: string | null;
  is_driver: boolean;
  driver_token_age_seconds: number | null;
  driver_token_expired: boolean;
}

export async function getDriverStatus(projectId: string): Promise<DriverStatus> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/driver-status`));
  if (!resp.ok) throw new Error(`Failed to get driver status: ${resp.status}`);
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

export interface DeployedResources {
  resources: DeployedResourceLink[];
  deployed_at: string | null;
  /** Non-null when the LLM-based resources.json extractor failed (auth,
   *  model unavailable, malformed response). Surface this so users don't
   *  see an empty list and assume nothing was deployed. */
  extraction_error?: string | null;
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
}

export interface BrandOut {
  name: string;
  domain: string | null;
  confidence: number;
  logo_url: string | null;
  logo_data_url: string | null;
  logos: BrandLogoCandidate[];
  palette: string[];
  source: string | null;
  warnings: string[];
}

/**
 * Resolve a company's brand (official domain + logo candidates + color palette)
 * from just its name. Best-effort + slow (the backend runs an agent loop that
 * searches, fetches, and extracts) — expect ~15–40s. Always resolves to a
 * BrandOut; missing pieces come back empty with `warnings`.
 */
export async function resolveBrand(name: string): Promise<BrandOut> {
  const resp = await fetch(apiUrl(`/api/brands/resolve?name=${encodeURIComponent(name)}`));
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

export async function createProject(
  description: string,
  capabilities: string[] = [],
  initialPrompt?: string,
  contextFiles?: UploadedFile[],
  architectureFirst = false,
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
  updates: { name?: string; description?: string; customer?: string; architecture_first?: boolean }
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!resp.ok) throw new Error(`Failed to update project: ${resp.status}`);
  return resp.json();
}

/** Provision the remote assets an architecture-first project skipped at
 *  creation (LLM name/schema, warehouse discovery, CREATE SCHEMA). Idempotent
 *  — the "Build the solution" dialog calls it right before the build prompt. */
export async function provisionProject(
  projectId: string,
  body: { description?: string; capabilities?: string[] },
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/provision`), {
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
  if (!resp.ok) throw new Error(`Failed to save file: ${resp.status}`);
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

export async function downloadProjectAsZip(projectId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/download`));
  if (!resp.ok) throw new Error(`Failed to download project: ${resp.status}`);

  // Get the filename from Content-Disposition header or use default
  const contentDisposition = resp.headers.get("Content-Disposition");
  let filename = "project.zip";
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/);
    if (match) filename = match[1];
  }

  // Download the blob
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

export async function invokeAgent(
  projectId: string,
  message: string,
  options: { saveUserMessage?: boolean; contextHint?: string } = {},
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

      if (!resp.ok) throw new Error(`Stream failed: ${resp.status}`);

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
      // Timeout or connection error — retry with backoff.
      reconnectAttempts++;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        throw new Error(
          `Stream failed after ${MAX_RECONNECT_ATTEMPTS} retries. The backend may be unresponsive — try reloading the page.`
        );
      }
      await new Promise(r => setTimeout(r, 1000 * reconnectAttempts));
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

export async function listCatalogs(query?: string): Promise<string[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  const resp = await fetch(apiUrl(`/api/resources/catalogs${params}`));
  if (!resp.ok) throw new Error(`Failed to list catalogs: ${resp.status}`);
  return resp.json();
}

export async function listSchemas(catalog: string, query?: string): Promise<string[]> {
  const params = new URLSearchParams({ catalog });
  if (query) params.set("q", query);
  const resp = await fetch(apiUrl(`/api/resources/schemas?${params}`));
  if (!resp.ok) throw new Error(`Failed to list schemas: ${resp.status}`);
  return resp.json();
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
  submitted_at: string;
  reviewed_at: string | null;
}

export interface TemplateDetail extends TemplateListItem {
  full_description: string | null;
  reviewed_by: string | null;
  source_project_id: string | null;
  file_count: number;
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
  industry?: string
): Promise<TemplateListItem[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (industry) params.set("industry", industry);

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
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/templates/${templateId}/create-project`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
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

export interface UseCaseIdea {
  title: string;
  hook: string;
  datasources: string[];
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
  capabilitiesOnly?: boolean
): AsyncGenerator<SuggestEvent> {
  const body: Record<string, unknown> = { prompt, capabilities };
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

export interface StatsProjectRow {
  id: string;
  name: string;
  user_email: string;
  stage: string;
  project_type: string;
  message_count: number;
  has_active_execution: boolean;
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  total_projects: number;
  total_users: number;
  total_messages: number;
  projects_last_7d: number;
  projects_last_30d: number;
  active_executions: number;
  projects_per_day: StatsDayCount[];
  messages_per_day: StatsDayCount[];
  by_stage: StatsStageCount[];
  top_owners: StatsOwnerCount[];
  projects: StatsProjectRow[];
  page: number;
  page_size: number;
  total_pages: number;
}

export interface StatsQuery {
  days?: number;
  page?: number;
  page_size?: number;
  owner_filter?: string;
}

export async function getStats(query: StatsQuery = {}): Promise<Stats> {
  const params = new URLSearchParams();
  if (query.days != null) params.set("days", String(query.days));
  if (query.page != null) params.set("page", String(query.page));
  if (query.page_size != null) params.set("page_size", String(query.page_size));
  if (query.owner_filter) params.set("owner_filter", query.owner_filter);
  const qs = params.toString();
  const resp = await fetch(apiUrl(`/api/stats${qs ? `?${qs}` : ""}`));
  if (!resp.ok) throw new Error(`Failed to load stats: ${resp.status}`);
  return resp.json();
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
