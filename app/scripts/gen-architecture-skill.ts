/**
 * gen-architecture-skill — generate the architecture skill's component-reference
 * section FROM the code catalog (the single source of truth) and inject it
 * between markers in the skill doc. Run after changing CATALOG.
 *
 *   bun run scripts/gen-architecture-skill.ts
 *
 * It rewrites ONLY the blocks between:
 *   <!-- BEGIN: generated-catalog -->  …  <!-- END: generated-catalog -->
 *   <!-- BEGIN: generated-icons -->  …  <!-- END: generated-icons -->
 * in .claude/skills/databricks-architecture/reference/component-catalog.md — the rest of
 * that doc (and every other skill file) is authored by hand. The component list, default
 * descriptions, ports and `authoring` hints therefore can never drift from what the app
 * actually ships. The port-name drift guard runs over SKILL.md and every reference/*.md.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { CATALOG, BAND_ORDER, BAND_META, naturalSize, LUCIDE_GLYPH_NAMES, LUCIDE_OFFICIAL_PREFERENCE } from "@/lib/platform-architecture";
import { REMOTE_VENDOR_LOGOS } from "@/icons/remote-logos";
import { ICON_ALIASES } from "@/lib/icon-aliases";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = app/scripts → repo root is two levels up.
const SKILL_DIR = resolve(HERE, "../../.claude/skills/databricks-architecture");
/** The generated blocks live in the catalog reference (SKILL.md stays a hand-written core). */
const CATALOG_DOC = resolve(SKILL_DIR, "reference/component-catalog.md");
const ICONS_DIR = resolve(HERE, "../src/demo_prompt_generator/ui/icons");

/** Recursively list `.svg` paths under a dir, relative to it (e.g.
 *  "cloud/aws/storage/s3.svg"). FS-based so it runs headless (the app's
 *  FILE_ICONS uses Vite's import.meta.glob, which is empty outside Vite). */
function listSvgs(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...listSvgs(p, base));
    else if (e.name.endsWith(".svg")) out.push(p.slice(base.length + 1));
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** The component-catalog body (Databricks tiles). */
function renderCatalog(): string {
  const lines: string[] = [];
  lines.push("<!-- AUTO-GENERATED from CATALOG in app/.../lib/platform-architecture.ts");
  lines.push("     by `bun run scripts/gen-architecture-skill.ts` — DO NOT EDIT BY HAND. -->");
  lines.push("");
  lines.push("Use the `type` id; the renderer supplies the icon, label, description text and size (size is the SAME in both themes — slide changes only what's drawn inside a node, never its box). **`theme:\"slide\"` never renders a catalog tile's or source's description** (label + icon do the work on a slide; only `type:\"logo\"` nodes show `desc` with `showDesc:true`), so a tile `desc` renders only in `theme:\"technical\"`; override `label`/`desc` only when story-specific. Composite blocks carry their own internal layout — treat each as ONE node (don't also add its sub-parts).");
  lines.push("");

  for (const band of BAND_ORDER) {
    // Sources are demo-authored (the catalog ships only example sources) — they
    // get their own hand-written section, not the generated component reference.
    if (band === "sources") continue;
    // Deprecated components still PARSE + RENDER (existing diagrams keep working),
    // but the agent must never be offered them — so they are left out of the
    // reference entirely. Their replacement is documented in SKILL.md.
    const comps = (CATALOG[band] ?? []).filter((c) => !c.deprecated);
    if (!comps.length) continue;
    lines.push(`### ${BAND_META[band].label} \`${band}\``);
    lines.push("");
    const blurb = BAND_META[band].blurb ?? BAND_META[band].sublabel;
    if (blurb) { lines.push(`*${esc(blurb)}*`); lines.push(""); }
    // Columns: type + title + available description text (technical shows it;
    // SLIDE always hides tile descriptions) + node size (theme-invariant) + guidance.
    lines.push("| type | default title | available description (technical; slide hides it) | size | when to use |");
    lines.push("|------|---------------|-----------------------------------------|------|-------------|");
    for (const c of comps) {
      const sz = naturalSize(c.id);
      // Description is catalog-backed but slide hides it unless requested.
      // "when to use" shows the `authoring` guidance ONLY — left blank
      // when there's none, rather than duplicating `desc` into both columns (the
      // description already says what it is; a repeat is noise).
      const shown = c.desc ?? "";
      const whenToUse = c.authoring ?? "";
      lines.push(`| \`${c.id}\` | ${esc(c.label)} | ${esc(shown)} | ${sz.w}×${sz.h} | ${esc(whenToUse)} |`);
      if (c.ports && Object.keys(c.ports).length) {
        const ports = Object.entries(c.ports)
          .map(([h, v]) => `\`${h}\` ${esc(v)}`)
          .join(" · ");
        lines.push(`| | | | | **ports:** ${ports} |`);
      }
      // Typical WIRING — what this component consumes/depends on, so the agent
      // draws realistic edges. A plain entry is the normal/typical wiring;
      // *(optional)* marks an edge to add only when the story calls for it.
      if (c.wiring && c.wiring.length) {
        const w = c.wiring
          .map((r) => `${esc(r.action ?? "reads from")} \`${esc(r.from)}\`${r.optional ? " *(optional)*" : ""}`)
          .join(" · ");
        lines.push(`| | | | | **wiring:** ${w} |`);
      }
    }
    lines.push("");
  }

  lines.push("> Sources are demo-authored (not in this catalog): use `type:\"source\"` with a vendor `icon` (`file:vendor/<name>`; see the icon bank below) and wire the edge to the Lakeflow block's ingest port via an explicit `@in-*` handle.");
  return lines.join("\n");
}

