#!/usr/bin/env node
/**
 * inspect-arch.mjs — headless LAYOUT CHECK for an architecture page. Run it after every
 * edit, alongside render-arch.mjs: reading the PNG does not catch these.
 *
 *   node renderer/inspect-arch.mjs <architecture.html>        # checks the ACTIVE tab
 *   node renderer/render-arch-tabs.mjs <architecture.html>    # renders + checks every tab
 *
 * Exits non-zero if anything is wrong, so it can gate a commit.
 *
 * The checks themselves live in arch-browser.js (next to this file, and in the skill's
 * renderer/): this host only launches the browser, loads the page and prints the result.
 * The app's render tool runs the SAME file through Python Playwright, so the rules never fork.
 *
 * Why it exists — the engine places nodes and edges without any of these guarantees:
 *   • a `logo` node's rect is only its ICON; the caption/description is drawn OUTSIDE
 *     it, so the de-overlap pass never sees a long caption colliding with a neighbour;
 *   • a container `box` draws its `title` INSIDE its top-left corner, so the first
 *     child can end up sitting on the title (`pad: 26` collides, `pad: 64` clears);
 *   • an edge label is dropped at the path midpoint, slightly low and toward the target,
 *     with NO collision avoidance — in a dense grid a third of them land on a tile (see
 *     the numbered-edges + legend technique in reference/complex-workflows.md);
 *   • edges are routed with NO node avoidance, so a line spanning more than about two
 *     columns will happily run straight through unrelated tiles.
 *
 * So it measures a VISUAL rect per node (node rect unioned with its rendered text) and
 * samples every edge path, then reports:
 *   NODE OVERLAPS (visual) · BOX OVERLAPS · BOX STRADDLE · ON BOX TITLE · LABEL OVERLAPS ·
 *   LABEL OVER NODE/TITLE · EDGE THROUGH TILE · EDGE GRAZES TILE · PARALLEL OVERLAP · EDGE CROSS ·
 *   TRUNCATED TEXT · TITLE CROSSED BY EDGE · EDGE UNDER LABEL · CLIPPED TEXT ·
 *   PRESENTATION ASPECT · FLOW ORIENTATION · CONSOLE
 * Every count should be 0 before you ship a render. PRESENTATION ASPECT measures
 * the actual rendered node bounds; export padding cannot make it pass.
 *
 * GATED (exit 1, counted by eval:arch): everything above except LEGIBILITY and the
 * COMPOSITION block. PRESENTATION ASPECT gates only a MISSING declaration (the ratio
 * miss is advisory). The three rules added with TRUNCATED TEXT, TITLE CROSSED BY EDGE and
 * EDGE UNDER LABEL, plus CONSOLE, which now reaches the exit code (it was printed but
 * not gated before).
 *   • TRUNCATED TEXT — a node/box text that CSS-ellipsizes (DOM text wider than box), or
 *     an edge label whose wrap ran past MAX_LINES (last line ends in "…"). Reports the full text.
 *   • TITLE CROSSED BY EDGE — a segment enters a container's title-text rect. An edge's
 *     own endpoint stub (samples still inside that container) is exempt.
 *   • EDGE UNDER LABEL — an edge path runs under ANOTHER edge's label pill. Only labels
 *     whose text names exactly one edge are tested (duplicates are ambiguous, so skipped).
 *     Controlled by LABEL_CROSS_GATED at the top of this file.
 * Scope limits, stated plainly: the browser's CSS ellipsis is the only truncation signal;
 * the checker has no source-text comparison, so "rendered shorter than source" is covered
 * only through overflow.
 *
 * Two measurement traps, already handled here, that will bite anyone extending this:
 *   • a `text` node contains a hidden measuring element parked ~100k px offscreen, so
 *     unioning child rects needs a POSITION filter, not just a size filter;
 *   • node rects come from getBoundingClientRect (screen px) while edge path points come
 *     from getPointAtLength (path user space) — map the latter through getScreenCTM or the
 *     two coordinate systems silently disagree and every check reads 0.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { findChrome, freePort, guardBrowser, resolveArchInput, SPAWN_OPTS } from "./browser-lifecycle.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

// EDGE UNDER LABEL gating switch — see the rule below for the data behind the choice.
const LABEL_CROSS_GATED = true;

const inArg = process.argv[2];
if (!inArg) {
  console.error("usage: node renderer/inspect-arch.mjs <architecture.html | architecture.md>");
  process.exit(1);
}
// An architecture.md / .json is inspected through the bundled viewer (resolveArchInput).
const { html: htmlPath } = resolveArchInput(isAbsolute(inArg) ? inArg : resolve(process.cwd(), inArg));
const chrome = findChrome();
if (!chrome) {
  console.error(
    "No Chrome/Chromium found. Install the lightweight headless shell once:\n" +
    "  npx playwright install chromium-headless-shell\n" +
    "or set CHROME_PATH=/path/to/chrome.",
  );
  process.exit(1);
}
const PORT = await freePort();
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox",
  "--disable-gpu", "--window-size=4800,2600", "about:blank"], SPAWN_OPTS);

// Never leak a browser — critical here: this file uses top-level await, so a throw while
// measuring the page would otherwise orphan a browser tree per failed run.
const done = guardBrowser(proc, "inspect");

async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("no CDP endpoint");
}
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
// Readable form of a page exception: the message plus the top of the stack, with the
// source location. The raw CDP params were JSON-dumped and cut at 300 chars, which
// hid the message entirely ("Uncaught" with no reason) in the first version of this.
const fmtException = p => {
  const d = p.exceptionDetails || {};
  const lines = String(d.exception?.description ?? d.text ?? "").split("\n").slice(0, 4).map(s => s.trim());
  const at = d.url ? ` @ ${d.url.split("/").pop()}:${(d.lineNumber ?? 0) + 1}:${(d.columnNumber ?? 0) + 1}` : "";
  return `uncaught exception: ${lines.join(" | ")}${at}`;
};
const fmtConsole = p => `console.${p.type}: ${(p.args || []).map(a => a.value ?? a.description ?? a.type).join(" ")}`
  .slice(0, 400);
ws.onmessage = m => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method === "Runtime.exceptionThrown") logs.push(fmtException(msg.params));
  else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) logs.push(fmtConsole(msg.params));
};
const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetInfos } } = await send("Target.getTargets");
let page = targetInfos.find(t => t.type === "page");
if (!page) page = { targetId: (await send("Target.createTarget", { url: "about:blank" })).result.targetId };
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
await S("Page.navigate", { url: pathToFileURL(htmlPath).href });
const ev = async expr => (await S("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

const here = dirname(fileURLToPath(import.meta.url));
const BROWSER_SRC = readFileSync(join(here, "arch-browser.js"), "utf8").trim();
// Wait for the viewer, then audit the STATIC picture (what the PNG shows): flow overlay hidden.
for (let i = 0; i < 250; i++) { if (await ev("document.body?.getAttribute('data-arch-ready')==='1'")) break; await new Promise(r => setTimeout(r, 100)); }
await ev("document.documentElement.classList.add('arch-static')");
await new Promise(r => setTimeout(r, 600));

// Every check runs in the page (arch-browser.js); logs are the console lines collected above.
const res = await ev(`${BROWSER_SRC}.inspect(${JSON.stringify(logs)})`);
if (!res) { console.error("inspect-arch: the in-page check did not return a result"); done(1); }

// ARCH_DUMP=<file>: write the measured node rects + truncations as JSON, for harnesses
// (eval-arch-agent) that score a render against an expected layout.
if (process.env.ARCH_DUMP) writeFileSync(process.env.ARCH_DUMP, JSON.stringify(res.dump, null, 1));

for (const line of res.lines) console.log(line);
ws.close();
// Exit code: any COUNTED category with items (see arch-browser.js UNCOUNTED).
done(res.faults ? 1 : 0);
