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

export interface Message {
  id: number;
  project_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  is_error: boolean;
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
  | { type: "tool_use"; tool_id: string; tool_name: string; tool_input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }
  | { type: "result"; session_id: string | null; duration_ms: number; total_cost_usd?: number }
  | { type: "error"; error: string }
  | { type: "cancelled" }
  | { type: "stream.completed"; is_error: boolean; is_cancelled: boolean }
  | { type: "stream.reconnect"; execution_id: string; last_timestamp: number }
  | { type: "keepalive"; elapsed_since_last_event: number };

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectListItem[]> {
  const resp = await fetch("/api/projects");
  if (!resp.ok) throw new Error(`Failed to list projects: ${resp.status}`);
  return resp.json();
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const resp = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
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
  const resp = await fetch(`/api/stream_progress/${executionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal,
  });

  if (!resp.ok) throw new Error(`Stream failed: ${resp.status}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

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
        yield event;

        // Check for stream completion
        if (event.type === "stream.completed") {
          return;
        }
      } catch {
        // Skip malformed events
      }
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

export async function listCatalogs(): Promise<string[]> {
  const resp = await fetch("/api/resources/catalogs");
  if (!resp.ok) throw new Error(`Failed to list catalogs: ${resp.status}`);
  return resp.json();
}

export async function listSchemas(catalog: string): Promise<string[]> {
  const resp = await fetch(`/api/resources/schemas?catalog=${encodeURIComponent(catalog)}`);
  if (!resp.ok) throw new Error(`Failed to list schemas: ${resp.status}`);
  return resp.json();
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
