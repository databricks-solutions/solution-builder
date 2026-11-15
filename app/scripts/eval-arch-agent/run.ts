#!/usr/bin/env bun
/**
 * eval:arch-agent — send prompts from the collection to an isolated agent, keep its whole
 * conversation, score what it drew, and build one review page for the batch.
 *
 *   bun run eval:arch-agent -- [selection] [options]
 *
 * Selection (combine freely; default: every committed prompt):
 *   --suite marketing,networking   prompt files in test/architecture/prompts/ (by file name)
 *   --id mkt-fraud-bank,net-png-aws
 *   --private                      add the image cases in test/architecture/private/ (gitignored)
 *   --private-only                 only those
 * Options:
 *   --mode skill|app   skill (default): the agent gets ONLY the databricks-architecture skill
 *                      (standalone flavour, renderer/ included) and the raw prompt, nothing
 *                      else. app: what Solution Builder does — the app's skill copy, system
 *                      prompt, opening-message builder and render_architecture tool.
 *   --name <batch>     output folder name (default: a timestamp)
 *   -j <n>             parallel runs (default 3)
 *   --model <m>        default opus
 *   --patch <script>   bash script run on each project before the agent starts ($1 = project
 *                      dir): A/B a skill change without touching the repo
 *   --compare <batch>  show the score delta against an earlier batch on the review page
 *   --dry-run          prepare every project and write its prompt.txt, start no agent
 *   --rescore <batch>  re-extract and re-score an existing batch with the current scorer and
 *                      the current `expect` blocks; no agent runs. Rebuilds its review page.
 *
 * Isolation: CLAUDE_CONFIG_DIR is the project's own .claude (as the app sets it), so the
 * developer's plugins, skills, hooks, CLAUDE.md and memory never load; an empty
 * DATABRICKS_CONFIG_FILE and no DATABRICKS_* variables keep it off real workspaces. Claude Code's
 * built-in skills and plugins still do; every Claude Code agent has those.
 *
 * Output: $ARCH_EVAL_RUNS (default /tmp/arch-eval)/<batch>/
 *   batch.json, index.html (the review page), and per prompt <id>/: the project the agent
 *   worked in, transcript-<turn>.jsonl, timeline.md, summary.json, _eval/{diagram.json,
 *   arch.png, score.json, inspect.txt}, result.json.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { BRAND_NOTE, buildArchitectureFirstPrompt, buildUploadsNote, type DiagramStyle } from "../../src/demo_prompt_generator/ui/lib/auto-build-prompt";

const APP = join(import.meta.dir, "../..");
const REPO = join(APP, "..");
const HERE = import.meta.dir;
const SKILL = join(REPO, ".claude/skills/databricks-architecture");
const PROMPTS = join(APP, "test/architecture/prompts");
const PRIVATE = process.env.ARCH_PRIVATE_CASES ?? join(APP, "test/architecture/private");

// ── args ────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const opt = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const list = (k: string) => opt(k)?.split(",").map((s) => s.trim()).filter(Boolean);
const rescore = opt("--rescore");
const mode = (rescore ? JSON.parse(readFileSync(join(process.env.ARCH_EVAL_RUNS ?? "/tmp/arch-eval", rescore, "batch.json"), "utf8")).mode : opt("--mode", "skill")) as "skill" | "app";
if (!["skill", "app"].includes(mode)) throw new Error(`--mode must be skill or app, got ${mode}`);
const batch = rescore ?? opt("--name", new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-"))!;
const jobs = Number(opt("-j", "3"));
const model = opt("--model", "opus")!;
const patch = opt("--patch");
const compare = opt("--compare");
const RUNS = join(process.env.ARCH_EVAL_RUNS ?? "/tmp/arch-eval", batch);

// ── the prompt collection ───────────────────────────────────────────────────────────
type Entry = { id: string; family: string; style?: DiagramStyle; styleInPrompt?: boolean; prompt: string; followups?: string[];
  source?: string; caseDir?: string; why?: string; expect: Record<string, unknown> };
const load = (everything = false): Entry[] => {
  const out: Entry[] = [];
  if (everything || !flag("--private-only")) {
    for (const f of readdirSync(PROMPTS).filter((f) => f.endsWith(".json")).sort()) {
      for (const e of JSON.parse(readFileSync(join(PROMPTS, f), "utf8"))) out.push({ ...e, family: basename(f, ".json") });
    }
  }
  if ((everything || flag("--private") || flag("--private-only")) && existsSync(PRIVATE)) {
    for (const d of readdirSync(PRIVATE).sort()) {
      const c = join(PRIVATE, d, "case.json");
      if (existsSync(c)) out.push({ ...JSON.parse(readFileSync(c, "utf8")), family: "private", caseDir: join(PRIVATE, d) });
    }
  }
  const ids = new Set(out.map((e) => e.id));
  if (ids.size !== out.length) throw new Error("duplicate prompt ids in the collection");
  if (everything) return out;
  const suites = list("--suite"), only = list("--id");
  return out.filter((e) => (!suites || suites.includes(e.family) || e.family === "private") && (!only || only.includes(e.id)));
};

// ── one run ─────────────────────────────────────────────────────────────────────────
const sh = (cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; stdout?: string; timeoutMs?: number } = {}) =>
  new Promise<number>((res) => {
    const out = o.stdout ? Bun.file(o.stdout).writer() : null;
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", (d) => out ? out.write(d) : process.stdout.write(d));
    p.stderr.on("data", (d) => { err += d; });
    const t = o.timeoutMs ? setTimeout(() => p.kill("SIGTERM"), o.timeoutMs) : null;
    p.on("close", async (code) => { if (t) clearTimeout(t); await out?.end(); if (code && err) writeFileSync(join(o.cwd ?? "/tmp", `stderr-${Date.now()}.txt`), err); res(code ?? 1); });
  });

function prepare(e: Entry, P: string): { prompt: string; system?: string } {
  rmSync(P, { recursive: true, force: true });
  mkdirSync(P, { recursive: true });
  const img = e.source && e.caseDir ? join(e.caseDir, e.source) : null;
  if (mode === "skill") {
    mkdirSync(join(P, ".claude/skills"), { recursive: true });
    cpSync(SKILL, join(P, ".claude/skills/databricks-architecture"), { recursive: true });
    if (img) cpSync(img, join(P, e.source!));
    // The raw prompt, as a user would type it. An image is referenced by its path.
    return { prompt: e.prompt + (img ? `\n\nThe image: ./${e.source}` : "") };
  }
  // app mode: the app's own project setup (skill copy + localization + system prompt).
  execFileSync(join(APP, ".venv/bin/python"), ["-I", join(HERE, "prepare.py"), join(P, ".."), basename(P)], { cwd: "/tmp" });
  if (img) { mkdirSync(join(P, "context/uploads"), { recursive: true }); cpSync(img, join(P, "context/uploads", e.source!)); }
  const style: DiagramStyle = e.style ?? (img ? "match" : "marketing");
  writeFileSync(join(P, "mcp.json"), JSON.stringify({ mcpServers: { arch: { command: join(APP, ".venv/bin/python"), args: ["-I", join(HERE, "arch_mcp_stdio.py"), P] } } }));
  return {
    prompt: buildArchitectureFirstPrompt(e.prompt, style) +
      (img ? buildUploadsNote([{ filename: e.source!, content_type: "image/png", truncated: false }]) : "") + `\n\n${BRAND_NOTE}`,
    system: readFileSync(join(P, "system-prompt.txt"), "utf8"),
  };
}

/** The diagram the agent produced: architecture.md in app mode; in skill mode the newest
 *  file outside .claude that carries diagram JSON (an HTML's inline block, a ```json
 *  fence, or a bare JSON array of tabs). */
