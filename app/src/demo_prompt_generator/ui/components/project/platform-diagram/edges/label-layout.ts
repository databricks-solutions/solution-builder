/**
 * platform-diagram/edges/label-layout — deterministic de-confliction of EDGE
 * LABELS.
 *
 * The router drops a label at the path's midpoint (or elbow centre) with no
 * collision avoidance at all, so in a dense diagram a third of them land on a
 * tile or on each other. `inspect-arch.mjs` has always REPORTED that
 * (`LABEL OVERLAPS`, `LABEL OVER NODE/TITLE`) and the fix was for the author to
 * shuffle rows by hand. This pass makes it correct by construction instead.
 *
 * How: for each labelled edge, score a small set of candidate offsets around the
 * anchor and take the best.
 *
 *   • SLIDE ALONG THE WHOLE PATH — candidate positions are sampled along the
 *     edge's entire polyline, so the label stays ON its own line by construction
 *     and can travel round corners to find room. (It used to be confined to the
 *     single straight run its anchor happened to sit on; for a lane-spanning edge
 *     that run is a short stub, so the label was TRAPPED and got dumped on a tile
 *     — measured 95×12 and 69×12 overlaps on the long-span corpus case.)
 *   • STEP ACROSS only as a last resort — it detaches the label from its line, so
 *     it is capped tight and priced well above sliding.
 *   • A SMALL overlap is FREE. Below `FREE_OVERLAP` px² a clip is invisible, and
 *     pricing it as catastrophic is what made the solver fling labels across the
 *     canvas (7 of 15 labels wore a leader line) rather than accept a 7px nick.
 *     Past that the cost grows SUPERLINEARLY, so a real cover-up still loses.
 *   • Covering a TILE destroys more meaning than clipping a neighbouring label,
 *     so a node overlap outweighs any amount of label overlap.
 *
 * Scoring (rather than first-fit) matters because a congested diagram may have NO
 * clean slot; scoring picks the least-bad one instead of falling back to
 * candidate 0 — the one already known to collide.
 *
 * Pure — no React, no ReactFlow context. Memoized on a geometry+label signature
 * like `fan-layout` / `crossings`, so the E edge selectors that call it in one
 * store tick share ONE computation.
 *
 * Deliberately NOT persisted: offsets are derived, never written to
 * `architecture.md`. A user who wants a specific spot drags the elbow handle
 * (manual `centerX`), which this pass then leaves alone — see `MANUAL` below.
 */
import { type Rect, rectOf } from "../edge-routing";
import { computeFanLayout } from "../fan-layout";
import { type EdgeShape, drawnPath, pathToPolyline, segmentHitsRect, titleStripOf } from "./edge-geometry";
import { measureLabel } from "./label-chip";

export interface LabelOffset {
  /** Offset from the router's anchor, in flow coords. */
  dx: number;
  dy: number;
  /** Draw a leader line back to the anchor (label stepped off its line). */
  leader: boolean;
}

/** Neutral entry — the anchor is already clean, or the edge is user-positioned. */
const NO_OFFSET: LabelOffset = { dx: 0, dy: 0, leader: false };

interface LabelEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
  data?: {
    shape?: EdgeShape;
    centerX?: number;
    labelPos?: { d?: number; from?: "source" | "target"; off?: number; t?: number };
    /** Chip font size (px) — the tab's `options.edgeLabelSize`. Unset → EDGE_LABEL_FONT. */
    labelFontSize?: number;
  } | null;
}
interface LabelNode {
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width?: number; height?: number };
}
type NodeLookup = Map<string, LabelNode>;

/** Breathing room required around a chip before it counts as clear. */
const GAP = 5;

// Chip metrics + wrapping live in `label-chip`, shared with the FlowEdge pill
// that actually renders them — never re-derive a size here.

// --- Penalty weights -------------------------------------------------------
/** Overlap area (px²) that is not worth moving for. Kept at the checker's own tolerance
 *  (`inspect-arch` flags an overlap only past ~6px on both axes ≈ 36px²; 30 leaves room for a
 *  rounded chip edge). It was 130: a 12×17 clip of a tile read as "free", so the solver accepted a
 *  label that the checker then reported as over the node. */
