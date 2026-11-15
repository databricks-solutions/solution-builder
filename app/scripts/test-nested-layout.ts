// Unit tests for the nested layout (lib/arch-layout.ts) and the old → nested migration
// (lib/arch-migrate.ts): containment by construction, tracks, label gutters, the save
// round trip, the editor's drag → re-order / re-parent contract. Pure, no browser.
//   bun scripts/test-nested-layout.ts      (part of `bun run test:layout`)
import assert from "node:assert/strict";
import { layoutNested } from "../src/demo_prompt_generator/ui/lib/arch-layout";
import { migrateToNested } from "../src/demo_prompt_generator/ui/lib/arch-migrate";
import {
  parseArchitecture, serializeArchitecture, validateArchitecture,
  type ArchitectureFile, type FileNode,
} from "../src/demo_prompt_generator/ui/lib/platform-architecture";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (err) { console.error(`\n✗ ${name}`); throw err; }
};
const fence = (o: unknown) => "```json\n" + JSON.stringify(o, null, 2) + "\n```\n";
const strip = (s: string) => JSON.parse(s.replace(/^```json\n|\n```\n?$/g, ""));
const shape = (ns: FileNode[]): unknown => ns.map((n) => (n.children ? { [n.id]: shape(n.children) } : n.id));
const inside = (r: { x: number; y: number; w: number; h: number }, o: typeof r) =>
  r.x - r.w / 2 >= o.x - o.w / 2 - 0.5 && r.x + r.w / 2 <= o.x + o.w / 2 + 0.5 &&
  r.y - r.h / 2 >= o.y - o.h / 2 - 0.5 && r.y + r.h / 2 <= o.y + o.h / 2 + 0.5;

const estate = (): ArchitectureFile => ({
  name: "estate", aspect: "16:9", theme: "technical", direction: "horizontal", layout: "row", gap: 100,
  nodes: [
    { id: "idp", type: "logo", icon: "lucide:user", text: "IdP", caption: "bottom", track: "id" },
    { id: "account", type: "box", title: "Account", subtitle: "account console", layout: "row", gap: 80, children: [
      { id: "objects", type: "group", layout: "column", children: [
        { id: "identity", type: "logo", icon: "lucide:users", text: "Users", caption: "bottom", track: "id" },
        { id: "ncc", type: "logo", icon: "lucide:network", text: "NCC", caption: "bottom" } ] },
      { id: "ws", type: "box", title: "Workspaces", layout: "column", children: [
        { id: "ws-dev", type: "logo", icon: "lucide:monitor", text: "Dev", caption: "right", track: "dev" },
        { id: "ws-prod", type: "logo", icon: "lucide:monitor", text: "Prod", caption: "right", track: "prod" } ] },
      { id: "meta", type: "box", title: "Metastore", subtitle: "West Europe", layout: "column", children: [
        { id: "cat-dev", type: "logo", icon: "lucide:database", text: "dev catalog", caption: "right", track: "dev" },
        { id: "cat-prod", type: "logo", icon: "lucide:database", text: "prod catalog", caption: "right", track: "prod" } ] } ] },
    { id: "sub", type: "box", title: "Subscription", layout: "column", children: [
      { id: "storage", type: "logo", icon: "lucide:hard-drive", text: "Storage", caption: "right" } ] },
  ],
  edges: [
    { id: "e1", from: "idp", to: "identity", label: "SCIM sync" },
    { id: "e2", from: "ws-dev", to: "cat-dev", label: "bound" },
    { id: "e3", from: "ws-prod", to: "cat-prod", label: "bound" },
    { id: "e4", from: "meta", to: "storage" },
  ],
});

