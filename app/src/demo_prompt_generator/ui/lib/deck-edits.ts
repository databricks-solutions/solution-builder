/**
 * The rules for change notes from the POV deck's edit mode (Deck tab).
 *
 * The deck is agent-written HTML in a sandboxed frame, and its edit channel is a deliberate
 * path from that frame into the agent, which runs with the user's credentials. A message from
 * the frame proves where it came from, not that the user clicked anything. So a request only
 * opens a host dialog, and nothing reaches the agent until the user clicks Send there, in UI we
 * trust. These rules also stop a deck that posts on every load from looping: each turn rebuilds
 * the deck, the frame reloads, and the same request would arrive again.
 */

/** Batches that may wait for the agent at once. */
export const MAX_QUEUED_DECK_EDITS = 3;

/** The text of an html-it edit request (kit INTERACTIVE_VISUALS.md), or null. */
export function editRequestText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; version?: unknown; text?: unknown; items?: unknown };
  if (d.type !== "htmlit:edit-request" || d.version !== 1) return null;
  if (typeof d.text !== "string" || !d.text.trim() || !Array.isArray(d.items) || !d.items.length) return null;
  return d.text;
}

/** Whether a request from the frame may open the confirm dialog. One dialog at a time, and
 *  never for the batch the user just sent (a reloaded deck posting it again). */
export function mayAskToSend(text: string, state: { pending: string | null; lastSent: string | null }): boolean {
  return state.pending === null && text !== state.lastSent;
}

export type EnqueueResult = "queued" | "duplicate" | "full";

/** Add a confirmed batch to the queue: drop one already waiting, refuse past the cap. */
export function enqueueDeckEdit(
  queue: readonly string[],
  text: string,
  max = MAX_QUEUED_DECK_EDITS,
): { queue: string[]; result: EnqueueResult } {
  if (queue.includes(text)) return { queue: [...queue], result: "duplicate" };
  if (queue.length >= max) return { queue: [...queue], result: "full" };
  return { queue: [...queue, text], result: "queued" };
}

/** The longest batch text a chat turn carries; the deck caps each quoted element at 160 characters. */
export const MAX_DECK_EDIT_CHARS = 12000;

/** The chat turn confirmed batches become. It is posted as the user's own message, so it opens by
 *  saying where it came from, then the user's notes, then the instruction for the agent. */
export function deckEditMessage(batches: readonly string[]): string {
  const what = batches.length === 1 ? "these changes" : `${batches.length} batches of changes`;
  return (
    `**Deck edit from the Deck tab.** I marked ${what} in the deck's edit mode and clicked Send to agent.\n\n` +
    batches.map((t) => "```text\n" + t.slice(0, MAX_DECK_EDIT_CHARS) + "\n```").join("\n\n") +
    "\n\nApply them by following `.claude/skills/databricks-solution-builder/stages/pov-deck.md`, section " +
    "\"Edit requests from the Deck tab\". Read the file again now, even if you read it earlier in this " +
    "conversation: it may have changed since."
  );
}