const FREE_OVERLAP = 30;
/** Per px² BEYOND the free allowance, for a tile. Squared so a genuine cover-up
 *  dominates while a marginal clip stays cheap. */
const W_NODE = 40;
/** Per px² of overlap with another label: bad, but both stay readable-ish. */
const W_LABEL = 1;
/** Per px of travel ALONG the path — nearly free: the label stays on its line. */
const W_ALONG = 3;
/** Per px ACROSS — detaches the label, so priced ~10x the along cost. */
const W_ACROSS = 32;

/** Fractions of the path length to try, centre-out. Sampling the WHOLE path lets
 *  a label round a corner into open space instead of being stuck on one run. */
const ALONG_FRACTIONS = (() => {
  const out = [0.5];
  for (let d = 0.05; d <= 0.34; d += 0.05) { out.push(0.5 - d, 0.5 + d); }
  return out;
})();
/** Per container BORDER a candidate pill straddles. A pill fully inside or fully outside a
 *  box is fine; one sitting ON the border reads as belonging to whatever the box is drawn
 *  around (and the box's own edge runs through its text). Priced like a line it could be
 *  mistaken for, below a tile cover-up. */
const W_BORDER = 1200;
/** Per candidate pill that another edge's LINE runs through. A label stranded on
 *  someone else's line reads as belonging to it (inspect-arch: EDGE UNDER LABEL), so
 *  this is priced well above a sideways slide, but below a tile cover-up. */
const W_LINE = 400;
/** Per px a label slides sideways to clear an obstacle's edge (pass 2 only). */
const W_ALONG_PX = 2;
/** Farthest a pass-2 sideways snap may move along the path (px). */
const SNAP_ALONG = 80;
/** Candidate steps across the path (px) — deliberately tight. */

const ACROSS_STEPS = [0, -14, 14, -26, 26];
/** Per candidate pill covering an edge END (its arrowhead / dot). The label sits on the line,
 *  so an end is where it most easily hides the one mark that says which way the arrow goes. */
const W_ARROW = 300;
/** Half-size of the zone around each edge end a label must not cover (px). */
const END_ZONE = 10;
/** Farthest a snapped candidate may sit from the line (px). Beyond this the label reads as
 *  belonging to nothing, so the search gives up and keeps the least-bad on-line slot. */
const SNAP_REACH = 160;
/** Across-drift past this gets a leader line so the label still reads attached. */
const LEADER_AT = 20;
/** Only obstacles within this radius of the anchor can matter. Keeps the search
 *  O(E · candidates · LOCAL) instead of O(E · candidates · N) on big diagrams. */
const NEAR = 420;

/** A point at `frac` along a polyline, plus the local direction there — so "across"
 *  is always perpendicular to the line the label is sitting on. */
function pointAlong(
  poly: { x: number; y: number }[],
  frac: number,
): { x: number; y: number; horizontal: boolean } | null {
  if (poly.length < 2) return null;
  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; len: number }[] = [];
  let total = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0.01) { segs.push({ a, b, len }); total += len; }
  }
  if (!segs.length || total <= 0) return null;
  let want = Math.max(0, Math.min(1, frac)) * total;
  for (const s of segs) {
    if (want <= s.len) {
      const t = s.len > 0 ? want / s.len : 0;
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      return {
        x: s.a.x + dx * t, y: s.a.y + dy * t,
        horizontal: Math.abs(dx) >= Math.abs(dy),
      };
    }
    want -= s.len;
  }
  const last = segs[segs.length - 1];
  return {
    x: last.b.x, y: last.b.y,
    horizontal: Math.abs(last.b.x - last.a.x) >= Math.abs(last.b.y - last.a.y),
  };
}

