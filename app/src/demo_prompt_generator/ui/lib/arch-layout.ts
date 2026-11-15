/**
 * arch-layout — nested ("auto layout") placement for architecture diagrams.
 *
 * A diagram is a tree: the tab lays out its top-level nodes, and every container (a `box`
 * that draws a frame + title, or an invisible `group`) lays out its own `children` in a
 * row, a column or a grid. Sizes are computed bottom-up (leaves from `nodeFootprint`,
 * containers from their content + padding + title bands), positions top-down. So nested
 * boxes cannot overlap and nothing sits under a box title, by construction.
 *
 * On top of the tree:
 *   • tracks — nodes sharing `track` line up on their parent's cross axis, across
 *     containers (the traffic path of a network diagram on one line);
 *   • label gutters — the gap an edge label must sit in is widened to fit the label, so
 *     the label solver always has a slot off the tiles and borders;
 *   • `at` — a child placed at a fixed offset inside its parent (an escape hatch for
 *     hand-composed slides and redraws), out of the flow.
 *
 * The rest of the app consumes a FLAT node list (every node with a centre `at`, every box
 * with `size` + `wraps`). `flattenTree` produces it plus a `TreeMeta` record, and
 * `nestTree` turns a saved flat list back into the tree — re-parenting and re-ordering the
 * nodes a user dragged — so the UI and the agent edit the same structure. Pure.
 */
import {
  boxBorderTitleW,
  boxSubtitleH,
  cardGroupFonts,
  insideTitleMetrics,
  isInsideTitlePos,
  nodeFootprint,
  resolveTheme,
  sourceCaptionWidth,
  WRAP_PAD,
  type ArchitectureFile,
  type ArchitectureTheme,
  type ContainerAlign,
  type ContainerJustify,
  type ContainerLayout,
  type FileNode,
} from "./platform-architecture";
import { measureLabel } from "../components/project/platform-diagram/edges/label-chip";

// ── defaults ─────────────────────────────────────────────────────────────────────────
const ROOT_GAP = 100;
const BOX_GAP = 48;
const GROUP_GAP = 32;
/** Room kept on each side of an edge label inside the gap it sits in. */
const LABEL_MARGIN_X = 28;
const LABEL_MARGIN_Y = 18;
const TREE_KEYS = ["children", "layout", "cols", "align", "justify", "equal", "track"] as const;

/** A file is nested iff its tab declares `layout` or any node has `children`. */
export function isNestedFile(file: ArchitectureFile | null | undefined): boolean {
  if (!file) return false;
  if (file.layout) return true;
  const walk = (ns: FileNode[] | undefined): boolean => !!ns?.some((n) => Array.isArray(n.children) || walk(n.children));
  return walk(file.nodes);
}

export interface Rect { x: number; y: number; w: number; h: number } // CENTRE x/y

interface Item {
  node: FileNode | null; // null = the tab root
  id: string;
  parent: Item | null;
  kids: Item[];
  container: boolean;
  group: boolean;
  layout: ContainerLayout;
  gap: number;
  align: ContainerAlign;
  justify: ContainerJustify;
  // measured
  w: number; h: number;
  // top-left once placed
  x: number; y: number;
  // inset of the content area (box padding + title bands)
  inset: { t: number; r: number; b: number; l: number };
}

const isContainer = (n: FileNode) => Array.isArray(n.children);

function buildItems(file: ArchitectureFile): { root: Item; byId: Map<string, Item> } {
  const byId = new Map<string, Item>();
  const mk = (node: FileNode | null, parent: Item | null): Item => {
    const container = node ? isContainer(node) : true;
    const group = !!node && node.type === "group";
    const it: Item = {
      node, id: node?.id ?? "__root", parent, kids: [], container, group,
      layout: (node ? node.layout : file.layout) ?? "row",
      gap: (node ? node.gap : file.gap) ?? (!node ? ROOT_GAP : group ? GROUP_GAP : BOX_GAP),
      align: (node ? node.align : file.align) ?? "center",
      justify: (node ? node.justify : file.justify) ?? (((node ? node.layout : file.layout) ?? "row") === "row" ? "center" : "start"),
      w: 0, h: 0, x: 0, y: 0, inset: { t: 0, r: 0, b: 0, l: 0 },
    };
    if (node) byId.set(node.id, it);
    for (const c of (node ? node.children : file.nodes) ?? []) it.kids.push(mk(c, it));
    return it;
  };
  return { root: mk(null, null), byId };
}

