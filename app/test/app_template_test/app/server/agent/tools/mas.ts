/**
 * `ask_mas` — query a Databricks Multi-Agent Supervisor (MAS) endpoint
 * from inside the agent loop.
 *
 * MAS is a Databricks Mosaic Agent Framework supervisor that itself
 * routes between sub-agents (data_analyst → Genie, incident_expert → KA
 * retrieval, etc.) and returns a single synthesized answer. We POST to
 * `/serving-endpoints/<name>/invocations` with `stream:true` and forward
 * the supervisor's narration + sub-agent activity to the Thinking panel
 * as it arrives — this is the core "watch the agent work" demo moment.
 *
 * USAGE — registering this tool in your agent:
 *
 *   import { askMasTool } from './tools/mas.js';
 *   ...
 *   function makeTools(ctx: AgentContext) {
 *     return [
 *       askMasTool(ctx, ctx.masEndpointName),
 *       // your other tools…
 *     ];
 *   }
 *
 * If your demo has BOTH a Genie space AND a MAS endpoint, register
 * both this tool AND `askGenieTool` from `./genie.ts` — give them
 * distinct names and tell the model in the agent instructions when to
 * prefer each.
 */
import { loggedTool as tool } from './logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../../lib/auth.js';
import type { DataCallResult, DataToolContext, ToolProgressEvent } from './types.js';

/**
 * Low-level helper: POST to a MAS serving endpoint and stream-forward
 * the supervisor + sub-agent events. Exported so tests / alternate tool
 * wrappers can reuse it without going through the OpenAI Agents SDK.
 */