function extract(P: string): { file: string; doc: unknown } | null {
  const parse = (f: string) => {
    const s = readFileSync(f, "utf8");
    const html = /<script[^>]*id="architecture"[^>]*>([\s\S]*?)<\/script>/.exec(s);
    const fence = /```json\s*\n([\s\S]*?)\n```/.exec(s);
    try {
      const doc = JSON.parse(html ? html[1] : fence ? fence[1] : s);
      const tabs = Array.isArray(doc) ? doc : (doc as { tabs?: unknown[] }).tabs ?? [doc];
      return (tabs[0] as { nodes?: unknown[] })?.nodes ? doc : null;
    } catch { return null; }
  };
  if (mode === "app") { const f = join(P, "architecture.md"); return existsSync(f) ? { file: "architecture.md", doc: parse(f) } : null; }
  const found: { f: string; t: number }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if ([".claude", "_eval", "node_modules"].includes(n)) continue;
      if (statSync(f).isDirectory()) walk(f);
      else if ([".html", ".md", ".json"].includes(extname(n)) && !/^(transcript|summary|result|timeline|expected)/.test(n)) found.push({ f, t: statSync(f).mtimeMs });
    }
  };
  walk(P);
  // Only what the agent wrote: files last modified before its final transcript closed.
  // Anything newer is the harness's own output (a scorer dump also carries nodes).
  const end = Math.max(...readdirSync(P).filter((n) => /^transcript-\d+\.jsonl$/.test(n)).map((n) => statSync(join(P, n)).mtimeMs), 0);
  for (const { f } of found.filter((x) => x.t <= end).sort((a, b) => b.t - a.t)) { const doc = parse(f); if (doc) return { file: relative(P, f), doc }; }
  return null;
}