/** The icon bank: vendor + cloud logos available as `icon` values, compactly.
 *  Keys are self-explanatory — no labels needed. */
// ---- Icon index: reference/icons.tsv + the preferred table in SKILL.md ----------
// One row per key. Alias keys (ICON_ALIASES) are not rows: they are listed in the
// `aliases` column of the row whose art they render. Tiers:
//   T1 named third-party / cloud product · T2 Databricks line pictogram (navy)
//   T3 Databricks UI icon (db, 16px) · T4 filled product mark, built-in glyph, generic person
//   T5 lucide glyph · T6 unnamed placeholder.

const CONCEPTS = JSON.parse(readFileSync(resolve(ICONS_DIR, "icon-concepts.json"), "utf8")) as {
  preferred: Record<string, string>;
  concepts?: Record<string, string[]>;
};

type IconRow = { key: string; tier: string; set: string; flags: string[]; aliases: string[]; concepts: string[] };

function builtinNames(): string[] {
  const src = readFileSync(resolve(HERE, "../src/demo_prompt_generator/ui/components/databricks-icons.tsx"), "utf8");
  const body = src.slice(src.indexOf("DATABRICKS_ICONS"), src.indexOf("export type DatabricksIconName"));
  return [...body.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
}

/** Search words for a key: its name tokens plus any hand-written concepts. */
function conceptWords(key: string): string[] {
  const name = (key.split("/").pop() ?? key).replace(/^lucide:/, "");
  const tokens = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[-_ :]+/).map((t) => t.toLowerCase()).filter(Boolean);
  return [...new Set([...tokens, ...(CONCEPTS.concepts?.[key] ?? [])])];
}

/** Tier + set for a file key, from its folder. */
function fileTier(rel: string): { tier: string; set: string } {
  if (rel === "vendor/custom-source") return { tier: "T6", set: "placeholder" };
  if (rel.startsWith("vendor/")) return { tier: "T1", set: "vendor" };
  if (rel.startsWith("cloud/")) return { tier: "T1", set: "cloud" };
  if (rel.startsWith("databricks-line/")) return { tier: "T2", set: "line" };
  if (rel.startsWith("db/")) return { tier: "T3", set: "db" };
  if (rel.startsWith("brand/")) return { tier: "T4", set: "brand" };
  if (rel.startsWith("persona/")) return { tier: "T4", set: "persona" };
  return { tier: "T4", set: "other" };
}

