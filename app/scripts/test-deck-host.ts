/**
 * test-deck-host — locks the Deck tab's toolbar protocol (ui/lib/deck-host.ts) with the
 * kit's host_toolbar.py patch: only the deck's own state report is read, commands carry
 * nothing but a name, and builds are on unless the viewer turns them off (Morgan, 2026-11-06).
 *
 *   cd app && bun run test:deck-host
 */
import assert from "node:assert/strict";

import {
  BUILDS_PREF_KEY,
  deckUrlWithBuilds,
  hostCommand,
  hostWindowName,
  parseHostPrint,
  parseHostState,
  presenterUrl,
  readBuildsPref,
  writeBuildsPref,
} from "../src/demo_prompt_generator/ui/lib/deck-host";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("a state report is read", () => {
  assert.deepEqual(
    parseHostState({ type: "htmlit:host-state", version: 1, theme: "dark", notes: true, edit: false, present: false, builds: false }),
    { theme: "dark", notes: true, edit: false, present: false, builds: false, presenter: null },
  );
});
test("anything else is ignored", () => {
  for (const m of [null, "x", {}, { type: "htmlit:edit-request", version: 1 }, { type: "htmlit:host-state", version: 2 }]) {
    assert.equal(parseHostState(m), null);
  }
});
test("unknown values fall back to html-it's defaults", () => {
  assert.deepEqual(parseHostState({ type: "htmlit:host-state", version: 1, theme: "neon", notes: "yes" }), {
    theme: "warm", notes: false, edit: false, present: false, builds: true, presenter: null,
  });
});
test("a command carries only its name and, for builds, the value", () => {
  assert.deepEqual(hostCommand("theme"), { type: "htmlit:host-cmd", version: 1, cmd: "theme" });
  assert.deepEqual(hostCommand("builds", false), { type: "htmlit:host-cmd", version: 1, cmd: "builds", value: false });
});
test("builds default on, and the choice round-trips", () => {
  const store = new Map<string, string>();
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  assert.equal(readBuildsPref(s), true);
  writeBuildsPref(s, false);
  assert.equal(store.get(BUILDS_PREF_KEY), "off");
  assert.equal(readBuildsPref(s), false);
  writeBuildsPref(s, true);
  assert.equal(store.has(BUILDS_PREF_KEY), false);
  assert.equal(readBuildsPref(s), true);
  store.set(BUILDS_PREF_KEY, "on");   // a browser that turned builds on while off was the default stays on
  assert.equal(readBuildsPref(s), true);
  assert.equal(readBuildsPref(undefined), true);
  assert.equal(readBuildsPref({ getItem: () => { throw new Error("blocked"); } }), true);
});
test("Open in new tab keeps the builds choice", () => {
  assert.equal(deckUrlWithBuilds("/api/projects/p/deck/pov_deck.html", true), "/api/projects/p/deck/pov_deck.html");
  assert.equal(deckUrlWithBuilds("/api/projects/p/deck/pov_deck.html", false), "/api/projects/p/deck/pov_deck.html?builds=off");
  assert.equal(deckUrlWithBuilds("/x?a=1", false), "/x?a=1&builds=off");
});

test("the presenter opens from the Deck tab's click, beside the deck, with the frame and window names", () => {
  const page = "https://sb.example/project/p1?tab=deck";
  const deck = "/api/projects/p1/deck/pov_deck.html";
  const st = parseHostState({ type: "htmlit:host-state", version: 1, presenter: "pov_deck_presenter.html?htmlit=abc-12" });
  assert.equal(st?.presenter, "pov_deck_presenter.html?htmlit=abc-12");
  const url = new URL(presenterUrl(deck, st!.presenter, page, hostWindowName("p1"))!);
  assert.equal(url.origin + url.pathname, "https://sb.example/api/projects/p1/deck/pov_deck_presenter.html");
  assert.equal(url.searchParams.get("htmlit"), "abc-12");
  assert.equal(url.searchParams.get("deck"), "htmlit-deck");
  assert.equal(url.searchParams.get("back"), "sb-deck-p1");
});
test("an agent-written deck cannot point the Deck tab's window anywhere else", () => {
  const page = "https://sb.example/project/p1?tab=deck";
  const deck = "/api/projects/p1/deck/pov_deck.html";
  for (const bad of [null, "javascript:alert(1)", "https://evil.example/p.html?htmlit=1", "//evil.example/p.html?htmlit=1",
    "../../../logout?htmlit=1", "../other/p.html?htmlit=1", "pov_deck_presenter.html", "sub/p.html?htmlit=1", "p.js?htmlit=1"]) {
    assert.equal(presenterUrl(deck, bad, page, "w"), null, String(bad));
  }
});

test("a print request carries a short title, and nothing else is read", () => {
  assert.deepEqual(parseHostPrint({ type: "htmlit:host-print", version: 1, phase: "before", title: "  Meridian   Oncology  " }),
    { phase: "before", title: "Meridian Oncology" });
  assert.equal(parseHostPrint({ type: "htmlit:host-print", version: 1, phase: "before", title: "x".repeat(300) })?.title.length, 120);
  for (const m of [null, { type: "htmlit:host-print", version: 1, phase: "during" }, { type: "htmlit:host-state", version: 1 }]) {
    assert.equal(parseHostPrint(m), null);
  }
});

console.log(`Deck host tests passed (${passed} cases).`);
