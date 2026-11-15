#!/usr/bin/env node
// The skill's reference diagrams, for the /architecture-showcase page's "Skill references"
// view: one item per .claude/skills/databricks-architecture/reference/*.jsonc, with its header
// comment as the description and the diagram verbatim (comments stripped).
//   node scripts/gen-showcase-references.mjs        (run by build:arch-skill)
// Writes src/demo_prompt_generator/ui/public/architecture-references.json. Never edit it by hand.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = join(HERE, "../../.claude/skills/databricks-architecture/reference");
const OUT = join(HERE, "../src/demo_prompt_generator/ui/public/architecture-references.json");

const NETWORK = /png|psc|privatelink|tunnel|pls|appgw|networking|cdc-|onprem/;
const LIFECYCLE = /lifecycle|phase-relay/;

const items = readdirSync(REF).filter((f) => f.endsWith(".jsonc")).sort().map((f) => {
  const src = readFileSync(join(REF, f), "utf8");
  const tabs = JSON.parse(src.replace(/^\s*\/\/.*$/gm, ""));
  const id = f.replace(/\.jsonc$/, "");
  const first = tabs[0] ?? {};
  // The header: the comment block before the JSON, without the ==== rules and the
  // "emit plain JSON" boilerplate every file repeats.
  const header = src.split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, ""))
    .filter((l) => !/^=+$/.test(l.trim()) && !/JSONC for you to read|emit PLAIN JSON|architecture\.md\. The renderer parses/.test(l))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const style = id.startsWith("style-") ? id.slice(6)
    : NETWORK.test(id) ? "networking"
    : LIFECYCLE.test(id) ? "lifecycle"
    : first.theme === "technical" ? "technical" : "marketing";
  return {
    id: `ref-${id}`,
    source: "reference",
    file: `reference/${f}`,
    title: first.frame?.title ?? first.name ?? id,
    style,
    tabs: tabs.length,
    prompt: header,
    architecture: "```json\n" + JSON.stringify(tabs, null, 2) + "\n```\n",
  };
});

writeFileSync(OUT, JSON.stringify({ generated: "scripts/gen-showcase-references.mjs", items }, null, 1) + "\n");
console.log(`showcase references: ${items.length} → ${OUT.replace(join(HERE, "../"), "")}`);
