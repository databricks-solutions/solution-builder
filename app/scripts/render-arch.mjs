#!/usr/bin/env node
/**
 * render-arch.mjs — render a standalone architecture HTML to a PNG, headless.
 *
 *   node render-arch.mjs <architecture.html | architecture.md> [out.png]
 *
 * Drives the lightweight `chromium-headless-shell` (or any Chrome/Chromium) via
 * the Chrome DevTools Protocol over a WebSocket — no puppeteer/playwright
 * package needed at render time, just the shell binary + node 18+ (built-in
 * WebSocket). Install the shell once with `npx playwright install
 * chromium-headless-shell`; this script auto-discovers it in the browser cache. It
 * loads the HTML (which renders the diagram from its inline JSON via the bundled
 * engine — the SAME engine as the app), waits for the viewer's ready signal
 * (`body[data-arch-ready]`), measures the drawn content, and screenshots it.
 *
 * This is the agent feedback loop: edit the inline JSON → render → read the PNG
 * → iterate.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { findChrome, freePort, guardBrowser, resolveArchInput, SPAWN_OPTS } from "./browser-lifecycle.mjs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The one copy of the in-page measurement (arch-browser.js, next to this script).
const BROWSER_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "arch-browser.js"), "utf8").trim();

// --- args -------------------------------------------------------------------
const [, , inArg, outArg] = process.argv;
if (!inArg) {
  console.error("usage: node render-arch.mjs <architecture.html | architecture.md> [out.png]");
  process.exit(1);
}
const inPath = isAbsolute(inArg) ? inArg : resolve(process.cwd(), inArg);
if (!existsSync(inPath)) { console.error(`not found: ${inPath}`); process.exit(1); }
// An architecture.md / .json is rendered through the bundled viewer (see resolveArchInput).
const { html: htmlPath, png: defaultPng } = resolveArchInput(inPath);
const outPath = outArg ? (isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg)) : defaultPng;

const chrome = findChrome();
if (!chrome) {
  console.error(
    "No Chrome/Chromium found. Install the lightweight headless shell once:\n" +
    "  npx playwright install chromium-headless-shell\n" +
    "or set CHROME_PATH=/path/to/chrome.",
  );
  process.exit(1);
}

// --- CDP helpers (raw WebSocket; node 18+ has global WebSocket) -------------
const PORT = await freePort();
const proc = spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", // crisp PNG
  "--window-size=2400,1600",
  "about:blank",
], SPAWN_OPTS);

// Never leak a browser: see browser-lifecycle.mjs for every exit path this covers.
const cleanup = guardBrowser(proc, "render");

async function getWsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

async function main() {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

  // Attach to a tab target.
  const { result: { targetInfos } } = await send("Target.getTargets");
  let target = targetInfos.find((t) => t.type === "page");
  if (!target) { const r = await send("Target.createTarget", { url: "about:blank" }); target = { targetId: r.result.targetId }; }
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });

  const S = (method, params) => send(method, params, sessionId);
  await S("Page.enable");
  await S("Runtime.enable");

  // Load the HTML.
  await S("Page.navigate", { url: pathToFileURL(htmlPath).href });

  // Wait for the viewer ready signal (body[data-arch-ready]) — or time out.
  const evalJs = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.result?.result?.value;
  };
  let ready = false;
  for (let i = 0; i < 150; i++) { // ~15s
    ready = await evalJs("document.body && document.body.getAttribute('data-arch-ready')==='1'");
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) console.error("warning: ready signal not seen; screenshotting anyway");
  // A static picture: drop the live flow-animation overlay (see globals.css
  // `arch-static`) so no particles/beads are captured mid-frame.
  await evalJs("document.documentElement.classList.add('arch-static')");
  await new Promise((r) => setTimeout(r, 300)); // let the final frame paint

  // Clip to the ACTUAL CONTENT BOUNDS — the renderer does not manufacture a
  // 16:9 or square image by padding a poor composition with whitespace. The
  // architecture itself must pass inspect-arch's presentation-aspect check.
  //
  // Nodes (incl. annotations) carry `.react-flow__node`; measuring their screen
  // rects and unioning them gives the visible frame directly, so we don't need
  // to undo the viewport transform here (unlike the in-app path, we clip in
  // screen space). Falls back to the `.react-flow` container box if there are no
  // measurable nodes (empty diagram).
  const PAD = 24; // screen px, mirrors export-image.ts's uniform pad intent
  // The measurement lives in arch-browser.js (shared with inspect-arch and the app's
  // render tool). It returns null only for a page with no container at all.
  const box = await evalJs(`${BROWSER_SRC}.contentBox(${PAD})`);

  // Output size: the window is rendered at device-scale 2 and the clip multiplies it again,
  // so the PNG is box × 2 × clip.scale. Target the LONG EDGE at ARCH_MAX_EDGE (default 1568,
  // the largest side a vision model reads at full detail; a 9000px PNG is downscaled 6x and
  // its 11px labels become unreadable), capped at 4x for small diagrams. Zoom in on detail
  // with a crop, not by raising this.
  const MAX_EDGE = Number(process.env.ARCH_MAX_EDGE || 1568);
  const totalScale = box && box.w > 1 && box.h > 1 ? Math.min(4, MAX_EDGE / Math.max(box.w, box.h)) : 2;
  const clip = box && box.w > 1 && box.h > 1
    ? { x: box.x, y: box.y, width: box.w, height: box.h, scale: totalScale / 2 }
    : undefined;

  const shot = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip } : {}) });
  const buf = Buffer.from(shot.result.data, "base64");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, buf);
  const aspectLabel = box?.aspect ? `, actual aspect ${box.aspect.toFixed(2)}:1` : "";
  console.log(`✓ rendered → ${outPath} (${(buf.length / 1024).toFixed(0)} KB${aspectLabel})`);
  ws.close();
  cleanup(0);
}

main().catch((e) => { console.error(e); cleanup(1); });