async function runOne(e: Entry): Promise<Record<string, unknown>> {
  const P = join(RUNS, e.id);
  const { prompt, system } = prepare(e, P);
  if (patch) execFileSync("bash", [patch, P]);
  const expect = { kind: "text", ...e.expect, ...(e.style && !e.expect.style ? { style: e.style } : {}) };
  writeFileSync(join(P, "expected.json"), JSON.stringify(expect, null, 2));
  writeFileSync(join(P, "prompt.txt"), [prompt, ...(e.followups ?? []).map((f, i) => `--- follow-up ${i + 1} ---\n${f}`)].join("\n\n"));
  if (flag("--dry-run")) { console.log(`· ${e.id.padEnd(34)} prepared (${mode}) → ${P}`); return { id: e.id }; }
  // No access to the developer's Databricks workspaces: an empty CLI config and no
  // DATABRICKS_* variables, so `databricks … -p DEFAULT` fails instead of reading (or
  // changing) a real workspace. (full-r3: an agent built a whole demo and listed the
  // developer's warehouses, catalogs and dashboards through their DEFAULT profile.)
  writeFileSync(join(P, ".databrickscfg"), "");
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: join(P, ".claude"), DATABRICKS_CONFIG_FILE: join(P, ".databrickscfg") };
  for (const k of Object.keys(env)) if (k.startsWith("DATABRICKS_") && k !== "DATABRICKS_CONFIG_FILE") delete env[k];
  delete env.CLAUDECODE; // a nested session refuses to start otherwise
  const base = ["--output-format", "stream-json", "--verbose", "--model", model, "--strict-mcp-config",
    "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash" + (mode === "app" ? ",mcp__arch__render_architecture" : ""),
    ...(mode === "app" ? ["--append-system-prompt", system!, "--mcp-config", join(P, "mcp.json")] : [])];
  const turns = [prompt, ...(e.followups ?? [])];
  const t0 = Date.now();
  let session: string | undefined;
  for (let i = 0; i < turns.length; i++) {
    const tr = join(P, `transcript-${i + 1}.jsonl`);
    const code = await sh("claude", ["-p", turns[i], ...base, ...(session ? ["--resume", session] : [])], { cwd: P, env, stdout: tr, timeoutMs: 20 * 60_000 });
    if (code) console.log(`  ${e.id}: turn ${i + 1} exited ${code}`);
    session ??= readFileSync(tr, "utf8").split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } }).find((m) => m.session_id)?.session_id;
  }
  return finish(e, P, Math.round((Date.now() - t0) / 1000));
}

