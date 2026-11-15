// Round-trip fidelity: every way the app rewrites architecture.md must give back what was
// written. Each skill reference diagram (28 files, together they use nearly every field) goes
// through each save path; anything that is not equivalent to the original is reported.
//   bun scripts/test-arch-roundtrip.ts        (part of `bun run test:layout`)
//
// Why: the collab doc sorted the top-level nodes by id and dropped the tab's layout fields, so
// the first canvas save after an agent write moved a diagram's sources to the right. Nothing
// tested a save path against real files, so it shipped. Paths:
//   save    parseArchitecture → serializeArchitecture   (the canvas autosave)
//   nudge   the same, with every tile a few px off       (the canvas re-measures the DOM)
//   tabs    serializeArchitectureTabs                    (the multi-tab writer)
//   ydoc    hydrateDocFromMd → docToMd                   (a collab join)
//   apply   applyTabBodyToDoc(save output) → docToTabBodies  (a collab edit)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { parseArchitecture, serializeArchitecture, serializeArchitectureTabs } from "../src/demo_prompt_generator/ui/lib/platform-architecture";
import { applyTabBodyToDoc, docToMd, docToTabBodies, hydrateDocFromMd, tabOrder } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/collab/ydoc-model";

const REF = join(import.meta.dir, "../../.claude/skills/databricks-architecture/reference");
const fence = (o: unknown) => "```json\n" + JSON.stringify(o, null, 2) + "\n```\n";
const unfence = (s: string) => JSON.parse(s.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? s);
const canon = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
};

/** The first difference between two JSON values, as a path. */
function diff(a: unknown, b: unknown, path = ""): string | null {
  if (canon(a) === canon(b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) !== Array.isArray(b)) {
    return `${path || "/"}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ids = (x: unknown[]) => x.map((n) => (n as { id?: string })?.id).join(",");
    if (a.length !== b.length || (a[0] as { id?: string })?.id !== undefined && ids(a) !== ids(b)) {
      return `${path}: [${ids(a) || a.length}] → [${ids(b) || b.length}]`;
    }
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${(a[i] as { id?: string })?.id ?? i}]`); if (d) return d; }
    return null;
  }
  const A = a as Record<string, unknown>, B = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!(k in B)) return `${path}.${k}: dropped (${JSON.stringify(A[k])?.slice(0, 60)})`;
    if (!(k in A)) return `${path}.${k}: added (${JSON.stringify(B[k])?.slice(0, 60)})`;
    const d = diff(A[k], B[k], `${path}.${k}`); if (d) return d;
  }
  return null;
}

const files = readdirSync(REF).filter((f) => f.endsWith(".jsonc")).sort();
const failures: string[] = [];
let checks = 0;
const check = (file: string, step: string, before: unknown, after: unknown) => {
  checks++;
  const d = diff(before, after);
  if (d) failures.push(`${file.padEnd(36)} ${step.padEnd(6)} ${d}`);
};

for (const f of files) {
  const tabs = JSON.parse(readFileSync(join(REF, f), "utf8").replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>[];
  // Reference files are hand-authored; the first save normalises them (defaults, edge ids).
  // Fidelity is: a SECOND pass changes nothing. So the baseline is one save of each tab.
  const saved = tabs.map((t) => unfence(serializeArchitecture(parseArchitecture(fence(t)), parseArchitecture(fence(t)).layout)));
  tabs.forEach((t, i) => {
    // structure must survive the first save (only normalisation allowed)
    const struct = (x: unknown): unknown => (x as { nodes?: { id: string; children?: unknown[] }[] }).nodes?.map(function s(n): unknown { return n.children ? { [n.id]: n.children.map((c) => s(c as { id: string; children?: unknown[] })) } : n.id; });
    check(f, "struct", struct(t), struct(saved[i]));
    for (const k of ["layout", "gap", "align", "justify", "cols", "equal"]) if (k in t) check(f, "root", { [k]: t[k] }, { [k]: saved[i][k] });
    const s = parseArchitecture(fence(saved[i]));
    check(f, "save", saved[i], unfence(serializeArchitecture(s, s.layout)));
    const L = structuredClone(s.layout);
    for (const p of Object.values(L.nodes)) { (p as { x: number }).x += 2; (p as { y: number }).y += 2; }
    check(f, "nudge", saved[i], unfence(serializeArchitecture(s, L)));
  });
  const md = fence(saved);
  check(f, "tabs", saved, unfence(serializeArchitectureTabs(saved.map((t) => fence(t)))));
  const ydoc = new Y.Doc();
  hydrateDocFromMd(ydoc, md);
  check(f, "ydoc", saved, unfence(docToMd(ydoc)));
  const tid = tabOrder(ydoc)[0];
  applyTabBodyToDoc(ydoc, tid, fence(saved[0]));
  check(f, "apply", saved[0], unfence(docToTabBodies(ydoc)[0].body));
}

if (failures.length) {
  console.error(`\n✗ round-trip: ${failures.length} of ${checks} checks changed the file\n` + failures.join("\n"));
  process.exit(1);
}
console.log(`Round-trip fidelity passed (${files.length} reference files, ${checks} checks).`);
