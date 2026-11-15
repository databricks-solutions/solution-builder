/**
 * eval-arch — the architecture-diagram quality harness.
 *
 *   cd app
 *   bun run build:arch-standalone     # the harness renders through this artifact
 *   bun run eval:arch                 # score the corpus, gate on the baseline
 *   bun run eval:arch -- --update     # accept the current scores as the baseline
 *
 * WHY THIS EXISTS. Every diagram-quality change so far was judged by eyeballing a
 * PNG, and three separate times the measuring instrument turned out to be the
 * broken thing: a corpus of hand-tuned diagrams that could not show a regression,
 * a crossing check that missed the common case, and an offline harness whose
 * geometry drifted from the browser. This makes the measurement a committed,
 * reviewable artifact instead of a judgement call.
 *
 * WHAT IT SCORES, per corpus diagram:
 *   • CONTENT  — `validateArchitecture()` (the existing pure integrity check:
 *     dangling refs, unknown types, bad handles, duplicate ids). Not reimplemented
 *     here; this harness just holds it to a number.
 *   • GEOMETRY — `inspect-arch.mjs` in a headless browser: node/label overlaps,
 *     box straddle, labels on tiles, edges through tiles, clipped text, console
 *     errors. The BROWSER is the authority for geometry — never an offline model
 *     of it (see scripts/probe-edge-crossings.ts's header for why).
 *   • LABEL QUALITY — the one genuinely new measure: how many edge labels are
 *     GENERIC ("data", "sync", "query" — a label that carries no information is
 *     as bad as no label) and how many exceed the ~75-char wrap budget, past
 *     which text is ellipsized and lost in an exported PNG.
 *
 * THE CORPUS IS DELIBERATELY HOSTILE. `corpus/*.json` holds cases built to fail:
 * prose on every edge, edges spanning several lanes, tight rows. The four skill
 * reference diagrams are scored too, but on their own they prove nothing — they
 * were hand-tuned until clean, so they can only catch a REGRESSION, never
 * demonstrate an improvement. Add hard cases, not tidy ones.
 *
 * NOT COVERED (be honest about the gap): this scores diagrams that already exist.
 * It does NOT drive the agent to generate one from a prompt, so it cannot measure
 * required-component recall or whether the agent chose sensible components. That
 * needs generation plumbing (model calls, cost, flakiness) and is the natural
 * next step; the scoring side is built so it can be pointed at generated output.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";

import { validateArchitecture } from "../src/demo_prompt_generator/ui/lib/platform-architecture";

const HERE = import.meta.dir;
const APP = join(HERE, "..");
const REPO = join(APP, "..");
const CORPUS = join(HERE, "eval-arch/corpus");
const REF = join(REPO, ".claude/skills/databricks-architecture/reference");
const VIEWER = join(APP, "dist-standalone/architecture-viewer.html");
const RESULTS = join(HERE, "eval-arch/results");
const BASELINE = join(HERE, "eval-arch/baseline.json");
const INSPECT = join(HERE, "inspect-arch.mjs");

// --- label quality ----------------------------------------------------------

/** A label that carries no information is as useless as no label. Mirrors the
 *  spirit of the "keep it to a few words" rule while catching the opposite
 *  failure: words that say nothing. */
const GENERIC = /^(data|access|connection|connects?|sync|async|query|queries|read|reads|write|writes|load|loads|send|sends|call|calls|api|events?|logs?|telemetry|monitoring|request|response|input|output|flow)$/i;
/** 3 lines x ~25 chars. Past this the pill ellipsizes and the remainder is only
 *  reachable via a tooltip — invisible in an exported PNG. */
const MAX_LABEL_CHARS = 75;
/** A LEGEND KEY, not a lazy label: "1", "12", "D1", "3a". reference/complex-workflows.md's Option 2
 *  prescribes exactly this (number the edges, put the sentences in a legend), so
 *  scoring it as uninformative would penalise the recommended pattern — which is
 *  what the first version of this metric did to the numbered-legend corpus case. */
const MARKER = /^[A-Z]{0,2}\d{1,3}[a-z]?$/;

/** A label that carries no information is as useless as no label — but a legend
 *  MARKER carries its information in the legend, and a short technical acronym
 *  (ETL, CDC, ACL) is meaningful, so only 1–2 character non-markers count. */
