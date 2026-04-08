/**
 * Custom API client for the Databricks Asset Generator.
 *
 * Project-based architecture with file sync and Claude Code integration.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  user_email: string;
  description: string | null;
  project_type: string;
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
}

export interface ProjectListItem {
  id: string;
  name: string;
  project_type: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  file_count: number;
}

export interface ProjectFile {
  path: string;
  name: string;
  size: number;
  last_modified: string;
  synced_at: string;
}

export interface ProjectFileContent {
  path: string;
  content: string;
  size: number;
  last_modified: string;
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
}

export interface ToolResultEntry {
  type: "tool_result";
  tool_id: string;
  content: string;
  is_error: boolean;
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
  | { type: "thinking"; thinking: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use"; tool_id: string; tool_name: string; tool_input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }
  | { type: "result"; session_id: string | null; duration_ms: number; total_cost_usd?: number; is_error?: boolean; num_turns?: number }
  | { type: "system"; subtype: string; data: unknown }
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
  const resp = await fetch("/api/projects");
  if (!resp.ok) throw new Error(`Failed to list projects: ${resp.status}`);
  return resp.json();
}

export async function createProject(description: string): Promise<Project> {
  const resp = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!resp.ok) throw new Error(`Failed to create project: ${resp.status}`);
  return resp.json();
}

export async function getProject(projectId: string): Promise<Project> {
  const resp = await fetch(`/api/projects/${projectId}`);
  if (!resp.ok) throw new Error(`Failed to get project: ${resp.status}`);
  return resp.json();
}

export async function updateProject(
  projectId: string,
  updates: { name?: string; description?: string }
): Promise<Project> {
  const resp = await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!resp.ok) throw new Error(`Failed to update project: ${resp.status}`);
  return resp.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete project: ${resp.status}`);
}

export async function syncProject(projectId: string): Promise<SyncStats> {
  const resp = await fetch(`/api/projects/${projectId}/sync`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to sync project: ${resp.status}`);
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
  const resp = await fetch(`/api/projects/${projectId}/resources`, {
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

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const resp = await fetch(`/api/projects/${projectId}/files`);
  if (!resp.ok) throw new Error(`Failed to list files: ${resp.status}`);
  return resp.json();
}

export async function getProjectFile(
  projectId: string,
  filePath: string
): Promise<ProjectFileContent> {
  const resp = await fetch(`/api/projects/${projectId}/files/${filePath}`);
  if (!resp.ok) throw new Error(`Failed to get file: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Messages API
// ---------------------------------------------------------------------------

export async function listProjectMessages(projectId: string): Promise<Message[]> {
  const resp = await fetch(`/api/projects/${projectId}/messages`);
  if (!resp.ok) throw new Error(`Failed to list messages: ${resp.status}`);
  return resp.json();
}

export async function addProjectMessage(
  projectId: string,
  message: { role: string; content: string; is_error?: boolean }
): Promise<Message> {
  const resp = await fetch(`/api/projects/${projectId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!resp.ok) throw new Error(`Failed to add message: ${resp.status}`);
  return resp.json();
}

export async function clearProjectMessages(projectId: string): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/messages`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`Failed to clear messages: ${resp.status}`);
}

export async function clearProjectSession(projectId: string): Promise<{ success: boolean; deleted_count: number }> {
  const resp = await fetch(`/api/projects/${projectId}/session/clear`, {
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
  message: string
): Promise<InvokeAgentResponse> {
  const resp = await fetch("/api/invoke_agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, message }),
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

  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    try {
      const resp = await fetch(`/api/stream_progress/${executionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_timestamp: cursor }),
        signal,
      });

      if (!resp.ok) throw new Error(`Stream failed: ${resp.status}`);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let shouldReconnect = false;

      while (true) {
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
            const event = JSON.parse(payload) as AgentEvent;

            // Update cursor for reconnection
            if ("_cursor" in event) {
              cursor = (event as { _cursor: number })._cursor;
            }

            // Handle reconnect signal
            if (event.type === "stream.reconnect") {
              shouldReconnect = true;
              break;
            }

            // Handle completion
            if (event.type === "stream.completed") {
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

      // Normal end of stream
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      // Retry on connection errors
      reconnectAttempts++;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        throw error;
      }
      await new Promise(r => setTimeout(r, 1000 * reconnectAttempts));
    }
  }
}

export async function stopAgentStream(executionId: string): Promise<void> {
  const resp = await fetch(`/api/stop_stream/${executionId}`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to stop stream: ${resp.status}`);
}

export async function getActiveExecution(projectId: string): Promise<Execution | null> {
  const resp = await fetch(`/api/projects/${projectId}/execution`);
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
  const resp = await fetch(`/api/projects/${projectId}/skills`);
  if (!resp.ok) throw new Error(`Failed to get skills: ${resp.status}`);
  return resp.json();
}

export async function getSkillFiles(projectId: string, skillName: string): Promise<SkillFile[]> {
  const resp = await fetch(`/api/projects/${projectId}/skills/${skillName}/files`);
  if (!resp.ok) throw new Error(`Failed to get skill files: ${resp.status}`);
  return resp.json();
}

export async function getSkillFileContent(
  projectId: string,
  skillName: string,
  filePath: string
): Promise<SkillFileContent> {
  const resp = await fetch(`/api/projects/${projectId}/skills/${skillName}/files/${filePath}`);
  if (!resp.ok) throw new Error(`Failed to get skill file: ${resp.status}`);
  return resp.json();
}

export async function refreshProjectSkills(projectId: string): Promise<{ success: boolean; skills: Skill[] }> {
  const resp = await fetch(`/api/projects/${projectId}/skills/refresh`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to refresh skills: ${resp.status}`);
  return resp.json();
}

export async function getProjectSystemPrompt(projectId: string): Promise<string> {
  const resp = await fetch(`/api/projects/${projectId}/system-prompt`);
  if (!resp.ok) throw new Error(`Failed to get system prompt: ${resp.status}`);
  const data = await resp.json();
  return data.prompt;
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
  const resp = await fetch("/api/resources/clusters");
  if (!resp.ok) throw new Error(`Failed to list clusters: ${resp.status}`);
  return resp.json();
}

export async function listWarehouses(): Promise<Warehouse[]> {
  const resp = await fetch("/api/resources/warehouses");
  if (!resp.ok) throw new Error(`Failed to list warehouses: ${resp.status}`);
  return resp.json();
}

export async function listCatalogs(query?: string): Promise<string[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  const resp = await fetch(`/api/resources/catalogs${params}`);
  if (!resp.ok) throw new Error(`Failed to list catalogs: ${resp.status}`);
  return resp.json();
}

export async function listSchemas(catalog: string, query?: string): Promise<string[]> {
  const params = new URLSearchParams({ catalog });
  if (query) params.set("q", query);
  const resp = await fetch(`/api/resources/schemas?${params}`);
  if (!resp.ok) throw new Error(`Failed to list schemas: ${resp.status}`);
  return resp.json();
}

export interface ResourceDefaults {
  catalog: string;
  schema_prefix: string;
}

export async function getResourceDefaults(): Promise<ResourceDefaults> {
  const resp = await fetch("/api/resources/defaults");
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

  const url = `/api/resources/refresh${params.toString() ? `?${params}` : ""}`;
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
  const resp = await fetch("/api/workspace/generate", {
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

  const url = `/api/templates${params.toString() ? `?${params}` : ""}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to list templates: ${resp.status}`);
  return resp.json();
}

export async function getTemplate(templateId: string): Promise<TemplateDetail> {
  const resp = await fetch(`/api/templates/${templateId}`);
  if (!resp.ok) throw new Error(`Failed to get template: ${resp.status}`);
  return resp.json();
}

export async function listTemplateFiles(templateId: string): Promise<TemplateFile[]> {
  const resp = await fetch(`/api/templates/${templateId}/files`);
  if (!resp.ok) throw new Error(`Failed to list template files: ${resp.status}`);
  return resp.json();
}

export async function getTemplateFileContent(
  templateId: string,
  filePath: string
): Promise<TemplateFileContent> {
  const resp = await fetch(`/api/templates/${templateId}/files/${filePath}`);
  if (!resp.ok) throw new Error(`Failed to get template file: ${resp.status}`);
  return resp.json();
}

export async function searchTemplates(
  query: string,
  limit: number = 3
): Promise<TemplateSearchResult[]> {
  const resp = await fetch("/api/templates/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!resp.ok) throw new Error(`Failed to search templates: ${resp.status}`);
  return resp.json();
}

export async function submitTemplateFromProject(
  projectId: string
): Promise<TemplateListItem> {
  const resp = await fetch(`/api/templates/from-project/${projectId}`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`Failed to submit template: ${resp.status}`);
  return resp.json();
}

export async function updateTemplateStatus(
  templateId: string,
  status: "APPROVED" | "REJECTED"
): Promise<TemplateListItem> {
  const resp = await fetch(`/api/templates/${templateId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error(`Failed to update template status: ${resp.status}`);
  return resp.json();
}

export async function createProjectFromTemplate(
  templateId: string,
  name: string
): Promise<Project> {
  const resp = await fetch(`/api/templates/${templateId}/create-project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error(`Failed to create project from template: ${resp.status}`);
  return resp.json();
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const resp = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete template: ${resp.status}`);
}

// ---------------------------------------------------------------------------
// Constants API
// ---------------------------------------------------------------------------

export interface Capability {
  id: string;
  name: string;
  category: string;
}

export async function getIndustries(): Promise<string[]> {
  const resp = await fetch("/api/constants/industries");
  if (!resp.ok) throw new Error(`Failed to get industries: ${resp.status}`);
  return resp.json();
}

export async function getCapabilities(): Promise<Capability[]> {
  const resp = await fetch("/api/constants/capabilities");
  if (!resp.ok) throw new Error(`Failed to get capabilities: ${resp.status}`);
  return resp.json();
}

export interface TemplateAdminStatus {
  is_admin: boolean;
}

export async function getTemplateAdminStatus(): Promise<TemplateAdminStatus> {
  const resp = await fetch("/api/constants/template-admin-status");
  if (!resp.ok) throw new Error(`Failed to get admin status: ${resp.status}`);
  return resp.json();
}