/** Every node of the tree, depth-first (containers before their children). */
function* walkItems(it: Item): Generator<Item> {
  yield it;
  for (const k of it.kids) yield* walkItems(k);
}

/** Per-gap minimum size, keyed `${containerId}:${i}` for the gap after child i, from the
 *  labels that must sit in it: an edge between two siblings' subtrees that are adjacent in
 *  a row (or column) has its label in the gap between them. */
function labelGutters(file: ArchitectureFile, byId: Map<string, Item>, root: Item): Map<string, number> {
  const need = new Map<string, number>();
  const chain = (id: string): Item[] => {
    const out: Item[] = [];
    for (let it = byId.get(id) ?? null; it; it = it.parent) out.unshift(it);
    return out.length ? [root, ...out.filter((x) => x !== root)] : [];
  };
  const font = file.options?.edgeLabelSize;
  for (const e of file.edges ?? []) {
    if (!e.label) continue;
    const a = chain(String(e.from).split("@")[0]);
    const b = chain(String(e.to).split("@")[0]);
    if (!a.length || !b.length) continue;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const lca = a[i - 1];
    const ca = a[i], cb = b[i];
    if (!lca || !ca || !cb || lca.layout === "grid") continue;
    const ia = lca.kids.indexOf(ca), ib = lca.kids.indexOf(cb);
    if (Math.abs(ia - ib) !== 1) continue;
    const m = measureLabel(e.label, font);
    const size = lca.layout === "row" ? m.w + 2 * LABEL_MARGIN_X : m.h + 2 * LABEL_MARGIN_Y;
    const key = `${lca.id}:${Math.min(ia, ib)}`;
    need.set(key, Math.max(need.get(key) ?? 0, size));
  }
  return need;
}

interface Ctx {
  theme: ArchitectureTheme;
  fonts: Map<string, number>;
  gutters: Map<string, number>;
  /** extra offset before an item, per axis, grown by the track pass: on its parent's
   *  main axis it is space before it, on the cross axis a shift */
  margin: Map<string, { x: number; y: number }>;
}

const gapAfter = (it: Item, i: number, ctx: Ctx) => Math.max(it.gap, ctx.gutters.get(`${it.id}:${i}`) ?? 0);
const crossOf = (it: Item | null): "x" | "y" => (it?.layout === "column" ? "x" : "y");

function boxInsets(n: FileNode, width: number): { t: number; r: number; b: number; l: number } {
  const pad = n.pad ?? (n.type === "group" ? 0 : WRAP_PAD);
  if (n.type === "group") return { t: pad, r: pad, b: pad, l: pad };
  if (isInsideTitlePos(n.titlePos)) {
    const band = insideTitleMetrics(n, width).band;
    const top = n.titlePos === "top" || n.titlePos === "top-left";
    return { t: pad + (top ? band : 0), r: pad, b: pad + (top ? 0 : band), l: pad };
  }
  return { t: pad + boxSubtitleH(n.subtitle, width), r: pad, b: pad, l: pad };
}

