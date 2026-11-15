#!/usr/bin/env node
/**
 * render-arch-tabs.mjs — render EVERY tab of an architecture HTML to its own PNG, and
 * (unless --no-check) run the layout check on each one.
 *
 *   node renderer/render-arch-tabs.mjs <my-arch.json | architecture.md | my-arch.html> [--no-check]
 *
 * The page's inline JSON is an ARRAY of tabs, but the viewer only ever shows (and
 * render-arch.mjs only ever screenshots) the ACTIVE tab. So this writes a throwaway
 * single-tab copy of the page per tab and renders each one:
 *
 *   my-arch.png                 tab 1
 *   my-arch-<tab-name-slug>.png every later tab
 *
 * Exits non-zero if a render fails or a tab fails its layout check, so it can gate a
 * commit. Requires the same chromium-headless-shell as render-arch.mjs.
 *
 * Browser hygiene: this spawns render-arch.mjs and inspect-arch.mjs as short-lived child
 * processes, one browser each, sequentially — never in parallel, and each child kills
 * its own browser process group on every exit path. With --no-check it launches half as
 * many. If a run is interrupted hard (SIGKILL to this process), sweep survivors with:
 *   pkill -f 'ms-playwright.*chrome-headless-shell'
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { embedDiagram, readDiagram } from "./browser-lifecycle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = !args.includes("--no-check");
const inArg = args.find((a) => !a.startsWith("--"));
if (!inArg) {
  console.error("usage: node render-arch-tabs.mjs <my-arch.json | architecture.md | architecture.html> [--no-check]");
  process.exit(1);
}
const htmlPath = isAbsolute(inArg) ? inArg : resolve(process.cwd(), inArg);
// A raw diagram file is rendered through the bundled viewer, like render-arch.mjs does.
const html = /\.html?$/i.test(htmlPath) ? readFileSync(htmlPath, "utf8") : embedDiagram(readDiagram(htmlPath), "viewer");

const BLOCK = /(<script type="application\/json" id="architecture">)([\s\S]*?)(<\/script>)/;
const m = BLOCK.exec(html);
if (!m) { console.error("no inline architecture JSON found in that page"); process.exit(1); }
let tabs;
try { tabs = JSON.parse(m[2].trim()); } catch (e) { console.error("inline architecture JSON is not valid: " + e.message); process.exit(1); }
if (!Array.isArray(tabs)) tabs = [tabs];

const base = htmlPath.replace(/\.(html?|md|json)$/i, "");
const tmp = mkdtempSync(join(tmpdir(), "arch-tabs-"));
let failed = 0;

tabs.forEach((tab, i) => {
  const slug = String(tab?.name ?? `tab${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `tab${i + 1}`;
  const page = join(tmp, `${slug}.html`);
  writeFileSync(page, html.replace(BLOCK, (_, a, __, c) => `${a}\n${JSON.stringify([tab], null, 2)}\n${c}`));
  const png = i === 0 ? `${base}.png` : `${base}-${slug}.png`;

  // spawnSync keeps this strictly sequential: one headless browser alive at a time,
  // rather than N tabs' worth of browsers competing for the machine.
  const r = spawnSync("node", [join(here, "render-arch.mjs"), page, png], { stdio: "inherit" });
  if (r.status !== 0) { failed++; return; }

  if (check) {
    console.log(`--- layout check: ${tab?.name ?? `tab ${i + 1}`}`);
    const c = spawnSync("node", [join(here, "inspect-arch.mjs"), page], { stdio: "inherit" });
    if (c.status !== 0) failed++;
  }
});

console.log(`single-tab pages: ${tmp}`);
if (failed) { console.error(`\n${failed} tab(s) failed to render or failed the layout check.`); process.exit(1); }
