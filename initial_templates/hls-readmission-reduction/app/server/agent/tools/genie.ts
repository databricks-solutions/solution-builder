/**
 * `ask_data` — ask a Databricks Genie Agent a question that needs structured
 * data (SQL over Unity Catalog tables), the document library (PDFs in an
 * attached UC volume), or both. One Genie Agent answers in one turn: it runs
 * `execute_sql` for the numbers, `search_context_files` for the documents,
 * and returns markdown with `[n](url)` citations to the source files.
 *
 * AGENT MODE ONLY. `POST /api/2.0/genie/agents/{id}/responses` (SSE) is the
 * only Genie path that reads volumes; the chat-mode Conversation API
 * (`start-conversation`) cannot see documents.
 *
 * Progress: the SSE stream is forwarded as ToolProgressEvents so the Thinking
 * panel shows reasoning, each SQL statement / document search, and the
 * results as they arrive.
 *
 * Follow-ups: the Genie conversation id is kept per app chat thread
 * (in-memory, capped), so "and for the defective ones?" keeps context. A
 * restart simply starts fresh threads.
 *
 * USAGE — registering this tool in your agent:
 *
 *   import { askDataTool } from './tools/genie.js';
 *   ...
 *   function makeTools(ctx: AgentContext) {
 *     return [
 *       askDataTool(ctx, ctx.genieSpaceId),
 *       // your other tools…
 *     ];
 *   }
 *
 * Requirements: the Genie agent must list the tables and/or the documents
 * volume (`data_sources`). Documents need the volume to be indexed first
 * (`/api/2.0/volume-indexes/{volume_id}` → SUCCEEDED); until then the agent
 * fails with `volume_content_search_failed`, which we surface as a message.
 */
import { loggedTool as tool } from './logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authedFetch } from '../../lib/auth.js';
import type { DataCallResult, DataToolContext, ToolProgressEvent } from './types.js';

/** App chat thread id → Genie conversation id. In-memory, capped. */
const genieThreads = new Map<string, string>();
const MAX_THREADS = 500;

function rememberThread(threadKey: string, conversationId: string): void {
  genieThreads.delete(threadKey);
  genieThreads.set(threadKey, conversationId);
  if (genieThreads.size > MAX_THREADS) {
    const oldest = genieThreads.keys().next().value;
    if (oldest !== undefined) genieThreads.delete(oldest);
  }
}

/** Tool output is fed back to the model and shown in the Thinking panel;
 * a document search returns whole PDF passages, so cap what we keep. */
const MAX_SNIPPET_CHARS = 4000;

type GenieItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  output?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type GenieEvent = {
  type?: string;
  item?: GenieItem;
  response?: {
    conversation_id?: string;
    output?: GenieItem[];
    error?: { code?: string; message?: string } | null;
  };
  error?: { code?: string; message?: string } | null;
};

/** Friendly text for the model + user when the agent reports a failure. */
function failureMessage(err: { code?: string; message?: string } | null | undefined): string {
  if (err?.code === 'volume_content_search_failed') {
    return 'The documents are still being indexed for Genie search, so I cannot read them yet. Try again in a few minutes.';
  }
  return `Genie Agent failed${err?.code ? ` [${err.code}]` : ''}: ${err?.message ?? 'unknown error'}`;
}

/**
 * Low-level helper: call the Genie Agent and stream-forward its activity.
 * Exported so tests / alternate tool wrappers can reuse it without going
 * through the OpenAI Agents SDK `tool()` wrapping.
 */
