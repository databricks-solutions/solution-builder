/**
 * probe-edge-crossings — headless feasibility probe for edge/node avoidance.
 *
 *   cd app && bun scripts/probe-edge-crossings.ts
 *
 * `inspect-arch` reports EDGE THROUGH TILE but can't say whether a fix is even
 * reachable with the levers we have (which side each end leaves from, and the
 * vertical elbow's X). This answers that: for every edge that currently crosses
 * an unrelated tile, enumerate side-pair × elbow candidates and report how many
 * are clean.
 *
 * ⚠ ITS COUNTS ARE NOT AUTHORITATIVE — `inspect-arch` (in the browser) is. Offline
 * this sizes nodes with `naturalSize` while the browser measures real DOM boxes, so
 * resolved positions drift (~32px observed on a `rowGrid` diagram) and it
 * OVER-reports offenders — 11 where the browser saw 3. Use it to reason about
 * WHETHER a fix is reachable and by which lever; never quote its numbers as a
 * result.
 *
 * It runs the REAL pipeline offline by faking ReactFlow's `nodeLookup` from
 * `computeLayout`, so `computeFanLayout` + `drawnPath` behave as they do in the
 * app. (Handle bounds are absent, so named ports resolve via the `portAnchor`
 * fallback table — the documented path when bounds aren't measured yet.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseArchitectureFile,
  computeLayout,
  type ArchitectureFile,
} from "../src/demo_prompt_generator/ui/lib/platform-architecture";
import { computeFanLayout } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/fan-layout";
import {
  drawnPath,
  pathToPolyline,
  type EdgeShape,
} from "../src/demo_prompt_generator/ui/components/project/platform-diagram/edges/edge-geometry";
import type { Side, Rect } from "../src/demo_prompt_generator/ui/components/project/platform-diagram/edge-routing";

const REF = join(import.meta.dir, "../../.claude/skills/databricks-architecture/reference");

/** Strip // and block comments outside strings (reference diagrams are .jsonc). */
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
  return out;
}

export function loadRef(name: string): ArchitectureFile[] {
  const raw = stripJsonc(readFileSync(join(REF, `${name}.jsonc`), "utf8"));
  const top = JSON.parse(raw);
  return Array.isArray(top) ? top : [top];
}

/** A ReactFlow-shaped nodeLookup built from computeLayout, so the real fan +
 *  path code runs offline. */
export function fakeLookup(file: ArchitectureFile) {
  const boxes = computeLayout(file);
  const m = new Map<string, {
    internals: { positionAbsolute: { x: number; y: number }; handleBounds: { source: null } };
    measured: { width: number; height: number };
  }>();
  for (const [id, b] of boxes) {
    m.set(id, {
      internals: { positionAbsolute: { x: b.x, y: b.y }, handleBounds: { source: null } },
      measured: { width: b.laneW ?? b.w, height: b.h },
    });
  }
  return m;
}

export const rectOfId = (lookup: ReturnType<typeof fakeLookup>, id: string): Rect | null => {
  const n = lookup.get(id);
  if (!n) return null;
  return {
    x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y,
    w: n.measured.width, h: n.measured.height,
  };
};

/** Does segment AB intersect rect R (shrunk by `inset`)? Liang–Barsky. A point
 *  test on sampled vertices misses a long segment that passes clean through. */
export function segmentHitsRect(
  a: { x: number; y: number }, b: { x: number; y: number }, r: Rect, inset = 3,
): boolean {
  const xmin = r.x + inset, xmax = r.x + r.w - inset;
  const ymin = r.y + inset, ymax = r.y + r.h - inset;
  if (xmax <= xmin || ymax <= ymin) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - xmin], [dx, xmax - a.x], [-dy, a.y - ymin], [dy, ymax - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 > t0;
}

/** Container = a node whose rect encloses another node's rect. Only TILES are
 *  obstacles: a line crossing the platform/cloud box interior is normal. */
export function tileIds(lookup: ReturnType<typeof fakeLookup>): string[] {
  const all = [...lookup.keys()].map((id) => ({ id, r: rectOfId(lookup, id)! })).filter((x) => x.r);
  return all.filter(({ id, r }) => !all.some((o) => o.id !== id &&
    o.r.x >= r.x - 2 && o.r.y >= r.y - 2 &&
    o.r.x + o.r.w <= r.x + r.w + 2 && o.r.y + o.r.h <= r.y + r.h + 2)).map((x) => x.id);
}

const baseId = (ref: string): string => String(ref).split("@")[0];

/** Tiles an edge's drawn path runs through, excluding its own endpoints'. */
export function crossingsFor(
  lookup: ReturnType<typeof fakeLookup>,
  tiles: string[],
  edge: { from: string; to: string; shape?: EdgeShape },
  fan: { sSide: Side; tSide: Side; sFrac: number; tFrac: number; centerX: number | undefined },
): string[] {
  const sR = rectOfId(lookup, baseId(edge.from));
  const tR = rectOfId(lookup, baseId(edge.to));
  if (!sR || !tR) return [];
  const poly = pathToPolyline(drawnPath(fan, sR, tR, edge.shape ?? "smooth").path);
  const hit: string[] = [];
  for (const id of tiles) {
    if (id === baseId(edge.from) || id === baseId(edge.to)) continue;
    const r = rectOfId(lookup, id)!;
    for (let i = 0; i + 1 < poly.length; i++) {
      if (segmentHitsRect(poly[i], poly[i + 1], r)) { hit.push(id); break; }
    }
  }
  return hit;
}