test("containers hold their children, below their title, without overlaps", () => {
  const { rects } = layoutNested(estate());
  const R = (id: string) => rects.get(id)!;
  for (const [kid, box] of [["identity", "account"], ["ws-dev", "ws"], ["cat-prod", "meta"], ["ws", "account"], ["storage", "sub"]]) {
    assert.ok(inside(R(kid), R(box)), `${kid} inside ${box}`);
  }
  // nothing under the title band: the first child starts at least pad + subtitle below the top
  assert.ok(R("cat-dev").y - R("cat-dev").h / 2 >= R("meta").y - R("meta").h / 2 + 34, "below the metastore title band");
  // siblings never overlap
  const sib = ["objects", "ws", "meta"].map(R);
  for (let i = 1; i < sib.length; i++) assert.ok(sib[i].x - sib[i].w / 2 >= sib[i - 1].x + sib[i - 1].w / 2, "row siblings left to right");
});

test("a track lines members up across containers", () => {
  const { rects, conflicts } = layoutNested(estate());
  assert.deepEqual(conflicts, []);
  for (const [a, b] of [["ws-dev", "cat-dev"], ["ws-prod", "cat-prod"], ["idp", "identity"]]) {
    assert.ok(Math.abs(rects.get(a)!.y - rects.get(b)!.y) < 1, `${a} level with ${b}`);
  }
});

test("an impossible track is dropped and reported, never runs away", () => {
  const f = estate();
  const meta = f.nodes![1].children![2];
  meta.children!.reverse(); // prod above dev here, dev above prod in the workspaces
  const { rects, conflicts } = layoutNested(f);
  assert.ok(conflicts.length > 0, "reported");
  for (const r of rects.values()) assert.ok(Math.abs(r.y) < 5000 && r.h < 5000, "bounded geometry");
  assert.ok(validateArchitecture(fence([f])).some((i) => i.field === "track"), "validate says so");
});

test("an edge label widens the gap it must sit in", () => {
  const f = (label?: string): ArchitectureFile => ({ name: "g", layout: "row", gap: 20, nodes: [
    { id: "a", type: "genie" }, { id: "b", type: "genie" } ], edges: [{ id: "e", from: "a", to: "b", ...(label ? { label } : {}) }] });
  const gap = (file: ArchitectureFile) => { const { rects } = layoutNested(file); const a = rects.get("a")!, b = rects.get("b")!; return (b.x - b.w / 2) - (a.x + a.w / 2); };
  assert.equal(Math.round(gap(f())), 20);
  assert.ok(gap(f("a fairly long label")) > 120, "room for the label and its margins");
});

test("equal, justify between and align stretch", () => {
  const { rects } = layoutNested({ name: "s", layout: "column", nodes: [
    { id: "box", type: "box", layout: "column", align: "stretch", children: [
      { id: "bar", type: "group", layout: "row", justify: "between", children: [{ id: "l", type: "genie" }, { id: "r", type: "genie" }] },
      { id: "row", type: "group", layout: "row", equal: true, gap: 40, children: [{ id: "x", type: "card", title: "x" }, { id: "y", type: "card", title: "a much longer card title" }] } ] } ] });
  const box = rects.get("box")!, bar = rects.get("bar")!;
  assert.ok(Math.abs(bar.w - (box.w - 68)) < 1, "the banner row spans the box");
  assert.ok(Math.abs((rects.get("l")!.x - rects.get("l")!.w / 2) - (bar.x - bar.w / 2)) < 1, "first child at the start");
  assert.ok(Math.abs((rects.get("r")!.x + rects.get("r")!.w / 2) - (bar.x + bar.w / 2)) < 1, "last child at the end");
  assert.equal(rects.get("x")!.w, rects.get("y")!.w, "equal widths");
});

test("save round-trips the tree: no pixels, byte-stable", () => {
  const s0 = parseArchitecture(fence(estate()));
  const once = serializeArchitecture(s0, s0.layout);
  const out = strip(once);
  assert.deepEqual(shape(out.nodes), shape(estate().nodes!));
  assert.ok(!once.includes('"at"'), "no pixel positions");
  assert.ok(!once.includes("_tree") && !once.includes('"wraps"'), "nothing derived leaks");
  const s1 = parseArchitecture(once);
  assert.equal(serializeArchitecture(s1, s1.layout), once, "a second pass is identical");
});