export function isGenericLabel(label: string): boolean {
  const v = label.trim().replace(/[.!?]+$/, "");
  if (MARKER.test(v)) return false;
  return v.length < 3 || GENERIC.test(v);
}

// --- corpus loading ---------------------------------------------------------

/** Strip // and /* *​/ comments outside strings (reference diagrams are .jsonc). */
function stripJsonc(text: string): string {
  let out = "", inStr = false, esc = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (line) { if (c === "\n") { line = false; out += c; } continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    out += c;
  }
  // Tolerate trailing commas (the same leniency the render helpers' embed uses), so a
  // hand-edited reference with a dangling comma doesn't take the whole eval down.
  return out.replace(/,(\s*[\]}])/g, "$1");
}

interface CorpusItem { name: string; kind: "reference" | "hostile"; json: unknown }

function loadCorpus(): CorpusItem[] {
  const items: CorpusItem[] = [];
  for (const f of readdirSync(REF).filter((f) => f.endsWith(".jsonc")).sort()) {
    items.push({
      name: basename(f, ".jsonc"), kind: "reference",
      json: JSON.parse(stripJsonc(readFileSync(join(REF, f), "utf8"))),
    });
  }
  if (existsSync(CORPUS)) {
    for (const f of readdirSync(CORPUS).filter((f) => f.endsWith(".json")).sort()) {
      items.push({
        name: basename(f, ".json"), kind: "hostile",
        json: JSON.parse(readFileSync(join(CORPUS, f), "utf8")),
      });
    }
  }
  return items;
}

// --- scoring ----------------------------------------------------------------

const GEOMETRY_KEYS = [
  "NODE OVERLAPS \\(visual\\)", "BOX STRADDLE", "ON BOX TITLE", "LABEL OVERLAPS",
  "LABEL OVER NODE/TITLE", "EDGE THROUGH TILE", "EDGE GRAZES TILE", "PARALLEL OVERLAP", "EDGE CROSS", "TRUNCATED TEXT", "TITLE CROSSED BY EDGE", "EDGE UNDER LABEL", "CLIPPED TEXT", "PRESENTATION ASPECT", "FLOW ORIENTATION", "CONSOLE", "TEXT OVERLAPS", "CONTENT OUTSIDE TILE", "LABEL HIDES ARROW",
] as const;
const geomLabel = (k: string) => k.replace(/\\/g, "");

interface Score {
  diagram: string;
  kind: string;
  tabs: number;
  nodes: number;
  edges: number;
  labelledEdges: number;
  contentIssues: number;
  genericLabels: number;
  overLongLabels: number;
  geometry: Record<string, number | null>;
  /** Per-category detail lines from inspect-arch (e.g. "e6 ✕ e7"), so the review
   *  page can show WHICH edges/tiles are at fault, not just a count. */
  details: Record<string, string[]>;
  /** Total overlap AREA per category (px²) — how BAD, not just how many. */
  severity: { labelOnTileArea: number; nodeOverlapArea: number };
}

