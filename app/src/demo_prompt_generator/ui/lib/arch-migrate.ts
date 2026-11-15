/**
 * arch-migrate — turn an old flat diagram (lanes `columns`/`col`/`row`, `wraps` boxes,
 * `pin` banners, relational fields, `at`) into the nested format (lib/arch-layout.ts).
 *
 * It does not interpret the old placement fields one by one. It takes the geometry the old
 * engine (computeLayout) resolves — which is what the user saw — and decomposes it:
 *   1. every node goes into the smallest box that wraps it (or a box a banner is pinned to);
 *   2. inside each container, a recursive XY-cut: split the items into COLUMNS where a
 *      vertical gap runs through all of them, else into ROWS where a horizontal gap does,
 *      and recurse — groups become `group` containers, the measured gaps become `gap`;
 *   3. leaves that sat on one line across sibling columns get a shared `track`, so rows
 *      stay aligned;
 *   4. a region with no clean cut (a hand-composed slide) keeps its items as `at` offsets
 *      inside its container.
 * Pure; the result renders close to the original and edits like any nested file.
 */
import { computeLayout, type ArchitectureFile, type FileNode } from "./platform-architecture";
import { layoutNested } from "./arch-layout";

type R = { x0: number; y0: number; x1: number; y1: number };
interface Piece { id: string; r: R; node?: FileNode; kids?: Piece[] }

const OLD_PLACEMENT = ["col", "row", "wraps", "pin", "bounds", "alignX", "alignY", "below", "above", "leftOf", "rightOf", "gap", "at", "pad"] as const;
const MIN_GAP = 8;

/** True for a file in the old flat format (anything placed by lanes, wraps, pins or `at`
 *  without a nested `layout`). */
export function isFlatArchitectureFile(file: ArchitectureFile | null | undefined): boolean {
  if (!file || file.layout || !file.nodes?.length) return false;
  if (file.nodes.some((n) => Array.isArray(n.children))) return false;
  return true;
}

