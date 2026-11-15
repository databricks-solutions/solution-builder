#!/usr/bin/env node
/**
 * gen-arch-style-previews.mjs — render the preview thumbnail for each diagram style
 * shown on the home page's Architecture tab.
 *
 *   node scripts/gen-arch-style-previews.mjs            (from app/)
 *
 * Each thumbnail is rendered FROM the skill's own example (reference/*.jsonc), so the
 * picker never drifts from what the agent is told to build. Outputs go to
 * ui/public/arch-styles/<style>.png (served at /arch-styles/<style>.png).
 *
 * Needs `bun run build:arch-standalone` once (the renderer uses the standalone viewer)
 * and a headless Chrome (see browser-lifecycle.mjs). `match` has no example — it is a
 * small illustrative sketch written here as HTML and screenshotted.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./browser-lifecycle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, "..");
const SKILL_REF = resolve(APP, "..", ".claude/skills/databricks-architecture/reference");
const OUT = resolve(APP, "src/demo_prompt_generator/ui/public/arch-styles");
const work = mkdtempSync(join(tmpdir(), "arch-style-"));

// style id → the example that IS that style (marketing reuses the complete reference).
const EXAMPLES = {
  marketing: "architecture-complete.jsonc",
  technical: "style-technical.jsonc",
  lifecycle: "style-lifecycle.jsonc",
  networking: "style-networking.jsonc",
};

/** Drop full-line // comments (the examples are JSONC) and return plain JSON text. */
function stripJsonc(text) {
  const doc = JSON.parse(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
  return JSON.stringify(doc, null, 2);
}

/** Keep thumbnails small: downscale to 720px max side when macOS `sips` is available. */
function shrink(png) {
  try {
    execFileSync("sips", ["-Z", "720", png], { stdio: "ignore" });
  } catch {
    /* no sips (non-macOS): keep the 2x render as-is */
  }
}

function renderExample(style, file) {
  const src = join(SKILL_REF, file);
  if (!existsSync(src)) throw new Error(`missing example: ${src}`);
  const json = join(work, `${style}.json`);
  writeFileSync(json, stripJsonc(readFileSync(src, "utf8")));
  const png = join(OUT, `${style}.png`);
  execFileSync(process.execPath, [join(here, "render-arch.mjs"), json, png], { stdio: ["ignore", "ignore", "inherit"] });
  shrink(png);
  console.log(`✓ ${style} ← ${file}`);
}

// A simple whiteboard-style sketch: boxes with a wobbly border, labelled arrows.
const MATCH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fbfbfc;font-family:"Comic Sans MS","Segoe Print","Marker Felt",system-ui,sans-serif;color:#1f2937}
  .box{position:absolute;border:3px solid #374151;border-radius:14px 10px 16px 12px;background:#fff;padding:14px 18px;font-size:30px;font-weight:600;transform:rotate(-0.6deg)}
  .alt{transform:rotate(0.8deg)}
  .arrow{position:absolute;height:0;border-top:4px solid #ef4444}
  .arrow::after{content:"";position:absolute;right:-4px;top:-11px;border-left:14px solid #ef4444;border-top:9px solid transparent;border-bottom:9px solid transparent}
  .lbl{position:absolute;font-size:24px;color:#ef4444;font-weight:600}
  .dash{border-top-style:dashed}
</style></head><body>
  <div class="box" style="left:70px;top:250px">Sources</div>
  <div class="box alt" style="left:390px;top:250px;width:230px">Ingest</div>
  <div class="box" style="left:710px;top:150px;width:240px">Lakehouse</div>
  <div class="box alt" style="left:710px;top:370px;width:240px">Models</div>
  <div class="box" style="left:1040px;top:250px">Apps</div>
  <div class="arrow" style="left:262px;top:290px;width:112px"></div>
  <div class="arrow" style="left:626px;top:290px;width:68px;transform:rotate(-20deg);transform-origin:left"></div>
  <div class="arrow" style="left:626px;top:300px;width:68px;transform:rotate(20deg);transform-origin:left"></div>
  <div class="arrow" style="left:956px;top:220px;width:70px;transform:rotate(12deg);transform-origin:left"></div>
  <div class="arrow dash" style="left:956px;top:400px;width:70px;transform:rotate(-12deg);transform-origin:left;border-top-color:#9ca3af"></div>
  <div class="lbl" style="left:280px;top:226px">raw</div>
  <div class="lbl" style="left:960px;top:176px">serve</div>
  <div class="lbl" style="left:70px;top:520px;font-size:26px;color:#6b7280">your own sketch, redrawn</div>
</body></html>`;

function renderMatch() {
  const html = join(work, "match.html");
  writeFileSync(html, MATCH_HTML);
  const out = join(OUT, "match.png");
  execFileSync(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--window-size=1200,600",
    `--screenshot=${out}`, `file://${html}`,
  ], { stdio: "ignore" });
  shrink(out);
  console.log("✓ match ← illustrative sketch");
}

if (!existsSync(join(APP, "dist-standalone", "architecture-viewer.html"))) {
  console.error("architecture-viewer.html missing — run `bun run build:arch-standalone` first.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
for (const [style, file] of Object.entries(EXAMPLES)) renderExample(style, file);
renderMatch();
