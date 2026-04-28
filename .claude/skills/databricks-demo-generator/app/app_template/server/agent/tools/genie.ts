/**
 * `ask_genie` — query an AI/BI Genie space from inside the agent loop.
 *
 * Genie is Databricks' natural-language SQL surface: you ask a question
 * in English, it picks tables/columns, generates SQL, runs it, and
 * returns a synthesized answer (plus the SQL it ran, plus optional
 * step-by-step reasoning traces from the April 2026 release).
 *
 * Genie REST is POLL-based (no native streaming), so we fire a
 * start-conversation, then poll messages until COMPLETED / FAILED /
 * CANCELLED. While polling we emit a one-shot narration to the
 * Thinking panel so the user sees activity instead of dead air.
 *
 * USAGE — registering this tool in your agent:
 *
 *   import { askGenieTool } from './tools/genie.js';
 *   ...
 *   function makeTools(ctx: AgentContext) {
 *     return [
 *       askGenieTool(ctx, ctx.genieSpaceId),
 *       // your other tools…
 *     ];
 *   }
 *
 * If your demo has BOTH a Genie space AND a MAS endpoint, register
 * both this tool AND `askMasTool` from `./mas.ts` — give them distinct
 * names (e.g. `ask_data_genie`, `ask_data_mas`) and tell the model in
 * the agent instructions when to prefer each.
 */
import { tool } from '@openai/agents';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../../lib/auth.js';
import type { DataCallResult, DataToolContext, ToolProgressEvent } from './types.js';

/**
 * Low-level helper: call Genie REST and return the synthesized answer.
 * Exported so tests / alternate tool wrappers can reuse it without going
 * through the OpenAI Agents SDK `tool()` wrapping.
 */
export async function callGenieSpace(
  ctx: DataToolContext,
  spaceId: string,
  question: string,
): Promise<DataCallResult> {
  function emit(ev: ToolProgressEvent) {
    try { ctx.onToolProgress?.(ev); } catch { /* never let progress fail the tool */ }
  }

  const headers = await authHeaders(ctx.req);
  headers.set('Content-Type', 'application/json');

  // Start a Genie conversation.
  const startUrl = `${ctx.databricksHost}/api/2.0/genie/spaces/${spaceId}/start-conversation`;
  const startResp = await fetch(startUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: question }),
  });
  if (!startResp.ok) {
    const t = await startResp.text().catch(() => '');
    console.error('[ask_genie] start-conversation failed', {
      status: startResp.status,
      body: t.slice(0, 500),
    });
    return {
      answer: `Genie API call failed: ${startResp.status} ${t.slice(0, 200)}`,
      trace_id: null,
    };
  }
  const { conversation_id, message_id } = (await startResp.json()) as {
    conversation_id: string;
    message_id: string;
  };

  emit({
    kind: 'mas_narration',
    text: `Querying Genie: "${question.slice(0, 80)}..."`,
    subAgent: 'genie',
  });

  // Poll for the answer (Genie REST is async — no streaming).
  const pollUrl = `${ctx.databricksHost}/api/2.0/genie/spaces/${spaceId}/conversations/${conversation_id}/messages/${message_id}`;
  let answer = '';
  for (let attempts = 0; attempts < 60; attempts++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollHeaders = await authHeaders(ctx.req);
    pollHeaders.set('Content-Type', 'application/json');
    const pollResp = await fetch(pollUrl, { method: 'GET', headers: pollHeaders });
    if (!pollResp.ok) continue;
    const pollData = (await pollResp.json()) as {
      status: string;
      attachments?: Array<{
        text?: { content: string };
        query?: { description: string; query: string };
        // April 2026 Genie release: step-by-step reasoning the model used
        // to produce the SQL/answer. Fold into the Thinking panel.
        query_attachments?: { description?: string; reasoning?: string };
      }>;
      // Present on FAILED / CANCELLED responses.
      error?: { error?: string; type?: string };
    };

    if (pollData.status === 'COMPLETED') {
      // Forward reasoning traces (if present) BEFORE the final answer so
      // the Thinking panel shows the model's thought process.
      for (const att of pollData.attachments ?? []) {
        const reasoning = att.query_attachments?.reasoning;
        if (reasoning) {
          emit({ kind: 'mas_narration', text: reasoning, subAgent: 'genie' });
        }
      }
      const parts: string[] = [];
      for (const att of pollData.attachments ?? []) {
        if (att.text?.content) parts.push(att.text.content);
        if (att.query?.description) parts.push(att.query.description);
      }
      answer = parts.join('\n\n') || '(Genie returned no text content)';
      break;
    } else if (pollData.status === 'FAILED' || pollData.status === 'CANCELLED') {
      // Surface Genie's actual error (missing tables, permission denied,
      // ambiguous SQL, etc.) instead of a useless "Genie query failed."
      const errMsg = pollData.error?.error
        ? `[Genie ${pollData.error.type ?? 'error'}] ${pollData.error.error}`
        : `Genie query ${pollData.status.toLowerCase()}.`;
      console.error('[ask_genie] query failed', {
        status: pollData.status,
        error: pollData.error,
      });
      answer = errMsg;
      break;
    }
  }
  if (!answer) answer = 'Genie query timed out after 120 seconds.';

  return { answer, trace_id: null };
}

/**
 * OpenAI Agents SDK tool wrapper. Closes over `ctx` + `spaceId` so the
 * agent only needs to pass the `question`.
 */
export function askGenieTool(ctx: DataToolContext, spaceId: string) {
  return tool({
    name: 'ask_genie',
    description:
      'Ask an open-ended question about your data and have it answered with SQL via the Databricks AI/BI Genie space. Use for "why" / "what" / investigative questions over the data warehouse. Returns the synthesized natural-language answer.',
    parameters: z.object({
      question: z
        .string()
        .describe(
          'A clear, focused English question about the data. Keep it specific — broad questions trigger long polls.',
        ),
    }),
    execute: async ({ question }) =>
      mlflow.withSpan(
        async () => callGenieSpace(ctx, spaceId, question),
        {
          name: 'ask_genie',
          spanType: mlflow.SpanType.TOOL,
          inputs: { question },
        },
      ),
  });
}
