/**
 * Streaming passthrough helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user. Re-encode before forwarding deltas.
 */
export function fixMojibake(s: string): string {
  if (!s) return s;
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch {
    /* fall through */
  }
  return s.replace(/[\u0080-\u00ff]+/g, (seg) => {
    try {
      return Buffer.from(seg, 'latin1').toString('utf8');
    } catch {
      return seg;
    }
  });
}

/**
 * Converts OpenAI-shape (and Gemini list-of-parts variant) streaming
 * chunks into the unified agent event shape so the frontend parses one
 * taxonomy regardless of the MAS endpoint's underlying protocol.
 */
export function convertChatChunk(
  chunk: Record<string, unknown>,
): { type: string; delta: string } | null {
  if (chunk?.object !== 'chat.completion.chunk') return null;
  const choices = (chunk.choices as Array<{ delta?: { content?: unknown } }>) ?? [];
  const delta = choices[0]?.delta;
  let content: unknown = delta?.content;
  if (!content) return null;
  if (Array.isArray(content)) {
    content = content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'type' in p && p.type === 'text') {
          return (p as { text?: string }).text ?? '';
        }
        return '';
      })
      .join('');
  }
  if (typeof content !== 'string' || !content) return null;
  return { type: 'response.output_text.delta', delta: content };
}