/** Overlap AREA of two rects, `gap` inflating the first. 0 = clear. */
function overlapArea(a: Rect, b: Rect, gap = 0): number {
  const w = Math.min(a.x + a.w + gap, b.x + b.w) - Math.max(a.x - gap, b.x);
  const h = Math.min(a.y + a.h + gap, b.y + b.h) - Math.max(a.y - gap, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const encloses = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - 2 && inner.y >= outer.y - 2 &&
  inner.x + inner.w <= outer.x + outer.w + 2 &&
  inner.y + inner.h <= outer.y + outer.h + 2;

// --- 1-deep memo cache (same pattern as fan-layout / crossings) -------------
let cacheSig = "";
let cacheMap: Map<string, LabelOffset> = new Map();

function signature(edges: LabelEdge[], nodeLookup: NodeLookup): string {
  let s = "";
  // Every edge's routing inputs: its drawn line is an obstacle for OTHER labels.
  for (const e of edges) {
    s += `#${e.id}:${e.source}>${e.target}:${e.sourceHandle ?? ""}/${e.targetHandle ?? ""}:${e.data?.shape ?? ""}:${e.data?.centerX ?? ""};`;
  }
  for (const e of edges) {
    if (typeof e.label !== "string" || !e.label) continue;
    // The label TEXT, not just its length: wrapping depends on word boundaries,
    // so two same-length labels can occupy different boxes.
    // labelPos: a manual label leaves the solver, which re-places the others.
    s += `${e.id}:${e.source}>${e.target}:${e.label}:${e.data?.centerX ?? ""}:${e.data?.labelFontSize ?? ""}:${e.data?.labelPos ? JSON.stringify(e.data.labelPos) : ""};`;
  }
  // Every node is a potential obstacle, not just the endpoints — a label can
  // land on a tile that neither end of its edge touches.
  s += "|";
  for (const [nid, n] of nodeLookup) {
    const p = n.internals.positionAbsolute;
    s += `${nid}:${Math.round(p.x)},${Math.round(p.y)},${n.measured.width ?? 0}x${n.measured.height ?? 0};`;
  }
  return s;
}

/**
 * Compute (or return cached) label offsets for every labelled edge.
 * Edges are processed in a stable id order so the result never depends on the
 * incoming array order (two runs over the same diagram must agree).
 */
export function computeLabelOffsets(
  edges: LabelEdge[],
  nodeLookup: NodeLookup,
): Map<string, LabelOffset> {
  const sig = signature(edges, nodeLookup);
  if (sig === cacheSig) return cacheMap;

  const out = new Map<string, LabelOffset>();
  const labelled = edges
    .filter((e): e is LabelEdge & { label: string } => typeof e.label === "string" && !!e.label)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (labelled.length === 0) {
    cacheSig = sig;
    cacheMap = out;
    return out;
  }

  const fan = computeFanLayout(edges, nodeLookup);
  const rect = (nid: string): Rect | null => {
    const n = nodeLookup.get(nid);
    return n ? rectOf(n as never) : null;
  };

  // Split nodes into TILES (obstacles in full) and CONTAINERS (only their title
  // strip is an obstacle — a label INSIDE a platform/cloud box is normal and
  // must not be pushed out of it).
  const all: { id: string; r: Rect }[] = [];
  for (const [nid] of nodeLookup) {
    const r = rect(nid);
    if (r && r.w > 0 && r.h > 0) all.push({ id: nid, r });
  }
  const obstacles: Rect[] = [];
  // Containers in full: a pill may not STRADDLE one of these borders (see W_BORDER).
  const frames: Rect[] = [];
  for (const { id, r } of all) {
    const isContainer = all.some((o) => o.id !== id && encloses(r, o.r));
    if (isContainer) frames.push(r);
    obstacles.push(isContainer ? titleStripOf(r) : r);
  }

  // Every edge's drawn line (of ANY edge, labelled or not) as segments. A pill sitting
  // on another edge's line reads as that edge's label, so those lines are obstacles.
  // Built once per solve from the same drawnPath the renderer uses.
  const lines: { id: string; a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const e of edges) {
    const f = fan.get(e.id);
    const sR = rect(e.source);
    const tR = rect(e.target);
    if (!f || !sR || !tR) continue;
    const poly = pathToPolyline(drawnPath(f, sR, tR, e.data?.shape ?? "smooth", e.data?.centerX).path);
    for (let i = 1; i < poly.length; i++) lines.push({ id: e.id, a: poly[i - 1], b: poly[i] });
  }
  /** Count of OTHER edges' line segments crossing a candidate pill. Bbox-prefiltered so
   *  the per-candidate cost stays a handful of tests, not a scan of every segment. */
  const lineHits = (r: Rect, ownId: string): number => {
    let n = 0;
    for (const seg of lines) {
      if (seg.id === ownId) continue;
      if (Math.max(seg.a.x, seg.b.x) < r.x || Math.min(seg.a.x, seg.b.x) > r.x + r.w) continue;
      if (Math.max(seg.a.y, seg.b.y) < r.y || Math.min(seg.a.y, seg.b.y) > r.y + r.h) continue;
      if (segmentHitsRect(seg.a, seg.b, r, 0)) n++;
    }
    return n;
  };

  const placed: Rect[] = [];
  for (const e of labelled) {
    const f = fan.get(e.id);
    const sR = rect(e.source);
    const tR = rect(e.target);
    if (!f || !sR || !tR) { out.set(e.id, NO_OFFSET); continue; }

    const shape = e.data?.shape ?? "smooth";
    const dp = drawnPath(f, sR, tR, shape, e.data?.centerX);
    const size = measureLabel(e.label, e.data?.labelFontSize);
    const at = (dx: number, dy: number): Rect => ({
      x: dp.labelX + dx - size.w / 2,
      y: dp.labelY + dy - size.h / 2,
      w: size.w, h: size.h,
    });

    // MANUAL — the user positioned this label by hand, either by dragging the CHIP
    // itself (`labelPos`, a fraction along the path) or by parking the edge's elbow
    // (`centerX`, which moves the whole line and the label with it). Respect either
    // exactly, but still register the chip so AUTO labels route around it.
    //
    // A dragged `labelPos` is resolved against the polyline by the RENDERER, so the
    // rect registered here is the anchor's, which is close enough for other labels
    // to avoid without duplicating the path walk in this pass.
    if (e.data?.centerX !== undefined || e.data?.labelPos !== undefined) {
      placed.push(at(0, 0));
      out.set(e.id, NO_OFFSET);
      continue;
    }

    // Candidates ride the WHOLE polyline, so a label can travel round a corner
    // into open space. `at()` offsets are measured from the router's anchor, so
    // each sampled point becomes a delta from it.
    const poly = pathToPolyline(dp.path);

    // Only nearby obstacles can matter.
    // Near = the obstacle's rect reaches the NEAR window around the anchor. A rect test, not a
    // centre test: a big container's centre can be far away while its border runs right past.
    const nearWin = (r: Rect) => r.x < dp.labelX + NEAR && r.x + r.w > dp.labelX - NEAR &&
      r.y < dp.labelY + NEAR && r.y + r.h > dp.labelY - NEAR;
    const near = obstacles.filter(nearWin);
    const nearLabels = placed.filter((r) =>
      Math.abs(r.x + r.w / 2 - dp.labelX) < NEAR && Math.abs(r.y + r.h / 2 - dp.labelY) < NEAR);

    // Container frames the pill straddles: part inside, part outside. `encloses` keeps its
    // 2px tolerance, so a pill that merely touches the border from inside is not counted.
    const nearFrames = frames.filter(nearWin);
    const borderCost = (r: Rect): number => {
      let n = 0;
      for (const f of nearFrames) if (overlapArea(r, f) > 0 && !encloses(f, r)) n++;
      return W_BORDER * n;
    };

    /** A pill over an edge END hides its arrowhead / dot. */
    const ends = [dp.sp, dp.tp];
    const arrowCost = (r: Rect): number => {
      let n = 0;
      for (const q of ends) if (overlapArea(r, { x: q.x - END_ZONE, y: q.y - END_ZONE, w: 2 * END_ZONE, h: 2 * END_ZONE }) > 0) n++;
      return W_ARROW * n;
    };

    /** Tile overlap, with a free allowance then superlinear growth. */
    const tileCost = (r: Rect): number => {
      let worst = 0;
      for (const o of near) worst += overlapArea(r, o, GAP);
      if (worst <= FREE_OVERLAP) return 0;
      const over = worst - FREE_OVERLAP;
      return W_NODE * over * (1 + over / FREE_OVERLAP);
    };

    let best = NO_OFFSET;
    let bestRect = at(0, 0);
    let bestPenalty = Infinity;

    /** Every cost a candidate pill carries, shared by the on-line and snapped passes. */
    const priceOf = (r: Rect, travel: number, across: number, cap: number, extra = 0): number => {
      let penalty = W_ALONG * travel * 100 + W_ACROSS * across + extra;
      if (penalty >= cap) return penalty;
      penalty += tileCost(r) + borderCost(r) + arrowCost(r);
      if (penalty < cap) penalty += W_LINE * lineHits(r, e.id);
      if (penalty < cap) {
        for (const o of nearLabels) {
          const a = overlapArea(r, o, GAP);
          if (a) penalty += W_LABEL * a;
          if (penalty >= cap) break;
        }
      }
      return penalty;
    };
    const commit = (cx: number, cy: number, across: number, penalty: number) => {
      if (penalty >= bestPenalty) return;
      bestPenalty = penalty;
      bestRect = at(cx - dp.labelX, cy - dp.labelY);
      best = { dx: cx - dp.labelX, dy: cy - dp.labelY, leader: across >= LEADER_AT };
    };

    // Pass 1 — ON the line: slide along the whole path, step across only a little.
    for (const across of ACROSS_STEPS) {
      for (const frac of ALONG_FRACTIONS) {
        const pt = pointAlong(poly, frac);
        if (!pt) continue;
        // Perpendicular to the local direction, so "across" always leaves the line.
        const cx = pt.x + (pt.horizontal ? 0 : across);
        const cy = pt.y + (pt.horizontal ? across : 0);
        // Travel is measured ALONG THE PATH from its midpoint, not as raw
        // displacement — going round a corner is not a penalty, drifting off is.
        const travel = Math.abs(frac - 0.5) * 2; // 0..~0.68
        commit(cx, cy, Math.abs(across), priceOf(at(cx - dp.labelX, cy - dp.labelY), travel, Math.abs(across), bestPenalty));
        if (bestPenalty === 0) break;
      }
      if (bestPenalty === 0) break;
    }

    // Pass 2 — only when no on-line slot is clean: move OFF the line and/or sideways to the edge of
    // an obstacle. A label wider than its corridor (a 60px chip between a tile and a container
    // border 62px away) has no clean slot on its line; the old search kept the least-bad straddle.
    // Candidate centres are the cross product of the sampled path points with the positions just
    // clear of each nearby obstacle, on both axes. Drift is priced per px, so a label leaves its
    // line only when that is cheaper than the straddle / overlap it avoids.
    if (bestPenalty > 0) {
      const snapRects: Rect[] = [...near, ...nearFrames, ...nearLabels];
      for (const frac of ALONG_FRACTIONS) {
        const pt = pointAlong(poly, frac);
        if (!pt) continue;
        const travel = Math.abs(frac - 0.5) * 2;
        const alongXs = new Set<number>([pt.x]);
        const acrossYs = new Set<number>([pt.y]);
        for (const o of snapRects) {
          // Sideways: just clear of this obstacle's left/right edge, when it is near the anchor.
          for (const c of [o.x - size.w / 2 - GAP - 1, o.x + o.w + size.w / 2 + GAP + 1]) {
            if (Math.abs(c - pt.x) <= SNAP_ALONG) alongXs.add(c);
          }
          // Off the line: just clear of this obstacle's top/bottom edge.
          for (const c of [o.y - size.h / 2 - GAP - 1, o.y + o.h + size.h / 2 + GAP + 1]) {
            if (Math.abs(c - pt.y) <= SNAP_REACH) acrossYs.add(c);
          }
        }
        for (const cx of alongXs) for (const cy of acrossYs) {
          const along = Math.abs(cx - pt.x), across = Math.abs(cy - pt.y);
          if (along === 0 && across === 0) continue;
          // A detached label may only lead to CLEAN space: no tile, frame border, arrow end or other
          // edge's line. An off-line slot that still hits one is never better than the on-line one —
          // it would trade a leader for a clipped tile or a label stranded on someone else's line.
          const r = at(cx - dp.labelX, cy - dp.labelY);
          if (tileCost(r) > 0 || borderCost(r) > 0 || arrowCost(r) > 0 || lineHits(r, e.id) > 0) continue;
          // Perpendicular drift is priced by commit/priceOf; sideways drift only costs per px.
          const drift = along * W_ALONG_PX;
          commit(cx, cy, across, priceOf(r, travel, across, bestPenalty, drift));
        }
      }
    }

    placed.push(bestRect);
    out.set(e.id, best);
  }

  cacheSig = sig;
  cacheMap = out;
  return out;
}