export async function callMasEndpoint(
  ctx: DataToolContext,
  endpointName: string,
  question: string,
): Promise<DataCallResult> {
  function emit(ev: ToolProgressEvent) {
    try {
      ctx.onToolProgress?.(ev);
    } catch (e) {
      // A bug in onToolProgress shouldn't break the agent, but it IS a bug
      // worth seeing when it happens — log it as a real error so the LLM
      // customizing the template notices and fixes it.
      console.error('[onToolProgress] callback threw — fix the handler', e);
    }
  }

  const headers = await authHeaders(ctx.req);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'text/event-stream');

  // MAS supervisors that fan out to multiple sub-agents can legitimately
  // take several minutes (each sub-agent hop runs Genie or KA). Cap at
  // 10 min so a hung gateway or stalled sub-agent can't wedge the turn
  // forever — long-tail success is fine, infinite hang is not.
  const abort = AbortSignal.timeout(10 * 60 * 1000);

  const url = `${ctx.databricksHost}/serving-endpoints/${endpointName}/invocations`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    signal: abort,
    body: JSON.stringify({
      input: [{ role: 'user', content: question }],
      databricks_options: { return_trace: true },
      stream: true,
    }),
  });
  // Return the error string as the tool's answer rather than throwing —
  // the agent SDK then feeds it back to the model so it can apologize /
  // retry instead of crashing the whole turn.
  if (!resp.ok || !resp.body) {
    const t = await resp.text().catch(() => '');
    console.error('[ask_mas] endpoint bad response', {
      status: resp.status,
      body: t.slice(0, 500),
    });
    return {
      answer: `MAS call failed: HTTP ${resp.status} ${t.slice(0, 300)}`,
      trace_id: null,
    };
  }
  console.log('[ask_mas] stream opened, reading events…');

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let trace_id: string | null = null;
  // Supervisor messages with a `step` number are the outer narration we want
  // to keep as the final answer; the LAST such message is the synthesis.
  let lastStepText: string | null = null;
  // Some MAS shapes emit only delta events (no step-tagged synthesis); we
  // accumulate those as a fallback final answer.
  const deltaBuf: string[] = [];
  // Track the sub-agent that "owns" the next message via the <name>X</name>
  // routing tag the MAS inserts before each sub-agent response.
  let currentSubAgent: string | null = null;
  // Keep call_id → sub-agent name for pairing tool outputs.
  const callSubAgent = new Map<string, string>();
  // Track the most recent tool-call id so sub-agent messages that arrive as
  // `message` items (without their own call_id) can be paired back to the
  // triggering tool call in the UI.
  let lastToolCallId: string | null = null;

  // try/finally so we always release the reader's hold on the underlying
  // socket — otherwise an exception inside the loop leaks the connection.
  // AbortError (from the 10-min timeout) is caught here and turned into a
  // graceful "timed out" tool result so the agent can apologize/retry.
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Derive the read-result type from the reader rather than naming
      // ReadableStreamReadResult directly — that DOM lib type isn't in the
      // server tsconfig's `lib` (ES2020, no DOM).
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          console.error('[ask_mas] stream timed out after 10 minutes');
          return {
            answer:
              'MAS call timed out after 10 minutes. The supervisor may be stuck on a long sub-agent hop — try a narrower question.',
            trace_id: null,
          };
        }
        throw e;
      }
      const { value, done } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const p of parts) {
        const line = p.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const data = line.slice(6);
        if (!data || data === '[DONE]') continue;
        let ev: {
          type?: string;
          item?: {
            type?: string;
            content?: Array<{ type?: string; text?: string }>;
            name?: string;
            arguments?: string;
            call_id?: string;
          };
          step?: number;
          databricks_output?: { trace?: { info?: { trace_id?: string } } };
        };
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }

        if (ev.type === 'response.completed') {
          trace_id = ev.databricks_output?.trace?.info?.trace_id ?? trace_id;
          continue;
        }

        // Streaming text deltas — accumulate as a fallback answer in case
        // the supervisor never emits a step-tagged synthesis message.
        if (
          ev.type === 'response.output_text.delta' &&
          typeof (ev as { delta?: string }).delta === 'string'
        ) {
          deltaBuf.push((ev as { delta: string }).delta);
          continue;
        }

        if (ev.type !== 'response.output_item.done') continue;
        const item = ev.item;
        if (!item) continue;

        if (item.type === 'message' && Array.isArray(item.content)) {
          const text = item.content.find((c) => c?.type === 'output_text')?.text;
          if (!text) continue;
          // `<name>foo</name>` tag → upcoming message is from sub-agent "foo".
          const tagMatch = text.trim().match(/^<name>([^<]+)<\/name>$/);
          if (tagMatch) {
            currentSubAgent = tagMatch[1];
            continue;
          }
          if (typeof ev.step === 'number') {
            // Supervisor narration (step N). Latest wins for the final answer.
            lastStepText = text;
            emit({ kind: 'mas_narration', text });
            currentSubAgent = null;
          } else {
            // Sub-agent output (tool result / RAG response). Pair it with
            // the last tool call so the UI can nest the output under the
            // call that triggered it.
            emit({
              kind: 'mas_tool_output',
              callId: lastToolCallId ?? `mas-orphan-${Date.now()}`,
              subAgent: currentSubAgent ?? 'data',
              snippet: text,
            });
            currentSubAgent = null;
          }
        } else if (item.type === 'function_call') {
          // Supervisor delegating to a sub-agent. `name` here is e.g.
          // 'data_analyst' / 'incident_expert'; the argument is the query.
          const subAgent = item.name ?? 'data';
          const callId = item.call_id ?? `mas-${Date.now()}-${Math.random()}`;
          callSubAgent.set(callId, subAgent);
          let query = '';
          try {
            const parsed = JSON.parse(item.arguments ?? '{}') as Record<
              string,
              string
            >;
            query =
              parsed.genie_query ||
              parsed.ka_query ||
              parsed.query ||
              parsed.question ||
              item.arguments ||
              '';
          } catch {
            query = item.arguments ?? '';
          }
          lastToolCallId = callId;
          emit({ kind: 'mas_tool_call', callId, subAgent, query });
        } else if (item.type === 'function_call_output' && item.call_id) {
          const subAgent = callSubAgent.get(item.call_id) ?? 'data';
          const out =
            item.content?.find((c) => c?.type === 'output_text')?.text ?? '';
          emit({
            kind: 'mas_tool_output',
            callId: item.call_id,
            subAgent,
            snippet: out,
          });
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  // Fall back to accumulated deltas if the supervisor never emitted a
  // step-tagged synthesis. Both shapes show up in the wild.
  const answer = lastStepText || deltaBuf.join('') || '(no answer)';
  console.log(
    `[ask_mas] stream closed — answer_len=${answer.length}ch trace_id=${trace_id}`,
  );
  return { answer, trace_id };
}

/**
 * OpenAI Agents SDK tool wrapper. Closes over `ctx` + `endpointName` so
 * the agent only needs to pass the `question`.
 */
export function askMasTool(ctx: DataToolContext, endpointName: string) {
  return tool({
    name: 'ask_mas',
    description:
      'Ask an open-ended question that may require SQL data lookups, document/knowledge retrieval, or both. Routes to a Databricks Multi-Agent Supervisor that orchestrates between sub-agents (data_analyst, incident_expert, etc.) and returns a synthesized answer. Use for any "why" / "what happened" / investigative question.',
    parameters: z.object({
      question: z
        .string()
        .describe(
          'A clear, focused English question. Narrow questions finish in 20–40s; broad multi-part questions can take 90s+ as the supervisor hops between sub-agents.',
        ),
    }),
    execute: async ({ question }) =>
      mlflow.withSpan(
        async () => callMasEndpoint(ctx, endpointName, question),
        {
          name: 'ask_mas',
          spanType: mlflow.SpanType.TOOL,
          inputs: { question },
        },
      ),
  });
}