// --- probe -----------------------------------------------------------------

const SIDES: Side[] = ["t", "r", "b", "l"];

/** Is a handle a NAMED port (semantically load-bearing: it drives the port anchor
 *  AND the flow animation) rather than a plain t/r/b/l side hint? */
const isNamedPort = (h?: string): boolean => !!h && !SIDES.includes(h as Side);

/** Which ends may a given policy move?
 *   P1 = elbow X only
 *   P2 = + ends whose side was INFERRED (no handle authored at all)
 *   P3 = + ends with a plain t/r/b/l handle (named ports still frozen)
 */
function movable(policy: 1 | 2 | 3, handle?: string): boolean {
  if (policy === 1) return false;
  if (isNamedPort(handle)) return false;        // never override a named port
  if (handle === undefined) return true;        // inferred → free
  return policy === 3;                          // plain side hint
}

if (import.meta.main) {
  const tally = { 1: [0, 0], 2: [0, 0], 3: [0, 0] } as Record<1 | 2 | 3, [number, number]>;

  for (const name of ["architecture-complete", "governance-layout", "ml-platform", "genie-agent-documents"]) {
    const tabs = loadRef(name);
    for (const file of tabs) {
      const lookup = fakeLookup(file);
      const tiles = tileIds(lookup);
      const edges = (file.edges ?? []).map((e, i) => ({
        id: e.id ?? `edge-${i}`,
        source: baseId(e.from), target: baseId(e.to),
        sourceHandle: String(e.from).includes("@") ? String(e.from).split("@")[1] : undefined,
        targetHandle: String(e.to).includes("@") ? String(e.to).split("@")[1] : undefined,
        from: e.from, to: e.to, shape: e.shape as EdgeShape | undefined,
      }));
      const fans = computeFanLayout(edges as never, lookup as never);

      const offenders = edges.filter((e) => {
        const f = fans.get(e.id);
        return f && crossingsFor(lookup, tiles, e, f).length > 0;
      });
      if (offenders.length === 0) continue;

      console.log(`\n### ${name} — ${file.name ?? "(tab)"}: ${offenders.length} offending edge(s)`);
      for (const e of offenders) {
        const f = fans.get(e.id)!;
        const through = crossingsFor(lookup, tiles, e, f);
        console.log(`\n  ${e.id}: ${e.from} → ${e.to}`);
        console.log(`    default sides ${f.sSide}→${f.tSide}, runs through: ${through.join(", ")}`);

        // Candidate space: every side pair, and for horizontal pairs an elbow sweep.
        const sR = rectOfId(lookup, e.source)!, tR = rectOfId(lookup, e.target)!;
        const lo = Math.min(sR.x, tR.x) - 120, hi = Math.max(sR.x + sR.w, tR.x + tR.w) + 120;
        const clean: string[] = [];
        for (const ss of SIDES) for (const ts of SIDES) {
          const horiz = (ss === "l" || ss === "r") && (ts === "l" || ts === "r");
          const xs: (number | undefined)[] = horiz
            ? [undefined, ...Array.from({ length: 21 }, (_, k) => lo + (k * (hi - lo)) / 20)]
            : [undefined];
          for (const cx of xs) {
            const cand = { sSide: ss, tSide: ts, sFrac: f.sFrac, tFrac: f.tFrac, centerX: cx };
            if (crossingsFor(lookup, tiles, e, cand).length === 0) {
              clean.push(`${ss}→${ts}${cx === undefined ? "" : ` @cx=${Math.round(cx)}`}`);
            }
          }
        }
        const uniqueSides = [...new Set(clean.map((c) => c.split(" ")[0]))];
        console.log(`    ANY-lever clean candidates: ${clean.length} across ${uniqueSides.length} side-pair(s)`);

        // Now the same search restricted by each intent-preserving policy.
        for (const policy of [1, 2, 3] as const) {
          const sOk = movable(policy, e.sourceHandle);
          const tOk = movable(policy, e.targetHandle);
          const ssOpts = sOk ? SIDES : [f.sSide];
          const tsOpts = tOk ? SIDES : [f.tSide];
          let found: string | null = null;
          for (const ss of ssOpts) for (const ts of tsOpts) {
            const horiz = (ss === "l" || ss === "r") && (ts === "l" || ts === "r");
            const xs: (number | undefined)[] = horiz
              ? [undefined, ...Array.from({ length: 21 }, (_, k) => lo + (k * (hi - lo)) / 20)]
              : [undefined];
            for (const cx of xs) {
              if (found) break;
              const cand = { sSide: ss, tSide: ts, sFrac: f.sFrac, tFrac: f.tFrac, centerX: cx };
              if (crossingsFor(lookup, tiles, e, cand).length === 0) {
                found = `${ss}→${ts}${cx === undefined ? "" : ` @cx=${Math.round(cx)}`}`;
              }
            }
          }
          tally[policy][found ? 0 : 1]++;
          console.log(`    P${policy} (${sOk ? "src free" : "src fixed"}, ${tOk ? "tgt free" : "tgt fixed"}): ${found ?? "NO CLEAN OPTION"}`);
        }
      }
    }
  }

  console.log("\n=== how many offenders each intent-preserving policy can fix ===");
  for (const policy of [1, 2, 3] as const) {
    const [fixed, stuck] = tally[policy];
    console.log(`  P${policy}: fixes ${fixed}/${fixed + stuck}, leaves ${stuck}`);
  }
  console.log("  P1 = elbow X only · P2 = + inferred sides · P3 = + plain side hints (named ports always frozen)");
}
