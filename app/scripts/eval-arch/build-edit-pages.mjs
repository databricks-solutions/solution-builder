#!/usr/bin/env node
/**
 * build-edit-pages.mjs — write an EDITABLE copy of each eval diagram so the review
 * page can drag-and-drop nodes to test layout dynamically.
 *
 *   cd app && node scripts/eval-arch/build-edit-pages.mjs
 *
 * eval-arch.ts renders each diagram into the VIEWER build (read-only, for scoring).
 * This injects the same diagram JSON into the EDITOR build instead → `<name>.edit.html`,
 * which mounts the full ReactFlow editor (nodes draggable, edit toolbar). Dragging a
 * node re-runs the SAME routing engine live, so it's the fastest way to eyeball
 * whether edge routing holds up as nodes move — WITHOUT touching the reference files
 * (the editor's Save writes to a local file via the File System Access API; it never
 * writes back to the repo).
 *
 * Prereq: `bun run build:arch-standalone` (writes dist-standalone/architecture-editor.html),
 * and `bun run eval:arch` (writes results/<name>.html with the diagram JSON to lift).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const APP = resolve(import.meta.dirname, "..", "..");
const EDITOR = join(APP, "dist-standalone/architecture-editor.html");
const RESULTS = join(import.meta.dirname, "results");

if (!existsSync(EDITOR)) {
  console.error(`Missing ${EDITOR}\nRun: bun run build:arch-standalone`);
  process.exit(2);
}
const editorHtml = readFileSync(EDITOR, "utf8");

// The diagram JSON is the <script type="application/json" id="architecture"> body
// of each results/<name>.slide.html (already theme-normalized to the slide preset).
const ARCH_RE = /(<script[^>]*type="application\/json"[^>]*id="architecture"[^>]*>)([\s\S]*?)(<\/script>)/;

const names = (existsSync(RESULTS) ? readdirSync(RESULTS) : [])
  .filter((f) => f.endsWith(".slide.html"))
  .map((f) => basename(f, ".slide.html"));

let wrote = 0;
for (const name of names) {
  const src = readFileSync(join(RESULTS, `${name}.slide.html`), "utf8");
  const m = ARCH_RE.exec(src);
  if (!m) { console.error(`  ${name}: no architecture JSON found — skipped`); continue; }
  const json = m[2];
  const edit = editorHtml.replace(ARCH_RE, (_full, open, _body, close) => open + json + close);
  writeFileSync(join(RESULTS, `${name}.edit.html`), edit);
  wrote++;
}
console.log(`Wrote ${wrote} editable page(s) → results/<name>.edit.html`);