export async function callGenieAgent(
  ctx: DataToolContext,
  spaceId: string,
  question: string,
  threadKey?: string,
): Promise<DataCallResult> {
  function emit(ev: ToolProgressEvent) {
    try {
      ctx.onToolProgress?.(ev);
    } catch (e) {
      // A bug in onToolProgress shouldn't break the agent, but it IS a bug
      // worth seeing — log it as a real error so the customizer notices.
      console.error('[onToolProgress] callback threw — fix the handler', e);
    }
  }

  const priorConversation = threadKey ? genieThreads.get(threadKey) : undefined;
  const url = `${ctx.databricksHost}/api/2.0/genie/agents/${spaceId}/responses`;
  const body = {
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] },
    ],
    ...(priorConversation ? { conversation_id: priorConversation } : {}),
  };

  // authedFetch: OBO first, one retry as the app SP on 401/403.
  // 10-min cap: a hung gateway must not wedge the turn; the Genie server
  // itself allows up to 30 min, so this is a deliberate client-side bound.
  const resp = await authedFetch(ctx.req, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(10 * 60 * 1000),
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const t = await resp.text().catch(() => '');
    console.error('[ask_data] Genie Agent bad response', { status: resp.status, body: t.slice(0, 500) });
    // Drop a thread the service rejected so the next question starts clean.
    if (threadKey && priorConversation) genieThreads.delete(threadKey);
    return { answer: `Genie Agent call failed: HTTP ${resp.status} ${t.slice(0, 300)}`, trace_id: null };
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let conversationId: string | null = priorConversation ?? null;
  let finalText: string | null = null;
  let failure: string | null = null;
  // Map call_id → subAgent so function_call_output pairs with its call.
  const callSubAgent = new Map<string, string>();
  // A function_call can arrive on output_item.added only (the document
  // search call never gets a .done in the live stream), so announce each
  // call on first sight, whichever event carries it.
  const seenCalls = new Set<string>();

  const handleItem = (item: GenieItem) => {
    if (item.type === 'reasoning') {
      const text = (item.content ?? [])
        .map((c) => c?.text ?? '')
        .join('')
        .trim();
      if (text) emit({ kind: 'genie_narration', text });
    } else if (item.type === 'function_call') {
      const callId = item.call_id ?? item.name ?? `genie-${Date.now()}`;
      if (seenCalls.has(callId)) return;
      seenCalls.add(callId);
      if (item.name === 'execute_sql') {
        callSubAgent.set(callId, 'sql');
        let title = '';
        let sql = '';
        try {
          const args = JSON.parse(item.arguments ?? '{}') as { title?: string; sql?: string };
          title = args.title ?? '';
          sql = args.sql ?? '';
        } catch {
          sql = item.arguments ?? '';
        }
        const query = title && sql ? `${title}\n\n${sql}` : sql || title;
        emit({ kind: 'genie_tool_call', callId, subAgent: 'sql', query });
      } else if (item.name === 'search_context_files') {
        callSubAgent.set(callId, 'documents');
        emit({ kind: 'genie_tool_call', callId, subAgent: 'documents', query: 'Searching documents…' });
      } else {
        const subAgent = item.name ?? 'genie';
        callSubAgent.set(callId, subAgent);
        emit({ kind: 'genie_tool_call', callId, subAgent, query: item.arguments ?? '' });
      }
    } else if (item.type === 'function_call_output' && item.call_id) {
      emit({
        kind: 'genie_tool_output',
        callId: item.call_id,
        subAgent: callSubAgent.get(item.call_id) ?? 'genie',
        snippet: (item.output ?? '').slice(0, MAX_SNIPPET_CHARS),
      });
    } else if (item.type === 'message') {
      // The last assistant message is the answer (markdown + [n](url) citations).
      // Genie splits a multi-part answer across several output_text parts
      // (e.g. summary, results table, document findings) — keep them all.
      const text = (item.content ?? [])
        .filter((c) => c?.type === 'output_text' && c.text)
        .map((c) => c.text!.trim())
        .join('\n\n');
      if (text) finalText = text;
    }
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          console.error('[ask_data] Genie Agent timed out after 10 minutes');
          return {
            answer: 'The Genie Agent timed out after 10 minutes. Try a narrower question.',
            trace_id: null,
          };
        }
        throw e;
      }
      const { value, done } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev: GenieEvent;
        try {
          ev = JSON.parse(data) as GenieEvent;
        } catch {
          continue;
        }
        conversationId = ev.response?.conversation_id ?? conversationId;
        switch (ev.type) {
          case 'response.output_item.added':
            // Only function calls are announced early; other items wait for .done.
            if (ev.item?.type === 'function_call') handleItem(ev.item);
            break;
          case 'response.output_item.done':
            if (ev.item) handleItem(ev.item);
            break;
          case 'response.failed':
            failure = failureMessage(ev.response?.error ?? ev.error);
            break;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  if (threadKey && conversationId) rememberThread(threadKey, conversationId);
  const answer = failure ?? finalText ?? '(Genie Agent returned no answer)';
  console.log(`[ask_data] stream closed — answer_len=${answer.length}ch conversation=${conversationId}`);
  return { answer, trace_id: null };
}

/**
 * OpenAI Agents SDK tool wrapper. Closes over `ctx` + `spaceId` so the
 * agent only needs to pass the `question`.
 */
export function askDataTool(ctx: DataToolContext, spaceId: string) {
  // The chat route (POST /api/chat/stream) parses the JSON body, so the
  // app's conversation id is available here without extra plumbing.
  const bodyConversation = (ctx.req.body as { conversationId?: unknown } | undefined)?.conversationId;
  const threadKey = typeof bodyConversation === 'string' ? bodyConversation : undefined;
  return tool({
    name: 'ask_data',
    description:
      'Ask a question about the business data and documents. A Genie Agent answers from the governed tables (SQL) and from the document library (policies, procedures, incident reports, PDFs), and cites the documents it used. Use for any "how much / how many" question, any "what does the policy say" question, and any "why / what happened" question that needs both. Returns a markdown answer with citations.',
    parameters: z.object({
      question: z
        .string()
        .describe(
          'A clear, focused English question. Narrow questions finish in 20–40s; broad multi-part questions can take 90s+.',
        ),
    }),
    execute: async ({ question }) =>
      mlflow.withSpan(
        async () => callGenieAgent(ctx, spaceId, question, threadKey),
        {
          name: 'ask_data',
          spanType: mlflow.SpanType.TOOL,
          inputs: { question },
        },
      ),
  });
}
