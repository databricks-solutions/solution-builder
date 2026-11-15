/**
 * Ask the demo's Genie Agent a question, in Agent mode.
 *
 * The Genie agent lists the demo tables AND a documents volume (data_sources.volumes), so one call can
 * answer from SQL, from the documents, or both, and returns markdown with `[n](url)` citations to the
 * source files. Agent mode (`POST /api/2.0/genie/agents/{id}/responses`, SSE) is the only Genie path that
 * reads volumes — the chat-mode Conversation API ignores them.
 *
 * Runs as the app SP (needs CAN_RUN on the agent, SELECT on the tables, READ VOLUME on the documents).
 */
import { appHeaders, host } from './sql.js';
import { ensureResources } from './resources.js';

type Item = { type?: string; name?: string; content?: Array<{ type?: string; text?: string }> };
type Ev = {
  type?: string;
  item?: Item;
  response?: { error?: { code?: string; message?: string } | null };
  error?: { code?: string; message?: string } | null;
};

export type GenieAnswer = { text: string; tools: string[] };

export async function askGenieAgent(question: string): Promise<GenieAnswer> {
  await ensureResources();
  const spaceId = process.env.GENIE_SPACE_ID;
  if (!spaceId) return { text: 'Genie agent not configured (GENIE_SPACE_ID).', tools: [] };
  const h = await appHeaders();
  h.set('Content-Type', 'application/json');
  h.set('Accept', 'text/event-stream');
  const r = await fetch(`${host()}/api/2.0/genie/agents/${spaceId}/responses`, {
    method: 'POST',
    headers: h,
    signal: AbortSignal.timeout(5 * 60 * 1000),
    body: JSON.stringify({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] }] }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => '');
    return { text: `Genie agent call failed: HTTP ${r.status} ${t.slice(0, 300)}`, tools: [] };
  }

  const tools: string[] = [];
  let text = '';
  let failure = '';
  const dec = new TextDecoder();
  let buf = '';
  const reader = r.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      const data = line?.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let ev: Ev;
      try { ev = JSON.parse(data) as Ev; } catch { continue; }
      if (ev.type === 'response.output_item.done' && ev.item) {
        if (ev.item.type === 'function_call' && ev.item.name) tools.push(ev.item.name);
        if (ev.item.type === 'message') {
          // A multi-part answer comes as several output_text parts — keep them all.
          const t = (ev.item.content ?? []).filter((c) => c.type === 'output_text' && c.text).map((c) => c.text!.trim()).join('\n\n');
          if (t) text = t;
        }
      } else if (ev.type === 'response.failed') {
        const e = ev.response?.error ?? ev.error;
        failure = e?.code === 'volume_content_search_failed'
          ? 'The documents are still being indexed for Genie search. Try again in a few minutes.'
          : `Genie agent failed${e?.code ? ` [${e.code}]` : ''}: ${e?.message ?? 'unknown error'}`;
      }
    }
  }
  return { text: failure || text || '(Genie agent returned no answer)', tools };
}
