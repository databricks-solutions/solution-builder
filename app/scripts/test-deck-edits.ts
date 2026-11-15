/**
 * test-deck-edits — locks the rules for the POV deck's edit requests (ui/lib/deck-edits.ts).
 *
 *   cd app && bun run test:deck-edits
 *
 * WHY THIS EXISTS: the deck is agent-written HTML, and its edit channel reaches the agent, which
 * runs with the user's credentials (Joe's review of PR #212). A request only opens a host dialog,
 * the batch just sent never opens it again (a deck that posts on every reload would loop), and the
 * queue refuses a batch already waiting or past the cap.
 *
 * It also locks what the Deck tab says before a deck exists (ui/lib/deck-status.ts): "Building the
 * POV deck…" only during a deck turn, never during the story or Build turns (bug log, 02).
 */
import assert from "node:assert/strict";

import {
  deckEditMessage,
  editRequestText,
  enqueueDeckEdit,
  MAX_QUEUED_DECK_EDITS,
  MAX_DECK_EDIT_CHARS,
  mayAskToSend,
} from "../src/demo_prompt_generator/ui/lib/deck-edits";
import { noDeckState } from "../src/demo_prompt_generator/ui/lib/deck-status";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`\n✗ ${name}`);
    throw e;
  }
}

const req = (text: unknown, extra: Record<string, unknown> = {}) =>
  ({ type: "htmlit:edit-request", version: 1, text, items: [{ id: "t1" }], ...extra });

test("only a well-formed v1 edit request carries text", () => {
  assert.equal(editRequestText(req("Change the title")), "Change the title");
  assert.equal(editRequestText(req("x", { version: 2 })), null);
  assert.equal(editRequestText(req("x", { type: "htmlit:edit-host" })), null);
  assert.equal(editRequestText(req("   ")), null);
  assert.equal(editRequestText(req("x", { items: [] })), null);
  assert.equal(editRequestText("htmlit:edit-request"), null);
  assert.equal(editRequestText(null), null);
});

test("a request opens the dialog only when none is open", () => {
  assert.equal(mayAskToSend("a", { pending: null, lastSent: null }), true);
  assert.equal(mayAskToSend("b", { pending: "a", lastSent: null }), false);
});

test("the batch just sent never opens the dialog again (reload loop)", () => {
  assert.equal(mayAskToSend("a", { pending: null, lastSent: "a" }), false);
  assert.equal(mayAskToSend("b", { pending: null, lastSent: "a" }), true);
});

test("the queue drops a batch already waiting", () => {
  const { queue, result } = enqueueDeckEdit(["a"], "a");
  assert.equal(result, "duplicate");
  assert.deepEqual(queue, ["a"]);
});

test("the queue refuses past the cap and never mutates its input", () => {
  const full = Array.from({ length: MAX_QUEUED_DECK_EDITS }, (_, i) => `b${i}`);
  const { queue, result } = enqueueDeckEdit(full, "new");
  assert.equal(result, "full");
  assert.equal(queue.length, MAX_QUEUED_DECK_EDITS);
  const start = ["a"];
  const added = enqueueDeckEdit(start, "b");
  assert.equal(added.result, "queued");
  assert.deepEqual(added.queue, ["a", "b"]);
  assert.deepEqual(start, ["a"]);
});

test("the chat turn says it came from the Deck tab, then quotes the notes, then the instruction", () => {
  const msg = deckEditMessage(["html-it edit request for pov_deck.html\n1. Topic 2 \"story\"\n   Change: shorter"]);
  assert.ok(msg.startsWith("**Deck edit from the Deck tab.** I marked these changes in the deck's edit mode"));
  const notes = msg.indexOf("```text\nhtml-it edit request");
  const instruction = msg.indexOf("stages/pov-deck.md");
  assert.ok(notes > 0 && instruction > notes);
  assert.ok(msg.includes("Edit requests from the Deck tab"));
});

test("several batches are counted and each is quoted and capped", () => {
  const msg = deckEditMessage(["a", "x".repeat(MAX_DECK_EDIT_CHARS + 50)]);
  assert.ok(msg.includes("I marked 2 batches of changes"));
  assert.equal(msg.split("```text").length - 1, 2);
  assert.ok(!msg.includes("x".repeat(MAX_DECK_EDIT_CHARS + 1)));
});

test("the empty Deck tab says it is building only during a deck turn", () => {
  assert.equal(noDeckState({ hasReadme: true, isStreaming: true, deckTurnRunning: true }), "building");
  assert.equal(noDeckState({ hasReadme: true, isStreaming: true, deckTurnRunning: false }), "busy");
});

test("a deck flag left over after the turn ends never shows building", () => {
  assert.equal(noDeckState({ hasReadme: true, isStreaming: false, deckTurnRunning: true }), "ready");
});

test("with no story yet the tab says the deck waits for the story, even mid-turn", () => {
  assert.equal(noDeckState({ hasReadme: false, isStreaming: true, deckTurnRunning: false }), "needs-story");
  assert.equal(noDeckState({ hasReadme: false, isStreaming: false, deckTurnRunning: false }), "needs-story");
});

test("idle with a story, the tab offers Generate POV deck", () => {
  assert.equal(noDeckState({ hasReadme: true, isStreaming: false, deckTurnRunning: false }), "ready");
});

console.log(`Deck edit tests passed (${passed} cases).`);
