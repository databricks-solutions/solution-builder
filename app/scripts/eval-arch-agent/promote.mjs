#!/usr/bin/env node
/**
 * promote.mjs — put one reviewed agent run on the /architecture-showcase page.
 *
 *   node scripts/eval-arch-agent/promote.mjs <run-dir> --title "…" [--id <showcase-id>]
 *        [--after <showcase-id>] [--note "…"] [--replace]
 *
 * Only promote a run a reviewer judged clean by eye (AGENTS.md: one prompt, no human edits
 * unless `note` says so). The item keeps the prompt as the user typed it, the agent's
 * render count and time, and its diagram verbatim. A committed prompt is a committed
 * text; never promote a private (image) case — its source may be customer material.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const runDir = argv[0];
const title = opt("--title");
if (!runDir || !title) { console.error('usage: promote.mjs <run-dir> --title "…" [--id] [--after] [--note] [--replace]'); process.exit(1); }

const F = join(dirname(fileURLToPath(import.meta.url)), "../../src/demo_prompt_generator/ui/public/architecture-showcase.json");
const result = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
if (result.family === "private") { console.error("refusing: private (image) cases are never published"); process.exit(1); }
if ((result.followups ?? []).length) { console.error("refusing: the showcase shows one prompt; this run has follow-ups"); process.exit(1); }

const doc = JSON.parse(readFileSync(join(runDir, "_eval/diagram.json"), "utf8"));
const tabs = Array.isArray(doc) ? doc : doc.tabs ?? [doc];
const STYLES = ["marketing", "technical", "lifecycle", "networking", "match"];
const item = {
  id: opt("--id") ?? result.id,
  title,
  style: STYLES.includes(result.style) ? result.style : "technical",
  prompt: result.prompt,
  renders: summary.renders,
  seconds: summary.duration_s,
  ...(opt("--note") ? { note: opt("--note") } : {}),
  architecture: "```json\n" + JSON.stringify(tabs, null, 2) + "\n```\n",
};

// Refuse a copy of a skill reference: the agent sometimes reproduces the reference it was
// pointed at, and the page already shows every reference under "Skill references".
{
  const sig = (tabs) => { const out = new Set(); const w = (ns) => (ns ?? []).forEach((n) => { out.add(`${n.type}:${n.label ?? n.text ?? n.title ?? ""}`); w(n.children); }); (Array.isArray(tabs) ? tabs : [tabs]).forEach((t) => w(t.nodes)); return out; };
  const mine = sig(tabs);
  const refs = JSON.parse(readFileSync(F.replace("architecture-showcase.json", "architecture-references.json"), "utf8")).items;
  for (const r of refs) {
    const other = sig(JSON.parse(r.architecture.match(/```json\n([\s\S]*?)\n```/)[1]));
    const inter = [...mine].filter((x) => other.has(x)).length;
    const jac = inter / (mine.size + other.size - inter);
    if (jac >= 0.8 && !argv.includes("--force")) { console.error(`refusing: ${Math.round(jac * 100)}% the same nodes as the skill reference ${r.file} (already on the page). --force to promote anyway.`); process.exit(1); }
  }
}
const j = JSON.parse(readFileSync(F, "utf8"));
const at = j.items.findIndex((x) => x.id === item.id);
if (at >= 0 && !argv.includes("--replace")) { console.error(`"${item.id}" is already on the showcase; pass --replace`); process.exit(1); }
if (at >= 0) j.items[at] = item;
else {
  const after = opt("--after") ?? [...j.items].reverse().find((x) => x.style === item.style)?.id;
  const i = j.items.findIndex((x) => x.id === after);
  j.items.splice(i >= 0 ? i + 1 : j.items.length, 0, item);
}
j.generated = new Date().toISOString().slice(0, 10);
// The file is stored with a 1-space indent; keep it so a promotion is a small diff.
writeFileSync(F, JSON.stringify(j, null, 1) + "\n");
console.log(`${at >= 0 ? "replaced" : "added"} ${item.id} (${basename(runDir)}): ${item.renders} renders, ${item.seconds}s`);
