import type { DemoRequestIn, DatabricksFeatures } from "./api";

export const defaultFeatures: DatabricksFeatures = {
  delta_lake: false,
  delta_live_tables: false,
  unity_catalog: false,
  databricks_sql: false,
  mlflow: false,
  model_registry: false,
  model_serving: false,
  feature_store: false,
  automl: false,
  mosaic_ai: false,
  vector_search: false,
  structured_streaming: false,
  serverless_compute: false,
  workflows_jobs: false,
  genie: false,
  databricks_apps: false,
  lakehouse_monitoring: false,
};

export const defaultFormValues: DemoRequestIn = {
  demo_name: "",
  owner_name: "",
  primary_audience: "",
  business_problem: "",
  wow_moment: "",
  solution_summary: "",
  features: { ...defaultFeatures },
  data_source_type: "synthetic",
  industry: "",
  delivery_formats: [],
  demo_length: "15-20",
  tone: "business",
};

/**
 * SSE streaming for the /inspire endpoint.
 */
export async function* streamInspirationSSE(
  topic: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const resp = await fetch("/api/inspire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!resp.ok) throw new Error(`Inspire failed: ${resp.status}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return;
      if (payload.startsWith("[ERROR]")) throw new Error(payload);
      yield payload;
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace SSE types and helpers
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
  | { type: "build_start"; project_dir: string }
  | { type: "build_init"; session_id: string }
  | { type: "build_tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "build_tool_result"; tool: string; result: string }
  | { type: "build_message"; content: string }
  | { type: "build_complete"; project_dir: string; files_created: string[] }
  | { type: "build_error"; content: string }
  // Block agent events
  | { type: "block_added"; slug: string; name: string; category: string }
  | { type: "block_removed"; slug: string }
  | { type: "block_created"; slug: string; name: string; category: string }
  | { type: "blocks_updated"; slugs: string[] }
  // Collection suggestion events
  | { type: "suggestion"; content: string }
  // Parallel buildout events
  | { type: "tier_start"; tier: number; files: string[] }
  | { type: "tier_complete"; tier: number }
  | { type: "all_complete"; files: Record<string, string>; id?: number; demo_name?: string }
  // Supervisor build events
  | { type: "supervisor_start"; project_dir: string; mode: string }
  | { type: "supervisor_tier_start"; tier: number; workers: string[] }
  | { type: "supervisor_tier_complete"; tier: number }
  | { type: "supervisor_validating"; tier: number }
  | { type: "supervisor_complete"; project_dir: string; files_created: string[] }
  | { type: "worker_start"; worker: string; filename: string }
  | { type: "worker_complete"; worker: string }
  | { type: "worker_error"; worker: string; content: string }
  | { type: "worker_message"; content: string; worker: string }
  | { type: "worker_tool_call"; tool: string; args: Record<string, unknown>; worker: string };

async function* parseSSEStream(
  resp: Response,
): AsyncGenerator<WorkspaceEvent> {
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
        yield JSON.parse(payload) as WorkspaceEvent;
      } catch {
        // skip malformed events
      }
    }
  }
}

