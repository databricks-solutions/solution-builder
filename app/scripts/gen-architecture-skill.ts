/**
 * gen-architecture-skill — generate the architecture skill's component-reference
 * section FROM the code catalog (the single source of truth) and inject it
 * between markers in the skill doc. Run after changing CATALOG.
 *
 *   bun run scripts/gen-architecture-skill.ts
 *
 * It rewrites ONLY the block between:
 *   <!-- BEGIN: generated-catalog -->  …  <!-- END: generated-catalog -->
 * in references/architecture/architecture.md — the rest of the doc is authored
 * by hand. The component list, default descriptions, ports and `authoring`
 * hints therefore can never drift from what the app actually ships.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { CATALOG, BAND_ORDER, BAND_META, naturalSize } from "@/lib/platform-architecture";
import { REMOTE_VENDOR_LOGOS } from "@/icons/remote-logos";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = app/scripts → repo root is two levels up.
const SKILL = resolve(
  HERE,
  "../../.claude/skills/databricks-architecture/SKILL.md",
);
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
  lines.push("Use the `type` id; the renderer supplies the icon, label, default description and size. Override `label`/`desc` only when story-specific. Composite blocks carry their own internal layout — treat each as ONE node (don't also add its sub-parts).");
  lines.push("");

  for (const band of BAND_ORDER) {
    // Sources are demo-authored (the catalog ships only example sources) — they
    // get their own hand-written section, not the generated component reference.
    if (band === "sources") continue;
    const comps = CATALOG[band] ?? [];
    if (!comps.length) continue;
    lines.push(`### ${BAND_META[band].label} \`${band}\``);
    lines.push("");
    lines.push("| type | label | size | what it is / when to use |");
    lines.push("|------|-------|------|--------------------------|");
    for (const c of comps) {
      const sz = naturalSize(c.id);
      const note = c.authoring ?? c.desc ?? "";
      lines.push(`| \`${c.id}\` | ${esc(c.label)} | ${sz.w}×${sz.h} | ${esc(note)} |`);
      if (c.ports && Object.keys(c.ports).length) {
        const ports = Object.entries(c.ports)
          .map(([h, v]) => `\`${h}\` ${esc(v)}`)
          .join(" · ");
        lines.push(`| | | | **ports:** ${ports} |`);
      }
    }
    lines.push("");
  }

  lines.push("> Sources are demo-authored (not in this catalog): use `type:\"source\"` with a vendor `icon` (`file:vendor/<name>`) + an `ingest` path (see the icon bank below).");
  return lines.join("\n");
}

/** The icon bank: vendor + cloud logos available as `icon` values, compactly.
 *  Keys are self-explanatory — no labels needed. */
function renderIcons(): string {
  const lines: string[] = [];
  lines.push("<!-- AUTO-GENERATED from the icon bank (icons/vendor + icons/cloud) — DO NOT EDIT BY HAND. -->");
  lines.push("");
  lines.push("Logos you can set as a node `icon`. Keys are self-explanatory; use them verbatim.");
  lines.push("");

  const svgs = listSvgs(ICONS_DIR).map((p) => p.replace(/\.svg$/, "")); // e.g. "cloud/aws/storage/s3"

  // Vendor logos → one dense comma list of `file:vendor/<name>`. Local OSS/brand
  // SVGs live on disk; trademarked partner logos are referenced remotely (see
  // icons/remote-logos.ts — not self-hosted). Both use the same `file:vendor/<name>`
  // key, so merge both sources into the list the agent can pick from.
  const localVendor = svgs.filter((p) => p.startsWith("vendor/")).map((p) => p.slice("vendor/".length));
  const remoteVendor = Object.keys(REMOTE_VENDOR_LOGOS);
  const vendor = [...new Set([...localVendor, ...remoteVendor])].sort();
  lines.push("**Vendor / product logos** — `file:vendor/<name>`:");
  lines.push("");
  lines.push(vendor.map((n) => `\`${n}\``).join(", "));
  lines.push("");

  // Cloud logos → grouped by provider, listing the `category/name` leaves.
  const cloud = svgs.filter((p) => p.startsWith("cloud/")).map((p) => p.slice("cloud/".length)); // "aws/storage/s3"
  const providers = [...new Set(cloud.map((p) => p.split("/")[0]))].sort();
  lines.push("**Cloud logos** — `file:cloud/<provider>/<category>/<name>` (e.g. `file:cloud/aws/storage/s3`):");
  lines.push("");
  for (const p of providers) {
    const leaves = cloud
      .filter((c) => c.split("/")[0] === p)
      .map((c) => c.split("/").slice(1).join("/")) // "storage/s3"
      .filter((leaf) => leaf && leaf !== p) // drop the bare provider mark ("aws/aws" → "aws")
      .sort();
    if (leaves.length) lines.push(`- **${p}**: ${leaves.map((l) => `\`${l}\``).join(", ")}`);
  }
  lines.push("");
  lines.push("Also: `file:persona/user` (a person — use as a `logo` node, caption \"Business users\"), `file:vendor/custom-source` (generic animated shapes source when no real logo fits).");
  return lines.join("\n");
}

/** Replace the body between `<!-- BEGIN: name -->` and `<!-- END: name -->`. */
function inject(doc: string, name: string, body: string): string {
  const begin = `<!-- BEGIN: ${name} -->`;
  const end = `<!-- END: ${name} -->`;
  const b = doc.indexOf(begin);
  const e = doc.indexOf(end);
  if (b === -1 || e === -1) {
    console.error(`Markers for "${name}" not found in ${SKILL}. Add:\n${begin}\n${end}`);
    process.exit(1);
  }
  return doc.slice(0, b) + `${begin}\n\n${body}\n\n${end}` + doc.slice(e + end.length);
}

let doc = readFileSync(SKILL, "utf8");
doc = inject(doc, "generated-catalog", renderCatalog());
doc = inject(doc, "generated-icons", renderIcons());
const next = doc;
writeFileSync(SKILL, next);
console.log(`✓ wrote generated catalog (${CATALOG && Object.values(CATALOG).flat().length} components) → ${SKILL}`);
