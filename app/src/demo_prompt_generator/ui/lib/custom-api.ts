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
  project_type: string;
  stage: ProjectStage;
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
}

export interface ProjectListItem {
  id: string;
  name: string;
  description?: string | null;
  project_type: string;
  stage: ProjectStage;
  created_at: string;
  updated_at: string;
  message_count: number;
  file_count: number;
  is_starred: boolean;
  shared_by?: string | null;
  shared_message?: string | null;
  owner_email?: string | null;
  // Template lineage
  source_template_id?: string | null;
  source_template_name?: string | null;
}

export interface ProjectShareOut {
  id: number;
  project_id: string;
  owner_email: string;
  shared_with_email: string;
  message: string | null;
  created_at: string;
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
}

// Reasoning entry types for ordered thinking/tool display
export interface ThinkingEntry {
  type: "thinking";
  content: string;
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
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use"; tool_id: string; tool_name: string; tool_input: unknown; timestamp?: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean; timestamp?: string }
  | { type: "result"; session_id: string | null; duration_ms: number; total_cost_usd?: number; is_error?: boolean; num_turns?: number }
  | { type: "system"; subtype: string; data: unknown }
  | { type: "file_changed"; path: string }
  | { type: "error"; error: string }
  | { type: "cancelled" }
  | { type: "stream.completed"; is_error: boolean; is_cancelled: boolean }
  | { type: "stream.reconnect"; execution_id: string; last_timestamp: number }
  | { type: "keepalive"; elapsed_since_last_event: number }
  | { type: "unknown"; message_type: string; data: string };

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectListItem[]> {
  const resp = await fetch(apiUrl("/api/projects"));
  if (!resp.ok) throw new Error(`Failed to list projects: ${resp.status}`);
  return resp.json();
}

export async function createProject(
  description: string,
  capabilities: string[] = [],
  initialPrompt?: string,
): Promise<Project> {
  const resp = await fetch(apiUrl("/api/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      capabilities,
      initial_prompt: initialPrompt,
    }),
  });
  if (!resp.ok) throw new Error(`Failed to create project: ${resp.status}`);
  return resp.json();
}

export async function getProject(projectId: string): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`));
  if (!resp.ok) throw new Error(`Failed to get project: ${resp.status}`);
  return resp.json();
}

export async function updateProject(
  projectId: string,
  updates: { name?: string; description?: string }
): Promise<Project> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!resp.ok) throw new Error(`Failed to update project: ${resp.status}`);
  return resp.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}`), { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete project: ${resp.status}`);
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
  message?: string
): Promise<ProjectShareOut> {
  const resp = await fetch(apiUrl(`/api/projects/${projectId}/share`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, message }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to share project: ${resp.status}`);
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
  options: { saveUserMessage?: boolean } = {},
): Promise<InvokeAgentResponse> {
  const resp = await fetch(apiUrl("/api/invoke_agent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      message,
      save_user_message: options.saveUserMessage ?? true,
    }),
  });
  if (!resp.ok) throw new Error(`Failed to invoke agent: ${resp.status}`);
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
 */
export async function* streamSuggestCapabilities(
  prompt: string,
  capabilities: CapabilityInput[],
  signal?: AbortSignal,
  refineIdea?: IdeaToRefine,
  refineComment?: string
): AsyncGenerator<SuggestEvent> {
  const body: Record<string, unknown> = { prompt, capabilities };
  if (refineIdea && refineComment) {
    body.refine_idea = refineIdea;
    body.refine_comment = refineComment;
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
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const resp = await fetch(apiUrl("/api/current-user"));
  if (!resp.ok) throw new Error(`Failed to get current user: ${resp.status}`);
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
