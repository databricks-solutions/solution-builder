import type { Request, Response } from 'express';
import * as mlflow from 'mlflow-tracing';
import {
  buildAgent as buildRefundOpsAgent,
  configureAgentsSdk,
  run as runAgent,
  type AgentContext,
} from '../agent/refundops.js';
import { fixMojibake } from '../lib/endpoint.js';
import type { AppDb } from '../db/index.js';
import type { ThinkingEntry } from '../db/schema.js';
import { sseError, sseWrite } from './sse.js';

type Msg = { role: string; content: string };

/**
 * Drive the OpenAI Agents SDK loop (Responses API) and emit SSE events.
 *
 * We tap the raw Responses API stream so we can distinguish reasoning
 * deltas from final-answer deltas:
 *
 *   - response.reasoning_summary_text.delta  → reasoning tokens (Thinking panel, live)
 *   - response.output_text.delta             → final-answer tokens (main bubble, live)
 *   - tool_called / tool_output              → SDK-level tool activity (Thinking panel)
 *
 * The persisted `thinking` trail captures the reasoning summaries + tool calls
 * so the "▸ Reasoning" toggle on old messages shows what the agent did.
 */
export async function streamAgentTurn(args: {
  db: AppDb;
  req: Request;
  res: Response;
  userEmail: string;
  masEndpointName: string;
  databricksHost: string;
  model: string;
  messages: Msg[];
}): Promise<{
  finalText: string | null;
  traceId: string | null;
  thinking: ThinkingEntry[];
  error: string | null;
}> {
  const { res, messages } = args;
  const lastUser = messages[messages.length - 1];
  const userInput = lastUser?.role === 'user' ? lastUser.content : '';
  let finalText = '';
  let reasoningBuffer = '';
  let traceId: string | null = null;
  let caughtError: string | null = null;
  const thinking: ThinkingEntry[] = [];
  let sawToolOutput = false;
  let sawFinalDelta = false;
  let runStartMs = 0;

  const rootSpan = mlflow.startSpan({
    name: 'refundops.turn',
    spanType: mlflow.SpanType.AGENT,
    inputs: { user_input: userInput, history_len: messages.length },
  });
  traceId = rootSpan.traceId ?? null;

  try {
    const ctx: AgentContext = {
      db: args.db,
      userEmail: args.userEmail,
      req: args.req,
      masEndpointName: args.masEndpointName,
      databricksHost: args.databricksHost,
      model: args.model,
      // Forward sub-agent activity from the MAS tool (ask_data) live into
      // the outer Thinking panel. Each event is both persisted into
      // `thinking` (so it's in the saved reasoning trail) and streamed to
      // the browser as an SSE event the client already knows how to render.
      onToolProgress: (ev) => {
        if (ev.kind === 'mas_tool_call') {
          // Use the MAS-provided call_id on BOTH the persisted thinking
          // entry and the SSE event so the client can pair the later
          // tool_output with this call (otherwise the UI shows "unknown").
          thinking.push({
            kind: 'tool_call',
            callId: ev.callId,
            name: `mas:${ev.subAgent}`,
            args: JSON.stringify({ query: ev.query }),
          });
          sseWrite(res, {
            type: 'response.output_item.done',
            item: {
              type: 'function_call',
              call_id: ev.callId,
              name: `mas:${ev.subAgent}`,
              arguments: JSON.stringify({ query: ev.query }),
            },
          });
        } else if (ev.kind === 'mas_tool_output') {
          thinking.push({
            kind: 'tool_output',
            callId: ev.callId,
            output: ev.snippet,
          });
          sseWrite(res, {
            type: 'response.output_item.done',
            item: {
              type: 'function_call_output',
              call_id: ev.callId,
              output: ev.snippet,
            },
          });
        } else if (ev.kind === 'mas_narration') {
          thinking.push({ kind: 'intermediate_message', text: ev.text });
          sseWrite(res, {
            type: 'response.reasoning_summary_text.done',
            text: ev.text,
          });
        }
      },
    };
    await configureAgentsSdk(ctx);
    const agent = buildRefundOpsAgent(ctx);

    // Normalize history for the Responses API: user messages accept a plain
    // string, but assistant messages must use the structured content-array
    // shape `[{type: 'output_text', text: ...}]`. Passing a string for an
    // assistant item causes `item.content.map is not a function` in the
    // SDK's getMessageItem when building the next turn's input.
    //
    // We also drop empty-content messages here as a safety net. A prior
    // failed turn may have persisted an assistant row with content=''; the
    // Responses API rejects `{type: 'output_text', text: ''}` with a 502
    // "invalid response from upstream server" that's very hard to diagnose
    // from the client side. index.ts filters these upstream too, but this
    // second pass protects any future caller that bypasses it.
    const history = messages
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0,
      )
      .map((m) =>
        m.role === 'assistant'
          ? {
              role: 'assistant' as const,
              content: [
                { type: 'output_text' as const, text: m.content },
              ],
            }
          : { role: 'user' as const, content: m.content },
      );
    const runInput =
      history.length > 1
        ? (history as Parameters<typeof runAgent>[1])
        : userInput;
    runStartMs = Date.now();
    console.log(
      `[agent-stream] runAgent start — history_len=${messages.length} input_chars=${userInput.length}`,
    );
    const stream = await runAgent(agent, runInput as string, { stream: true });
    console.log(
      `[agent-stream] runAgent returned stream in ${Date.now() - runStartMs}ms`,
    );

    for await (const ev of stream) {
      // ── Raw model events ────────────────────────────────────────────────
      // The Agents SDK wraps OpenAI Responses events in two shapes:
      //   { type: 'output_text_delta', delta: '...' }        (SDK-normalized)
      //   { type: 'model', event: { type: 'response.<x>', ... } }
      // For `response.output_text.delta` the SDK emits BOTH back-to-back;
      // we want to process the underlying event exactly once. Unwrap the
      // `model` variant and ignore the normalized `output_text_delta`
      // duplicate — that way reasoning + text deltas all flow through the
      // same switch.
      if (ev.type === 'raw_model_stream_event') {
        const data = ev.data as {
          type?: string;
          delta?: string;
          text?: string;
          event?: { type?: string; delta?: string; text?: string };
        };
        if (data.type === 'output_text_delta') continue; // handled via `model`
        const inner = data.type === 'model' ? data.event ?? data : data;
        const t = inner.type;

        if (t === 'response.reasoning_summary_text.delta' && inner.delta) {
          const delta = fixMojibake(inner.delta);
          reasoningBuffer += delta;
          sseWrite(res, {
            type: 'response.reasoning_summary_text.delta',
            delta,
          });
        } else if (t === 'response.reasoning_summary_text.done') {
          const text = inner.text ?? reasoningBuffer;
          if (text) {
            thinking.push({ kind: 'intermediate_message', text });
          }
          reasoningBuffer = '';
          sseWrite(res, {
            type: 'response.reasoning_summary_text.done',
            text,
          });
        } else if (t === 'response.output_text.delta' && inner.delta) {
          const delta = fixMojibake(inner.delta);
          if (!sawFinalDelta) {
            sawFinalDelta = true;
            console.log(
              `[agent-stream] first final-answer delta at +${Date.now() - runStartMs}ms`,
            );
          }
          finalText += delta;
          sseWrite(res, { type: 'response.output_text.delta', delta });
        }
        continue;
      }

      // ── SDK-level events: tools + handoffs ─────────────────────────────────
      if (ev.type === 'run_item_stream_event') {
        const item = ev.item as {
          rawItem?: {
            type?: string;
            callId?: string;
            name?: string;
            arguments?: string;
            output?: unknown;
          };
        };
        const raw = item.rawItem;
        if (!raw) continue;
        if (ev.name === 'tool_called' && raw.type === 'function_call') {
          thinking.push({
            kind: 'tool_call',
            callId: raw.callId ?? '',
            name: raw.name ?? '',
            args: raw.arguments ?? '',
          });
          sseWrite(res, {
            type: 'response.output_item.done',
            item: {
              type: 'function_call',
              call_id: raw.callId ?? '',
              name: raw.name ?? '',
              arguments: raw.arguments ?? '',
            },
          });
        } else if (ev.name === 'tool_output') {
          sawToolOutput = true;
          console.log(
            `[agent-stream] tool_output received at +${Date.now() - runStartMs}ms (name=${raw.name ?? '?'})`,
          );
          const out =
            typeof raw.output === 'string'
              ? raw.output
              : JSON.stringify(raw.output);
          thinking.push({
            kind: 'tool_output',
            callId: raw.callId ?? '',
            output: out,
          });
          sseWrite(res, {
            type: 'response.output_item.done',
            item: {
              type: 'function_call_output',
              call_id: raw.callId ?? '',
              output: out,
            },
          });
        }
      }
    }
    await stream.completed;

    rootSpan.end({
      outputs: { final_text: finalText },
      status: mlflow.SpanStatusCode.OK,
    });
    sseWrite(res, {
      type: 'response.completed',
      databricks_output: traceId
        ? { trace: { info: { trace_id: traceId } } }
        : undefined,
    });
  } catch (e) {
    rootSpan.end({ status: mlflow.SpanStatusCode.ERROR });
    const err = e as Error & {
      status?: number;
      code?: string;
      cause?: unknown;
      request_id?: string;
      error?: unknown;
      response?: { status?: number; headers?: unknown; body?: unknown };
      headers?: unknown;
    };
    // Dump everything we can glean from the error. Many @openai/agents errors
    // wrap an OpenAI APIError which carries .status, .request_id, .headers,
    // .error (body). HTTP/stream errors also expose .cause with an
    // UND_ERR_SOCKET / ECONNRESET style reason.
    const dump = {
      name: err.name,
      message: err.message,
      status: err.status,
      code: err.code,
      request_id: err.request_id,
      headers: err.headers,
      response_status: err.response?.status,
      response_body: err.response?.body,
      error_body: err.error,
      cause:
        err.cause instanceof Error
          ? {
              name: err.cause.name,
              message: err.cause.message,
              stack: err.cause.stack,
              code: (err.cause as unknown as { code?: string }).code,
              cause: (err.cause as unknown as { cause?: unknown }).cause,
            }
          : err.cause,
      stack: err.stack,
      finalText_len: finalText.length,
      thinking_count: thinking.length,
      saw_tool_output: sawToolOutput,
      saw_final_delta: sawFinalDelta,
      elapsed_ms: runStartMs ? Date.now() - runStartMs : null,
    };
    console.error('[agent-stream] ERROR', JSON.stringify(dump, null, 2));
    caughtError = err.message || 'Unknown error';
    sseError(res, caughtError);
  }

  return {
    finalText: finalText || null,
    traceId,
    thinking,
    error: caughtError,
  };
}
