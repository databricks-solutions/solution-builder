/**
 * Thin wrapper around POST /api/chat/stream that decodes the SSE taxonomy
 * and dispatches each event kind to a handler. Used by both ChatView
 * (full page) and ChatDock (floating popover).
 *
 * Event taxonomy (must match what the server emits — see
 * server/chat-stream/agent-stream.ts):
 *
 *   response.output_text.delta              — final-answer text token
 *   response.reasoning_summary_text.delta   — live reasoning summary token
 *   response.reasoning_summary_text.done    — final reasoning summary text
 *   response.output_item.done               — tool call / tool output /
 *                                             intermediate message
 *   response.completed                      — turn done (carries trace_id)
 *   error                                   — server-side error string
 */

export type StreamEventHandlers = {
  onDelta?: (delta: string) => void;
  onToolCall?: (call: {
    callId: string;
    name: string;
    args: string;
  }) => void;
  onToolOutput?: (out: { callId: string; output: string }) => void;
  onIntermediateMessage?: (text: string) => void;
  onFinalMessage?: (text: string) => void;
  /** Live-streaming reasoning summary token (Responses API). */
  onReasoningDelta?: (delta: string) => void;
  /** Final authoritative reasoning summary text. */
  onReasoningDone?: (text: string) => void;
  onCompleted?: (traceId: string | null) => void;
  onError?: (error: string) => void;
};

export type StreamRequest = {
  conversationId: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
};

export async function streamChat(
  req: StreamRequest,
  handlers: StreamEventHandlers,
): Promise<void> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: req.conversationId,
      messages: req.messages,
    }),
    signal: req.signal,
  });
  // On non-2xx, read the body (if any) so the user sees the real reason
  // instead of a bare "HTTP 500". The server only returns non-2xx for
  // request validation; runtime errors come back as `error` SSE events.
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(
      body ? `HTTP ${res.status}: ${body.slice(0, 500)}` : `HTTP ${res.status}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // try/finally so an abort or parse error always releases the reader's
  // lock on the underlying connection. Otherwise the socket leaks and
  // subsequent turns can hit `Failed to acquire lock`.
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
          dispatch(JSON.parse(data), handlers);
        } catch {
          /* skip non-JSON event lines (heartbeats, comments) */
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

function dispatch(evt: Record<string, unknown>, h: StreamEventHandlers) {
  const type = evt.type as string | undefined;
  if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
    h.onDelta?.(evt.delta);
    return;
  }
  if (
    type === 'response.reasoning_summary_text.delta' &&
    typeof evt.delta === 'string'
  ) {
    h.onReasoningDelta?.(evt.delta);
    return;
  }
  if (
    type === 'response.reasoning_summary_text.done' &&
    typeof evt.text === 'string'
  ) {
    h.onReasoningDone?.(evt.text);
    return;
  }
  if (type === 'response.output_item.done') {
    const item = evt.item as
      | {
          type?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
          output?: unknown;
          content?: Array<{ type?: string; text?: string }>;
        }
      | undefined;
    if (!item) return;
    if (item.type === 'function_call') {
      h.onToolCall?.({
        callId: item.call_id ?? '',
        name: item.name ?? '',
        args: item.arguments ?? '',
      });
    } else if (item.type === 'function_call_output') {
      h.onToolOutput?.({
        callId: item.call_id ?? '',
        output:
          typeof item.output === 'string'
            ? item.output
            : JSON.stringify(item.output),
      });
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      const t = item.content.find((c) => c?.type === 'output_text')?.text;
      if (typeof t !== 'string' || t.length === 0) return;
      if (typeof (evt as { step?: number }).step === 'number') {
        h.onFinalMessage?.(t);
      } else {
        h.onIntermediateMessage?.(t);
      }
    }
    return;
  }
  if (type === 'response.completed') {
    const tid =
      (evt as {
        databricks_output?: { trace?: { info?: { trace_id?: string } } };
      })?.databricks_output?.trace?.info?.trace_id ?? null;
    h.onCompleted?.(tid);
    return;
  }
  if (type === 'error' && typeof evt.error === 'string') {
    h.onError?.(evt.error);
  }
}