export function migrateToNested(file: ArchitectureFile): ArchitectureFile {
  const nodes = file.nodes ?? [];
  const placed = computeLayout(file);
  const rect = (id: string): R => {
    const b = placed.get(id);
    return b ? { x0: b.x - b.w / 2, y0: b.y - b.h / 2, x1: b.x + b.w / 2, y1: b.y + b.h / 2 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 1. parent box of every node: the smallest box that wraps it, or the box it is pinned to
  const area = (r: R) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const boxes = nodes.filter((n) => n.wraps?.length);
  const parent = new Map<string, string | null>();
  const wrapsAll = (b: FileNode, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    for (const c of b.wraps ?? []) {
      if (seen.has(c)) continue;
      seen.add(c); out.add(c);
      const cb = byId.get(c);
      if (cb?.wraps?.length) for (const x of wrapsAll(cb, seen)) out.add(x);
    }
    return out;
  };
  const members = new Map(boxes.map((b) => [b.id, wrapsAll(b)]));
  for (const n of nodes) {
    let best: string | null = n.pin?.to && byId.get(n.pin.to)?.wraps ? n.pin.to : null;
    if (!best) {
      for (const b of boxes) {
        if (b.id === n.id || !members.get(b.id)!.has(n.id)) continue;
        if (!best || area(rect(b.id)) < area(rect(best))) best = b.id;
      }
    }
    parent.set(n.id, best);
  }
  // 2. per container, XY-cut its items
  const itemsOf = (container: string | null): Piece[] =>
    nodes.filter((n) => parent.get(n.id) === container).map((n) => ({ id: n.id, r: rect(n.id), node: n }));


  const groupN = { v: 0 };
  const cut = (items: Piece[], axisFirst: "x" | "y"): FileNode[] => {
    if (items.length <= 1) return items.map(toNode);
    for (const axis of axisFirst === "x" ? (["x", "y"] as const) : (["y", "x"] as const)) {
      const bands = split(items, axis);
      if (bands.length < 2) continue;
      const gaps: number[] = [];
      for (let i = 1; i < bands.length; i++) gaps.push(lo(bands[i], axis) - hi(bands[i - 1], axis));
      const gap = Math.max(MIN_GAP, Math.round(median(gaps)));
      const children = bands.map((band) => {
        const inner = cut(band, axis === "x" ? "y" : "x");
        if (inner.length === 1) return inner[0];
        return { id: `grp-${++groupN.v}`, type: "group", layout: axis === "x" ? "column" : "row", gap: innerGap(band, axis === "x" ? "y" : "x"), children: inner } as FileNode;
      });
      const wrap = { id: `grp-${++groupN.v}`, type: "group", layout: axis === "x" ? "row" : "column", gap, align: alignOf(bands, axis), children } as FileNode;
      return [wrap];
    }
    // no clean cut: keep the composition as offsets inside the container
    const ox = Math.min(...items.map((p) => p.r.x0)), oy = Math.min(...items.map((p) => p.r.y0));
    return items.map((p) => ({ ...toNode(p), at: [Math.round((p.r.x0 + p.r.x1) / 2 - ox), Math.round((p.r.y0 + p.r.y1) / 2 - oy)] as [number, number] }));
  };
  const toNode = (p: Piece): FileNode => {
    const n = p.node!;
    const out: FileNode = { ...n };
    for (const k of OLD_PLACEMENT) delete (out as unknown as Record<string, unknown>)[k];
    if (n.wraps?.length) {
      // a box: its own items, cut the same way, become its children
      const inner = cut(itemsOf(n.id), "x");
      const only = inner.length === 1 && inner[0].type === "group" ? inner[0] : null;
      out.layout = only ? only.layout : "column";
      if (only?.gap !== undefined) out.gap = only.gap;
      if (only?.align) out.align = only.align;
      out.children = only ? only.children : inner;
      if (n.pad !== undefined) out.pad = n.pad;
    }
    return out;
  };

  const top = cut(itemsOf(null), file.direction === "vertical" ? "y" : "x");
  const root = top.length === 1 && top[0].type === "group" ? top[0] : null;
  const rootLayout = root?.layout ?? "row";
  globalTracks(root ? root.children! : top, rootLayout, rect);
  const { columns: _c, rowGrid: _rg, rowGap: _rgap, nodes: _n, ...tab } = file;
  const result: ArchitectureFile = {
    ...tab,
    layout: root?.layout ?? "row",
    ...(root?.gap !== undefined ? { gap: root.gap } : {}),
    ...(root?.align ? { align: root.align } : {}),
    nodes: root ? root.children! : top,
  };
  keepSolvableTracks(result);
  return result;
}

// ── geometry helpers ───────────────────────────────────────────────────────────────
const lo = (b: Piece[], a: "x" | "y") => Math.min(...b.map((p) => (a === "x" ? p.r.x0 : p.r.y0)));
const hi = (b: Piece[], a: "x" | "y") => Math.max(...b.map((p) => (a === "x" ? p.r.x1 : p.r.y1)));
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Split pieces into bands separated by a clean gap on `axis` (sorted). */
function split(items: Piece[], axis: "x" | "y"): Piece[][] {
  const s = [...items].sort((a, b) => (axis === "x" ? a.r.x0 - b.r.x0 : a.r.y0 - b.r.y0));
  const bands: Piece[][] = [];
  let cur: Piece[] = [], edge = -Infinity;
  for (const p of s) {
    const a0 = axis === "x" ? p.r.x0 : p.r.y0, a1 = axis === "x" ? p.r.x1 : p.r.y1;
    if (cur.length && a0 >= edge + MIN_GAP) { bands.push(cur); cur = []; }
    cur.push(p); edge = Math.max(cur.length > 1 ? edge : -Infinity, a1);
  }
  if (cur.length) bands.push(cur);
  return bands;
}

function innerGap(band: Piece[], axis: "x" | "y"): number {
  const parts = split(band, axis);
  const gaps: number[] = [];
  for (let i = 1; i < parts.length; i++) gaps.push(lo(parts[i], axis) - hi(parts[i - 1], axis));
  return Math.max(MIN_GAP, Math.round(median(gaps) || 32));
}

/** Cross-axis alignment that best reproduces the bands: tops level → start, else centre. */
function alignOf(bands: Piece[][], axis: "x" | "y"): "start" | "center" {
  const cross = axis === "x" ? "y" : "x";
  const starts = bands.map((b) => lo(b, cross));
  const mids = bands.map((b) => (lo(b, cross) + hi(b, cross)) / 2);
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  return spread(starts) + 2 < spread(mids) ? "start" : "center";
}

/** Leaves that were level in the old layout and sit in DIFFERENT containers get a shared
 *  track, when the container holding them all aligns on that axis (a row → same centre y,
 *  a column → same centre x). Same-parent neighbours are aligned by their container already. */
function globalTracks(top: FileNode[], rootLayout: string, rect: (id: string) => R): void {
  type L = { n: FileNode; chain: (FileNode | null)[]; c: { x: number; y: number } };
  const leaves: L[] = [];
  const walk = (ns: FileNode[], chain: (FileNode | null)[]) => {
    for (const n of ns) {
      if (n.children) walk(n.children, [...chain, n]);
      else { const r = rect(n.id); leaves.push({ n, chain, c: { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } }); }
    }
  };
  walk(top, [null]);
  const crossOf = (c: FileNode | null) => ((c ? c.layout : rootLayout) === "column" ? "x" : "y");
  let t = 0;
  for (const axis of ["y", "x"] as const) {
    const sorted = [...leaves].sort((a, b) => a.c[axis] - b.c[axis]);
    for (let i = 0; i < sorted.length; ) {
      let j = i + 1;
      while (j < sorted.length && sorted[j].c[axis] - sorted[i].c[axis] <= 3) j++;
      const group = sorted.slice(i, j).filter((l) => !l.n.track);
      i = j;
      if (group.length < 2) continue;
      const parents = new Set(group.map((l) => l.chain[l.chain.length - 1]));
      if (parents.size < 2) continue;
      // lowest common container of the group
      let lca: FileNode | null = null;
      for (let d = 0; group.every((l) => l.chain[d] !== undefined && l.chain[d] === group[0].chain[d]); d++) lca = group[0].chain[d];
      if (crossOf(lca) !== axis) continue;
      const name = `t${++t}`;
      for (const l of group) l.n.track = name;
    }
  }
}

/** Keep only the tracks the order allows: add them back one at a time and drop any whose
 *  alignment the layout cannot satisfy together with the ones already kept. */
function keepSolvableTracks(file: ArchitectureFile): void {
  const members = new Map<string, FileNode[]>();
  const walk = (ns: FileNode[] | undefined) => { for (const n of ns ?? []) { if (n.track) members.set(n.track, [...(members.get(n.track) ?? []), n]); walk(n.children); } };
  walk(file.nodes);
  if (!members.size) return;
  for (const ns of members.values()) for (const n of ns) delete n.track;
  for (const [t, ns] of members) {
    for (const n of ns) n.track = t;
    if (layoutNested(file).conflicts.length) for (const n of ns) delete n.track;
  }
}

