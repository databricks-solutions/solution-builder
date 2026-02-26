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
  | { type: "error"; content: string };

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
  role: "user" | "assistant";
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
