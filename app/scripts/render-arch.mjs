#!/usr/bin/env node
/**
 * render-arch.mjs — render a standalone architecture HTML to a PNG, headless.
 *
 *   node render-arch.mjs <architecture.html> [out.png]
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
// Preferred: the lightweight `chromium-headless-shell` Playwright installs
// (~90MB shell, no full browser). Its cache layout is
//   <cache>/chromium_headless_shell-<rev>/chrome-headless-shell-<platform>/chrome-headless-shell
// We also fall back to a full Playwright chromium, then a system Chrome.
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  // 1) Playwright browsers cache — headless-shell first (lightest), then full chromium.
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    resolve(homedir(), "Library/Caches/ms-playwright"), // macOS
    resolve(homedir(), ".cache/ms-playwright"),          // linux
  ].filter(Boolean);
  // Executable names inside a browser dir, by platform folder.
  const shellRels = [
    "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-headless-shell-linux64/chrome-headless-shell",
    "chrome-headless-shell-win64/chrome-headless-shell.exe",
  ];
  const chromiumRels = [
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux/chrome",
    "chrome-win/chrome.exe",
  ];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const dirs = readdirSync(cache);
    // Prefer the newest headless-shell revision, then the newest chromium.
    const shellDirs = dirs.filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    const chromiumDirs = dirs.filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const dir of shellDirs)
      for (const rel of shellRels) { const p = resolve(cache, dir, rel); if (existsSync(p)) return p; }
    for (const dir of chromiumDirs)
      for (const rel of chromiumRels) { const p = resolve(cache, dir, rel); if (existsSync(p)) return p; }
  }

  // 2) A system Chrome/Chromium as a last resort.
  const system = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  for (const c of system) if (existsSync(c)) return c;
  return null;
}
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

  // Clip to the TIGHT CONTENT BOUNDS — the union of the rendered node elements'
  // screen rects (+ a small uniform pad), NOT the ReactFlow container. This
  // matches the in-app PNG/SVG export (export-image.ts) exactly: the output is
  // the diagram's true extent — no fitView dead margin, nothing cut off.
  //
  // Nodes (incl. annotations) carry `.react-flow__node`; measuring their screen
  // rects and unioning them gives the visible frame directly, so we don't need
  // to undo the viewport transform here (unlike the in-app path, we clip in
  // screen space). Falls back to the `.react-flow` container box if there are no
  // measurable nodes (empty diagram).
  const PAD = 24; // screen px, mirrors export-image.ts's uniform pad intent
  const box = await evalJs(`(() => {
    const pad = ${PAD};
    const nodes = document.querySelectorAll('.react-flow__node');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
    }
    if (Number.isFinite(minX)) {
      return { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad),
               w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    // Fallback: empty diagram — clip to the container so we still emit something.
    const el = document.querySelector('.react-flow');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height };
  })()`);

  // scale: 2 → crisp 2× render (mirrors the in-app export's pixelRatio: 2), so
  // the PNG stays sharp even when the diagram was fitView'd to a small on-screen
  // size. captureBeyondViewport lets the clip exceed the window if needed.
  const clip = box && box.w > 1 && box.h > 1
    ? { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 }
    : undefined;

  const shot = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip } : {}) });
  const buf = Buffer.from(shot.result.data, "base64");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, buf);
  console.log(`✓ rendered → ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  ws.close();
  cleanup(0);
}

main().catch((e) => { console.error(e); cleanup(1); });
