#!/usr/bin/env node
/**
 * render-arch.mjs — render a standalone architecture HTML to a PNG, headless.
 *
 *   node render-arch.mjs <architecture.html> [out.png]
 *
 * Drives an already-installed headless Chromium via the Chrome DevTools
 * Protocol over a WebSocket — NO npm install, NO playwright/puppeteer package.
 * Needs only: node 18+ (built-in WebSocket) + a Chrome/Chromium binary. It
 * loads the HTML (which renders the diagram from its inline JSON via the bundled
 * engine — the SAME engine as the app), waits for the viewer's ready signal
 * (`body[data-arch-ready]`), measures the drawn content, and screenshots it.
 *
 * This is the agent feedback loop: edit the inline JSON → render → read the PNG
 * → iterate.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

// --- args -------------------------------------------------------------------
const [, , inArg, outArg] = process.argv;
if (!inArg) {
  console.error("usage: node render-arch.mjs <architecture.html> [out.png]");
  process.exit(1);
}
const htmlPath = isAbsolute(inArg) ? inArg : resolve(process.cwd(), inArg);
if (!existsSync(htmlPath)) { console.error(`not found: ${htmlPath}`); process.exit(1); }
const outPath = outArg
  ? (isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg))
  : htmlPath.replace(/\.html?$/i, "") + ".png";

// --- find a Chrome/Chromium binary -----------------------------------------
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // Playwright-installed browsers cache (headless_shell or full chromium).
  const cache = resolve(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      for (const rel of [
        "chrome-mac/headless_shell",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/headless_shell",
        "chrome-linux/chrome",
      ]) {
        const p = resolve(cache, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}
const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome/Chromium found. Set CHROME_PATH=/path/to/chrome, or install Chrome,\nor run `npx playwright install chromium` once.");
  process.exit(1);
}

// --- CDP helpers (raw WebSocket; node 18+ has global WebSocket) -------------
const PORT = 9300 + Math.floor((Date.now() % 600)); // vary to avoid clashes
const proc = spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", // crisp PNG
  "--window-size=2400,1600",
  "about:blank",
], { stdio: "ignore" });

function cleanup(code) { try { proc.kill(); } catch {} process.exit(code); }
process.on("SIGINT", () => cleanup(130));

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
  await new Promise((r) => setTimeout(r, 300)); // let the final frame paint

  // Clip to the ReactFlow CONTAINER (the framed window). The diagram is fitView'd
  // into it on load, so the container shows the whole diagram nicely padded. (We
  // must NOT clip to `.react-flow__viewport` — that's the inner transformed layer
  // whose bounding box is the panned/zoomed extent, not the visible frame.)
  const box = await evalJs(`(() => {
    const el = document.querySelector('.react-flow');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height };
  })()`);

  const clip = box && box.w > 1 && box.h > 1
    ? { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 }
    : undefined;

  const shot = await S("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : { captureBeyondViewport: true }) });
  const buf = Buffer.from(shot.result.data, "base64");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, buf);
  console.log(`✓ rendered → ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  ws.close();
  cleanup(0);
}

main().catch((e) => { console.error(e); cleanup(1); });
