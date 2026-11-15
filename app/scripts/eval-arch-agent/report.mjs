#!/usr/bin/env node
/**
 * report.mjs — turn an agent run's `claude -p --output-format stream-json` transcripts
 * into what a reviewer needs: what the agent read, ran and rendered, in order.
 *
 *   node scripts/eval-arch-agent/report.mjs <run-dir>
 *
 * Reads <run-dir>/transcript-<turn>.jsonl (one per user turn: the prompt, then each
 * follow-up) and writes:
 *   - <run-dir>/summary.json   the numbers: turns, cost, time, tool counts, the skill files
 *                              read (in order), renders, checker runs, errors, denials,
 *                              the loaded skills/plugins, the final reply.
 *   - <run-dir>/timeline.md    the conversation as a reader sees it: every assistant
 *                              message, every tool call (input shortened) and its result
 *                              (truncated), turn by turn.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: report.mjs <run-dir>"); process.exit(1); }

const files = readdirSync(dir).filter((f) => /^transcript-\d+\.jsonl$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + ` … [+${s.length - n} chars]` : s; };
const textOf = (c) => typeof c === "string" ? c : Array.isArray(c)
  ? c.map((b) => b.type === "text" ? b.text : b.type === "image" ? "[image]" : "").join("") : "";
// Paths are shown relative to the run dir so the timeline reads the same for every run.
// macOS resolves /tmp to /private/tmp: strip the long form first, or "/private" is left behind.
const rel = (s) => String(s ?? "").split(dir.replace(/^\/tmp/, "/private/tmp") + "/").join("").split(dir + "/").join("");
const skillFile = (p) => { const m = /skills\/([^/]+)\/(.+)$/.exec(p ?? ""); return m ? `${m[1]}/${m[2]}` : null; };

const summary = {
  turns: [], cost_usd: 0, duration_s: 0, model: null, skills_loaded: [], plugins_loaded: [],
  tool_calls: {}, skill_files_read: [], other_files_read: [], files_written: [], bash: [],
  renders: 0, render_faults: [], icon_searches: [], inspect_runs: 0, tool_errors: [], permission_denials: 0, final_reply: "",
};
const lines = [];

files.forEach((f, turn) => {
  const pending = new Map();
  let turnInfo = { turn: turn + 1, assistant_messages: 0 };
  lines.push(`\n## Turn ${turn + 1}\n`);
  for (const raw of readFileSync(join(dir, f), "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let m; try { m = JSON.parse(raw); } catch { continue; }
    if (m.type === "system" && m.subtype === "init") {
      summary.model = m.model;
      summary.skills_loaded = m.skills ?? [];
      summary.plugins_loaded = (m.plugins ?? []).map((p) => p.name);
    } else if (m.type === "user" && !Array.isArray(m.message?.content)) {
      lines.push(`**User:** ${clip(m.message?.content, 3000)}\n`);
    } else if (m.type === "assistant") {
      for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text.trim()) {
          turnInfo.assistant_messages++;
          summary.final_reply = b.text;
          lines.push(`**Agent:** ${b.text.trim()}\n`);
        } else if (b.type === "tool_use") {
          const i = b.input ?? {};
          summary.tool_calls[b.name] = (summary.tool_calls[b.name] ?? 0) + 1;
          let shown;
          if (b.name === "Read") {
            const sf = skillFile(i.file_path);
            (sf ? summary.skill_files_read : summary.other_files_read).push(sf ?? rel(i.file_path));
            shown = rel(i.file_path) + (i.offset ? ` @${i.offset}` : "");
          } else if (b.name === "Skill") {
            summary.skill_files_read.push(`${i.skill}/SKILL.md (Skill tool)`);
            shown = i.skill;
          } else if (b.name === "Write" || b.name === "Edit") {
            summary.files_written.push(rel(i.file_path));
            shown = `${rel(i.file_path)} (${b.name === "Write" ? `${String(i.content ?? "").length} chars` : "edit"})`;
          } else if (b.name === "Bash") {
            summary.bash.push(rel(i.command));
            if (/inspect-arch/.test(i.command ?? "")) summary.inspect_runs++;
            if (/render-arch/.test(i.command ?? "")) summary.renders++;
            for (const m of (i.command ?? "").matchAll(/grep(?:\s+-[\w-]+)*\s+["']?([^"'|;&]+?)["']?\s+[^|;&]*icons\.tsv/g)) summary.icon_searches.push(m[1]);
            // Skill files the command touches: `cat a b`, `sed -n`, `head` read them; `grep` searches.
            const cmd = i.command ?? "";
            const verb = /\b(cat|sed|head|tail|less|awk)\b/.test(cmd) ? "" : /\bgrep\b/.test(cmd) ? " (grep)" : null;
            if (verb !== null) {
              const seen = new Set();
              for (const m of cmd.matchAll(/(?:^|[\s/"'])((?:reference|renderer)\/[\w.-]+\.(?:md|jsonc|tsv|html|mjs))/g)) seen.add(m[1]);
              // After `cd …/databricks-architecture/reference` (or renderer) files are named bare.
              const dir = /cd\s+[^;&|]*databricks-architecture\/(reference|renderer)\b/.exec(cmd)?.[1];
              if (dir) for (const m of cmd.matchAll(/(?:^|[\s"'])([\w.-]+\.(?:md|jsonc|tsv|mjs))(?=[\s"';&|]|$)/g)) if (!/^my-arch/.test(m[1])) seen.add(`${dir}/${m[1]}`);
              for (const f of seen) summary.skill_files_read.push(`databricks-architecture/${f}${verb}`);
            }
            shown = "`" + clip(rel(i.command), 400) + "`";
          } else if (b.name === "Grep" || b.name === "Glob") {
            if (/icons\.tsv/.test(i.path ?? "") || /icons\.tsv/.test(i.glob ?? "")) summary.icon_searches.push(i.pattern);
            shown = `${i.pattern ?? ""} ${rel(i.path ?? "")}`.trim();
          } else if (b.name.endsWith("render_architecture")) {
            summary.renders++;
            shown = JSON.stringify(i);
          } else shown = clip(JSON.stringify(i), 300);
          pending.set(b.id, b.name);
          lines.push(`- **${b.name}** ${shown}`);
        }
      }
    } else if (m.type === "user") {
      for (const b of m.message.content) {
        if (b.type !== "tool_result") continue;
        const name = pending.get(b.tool_use_id) ?? "?";
        const text = textOf(b.content);
        if (b.is_error) summary.tool_errors.push(`${name}: ${clip(text, 200)}`);
        if (name.endsWith("render_architecture")) {
          const first = Array.isArray(b.content) ? (b.content.find((x) => x.type === "text")?.text ?? "") : text;
          try { const r = JSON.parse(first); for (const t of r.tabs ?? []) summary.render_faults.push((t.faults ?? []).length); } catch { /* not JSON */ }
        }
        // File reads are long and the reader already knows the file: show only errors.
        if (name === "Read" && !b.is_error) continue;
        lines.push(`  - ↳ ${b.is_error ? "**error** " : ""}${clip(rel(text).replace(/\n/g, " ⏎ "), name === "Bash" || name.endsWith("render_architecture") ? 900 : 300)}`);
      }
    } else if (m.type === "result") {
      summary.cost_usd += m.total_cost_usd ?? 0;
      summary.duration_s += Math.round((m.duration_ms ?? 0) / 1000);
      summary.permission_denials += Array.isArray(m.permission_denials) ? m.permission_denials.length : 0;
      turnInfo = { ...turnInfo, num_turns: m.num_turns, is_error: !!m.is_error, subtype: m.subtype, cost_usd: m.total_cost_usd };
      lines.push(`\n_turn ${turn + 1}: ${m.num_turns} steps, ${Math.round((m.duration_ms ?? 0) / 1000)} s, $${(m.total_cost_usd ?? 0).toFixed(2)}${m.is_error ? ", ERROR " + m.subtype : ""}_\n`);
    }
  }
  summary.turns.push(turnInfo);
});

summary.cost_usd = Math.round(summary.cost_usd * 100) / 100;
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(dir, "timeline.md"), `# Timeline\n\nSkills loaded: ${summary.skills_loaded.length} (${summary.skills_loaded.filter((s) => !/^(design|design-sync|dataviz|update-config|verify|debug|code-review|simplify|batch|fewer-permission-prompts|doctor|loop|claude-api|run|run-skill-generator|plugin-authoring)$/.test(s)).join(", ") || "built-ins only"}) · plugins: ${summary.plugins_loaded.join(", ")}\n` + lines.join("\n") + "\n");
console.log(`report: ${summary.turns.length} turn(s), $${summary.cost_usd}, ${summary.duration_s}s, skill files read: ${[...new Set(summary.skill_files_read)].length}, renders: ${summary.renders}, inspect: ${summary.inspect_runs}, tool errors: ${summary.tool_errors.length}, denials: ${summary.permission_denials}`);