/** Bottom-up: the size of every item. */
function measure(it: Item, ctx: Ctx): void {
  if (!it.container) {
    const n = it.node!;
    const s = nodeFootprint(n, ctx.theme, ctx.fonts);
    // A captioned source is drawn as wide as its label needs (the renderer fits it), so
    // reserve that width, as the lane engine does.
    const capW = n.type === "source" && !n.size && n.label ? sourceCaptionWidth(n.label, n.fontSize ?? undefined) : 0;
    it.w = Math.max(s.w, capW); it.h = s.h;
    return;
  }
  for (const k of it.kids) measure(k, ctx);
  const flow = it.kids.filter((k) => !Array.isArray(k.node?.at));
  // equal: children share the largest size on the chosen axes
  const eq = it.node ? it.node.equal : undefined;
  if (eq && flow.length) {
    const mw = Math.max(...flow.map((k) => k.w)), mh = Math.max(...flow.map((k) => k.h));
    for (const k of flow) {
      if (eq === true || eq === "w") k.w = mw;
      if (eq === true || eq === "h") k.h = mh;
    }
  }
  const mx_ = (k: Item) => ctx.margin.get(k.id)?.x ?? 0;
  const my_ = (k: Item) => ctx.margin.get(k.id)?.y ?? 0;
  let cw = 0, ch = 0;
  if (it.layout === "grid") {
    const cols = Math.max(1, it.node?.cols ?? Math.ceil(Math.sqrt(flow.length)));
    const colW: number[] = [], rowH: number[] = [];
    flow.forEach((k, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      colW[c] = Math.max(colW[c] ?? 0, k.w + mx_(k));
      rowH[r] = Math.max(rowH[r] ?? 0, k.h + my_(k));
    });
    cw = colW.reduce((a, b) => a + b, 0) + it.gap * Math.max(0, colW.length - 1);
    ch = rowH.reduce((a, b) => a + b, 0) + it.gap * Math.max(0, rowH.length - 1);
  } else {
    const row = it.layout === "row";
    let sum = 0, mx = 0;
    flow.forEach((k, i) => {
      sum += (row ? k.w + mx_(k) : k.h + my_(k)) + (i < flow.length - 1 ? gapAfter(it, i, ctx) : 0);
      mx = Math.max(mx, row ? k.h + my_(k) : k.w + mx_(k));
    });
    if (row) { cw = sum; ch = mx; } else { cw = mx; ch = sum; }
  }
  // absolutely placed children widen the content box to include them
  for (const k of it.kids) {
    const at = k.node?.at;
    if (!Array.isArray(at)) continue;
    cw = Math.max(cw, at[0] + k.w / 2);
    ch = Math.max(ch, at[1] + k.h / 2);
  }
  if (!it.node) { it.w = cw; it.h = ch; return; }
  const n = it.node;
  // width first (title bands depend on it), then the insets at that width
  let inset = boxInsets(n, cw);
  let w = Math.max(cw + inset.l + inset.r, n.size?.[0] ?? 0, n.type === "group" ? 0 : boxBorderTitleW(n, ctx.theme) || 0);
  inset = boxInsets(n, w);
  const h = Math.max(ch + inset.t + inset.b, n.size?.[1] ?? 0);
  it.inset = inset; it.w = w; it.h = h;
}

