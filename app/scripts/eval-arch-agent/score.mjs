#!/usr/bin/env node
/**
 * eval-arch-agent/score.mjs — score the diagram an agent drew for one prompt.
 *
 *   node scripts/eval-arch-agent/score.mjs <expected.json> <run-dir>   (run.ts calls this)
 *
 * <expected.json> is the prompt's `expect` block: kind "text" (a brief: coverage,
 * style shape, layout faults, forbidden content and nesting) or kind "redraw" (an image:
 * cards, groups, edges and card centres as fractions of the source image).
 * <run-dir>/_eval/diagram.json is the agent's diagram, extracted by run.ts from whatever it
 * wrote (architecture.md in app mode, an HTML or .md file in skill mode). Writes
 * <run-dir>/_eval/{arch.html,arch.png,inspect.txt,dump.json,score.json} and prints a report.
 *
 * Text is scored on what the BROWSER renders (inspect-arch's ARCH_DUMP), not on the
 * JSON: a slide tile can carry a description it never shows, and a truncated title is
 * lost to the reader. Layout is scored as pairwise order agreement (is A left of B,
 * above B, as in the source), which survives any uniform scale.
 *
 * Needs `bun run build:arch-standalone` (renders through dist-standalone).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const APP = join(SCRIPTS, "..");
const [expPath, projDir] = process.argv.slice(2);
if (!expPath || !projDir) { console.error("usage: score.mjs <expected.json> <run-dir>"); process.exit(1); }

const exp = JSON.parse(readFileSync(expPath, "utf8"));
const doc = JSON.parse(readFileSync(join(projDir, "_eval", "diagram.json"), "utf8"));
const rawTab = (Array.isArray(doc) ? doc : doc.tabs ?? [doc])[0];
// A nested tab (containers with `children`) is scored on its flat node list: every node,
// each box with `wraps` = its visible descendants (through invisible groups); groups,
// being layout only, are not nodes of the diagram.
function flattenNested(ns) {
  const out = [];
  const visible = (n) => (n.children ?? []).flatMap((c) => (c.type === "group" ? visible(c) : [c.id]));
  const walk = (list) => { for (const n of list ?? []) {
    const { children, ...rest } = n;
    if (n.type !== "group") out.push(children ? { ...rest, wraps: visible(n) } : rest);
    walk(children);
  } };
  walk(ns);
  return out;
}
const tab = { ...rawTab, nodes: flattenNested(rawTab.nodes) };

// --- render + measure through the real viewer ---------------------------------
const out = join(projDir, "_eval");
mkdirSync(out, { recursive: true });
const viewer = readFileSync(join(APP, "dist-standalone/architecture-viewer.html"), "utf8");
const page = join(out, "arch.html");
writeFileSync(page, viewer.replace(
  /(<script[^>]*type="application\/json"[^>]*id="architecture"[^>]*>)[\s\S]*?(<\/script>)/,
  (_m, a, b) => a + JSON.stringify(Array.isArray(doc) ? doc : doc.tabs ?? [doc]).replace(/</g, "\\u003c") + b));
const run = (script, env = {}) => {
  try { return execFileSync("node", [join(SCRIPTS, script), page], { encoding: "utf8", timeout: 240000, env: { ...process.env, ...env } }); }
  catch (e) { return (e.stdout ?? "") + (e.stderr ?? ""); }
};
run("render-arch.mjs");
const dumpPath = join(out, "dump.json");
const inspect = run("inspect-arch.mjs", { ARCH_DUMP: dumpPath });
writeFileSync(join(out, "inspect.txt"), inspect);
const dump = JSON.parse(readFileSync(dumpPath, "utf8"));

// --- slide cases: a text brief, no image -------------------------------------------
// Guards the default diagram kind while redraw work evolves: the agent must still pick
// the slide kind (catalog tiles + composites, not cards), cover the brief, and lay it
// out cleanly. expected.json: { "kind": "slide", "require": [regex over node types/labels],
// "nodes": [min, max] }.
// Structural signature each style should have (cheap, not a beauty contest — the
// visual judge covers that): marketing = catalog tiles, no cards; technical = cards
// or richly described nodes; lifecycle = ≥3 stage boxes; networking = nested boxes ≥2 deep.
function styleShape(style, nodes) {
  const boxes = nodes.filter((n) => n.type === "box");
  if (style === "marketing") return nodes.some((n) => n.type === "card") ? 0 : 1;
  if (style === "technical") return nodes.some((n) => n.type === "card" || n.desc || n.body) ? 1 : 0;
  if (style === "lifecycle") return boxes.length >= 3 || nodes.filter((n) => n.type === "card").length >= 4 ? 1 : 0;
  if (style === "networking") {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const depth = (n, seen = new Set()) => (n?.type !== "box" || seen.has(n.id)) ? 0 : 1 + Math.max(0, ...(n.wraps ?? []).map((w) => depth(byId.get(w), new Set([...seen, n.id]))));
    return Math.max(0, ...boxes.map((b) => depth(b))) >= 2 ? 1 : 0;
  }
  return 1;
}
function modelOk(nodes, rules) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const name = (n) => [n.title, n.text, n.label].filter(Boolean).join(" ");
  const inside = (box, seen = new Set()) => (box.wraps ?? []).flatMap((id) => {
    const c = byId.get(id); if (!c || seen.has(id)) return [];
    return [c, ...(c.type === "box" ? inside(c, new Set([...seen, id])) : [])];
  });
  const broken = rules.filter(([outer, inner]) => nodes.some((b) => b.type === "box" && new RegExp(outer, "i").test(name(b))
    && inside(b).some((c) => new RegExp(inner, "i").test(name(c)))));
  if (broken.length) console.log(`  model errors: ${broken.map(([o, i]) => `"${i}" inside "${o}"`).join("; ")}`);
  return broken.length ? 0 : 1;
}
if (exp.kind === "slide" || exp.kind === "text") {
  const style = exp.kind === "slide" ? "marketing" : exp.style;
  const nodes = tab.nodes ?? [];
  const fault = (k) => Number(new RegExp(`^${k}: (\\d+)$`, "m").exec(inspect)?.[1] ?? 0);
  const faults = ["NODE OVERLAPS \\(visual\\)", "BOX OVERLAPS", "LABEL OVERLAPS", "LABEL OVER NODE/TITLE",
    "EDGE THROUGH TILE", "TRUNCATED TEXT", "CLIPPED TEXT", "TITLE CROSSED BY EDGE"].reduce((n, k) => n + fault(k), 0)
    // A label straddling a box border is a minor flaw next to an overlap: a third of a fault.
    + fault("LABEL ON BOX BORDER \\(advisory, not gated\\)") / 3;
  // Text that would be under ~10px once the diagram is fitted to a 1920×1080 slide.
  const tooSmall = fault("TEXT TOO SMALL \\(advisory, not gated\\)");
  // Every string the node carries (label, title, body, a multi-source's items…), not a fixed list of fields.
  // ai_reasoning is the agent's private note, never rendered: it can neither meet a
  // requirement nor break a "forbid".
  const hay = nodes.map(({ ai_reasoning, ...n }) => JSON.stringify(n).replace(/"[a-zA-Z]+":/g, " ").toLowerCase());
  const covered = exp.require.filter((r) => hay.some((h) => new RegExp(r, "i").test(h)));
  const [lo, hi] = exp.nodes ?? [3, 30];
  const all = dump.nodes.map((n) => n.vis);
  const w = Math.max(...all.map((r) => r.x + r.w)) - Math.min(...all.map((r) => r.x));
  const h = Math.max(...all.map((r) => r.y + r.h)) - Math.min(...all.map((r) => r.y));
  const parts = {
    // The style the user picked must show in the result (text cases carry it in the prompt).
    // Theme per kind, as SKILL.md's kinds table sets it (lifecycle uses the slide theme).
    // Only when the agent was given a style (app mode, or a prompt that names it).
    ...(["marketing", "lifecycle", "technical", "networking"].includes(style) ? {
      theme_ok: (["marketing", "lifecycle"].includes(style) ? tab.theme === "slide" : tab.theme !== "slide") ? 1 : 0,
      style_shape: styleShape(style, nodes),
    } : {}),
    covers_brief: covered.length / exp.require.length,
    size: nodes.length >= lo && nodes.length <= hi ? 1 : 0,
    clean_layout: 1 / (1 + faults),
    // A known-wrong shape the case names: [outer, inner] regexes over a node's own title/text.
    // A box matching `outer` that wraps (at any depth) a node matching `inner` is a model error
    // (a catalog inside a workspace, serverless inside the customer VNet).
    ...(exp.forbidInside ? { model_ok: modelOk(nodes, exp.forbidInside) } : {}),
    // Content the prompt rules out (a follow-up that drops a component): any node naming it fails.
    ...(exp.forbid ? { forbid_ok: exp.forbid.some((r) => hay.some((h) => new RegExp(r, "i").test(h))) ? 0 : 1 } : {}),
    // Slides must read when fitted to 1920×1080; technical/networking diagrams are documents.
    // With no style given, the agent's own choice of theme decides.
    ...((style ? ["marketing", "lifecycle"].includes(style) : tab.theme === "slide") ? { legible: 1 / (1 + tooSmall / 5) } : {}),
  };
  // Aspect is advisory (AGENTS.md: deck slides are legitimately 2-4:1 ribbons): reported, not scored.
  const advisory = { aspect: Math.round((w / h) * 100) / 100 };
  const total = Object.values(parts).reduce((x, y) => x + y, 0) / Object.keys(parts).length;
  writeFileSync(join(out, "score.json"), JSON.stringify({ total, parts, advisory, faults, missing: exp.require.filter((r) => !covered.includes(r)) }, null, 2));
  console.log(`\n${exp.kind === "slide" ? "SLIDE" : "TEXT"} SCORE ${Math.round(total * 100)}%   [${style}]   (${projDir})`);
  for (const [k, v] of Object.entries(parts)) console.log(`  ${k.padEnd(14)} ${Math.round(v * 100)}%`);
  console.log(`  ${nodes.length} nodes, ${faults} layout faults, missing: ${exp.require.filter((r) => !covered.includes(r)).join(", ") || "none"}`);
  process.exit(0);
}

// --- helpers --------------------------------------------------------------------
const norm = (s) => String(s ?? "").toLowerCase().replace(/…|\.\.\./g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const has = (hay, needle) => !norm(needle) || norm(hay).includes(norm(needle));
const words = (s) => norm(s).split(" ").filter((w) => w.length > 1);
// Share of the needle's words present in the haystack (tolerates wrapping and
// re-punctuation, not paraphrase).
const recall = (hay, needle) => {
  const w = words(needle); if (!w.length) return 1;
  const h = new Set(words(hay)); return w.filter((x) => h.has(x)).length / w.length;
};
const hexHue = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim()); if (!m) return null;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return "grey";
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const sameHue = (a, b) => {
  const x = hexHue(a), y = hexHue(b);
  if (x === null || y === null) return false;
  if (x === "grey" || y === "grey") return x === y;
  const d = Math.abs(x - y); return Math.min(d, 360 - d) <= 35;
};
const base = (ref) => String(ref ?? "").split("@")[0];

const rendered = new Map(dump.nodes.map((n) => [n.id, { ...n, visible: n.fullText }]));
const genNodes = tab.nodes ?? [];
const genEdges = tab.edges ?? [];
// Ellipsized OR clipped (cut at the box edge with no ellipsis) — either way the reader loses it.
const truncatedIds = new Set([...(dump.truncated ?? []), ...(dump.clipped ?? [])].map((t) => t.id));
// Visible text = rendered text minus anything ellipsized: the DOM keeps the full
// string, but the reader only sees a cut-off one, so it doesn't count as shown.
for (const t of [...(dump.truncated ?? []), ...(dump.clipped ?? [])]) {
  const r = rendered.get(t.id); if (r) r.visible = (r.visible ?? r.fullText ?? "").split(t.t).join(" ");
}

// --- match each expected card to a generated node by its rendered title ---------
const map = new Map(); // expected id -> generated node
for (const e of exp.nodes) {
  let best = null, bestScore = 0;
  for (const g of genNodes) {
    if (g.type === "box" || [...map.values()].includes(g)) continue;
    const text = rendered.get(g.id)?.fullText ?? "";
    const s = has(text, e.title) ? 2 : recall(text, e.title);
    if (s > bestScore) { best = g; bestScore = s; }
  }
  if (best && bestScore >= 0.8) map.set(e.id, best);
}
// Second pass: an item that also holds others (a stage with its steps inside) is
// legitimately drawn as a titled box. Let still-unmatched cards match a box title.
for (const e of exp.nodes) {
  if (map.has(e.id)) continue;
  const box = genNodes.find((g) => g.type === "box" && ![...map.values()].includes(g) &&
    has(`${g.title ?? ""} ${g.label ?? ""}`, e.title));
  if (box) map.set(e.id, box);
}

// Everything drawn inside a node's rect (a box's nested cards, for chips drawn as inner boxes).
const inside = (id) => {
  const o = rendered.get(id)?.own; if (!o) return "";
  return [...rendered.values()].filter((r) => r.id !== id && r.own.x >= o.x - 2 && r.own.y >= o.y - 2 &&
    r.own.x + r.own.w <= o.x + o.w + 2 && r.own.y + r.own.h <= o.y + o.h + 2).map((r) => r.visible).join(" ");
};
const nodeRows = exp.nodes.map((e) => {
  const g = map.get(e.id); const r = g && rendered.get(g.id); const text = r?.visible ?? "";
  const withInner = g ? `${text} ${inside(g.id)}` : "";
  const style = g?.style ?? {};
  return {
    id: e.id, found: !!g, gen: g?.id ?? null,
    title: g ? (has(text, e.title) ? 1 : recall(text, e.title)) : 0,
    summary: g ? recall(text, e.summary) : 0,
    desc: g ? recall(text, e.desc) : 0,
    chips: (e.chips ?? []).length ? (e.chips.filter((c) => has(withInner, c)).length / e.chips.length) : null,
    tags: (e.tags ?? []).length ? (e.tags.filter((c) => has(withInner, c)).length / e.tags.length) : null,
    badge: e.badge ? (g && has(text, e.badge) ? 1 : 0) : null,
    accent: e.accent ? (g && [g.accent, style.borderColor, style.fill, g.color].some((c) => sameHue(c, e.accent)) ? 1 : 0) : null,
    truncated: g ? truncatedIds.has(g.id) : false,
  };
});

const genBy = (id) => genNodes.find((n) => n.id === id);
// A labelled line may be drawn as A → [a small node carrying the label] → B (a token
// tag sitting on the line). That is the same connection; count it, and don't count the
// label node or its two segments as inventions.
const labelNodes = new Set(), labelEdges = new Set();
const edgeRows = exp.edges.map((e) => {
  const f = map.get(e.from)?.id, t = map.get(e.to)?.id;
  let g = f && t && genEdges.find((x) => base(x.from) === f && base(x.to) === t);
  let label = g ? (has(g.label, e.label) ? 1 : 0) : 0;
  if (!g && f && t && norm(e.label)) {
    for (const a of genEdges.filter((x) => base(x.from) === f)) {
      const mid = base(a.to), b = genEdges.find((x) => base(x.from) === mid && base(x.to) === t);
      if (b && has(rendered.get(mid)?.fullText ?? "", e.label)) {
        g = a; label = 1; labelNodes.add(mid); labelEdges.add(a).add(b);
        if (!a.color && b.color) g = { ...a, color: b.color };
        break;
      }
    }
  }
  return {
    edge: `${e.from} → ${e.to}`, found: !!g, label,
    dashed: g ? (!!g.dashed === e.dashed ? 1 : 0) : 0,
    color: g ? (sameHue(g.color ?? g.style?.stroke, e.color) ? 1 : 0) : 0,
  };
});
const expectedPairs = new Set(exp.edges.map((e) => `${map.get(e.from)?.id}>${map.get(e.to)?.id}`));
const extraEdges = genEdges.filter((x) => !labelEdges.has(x) && !expectedPairs.has(`${base(x.from)}>${base(x.to)}`)).length;
const mappedIds = new Set([...map.values()].map((g) => g.id));
const chipTexts = exp.nodes.flatMap((e) => [...(e.chips ?? []), ...(e.tags ?? [])]);
const isChipNode = (id) => chipTexts.some((c) => norm(c) && norm(rendered.get(id)?.fullText) === norm(c));
const extraNodes = genNodes.filter((n) => n.type !== "box" && n.type !== "text" && !mappedIds.has(n.id) &&
  !labelNodes.has(n.id) && !isChipNode(n.id)).length;

// Groups: a box whose title matches, wrapping exactly the expected members.
const groupRows = (exp.groups ?? []).map((grp) => {
  const box = genNodes.find((n) => n.type === "box" && has(`${n.title ?? ""} ${n.label ?? ""}`, grp.title)) ??
    genNodes.find((n) => n.type === "box" && (n.wraps ?? []).some((w) => genBy(w)?.type === "text" && has(genBy(w).text, grp.title)));
  const want = new Set(grp.members.map((m) => map.get(m)?.id).filter(Boolean));
  // Membership from the render: a member is any mapped node whose rect lies inside the box.
  const br = box && rendered.get(box.id)?.own;
  const inside = new Set([...mappedIds].filter((id) => {
    const r = rendered.get(id)?.own; if (!br || !r) return false;
    return r.x >= br.x - 2 && r.y >= br.y - 2 && r.x + r.w <= br.x + br.w + 2 && r.y + r.h <= br.y + br.h + 2;
  }));
  const inter = [...want].filter((x) => inside.has(x)).length;
  const union = new Set([...want, ...inside]).size || 1;
  const boxText = box ? rendered.get(box.id)?.visible ?? "" : "";
  return {
    group: grp.title, found: !!box, membership: inter / union,
    subtitle: box ? recall(boxText, grp.subtitle) : 0,
    caption: grp.caption ? (box && has(boxText, grp.caption) ? 1 : 0) : null,
    dashed: box ? ((box.style?.borderStyle === "dashed") === !!grp.dashed ? 1 : 0) : 0,
  };
});

// Layout: pairwise order agreement on x and y between source and render.
let agree = 0, pairs = 0;
const cen = (r) => [r.vis.x + r.vis.w / 2, r.vis.y + r.vis.h / 2];
const placed = exp.nodes.filter((e) => map.get(e.id) && rendered.get(map.get(e.id).id));
for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
  const a = placed[i], b = placed[j];
  const [ax, ay] = cen(rendered.get(map.get(a.id).id)), [bx, by] = cen(rendered.get(map.get(b.id).id));
  const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1];
  if (Math.abs(dx) > 0.02) { pairs++; if (Math.sign(dx) === Math.sign(bx - ax)) agree++; }
  if (Math.abs(dy) > 0.06) { pairs++; if (Math.sign(dy) === Math.sign(by - ay)) agree++; }
}
const layout = pairs ? agree / pairs : 0;

// Aspect of the rendered node union vs the source.
const all = dump.nodes.map((n) => n.vis);
const minX = Math.min(...all.map((r) => r.x)), maxX = Math.max(...all.map((r) => r.x + r.w));
const minY = Math.min(...all.map((r) => r.y)), maxY = Math.max(...all.map((r) => r.y + r.h));
const aspect = (maxX - minX) / (maxY - minY), srcAspect = exp.source_size[0] / exp.source_size[1];

// --- score ------------------------------------------------------------------------
const avg = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 1; };
const parts = {
  cards_found: avg(nodeRows.map((r) => (r.found ? 1 : 0))),
  title: avg(nodeRows.map((r) => r.title)),
  summary: avg(nodeRows.map((r) => r.summary)),
  desc: avg(nodeRows.map((r) => r.desc)),
  chips_tags: avg(nodeRows.flatMap((r) => [r.chips, r.tags])),
  badges: avg(nodeRows.map((r) => r.badge)),
  card_colour: avg(nodeRows.map((r) => r.accent)),
  not_truncated: avg(nodeRows.map((r) => (r.found ? (r.truncated ? 0 : 1) : 0))),
  edges_found: avg(edgeRows.map((r) => (r.found ? 1 : 0))),
  edge_labels: avg(edgeRows.map((r) => r.label)),
  edge_dashed: avg(edgeRows.map((r) => r.dashed)),
  edge_colour: avg(edgeRows.map((r) => r.color)),
  group: avg(groupRows.map((r) => (r.found ? avg([r.membership, r.subtitle, r.dashed, r.caption]) : 0))),
  layout,
  aspect: Math.min(aspect, srcAspect) / Math.max(aspect, srcAspect),
  no_inventions: 1 / (1 + extraNodes + extraEdges),
};
// The goal is the same REPRESENTATION, not a pixel clone: the same boxes and text, the
// same groupings and connections, the same arrangement. Line routing, exact colours and
// proportions are free — they are reported as STYLE and kept out of the headline score.
const STYLE = new Set(["badges", "card_colour", "edge_dashed", "edge_colour", "aspect"]);
const core = Object.entries(parts).filter(([k]) => !STYLE.has(k)).map(([, v]) => v);
const style = Object.entries(parts).filter(([k]) => STYLE.has(k)).map(([, v]) => v);
const total = avg(core), styleScore = avg(style);
const report = { total, style: styleScore, parts, extraNodes, extraEdges, aspect: { rendered: aspect, source: srcAspect }, nodes: nodeRows, edges: edgeRows, groups: groupRows };
writeFileSync(join(out, "score.json"), JSON.stringify(report, null, 2));

const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
console.log(`\nREDRAW SCORE ${pct(total)}   style ${pct(styleScore)}   (${projDir})`);
for (const [k, v] of Object.entries(parts)) console.log(`  ${(STYLE.has(k) ? "(style) " : "") + k}`.padEnd(24) + ` ${pct(v)}`);
console.log(`  extra nodes ${extraNodes}, extra edges ${extraEdges}, aspect ${aspect.toFixed(2)} vs ${srcAspect.toFixed(2)}`);
const misses = [
  ...nodeRows.filter((r) => !r.found).map((r) => `card missing: ${r.id}`),
  ...nodeRows.filter((r) => r.found && r.truncated).map((r) => `card truncated: ${r.id}`),
  ...nodeRows.filter((r) => r.found && r.desc < 0.8).map((r) => `desc not shown: ${r.id} (${pct(r.desc)})`),
  ...edgeRows.filter((r) => !r.found).map((r) => `edge missing: ${r.edge}`),
];
if (misses.length) console.log("  " + misses.slice(0, 25).join("\n  "));
console.log(`  png: ${join(out, "arch.png")}`);