function buildIconRows(): IconRow[] {
  const aliasesOf = new Map<string, string[]>();
  // Orange colour aliases are not listed: a line icon is one row, coloured with iconColor.
  for (const [from, to] of Object.entries(ICON_ALIASES)) if (!from.endsWith("-orange")) aliasesOf.set(to, [...(aliasesOf.get(to) ?? []), from]);
  const rows: IconRow[] = [];
  const add = (key: string, tier: string, set: string, flags: string[] = []) =>
    rows.push({ key, tier, set, flags, aliases: aliasesOf.get(key) ?? [], concepts: conceptWords(key) });

  for (const n of builtinNames()) if (!ICON_ALIASES[n]) add(n, "T4", "builtin");
  for (const g of LUCIDE_GLYPH_NAMES) {
    const slug = LUCIDE_OFFICIAL_PREFERENCE[g];
    add(`lucide:${g}`, "T5", "lucide", slug ? [`prefer file:databricks-line/${slug}`] : ["mono"]);
  }
  const svgs = new Set(listSvgs(ICONS_DIR).map((p) => p.replace(/\.svg$/, "")));
  for (const rel of svgs) {
    // A -orange file with a navy twin is a colour alias (skipped below via ICON_ALIASES).
    if (ICON_ALIASES[`file:${rel}`]) continue; // an alias: listed on its canonical row
    const { tier, set } = fileTier(rel);
    const flags: string[] = [];
    if (set === "db") flags.push("16px");
    add(`file:${rel}`, tier, set, flags);
  }
  for (const name of Object.keys(REMOTE_VENDOR_LOGOS)) {
    const key = `file:vendor/${name}`;
    if (!rows.some((r) => r.key === key)) add(key, "T1", "vendor", ["remote"]);
  }
  return rows.sort((a, b) => a.tier.localeCompare(b.tier) || a.key.localeCompare(b.key));
}

/** Build-time guard (throws, like the @in-* drift check): every preferred / alias /
 *  concept / lucide-preference target must be a real icon, and every icon must have a row. */
function checkIconIndex(rows: IconRow[]): void {
  const keys = new Set(rows.map((r) => r.key));
  const bad: string[] = [];
  for (const [concept, key] of Object.entries(CONCEPTS.preferred)) {
    if (!keys.has(key) && !ICON_ALIASES[key]) bad.push(`preferred "${concept}": ${key} is not an icon`);
  }
  for (const key of Object.keys(CONCEPTS.concepts ?? {})) {
    if (!keys.has(key) && !ICON_ALIASES[key]) bad.push(`concepts: ${key} is not an icon`);
  }
  for (const [from, to] of Object.entries(ICON_ALIASES)) {
    if (!keys.has(to)) bad.push(`alias ${from} → ${to} is not an icon`);
  }
  for (const [g, slug] of Object.entries(LUCIDE_OFFICIAL_PREFERENCE)) {
    if (!keys.has(`file:databricks-line/${slug}`)) bad.push(`lucide:${g} prefers missing databricks-line/${slug}`);
  }
  for (const rel of listSvgs(ICONS_DIR).map((p) => p.replace(/\.svg$/, ""))) {
    if (rel.endsWith("-orange") && ICON_ALIASES[`file:${rel.replace(/-orange$/, "")}`]) continue;
    if (!keys.has(`file:${rel}`) && !ICON_ALIASES[`file:${rel}`]) bad.push(`no row for file:${rel}`);
  }
  for (const n of builtinNames()) if (!keys.has(n) && !ICON_ALIASES[n]) bad.push(`no row for built-in ${n}`);
  for (const g of LUCIDE_GLYPH_NAMES) if (!keys.has(`lucide:${g}`)) bad.push(`no row for lucide:${g}`);
  if (bad.length) throw new Error(`icon index check failed (${bad.length}):\n  ${bad.join("\n  ")}`);
}

