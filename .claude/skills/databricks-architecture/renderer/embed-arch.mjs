#!/usr/bin/env node
/**
 * embed-arch.mjs — turn a diagram file into the self-contained HTML you hand over.
 *
 *   node renderer/embed-arch.mjs my-arch.json [my-arch.html] [--viewer]
 *
 * Reads the diagram (a `.json` array of tabs, or an `architecture.md` with a ```json
 * fence) and writes the editable canvas (`architecture-editor.html`, with Load / Save /
 * Download) with that JSON inline. `--viewer` writes the read-only page instead, only for
 * an explicitly read-only share. Default output: the input path with `.html`.
 *
 * Author and iterate on the .json (render-arch / inspect-arch take it directly); run this
 * once at the end. Never open or edit the HTML itself: it carries the whole renderer
 * (several MB).
 */
import { writeFileSync } from "node:fs";
import { embedDiagram, readDiagram } from "./browser-lifecycle.mjs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
if (!files[0]) { console.error("usage: node embed-arch.mjs <my-arch.json | architecture.md> [out.html] [--viewer]"); process.exit(1); }
const out = files[1] ?? files[0].replace(/\.(md|json)$/i, "") + ".html";
const doc = readDiagram(files[0]);
const tabs = Array.isArray(doc) ? doc : [doc];
if (!tabs.every((t) => t && Array.isArray(t.nodes))) { console.error("not a diagram: expected an array of tabs, each with `nodes`"); process.exit(1); }
writeFileSync(out, embedDiagram(tabs, args.includes("--viewer") ? "viewer" : "editor"));
console.log(`✓ ${out} (${tabs.length} tab${tabs.length > 1 ? "s" : ""}, ${args.includes("--viewer") ? "read-only viewer" : "editor"})`);