export async function* streamWorkspaceGenerate(
  topic: string,
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!resp.ok) throw new Error(`Generation failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function* streamWorkspaceRefine(
  generationId: number,
  message: string,
  history: ChatMessage[],
  signal?: AbortSignal,
  focusedSections?: string[],
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: generationId,
      message,
      history,
      focused_sections: focusedSections || [],
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`Refinement failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

// ---------------------------------------------------------------------------
// Stage 1: Proposal SSE
// ---------------------------------------------------------------------------

export async function* streamWorkspacePropose(
  topic: string,
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/propose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!resp.ok) throw new Error(`Proposal generation failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export async function* streamProposalRefine(
  generationId: number,
  message: string,
  history: ChatMessage[],
  signal?: AbortSignal,
  focusedSections?: string[],
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/propose/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: generationId,
      message,
      history,
      focused_sections: focusedSections || [],
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`Proposal refinement failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export async function approveProposal(generationId: number): Promise<{ id: number; stage: string; demo_name: string }> {
  const resp = await fetch("/api/workspace/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: generationId }),
  });
  if (!resp.ok) throw new Error(`Approval failed: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Stage 2: Buildout SSE
// ---------------------------------------------------------------------------

export async function* streamWorkspaceBuildout(
  generationId: number,
  signal?: AbortSignal,
  userArchitecture?: string,
): AsyncGenerator<WorkspaceEvent> {
  const body: Record<string, unknown> = { generation_id: generationId };
  if (userArchitecture) body.user_architecture = userArchitecture;
  const resp = await fetch("/api/workspace/buildout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`Buildout failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export async function* streamBuildoutFile(
  generationId: number,
  filename: string,
  generatedFiles: Record<string, string>,
  signal?: AbortSignal,
  userArchitecture?: string,
): AsyncGenerator<WorkspaceEvent> {
  const body: Record<string, unknown> = {
    generation_id: generationId,
    filename,
    generated_files: generatedFiles,
  };
  if (userArchitecture) body.user_architecture = userArchitecture;
  const resp = await fetch("/api/workspace/buildout-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`Buildout file failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

// ---------------------------------------------------------------------------
// Conversations API
// ---------------------------------------------------------------------------

export interface ConversationOut {
  id: number;
  generation_id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationWithMessages {
  id: number;
  generation_id: number;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export async function listConversations(generationId?: number): Promise<ConversationOut[]> {
  const params = generationId != null ? `?generation_id=${generationId}` : "";
  const resp = await fetch(`/api/conversations${params}`);
  if (!resp.ok) throw new Error(`Failed to list conversations: ${resp.status}`);
  return resp.json();
}

export async function getConversation(conversationId: number): Promise<ConversationWithMessages> {
  const resp = await fetch(`/api/conversations/${conversationId}`);
  if (!resp.ok) throw new Error(`Failed to get conversation: ${resp.status}`);
  return resp.json();
}

export async function saveConversation(
  generationId: number,
  messages: ChatMessage[],
): Promise<ConversationOut> {
  const resp = await fetch("/api/conversations/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: generationId, messages }),
  });
  if (!resp.ok) throw new Error(`Failed to save conversation: ${resp.status}`);
  return resp.json();
}

export async function deleteConversation(conversationId: number): Promise<void> {
  const resp = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete conversation: ${resp.status}`);
}

// ---------------------------------------------------------------------------
// Stage 2: Buildout SSE (continued)
// ---------------------------------------------------------------------------

export async function* streamFileRefine(
  generationId: number,
  filename: string,
  message: string,
  history: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/refine-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: generationId,
      filename,
      message,
      history,
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`File refinement failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

// ---------------------------------------------------------------------------
// Buildout progress persistence
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent mode: cross-file editing
// ---------------------------------------------------------------------------

export async function* streamAgentRefine(
  generationId: number,
  message: string,
  history: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/agent-refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: generationId,
      message,
      history,
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`Agent refine failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export async function savePartialBuildout(
  generationId: number,
  files: Record<string, string>,
): Promise<void> {
  await fetch("/api/workspace/buildout-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: generationId, files }),
  });
}

// ---------------------------------------------------------------------------
// Build phase: execute package via agent loop
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Parallel buildout SSE
// ---------------------------------------------------------------------------

export async function* streamParallelBuildout(
  generationId: number,
  collectionSlug: string,
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/buildout-parallel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: generationId,
      collection_slug: collectionSlug,
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`Parallel buildout failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

// ---------------------------------------------------------------------------
// Block & Collection APIs
// ---------------------------------------------------------------------------

export interface BlockSummary {
  slug: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  related: string[];
  suggested_capabilities?: string[];
}

export interface BlockFull extends BlockSummary {
  content: string;
}

export interface CollectionSummary {
  slug: string;
  name: string;
  description: string;
  industry: string;
  block_slugs: string[];
  output_file_count: number;
}

export interface CollectionFull extends CollectionSummary {
  blocks: BlockFull[];
  output_files: { filename: string; purpose: string; depends_on: string[] }[];
}

export async function listBlocks(category?: string): Promise<BlockSummary[]> {
  const params = category ? `?category=${category}` : "";
  const resp = await fetch(`/api/blocks${params}`);
  if (!resp.ok) throw new Error(`Failed to list blocks: ${resp.status}`);
  return resp.json();
}

export async function searchBlocks(query: string): Promise<BlockSummary[]> {
  const resp = await fetch(`/api/blocks/search?q=${encodeURIComponent(query)}`);
  if (!resp.ok) throw new Error(`Failed to search blocks: ${resp.status}`);
  return resp.json();
}

export async function getBlock(slug: string): Promise<BlockFull> {
  const resp = await fetch(`/api/blocks/${slug}`);
  if (!resp.ok) throw new Error(`Failed to get block: ${resp.status}`);
  return resp.json();
}

export async function* streamModifyBlocks(
  blockSlugs: string[],
  message: string,
  history: ChatMessage[] = [],
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/modify-blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block_slugs: blockSlugs, message, history }),
    signal,
  });
  if (!resp.ok) throw new Error(`Block agent failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export async function modifyCollectionBlocks(
  blockSlugs: string[],
  message: string,
): Promise<{ updated_slugs: string[]; explanation: string }> {
  const resp = await fetch("/api/collections/modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block_slugs: blockSlugs, message }),
  });
  if (!resp.ok) throw new Error(`Failed to modify blocks: ${resp.status}`);
  return resp.json();
}

export async function matchCollection(topic: string): Promise<{ match: CollectionSummary | null }> {
  const resp = await fetch(`/api/collections/match?topic=${encodeURIComponent(topic)}`);
  if (!resp.ok) throw new Error(`Failed to match collection: ${resp.status}`);
  return resp.json();
}

export async function listCollections(): Promise<CollectionSummary[]> {
  const resp = await fetch("/api/collections");
  if (!resp.ok) throw new Error(`Failed to list collections: ${resp.status}`);
  return resp.json();
}

export async function createBlock(block: {
  slug: string; name: string; category: string; tags: string[];
  description: string; content: string; related?: string[];
}): Promise<BlockFull> {
  const resp = await fetch("/api/blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(block),
  });
  if (!resp.ok) throw new Error(`Failed to create block: ${resp.status}`);
  return resp.json();
}

export async function updateBlock(slug: string, block: {
  slug: string; name: string; category: string; tags: string[];
  description: string; content: string; related?: string[];
}): Promise<BlockFull> {
  const resp = await fetch(`/api/blocks/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(block),
  });
  if (!resp.ok) throw new Error(`Failed to update block: ${resp.status}`);
  return resp.json();
}

export async function deleteBlock(slug: string): Promise<void> {
  const resp = await fetch(`/api/blocks/${slug}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete block: ${resp.status}`);
}

export async function createCollection(coll: {
  slug: string; name: string; description: string; industry: string;
  block_slugs: string[]; output_files: { filename: string; purpose: string; depends_on: string[] }[];
}): Promise<CollectionFull> {
  const resp = await fetch("/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(coll),
  });
  if (!resp.ok) throw new Error(`Failed to create collection: ${resp.status}`);
  return resp.json();
}

export async function updateCollection(slug: string, coll: {
  slug: string; name: string; description: string; industry: string;
  block_slugs: string[]; output_files: { filename: string; purpose: string; depends_on: string[] }[];
}): Promise<CollectionFull> {
  const resp = await fetch(`/api/collections/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(coll),
  });
  if (!resp.ok) throw new Error(`Failed to update collection: ${resp.status}`);
  return resp.json();
}

export async function deleteCollection(slug: string): Promise<void> {
  const resp = await fetch(`/api/collections/${slug}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete collection: ${resp.status}`);
}

export async function getCollection(slug: string): Promise<CollectionFull> {
  const resp = await fetch(`/api/collections/${slug}`);
  if (!resp.ok) throw new Error(`Failed to get collection: ${resp.status}`);
  return resp.json();
}

export async function* streamCollectionSuggestion(
  topic: string,
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/collections/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
    signal,
  });
  if (!resp.ok) throw new Error(`Collection suggestion failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}

export async function* streamWorkspaceBuild(
  generationId: number,
  signal?: AbortSignal,
): AsyncGenerator<WorkspaceEvent> {
  const resp = await fetch("/api/workspace/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: generationId }),
    signal,
  });
  if (!resp.ok) throw new Error(`Build failed: ${resp.status}`);
  yield* parseSSEStream(resp);
}
