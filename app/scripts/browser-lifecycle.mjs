/**
 * browser-lifecycle.mjs — find a headless Chrome, and never leak one.
 *
 * Shared by render-arch.mjs and inspect-arch.mjs. No dependencies: these tools
 * deliberately drive CDP over a raw WebSocket rather than pulling in puppeteer or
 * playwright, so this stays plain node.
 *
 * `guardBrowser(proc)` is the important half. A headless Chrome is ~4 processes and
 * ~300MB, and it will happily outlive its launcher unless every exit path is covered:
 *
 *   • `proc.kill()` signals only the shell — chrome forks gpu / network / renderer
 *     helpers, so we kill the whole process GROUP (hence `detached: true` on spawn,
 *     which makes the browser its own group leader so `kill(-pid)` reaches the helpers);
 *   • handling only SIGINT is not enough — a harness timeout sends SIGTERM and a closed
 *     terminal sends SIGHUP;
 *   • a throw before the happy path never reaches cleanup at all. This bites hardest
 *     in inspect-arch.mjs, which uses top-level await and measures DOM internals: one
 *     renamed CSS class means one orphaned browser tree per failed run, and an
 *     iteration loop can put a laptop on its knees;
 *   • SIGKILL runs no handler whatsoever, so a detached watchdog holds a pipe whose
 *     write end is the launcher. When the launcher dies for ANY reason the kernel closes
 *     it, the watchdog reads EOF and reaps the browser group. (Polling the launcher's PID
 *     instead leaks an immortal helper as soon as that PID is recycled.)
 *   • a hung page or CDP handshake would otherwise hold a browser forever, so there is
 *     a hard cap: ARCH_TIMEOUT_MS, default 180000.
 *
 * Sweep any survivors from older versions with:
 *   pkill -f 'ms-playwright.*chrome-headless-shell'
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

/**
 * Locate a browser: the lightweight `chromium-headless-shell` Playwright installs
 * (~90MB) first, then a full Playwright chromium, then a system Chrome. Honours
 * CHROME_PATH and PLAYWRIGHT_BROWSERS_PATH.
 */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    resolve(homedir(), "Library/Caches/ms-playwright"), // macOS
    resolve(homedir(), ".cache/ms-playwright"),         // linux
  ].filter(Boolean);
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
    const shellDirs = dirs.filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    const chromiumDirs = dirs.filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const dir of shellDirs)
      for (const rel of shellRels) { const p = resolve(cache, dir, rel); if (existsSync(p)) return p; }
    for (const dir of chromiumDirs)
      for (const rel of chromiumRels) { const p = resolve(cache, dir, rel); if (existsSync(p)) return p; }
  }

  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ]) if (existsSync(c)) return c;

  return null;
}

/** Spawn options every launcher must use, so the browser is its own process group. */
// In the Solution Builder Apps container, start.sh unpacks Chromium's missing shared
// libs into a private dir and exports it as BROWSER_LD_LIBRARY_PATH (never as
// LD_LIBRARY_PATH, so nothing else loads them). Only the browser child gets it.
const browserEnv = process.env.BROWSER_LD_LIBRARY_PATH
  ? { ...process.env, LD_LIBRARY_PATH: process.env.BROWSER_LD_LIBRARY_PATH }
  : process.env;
export const SPAWN_OPTS = { stdio: "ignore", detached: true, env: browserEnv };

/**
 * Guarantee the browser dies with us, whatever happens. Returns `cleanup(code?)`:
 * call it with a number to exit, or with nothing to just reap.
 *
 * @param {import("node:child_process").ChildProcess} proc  browser spawned with SPAWN_OPTS
 * @param {string} label  used in the timeout message, e.g. "render"
 */
export function guardBrowser(proc, label = "run") {
  // Detached watchdog: survives SIGKILL of this process, reaps on pipe EOF.
  const watchdog = spawn(process.execPath, ["-e", `
    const group = ${proc.pid};
    const reap = () => { try { process.kill(-group, "SIGKILL"); } catch {} process.exit(0); };
    process.stdin.resume();
    process.stdin.on("end", reap);
    process.stdin.on("close", reap);
    process.stdin.on("error", reap);
    setTimeout(reap, 30 * 60 * 1000); // never outlive a session
  `], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
  watchdog.unref();

  let cleaned = false;
  const cleanup = (code) => {
    if (!cleaned) {
      cleaned = true;
      try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} }
      try { watchdog.kill("SIGKILL"); } catch {}
    }
    if (typeof code === "number") process.exit(code);
  };

  process.on("exit", () => cleanup());
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => cleanup(130));
  process.on("uncaughtException", (e) => { console.error(e); cleanup(1); });
  process.on("unhandledRejection", (e) => { console.error(e); cleanup(1); });

  const TIMEOUT_MS = Number(process.env.ARCH_TIMEOUT_MS || 180000);
  setTimeout(() => { console.error(`${label} timed out after ${TIMEOUT_MS}ms`); cleanup(1); }, TIMEOUT_MS).unref();

  return cleanup;
}

/**
 * Accept a diagram as an HTML page OR as the raw file (`architecture.md` with its
 * fenced json, or a `.json`). For the raw file, inject it into the viewer that sits
 * next to this script (the skill's renderer/, or app/dist-standalone when run from
 * app/scripts) and return that temp page — written to the OS temp dir, never next to
 * the input, so a project folder doesn't sprout files its watcher would sync.
 * `png` is the default output path: `architecture.md` → `architecture.png`.
 */
export function resolveArchInput(inPath) {
  if (/\.html?$/i.test(inPath)) return { html: inPath, png: inPath.replace(/\.html?$/i, "") + ".png" };
  const page = join(mkdtempSync(join(tmpdir(), "arch-")), "architecture.html");
  writeFileSync(page, embedDiagram(readDiagram(inPath), "viewer"));
  return { html: page, png: inPath.replace(/\.(md|json)$/i, "") + ".png" };
}

/** The diagram in a raw file: `architecture.md` (its fenced json) or a `.json`. */
export function readDiagram(inPath) {
  const text = readFileSync(inPath, "utf8");
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(text);
  return JSON.parse(fence ? fence[1] : text);
}

/** A standalone page (`editor` or `viewer`, next to this script or in
 *  app/dist-standalone) with `doc` as its inline JSON. */
export function embedDiagram(doc, kind = "editor") {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [join(here, `architecture-${kind}.html`), join(here, `../dist-standalone/architecture-${kind}.html`)]
    .find((f) => existsSync(f));
  if (!file) throw new Error(`architecture-${kind}.html not found next to the renderer`);
  return readFileSync(file, "utf8").replace(
    /(<script[^>]*type="application\/json"[^>]*id="architecture"[^>]*>)[\s\S]*?(<\/script>)/,
    (_m, a, b) => a + JSON.stringify(doc).replace(/</g, "\\u003c") + b);
}

/** A port the OS says is free right now, for the browser's --remote-debugging-port.
 *  A time-derived port (the old way) collides when several renders start together, and
 *  a colliding run silently drives the OTHER run's browser — screenshotting and
 *  measuring someone else's diagram. */
export function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}