function renderIconIndexTsv(rows: IconRow[]): string {
  const head = ["key", "tier", "set", "flags", "aliases", "concepts"].join("\t");
  return [head, ...rows.map((r) => [r.key, r.tier, r.set, r.flags.join(","), r.aliases.join(","), r.concepts.join(", ")].join("\t"))].join("\n") + "\n";
}

function renderIcons(rows: IconRow[]): string {
  const count = (set: string) => rows.filter((r) => r.set === set).length;
  const lines: string[] = [];
  lines.push("<!-- AUTO-GENERATED from the icon bank (reference/icons.tsv + ui/icons/icon-concepts.json) — DO NOT EDIT BY HAND. -->");
  lines.push("");
  lines.push("**Pick an icon.** Take the key from the preferred table below. For anything else run `grep -i \"<word>\" reference/icons.tsv` (columns: key, tier, set, flags, aliases, concepts) and use the lowest-tier match. Never invent a key; every key here and in icons.tsv is validated at build.");
  lines.push("");
  lines.push("**Precedence (fixed):** T1 named third-party or cloud product (`file:vendor/*`, `file:cloud/*`) → T2 Databricks line pictogram (`file:databricks-line/*`, navy; set `style.icon` for a colour, e.g. the Databricks orange `#FF5F46`) → T3 Databricks UI icon (`file:db/*`, 16 px, capped at 32px; only when T1-T2 has no fit for the concept) → T4 filled product mark, built-in glyph or generic person (`file:brand/*` Databricks marks, bare built-in names, `file:persona/user`) → T5 `lucide:<name>` (abstract shape only) → T6 `file:vendor/custom-source` (unnamed source).");
  lines.push("");
  lines.push("**Aliases.** Some keys are aliases: they render the art of a canonical key (for example `dashboard` → `file:databricks-line/dashboards`, `file:db/notebook` → `file:databricks-line/notebook`). Write the canonical key in new diagrams; alias keys stay valid in existing ones. The `aliases` column of icons.tsv lists them.");
  lines.push("");
  lines.push("**Colour.** Any node may set its icon colour with `style.icon` (hex) to tint a monochrome line or UI icon (logo, card, source and catalog tile icons), e.g. `style: {icon: \"#FF5F46\"}` for the Databricks orange. Brand and partner logos keep their own colour.");
  lines.push("");
  lines.push("**Slides vs technical diagrams.** Slide-style diagrams may still use the filled Databricks brand marks (`file:brand/*`, `*Brand`) for Databricks products. Line and workspace art is the default for technical diagrams.");
  lines.push("");
  lines.push("**Preferred icon per concept:**");
  lines.push("");
  lines.push("| Concept | Key |");
  lines.push("|---|---|");
  for (const [concept, key] of Object.entries(CONCEPTS.preferred)) lines.push(`| ${concept} | \`${key}\` |`);
  lines.push("");
  lines.push(`**Sets** (${rows.length} rows): built-in ${count("builtin")}, lucide ${count("lucide")}, Databricks brand marks ${count("brand")}, Databricks line ${count("line")} (one navy key per icon; set style.icon for a colour, e.g. the Databricks orange #FF5F46), Databricks UI icons ${count("db")} (workspace UI, 16 px), vendor ${count("vendor")} (incl. remote), cloud ${count("cloud")}, persona ${count("persona")}. Full list: \`reference/icons.tsv\`.`);
  lines.push("");
  lines.push("Also: `file:persona/user` (a person — normally the business-user persona is built into the `genie-one` component, but you can place it as a standalone `logo` node if needed).");
  lines.push("");
  // Microsoft ships TWO Azure ML marks and they mean different things. Without
  // this note an author sees the pair, assumes the higher pack number supersedes
  // the other, and silently relabels a standalone Azure ML estate as Foundry.
  lines.push("**Azure ML has TWO marks — pick by what the node IS, not by which looks newer.** `file:cloud/azure/ml/machine-learning` is the STANDALONE Azure ML service (cyan; pack `10166`) — use it for an Azure ML workspace, pipeline, registry or managed endpoint. `file:cloud/azure/ml/machine-learning-foundry` is Azure ML **as an AI Foundry surface** (purple; pack `038470510`, one of the Foundry family alongside Foundry Agent Service / Control Plane / Models) — use it only when the node really sits inside Foundry. Microsoft ships BOTH in the current pack, so neither supersedes the other. For the Foundry platform itself use `file:cloud/azure/ml/ai-foundry`.");
  return lines.join("\n");
}

