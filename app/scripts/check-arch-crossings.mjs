#!/usr/bin/env node
/**
 * check-arch-crossings.mjs — the FAST, BROWSER-AUTHORITATIVE crossing oracle.
 *
 *   cd app && node scripts/check-arch-crossings.mjs ml-platform
 *   cd app && node scripts/check-arch-crossings.mjs            # all reference diagrams
 *
 * WHY. Crossings can only be trusted from the BROWSER (offline path reconstruction
 * diverges from ReactFlow's smooth-step render through the channel/tile/route
 * passes — proven repeatedly). But the FULL `eval:arch` renders all 10 corpus
 * diagrams (~40s), which is why the crossing loop felt slow. A SINGLE diagram
 * render + inspect is ~2s. This injects ONE reference diagram into the built
 * standalone viewer and runs `inspect-arch.mjs`, printing just the EDGE CROSS
 * pairs — the exact fast loop for iterating on edge routing.
 *
 * Prereq: `bun run build:arch-standalone` (the viewer the diagram is injected into).
 * Rebuild that after any routing-code change, THEN run this. Total loop ~5s.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const APP = resolve(import.meta.dirname, "..");
const REPO = resolve(APP, "..");
const REF = join(REPO, ".claude/skills/databricks-architecture/reference");
const VIEWER = join(APP, "dist-standalone/architecture-viewer.html");
const RESULTS = join(APP, "scripts/eval-arch/results");
const INSPECT = join(APP, "scripts/inspect-arch.mjs");

if (!existsSync(VIEWER)) {
  console.error(`Missing ${VIEWER}\nRun: bun run build:arch-standalone`);
  process.exit(2);
}

function stripJsonc(text) {
  let out = "", inStr = false, esc = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (line) { if (c === "\n") { line = false; out += c; } continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (inStr) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    out += c;
  }
  return out;
}

const only = process.argv.slice(2);
const names = only.length
  ? only
  : readdirSync(REF).filter((f) => f.endsWith(".jsonc")).map((f) => basename(f, ".jsonc")).sort();

const viewerHtml = readFileSync(VIEWER, "utf8");
mkdirSync(RESULTS, { recursive: true });

let anyFail = false;
for (const name of names) {
  const jsoncPath = join(REF, `${name}.jsonc`);
  if (!existsSync(jsoncPath)) { console.error(`  ${name}: no such reference`); anyFail = true; continue; }
  const tabs = JSON.parse(stripJsonc(readFileSync(jsoncPath, "utf8")));
  const injected = viewerHtml.replace(
    /(<script[^>]*type="application\/json"[^>]*id="architecture"[^>]*>)[\s\S]*?(<\/script>)/,
    (_m, a, b) => a + JSON.stringify(Array.isArray(tabs) ? tabs : [tabs]) + b,
  );
  const page = join(RESULTS, `${name}.html`);
  writeFileSync(page, injected);

  const r = spawnSync("node", [INSPECT, page], { encoding: "utf8", timeout: 120000 });
  const stdout = (r.stdout ?? "") + (r.stderr ?? "");
  const m = /^EDGE CROSS: (\d+)$/m.exec(stdout);
  const count = m ? Number(m[1]) : null;
  // The pairs follow the "EDGE CROSS: N" line, indented "  a ✕ b".
  const pairs = [];
  if (count) {
    const after = stdout.slice(stdout.indexOf("EDGE CROSS:"));
    for (const line of after.split("\n").slice(1)) {
      const t = line.trim();
      if (/[✕x] /.test(t) && !/^[A-Z]/.test(t)) pairs.push(t);
      else if (t && !t.startsWith(" ") && /^[A-Z]/.test(t)) break; // next section header
    }
  }
  const label = count === null ? "?" : String(count);
  console.log(`  ${name.padEnd(24)} EDGE CROSS=${label}${pairs.length ? "  [" + pairs.join(", ") + "]" : ""}`);
  if (count === null) anyFail = true;
}

process.exit(anyFail ? 1 : 0);
