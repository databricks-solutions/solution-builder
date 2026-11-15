/**
 * Shared types for the data-backend tool (`ask_data`, see ./genie.ts).
 */
import type { Request } from 'express';

/** Progress events bubbled up by the data tool to the outer UI.
 * `agent-stream.ts` consumes these via `ctx.onToolProgress` and forwards
 * them as SSE so they land in the floating Thinking panel. */
export type ToolProgressEvent =
  | { kind: 'genie_narration'; text: string; subAgent?: string }
  | { kind: 'genie_tool_call'; callId: string; subAgent: string; query: string }
  | { kind: 'genie_tool_output'; callId: string; subAgent: string; snippet: string };

/** Minimal context the data-backend helpers need. The full AgentContext
 * (in agent/underwriting.ts) has more fields — we narrow to what the tool
 * actually uses so it doesn't need to know about db, userEmail, etc. */
export type DataToolContext = {
  req: Request;
  databricksHost: string;
  onToolProgress?: (ev: ToolProgressEvent) => void;
};

/** Return shape the data tool produces. The OpenAI Agents SDK feeds `answer`
 * back to the model as the tool output; `trace_id` is persisted on the
 * assistant message for the "View trace" deep-link. */
export type DataCallResult = { answer: string; trace_id: string | null };