function scoreOne(item: CorpusItem, viewerHtml: string): Score {
  const tabs = (Array.isArray(item.json) ? item.json : [item.json]) as Record<string, unknown>[];

  // CONTENT — reuse the app's validator for integrity. Actual-bounds aspect is
  // scored once by browser geometry below (the DOM is authoritative), not again
  // here through the app's fast approximate check.
  const contentIssues = validateArchitecture(JSON.stringify(tabs))
    .filter((i) => !i.message.startsWith("Actual node bounds are"))
    .length;

  let nodes = 0, edges = 0, labelled = 0, generic = 0, overLong = 0;
  for (const t of tabs) {
    nodes += (t.nodes as unknown[] | undefined)?.length ?? 0;
    for (const e of ((t.edges as { label?: unknown }[] | undefined) ?? [])) {
      edges++;
      const lab = typeof e.label === "string" ? e.label.trim() : "";
      if (!lab) continue;
      labelled++;
      if (isGenericLabel(lab)) generic++;
      if (lab.length > MAX_LABEL_CHARS) overLong++;
    }
  }

  // GEOMETRY — render through the real standalone viewer, measure in the browser.
  mkdirSync(RESULTS, { recursive: true });
  const page = join(RESULTS, `${item.name}.html`);
  const inject = (t: unknown) =>
    viewerHtml.replace(
      /(<script[^>]*type="application\/json"[^>]*id="architecture"[^>]*>)[\s\S]*?(<\/script>)/,
      (_m, a: string, b: string) => a + JSON.stringify(t) + b,
    );
  const injected = inject(tabs);
  writeFileSync(page, injected);

  // Review-page renders: the SAME diagram forced under each theme so the combined
  // review page (build-review-index.py) can toggle slide ⇄ technical for visual
  // comparison. These are review artifacts only — scoring (below) uses the diagram
  // AS AUTHORED, never a forced theme, so the eval stays honest.
  for (const theme of ["slide", "technical"] as const) {
    // Force the theme EXPLICITLY on every tab (technical is now the default, so
    // clearing the field would resolve to technical, not slide — the forced
    // slide render must set it, not drop it).
    const themed = tabs.map((t) => ({ ...t, theme }));
    writeFileSync(join(RESULTS, `${item.name}.${theme}.html`), inject(themed));
  }

  let stdout = "";
  try {
    stdout = execFileSync("node", [INSPECT, page], { encoding: "utf8", timeout: 240000 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    stdout = (e.stdout ?? "") + (e.stderr ?? ""); // non-zero exit == findings
  }
  const geometry: Record<string, number | null> = {};
  for (const k of GEOMETRY_KEYS) {
    const m = new RegExp(`^${k}: (\\d+)$`, "m").exec(stdout);
    geometry[geomLabel(k)] = m ? Number(m[1]) : null;
  }

  // DETAIL lines, so the review page can show WHICH edges/tiles are at fault, not
  // just a count. inspect-arch prints each fault category as `CATEGORY: N` followed
  // by 2-space-indented detail lines (e.g. `  e6 ✕ e7`) until the next unindented
  // line. Capture those per category (only where N > 0).
  const details: Record<string, string[]> = {};
  for (const k of GEOMETRY_KEYS) {
    const label = geomLabel(k);
    if (!geometry[label]) continue; // 0 or null → no detail
    const block = new RegExp(`^${k}: \\d+\\n((?:[ \\t]+.*\\n?)*)`, "m").exec(stdout);
    if (!block) continue;
    const lines = block[1].split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length) details[label] = lines;
  }

  // SEVERITY, not just incidence. A COUNT cannot tell four invisible 7px nicks
  // from three labels lying across a tile's name, and that difference is the whole
  // question when judging whether placement improved anything. `inspect-arch`
  // prints each finding's overlap as `(WxH)`, so total the area per category.
  const areaIn = (section: string): number => {
    const block = new RegExp(`^${section}: \\d+\\n([\\s\\S]*?)(?=^[A-Z][A-Z ]+[A-Z/()]*: )`, "m").exec(stdout);
    if (!block) return 0;
    let total = 0;
    for (const m of block[1].matchAll(/\((\d+)x(\d+)\)/g)) total += Number(m[1]) * Number(m[2]);
    return total;
  };
  const severity = {
    labelOnTileArea: areaIn("LABEL OVER NODE/TITLE"),
    nodeOverlapArea: areaIn("NODE OVERLAPS \\(visual\\)"),
  };

  return {
    diagram: item.name, kind: item.kind, tabs: tabs.length,
    nodes, edges, labelledEdges: labelled,
    contentIssues, genericLabels: generic, overLongLabels: overLong,
    geometry, details, severity,
  };
}

// --- report + gate ----------------------------------------------------------

/** Every metric here is a FAULT COUNT, so the target is always 0 and "worse"
 *  always means "larger". That's what lets the gate be a plain comparison. */
function faultTotal(s: Score): number {
  return s.contentIssues + s.genericLabels + s.overLongLabels +
    Object.values(s.geometry).reduce<number>((a, v) => a + (v ?? 0), 0);
}

function markdown(scores: Score[]): string {
  const L = [
    "# Architecture diagram eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Every column is a FAULT COUNT — 0 is the target everywhere.",
    "`reference` diagrams are hand-tuned and can only catch regressions;",
    "`hostile` diagrams are built to fail and are where improvement shows up.",
    "",
    "| diagram | kind | nodes | edges | labelled | content | generic | over-long | labels-on-tiles | label-overlaps | edges-through-tiles | node-overlaps | total |",
    "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
  ];
  for (const s of scores) {
    L.push(`| ${s.diagram} | ${s.kind} | ${s.nodes} | ${s.edges} | ${s.labelledEdges} `
      + `| ${s.contentIssues} | ${s.genericLabels} | ${s.overLongLabels} `
      + `| ${s.geometry["LABEL OVER NODE/TITLE"] ?? "?"} | ${s.geometry["LABEL OVERLAPS"] ?? "?"} `
      + `| ${s.geometry["EDGE THROUGH TILE"] ?? "?"} | ${s.geometry["NODE OVERLAPS (visual)"] ?? "?"} `
      + `| **${faultTotal(s)}** |`);
  }
  L.push("", `**Total faults: ${scores.reduce((a, s) => a + faultTotal(s), 0)}**`, "");
  // Severity is reported but NOT gated: a count is a stable gate, an area moves
  // with every font tweak. Read them together — fewer faults with more area is a
  // worse diagram, and the count alone will not tell you.
  L.push("", "## Severity (overlap area in px² — reported, not gated)", "",
    "| diagram | label-on-tile area | node-overlap area |", "|---|--:|--:|");
  for (const s of scores) {
    if (!s.severity.labelOnTileArea && !s.severity.nodeOverlapArea) continue;
    L.push(`| ${s.diagram} | ${s.severity.labelOnTileArea} | ${s.severity.nodeOverlapArea} |`);
  }
  const tot = scores.reduce((a, s) => a + s.severity.labelOnTileArea, 0);
  L.push("", `**Total label-on-tile area: ${tot} px²**`, "");
  return L.join("\n");
}

// --- main -------------------------------------------------------------------

// Everything below is the CLI. Guarded so the scoring helpers above can be
// imported by tests without running the whole eval as an import side effect.
if (!import.meta.main) {
  // nothing to do on import
} else {

if (!existsSync(VIEWER)) {
  console.error(`Missing ${VIEWER}\nRun: cd app && bun run build:arch-standalone`);
  process.exit(2);
}
const update = process.argv.includes("--update");
const viewerHtml = readFileSync(VIEWER, "utf8");
const corpus = loadCorpus();
if (corpus.length === 0) { console.error("empty corpus"); process.exit(2); }

const scores = corpus.map((item) => {
  const s = scoreOne(item, viewerHtml);
  const sev = s.severity.labelOnTileArea + s.severity.nodeOverlapArea;
  console.log(`  ${s.diagram.padEnd(24)} ${s.kind.padEnd(10)} faults=${faultTotal(s)}`
    + (sev ? `  overlapArea=${sev}px²` : ""));
  return s;
});

mkdirSync(RESULTS, { recursive: true });
writeFileSync(join(RESULTS, "arch-eval.json"), JSON.stringify({ scores }, null, 2) + "\n");
writeFileSync(join(RESULTS, "arch-eval.md"), markdown(scores));

const current = Object.fromEntries(scores.map((s) => [s.diagram, faultTotal(s)]));
if (update) {
  writeFileSync(BASELINE, JSON.stringify({ faults: current }, null, 2) + "\n");
  console.log(`\nBaseline updated → ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("\nNo baseline. Review the scorecard, then: bun run eval:arch -- --update");
  process.exit(1);
}
const base = (JSON.parse(readFileSync(BASELINE, "utf8")) as { faults: Record<string, number> }).faults;
const regressions: string[] = [];
const improvements: string[] = [];
for (const [name, faults] of Object.entries(current)) {
  const was = base[name];
  if (was === undefined) { regressions.push(`${name}: NEW diagram, ${faults} fault(s) — add it to the baseline`); continue; }
  if (faults > was) regressions.push(`${name}: ${was} → ${faults} faults`);
  else if (faults < was) improvements.push(`${name}: ${was} → ${faults} faults`);
}
for (const name of Object.keys(base)) {
  if (!(name in current)) improvements.push(`${name}: removed from the corpus`);
}

console.log(`\nreport → ${join(RESULTS, "arch-eval.md")}`);
if (improvements.length) {
  console.log("\nIMPROVED:");
  for (const i of improvements) console.log(`  ${i}`);
  console.log("  (accept with: bun run eval:arch -- --update)");
}
if (regressions.length) {
  console.error("\nREGRESSED:");
  for (const r of regressions) console.error(`  ${r}`);
  process.exit(1);
}
console.log(`\nOK — no regression against the baseline (${Object.keys(base).length} diagrams).`);

} // end CLI guard
