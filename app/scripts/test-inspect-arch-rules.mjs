#!/usr/bin/env node
/**
 * Regression tests for inspect-arch's gated rules (TRUNCATED TEXT, TITLE CROSSED BY
 * EDGE, EDGE UNDER LABEL, CONSOLE). Each rule gets a fixture that MUST fault and a
 * near-identical one that MUST NOT, so a rule that starts (or stops) firing on the
 * wrong thing fails here instead of silently moving the eval baseline.
 *
 * Requires the standalone viewer: `bun run build:arch-standalone` first.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const inspect = join(here, "inspect-arch.mjs");
const viewerPath = join(app, "dist-standalone/architecture-viewer.html");
const fixtures = join(here, "test-inspect-arch-fixtures");
// Frozen copy of the pre-2026-10-14 governance reference (an edge through the
// "Databricks Metastore" title). Never point a must-fault case at a live reference:
// references get fixed, and the test would then fail for the wrong reason.
const refTitleCrossed = join(fixtures, "title-crossed.json");

if (!existsSync(viewerPath)) {
  console.error(`missing ${viewerPath}\nRun: cd app && bun run build:arch-standalone`);
  process.exit(2);
}
const viewer = readFileSync(viewerPath, "utf8");
const dir = mkdtempSync(join(tmpdir(), "inspect-rules-"));

/** Same // and /* *​/ stripper the eval uses for .jsonc references. */
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

/** Embed a JSON tab payload into the viewer, optionally adding raw markup before </body>. */
function page(tabs, name, extraHtml = "") {
  const body = viewer.replace(
    /(<script[^>]*type="application\/json"[^>]*id="architecture"[^>]*>)[\s\S]*?(<\/script>)/,
    (_m, a, b) => a + JSON.stringify(tabs) + b,
  ).replace("</body>", `${extraHtml}</body>`);
  const file = join(dir, `${name}.html`);
  writeFileSync(file, body);
  return file;
}

/** Run the checker; return its full output (non-zero exit is expected for faulty fixtures). */
function check(file) {
  try {
    return execFileSync(process.execPath, [inspect, file], { encoding: "utf8", timeout: 240000 });
  } catch (err) {
    return (err.stdout ?? "") + (err.stderr ?? "");
  }
}

const count = (out, name) => {
  const m = new RegExp(`^${name}: (\\d+)$`, "m").exec(out);
  if (!m) throw new Error(`inspect-arch did not report "${name}":\n${out}`);
  return Number(m[1]);
};

const failures = [];
const expect = (label, cond, detail) => { if (!cond) failures.push(`${label}\n${detail ?? ""}`); };

const base = JSON.parse(readFileSync(join(fixtures, "fraud-v2.json"), "utf8"));

// 1. TRUNCATED TEXT — a slide product-tile title wraps to two lines, then ellipsizes
//    (line-clamp-2). A label needing four lines must fault. (Sources in a lane don't
//    truncate: step 2.5 widens the group to fit the longest label.)
{
  const bad = structuredClone(base);
  bad[0].nodes.find((n) => n.id === "training").label = "Model training on labeled card authorization history with MLflow";
  const badOut = check(page(bad, "trunc-bad"));
  const goodOut = check(page(base, "trunc-good"));
  expect("TRUNCATED TEXT: over-long tile title must fault", count(badOut, "TRUNCATED TEXT") >= 1, badOut);
  expect("TRUNCATED TEXT: report must name the node and its full text",
    /training: "Model training on labeled card authorization history with MLflow"/.test(badOut), badOut);
  expect("TRUNCATED TEXT: unmodified diagram must be clean", count(goodOut, "TRUNCATED TEXT") === 0, goodOut);
}

// 2. TITLE CROSSED BY EDGE — an edge that drops from a node above a box straight into
//    the box's child runs through the box's centred title; a clean diagram must not.
{
  const gov = JSON.parse(readFileSync(refTitleCrossed, "utf8"));
  const out = check(page(gov, "title-gov"));
  expect("TITLE CROSSED BY EDGE: an edge into a box from above must fault",
    count(out, "TITLE CROSSED BY EDGE") >= 1, out);
  expect("TITLE CROSSED BY EDGE: report names the box whose title is crossed",
    /runs through the title ".*" of metastore/.test(out), out);
  const clean = check(page(base, "title-clean"));
  expect("TITLE CROSSED BY EDGE: fraud-v2 must be clean", count(clean, "TITLE CROSSED BY EDGE") === 0, clean);
}

// 3. EDGE UNDER LABEL — label placement now steers auto labels off other lines, so the
//    fixture forces it: e-register's elbow is PARKED (centerX — its label is honoured
//    exactly) on the point a straight e-through runs through. Removing the label's text
//    removes the label entirely, so the same geometry must not fault.
{
  const under = JSON.parse(readFileSync(join(fixtures, "edge-under-label.json"), "utf8"));
  const out = check(page(under, "under-bad"));
  expect("EDGE UNDER LABEL: parked label on a line must fault",
    count(out, "EDGE UNDER LABEL") >= 1, out);
  expect("EDGE UNDER LABEL: report names the Register label and both edges",
    /e-through runs under the "Register" label of e-register/.test(out), out);
  const clean0 = check(page(base, "under-fraud"));
  expect("EDGE UNDER LABEL: fraud-v2 (auto labels) must be clean", count(clean0, "EDGE UNDER LABEL") === 0, clean0);
  const noLabel = structuredClone(under);
  for (const e of noLabel[0].edges) if (e.label === "Register") delete e.label;
  const clean = check(page(noLabel, "under-good"));
  expect("EDGE UNDER LABEL: same diagram with the Register label removed must be clean",
    count(clean, "EDGE UNDER LABEL") === 0, clean);
}

// 4. CONSOLE — an uncaught exception must reach the report AND the exit code, with its message.
{
  const bad = check(page(base, "console-bad", "<script>var o=null;o.document;</script>"));
  expect("CONSOLE: uncaught exception must be counted", count(bad, "CONSOLE") >= 1, bad);
  expect("CONSOLE: report must carry the exception message",
    /uncaught exception: TypeError: Cannot read properties of null \(reading 'document'\)/.test(bad), bad);
  const good = check(page(base, "console-good"));
  expect("CONSOLE: clean page must report 0", count(good, "CONSOLE") === 0, good);
}

if (failures.length) {
  console.error(failures.join("\n\n---\n\n"));
  process.exit(1);
}
console.log("inspect-arch rule regression tests passed (truncation, title crossing, label crossing, console)");
