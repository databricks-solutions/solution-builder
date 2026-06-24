/**
 * Shared types for the data-backend tools (`ask_genie`, `ask_mas`).
 *
 * Both tools return the same shape and emit the same progress events so
 * the UI's Thinking panel doesn't care which one the agent called.
 */
import type { Request } from 'express';

/** Progress events bubbled up by the data-backend tools to the outer UI.
 * `agent-stream.ts` consumes these via `ctx.onToolProgress` and forwards
 * them as SSE so they land in the floating Thinking panel.
 *
 * The naming is `mas_*` for historical reasons; these events apply
 * equally to Genie. Don't rename — the SSE wire format is observable
 * from the client and changing it would break old persisted reasoning
 * trails. */
export type ToolProgressEvent =
  | { kind: 'mas_narration'; text: string; subAgent?: string }
  | { kind: 'mas_tool_call'; callId: string; subAgent: string; query: string }
  | { kind: 'mas_tool_output'; callId: string; subAgent: string; snippet: string };

/** Minimal context the data-backend helpers need. The full AgentContext
 * (in agent/<agent>.ts) has more fields — we narrow to what the tools
 * actually use so they don't need to know about db, userEmail, etc. */
export type DataToolContext = {
  req: Request;
  databricksHost: string;
  onToolProgress?: (ev: ToolProgressEvent) => void;
};

/** Return shape every data-backend tool produces. The OpenAI Agents SDK
 * feeds `answer` back to the model as the tool output; `trace_id` is
 * persisted on the assistant message for the "View trace" deep-link. */
export type DataCallResult = { answer: string; trace_id: string | null };