function inject(doc: string, name: string, body: string): string {
  const begin = `<!-- BEGIN: ${name} -->`;
  const end = `<!-- END: ${name} -->`;
  const b = doc.indexOf(begin);
  const e = doc.indexOf(end);
  if (b === -1 || e === -1) {
    console.error(`Markers for "${name}" not found in ${CATALOG_DOC}. Add:\n${begin}\n${end}`);
    process.exit(1);
  }
  return doc.slice(0, b) + `${begin}\n\n${body}\n\n${end}` + doc.slice(e + end.length);
}

/** Drift guard: the teaching PROSE (outside the generated block) hard-codes the
 *  Lakeflow ingest port names (`@in-zerobus`, …) because concrete names make the
 *  authoring guidance usable. To keep CATALOG the single source of truth, fail
 *  the build if the prose references an `in-*` port that no CATALOG component
 *  actually declares — so a future port rename can't silently leave stale docs. */
function checkPortNameDrift(doc: string, file: string): void {
  // Real port handle ids from the code.
  const known = new Set<string>();
  for (const comps of Object.values(CATALOG)) {
    for (const c of comps) {
      for (const h of Object.keys((c as { ports?: Record<string, string> }).ports ?? {})) {
        if (h.startsWith("in-")) known.add(h);
      }
    }
  }
  // Prose = the doc with the generated blocks stripped out (those are code-derived).
  const prose = doc.replace(/<!-- BEGIN: [\s\S]*?<!-- END: [^>]*-->/g, "");
  const referenced = new Set(
    [...prose.matchAll(/[`@](in-[a-z0-9-]+)`?/g)].map((m) => m[1]),
  );
  const stale = [...referenced].filter((p) => !known.has(p));
  if (stale.length) {
    console.error(
      `Port-name drift in ${file}: prose references ${stale.map((s) => `\`${s}\``).join(", ")} ` +
      `which no CATALOG component declares (known: ${[...known].join(", ")}). ` +
      `Update the prose to match CATALOG.ports, or add the port to the component.`,
    );
    process.exit(1);
  }
}

// Drift guard over every hand-written prose file (SKILL.md + reference/*.md).
const proseFiles = [
  resolve(SKILL_DIR, "SKILL.md"),
  ...readdirSync(resolve(SKILL_DIR, "reference"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => resolve(SKILL_DIR, "reference", f)),
];
for (const f of proseFiles) checkPortNameDrift(readFileSync(f, "utf8"), f);

let doc = readFileSync(CATALOG_DOC, "utf8");
doc = inject(doc, "generated-catalog", renderCatalog());
const iconRows = buildIconRows();
checkIconIndex(iconRows);
writeFileSync(resolve(dirname(CATALOG_DOC), "icons.tsv"), renderIconIndexTsv(iconRows));
doc = inject(doc, "generated-icons", renderIcons(iconRows));
writeFileSync(CATALOG_DOC, doc);
console.log(`✓ wrote generated catalog (${CATALOG && Object.values(CATALOG).flat().length} components) → ${CATALOG_DOC}`);