/** Everything after the agent: the report, the diagram it drew, the score, result.json. */
async function finish(e: Entry, P: string, seconds: number): Promise<Record<string, unknown>> {
  await sh("node", [join(HERE, "report.mjs"), P], { stdout: join(P, "report.txt") });
  // The style is scored when the agent was told it: always in app mode (the style picker
  // sends it), in skill mode only when the prompt text names it.
  const scoreStyle = mode === "app" || e.styleInPrompt || e.family === "private";
  const expect = { kind: "text", ...e.expect, ...(e.style && !e.expect.style && scoreStyle ? { style: e.style } : {}) };
  writeFileSync(join(P, "expected.json"), JSON.stringify(expect, null, 2));
  rmSync(join(P, "_eval"), { recursive: true, force: true });
  const got = extract(P);
  let score: Record<string, unknown> | null = null;
  if (got) {
    mkdirSync(join(P, "_eval"), { recursive: true });
    writeFileSync(join(P, "_eval/diagram.json"), JSON.stringify(got.doc));
    await sh("node", [join(HERE, "score.mjs"), join(P, "expected.json"), P], { stdout: join(P, "score.txt") });
    if (existsSync(join(P, "_eval/score.json"))) score = JSON.parse(readFileSync(join(P, "_eval/score.json"), "utf8"));
  }
  const result = { id: e.id, family: e.family, style: e.style, prompt: e.prompt, followups: e.followups ?? [], why: e.why,
    output_file: got?.file ?? null, score, seconds };
  writeFileSync(join(P, "result.json"), JSON.stringify(result, null, 2));
  const s = score as { total?: number } | null;
  console.log(`✓ ${e.id.padEnd(34)} ${s?.total != null ? Math.round(s.total * 100) + "%" : "NO DIAGRAM"}  ${result.seconds}s`);
  return result;
}

// ── batch ───────────────────────────────────────────────────────────────────────────
if (rescore) {
  const known = new Map(load(true).map((e) => [e.id, e]));
  const ids = readdirSync(RUNS).filter((d) => existsSync(join(RUNS, d, "result.json")));
  console.log(`rescoring ${ids.length} run(s) in ${RUNS} (mode ${mode})`);
  for (const id of ids) {
    const old = JSON.parse(readFileSync(join(RUNS, id, "result.json"), "utf8"));
    const e = known.get(id) ?? { ...old, expect: JSON.parse(readFileSync(join(RUNS, id, "expected.json"), "utf8")) };
    await finish(e, join(RUNS, id), old.seconds ?? 0);
  }
  await sh("node", [join(HERE, "review.mjs"), RUNS]);
  process.exit(0);
}
const entries = load();
if (!entries.length) throw new Error("no prompt matches the selection");
if (!existsSync(join(APP, "dist-standalone/architecture-viewer.html"))) throw new Error("run `bun run build:arch-standalone` first (the scorer renders through it)");
mkdirSync(RUNS, { recursive: true });
const skillHash = createHash("sha1");
const hashDir = (d: string) => { for (const n of readdirSync(d).sort()) { const f = join(d, n); statSync(f).isDirectory() ? hashDir(f) : skillHash.update(n).update(readFileSync(f)); } };
hashDir(join(SKILL, "reference")); skillHash.update(readFileSync(join(SKILL, "SKILL.md")));
const git = (a: string[]) => { try { return execFileSync("/usr/bin/git", a, { cwd: REPO, encoding: "utf8" }).trim(); } catch { return ""; } };
writeFileSync(join(RUNS, "batch.json"), JSON.stringify({ name: batch, mode, model, patch: patch ?? null, compare: compare ?? null,
  started: new Date().toISOString(), git: git(["rev-parse", "--short", "HEAD"]), dirty: git(["status", "--porcelain", "--", ".claude/skills/databricks-architecture"]) !== "",
  skill_hash: skillHash.digest("hex").slice(0, 10), ids: entries.map((e) => e.id) }, null, 2));
console.log(`batch ${batch}: ${entries.length} prompt(s), mode ${mode}, model ${model}, ${jobs} at a time → ${RUNS}`);

const queue = [...entries];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  for (let e = queue.shift(); e; e = queue.shift()) {
    try { await runOne(e); } catch (err) { console.log(`✗ ${e.id}: ${(err as Error).message}`); }
  }
}));
if (!flag("--dry-run")) await sh("node", [join(HERE, "review.mjs"), RUNS]);