/** Top-down: place an item's children inside it (it.x/y = its top-left). */
function place(it: Item, ctx: Ctx): void {
  if (!it.container) return;
  const flow = it.kids.filter((k) => !Array.isArray(k.node?.at));
  const mx_ = (k: Item) => ctx.margin.get(k.id)?.x ?? 0;
  const my_ = (k: Item) => ctx.margin.get(k.id)?.y ?? 0;
  const ix = it.x + it.inset.l, iy = it.y + it.inset.t;
  const iw = it.w - it.inset.l - it.inset.r, ih = it.h - it.inset.t - it.inset.b;
  const alignOff = (space: number, size: number) =>
    it.align === "start" || it.align === "stretch" ? 0 : it.align === "end" ? space - size : (space - size) / 2;
  // stretch: a container child takes the parent's full cross size (a banner row that
  // spans its box); leaves keep their size.
  if (it.align === "stretch" && it.layout !== "grid") {
    for (const k of flow) if (k.container) { if (it.layout === "row") k.h = ih - my_(k); else k.w = iw - mx_(k); }
  }

  if (it.layout === "grid") {
    const cols = Math.max(1, it.node?.cols ?? Math.ceil(Math.sqrt(flow.length)));
    const colW: number[] = [], rowH: number[] = [];
    flow.forEach((k, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      colW[c] = Math.max(colW[c] ?? 0, k.w + mx_(k));
      rowH[r] = Math.max(rowH[r] ?? 0, k.h + my_(k));
    });
    const totalW = colW.reduce((a, b) => a + b, 0) + it.gap * Math.max(0, colW.length - 1);
    const totalH = rowH.reduce((a, b) => a + b, 0) + it.gap * Math.max(0, rowH.length - 1);
    const ox = ix + (iw - totalW) / 2, oy = iy + (ih - totalH) / 2;
    flow.forEach((k, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const cx = ox + colW.slice(0, c).reduce((a, b) => a + b, 0) + it.gap * c;
      const cy = oy + rowH.slice(0, r).reduce((a, b) => a + b, 0) + it.gap * r;
      k.x = cx + (colW[c] - mx_(k) - k.w) / 2 + mx_(k);
      k.y = cy + alignOff(rowH[r] - my_(k), k.h) + my_(k);
    });
  } else {
    const row = it.layout === "row";
    const mainSize = (k: Item) => (row ? k.w + mx_(k) : k.h + my_(k));
    let total = 0;
    flow.forEach((k, i) => { total += mainSize(k) + (i < flow.length - 1 ? gapAfter(it, i, ctx) : 0); });
    // Main axis: start / centre / end, or "between" (spare room shared between children).
    const space = (row ? iw : ih) - total;
    const extra = it.justify === "between" && flow.length > 1 ? space / (flow.length - 1) : 0;
    const lead = it.justify === "center" ? space / 2 : it.justify === "end" ? space : 0;
    let cursor = (row ? ix : iy) + lead;
    flow.forEach((k, i) => {
      if (row) {
        k.x = cursor + mx_(k);
        k.y = iy + alignOff(ih - my_(k), k.h) + my_(k);
      } else {
        k.y = cursor + my_(k);
        k.x = ix + alignOff(iw - mx_(k), k.w) + mx_(k);
      }
      cursor += mainSize(k) + (i < flow.length - 1 ? gapAfter(it, i, ctx) + extra : 0);
    });
  }
  for (const k of it.kids) {
    const at = k.node?.at;
    if (Array.isArray(at)) { k.x = ix + at[0] - k.w / 2; k.y = iy + at[1] - k.h / 2; }
  }
  for (const k of it.kids) place(k, ctx);
}

export interface NestedLayout {
  rects: Map<string, Rect>;
  /** Tracks dropped because the child order makes them impossible. */
  conflicts: string[];
  /** Items in tree order, for flattening. */
  root: Item;
  byId: Map<string, Item>;
}

