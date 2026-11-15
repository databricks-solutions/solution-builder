/**
 * What the Deck tab says before a deck exists.
 *
 * The deck is built only on request (Generate POV deck, Regenerate, or a Deck tab edit), so an
 * agent turn alone says nothing about a deck. "Building the POV deck…" during the story or Build
 * turn told the user a deck was coming when none was (bug log, 02). Only a turn the page started
 * as a deck turn counts; the flag is cleared when that turn ends.
 */

export type NoDeckState = "building" | "busy" | "needs-story" | "ready";

export function noDeckState(s: { hasReadme: boolean; isStreaming: boolean; deckTurnRunning: boolean }): NoDeckState {
  if (s.isStreaming && s.deckTurnRunning) return "building";
  if (!s.hasReadme) return "needs-story";
  return s.isStreaming ? "busy" : "ready";
}
