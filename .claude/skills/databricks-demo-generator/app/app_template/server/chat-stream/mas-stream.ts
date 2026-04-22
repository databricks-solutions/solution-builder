import type { Request, Response } from 'express';
import { authHeaders } from '../lib/auth.js';
import { convertChatChunk, fixMojibake } from '../lib/endpoint.js';
import type { ThinkingEntry } from '../db/schema.js';
import { sseError, sseWrite } from './sse.js';

type Msg = { role: string; content: string };

/**
 * Raw fetch to the MAS serving endpoint with SSE passthrough. Auto-detects
 * agent vs chat_completion payload shape and caches per endpoint. Returns
 * the accumulated final text + trace_id so the caller can persist them.
 */
export async function streamMasTurn(args: {
  req: Request;
  res: Response;
  host: string;
  endpoint: string;
  messages: Msg[];
  formatCache: Map<string, 'agent' | 'chat_completion'>;
}): Promise<{
  finalText: string | null;
  traceId: string | null;
  thinking: ThinkingEntry[];
  error: string | null;
}> {
  const { req, res, host, endpoint, messages, formatCache } = args;
  const thinking: ThinkingEntry[] = [];
  let caughtError: string | null = null;

  const url = `${host}/serving-endpoints/${endpoint}/invocations`;
  const buildAgent = () => ({
    input: messages,
    databricks_options: { return_trace: true },
    stream: true,
  });
  const buildChat = () => ({ messages, stream: true });

  async function call(format: 'agent' | 'chat_completion') {
    const body = format === 'agent' ? buildAgent() : buildChat();
    const headers = await authHeaders(req);
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'text/event-stream');
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  let format: 'agent' | 'chat_completion' = formatCache.get(endpoint) ?? 'agent';
  let resp = await call(format);

  if (!resp.ok && !formatCache.has(endpoint)) {
    const errText = await resp.text();
    if (
      /Missing required Chat parameter|missing inputs \['messages'\]|extra inputs: \['input'\]/i.test(
        errText,
      )
    ) {
      format = 'chat_completion';
      resp = await call(format);
    } else {
      caughtError = errText;
      sseError(res, errText);
      return { finalText: null, traceId: null, thinking, error: caughtError };
    }
  }
  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => 'no body');
    caughtError = `HTTP ${resp.status}: ${errText}`;
    sseError(res, caughtError);
    return { finalText: null, traceId: null, thinking, error: caughtError };
  }
  formatCache.set(endpoint, format);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let accumulated = '';
  let finalText: string | null = null;
  let traceId: string | null = null;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const evt = JSON.parse(data);
          const out = format === 'chat_completion' ? convertChatChunk(evt) : evt;
          if (!out) continue;
          if (
            out.type === 'response.output_text.delta' &&
            typeof out.delta === 'string'
          ) {
            out.delta = fixMojibake(out.delta);
            accumulated += out.delta;
          } else if (
            out.type === 'response.output_item.done' &&
            out.item?.type === 'message' &&
            Array.isArray(out.item.content) &&
            typeof out.step === 'number'
          ) {
            const t = out.item.content.find(
              (c: { type: string }) => c.type === 'output_text',
            )?.text;
            if (typeof t === 'string' && t.length > 0) finalText = t;
          } else if (
            out.type === 'response.output_item.done' &&
            out.item?.type === 'message' &&
            Array.isArray(out.item.content) &&
            typeof out.step !== 'number'
          ) {
            const t = out.item.content.find(
              (c: { type: string }) => c.type === 'output_text',
            )?.text;
            if (typeof t === 'string' && t.length > 0) {
              thinking.push({ kind: 'intermediate_message', text: t });
            }
          } else if (
            out.type === 'response.output_item.done' &&
            out.item?.type === 'function_call'
          ) {
            thinking.push({
              kind: 'tool_call',
              callId: out.item.call_id ?? '',
              name: out.item.name ?? '',
              args: out.item.arguments ?? '',
            });
          } else if (
            out.type === 'response.output_item.done' &&
            out.item?.type === 'function_call_output'
          ) {
            thinking.push({
              kind: 'tool_output',
              callId: out.item.call_id ?? '',
              output:
                typeof out.item.output === 'string'
                  ? out.item.output
                  : JSON.stringify(out.item.output),
            });
          } else if (out.type === 'response.completed') {
            const tid = out?.databricks_output?.trace?.info?.trace_id;
            if (typeof tid === 'string') traceId = tid;
          }
          sseWrite(res, out);
        } catch {
          /* skip non-JSON */
        }
      }
    }
  } catch (e) {
    caughtError = (e as Error).message;
    sseError(res, caughtError);
  }

  return {
    finalText: finalText ?? (accumulated || null),
    traceId,
    thinking,
    error: caughtError,
  };
}