/** Solve a nested tab: every node's centre rect. */
export function layoutNested(file: ArchitectureFile): NestedLayout {
  const { root, byId } = buildItems(file);
  const flat: FileNode[] = [];
  for (const it of walkItems(root)) if (it.node) flat.push(it.node);
  const ctx: Ctx = {
    theme: resolveTheme(file.theme),
    fonts: cardGroupFonts(flat as never),
    gutters: labelGutters(file, byId, root),
    margin: new Map(),
  };
  const solve = () => { measure(root, ctx); root.x = 0; root.y = 0; place(root, ctx); };
  solve();
  // Tracks: push each member down (or right) until its centre meets the furthest member's.
  // Offsets only grow, so this converges; a few passes settle nested cases.
  const tracks = new Map<string, Item[]>();
  for (const it of walkItems(root)) {
    const t = it.node?.track;
    if (t) tracks.set(t, [...(tracks.get(t) ?? []), it]);
  }
  // A track aligns on the cross axis of its members' lowest common container: members in
  // two columns of a row line up on y. Pushing one member can only reach the others
  // through centring (at most halved), so the passes converge.
  // The common container lines its children up from the start of that axis: centring
  // would re-centre one branch whenever another grows, and the members would chase a
  // moving target. With start alignment a push only travels forward in its own branch.
  const lcaOf = (members: Item[]): Item | null => {
    const chain = (k: Item) => { const c: Item[] = []; for (let p = k.parent; p; p = p.parent) c.unshift(p); return c; };
    const chains = members.map(chain);
    let lca: Item | null = null;
    for (let i = 0; chains.every((c) => c[i] && c[i] === chains[0][i]); i++) lca = chains[0][i];
    return lca;
  };
  const axes = new Map<string, "x" | "y">();
  for (const [t, ms] of tracks) {
    const lca = lcaOf(ms);
    axes.set(t, crossOf(lca));
    if (lca) lca.align = "start";
  }
  if (tracks.size) solve();
  // Tracks the order makes impossible (dev above prod in one column, below it in the
  // next) never settle: their offsets grow every pass. Stop, drop the offsets and report
  // them (trackConflicts) rather than let the layout run away.
  let settled = !tracks.size;
  let worst = Infinity, worse = 0;
  for (let pass = 0; pass < 40 && tracks.size; pass++) {
    let moved = false;
    let maxD = 0;
    for (const [t, members] of tracks) {
      const axis = axes.get(t)!;
      const centre = (k: Item) => (axis === "y" ? k.y + k.h / 2 : k.x + k.w / 2);
      const target = Math.max(...members.map(centre));
      for (const k of members) {
        const d = target - centre(k);
        maxD = Math.max(maxD, d);
        if (d > 0.5) {
          const cur = ctx.margin.get(k.id) ?? { x: 0, y: 0 };
          ctx.margin.set(k.id, axis === "y" ? { ...cur, y: cur.y + d } : { ...cur, x: cur.x + d });
          moved = true;
        }
      }
    }
    if (process.env.ARCH_TRACK_DEBUG) console.log("pass", pass, [...ctx.margin].map(([k, v]) => k + ":" + Math.round(v.x) + "/" + Math.round(v.y)).join(" "));
    if (!moved) { settled = true; break; }
    if (maxD >= worst - 0.5) { if (++worse >= 4) break; } else { worst = maxD; worse = 0; }
    solve();
  }
  const conflicts: string[] = [];
  if (!settled && tracks.size) {
    conflicts.push(...tracks.keys());
    ctx.margin.clear();
    solve();
  }
  const rects = new Map<string, Rect>();
  for (const it of walkItems(root)) {
    if (it.node) rects.set(it.id, { x: it.x + it.w / 2, y: it.y + it.h / 2, w: it.w, h: it.h });
  }
  return { rects, root, byId, conflicts };
}

/** Problems a nested file has that the flat checks can't see (for validateArchitecture). */
export function nestedIssues(file: ArchitectureFile): string[] {
  if (!isNestedFile(file)) return [];
  const out: string[] = [];
  const { conflicts } = layoutNested(file);
  if (conflicts.length) out.push(`tracks ${conflicts.map((c) => `"${c}"`).join(", ")} cannot all line up with this child order; alignment was dropped. Put the members in the same order in every container.`);
  const seen = new Set<string>();
  const walk = (ns: FileNode[] | undefined) => { for (const n of ns ?? []) { if (seen.has(n.id)) out.push(`node id "${n.id}" is used twice`); seen.add(n.id); walk(n.children); } };
  walk(file.nodes);
  return out;
}

// ── flatten / nest: the bridge to the flat pipeline and back ──────────────────────────

export interface TreeEntry {
  parent: string | null; // null = the tab root; may be a group id
  index: number;
  /** The node's tree-only fields + authored `size`/`at`, re-emitted on save. */
  props: Partial<FileNode>;
  /** Groups are layout-only: the whole node (minus children) is kept here. */
  group?: FileNode;
  container: boolean;
  layout: ContainerLayout;
  rect: Rect;
}
export interface TreeMeta {
  root: Pick<ArchitectureFile, "layout" | "gap" | "align" | "justify" | "cols" | "equal">;
  entries: Record<string, TreeEntry>;
}

/** The flat file the rest of the app renders: every node at its solved centre, every box
 *  sized and wrapping its (non-group) descendants; groups dropped. Plus the tree record. */
