/**
 * test-collab-roundtrip — locks the collab (Yjs) tab-meta round-trip.
 *
 *   cd app && bun run test:collab
 *
 * WHY THIS EXISTS: the collab doc stores each tab's scalar fields (theme, aspect,
 * direction, frame, legend, rowGap, columns, …) in a `meta` Y.Map keyed by the
 * `META_KEYS` list in ydoc-model.ts. A field MISSING from that list is silently
 * dropped on the round-trip — `applyTabBodyToDoc` never writes it and
 * `docToTabBodies` never re-emits it — so a tab-meta edit made in the in-app
 * (collab) canvas becomes a no-op and the control reads as "stuck". That is
 * exactly how the slide⇄technical theme toggle broke (theme wasn't in META_KEYS).
 * These tests exercise the real applyTabBodyToDoc → docToTabBodies path so a
 * dropped meta key fails loudly instead of shipping as a dead control.
 *
 * Run it after touching ydoc-model.ts or adding a top-level ArchitectureFile field.
 */
import assert from "node:assert/strict";
import * as Y from "yjs";

import {
  addTabToDoc,
  applyTabBodyToDoc,
  docToTabBodies,
  tabOrder,
} from "../src/demo_prompt_generator/ui/components/project/platform-diagram/collab/ydoc-model";

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

/** Wrap a flat file object as a fenced single-tab body (what the canvas persists). */
function body(obj: Record<string, unknown>): string {
  return "```json\n" + JSON.stringify(obj, null, 2) + "\n```\n";
}

/** Parse the fenced body docToTabBodies produces back into a flat object. */
function parseBody(b: string): Record<string, unknown> {
  const m = b.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return JSON.parse(m ? m[1] : b);
}

/** A doc with one tab, that tab's body set to `obj`. Returns { ydoc, tid }. */
function docWithTab(obj: Record<string, unknown>) {
  const ydoc = new Y.Doc();
  addTabToDoc(ydoc, String(obj.name ?? "Architecture"), body(obj));
  const tid = tabOrder(ydoc)[0];
  applyTabBodyToDoc(ydoc, tid, body(obj));
  return { ydoc };
}

// The heart of the theme-toggle bug: a theme-only change must survive the doc.
test("theme survives the collab round-trip (the toggle-stuck regression)", () => {
  const { ydoc } = docWithTab({
    name: "T",
    theme: "slide",
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  });
  const out = parseBody(docToTabBodies(ydoc)[0].body);
  assert.equal(out.theme, "slide", "theme:slide was dropped on the round-trip");

  // And a toggle TO technical: write a new body with theme:"technical", read it back.
  const tid = tabOrder(ydoc)[0];
  applyTabBodyToDoc(ydoc, tid, body({
    name: "T",
    theme: "technical",
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  const out2 = parseBody(docToTabBodies(ydoc)[0].body);
  assert.equal(out2.theme, "technical", "theme toggle slide→technical did not persist");
});

// Every other tab-meta scalar that had the same latent loss.
test("all tab-meta scalars survive the collab round-trip", () => {
  const meta = {
    name: "Full meta",
    story: "a story",
    aspect: "16:9",
    frame: { title: "Title", subtitle: "Sub" },
    theme: "slide",
    direction: "horizontal",
    options: { trademarkLogos: true },
    columns: ["sources", "pipeline"],
    rowGrid: true,
    rowGap: 72,
    custom_logos: [{ id: "acme", svg: "<svg/>" }],
    legend: { title: "Key", items: ["one", "two"] },
  };
  const { ydoc } = docWithTab({ ...meta, nodes: [], edges: [] });
  const out = parseBody(docToTabBodies(ydoc)[0].body);
  for (const [k, v] of Object.entries(meta)) {
    assert.deepEqual(out[k], v, `tab-meta key \`${k}\` was dropped or altered on the round-trip`);
  }
});

// custom_logos is the FILE (snake_case) key — the old META_KEYS had the wrong
// (camelCase) name, so this specifically guards that mismatch.
test("custom_logos (snake_case file key) round-trips", () => {
  const { ydoc } = docWithTab({
    name: "L",
    custom_logos: [{ id: "brand", svg: "<svg><rect/></svg>" }],
    nodes: [{ id: "n", type: "logo", icon: "custom:brand", at: [0, 0] }],
    edges: [],
  });
  const out = parseBody(docToTabBodies(ydoc)[0].body);
  assert.deepEqual(out.custom_logos, [{ id: "brand", svg: "<svg><rect/></svg>" }]);
});

// Deleting a meta field (undefined) must also propagate — a technical→default
// toggle drops the theme field, and it must not linger in the doc.
test("clearing a meta field removes it from the doc", () => {
  const { ydoc } = docWithTab({
    name: "C",
    theme: "slide",
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  });
  const tid = tabOrder(ydoc)[0];
  // Re-persist without theme (what serialize does when theme === DEFAULT_THEME).
  applyTabBodyToDoc(ydoc, tid, body({
    name: "C",
    nodes: [{ id: "a", type: "genie", at: [0, 0] }],
    edges: [],
  }));
  const out = parseBody(docToTabBodies(ydoc)[0].body);
  assert.equal(out.theme, undefined, "a cleared theme field lingered in the doc");
});

// The nested layout: the tab is a container, its top-level nodes are placed in file order.
// Sorting them by id put a diagram's sources (id "sources") after "platform-box", on the right.
test("nested layout: the top-level order and the tab's layout fields survive", () => {
  const tab = {
    name: "N", layout: "row", gap: 90, align: "center",
    nodes: [
      { id: "sources", type: "group", layout: "column", children: [{ id: "src-a", type: "source", label: "A" }] },
      { id: "platform-box", type: "box", layout: "column", children: [{ id: "g", type: "genie" }] },
      { id: "users", type: "logo", text: "Users" },
    ],
    edges: [],
  };
  const { ydoc } = docWithTab(tab);
  const out = parseBody(docToTabBodies(ydoc)[0].body) as { nodes: { id: string }[]; layout?: string; gap?: number; align?: string };
  assert.deepEqual(out.nodes.map((n) => n.id), ["sources", "platform-box", "users"], "top-level order kept");
  assert.equal(out.layout, "row"); assert.equal(out.gap, 90); assert.equal(out.align, "center");
  assert.ok(!("nodeOrder" in out), "the order is doc-only, never written to the file");
  // A reorder made on the canvas is a real edit and must persist.
  const tid = tabOrder(ydoc)[0];
  applyTabBodyToDoc(ydoc, tid, body({ ...tab, nodes: [tab.nodes[2], tab.nodes[0], tab.nodes[1]] }));
  const out2 = parseBody(docToTabBodies(ydoc)[0].body) as { nodes: { id: string }[] };
  assert.deepEqual(out2.nodes.map((n) => n.id), ["users", "sources", "platform-box"], "a reorder persists");
});

console.log(`Collab round-trip tests passed (${passed} cases).`);