test("a node's url (its real resource) survives the save, and only http(s) is kept", () => {
  const f = estate();
  f.nodes![1].children![1].children![0].url = "https://ws.cloud.databricks.com/pipelines/abc?o=1";
  f.nodes![0].url = "javascript:alert(1)";
  const s0 = parseArchitecture(fence(f));
  const out = serializeArchitecture(s0, s0.layout);
  assert.ok(out.includes("https://ws.cloud.databricks.com/pipelines/abc?o=1"), "kept on its node");
  assert.ok(!out.includes("javascript:"), "a non-http link is dropped");
  assert.equal(s0.layout.nodes["ws-dev"].url, "https://ws.cloud.databricks.com/pipelines/abc?o=1");
});

test("drag: re-order inside a container, re-parent into another, carry a box with its content", () => {
  const s0 = parseArchitecture(fence(estate()));
  const save = (move: (n: typeof s0.layout.nodes) => void) => { const L = structuredClone(s0.layout); move(L.nodes); return strip(serializeArchitecture(s0, L)); };
  const reorder = save((n) => { n["cat-prod"].y = n["cat-dev"].y - 40; });
  assert.deepEqual(shape(reorder.nodes[1].children[2].children), ["cat-prod", "cat-dev"], "dropped above → first");
  const moved = save((n) => { n.storage.x = n["cat-dev"].x; n.storage.y = n["cat-dev"].y + 30; });
  assert.deepEqual(shape(moved.nodes[1].children[2].children), ["cat-dev", "storage", "cat-prod"], "dropped into the metastore, between");
  const carried = save((n) => { for (const id of ["ws", "ws-dev", "ws-prod"]) { n[id].x += 15; n[id].y += 9; } });
  assert.deepEqual(shape(carried.nodes), shape(estate().nodes!), "the box moved with its children: structure unchanged");
});

test("migration: an old lane file becomes a nested one that keeps its rows", () => {
  const old: ArchitectureFile = { name: "old", aspect: "16:9", direction: "horizontal", columns: ["src", "data", "use"], rowGrid: true,
    nodes: [
      { id: "s1", type: "source", label: "Postgres", icon: "lucide:database", col: "src", row: 1 },
      { id: "s2", type: "source", label: "Kafka", icon: "lucide:radio", col: "src", row: 2 },
      { id: "lh", type: "sql-lakehouse", col: "data", row: 1 },
      { id: "g", type: "genie", col: "use", row: 2 },
      { id: "plat", type: "box", title: "Databricks", wraps: ["lh", "g"] },
    ],
    edges: [{ id: "e1", from: "s1", to: "lh" }, { id: "e2", from: "lh", to: "g" }] };
  const n = migrateToNested(old);
  assert.equal(n.layout, "row");
  assert.equal(n.columns, undefined);
  const txt = JSON.stringify(n);
  for (const k of ['"col":', '"row":', '"wraps":', '"rowGrid":']) assert.ok(!txt.includes(k), `no ${k}`);
  const plat = (n.nodes ?? []).find((x) => x.id === "plat")!;
  assert.ok(plat.children?.length, "the box holds its members");
  const { rects } = layoutNested(n);
  assert.ok(Math.abs(rects.get("s1")!.y - rects.get("lh")!.y) < 2, "row 1 stays level across containers (track)");
  assert.ok(Math.abs(rects.get("s2")!.y - rects.get("g")!.y) < 2, "row 2 too");
  // and an old file opens through the migration
  const s = parseArchitecture(fence(old));
  assert.ok(s.tree, "parsed as nested");
});

console.log(`Nested layout tests passed (${passed} cases).`);
