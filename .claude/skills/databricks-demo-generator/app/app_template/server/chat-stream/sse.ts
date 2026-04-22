/**
 * Tiny helpers for writing SSE events from the chat-stream handlers.
 *
 * Keeps the event shape consistent across `agent-stream.ts` +
 * `mas-stream.ts` so the browser only has to parse one taxonomy:
 *
 *   response.output_text.delta              → final-answer token
 *   response.reasoning_summary_text.delta   → reasoning token
 *   response.reasoning_summary_text.done    → authoritative reasoning text
 *   response.output_item.done               → tool call / tool output / message
 *   response.completed                      → end of turn (carries trace_id)
 *   error                                   → upstream error (str)
 */
import type { Response } from 'express';

export function sseWrite(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function sseError(res: Response, error: string): void {
  sseWrite(res, { type: 'error', error });
}