export function flattenTree(file: ArchitectureFile): { file: ArchitectureFile; tree: TreeMeta } {
  const { rects, root } = layoutNested(file);
  const entries: Record<string, TreeEntry> = {};
  const nodes: FileNode[] = [];
  // ids a box wraps: its children, looking through groups
  const visible = (it: Item): string[] => it.kids.flatMap((k) => (k.group ? visible(k) : [k.id]));
  const rec = (it: Item) => {
    it.kids.forEach((k, index) => {
      const n = k.node!;
      const r = rects.get(k.id)!;
      const props: Partial<FileNode> = {};
      for (const key of TREE_KEYS) if (key !== "children" && n[key] !== undefined) (props as Record<string, unknown>)[key] = n[key];
      if (n.size) props.size = n.size;
      if (Array.isArray(n.at)) props.at = n.at;
      if (k.container && n.gap !== undefined) props.gap = n.gap;
      if (k.container && n.pad !== undefined) props.pad = n.pad;
      const { children: _c, layout: _l, cols: _co, align: _a, justify: _j, equal: _e, track: _t, ...rest } = n;
      entries[k.id] = {
        parent: it.node ? it.id : null, index, props, container: k.container, layout: k.layout, rect: r,
        ...(k.group ? { group: rest as FileNode } : {}),
      };
      if (!k.group) {
        const flatNode: FileNode = { ...rest, at: [Math.round(r.x), Math.round(r.y)] };
        // the solved size: always for a box; for a leaf only when `equal` stretched it
        const natural = !k.container && !n.size;
        const stretched = natural && (Math.abs(r.w - nodeFootprint(n, resolveTheme(file.theme), new Map()).w) > 1);
        if (k.container) { flatNode.size = [Math.round(r.w), Math.round(r.h)]; flatNode.wraps = visible(k); delete flatNode.gap; }
        else if (stretched && (n.type === "card" || n.type === "html" || n.type === "source")) flatNode.size = [Math.round(r.w), Math.round(r.h)];
        nodes.push(flatNode);
      }
      rec(k);
    });
  };
  rec(root);
  const { layout, gap, align, justify, cols, equal, nodes: _n, ...tab } = file;
  return {
    file: { ...tab, nodes },
    tree: { root: { layout: layout ?? "row", ...(gap !== undefined ? { gap } : {}), ...(align ? { align } : {}), ...(justify ? { justify } : {}), ...(cols ? { cols } : {}), ...(equal !== undefined ? { equal } : {}) }, entries },
  };
}

/** Rebuild the nested file from a saved FLAT file (what serializeArchitecture emits) and
 *  the tree record of the last layout. A node whose centre moved (the user dragged it) is
 *  re-parented into the deepest container its new centre falls in and re-ordered among
 *  its new siblings by position; a node the tree doesn't know (added in the UI) is
 *  placed the same way. A node with an authored `at` keeps a fixed offset in its parent.
 *  Resizing a node keeps the new size as its `size`. Nothing else is written as pixels. */
