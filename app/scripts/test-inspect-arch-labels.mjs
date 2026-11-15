#!/usr/bin/env node
/**
 * Regression test for inspect-arch's wrapped SVG edge-label collector.
 *
 * The dev label chip renders wrapped labels as <text><tspan>...</tspan></text>.
 * A leaf-only DOM collector silently dropped those labels, making all label
 * collision checks report false passes. Keep this tiny browser fixture separate
 * from the architecture-quality corpus: it tests the measurement instrument,
 * not diagram quality.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const inspect = join(here, "inspect-arch.mjs");
const fixture = join(repo, "scripts/test-inspect-arch-fixtures/wrapped-edge-label.html");

const output = execFileSync(process.execPath, [inspect, fixture], {
  cwd: repo,
  encoding: "utf8",
  timeout: 180000,
});

const value = (name) => {
  const match = new RegExp(`^${name}: (\\d+)$`, "m").exec(output);
  if (!match) throw new Error(`inspect-arch did not report ${name}`);
  return Number(match[1]);
};

const edgeLabels = /edges: \d+  edgeLabels: (\d+)/.exec(output);
if (!edgeLabels || Number(edgeLabels[1]) !== 1) {
  throw new Error(`wrapped SVG label was not counted exactly once:\n${output}`);
}
for (const name of ["LABEL OVERLAPS", "LABEL OVER NODE/TITLE"]) {
  if (value(name) !== 0) throw new Error(`${name} unexpectedly reported a fixture fault:\n${output}`);
}

console.log("inspect-arch wrapped SVG label regression passed");

// TEXT TOO SMALL (advisory): a wide diagram scaled to a 1920×1080 slide shrinks its fixed-px
// text below the legibility floor. Two cards 6000 flow-px apart force ~0.3 scale (a 22px title → ~7px).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const wideDir = mkdtempSync(join(tmpdir(), "arch-small-"));
const wide = join(wideDir, "wide.json");
writeFileSync(wide, JSON.stringify([{
  name: "wide", aspect: "16:9", direction: "horizontal",
  nodes: [
    { id: "a", type: "card", title: "Left tile", at: [0, 0] },
    { id: "b", type: "card", title: "Right tile", at: [6000, 0] },
  ],
  edges: [],
}]));
const wideOut = execFileSync(process.execPath, [inspect, wide], { cwd: repo, encoding: "utf8", timeout: 180000 });
const small = /^TEXT TOO SMALL \(advisory, not gated\): (\d+)$/m.exec(wideOut);
if (!small || Number(small[1]) < 1) throw new Error(`TEXT TOO SMALL did not fire on a wide diagram:\n${wideOut}`);
console.log("inspect-arch TEXT TOO SMALL advisory check passed");
