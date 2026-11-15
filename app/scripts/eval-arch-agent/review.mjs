#!/usr/bin/env node
/**
 * review.mjs — one page to review an agent batch: per prompt, the render, the score, what
 * the agent read and ran, its reply, and the whole conversation.
 *
 *   node scripts/eval-arch-agent/review.mjs <batch-dir>      → <batch-dir>/index.html
 *
 * run.ts calls it at the end of a batch. If batch.json names a `compare` batch, each card
 * shows the score delta against it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: review.mjs <batch-dir>"); process.exit(1); }
const read = (f, d = null) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
const batch = read(join(dir, "batch.json"), {});
const prev = batch.compare ? join(dirname(dir), batch.compare) : null;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");

const runs = readdirSync(dir).filter((d) => existsSync(join(dir, d, "result.json"))).map((d) => {
  const r = read(join(dir, d, "result.json"));
  const s = read(join(dir, d, "summary.json"), {});
  const p = prev ? read(join(prev, d, "result.json")) : null;
  return { ...r, summary: s, prevTotal: p?.score?.total ?? null,
    timeline: existsSync(join(dir, d, "timeline.md")) ? readFileSync(join(dir, d, "timeline.md"), "utf8") : "" };
}).sort((a, b) => (a.score?.total ?? -1) - (b.score?.total ?? -1));

const total = (k) => runs.reduce((n, r) => n + (r.summary?.[k] ?? 0), 0);
const mean = runs.filter((r) => r.score?.total != null);
const families = [...new Set(runs.map((r) => r.family))];

// Claude Code's own skills, present for every agent; anything else besides ours leaked in.
const BUILTIN = new Set(["design", "design-sync", "dataviz", "update-config", "verify", "debug", "code-review", "simplify", "batch", "fewer-permission-prompts", "doctor", "loop", "claude-api", "run", "run-skill-generator", "plugin-authoring"]);
const extraSkills = (s) => (s.skills_loaded ?? []).filter((k) => !BUILTIN.has(k) && k !== "databricks-architecture" && !(batchMode() === "app" && k === "databricks-solution-builder"));
const batchMode = () => batch.mode;
const card = (r) => {
  const s = r.summary ?? {}, sc = r.score ?? {};
  const delta = r.prevTotal != null && sc.total != null ? Math.round((sc.total - r.prevTotal) * 100) : null;
  const files = [...new Set(s.skill_files_read ?? [])].map((f) => f.replace("databricks-architecture/", ""));
  const parts = Object.entries(sc.parts ?? {}).map(([k, v]) => `<span class="${v < 1 ? "bad" : ""}">${k} ${pct(v)}</span>`).join(" ");
  return `<section class="run" data-family="${esc(r.family)}">
  <header><h2>${esc(r.id)} <small>${esc(r.family)}${r.style ? " · " + esc(r.style) : ""}</small></h2>
    <div class="score ${sc.total == null ? "none" : sc.total < 0.9 ? "low" : ""}">${r.output_file ? pct(sc.total) : "no diagram"}${delta != null && delta !== 0 ? ` <em class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta}</em>` : ""}</div></header>
  <p class="why">${esc(r.why)}</p>
  <blockquote>${esc(r.prompt)}${(r.followups ?? []).map((f) => `<br><b>then:</b> ${esc(f)}`).join("")}</blockquote>
  <div class="cols">
    <a class="img" href="${esc(r.id)}/_eval/arch.png" target="_blank">${existsSync(join(dir, r.id, "_eval/arch.png")) ? `<img loading="lazy" src="${esc(r.id)}/_eval/arch.png">` : "<i>no render</i>"}</a>
    <div class="facts">
      <div class="parts">${parts}</div>
      ${sc.missing?.length ? `<div class="bad">missing: ${esc(sc.missing.join(", "))}</div>` : ""}
      <table>
        <tr><th>cost / time</th><td>$${(s.cost_usd ?? 0).toFixed(2)} · ${s.duration_s ?? "?"} s · ${(s.turns ?? []).map((t) => t.num_turns).join("+")} steps</td></tr>
        <tr><th>context</th><td>${extraSkills(s).length ? `<b class=bad>${extraSkills(s).length} extra skills</b> (${esc(extraSkills(s).slice(0, 6).join(", "))}…)` : "databricks-architecture only"} + built-ins</td></tr>
        <tr><th>wrote</th><td>${esc(r.output_file ?? "—")}</td></tr>
        <tr><th>skill files read</th><td>${files.length ? files.map(esc).join("<br>") : "<b class=bad>none</b>"}</td></tr>
        <tr><th>renders · checks</th><td>${s.renders ?? 0} render · ${s.inspect_runs ?? 0} inspect</td></tr>
        <tr><th>tools</th><td>${esc(Object.entries(s.tool_calls ?? {}).map(([k, v]) => `${k} ${v}`).join(", "))}</td></tr>
        ${(s.tool_errors ?? []).length ? `<tr><th class=bad>tool errors</th><td>${(s.tool_errors).map(esc).join("<br>")}</td></tr>` : ""}
        ${s.permission_denials ? `<tr><th class=bad>denials</th><td>${s.permission_denials}</td></tr>` : ""}
      </table>
      <details><summary>final reply</summary><div class="reply">${esc(s.final_reply)}</div></details>
      <details><summary>conversation (${(s.bash ?? []).length} bash, ${Object.values(s.tool_calls ?? {}).reduce((a, b) => a + b, 0)} tool calls)</summary><pre>${esc(r.timeline)}</pre></details>
      <p class="links"><a href="${esc(r.id)}/timeline.md">timeline.md</a> · <a href="${esc(r.id)}/summary.json">summary.json</a> · <a href="${esc(r.id)}/_eval/score.json">score.json</a> · <a href="${esc(r.id)}/_eval/inspect.txt">inspect.txt</a> · <a href="${esc(r.id)}/${esc(r.output_file ?? "")}">output</a></p>
    </div>
  </div>
</section>`;
};

writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>arch agent · ${esc(batch.name)}</title>
<style>
body{font:14px/1.45 -apple-system,system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1b1f24}
.top{position:sticky;top:0;background:#fff;border-bottom:1px solid #dde;padding:12px 24px;z-index:2}
.top h1{font-size:18px;margin:0 0 4px} .top .meta{color:#555} .filters button{margin:6px 4px 0 0;border:1px solid #ccd;background:#fff;border-radius:12px;padding:2px 10px;cursor:pointer}
.filters button.on{background:#1b3139;color:#fff}
main{padding:16px 24px;display:grid;gap:16px}
.run{background:#fff;border:1px solid #e1e4e8;border-radius:8px;padding:14px 18px}
.run header{display:flex;justify-content:space-between;align-items:baseline} .run h2{font-size:16px;margin:0} .run h2 small{color:#777;font-weight:400}
.score{font-size:20px;font-weight:700;color:#137333} .score.low{color:#b06000} .score.none{color:#c5221f} .score em{font-size:13px;font-style:normal} .up{color:#137333} .down{color:#c5221f}
.why{color:#555;margin:2px 0 6px} blockquote{margin:0 0 10px;padding:6px 12px;border-left:3px solid #ff3621;background:#fafafa}
.cols{display:grid;grid-template-columns:minmax(0,3fr) minmax(320px,2fr);gap:16px} .img img{max-width:100%;border:1px solid #eee}
table{border-collapse:collapse;width:100%;margin:6px 0} th{text-align:left;color:#666;font-weight:500;vertical-align:top;padding:2px 8px 2px 0;white-space:nowrap} td{padding:2px 0}
.parts span{display:inline-block;margin:0 6px 4px 0;padding:1px 7px;border-radius:10px;background:#e6f4ea;font-size:12px} .parts span.bad{background:#fce8e6}
.bad{color:#c5221f} pre{white-space:pre-wrap;font-size:12px;max-height:600px;overflow:auto;background:#fafafa;padding:8px} .reply{white-space:pre-wrap;font-size:13px}
.links{font-size:12px;color:#666}
</style>
<div class="top"><h1>Architecture agent · ${esc(batch.name)}</h1>
<div class="meta">${runs.length} prompts · mode <b>${esc(batch.mode)}</b> · ${esc(batch.model)} · skill ${esc(batch.skill_hash)}${batch.dirty ? " (uncommitted)" : ""} @ ${esc(batch.git)}${batch.patch ? " · patch " + esc(batch.patch) : ""}${prev ? " · compared with " + esc(batch.compare) : ""}
 · mean ${pct(mean.reduce((n, r) => n + r.score.total, 0) / (mean.length || 1))} · ${runs.filter((r) => !r.output_file).length} without a diagram · $${total("cost_usd").toFixed(2)} · sorted worst first</div>
<div class="filters"><button class="on" data-f="">all</button>${families.map((f) => `<button data-f="${esc(f)}">${esc(f)}</button>`).join("")}</div></div>
<main>${runs.map(card).join("\n")}</main>
<script>for(const b of document.querySelectorAll(".filters button"))b.onclick=()=>{document.querySelectorAll(".filters button").forEach(x=>x.classList.toggle("on",x===b));document.querySelectorAll(".run").forEach(r=>r.style.display=!b.dataset.f||r.dataset.family===b.dataset.f?"":"none")}</script>`);
console.log(`review page: ${join(dir, "index.html")}`);