export function nestTree(flat: ArchitectureFile, tree: TreeMeta): ArchitectureFile {
  const E = tree.entries;
  const flatNodes = flat.nodes ?? [];
  const present = new Map(flatNodes.map((n) => [n.id, n]));
  const MOVE_EPS = 3;
  // where each node goes: parent + sort key
  const parentOf = new Map<string, string | null>();
  const keyOf = new Map<string, number>();
  const containers = Object.entries(E).filter(([, e]) => e.container).map(([id, e]) => ({ id, e }));
  const isDesc = (id: string, anc: string): boolean => {
    for (let p = E[id]?.parent ?? null; p; p = E[p]?.parent ?? null) if (p === anc) return true;
    return false;
  };
  const dropTarget = (id: string, x: number, y: number): string | null => {
    let best: { id: string; area: number } | null = null;
    for (const { id: cid, e } of containers) {
      if (cid === id || isDesc(cid, id)) continue;
      if (!present.has(cid) && !e.group) continue;
      const r = e.rect;
      if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(y - r.y) <= r.h / 2) {
        const area = r.w * r.h;
        if (!best || area < best.area) best = { id: cid, area };
      }
    }
    return best?.id ?? null;
  };
  const mainKey = (parent: string | null, x: number, y: number) => {
    const lay = parent ? E[parent]?.layout : tree.root.layout;
    return lay === "column" ? y : lay === "grid" ? y * 10000 + x : x;
  };
  const moved = new Set<string>();
  for (const n of flatNodes) {
    const e = E[n.id];
    const at = n.at;
    if (e && at && Math.hypot(at[0] - e.rect.x, at[1] - e.rect.y) <= MOVE_EPS) {
      parentOf.set(n.id, e.parent);
      keyOf.set(n.id, e.index);
      continue;
    }
    if (!at) { parentOf.set(n.id, e?.parent ?? null); keyOf.set(n.id, e?.index ?? 1e9); continue; }
    moved.add(n.id);
    const p = e?.props.at ? e.parent : dropTarget(n.id, at[0], at[1]);
    parentOf.set(n.id, p);
    keyOf.set(n.id, mainKey(p, at[0], at[1]));
  }
  // A node carried along by a moved container (the canvas drags a box with its content)
  // keeps its place: same displacement as its nearest moved ancestor = not moved itself.
  const delta = (id: string) => {
    const n = present.get(id), e = E[id];
    return n?.at && e ? { dx: n.at[0] - e.rect.x, dy: n.at[1] - e.rect.y } : null;
  };
  for (const id of [...moved]) {
    const d = delta(id);
    for (let p = E[id]?.parent ?? null; p && d; p = E[p]?.parent ?? null) {
      const dp = moved.has(p) ? delta(p) : null;
      if (dp && Math.hypot(dp.dx - d.dx, dp.dy - d.dy) <= MOVE_EPS) {
        moved.delete(id);
        parentOf.set(id, E[id].parent);
        keyOf.set(id, E[id].index);
        break;
      }
    }
  }
  // groups survive from the record (they have no flat node)
  for (const [id, e] of Object.entries(E)) if (e.group) { parentOf.set(id, e.parent); keyOf.set(id, e.index); }
  // ordering: unmoved siblings keep their index; a moved node slots in by position among
  // its siblings' recorded centres.
  const kidsOf = new Map<string | null, string[]>();
  for (const [id, p] of parentOf) kidsOf.set(p, [...(kidsOf.get(p) ?? []), id]);
  const sortKids = (p: string | null, ids: string[]): string[] => {
    const anyMoved = ids.some((id) => moved.has(id));
    if (!anyMoved) return ids.sort((a, b) => (keyOf.get(a)! - keyOf.get(b)!));
    const pos = (id: string) => {
      const n = present.get(id), e = E[id];
      const c = moved.has(id) && n?.at ? { x: n.at[0], y: n.at[1] } : e ? { x: e.rect.x, y: e.rect.y } : { x: 0, y: 0 };
      return mainKey(p, c.x, c.y);
    };
    return ids.sort((a, b) => pos(a) - pos(b));
  };
  const build = (p: string | null): FileNode[] =>
    sortKids(p, kidsOf.get(p) ?? []).flatMap((id) => {
      const e = E[id];
      let node: FileNode;
      if (e?.group) {
        node = { ...e.group, ...e.props };
      } else {
        const n = present.get(id);
        if (!n) return [];
        const { at, size, wraps: _w, ...rest } = n;
        node = { ...rest, ...(e?.props ?? {}) };
        delete node.at;
        // a resize in the UI: keep the new size (a box's or card's solved size is not a resize)
        if (size && e) {
          const solved = [Math.round(e.rect.w), Math.round(e.rect.h)];
          if (Math.abs(size[0] - solved[0]) > 2 || Math.abs(size[1] - solved[1]) > 2) node.size = size;
        } else if (size && !e) node.size = size;
        // a fixed-offset child keeps its offset, re-based on the parent's content origin
        if (e?.props.at && at && moved.has(id)) {
          const pr = e.parent ? E[e.parent]?.rect : null;
          node.at = pr ? [Math.round(at[0] - (pr.x - pr.w / 2)), Math.round(at[1] - (pr.y - pr.h / 2))] : [at[0], at[1]];
        } else if (e?.props.at) node.at = e.props.at;
      }
      if (e?.container) {
        node.children = build(id);
        if (!node.children.length && e?.group) return [];
      }
      return [node];
    });
  const { nodes: _n, ...tab } = flat;
  return { ...tab, ...tree.root, nodes: build(null) };
}
